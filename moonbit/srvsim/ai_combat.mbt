// ai.js 直译 · 战术层: _findCoverSpot/_peekMarch/_ridgeSpot(掩体伸缩 G2)/
// _tacticRoute/_chainHop/_blockCov/_hillSync(战术路由 G9)/_coverStep/_hideDrive/_reposPt。
// 注释标原函数名。

///|
/// 藏探点(_findCoverSpot/_ridgeSpot 产物 {hide, peek, face, cov, lead})
pub(all) struct CoverSpot {
  hide : (Double, Double)
  peek : (Double, Double)
  face : Double
  lead : Double
}

///|
/// _findCoverSpot (ai.js:844-896): 藏点搜索(相位入口 0.25s 拍跑; 硬掩体背敌侧压深 + 贴角侧探)
fn Ai::find_cover_spot(
  self : Ai,
  world : World,
  ref_ : NavRef,
  dist_p : Double,
  lo : Double,
  trip_max : Double,
) -> CoverSpot? {
  let cv = ai_cfg
  let t = self.tank
  let ux = (ref_.x - t.x) / dist_p.max(1.0)
  let uz = (ref_.z - t.z) / dist_p.max(1.0) // 我→敌
  let mut best : CoverSpot? = None
  let mut bs = -1.0e9
  // 探点纵深钳
  let min_pd = 20.0.max((lo * cv.cover_min_dist_frac).min(dist_p * 0.9))
  // fresh: 蹲草加分只在静止候选段(t.lastFireT || -99)
  let lft = if t.last_fire_t == 0.0 || t.last_fire_t.is_nan() {
    -99.0
  } else {
    t.last_fire_t
  }
  let fresh = world.time_ref.val - lft > 4.0
  let march = if cv.cover_peek_march_m != 0.0 {
    cv.cover_peek_march_m
  } else {
    8.0
  }
  for c in world.covers_list {
    if not(c.blocks_shells) {
      continue // 只认挡弹的硬掩体
    }
    let cx = c.x - t.x
    let cz = c.z - t.z
    let cd = @math.hypot(cx, cz)
    if cd > cv.cover_max_cover_dist || cd > dist_p - 8.0 {
      continue // 太远 / 越过敌身
    }
    let s = cx * ux + cz * uz // 走廊投影(沿敌向)
    if s < -(c.r + 3.0) {
      continue // 深藏身后才弃
    }
    let mut hx = c.x - ux * (c.r + 3.0)
    let mut hz = c.z - uz * (c.r + 3.0)
    if world.terrain.grad_at(hx, hz) > nav_g() {
      continue // 陡壁/壕里是白跑
    }
    // 先探点后验藏
    let pk0 = self.peek_march(hx, hz, ux, uz, ref_, min_pd, march, world, false)
    match pk0 {
      None => continue
      Some(pk0v) => {
        let face_h = if t.no_turret {
          v8_atan2(ref_.x - hx, ref_.z - hz)
        } else {
          v8_atan2(pk0v.0 - hx, pk0v.1 - hz)
        }
        let mut hid = self.grid_hidden(hx, hz, ref_, world, Some(face_h))
        let mut i = 1
        while i <= 3 && not(hid) {
          // 点阵压深(硬要求)
          let nx = hx - ux * 1.5 * i.to_double()
          let nz = hz - uz * 1.5 * i.to_double()
          if world.terrain.grad_at(nx, nz) > nav_g() {
            break
          }
          if self.grid_hidden(nx, nz, ref_, world, Some(face_h)) {
            hx = nx
            hz = nz
            hid = true
          }
          i += 1
        }
        if not(hid) {
          continue // 半藏=白跑, 弃
        }
        let pk = pk0v
        if dist2d(hx, hz, pk.0, pk.1) > trip_max {
          continue // 往返装不进装填窗
        }
        let mut sc = -cd / 15.0 -
          0.0.max(lo - dist2d(pk.0, pk.1, ref_.x, ref_.z)) / 20.0
        // 站位亲和(藏点→站位距离)
        match self.station {
          Some(st) => sc += 0.0.max(3.0 - dist2d(hx, hz, st.0, st.1) / 15.0)
          None => ()
        }
        if cv.cover_bush_affinity != 0.0 && fresh {
          for b in world.covers_list {
            if b.blocks_spot &&
              not(b.blocks_shells) &&
              dist2d(b.x, b.z, pk.0, pk.1) < b.r + 2.0 {
              sc += cv.cover_bush_affinity
              break
            }
          }
        }
        if sc > bs {
          bs = sc
          best = Some({ hide: (hx, hz), peek: pk, face: face_h, lead: 0.0, })
        }
      }
    }
  }
  if best is None {
    best = self.ridge_spot(world, ref_, ux, uz, lo, trip_max, march)
  }
  match best {
    None => None
    Some(b) => {
      // 探出提前量: 藏→探是前进档(≈0.6×极速)+收敛尾+垫
      let v_p = 4.0.max(t.spec.max_speed * 0.6)
      let lead = dist2d(b.hide.0, b.hide.1, b.peek.0, b.peek.1) / v_p +
        0.45 +
        (if cv.cover_peek_pad != 0.0 { cv.cover_peek_pad } else { 0.3 })
      Some({ hide: b.hide, peek: b.peek, face: b.face, lead, })
    }
  }
}

///|
/// _peekMarch (ai.js:903-924): 贴角侧探(方向序: ridge=对敌向优先; 硬掩体=侧探优先)。
/// 返回 (px, pz) 或 None。
fn Ai::peek_march(
  self : Ai,
  hx : Double,
  hz : Double,
  ux : Double,
  uz : Double,
  ref_ : NavRef,
  min_pd : Double,
  march : Double,
  world : World,
  ridge : Bool,
) -> (Double, Double)? {
  let side : Double = if self.flank_slot > @math.PI { 1.0 } else { -1.0 }
  let dirs : Array[(Double, Double)] = if ridge {
    [(ux, uz), (-uz * side, ux * side), (uz * side, -ux * side)]
  } else {
    [(-uz * side, ux * side), (uz * side, -ux * side), (ux, uz)]
  }
  for d in dirs {
    let mx = d.0
    let mz = d.1
    let mut e = 1.0
    while e <= march {
      let px = hx + mx * e
      let pz = hz + mz * e
      if world.terrain.grad_at(px, pz) > nav_g() {
        break // 探点不落陡壁
      }
      if dist2d(px, pz, ref_.x, ref_.z) < min_pd {
        break // 纵深钳(再探只会更近)
      }
      let gy = world.terrain.height_at(ref_.x, ref_.z)
      let mut blk = self.win_ray_clear(
        ref_.x,
        ref_.z,
        gy + 1.0,
        world,
        Some(px),
        Some(pz),
      )
      if blk == 1 {
        blk = self.win_ray_clear(
          ref_.x,
          ref_.z,
          gy + 1.2,
          world,
          Some(px),
          Some(pz),
        )
      }
      if blk == 0 {
        return Some((px, pz))
      }
      e += 1.0
    }
  }
  None
}

///|
/// _ridgeSpot (ai.js:932-955): 反斜面棱线 8 向扇扫(背敌向优先)3m 步进 ≤24m
fn Ai::ridge_spot(
  self : Ai,
  world : World,
  ref_ : NavRef,
  ux : Double,
  uz : Double,
  lo : Double,
  trip_max : Double,
  march : Double,
) -> CoverSpot? {
  let t = self.tank
  let min_pd = 20.0.max(
    (lo * ai_cfg.cover_min_dist_frac).min(
      dist2d(t.x, t.z, ref_.x, ref_.z) * 0.9,
    ),
  )
  let dirs : Array[(Double, Double)] = []
  for k in 0..<8 {
    let a = k.to_double() * @math.PI / 4.0
    dirs.push((v8_sin(a), v8_cos(a)))
  }
  // dirs.sort 背敌向优先(按投影降序; V8 稳定排序 → 插入排序保稳)
  let proj = fn(d : (Double, Double)) -> Double { d.0 * -ux + d.1 * -uz }
  let mut i = 1
  while i < dirs.length() {
    let key = dirs[i]
    let kd = proj(key)
    let mut j = i - 1
    while j >= 0 && proj(dirs[j]) < kd {
      dirs[j + 1] = dirs[j]
      j -= 1
    }
    dirs[j + 1] = key
    i += 1
  }
  let mut best : CoverSpot? = None
  let mut bs = 1.0e9
  for d in dirs {
    let mut dd = 3.0
    while dd <= 24.0 {
      let x = t.x + d.0 * dd
      let z = t.z + d.1 * dd
      if world.terrain.grad_at(x, z) > nav_g() {
        break // 这方向撞陡壁, 弃向
      }
      if world.terrain.grad_at(x, z) > nav_g() * 0.75 {
        dd += 2.0
        continue // 唇沿陡坡: 爬得进停不稳
      }
      if not(self.grid_hidden(x, z, ref_, world, None)) {
        dd += 2.0
        continue
      }
      match self.peek_march(x, z, ux, uz, ref_, min_pd, march, world, true) {
        None => ()
        Some(pk) => {
          let trip = dist2d(x, z, pk.0, pk.1)
          if trip > trip_max {
            dd += 2.0
            continue // 往返装不进装填窗
          }
          let sc = dd + trip // 少跑路: 到藏格 + 藏↔探
          if sc < bs {
            bs = sc
            best = Some({
              hide: (x, z),
              peek: pk,
              face: v8_atan2(ref_.x - x, ref_.z - z),
              lead: 0.0,
            })
          }
          break // 该向最近藏格已比出, 深处不再扫
        }
      }
      dd += 2.0
    }
  }
  best
}

///|
/// _tacticRoute (ai.js:975-1022): 战术路由(G9)优先级仲裁层
fn Ai::tactic_route(
  self : Ai,
  world : World,
  ref_ : NavRef,
  dist_p : Double,
  dt : Double,
  hi : Double,
  gated : Bool,
) -> Unit {
  self.tac_t -= dt
  if self.tac_t > 0.0 {
    return
  }
  let tc = ai_cfg
  self.tac_t = tc.tactics_recheck_s
  let t = self.tank
  let reload_mid = t.reload_t > 0.0
  let mut tac = "skirmish"
  if gated && self.seen_now {
    tac = "gateFlank" // 穿深门在身
  } else if self.win_blk == 1 &&
    world.terrain.height_at(ref_.x, ref_.z) - world.terrain.height_at(t.x, t.z) >=
    tc.hill_min_adv {
    tac = "hillAssault" // 地形挡+敌居高
  } else if self.win_blk == 2 &&
    self.win_since is Some(_) &&
    world.time_ref.val - self.win_since.unwrap() > tc.cover_flank_after_s {
    tac = "coverFlank" // 掩体挡窗持续
  } else if reload_mid && self.cover_spot_ok {
    tac = "peekBoom" // 换弹有藏点
  } else if t.reload_t <= 0.0 && self.win_open {
    tac = "standFight" // 上膛有窗
  } else if reload_mid {
    tac = "angle" // 换弹没藏点
  } else if dist_p > hi {
    tac = "advance" // 带外
  } else if self.station is Some(_) {
    tac = "holdBand"
  }
  self.tactic = tac
  // 高地强袭的授权与集结(G9-⑦)
  if tac == "hillAssault" {
    if self.role == Some("second") {
      self.hill_auth = false
    } else {
      self.hill_sync(world, ref_)
      self.hill_t = world.time_ref.val
    }
  } else if world.time_ref.val - self.hill_t > tc.hill_auth_hold_s {
    self.hill_auth = false
  }
  // 绕掩体掏侧后(G9-④)
  if tac == "coverFlank" && not(self.hold) {
    if self.cf_pt is None || world.time_ref.val - self.cf_t > 6.0 {
      self.cf_t = world.time_ref.val
      match self.block_cov(world, ref_) {
        Some(cov) => {
          let side : Double = if self.flank_slot > @math.PI {
            1.0
          } else {
            -1.0
          }
          let px = -(ref_.z - cov.z)
          let pz = ref_.x - cov.x
          let pl0 = @math.hypot(px, pz)
          let pl = if pl0 > 0.0 { pl0 } else { 1.0 }
          self.cf_pt = Some(
            (
              cov.x + px / pl * (cov.r + 10.0) * side + (ref_.x - cov.x) * 0.2,
              cov.z + pz / pl * (cov.r + 10.0) * side + (ref_.z - cov.z) * 0.2,
            ),
          )
        }
        None => self.cf_pt = None
      }
    }
  } else if self.tactic != "coverFlank" {
    self.cf_pt = None
  }
}

///|
/// _chainHop (ai.js:1027-1056): 沿掩体链推进(G9-③)的下一跳
fn Ai::chain_hop(
  self : Ai,
  world : World,
  ref_ : NavRef,
  dist_p : Double,
  dt : Double,
) -> (Double, Double)? {
  let ch = ai_cfg
  if ch.chain_on == 0 {
    return None
  }
  self.chain_t = self.chain_t - dt
  match self.chain_pt {
    Some(pt) =>
      if self.chain_t > 0.0 {
        if dist2d(self.tank.x, self.tank.z, pt.0, pt.1) > 6.0 {
          return Some(pt)
        }
        self.chain_pt = None // 到达: 本跳完成
      }
    None => ()
  }
  if self.chain_t > 0.0 {
    return None
  }
  self.chain_t = 0.5
  let t = self.tank
  let ux = (ref_.x - t.x) / dist_p.max(1.0)
  let uz = (ref_.z - t.z) / dist_p.max(1.0)
  let mut best : (Double, Double)? = None
  let mut bs = -1.0e9
  for c in world.covers_list {
    if not(c.blocks_shells) {
      continue
    }
    let cx = c.x - t.x
    let cz = c.z - t.z
    let cd = @math.hypot(cx, cz)
    if cd < 8.0 ||
      cd > (if ch.chain_hop_max != 0.0 { ch.chain_hop_max } else { 45.0 }) {
      continue // 贴脚的没意义 / 太远跑不到
    }
    let s = cx * ux + cz * uz // 朝敌投影
    if s < (if ch.chain_step_min != 0.0 { ch.chain_step_min } else { 12.0 }) {
      continue // 不构成前进的一跳
    }
    let perp = (cx * uz - cz * ux).abs() // 横向偏距
    if perp > 18.0 {
      continue // 绕太远
    }
    if s > dist_p - 8.0 {
      continue // 越过敌身
    }
    let hx = c.x - ux * (c.r + 3.0)
    let hz = c.z - uz * (c.r + 3.0)
    if world.terrain.grad_at(hx, hz) > nav_g() {
      continue // 背敌侧站不住
    }
    let sc = s - perp * 0.5
    if sc > bs {
      bs = sc
      best = Some((hx, hz))
    }
  }
  self.chain_pt = best
  best
}

///|
/// _blockCov (ai.js:1060-1073): 挡窗掩体定位(我→敌连线 4m 步进, 首个圈住采样点的硬掩体)
fn Ai::block_cov(self : Ai, world : World, ref_ : NavRef) -> @simcore.Cover? {
  let t = self.tank
  let dx = ref_.x - t.x
  let dz = ref_.z - t.z
  let len = @math.hypot(dx, dz)
  if len < 4.0 {
    return None
  }
  let steps = (len / 4.0).ceil().to_int()
  for i in 1..<steps {
    let f = i.to_double() / steps.to_double()
    let mx = t.x + dx * f
    let mz = t.z + dz * f
    for c in world.covers_list {
      if not(c.blocks_shells) {
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
/// _hillSync (ai.js:1080-1096): 高地强袭共享计划(登记-集结-同拍转进)
fn Ai::hill_sync(self : Ai, world : World, ref_ : NavRef) -> Unit {
  let tc = ai_cfg
  let now = world.time_ref.val
  let mut p = world.hill_plan
  let need_new = match p {
    None => true
    Some(pv) =>
      now - pv.t > tc.hill_plan_s ||
      now > pv.go_t + 12.0 ||
      dist2d(pv.x, pv.z, ref_.x, ref_.z) > 50.0
  }
  if need_new {
    let np : HillPlan = {
      t: now,
      x: ref_.x,
      z: ref_.z,
      go_t: now + tc.hill_rally_s,
      reg: Map::new(),
    }
    world.hill_plan = Some(np)
    p = Some(np)
  } else {
    match p {
      Some(pv) => pv.t = now // 仍在窗内: 只续命不改 goT
      None => ()
    }
  }
  let pv = p.unwrap()
  pv.reg[key_of(self.tank, world)] = now
  let mut n = 0
  for k in sorted_keys(pv.reg) {
    if now - pv.reg[k] > 1.5 {
      ignore(pv.reg.remove(k))
      continue
    }
    // JS: if (!this._memo || !m || m.alive) n++
    let count_it = match self.memo {
      None => true
      Some(m) =>
        match m.byk.get(k) {
          None => true
          Some(tk) => tk.alive
        }
    }
    if count_it {
      n += 1
    }
  }
  self.hill_auth = n.to_double() >=
    (if tc.hill_min_n != 0 { tc.hill_min_n.to_double() } else { 2.0 })
  self.hill_go_t = pv.go_t
}

///|
/// _coverStep (ai.js:1105-1224): 掩体伸缩循环(G2)相位机
fn Ai::cover_step(
  self : Ai,
  world : World,
  ref_ : NavRef,
  dist_p : Double,
  dt : Double,
  lo : Double,
  enemy_low : Bool,
) -> Unit {
  let cv = ai_cfg
  let t = self.tank
  let r_reload = t.spec.gun.reload
  // 粘滞参照的择主
  if ref_.alive() {
    // pool = (mpTargets.length ? mpTargets : [player]).filter(alive && dist < distP*1.45)
    let pool : Array[Tank] = []
    if world.mp_targets.length() > 0 {
      for e in world.mp_targets {
        if e.alive && dist2d(t.x, t.z, e.x, e.z) < dist_p * 1.45 {
          pool.push(e)
        }
      }
    } else {
      match world.player {
        Some(p) =>
          if p.alive && dist2d(t.x, t.z, p.x, p.z) < dist_p * 1.45 {
            pool.push(p)
          }
        None => ()
      }
    }
    if pool.length() > 0 {
      // pool.sort((a,b) => (|a.speed||0| - |b.speed||0|) || (dist(a) - dist(b)))(稳定)
      let key = fn(e : Tank) -> (Double, Double) {
        (e.speed.abs(), dist2d(t.x, t.z, e.x, e.z))
      }
      let mut i = 1
      while i < pool.length() {
        let ke = pool[i]
        let kv = key(ke)
        let mut j = i - 1
        while j >= 0 {
          let kj = key(pool[j])
          if kj.0 < kv.0 || (kj.0 == kv.0 && kj.1 <= kv.1) {
            break
          }
          pool[j + 1] = pool[j]
          j -= 1
        }
        pool[j + 1] = ke
        i += 1
      }
      let want = pool[0]
      let take = match self.cover_ref {
        None => true
        Some(cr) =>
          not(cr.alive) ||
          (
            cr.uid != want.uid &&
            dist2d(t.x, t.z, want.x, want.z) <
            dist2d(t.x, t.z, cr.x, cr.z) * 0.7
          )
      }
      if take {
        self.cover_ref = Some(want)
      }
    }
  } else {
    self.cover_ref = None
  }
  let cref : NavRef = match self.cover_ref {
    Some(cr) =>
      {
        x: cr.x,
        z: cr.z,
        vx: cr.vel_x,
        vz: cr.vel_z,
        t: world.time_ref.val,
        yaw: cr.yaw,
        tk: Some(cr),
      }
    None => ref_
  }
  // 藏↔探行程预算
  let trip_max = 4.0.max((r_reload - 1.05) * 4.0.max(t.spec.max_speed * 0.6))
  // 首次进场行程预算
  let v_t = t.spec.max_speed * (if t.no_turret { 0.42 } else { 0.6 })
  let app_max = trip_max.max(r_reload * 1.5 * v_t)
  if self.cover_phase != "none" {
    let cap = if self.cover_phase == "hide" {
      r_reload * self.hide_frac * 1.2
    } else {
      (if self.peek_lead != 0.0 { self.peek_lead } else { 2.0 }) * 1.2 + 1.0
    }
    let al = t.spec.gun.autoloader is Some(_)
    // 行进中豁免相位窗 ×2.5+4s
    let en_route = self.cover_phase == "hide" &&
      self.cover_pt is Some(_) &&
      dist2d(t.x, t.z, self.cover_pt.unwrap().0, self.cover_pt.unwrap().1) > 4.0 &&
      t.speed.abs() > 0.4
    if enemy_low ||
      al ||
      world.time_ref.val - self.cover_enter_t >
      cap * (if en_route { 2.5 } else { 1.0 }) +
      (if en_route { 4.0 } else { 0.0 }) {
      self.cover_phase = "none"
      self.cover_pt = None
      self.cover_peek = None
      return
    }
    if self.cover_phase == "hide" {
      if self.rev_stuck_t > 1.5 {
        self.cover_phase = "peek"
        self.cover_enter_t = world.time_ref.val
        self.rev_stuck_t = 0.0
        return
      }
      // 换相时机按"当前位→探点"实际行程取 max(藏↔探提前量), 前进档车速
      let tpk = match self.cover_peek {
        Some(pk) => dist2d(t.x, t.z, pk.0, pk.1)
        None => 0.0
      }
      let v_p2 = 4.0.max(t.spec.max_speed * 0.6)
      if t.reload_t <= self.peek_lead.max(tpk / v_p2 + 0.6) {
        self.cover_phase = "peek"
        self.cover_enter_t = world.time_ref.val
        return
      }
      // 遮断复验(到点后, 点阵口径)
      if t.reload_t > 0.0 &&
        world.time_ref.val - self.hide_chk_t > cv.cover_hide_check_s &&
        dist2d(t.x, t.z, self.cover_pt.unwrap().0, self.cover_pt.unwrap().1) <
        3.0 {
        self.hide_chk_t = world.time_ref.val
        if not(self.grid_hidden(t.x, t.z, cref, world, Some(t.yaw))) {
          match self.find_cover_spot(world, cref, dist_p, lo, trip_max) {
            Some(s) => {
              self.cover_pt = Some(s.hide)
              self.cover_peek = Some(s.peek)
              self.peek_lead = s.lead
              self.cover_face = s.face
              self.cover_has_face = true
            }
            None => {
              self.cover_phase = "peek"
              self.cover_enter_t = world.time_ref.val
            }
          }
        }
      }
    } else if t.reload_t > r_reload * 0.8 {
      // 探出后已开火(装填回满) → 打完回藏; 锚点稳定复用
      let mut s : CoverSpot? = None
      if self.cover_pt is Some(_) &&
        self.cover_peek is Some(_) &&
        self.cover_has_face &&
        self.grid_hidden(
          self.cover_pt.unwrap().0,
          self.cover_pt.unwrap().1,
          cref,
          world,
          Some(self.cover_face),
        ) &&
        not(
          self.grid_hidden(
            self.cover_peek.unwrap().0,
            self.cover_peek.unwrap().1,
            cref,
            world,
            None,
          ),
        ) {
        s = Some({
          hide: self.cover_pt.unwrap(),
          peek: self.cover_peek.unwrap(),
          face: self.cover_face,
          lead: self.peek_lead,
        })
      }
      match s {
        None =>
          match self.find_cover_spot(world, cref, dist_p, lo, trip_max) {
            Some(s0) => {
              s = Some(s0)
              self.cover_face = s0.face // 找点函数写入入位姿态
              self.cover_has_face = true
            }
            None => ()
          }
        Some(_) => ()
      }
      // 离站位远: 弃循环先归位(顶线 HT 例外)
      let far_from_station = match (self.station, self.role) {
        (Some(st), Some(role)) =>
          role != "line" && dist2d(t.x, t.z, st.0, st.1) > 25.0
        _ => false
      }
      let too_far = match s {
        Some(sv) => dist2d(t.x, t.z, sv.hide.0, sv.hide.1) > app_max
        None => true
      }
      if s is None || far_from_station || too_far {
        self.cover_phase = "none"
        self.cover_pt = None
        self.cover_peek = None
      } else {
        let sv = s.unwrap()
        self.cover_pt = Some(sv.hide)
        self.cover_peek = Some(sv.peek)
        self.peek_lead = sv.lead
        self.cover_face = sv.face
        self.cover_has_face = true
        self.cover_phase = "hide"
        self.cover_enter_t = world.time_ref.val
        self.rev_stuck_t = 0.0
        self.hide_chk_t = -9.0
        self.hide_cov = false
      }
    }
    return
  }
  self.cover_t -= dt
  // (JS: if (this._coverT > 0 || t.reloadT <= 0 || !ref) return —— 调用点保证 ref 真值)
  if self.cover_t > 0.0 || t.reload_t <= 0.0 {
    return
  }
  self.cover_t = 0.25
  let al = t.spec.gun.autoloader is Some(_)
  self.hide_frac = hide_frac_cls_of(t.spec.cls).unwrap_or(0.6)
  self.cover_spot_ok = false // 本拍没有可用藏点(下面找到才置真)
  if al || enemy_low || r_reload < 2.2 || dist_p < lo * cv.cover_min_dist_frac {
    return
  }
  // 有炮塔车恢复入循环(G9 路由联动): 窗口关着才进
  if not(t.no_turret) && (self.tactic == "legacy" || self.win_open) {
    return
  }
  // 离自己的角色站位还远不进循环(藏点就在脚边 ≤20m 例外在找点后)
  let s0 = self.find_cover_spot(world, cref, dist_p, lo, trip_max)
  match s0 {
    None => return // 无可用藏点: _coverSpotOK 保持 false → 摆角全窗
    Some(_) => ()
  }
  let s0v = s0.unwrap()
  self.cover_spot_ok = true // 有可用藏点 → 摆角只摆顶部时片
  // 有炮塔车只收贴手藏点(≤20m)
  if not(t.no_turret) && dist2d(t.x, t.z, s0v.hide.0, s0v.hide.1) > 20.0 {
    return
  }
  match (self.station, self.role) {
    (Some(st), Some(role)) =>
      if role != "line" && dist2d(t.x, t.z, st.0, st.1) > 25.0 {
        return
      }
    _ => ()
  }
  if dist2d(t.x, t.z, s0v.hide.0, s0v.hide.1) > app_max {
    return // 赶不到的藏点不进(防空转)
  }
  let s = s0v
  // 摆角相(1-hideFrac 按车类)给多少: 类别份额与可行窗的较小者
  let angle_share = ((1.0 - self.hide_frac) * r_reload).min(
    0.0.max(r_reload - s.lead - 1.2),
  )
  if t.reload_t <= r_reload - angle_share && t.reload_t > s.lead + 0.3 {
    // 摆角相用完 且 行程可行: 进藏相
    self.cover_pt = Some(s.hide)
    self.cover_peek = Some(s.peek)
    self.peek_lead = s.lead
    self.cover_face = s.face
    self.cover_has_face = true
    self.cover_phase = "hide"
    self.cover_enter_t = world.time_ref.val
    self.rev_stuck_t = 0.0
    self.hide_chk_t = -9.0
    self.hide_cov = false
  }
}

///|
/// _hideDrive (ai.js:1231-1248): 藏相驾驶: 车尾朝敌倒车入位(炮口全程对敌)
fn Ai::hide_drive(
  self : Ai,
  px : Double,
  pz : Double,
  dt : Double,
  world : World,
  ref_ : NavRef,
) -> Bool {
  let t = self.tank
  let d = dist2d(t.x, t.z, px, pz)
  if d < 5.0 && world.time_ref.val - self.hide_chk_t > ai_cfg.cover_hide_check_s {
    self.hide_chk_t = world.time_ref.val
    // 到点=点阵全藏(按实际车头)
    self.hide_cov = self.grid_hidden(t.x, t.z, ref_, world, Some(t.yaw))
  }
  if d < 1.2 || self.hide_cov {
    self.input.throttle = 0.0
    self.input.steer = 0.0
    return true
  }
  let want = v8_atan2(px - t.x, pz - t.z) + @math.PI // 倒车期望车头向
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
fn Ai::repos_pt(
  self : Ai,
  world : World,
  ref_ : NavRef,
  dist_p : Double,
) -> (Double, Double) {
  let t = self.tank
  let band = self.band_for()
  let lo = band.0
  let hi = band.1
  let r_max = if self.hold { 28.0 } else { dist_p.max((lo + hi) * 0.5).min(hi) }
  let mut best : (Double, Double)? = None
  let mut bs = -1.0e9
  for i in 0..<6 {
    let a = self.flank_slot + (i.to_double() - 2.5) * 0.8
    let cx = clamp(t.x + v8_sin(a) * r_max, -430.0, 430.0)
    let cz = clamp(t.z + v8_cos(a) * r_max, -430.0, 430.0)
    if world.terrain.grad_at(cx, cz) > nav_g() {
      continue // 候选落在陡壁/壕里是白跑
    }
    // 敌鼻向 vs 敌→候选(JS ref.yaw || 0)
    let crel = ang_diff(ref_.yaw, v8_atan2(cx - ref_.x, cz - ref_.z)).abs()
    let s = (if crel > side_arc() { 20.0 } else { 0.0 }) -
      (@math.hypot(cx - ref_.x, cz - ref_.z) - (lo + hi) * 0.5).abs() / 30.0 -
      @math.hypot(cx - t.x, cz - t.z) / 60.0
    if s > bs {
      bs = s
      best = Some((cx, cz))
    }
  }
  match best {
    Some(b) => b
    None => (t.x, t.z)
  }
}
