// SF.AI 战术与主循环直译(下半): _findCoverSpot/_peekMarch/_ridgeSpot (ai.js:844-955),
// _tacticRoute/_chainHop/_blockCov/_hillSync (ai.js:975-1096), _coverStep/_hideDrive/_reposPt
// (ai.js:1105-1270), update 主逻辑 (ai.js:1273-1916)。

///|
/// _findCoverSpot (ai.js:844-896): 藏点搜索(相位入口 0.25s 拍)
pub fn Ai::find_cover_spot(
  self : Ai,
  world : World,
  ref_t : RefT,
  dist_p : Double,
  lo : Double,
  trip_max : Double,
) -> CoverPlan? {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let t = self.tank
  let ux = (ref_t.x() - t.x) / dist_p.max(1.0)
  let uz = (ref_t.z() - t.z) / dist_p.max(1.0)
  let mut best : CoverPlan? = None
  let mut bs = -1.0e9
  // JS: Math.max(20, Math.min(lo * CV.minDistFrac, distP * 0.9))
  let min_pd = (lo * cfg.ai.cover_min_dist_frac).min(dist_p * 0.9).max(20.0)
  let fresh = world.time - js_orv(t.last_fire_t, -99.0) > 4.0
  let march = cfg.ai.cover_peek_march_m
  for c in world.covers.items {
    if !c.blocks_shells {
      continue
    }
    let cx = c.x - t.x
    let cz = c.z - t.z
    let cd = @math.hypot(cx, cz)
    if cd > cfg.ai.cover_max_cover_dist || cd > dist_p - 8.0 {
      continue
    }
    let s_proj = cx * ux + cz * uz
    if s_proj < -(c.r + 3.0) {
      continue
    }
    let mut hx = c.x - ux * (c.r + 3.0)
    let mut hz = c.z - uz * (c.r + 3.0)
    if world.terrain.grad_at(hx, hz) > nav_g(ctx) {
      continue
    }
    let pk0 = self.peek_march(
      hx, hz, ux, uz, ref_t, min_pd, march, world, false,
    )
    if pk0 is None {
      continue
    }
    let pk = pk0.unwrap()
    let face_h = if t.parts_no_turret {
      @math.atan2(ref_t.x() - hx, ref_t.z() - hz)
    } else {
      @math.atan2(pk.x - hx, pk.z - hz)
    }
    let mut hid = self.grid_hidden(hx, hz, ref_t, world, face_yaw=face_h)
    // 点阵压深(≤3 步, 逐 1.5m)
    for i in 1..<4 {
      if hid {
        break
      }
      let nx = hx - ux * 1.5 * i.to_double()
      let nz = hz - uz * 1.5 * i.to_double()
      if world.terrain.grad_at(nx, nz) > nav_g(ctx) {
        break
      }
      if self.grid_hidden(nx, nz, ref_t, world, face_yaw=face_h) {
        hx = nx
        hz = nz
        hid = true
      }
    }
    if !hid {
      continue
    }
    if dist2d(hx, hz, pk.x, pk.z) > trip_max {
      continue
    }
    let mut sc = -cd / 15.0 -
      0.0.max(lo - dist2d(pk.x, pk.z, ref_t.x(), ref_t.z())) / 20.0
    match self.station {
      Some(stn) => sc += 0.0.max(3.0 - dist2d(hx, hz, stn.x, stn.z) / 15.0)
      None => ()
    }
    if cfg.ai.cover_bush_affinity > 0.0 && fresh {
      // JS: if (CV.bushAffinity && fresh) —— 非零即真
      for b in world.covers.items {
        if b.blocks_spot &&
          !b.blocks_shells &&
          dist2d(b.x, b.z, pk.x, pk.z) < b.r + 2.0 {
          sc += cfg.ai.cover_bush_affinity
          break
        }
      }
    }
    if sc > bs {
      bs = sc
      best = Some({
        hide: { x: hx, z: hz, },
        peek: pk,
        face: face_h,
        cov: Some(c),
        lead: 0.0,
      })
    }
  }
  if best is None {
    best = self.ridge_spot(world, ref_t, ux, uz, lo, trip_max, march)
  }
  if best is None {
    return None
  }
  let bp = best.unwrap()
  // 探出提前量: 藏→探车程(前进档 0.6×极速)+收敛尾+垫
  let v_p = 4.0.max(js_orv(t.spec.max_speed, 8.0) * 0.6)
  bp.lead = dist2d(bp.hide.x, bp.hide.z, bp.peek.x, bp.peek.z) / v_p +
    0.45 +
    cfg.ai.cover_peek_pad
  Some(bp)
}

///|
/// _peekMarch (ai.js:903-924): 贴角侧探(探点判定=开火窗射线口径)
pub fn Ai::peek_march(
  self : Ai,
  hx : Double,
  hz : Double,
  ux : Double,
  uz : Double,
  ref_t : RefT,
  min_pd : Double,
  march : Double,
  world : World,
  ridge : Bool,
) -> Pt? {
  let ctx = self.ctx
  let side : Double = if self.flank_slot > @math.PI { 1.0 } else { -1.0 }
  let dirs : Array[(Double, Double)] = if ridge {
    [(ux, uz), (-uz * side, ux * side), (uz * side, -ux * side)]
  } else {
    [(-uz * side, ux * side), (uz * side, -ux * side), (ux, uz)]
  }
  for md in dirs {
    let mut e = 1.0
    while e <= march {
      let px = hx + md.0 * e
      let pz = hz + md.1 * e
      if world.terrain.grad_at(px, pz) > nav_g(ctx) {
        break
      }
      if dist2d(px, pz, ref_t.x(), ref_t.z()) < min_pd {
        break
      }
      let gy = world.terrain.height_at(ref_t.x(), ref_t.z())
      let mut blk = self.win_ray_clear(
        ref_t.x(),
        ref_t.z(),
        gy + 1.0,
        world,
        ox=px,
        oz=pz,
      )
      if blk == 1 {
        blk = self.win_ray_clear(
          ref_t.x(),
          ref_t.z(),
          gy + 1.2,
          world,
          ox=px,
          oz=pz,
        )
      }
      if blk == 0 {
        return Some({ x: px, z: pz, })
      }
      e += 1.0
    }
  }
  None
}

///|
/// _ridgeSpot (ai.js:932-955): 反斜面棱线 8 向扇扫
pub fn Ai::ridge_spot(
  self : Ai,
  world : World,
  ref_t : RefT,
  ux : Double,
  uz : Double,
  lo : Double,
  trip_max : Double,
  march : Double,
) -> CoverPlan? {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let t = self.tank
  let min_pd = (lo * cfg.ai.cover_min_dist_frac)
    .min(dist2d(t.x, t.z, ref_t.x(), ref_t.z()) * 0.9)
    .max(20.0)
  let dirs : Array[(Double, Double)] = []
  for k in 0..<8 {
    dirs.push(
      (
        @math.sin(k.to_double() * @math.PI / 4.0),
        @math.cos(k.to_double() * @math.PI / 4.0),
      ),
    )
  }
  // dirs.sort 背敌向优先(稳定)
  stable_sort_by(dirs, fn(a, b) {
    b.0 * -ux + b.1 * -uz - (a.0 * -ux + a.1 * -uz)
  })
  let mut best : CoverPlan? = None
  let mut bs = 1.0e9
  for dd in dirs {
    let mut d = 3.0
    while d <= 24.0 {
      let x = t.x + dd.0 * d
      let z = t.z + dd.1 * d
      let g_here = world.terrain.grad_at(x, z)
      if g_here > nav_g(ctx) {
        break
      }
      if g_here > nav_g(ctx) * 0.75 {
        d += 2.0
        continue
      }
      if !self.grid_hidden(x, z, ref_t, world) {
        d += 2.0
        continue
      }
      let pk = self.peek_march(x, z, ux, uz, ref_t, min_pd, march, world, true)
      if pk is None {
        d += 2.0
        continue
      }
      let pk = pk.unwrap()
      let trip = dist2d(x, z, pk.x, pk.z)
      if trip > trip_max {
        d += 2.0
        continue
      }
      let sc = d + trip
      if sc < bs {
        bs = sc
        best = Some({
          hide: { x, z, },
          peek: pk,
          face: @math.atan2(ref_t.x() - x, ref_t.z() - z),
          cov: None,
          lead: 0.0,
        })
      }
      break
    }
  }
  best
}

///|
/// _tacticRoute (ai.js:975-1022): 战术路由(优先级表, recheckS 一拍)
pub fn Ai::tactic_route(
  self : Ai,
  world : World,
  ref_t : RefT?,
  dist_p : Double,
  dt : Double,
  lo : Double,
  hi : Double,
  gated : Bool,
) -> Unit {
  let cfg = self.ctx.cfg
  self.tac_t -= dt
  if self.tac_t > 0.0 {
    return
  }
  self.tac_t = cfg.ai.tac_recheck_s
  let t = self.tank
  let reload_mid = t.reload_t > 0.0
  let mut tac = "skirmish"
  if gated && self.seen_now {
    tac = "gateFlank"
  } else if self.win_blk == 1 &&
    ref_t is Some(r) &&
    world.terrain.height_at(r.x(), r.z()) - world.terrain.height_at(t.x, t.z) >=
    cfg.ai.tac_hill_min_adv {
    tac = "hillAssault"
  } else if self.win_blk == 2 &&
    self.win_since is Some(_) &&
    world.time - self.win_since.unwrap() > cfg.ai.tac_cover_flank_after_s {
    tac = "coverFlank"
  } else if reload_mid && self.cover_spot_ok {
    tac = "peekBoom"
  } else if t.reload_t <= 0.0 && self.win_open {
    tac = "standFight"
  } else if reload_mid {
    tac = "angle"
  } else if dist_p > hi {
    tac = "advance"
  } else if self.station is Some(_) {
    tac = "holdBand"
  }
  self.tactic = tac
  // 高地强袭授权与集结(G9-⑦)
  if tac == "hillAssault" {
    if self.role is Some(v) && v == "second" {
      self.hill_auth = false
    } else {
      self.hill_sync(world, ref_t.unwrap())
      self.hill_t = Some(world.time)
    }
  } else if world.time - js_or0(self.hill_t) > cfg.ai.tac_hill_auth_hold_s {
    self.hill_auth = false
  }
  // 绕掩体掏侧后(G9-④)
  if tac == "coverFlank" && !self.hold {
    if self.cf_pt is None || world.time - self.cf_t > 6.0 {
      self.cf_t = world.time
      let cov = self.block_cov(world, ref_t.unwrap())
      match cov {
        Some(c) => {
          let side : Double = if self.flank_slot > @math.PI {
            1.0
          } else {
            -1.0
          }
          let r = ref_t.unwrap()
          let px = -(r.z() - c.z)
          let pz = r.x() - c.x
          let pl = @math.hypot(px, pz)
          let pl = if pl > 0.0 { pl } else { 1.0 } // JS: || 1
          self.cf_pt = Some({
            x: c.x + px / pl * (c.r + 10.0) * side + (r.x() - c.x) * 0.2,
            z: c.z + pz / pl * (c.r + 10.0) * side + (r.z() - c.z) * 0.2,
          })
        }
        None => self.cf_pt = None
      }
    }
  } else if self.tactic != "coverFlank" {
    self.cf_pt = None
  }
  ignore(lo)
}

///|
/// _chainHop (ai.js:1027-1056): 沿掩体链推进的下一跳
pub fn Ai::chain_hop(
  self : Ai,
  world : World,
  ref_t : RefT,
  dist_p : Double,
  dt : Double,
) -> Pt? {
  let ctx = self.ctx
  let cfg = ctx.cfg
  if cfg.ai.tac_chain_on == 0 {
    return None
  }
  self.chain_t = js_or0v(self.chain_t) - dt
  match self.chain_pt {
    Some(pt) =>
      if self.chain_t > 0.0 {
        if dist2d(self.tank.x, self.tank.z, pt.x, pt.z) > 6.0 {
          return Some(pt)
        }
        self.chain_pt = None
      }
    None => ()
  }
  if self.chain_t > 0.0 {
    return None
  }
  self.chain_t = 0.5
  let t = self.tank
  let ux = (ref_t.x() - t.x) / dist_p.max(1.0)
  let uz = (ref_t.z() - t.z) / dist_p.max(1.0)
  let mut best : Pt? = None
  let mut bs = -1.0e9
  for c in world.covers.items {
    if !c.blocks_shells {
      continue
    }
    let cx = c.x - t.x
    let cz = c.z - t.z
    let cd = @math.hypot(cx, cz)
    if cd < 8.0 || cd > cfg.ai.tac_chain_hop_max {
      continue
    }
    let s_proj = cx * ux + cz * uz
    if s_proj < cfg.ai.tac_chain_step_min {
      continue
    }
    let perp = (cx * uz - cz * ux).abs()
    if perp > 18.0 {
      continue
    }
    if s_proj > dist_p - 8.0 {
      continue
    }
    let hx = c.x - ux * (c.r + 3.0)
    let hz = c.z - uz * (c.r + 3.0)
    if world.terrain.grad_at(hx, hz) > nav_g(ctx) {
      continue
    }
    let sc = s_proj - perp * 0.5
    if sc > bs {
      bs = sc
      best = Some({ x: hx, z: hz, })
    }
  }
  self.chain_pt = best
  best
}

///|
/// _blockCov (ai.js:1060-1073): 挡窗掩体定位(沿我→敌连线 4m 步进)
pub fn Ai::block_cov(self : Ai, world : World, ref_t : RefT) -> @simcore.Cover? {
  let t = self.tank
  let dx = ref_t.x() - t.x
  let dz = ref_t.z() - t.z
  let len = @math.hypot(dx, dz)
  if len < 4.0 {
    return None
  }
  let steps = (len / 4.0).ceil().to_int()
  for i in 1..<steps {
    let f = i.to_double() / steps.to_double()
    let mx = t.x + dx * f
    let mz = t.z + dz * f
    for c in world.covers.items {
      if !c.blocks_shells {
        continue
      }
      if @math.hypot(mx - c.x, mz - c.z) < c.r + 2.0 {
        return Some(c)
      }
    }
  }
  None
}

///|
/// _hillSync (ai.js:1080-1096): 高地强袭共享计划(world._hillPlan)
pub fn Ai::hill_sync(self : Ai, world : World, ref_t : RefT) -> Unit {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let now = world.time
  let mut rebuild = false
  match world.hill_plan {
    Some(p) =>
      if now - p.t > cfg.ai.tac_hill_plan_s ||
        now > p.go_t + 12.0 ||
        dist2d(p.x, p.z, ref_t.x(), ref_t.z()) > 50.0 {
        rebuild = true
      } else {
        p.t = now
      }
    None => rebuild = true
  }
  if rebuild {
    world.hill_plan = Some({
      t: now,
      x: ref_t.x(),
      z: ref_t.z(),
      go_t: now + cfg.ai.tac_hill_rally_s,
      reg: Map([]),
    })
  }
  let p = world.hill_plan.unwrap()
  p.reg[key_of(self.tank, world)] = { t: now, }
  let mut n = 0
  for k in sorted_keys(p.reg) {
    if now - p.reg[k].t > 1.5 {
      p.reg.remove(k)
      continue
    }
    let alive_or_unknown = match self.memo {
      Some(m) =>
        match m.by_k.get(k) {
          Some(tk) => tk.alive
          None => true
        }
      None => true
    }
    if alive_or_unknown {
      n += 1
    }
  }
  self.hill_auth = n >= cfg.ai.tac_hill_min_n
  self.hill_go_t = p.go_t
}

///|
/// _coverStep (ai.js:1105-1224): 掩体伸缩循环相位机
pub fn Ai::cover_step(
  self : Ai,
  world : World,
  ref_t : RefT?,
  dist_p : Double,
  dt : Double,
  lo : Double,
  enemy_low : Bool,
) -> Unit {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let t = self.tank
  let r_reload = t.spec.gun.reload
  // 粘滞参照的择主
  if ref_t is Some(r) && r.alive() {
    let pool : Array[Tank] = []
    let src : Array[Tank] = if world.mp_targets.length() > 0 {
      world.mp_targets
    } else {
      match world.player {
        Some(p) => [p]
        None => []
      }
    }
    for e in src {
      if e.alive && dist2d(t.x, t.z, e.x, e.z) < dist_p * 1.45 {
        pool.push(e)
      }
    }
    if pool.length() > 0 {
      stable_sort_by(pool, fn(a, b) {
        let primary = a.speed.abs() - b.speed.abs()
        if primary != 0.0 {
          primary
        } else {
          dist2d(t.x, t.z, a.x, a.z) - dist2d(t.x, t.z, b.x, b.z)
        }
      })
      let want = pool[0]
      let switch = match self.cover_ref {
        None => true
        Some(cr) =>
          !cr.alive ||
          (
            cr.uid != want.uid &&
            dist2d(t.x, t.z, want.x, want.z) <
            dist2d(t.x, t.z, cr.x, cr.z) * 0.7
          )
      }
      if switch {
        self.cover_ref = Some(want)
      }
    }
  } else {
    self.cover_ref = None
  }
  let cref : RefT? = match self.cover_ref {
    Some(cr) => Some(RT(cr))
    None => ref_t
  }
  let trip_max = 4.0.max(
    (r_reload - 1.05) * 4.0.max(js_orv(t.spec.max_speed, 8.0) * 0.6),
  )
  let v_t = js_orv(t.spec.max_speed, 8.0) *
    (if t.parts_no_turret { 0.42 } else { 0.6 })
  let app_max = trip_max.max(r_reload * 1.5 * v_t)
  if self.cover_phase != "none" {
    let cap = if self.cover_phase == "hide" {
      r_reload * self.hide_frac * 1.2
    } else {
      js_orv(self.peek_lead, 2.0) * 1.2 + 1.0
    }

    let al = t.spec.gun.autoloader
    let en_route = self.cover_phase == "hide" &&
      self.cover_pt is Some(cp) &&
      dist2d(t.x, t.z, cp.x, cp.z) > 4.0 &&
      t.speed.abs() > 0.4
    let exit = ref_t is None ||
      enemy_low ||
      al is Some(_) ||
      world.time - self.cover_enter_t >
      cap * (if en_route { 2.5 } else { 1.0 }) +
      (if en_route { 4.0 } else { 0.0 })
    if exit {
      self.cover_phase = "none"
      self.cover_pt = None
      self.cover_peek = None
      return
    }
    if self.cover_phase == "hide" {
      if self.rev_stuck_t > 1.5 {
        self.cover_phase = "peek"
        self.cover_enter_t = world.time
        self.rev_stuck_t = 0.0
        return
      }
      // 换相时机: max(peekLead, 当前位→探点行程/前进档车速 + 0.6)
      let tpk = match self.cover_peek {
        Some(pk) => dist2d(t.x, t.z, pk.x, pk.z)
        None => 0.0
      }
      let v_p2 = 4.0.max(js_orv(t.spec.max_speed, 8.0) * 0.6)
      if t.reload_t <= self.peek_lead.max(tpk / v_p2 + 0.6) {
        self.cover_phase = "peek"
        self.cover_enter_t = world.time
        return
      }
      // 遮断复验(到点后, hideCheckS 节流)
      if t.reload_t > 0.0 &&
        world.time - self.hide_chk_t > cfg.ai.cover_hide_check_s {
        if self.cover_pt is Some(cp2) && dist2d(t.x, t.z, cp2.x, cp2.z) < 3.0 {
          self.hide_chk_t = world.time
          if !self.grid_hidden(t.x, t.z, cref.unwrap(), world, face_yaw=t.yaw) {
            let s = self.find_cover_spot(
              world,
              cref.unwrap(),
              dist_p,
              lo,
              trip_max,
            )
            match s {
              Some(sp) => {
                self.cover_pt = Some(sp.hide)
                self.cover_peek = Some(sp.peek)
                self.peek_lead = sp.lead
                self.cover_face = Some(sp.face)
                self.cover_cov = sp.cov
              }
              None => {
                self.cover_phase = "peek"
                self.cover_enter_t = world.time
              }
            }
          }
        }
      }
    } else if t.reload_t > r_reload * 0.8 {
      // 探出后已开火(装填回满) → 打完回藏
      let mut s : CoverPlan? = None
      if self.cover_pt is Some(cp) &&
        self.cover_peek is Some(ck) &&
        self.cover_face is Some(_) {
        if self.grid_hidden(
            cp.x,
            cp.z,
            cref.unwrap(),
            world,
            face_yaw=self.cover_face.unwrap(),
          ) &&
          !self.grid_hidden(ck.x, ck.z, cref.unwrap(), world) {
          s = Some({
            hide: cp,
            peek: ck,
            face: self.cover_face.unwrap(),
            cov: self.cover_cov,
            lead: self.peek_lead,
          })
        }
      }
      if s is None {
        let s2 = self.find_cover_spot(
          world,
          cref.unwrap(),
          dist_p,
          lo,
          trip_max,
        )
        if s2 is Some(sp2) {
          self.cover_face = Some(sp2.face)
        }
        s = s2
      }
      let far_station = match self.station {
        Some(stn) =>
          self.role is Some(rl) &&
          rl != "line" &&
          dist2d(t.x, t.z, stn.x, stn.z) > 25.0
        None => false
      }
      let too_far = match s {
        Some(sp3) => dist2d(t.x, t.z, sp3.hide.x, sp3.hide.z) > app_max
        None => true
      }
      if s is None || far_station || too_far {
        self.cover_phase = "none"
        self.cover_pt = None
        self.cover_peek = None
      } else {
        let sp = s.unwrap()
        self.cover_pt = Some(sp.hide)
        self.cover_peek = Some(sp.peek)
        self.peek_lead = sp.lead
        self.cover_cov = sp.cov
        self.cover_phase = "hide"
        self.cover_enter_t = world.time
        self.rev_stuck_t = 0.0
        self.hide_chk_t = -9.0
        self.hide_cov = false
      }
    }
    return
  }
  self.cover_t -= dt
  if self.cover_t > 0.0 || t.reload_t <= 0.0 || ref_t is None {
    return
  }
  self.cover_t = 0.25
  let al = t.spec.gun.autoloader
  self.hide_frac = hide_frac_cls(ctx, t.spec.cls)
  self.cover_spot_ok = false
  if al is Some(_) ||
    enemy_low ||
    r_reload < 2.2 ||
    dist_p < lo * cfg.ai.cover_min_dist_frac {
    return
  }
  if !t.parts_no_turret && (self.tactic == "legacy" || self.win_open) {
    return
  }
  let s0 = self.find_cover_spot(world, cref.unwrap(), dist_p, lo, trip_max)
  if s0 is None {
    return
  }
  self.cover_spot_ok = true
  let s0 = s0.unwrap()
  if !t.parts_no_turret && dist2d(t.x, t.z, s0.hide.x, s0.hide.z) > 20.0 {
    return
  }
  if self.station is Some(stn) &&
    self.role is Some(rl) &&
    rl != "line" &&
    dist2d(t.x, t.z, stn.x, stn.z) > 25.0 {
    return
  }
  if dist2d(t.x, t.z, s0.hide.x, s0.hide.z) > app_max {
    return
  }
  // 摆角相份额: min(类别份额, 可行窗)
  let angle_share = ((1.0 - self.hide_frac) * r_reload).min(
    0.0.max(r_reload - s0.lead - 1.2),
  )
  if t.reload_t <= r_reload - angle_share && t.reload_t > s0.lead + 0.3 {
    self.cover_pt = Some(s0.hide)
    self.cover_peek = Some(s0.peek)
    self.peek_lead = s0.lead
    self.cover_face = Some(s0.face)
    self.cover_cov = s0.cov
    self.cover_phase = "hide"
    self.cover_enter_t = world.time
    self.rev_stuck_t = 0.0
    self.hide_chk_t = -9.0
    self.hide_cov = false
  }
}

///|
/// _hideDrive (ai.js:1231-1248): 藏相驾驶(车尾朝敌倒车入位)
pub fn Ai::hide_drive(
  self : Ai,
  px : Double,
  pz : Double,
  dt : Double,
  world : World,
  ref_t : RefT,
) -> Bool {
  let cfg = self.ctx.cfg
  let t = self.tank
  let d = dist2d(t.x, t.z, px, pz)
  if d < 5.0 && world.time - self.hide_chk_t > cfg.ai.cover_hide_check_s {
    self.hide_chk_t = world.time
    self.hide_cov = self.grid_hidden(t.x, t.z, ref_t, world, face_yaw=t.yaw)
  }
  if d < 1.2 || self.hide_cov {
    self.input.throttle = 0.0
    self.input.steer = 0.0
    return true
  }
  let want = @math.atan2(px - t.x, pz - t.z) + @math.PI
  let a_err = ang_diff(t.yaw, want)
  if a_err.abs() >= @math.PI / 3.0 {
    self.input.throttle = 0.0
    self.input.steer = clamp(a_err * 2.5, -1.0, 1.0)
  } else {
    self.input.throttle = -1.0
    self.input.steer = clamp(a_err * 2.5, -1.0, 1.0)
    if t.speed.abs() < 0.3 {
      self.rev_stuck_t += dt
    } else {
      self.rev_stuck_t = 0.0
    }
  }
  false
}

///|
/// _reposPt (ai.js:1255-1270): 评分制换位(穿深门专用找侧向)
pub fn Ai::repos_pt(
  self : Ai,
  world : World,
  ref_t : RefT,
  dist_p : Double,
) -> Pt {
  let ctx = self.ctx
  let t = self.tank
  let band = self.band_for()
  let lo = band.0
  let hi = band.1
  let r_max = if self.hold { 28.0 } else { dist_p.max((lo + hi) * 0.5).min(hi) }
  let mut best : Pt? = None
  let mut bs = -1.0e9
  for i in 0..<6 {
    let a = self.flank_slot + (i.to_double() - 2.5) * 0.8
    let cx = clamp(t.x + @math.sin(a) * r_max, -430.0, 430.0)
    let cz = clamp(t.z + @math.cos(a) * r_max, -430.0, 430.0)
    if world.terrain.grad_at(cx, cz) > nav_g(ctx) {
      continue
    }
    let crel = ang_diff(
      js_or0(ref_t.yaw()),
      @math.atan2(cx - ref_t.x(), cz - ref_t.z()),
    ).abs()
    let s_sc = (if crel > SIDE_ARC { 20.0 } else { 0.0 }) -
      (@math.hypot(cx - ref_t.x(), cz - ref_t.z()) - (lo + hi) * 0.5).abs() /
      30.0 -
      @math.hypot(cx - t.x, cz - t.z) / 60.0
    if s_sc > bs {
      bs = s_sc
      best = Some({ x: cx, z: cz, })
    }
  }
  match best {
    Some(b) => b
    None => { x: t.x, z: t.z, }
  }
}
