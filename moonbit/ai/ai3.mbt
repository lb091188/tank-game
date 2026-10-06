// SF.AI update 主逻辑直译(ai.js:1273-1916): 状态机/各状态行为/瞄准与开火。
// 语句次序即规范: 感知节流 → 导航参考 → 协同备忘 → 带插值 → 换血 → 状态转移 →
// 状态行为(patrol/alert/combat/retreat) → 瞄准与开火。

///|
/// alert 态情报候选(lastSeen/heard/intel 三源按 t 取新)
priv enum AlertCand {
  CSeen(Seen)
  CHeard(Heard)
  CIntel
}

///|
fn AlertCand::t_of(self : AlertCand, world : World) -> Double {
  match self {
    CSeen(s) => s.t
    CHeard(h) => h.t
    CIntel => world.intel.t
  }
}

///|
fn AlertCand::x_of(self : AlertCand, world : World) -> Double {
  match self {
    CSeen(s) => s.x
    CHeard(h) => h.x
    CIntel => world.intel.x
  }
}

///|
fn AlertCand::z_of(self : AlertCand, world : World) -> Double {
  match self {
    CSeen(s) => s.z
    CHeard(h) => h.z
    CIntel => world.intel.z
  }
}

///|
/// 瞄准目标点(aimAt: lastSeen 或 {x,z,vx:0,vz:0} 桩)
pub(all) struct AimPt {
  x : Double
  z : Double
  vx : Double
  vz : Double
}

///|
/// update (ai.js:1273-1916)
pub fn Ai::update(self : Ai, dt : Double, world : World) -> Inp {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let t = self.tank
  let p = self.p
  let player = nearest_target(world, ctx, t)
  if !t.alive {
    return self.input
  }
  self.input.fire = false
  self.gate_track = false
  self.percept_t -= dt
  if self.percept_t <= 0.0 {
    self.percept_t = cfg.ai.perception_interval
    self.perceive(world)
  }
  if self.react_t > 0.0 {
    self.react_t -= dt
  }
  // 导航参考点: 看得见用真实位置, 看不见用最后已知位置
  let player_nav = nearest_plain(world, t)
  let ref_t : RefT? = if self.seen_now {
    match player_nav {
      Some(pn) => if pn.alive { Some(RT(pn)) } else { None }
      None => None
    }
  } else {
    match self.last_seen {
      Some(ls) => Some(RS(ls))
      None =>
        match player_nav {
          Some(pn) => Some(RT(pn))
          None => None
        }
    }
  }
  let dist_p = match ref_t {
    Some(r) => dist2d(t.x, t.z, r.x(), r.z())
    None => 1.0e9
  }
  let to_player_yaw = match ref_t {
    Some(r) => @math.atan2(r.x() - t.x, r.z() - t.z)
    None => t.yaw
  }
  // 角色分工(G3): 全队共读 teamMemo
  self.memo = if cfg.ai.role_on != 0 && self.g_gate {
    Some(team_memo(world, ctx))
  } else {
    None
  }
  self.role = match self.memo {
    Some(m) => Some(m.roles.get(key_of(t, world)).unwrap_or("flank"))
    None => None
  }
  // 站位闩锁
  let st_new : St? = match self.memo {
    Some(m) => m.stations.get(key_of(t, world)).bind(fn(x) { x })
    None => None
  }
  let latch_ok = match self.st_latch {
    None => false
    Some(l) => {
      let role_ok = l.role == self.role
      let los_ok = match self.memo {
        None => true
        Some(m) =>
          match m.threat {
            None => true
            Some(th) => los_clear(world, l.x, l.z, th.x, th.z)
          }
      }
      let dist_ok = match st_new {
        None => true
        Some(sn) => dist2d(sn.x, sn.z, l.x, l.z) < 60.0
      }
      role_ok && los_ok && dist_ok
    }
  }
  if latch_ok {
    self.station = match self.st_latch {
      Some(l) =>
        Some({ x: l.x, z: l.z, side: None, d: None, deg: None, sc: None, })
      None => None
    }
  } else {
    self.station = st_new
    self.st_latch = match st_new {
      Some(sn) => Some({ x: sn.x, z: sn.z, role: self.role, })
      None => None
    }
  }
  // 带插值(G3 展开)
  if self.g_weak && cfg.ai.role_on != 0 {
    // JS: classBand[t.spec.cls || 'MT'] || this.p.band(带插值处兜底=性格带)
    let cb = match t.spec.cls {
      "LT" => cfg.ai.band_lt
      "MT" => cfg.ai.band_mt
      "HT" => cfg.ai.band_ht
      "TD" => cfg.ai.band_td
      "SPG" => cfg.ai.band_spg
      _ => p.band
    }
    let k = if self.role is Some(_) { cfg.ai.role_band_mix } else { 0.5 }
    let mut b_lo = lerp(p.band.0, cb.0, k)
    let b_hi = lerp(p.band.1, cb.1, k)
    if self.role is Some(rl) && (rl == "second" || rl == "fallback") {
      b_lo *= 1.1
    }
    self.band = Some((b_lo, b_hi))
  } else {
    self.band = None
  }
  // 弱点选暴露面输入: rel = 敌车鼻向与(敌→我)方位的夹角
  let mut rel = 0.0
  if player is Some(pl) {
    if pl.alive {
      rel = ang_diff(pl.yaw, to_player_yaw + @math.PI).abs()
    }
  }
  // 换血判断(trade.on)
  let mut enemy_low = false
  let mut shy = false
  let mut strong = false
  if cfg.ai.trade_on != 0 && self.g_gate && player is Some(pl) && pl.alive {
    let pid = pl.net_id
    let hm = match self.hp_memo.get(pid) {
      Some(m) => m
      None => {
        let m : HpMemo = { hp: pl.hp, max: pl.hp, }
        self.hp_memo[pid] = m
        m
      }
    }
    hm.hp = pl.hp
    if pl.hp > hm.max {
      hm.max = pl.hp
    }
    enemy_low = pl.hp <= t.spec.gun.dmg * cfg.ai.trade_kill_mult
    let my_cls = t.spec.cls
    let foe_cls = pl.spec.cls
    let pen_mine = t.spec.gun.pen / cls_armor_of(cfg, foe_cls).max(1.0)
    let pen_foe = pl.spec.gun.pen / cls_armor_of(cfg, my_cls).max(1.0)
    let dpm_mine = t.spec.gun.dmg / t.spec.gun.reload.max(0.1)
    let dpm_foe = pl.spec.gun.dmg / pl.spec.gun.reload.max(0.1)
    let mut my_n = 0
    for e in world.enemies {
      if e.alive && e.ai is Some(_) {
        my_n += 1
      }
    }
    let mut foe_n = 1.0
    if world.mp_targets.length() > 0 {
      foe_n = 0.0
      for h in world.mp_targets {
        if h.alive {
          foe_n += 1.0
        }
      }
    } else {
      match world.player {
        Some(wp) => if !wp.alive { foe_n = 0.0 }
        None => ()
      }
    }
    let mg = cfg.ai.trade_bully_margin
    let r_arm = pen_mine / pen_foe.max(0.001)
    let r_dpm = dpm_mine / dpm_foe.max(0.001)
    let r_cnt = my_n.to_double() / foe_n.max(1.0)
    strong = !enemy_low &&
      r_cnt >= 1.0 / mg &&
      r_arm >= 1.0 / mg &&
      (r_dpm >= mg || r_arm * r_dpm * r_cnt >= cfg.ai.trade_bully_score)
    shy = !enemy_low &&
      !strong &&
      t.hp / t.spec.hp < hm.hp / hm.max.max(1.0) * cfg.ai.trade_shy_ratio
    if shy {
      let fresh = match self.shy_since {
        None => true
        Some(v) => v == 0.0
      }
      if fresh {
        self.shy_since = Some(world.time)
      }
      let since = self.shy_since.unwrap_or(0.0)
      if world.time - since > cfg.ai.trade_shy_max_s &&
        t.hp / t.spec.hp > p.retreat_hp + 0.1 {
        shy = false
      }
    } else {
      self.shy_since = Some(0.0)
    }
  }
  self.shy = shy
  self.strong = strong
  // --- 状态转移 ---
  if self.seen_now && self.state != "retreat" {
    if self.state != "combat" {
      self.gate_tries = 0
      self.gate_pt = None
      self.ang_side = if self.flank_slot > @math.PI { 1.0 } else { -1.0 }
      self.cover_phase = "none"
      self.cover_pt = None
      self.cover_peek = None
      self.hill_commit = false
    }
    self.state = "combat"
    self.alert_t = 0.0
    if t.hp / t.spec.hp < p.retreat_hp && self.retreat_t <= 0.0 && !enemy_low {
      self.state = "retreat"
      self.retreat_t = 8.0
    }
  } else if self.state == "combat" && !self.seen_now {
    // 藏相装填期对记忆超时的抑制
    let mem_ext = if self.cover_phase != "none" {
      if t.reload_t > 0.0 {
        1.0e9
      } else {
        cfg.ai.cover_suppress_memory_timeout
      }
    } else {
      0.0
    }
    let expired = match self.last_seen {
      None => true
      Some(ls) => world.time - ls.t > cfg.ai.memory_time + mem_ext
    }
    if expired {
      self.state = "alert"
    }
  } else if self.state == "patrol" && self.heard is Some(_) {
    self.state = "alert"
  }
  if self.state == "retreat" {
    self.retreat_t -= dt
    if self.retreat_t <= 0.0 {
      self.state = "combat"
    }
  }
  // --- 各状态行为 ---
  let mut aim_at : AimPt? = None
  let mut face_yaw : Double? = None
  self.preaim_yaw = None
  self.advancing = false
  if self.state == "patrol" {
    if self.patrol.length() > 0 {
      let w = self.patrol[self.wp]
      self.navigate(w.x, w.z, dt, world)
      if dist2d(t.x, t.z, w.x, w.z) < 5.0 {
        self.wp = (self.wp + 1) % self.patrol.length()
      }
    } else {
      self.input.throttle = 0.0
      self.input.steer = 0.0
    }
    self.input.aim_yaw = t.yaw
    self.input.aim_pitch = 0.02
  } else if self.state == "alert" {
    if self.alert_t == 0.0 {
      self.alert_t = world.time
    }
    // 情报源: 取最新更新的(lastSeen / heard / intel)
    let cands : Array[AlertCand] = []
    match self.last_seen {
      Some(ls) => cands.push(CSeen(ls))
      None => ()
    }
    match self.heard {
      Some(h) => cands.push(CHeard(h))
      None => ()
    }
    if world.intel.level > 0 {
      cands.push(CIntel)
    }
    stable_sort_by(cands, fn(a, b) { b.t_of(world) - a.t_of(world) })
    // JS: const tgt = cands[0] || this.home
    let tgt_x = if cands.length() > 0 {
      cands[0].x_of(world)
    } else {
      self.home.x
    }
    let tgt_z = if cands.length() > 0 {
      cands[0].z_of(world)
    } else {
      self.home.z
    }
    let intel_fresh = world.intel.level > 0 &&
      world.time - world.intel.t < cfg.ai.search_time
    let intel_fresh2 = world.intel.level == 2 &&
      world.time - world.intel.t < 8.0
    let hurt_recent = match self.hurt_t {
      Some(ht) => ht != 0.0 && world.time - ht < 12.0
      None => false
    }
    let hold_hold = self.hold &&
      !hurt_recent &&
      !(intel_fresh2 && world.time - self.alert_t > 4.0)
    if hold_hold {
      self.input.throttle = 0.0
      self.input.steer = 0.0
      self.input.aim_yaw = @math.atan2(tgt_x - t.x, tgt_z - t.z)
      self.input.aim_pitch = 0.02
    } else if intel_fresh2 && !self.hold {
      // 协同突入: 确认接触且情报新鲜
      let mut rank = 0
      let my_d = dist2d(t.x, t.z, tgt_x, tgt_z)
      for o in world.enemies {
        let skip = o.uid == t.uid || !o.alive
        let o_in_combat = match o.ai {
          Some(a) => a.state == "combat"
          None => true
        }
        if skip || o_in_combat {
          continue
        }
        let od = dist2d(o.x, o.z, tgt_x, tgt_z)
        if od < my_d ||
          (od == my_d && o.ai.unwrap().flank_slot < self.flank_slot) {
          rank += 1
        }
      }
      if self.memo is Some(_) {
        if t.spec.cls == "TD" {
          rank += cfg.ai.role_td_rank_bias
        } else if t.spec.cls == "HT" {
          rank += cfg.ai.role_ht_rank_bias
        }
      }
      let re_rank = match self.intel_t {
        None => true
        Some(it) => world.intel.t > it + 0.5
      }
      if re_rank {
        self.intel_t = Some(world.intel.t)
        self.push_at = Some(world.time + rank.to_double() * 2.5)
      }
      if world.time >= self.push_at.unwrap_or(0.0) || hurt_recent {
        self.preaim_yaw = Some(@math.atan2(tgt_x - t.x, tgt_z - t.z))
        self.advancing = true
        // 同路集中(G9-⑤): 后车贴领车车辙纵队
        let mut push_x = tgt_x
        let mut push_z = tgt_z
        if rank > 0 && cfg.ai.tac_lane_on != 0 {
          let mut lead : Tank? = None
          let mut ld = dist2d(t.x, t.z, tgt_x, tgt_z)
          for o in world.enemies {
            if o.uid == t.uid || !o.alive {
              continue
            }
            if o.ai is None {
              continue
            }
            let od = dist2d(o.x, o.z, tgt_x, tgt_z)
            if od < ld {
              ld = od
              lead = Some(o)
            }
          }
          if lead is Some(l) {
            let dl = 1.0.max(ld)
            push_x = l.x - (tgt_x - l.x) / dl * 18.0
            push_z = l.z - (tgt_z - l.z) / dl * 18.0
          }
        }
        self.navigate(push_x, push_z, dt, world)
        self.input.aim_yaw = self.preaim_yaw.unwrap()
        self.input.aim_pitch = 0.02
      } else {
        // 等待突入次序: 压到自己的环位, 炮口始终瞄准情报点
        let (bx, bz) = match self.station {
          Some(stn) => (stn.x, stn.z)
          None => {
            let b0 = self.band_for()
            let ring_r = (b0.0 + b0.1) * 0.5
            (
              tgt_x + @math.sin(self.flank_slot) * ring_r,
              tgt_z + @math.cos(self.flank_slot) * ring_r,
            )
          }
        }
        if dist2d(t.x, t.z, bx, bz) > 10.0 {
          self.navigate(bx, bz, dt, world)
        } else {
          self.input.throttle = 0.0
          self.input.steer = 0.0
        }
        self.input.aim_yaw = @math.atan2(tgt_x - t.x, tgt_z - t.z)
        self.input.aim_pitch = 0.02
      }
    } else {
      // 有方法的围攻: 各车从自己的合围扇区接近
      let (bx, bz, ring_r) = match self.station {
        Some(stn) => (stn.x, stn.z, 90.0)
        None => {
          let b = self.band_for()
          let rr = if hurt_recent { b.0 * 0.7 } else { (b.0 + b.1) * 0.5 }
          let sx = tgt_x + @math.sin(self.flank_slot) * rr
          let sz = tgt_z + @math.cos(self.flank_slot) * rr
          (sx, sz, rr)
        }
      }
      if dist2d(t.x, t.z, bx, bz) > 12.0 {
        self.navigate(bx, bz, dt, world)
      } else if self.station is Some(_) {
        self.input.throttle = 0.0
        self.input.steer = 0.0
      } else {
        // 包围圈就位仍未接触: 围绕情报点游走搜索
        self.search_t -= dt
        if self.search_t <= 0.0 || self.search_pt is None {
          self.search_t = 3.5 + ctx.rand() * 3.5
          let rr = if ctx.rand() < 0.5 { ring_r * 0.55 } else { ring_r }
          self.search_pt = Some({
            x: clamp(tgt_x + (ctx.rand() - 0.5) * 2.0 * rr, -430.0, 430.0),
            z: clamp(tgt_z + (ctx.rand() - 0.5) * 2.0 * rr, -430.0, 430.0),
          })
        }
        let sp = self.search_pt.unwrap()
        self.navigate(sp.x, sp.z, dt, world)
      }
      self.input.aim_yaw = @math.atan2(tgt_x - t.x, tgt_z - t.z)
      self.input.aim_pitch = 0.02
      self.preaim_yaw = Some(self.input.aim_yaw)
    }
    // 搜剿超时仍无果 → 回归巡逻
    if !self.seen_now &&
      !intel_fresh &&
      world.time - self.alert_t > cfg.ai.search_time {
      self.alert_t = 0.0
      self.search_t = 0.0
      self.search_pt = None
      self.heard = None
      self.push_at = None
      self.state = "patrol"
    }
  } else if self.state == "combat" {
    // 交战态
    aim_at = match self.last_seen {
      Some(ls) => Some({ x: ls.x, z: ls.z, vx: ls.vx, vz: ls.vz, })
      None =>
        Some({ x: ref_t.unwrap().x(), z: ref_t.unwrap().z(), vx: 0.0, vz: 0.0, })
    }
    match aim_at {
      Some(at) => {
        let fl = dist_p / t.spec.gun.speed
        self.preaim_yaw = Some(
          @math.atan2(
            at.x + js_or0v(at.vx) * fl * p.lead_skill - t.x,
            at.z + js_or0v(at.vz) * fl * p.lead_skill - t.z,
          ),
        )
      }
      None => ()
    }
    let band = self.band_for()
    let lo = band.0
    let hi = band.1
    self.reposition_t -= dt
    // 穿深门(weakpoint.on)
    let tgt_cls = match player {
      Some(pl) => pl.spec.cls
      None => "MT"
    }
    let gated = cfg.ai.wp_on != 0 &&
      self.g_gate &&
      player is Some(pl) &&
      pl.alive &&
      t.spec.gun.pen < cls_armor_of(cfg, tgt_cls) * 0.95
    let mut gate_nav = false
    let mut nav_x = t.x
    let mut nav_z = t.z
    if gated && self.seen_now && rel <= SIDE_ARC {
      if self.gate_tries < 2 {
        let arrived = match self.gate_pt {
          Some(gp) => dist2d(t.x, t.z, gp.x, gp.z) < 6.0
          None => false
        }
        let need = self.gate_pt is None ||
          arrived ||
          world.time - self.gate_pt_t > 7.0
        if need {
          self.gate_pt = Some(self.repos_pt(world, ref_t.unwrap(), dist_p))
          self.gate_tries += 1
          self.gate_pt_t = world.time
          self.flank_plan_t = world.time + 4.0
        }
        nav_x = self.gate_pt.unwrap().x
        nav_z = self.gate_pt.unwrap().z
        gate_nav = true
      } else {
        // 兑底第③步: 履带次选一发 + 继续换位循环
        self.gate_track = world.time - self.track_t >
          t.spec.gun.reload + cfg.ai.wp_track_quota_s
        if self.gate_pt is None || self.reposition_t <= 0.0 {
          self.reposition_t = 5.0 + ctx.rand() * 5.0
          self.gate_pt = Some(self.repos_pt(world, ref_t.unwrap(), dist_p))
          self.gate_pt_t = world.time
          self.flank_plan_t = world.time + 4.0
        }
        nav_x = self.gate_pt.unwrap().x
        nav_z = self.gate_pt.unwrap().z
        gate_nav = true
      }
    } else {
      self.gate_pt = None
      self.gate_track = false
    }
    // 战术路由(G9)
    if cfg.ai.tac_on != 0 && self.g_gate {
      self.tactic_route(world, ref_t, dist_p, dt, lo, hi, gated)
    } else {
      self.tactic = "legacy"
    }
    let cf_go = self.tactic == "coverFlank" &&
      self.cf_pt is Some(_) &&
      !self.hold
    if !gate_nav {
      // 角色分工导航(G3)三层
      let in_band = dist_p >= lo && dist_p <= hi
      let blind_hold = self.station is Some(_) &&
        self.g_win &&
        cfg.ai.fd_on != 0 &&
        !self.win_open &&
        t.reload_t <= 0.0 &&
        self.seen_now &&
        in_band
      let line_push = blind_hold &&
        (self.role is Some(rl) && (rl == "line" || rl == "fallback")) &&
        dist_p > hi * 0.85
      let hill_go = self.tactic == "hillAssault" && self.hill_auth
      if self.hill_commit {
        let crest = world.terrain.height_at(t.x, t.z) >=
          world.terrain.height_at(ref_t.unwrap().x(), ref_t.unwrap().z()) - 2.0
        let stop = match ref_t {
          None => true
          Some(r) => !r.alive()
        }
        if stop || crest || t.hp < t.spec.hp * (p.retreat_hp + 0.05) {
          self.hill_commit = false
        } else {
          self.advancing = true
          nav_x = ref_t.unwrap().x()
          nav_z = ref_t.unwrap().z()
        }
      } else if hill_go && world.time >= self.hill_go_t {
        self.hill_commit = true
        self.advancing = true
        nav_x = ref_t.unwrap().x()
        nav_z = ref_t.unwrap().z()
      } else if hill_go {
        nav_x = t.x
        nav_z = t.z
      } else if cf_go {
        self.advancing = true
        let cp = self.cf_pt.unwrap()
        nav_x = cp.x
        nav_z = cp.z
      } else if (dist_p > hi || line_push) && !self.hold {
        self.advancing = true
        let k = (dist_p - hi * 0.85) / dist_p * (if shy { 0.5 } else { 1.0 })
        nav_x = t.x + (ref_t.unwrap().x() - t.x) * k
        nav_z = t.z + (ref_t.unwrap().z() - t.z) * k
        let hop = self.chain_hop(world, ref_t.unwrap(), dist_p, dt)
        if hop is Some(h) {
          nav_x = h.x
          nav_z = h.z
        }
      } else if dist_p < lo {
        let k = (lo * 1.15 - dist_p) / dist_p.max(1.0)
        nav_x = t.x - (ref_t.unwrap().x() - t.x) * k
        nav_z = t.z - (ref_t.unwrap().z() - t.z) * k
      } else if (enemy_low || strong) && dist_p > lo * 1.1 {
        let k = (dist_p - lo) / dist_p
        nav_x = t.x + (ref_t.unwrap().x() - t.x) * k
        nav_z = t.z + (ref_t.unwrap().z() - t.z) * k
      } else if self.station is Some(stn) && blind_hold && !line_push {
        if self.reposition_t <= 0.0 {
          self.reposition_t = 2.0 + ctx.rand() * 2.0
          let bx = stn.x - ref_t.unwrap().x()
          let bz = stn.z - ref_t.unwrap().z()
          let bl0 = @math.hypot(bx, bz)
          let bl2 = if bl0 > 0.0 { bl0 } else { 1.0 }
          let side : Int = if key_of(t, world) % 2 == 0 { 1 } else { -1 }
          nav_x = stn.x - bz / bl2 * 12.0 * side.to_double()
          nav_z = stn.z + bx / bl2 * 12.0 * side.to_double()
        } else {
          nav_x = stn.x
          nav_z = stn.z
        }
      } else if self.station is Some(stn) {
        if dist2d(t.x, t.z, stn.x, stn.z) > 12.0 {
          nav_x = stn.x
          nav_z = stn.z
        } else if self.reposition_t <= 0.0 {
          self.reposition_t = (9.0 + ctx.rand() * 8.0) *
            (if shy { cfg.ai.trade_shy_hold_mul } else { 1.0 })
          nav_x = stn.x + (ctx.rand() - 0.5) * 16.0
          nav_z = stn.z + (ctx.rand() - 0.5) * 16.0
        }
      } else if self.reposition_t <= 0.0 {
        self.reposition_t = (5.0 + ctx.rand() * 6.0) *
          (if shy { cfg.ai.trade_shy_hold_mul } else { 1.0 })
        if ctx.rand() < p.flank_chance {
          // 绕侧: 合围扇区定方向
          let side : Double = if self.flank_slot > @math.PI {
            1.0
          } else {
            -1.0
          }
          let px = -(ref_t.unwrap().z() - t.z)
          let pz = ref_t.unwrap().x() - t.x
          let pl = @math.hypot(px, pz)
          nav_x = t.x + px / pl * 35.0 * side
          nav_z = t.z + pz / pl * 35.0 * side
          self.flank_plan_t = world.time + 4.0
        } else {
          nav_x = t.x + (ctx.rand() - 0.5) * 24.0
          nav_z = t.z + (ctx.rand() - 0.5) * 24.0
          self.rev_pulse_ok = true
        }
      }
    }
    // 掩体伸缩循环(G2)相位机
    if cfg.ai.cover_on != 0 &&
      self.g_peek &&
      !gate_nav &&
      ref_t is Some(_) &&
      !self.hill_commit &&
      !cf_go {
      self.cover_step(world, ref_t, dist_p, dt, lo, enemy_low)
    } else if self.cover_phase != "none" {
      self.cover_phase = "none"
      self.cover_pt = None
      self.cover_peek = None
    }
    // hold 单位: 30m 圈钳(伸缩短途出位豁免)
    if self.hold && self.cover_phase == "none" && self.station is None {
      let d_home = dist2d(nav_x, nav_z, self.home.x, self.home.z)
      if d_home > 30.0 {
        let k = 30.0 / d_home
        nav_x = self.home.x + (nav_x - self.home.x) * k
        nav_z = self.home.z + (nav_z - self.home.z) * k
      }
    }
    // 歼击车锁敌门(到驾驶目标才锁)
    let nav_arr = dist2d(t.x, t.z, nav_x, nav_z) < 6.0
    face_yaw = if t.parts_no_turret {
      if (self.ang_use > 0.0 && t.speed.abs() >= 1.5) || !nav_arr {
        None
      } else {
        Some(to_player_yaw)
      }
    } else {
      None
    }
    // 藏相驾驶三级(方向感知)
    if self.cover_phase == "hide" && self.cover_pt is Some(cp) {
      let d_h = dist2d(t.x, t.z, cp.x, cp.z)
      let facing = ang_diff(t.yaw, @math.atan2(cp.x - t.x, cp.z - t.z)).abs() <
        1.6
      let rev_blocked = w_nearest_cover_between(world, t.x, t.z, cp.x, cp.z)
        is Some(_)
      if d_h > 5.0 && facing {
        let vx = cp.x + (cp.x - t.x) / d_h * 4.0
        let vz = cp.z + (cp.z - t.z) / d_h * 4.0
        self.navigate(vx, vz, dt, world)
      } else if d_h > 5.0 && !facing && rev_blocked {
        let vx = cp.x + (cp.x - t.x) / d_h * 4.0
        let vz = cp.z + (cp.z - t.z) / d_h * 4.0
        self.navigate(vx, vz, dt, world)
      } else {
        let _ = self.hide_drive(cp.x, cp.z, dt, world, ref_t.unwrap())
        if d_h > 3.0 && t.speed.abs() < 0.3 {
          self.hide_stuck_t = Some(js_or0(self.hide_stuck_t) + dt)
        } else {
          self.hide_stuck_t = Some(0.0)
        }
        if js_or0(self.hide_stuck_t) > 1.5 {
          self.cover_phase = "none"
          self.cover_pt = None
          self.cover_peek = None
          self.hide_stuck_t = Some(0.0)
          self.cover_t = 1.5
        }
      }
    } else if self.cover_phase == "peek" && self.cover_peek is Some(ck) {
      nav_x = ck.x
      nav_z = ck.z
      if t.parts_no_turret {
        face_yaw = Some(to_player_yaw)
      }
    }
    // 倒车转移(G9-①, 收窄版)
    let mut rev_pulse = false
    if self.rev_pulse_ok &&
      t.reload_t > 0.0 &&
      self.cover_phase == "none" &&
      !gate_nav &&
      !self.cover_spot_ok &&
      self.seen_now &&
      ref_t is Some(_) {
      let d_n = dist2d(t.x, t.z, nav_x, nav_z)
      if d_n > 3.0 &&
        d_n < 25.0 &&
        ang_diff(t.yaw, @math.atan2(nav_x - t.x, nav_z - t.z)).abs() > 1.75 {
        let _ = self.hide_drive(nav_x, nav_z, dt, world, ref_t.unwrap())
        rev_pulse = true
      }
    }
    self.rev_pulse_ok = false
    if self.cover_phase != "hide" && !rev_pulse {
      self.navigate(nav_x, nav_z, dt, world, face_yaw?)
    }
    // 停车即射(settle)
    let al = t.spec.gun.autoloader
    let drive_by = self.cover_phase == "none" &&
      self.win_open &&
      t.reload_t <= 0.0 &&
      dist_p >= lo * 0.75 &&
      dist_p <= hi * 1.15
    let want_settle = cfg.ai.fd_on != 0 &&
      self.g_win &&
      !gate_nav &&
      self.cover_phase == "none" &&
      !self.hill_commit &&
      !cf_go &&
      (p.aim_patience >= 0.85 || drive_by) &&
      (self.win_open || dist_p < (lo * 1.2).min(70.0)) &&
      dist_p <= hi * 1.15 &&
      dist_p >= lo * 0.75 &&
      t.reload_t <= t.spec.gun.reload * self.max_frac_reload &&
      al is None
    if self.settle_cd > 0.0 {
      self.settle_cd -= dt
    }
    if !want_settle {
      self.settle_t = -1.0
    } else if self.settle_t < 0.0 && self.settle_cd <= 0.0 {
      self.settle_t = cfg.ai.fd_settle_s
    }
    if self.settle_t >= 0.0 {
      self.settle_t -= dt
      self.input.throttle = 0.0
      if !t.parts_no_turret {
        self.input.steer = 0.0
      }
      if self.settle_t < 0.0 {
        self.settle_cd = if self.win_open { 0.0 } else { 0.8 }
      }
    }
    // 装填期摆角度(G2/G5 分时窗)
    let peek_swing_ok = self.cover_phase != "peek"
    let far_off_ang = ang_diff(
        t.yaw,
        to_player_yaw +
        self.ang_side *
        self.ang_use *
        (if t.parts_no_turret { self.td_mul } else { 1.0 }),
      ).abs() >
      0.44
    let frac_cls = if self.cover_spot_ok {
      hide_frac_cls(ctx, t.spec.cls)
    } else {
      0.0
    }
    let tw_ang = t.reload_t > t.spec.gun.reload * frac_cls ||
      t.reload_t > self.straighten_lead + 0.2
    let turret_chase = ang_diff(t.turret_yaw, self.input.aim_yaw).abs() >= 0.05
    let angling = self.ang_use > 0.0 &&
      self.seen_now &&
      t.speed.abs() < 1.5 &&
      !gate_nav &&
      self.cover_phase == "none" &&
      peek_swing_ok &&
      self.settle_t < 0.0 &&
      !(dist_p > hi && !self.hold) &&
      dist_p >= lo * 0.8 &&
      (tw_ang || far_off_ang) &&
      (
        t.reload_t > 0.05 ||
        !self.win_open ||
        t.disp > 1.1 ||
        self.react_t > 0.0 ||
        turret_chase ||
        ang_diff(t.yaw, to_player_yaw).abs() > 0.5
      )
    if angling {
      self.input.throttle = 0.0
      let ang_tgt = to_player_yaw +
        self.ang_side *
        self.ang_use *
        (if t.parts_no_turret { self.td_mul } else { 1.0 })
      if t.parts_no_turret && t.reload_t <= self.straighten_lead + 0.2 {
        // 歼击车回正期: 死区内 steer 硬 0
        let d_a = ang_diff(t.yaw, to_player_yaw)
        self.input.steer = if d_a.abs() < self.ang_dead {
          0.0
        } else {
          clamp(d_a * 2.5, -1.0, 1.0)
        }
      } else {
        self.input.steer = if t.parts_no_turret {
          clamp(ang_diff(t.yaw, ang_tgt) * 2.5, -1.0, 1.0)
        } else {
          clamp(ang_diff(t.yaw, ang_tgt) * 1.25, -0.5, 0.5)
        }
      }
    }
  } else if self.state == "retreat" {
    // 撤退: 对物理最近之敌算脱离向量; 撤向二线站位
    let nav_p = nearest_plain(world, t)
    aim_at = match self.last_seen {
      Some(ls) => Some({ x: ls.x, z: ls.z, vx: ls.vx, vz: ls.vz, })
      None =>
        Some({ x: player.unwrap().x, z: player.unwrap().z, vx: 0.0, vz: 0.0, })
    }
    let mut sec_stn : St? = None
    match self.memo {
      Some(m) =>
        for k in sorted_keys(m.roles) {
          if m.roles[k] != "second" {
            continue
          }
          match m.stations.get(k) {
            Some(Some(stn)) => {
              let m8_ok = match m.by_k.get(k) {
                Some(m8) => m8.alive && k != key_of(t, world)
                None => false
              }
              if m8_ok {
                sec_stn = Some(stn)
                break
              }
            }
            _ => continue
          }
        }
      None => ()
    }
    if sec_stn is Some(ss) {
      let k3 = 0.6
      self.navigate(t.x + (ss.x - t.x) * k3, t.z + (ss.z - t.z) * k3, dt, world)
    } else {
      let np = nav_p.unwrap()
      let cov = w_nearest_cover_between(world, np.x, np.z, t.x, t.z)
      let away_x = match cov {
        Some(c) => c.x + (t.x - c.x) * 0.4
        None => t.x + (t.x - np.x) * 0.4
      }
      let away_z = match cov {
        Some(c) => c.z + (t.z - c.z) * 0.4
        None => t.z + (t.z - np.z) * 0.4
      }
      self.navigate(away_x, away_z, dt, world)
    }
  }
  // --- 瞄准与开火(交战/撤退中均还击) ---
  if aim_at is Some(_) && player is Some(_) {
    let at = aim_at.unwrap()
    let pl = player.unwrap()
    if pl.alive {
      let flight_t = dist_p / t.spec.gun.speed
      let lead = p.lead_skill
      let pred_x = at.x + js_or0v(at.vx) * flight_t * lead
      let pred_z = at.z + js_or0v(at.vz) * flight_t * lead
      let gy = world.terrain.height_at(pl.x, pl.z)
      let quota_ok = world.time - self.track_t >
        t.spec.gun.reload + cfg.ai.wp_track_quota_s
      let track_aim = self.gate_track ||
        (
          cfg.ai.wp_on != 0 &&
          self.g_weak &&
          (world.time < self.flank_plan_t || js_or0v(pl.speed).abs() > 2.0) &&
          quota_ok
        )
      let mut ty = 0.0
      let zone_h = if track_aim {
        ty = gy + cfg.ai.wp_track_y
        0.55
      } else if cfg.ai.wp_on != 0 && self.g_weak {
        if rel < cfg.ai.wp_front_deg * @math.PI / 180.0 {
          ty = gy + cfg.ai.wp_low_y
          cfg.ai.wp_low_y
        } else if rel <= cfg.ai.wp_side_deg * @math.PI / 180.0 {
          ty = gy + cfg.ai.wp_side_y
          cfg.ai.wp_side_y
        } else {
          ty = gy + cfg.ai.wp_rear_y
          cfg.ai.wp_rear_y + 0.25
        }
      } else {
        let high_disc = p.aim_patience >= 0.85
        ty = gy + (if high_disc { 0.7 } else { 1.2 })
        if high_disc {
          0.7
        } else {
          1.2
        }
      }
      // 命中几何口径(G9-②b): 缩圈覆盖比
      let d_sp = t.spec.dispersion
      let gun_bad = if t.mod_gun > 0.0 {
        cfg.armor.gun_disp_penalty
      } else {
        1.0
      }
      let brawl = dist_p < self.band_for().0 * 1.2
      let disc_on = cfg.ai.fd_on != 0 && self.g_win
      let snap = disc_on &&
        self.win_open &&
        world.time - self.win_open_t < cfg.ai.fd_snap_s &&
        js_or0v(pl.speed).abs() > 1.5
      let k_cov = if brawl {
        2.0
      } else if snap {
        1.8
      } else {
        2.05 + 0.25 * (1.0 - p.aim_patience)
      }
      let fire_threshold = clamp(
          zone_h * k_cov * 100.0 / dist_p.max(1.0),
          d_sp.base * 1.08,
          d_sp.max,
        ) *
        gun_bad
      // 开火窗口状态机(R4-C 唯一链)
      self.input.aim_yaw = @math.atan2(pred_x - t.x, pred_z - t.z)
      let aimed = ang_diff(t.turret_yaw, self.input.aim_yaw).abs() < 0.05
      let ready_no_win = self.seen_now &&
        self.react_t <= 0.0 &&
        t.reload_t <= 0.0 &&
        t.disp < fire_threshold
      if !disc_on {
        self.win_open = true
      } else if !self.seen_now {
        if self.win_open {
          self.win_open = false
          self.win_since = Some(world.time)
        }
      } else if world.time - self.win_chk_t >= cfg.ai.fd_recheck_s ||
        (ready_no_win && aimed && !self.win_open) {
        self.win_chk_t = world.time
        let res = self.win_check(pred_x, pred_z, ty, gy, track_aim, world)
        ty = res.1
        self.win_edge(res.0, brawl, world)
      }
      self.aim_ty = ty
      let dy = ty - (t.y + 2.0)
      let dh = @math.hypot(pred_x - t.x, pred_z - t.z)
      self.input.aim_pitch = clamp(
        @math.atan2(dy, dh.max(1.0)),
        t.spec.gun_depression,
        t.spec.gun_elevation,
      )
      self.input.fire = self.seen_now &&
        self.react_t <= 0.0 &&
        aimed &&
        t.reload_t <= 0.0 &&
        t.disp < fire_threshold &&
        self.win_open
      if self.input.fire && track_aim {
        self.track_t = world.time
      }
      if self.input.fire {
        self.settle_t = -1.0
      }
    }
  }
  self.input
}

///|
/// clsArmor[cls] || 95(ai.js:1341/1527)
pub fn cls_armor_of(cfg : Cfg, cls : String) -> Double {
  match cls {
    "LT" => cfg.ai.cls_armor_lt
    "MT" => cfg.ai.cls_armor_mt
    "TD" => cfg.ai.cls_armor_td
    "HT" => cfg.ai.cls_armor_ht
    "SPG" => cfg.ai.cls_armor_spg
    _ => 95.0
  }
}
