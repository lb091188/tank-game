// ai.js 直译 · 主逻辑: SF.AI.update (ai.js:1272-1916)。逐段对照原文, 注释标小节名。

///|
/// SF.AI.update (ai.js:1273-1916): 感知节流 → 状态转移 → 各状态行为(巡逻/警戒/交战/撤退) →
/// 瞄准与开火。返回 this.input(JS 返回同一对象)。
pub fn Ai::update(self : Ai, dt : Double, world : World) -> Input {
  let t = self.tank
  let player = nearest_target(world, t)
  let p = self.p
  let u = ai_cfg
  if not(t.alive) {
    return self.input
  }
  self.input.fire = false
  self.gate_track = false // 履带次选豁免态只在战斗导航段重估
  self.percept_t -= dt
  if self.percept_t <= 0.0 {
    self.percept_t = u.perception_interval
    self.perceive(world)
  }
  if self.react_t > 0.0 {
    self.react_t -= dt
  }
  // 导航参考点: 看得见用真实位置, 看不见用最后已知位置(不偷读玩家坐标)
  let player_nav = nearest_plain(world, t)
  let ref_ : NavRef? = if self.seen_now &&
    player_nav is Some(_) &&
    player_nav.unwrap().alive() {
    player_nav
  } else {
    match self.last_seen {
      Some(ls) => Some(ls)
      None => player_nav
    }
  }
  let dist_p : Double = match ref_ {
    Some(r) => dist2d(t.x, t.z, r.x, r.z)
    None => 1.0e9
  }
  let to_player_yaw : Double = match ref_ {
    Some(r) => v8_atan2(r.x - t.x, r.z - t.z)
    None => t.yaw
  }
  // --- 角色分工(G3): 全队共读 teamMemo, 帧内缓存本车角色/站位/带 ---
  self.memo = if u.role_on != 0 && self.g_gate {
    Some(team_memo(world))
  } else {
    None
  }
  self.role = match self.memo {
    Some(m) => Some(m.roles.get(key_of(t, world)).unwrap_or("flank"))
    None => None
  }
  // 站位闩锁(吸到失效为止)
  let st_new : (Double, Double)? = match self.memo {
    Some(m) =>
      match m.stations.get(key_of(t, world)) {
        Some(st) => st
        None => None
      }
    None => None
  }
  let latch_ok = self.st_latch &&
    self.st_latch_role == self.role &&
    (match self.memo {
      Some(m) =>
        match m.threat {
          Some(th) =>
            los_clear(world, self.st_latch_x, self.st_latch_z, th.0, th.1)
          None => true
        }
      None => true
    }) &&
    (match st_new {
      Some(sn) => dist2d(sn.0, sn.1, self.st_latch_x, self.st_latch_z) < 60.0
      None => true
    })
  if latch_ok {
    self.station = Some((self.st_latch_x, self.st_latch_z))
  } else {
    self.station = st_new
    match st_new {
      Some(sn) => {
        self.st_latch_x = sn.0
        self.st_latch_z = sn.1
        self.st_latch_role = self.role
        self.st_latch = true
      }
      None => self.st_latch = false
    }
  }
  // 带插值(G3 展开)
  if self.g_weak && u.role_on != 0 {
    let cb = class_band_of(t.spec.cls)
    let k = if self.role is Some(_) { u.role_band_mix } else { 0.5 }
    let mut b_lo = lerp(p.band.0, cb.0, k)
    let b_hi = lerp(p.band.1, cb.1, k)
    if self.role == Some("second") || self.role == Some("fallback") {
      b_lo *= 1.1
    }
    self.band = Some((b_lo, b_hi))
  } else {
    self.band = None
  }
  // --- 弱点选暴露面输入: rel = 敌车鼻向与(敌→我)方位的夹角 ---
  let mut rel = 0.0 // 默认 0=正对
  match player {
    Some(pl) =>
      if pl.alive {
        rel = ang_diff(pl.yaw, to_player_yaw + @math.PI).abs()
      }
    None => ()
  }
  // --- 换血判断(trade.on) ---
  let mut enemy_low = false
  let mut shy = false
  let mut strong = false
  if u.trade_on != 0 &&
    self.g_gate &&
    player is Some(_) &&
    player.unwrap().alive {
    let pl = player.unwrap()
    let pid = pl.net_id
    // memo = this.hpMemo[pid] || (this.hpMemo[pid] = { hp, max })
    match self.hp_memo.get(pid) {
      None => self.hp_memo[pid] = (pl.hp, pl.hp)
      Some(_) => ()
    }
    let memo = self.hp_memo[pid]
    let memo_hp = pl.hp
    let memo_max = if pl.hp > memo.1 { pl.hp } else { memo.1 }
    self.hp_memo[pid] = (memo_hp, memo_max)
    enemy_low = pl.hp <= t.spec.gun.dmg * u.trade_kill_mult
    // 三账粗估: 装甲/射速/人数
    let my_cls = t.spec.cls
    let foe_cls = pl.spec.cls
    let pen_mine = t.spec.gun.pen /
      cls_armor_of(foe_cls).unwrap_or(95.0).max(1.0)
    let pen_foe = pl.spec.gun.pen /
      cls_armor_of(my_cls).unwrap_or(95.0).max(1.0)
    let dpm_mine = t.spec.gun.dmg / t.spec.gun.reload.max(1.0).max(0.1)
    let dpm_foe = pl.spec.gun.dmg / pl.spec.gun.reload.max(1.0).max(0.1)
    let mut my_n = 0
    for e in world.enemies {
      if e.alive && e.ai is Some(_) {
        my_n += 1
      }
    }
    let mut foe_n = 1
    if world.mp_targets.length() > 0 {
      foe_n = 0
      for h in world.mp_targets {
        if h.alive {
          foe_n += 1
        }
      }
    } else {
      match world.player {
        Some(hp) => if not(hp.alive) { foe_n = 0 }
        None => ()
      }
    }
    let mg = u.trade_bully_margin
    let r_arm = pen_mine / pen_foe.max(0.001)
    let r_dpm = dpm_mine / dpm_foe.max(0.001)
    let r_cnt = my_n.to_double() / foe_n.to_double().max(1.0)
    strong = not(enemy_low) &&
      r_cnt >= 1.0 / mg &&
      r_arm >= 1.0 / mg &&
      (r_dpm >= mg || r_arm * r_dpm * r_cnt >= u.trade_bully_score)
    // 劣势换血转保守(shyMaxS 止损豁免)
    shy = not(enemy_low) &&
      not(strong) &&
      t.hp / t.spec.hp < memo_hp / memo_max.max(1.0) * u.trade_shy_ratio
    if shy {
      if self.shy_since == 0.0 {
        self.shy_since = world.time_ref.val
      }
      if world.time_ref.val - self.shy_since > u.trade_shy_max_s &&
        t.hp / t.spec.hp > p.retreat_hp + 0.1 {
        shy = false
      }
    } else {
      self.shy_since = 0.0
    }
  }
  // --- 状态转移 ---
  if self.seen_now && self.state != "retreat" {
    if self.state != "combat" {
      // 新回合: 穿深门换位配额重置(上限 2 次/回合)等
      self.gate_tries = 0
      self.gate_pt = None
      self.ang_side = if self.flank_slot > @math.PI { 1.0 } else { -1.0 } // 摆边: 合围扇区奇偶定
      self.cover_phase = "none"
      self.cover_pt = None
      self.cover_peek = None
      self.hill_commit = false
    }
    self.state = "combat"
    self.alert_t = 0.0
    // 敌残血: 压制 retreatHp 撤退门
    if t.hp / t.spec.hp < p.retreat_hp &&
      self.retreat_t <= 0.0 &&
      not(enemy_low) {
      self.state = "retreat"
      self.retreat_t = 8.0
    }
  } else if self.state == "combat" && not(self.seen_now) {
    // 藏相装填期对记忆超时的抑制
    let mem_ext = if self.cover_phase != "none" {
      if t.reload_t > 0.0 {
        1.0e9
      } else {
        u.cover_suppress_memory_timeout
      }
    } else {
      0.0
    }
    let overdue = match self.last_seen {
      None => true
      Some(ls) => world.time_ref.val - ls.t > u.memory_time + mem_ext
    }
    if overdue {
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
  let mut aim_at : NavRef? = None
  let mut face_yaw : Double? = None
  self.preaim_yaw = None // 预瞄方位逐帧重置
  self.advancing = false // 推进导航标记逐帧重置
  if self.state == "patrol" {
    if self.patrol.length() > 0 {
      let w = self.patrol[self.wp]
      self.navigate(w.0, w.1, dt, world, None)
      if dist2d(t.x, t.z, w.0, w.1) < 5.0 {
        self.wp = (self.wp + 1) % self.patrol.length()
      }
    } else {
      self.input.throttle = 0.0
      self.input.steer = 0.0
    }
    // 巡逻时炮塔警戒朝向前方
    self.input.aim_yaw = t.yaw
    self.input.aim_pitch = 0.02
  } else if self.state == "alert" {
    if self.alert_t == 0.0 {
      self.alert_t = world.time_ref.val
    }
    // 情报源: 取最新更新的(目视 lastSeen / 听见 heard / 全队 intel)
    let cands : Array[NavRef] = []
    match self.last_seen {
      Some(ls) => cands.push(ls)
      None => ()
    }
    match self.heard {
      Some(h) => cands.push(h)
      None => ()
    }
    if world.intel.level > 0 {
      cands.push({
        x: world.intel.x,
        z: world.intel.z,
        vx: 0.0,
        vz: 0.0,
        t: world.intel.t,
        yaw: 0.0,
        tk: None,
      })
    }
    // cands.sort((a, b) => b.t - a.t)(稳定: 插入排序)
    let mut i = 1
    while i < cands.length() {
      let key = cands[i]
      let mut j = i - 1
      while j >= 0 && cands[j].t < key.t {
        cands[j + 1] = cands[j]
        j -= 1
      }
      cands[j + 1] = key
      i += 1
    }
    let tx = if cands.length() > 0 { cands[0].x } else { self.home_x }
    let tz = if cands.length() > 0 { cands[0].z } else { self.home_z }
    let intel_fresh = world.intel.level > 0 &&
      world.time_ref.val - world.intel.t < u.search_time
    let intel_fresh2 = world.intel.level == 2 &&
      world.time_ref.val - world.intel.t < 8.0
    let hurt_recent = self.hurt_t != 0.0 &&
      world.time_ref.val - self.hurt_t < 12.0
    // 守位单位: 敌情未确认只原地警戒
    let hold_hold = self.hold &&
      not(hurt_recent) &&
      not(intel_fresh2 && world.time_ref.val - self.alert_t > 4.0)
    if hold_hold {
      self.input.throttle = 0.0
      self.input.steer = 0.0
      self.input.aim_yaw = v8_atan2(tx - t.x, tz - t.z)
      self.input.aim_pitch = 0.02
    } else if intel_fresh2 && not(self.hold) {
      // --- 协同突入: 确认接触且情报新鲜 ---
      let mut rank = 0
      let my_d = dist2d(t.x, t.z, tx, tz)
      for o in world.enemies {
        if o.uid == t.uid ||
          not(o.alive) ||
          o.ai is None ||
          o.ai.unwrap().state == "combat" {
          continue
        }
        let od = dist2d(o.x, o.z, tx, tz)
        if od < my_d ||
          (od == my_d && o.ai.unwrap().flank_slot < self.flank_slot) {
          rank += 1
        }
      }
      // 角色排位修正(G3)
      match self.memo {
        Some(_) =>
          if t.spec.cls == "TD" {
            rank += u.role_td_rank_bias
          } else if t.spec.cls == "HT" {
            rank += u.role_ht_rank_bias
          }
        None => ()
      }
      if not(self.intel_t_has) || world.intel.t > self.intel_t + 0.5 {
        // 情报刷新 → 重新排突入次序
        self.intel_t = world.intel.t
        self.intel_t_has = true
        self.push_at = world.time_ref.val + rank.to_double() * 2.5
      }
      if world.time_ref.val >= self.push_at || hurt_recent {
        self.preaim_yaw = Some(v8_atan2(tx - t.x, tz - t.z)) // 预瞄纪律(G8)
        self.advancing = true
        // 同路集中(G9-⑤): 后车贴领车车辙纵队
        let mut push_x = tx
        let mut push_z = tz
        if rank > 0 && u.lane_on != 0 {
          let mut lead : Tank? = None
          let mut ld = dist2d(t.x, t.z, tx, tz)
          for o in world.enemies {
            if o.uid == t.uid || not(o.alive) || o.ai is None {
              continue
            }
            let od = dist2d(o.x, o.z, tx, tz)
            if od < ld {
              ld = od
              lead = Some(o)
            }
          }
          match lead {
            Some(l) => {
              let dl = 1.0.max(ld)
              push_x = l.x - (tx - l.x) / dl * 18.0
              push_z = l.z - (tz - l.z) / dl * 18.0
            }
            None => ()
          }
        }
        self.navigate(push_x, push_z, dt, world, None) // 直插情报点
        self.input.aim_yaw = self.preaim_yaw.unwrap()
        self.input.aim_pitch = 0.02
      } else {
        // 等待突入次序: 压到自己的环位, 炮口始终瞄准情报点
        let (bx, bz) = match self.station {
          Some(st) => (st.0, st.1)
          None => {
            let b0 = self.band_for()
            let ring_r = (b0.0 + b0.1) * 0.5
            (
              tx + v8_sin(self.flank_slot) * ring_r,
              tz + v8_cos(self.flank_slot) * ring_r,
            )
          }
        }
        if dist2d(t.x, t.z, bx, bz) > 10.0 {
          self.navigate(bx, bz, dt, world, None)
        } else {
          self.input.throttle = 0.0
          self.input.steer = 0.0
        }
        self.input.aim_yaw = v8_atan2(tx - t.x, tz - t.z)
        self.input.aim_pitch = 0.02
      }
    } else {
      // 有方法的围攻: 各车从自己的合围扇区接近
      let (bx, bz, ring_r) = match self.station {
        Some(st) => (st.0, st.1, 90.0)
        None => {
          let b = self.band_for()
          let rr = if hurt_recent { b.0 * 0.7 } else { (b.0 + b.1) * 0.5 }
          (
            tx + v8_sin(self.flank_slot) * rr,
            tz + v8_cos(self.flank_slot) * rr,
            rr,
          )
        }
      }
      if dist2d(t.x, t.z, bx, bz) > 12.0 {
        self.navigate(bx, bz, dt, world, None) // 环位接近不挂预瞄
      } else if self.station is Some(_) {
        self.input.throttle = 0.0
        self.input.steer = 0.0 // 角色站位者就位即守位
      } else {
        // 包围圈就位仍未接触: 围绕情报点游走搜索(偏向内圈)
        self.search_t -= dt
        if self.search_t <= 0.0 || self.search_pt is None {
          self.search_t = 3.5 + random() * 3.5
          let rr = if random() < 0.5 { ring_r * 0.55 } else { ring_r }
          self.search_pt = Some(
            (
              clamp(tx + (random() - 0.5) * 2.0 * rr, -430.0, 430.0),
              clamp(tz + (random() - 0.5) * 2.0 * rr, -430.0, 430.0),
            ),
          )
        }
        let sp = self.search_pt.unwrap()
        self.navigate(sp.0, sp.1, dt, world, None)
      }
      // 炮口压向情报点(边追边瞄)
      self.input.aim_yaw = v8_atan2(tx - t.x, tz - t.z)
      self.input.aim_pitch = 0.02
      self.preaim_yaw = Some(self.input.aim_yaw)
    }
    // 搜剿超时仍无果 → 回归巡逻
    if not(self.seen_now) &&
      not(intel_fresh) &&
      world.time_ref.val - self.alert_t > u.search_time {
      self.alert_t = 0.0
      self.search_t = 0.0
      self.search_pt = None
      self.heard = None
      self.push_at = 0.0
      self.state = "patrol"
    }
  } else if self.state == "combat" {
    // --- 交战(最长分支, 逐段对照原文) ---
    match self.last_seen {
      Some(ls) => aim_at = Some(ls)
      None =>
        match ref_ {
          Some(r) =>
            aim_at = Some({
              x: r.x,
              z: r.z,
              vx: 0.0,
              vz: 0.0,
              t: world.time_ref.val,
              yaw: r.yaw,
              tk: None,
            })
          None => ()
        }
    }
    // 预瞄方位(G8): 交战态全程炮口压着敌向预测位
    match aim_at {
      Some(a) => {
        let fl = dist_p / t.spec.gun.speed
        self.preaim_yaw = Some(
          v8_atan2(
            a.x + a.vx * fl * p.lead_skill - t.x,
            a.z + a.vz * fl * p.lead_skill - t.z,
          ),
        )
      }
      None => ()
    }
    let band = self.band_for()
    let lo = band.0
    let hi = band.1
    self.reposition_t -= dt
    // --- 穿深门(weakpoint.on) ---
    let tgt_cls = match player {
      Some(pl) => pl.spec.cls
      None => "MT"
    }
    let gated = u.weak_on != 0 &&
      self.g_gate &&
      player is Some(_) &&
      player.unwrap().alive &&
      t.spec.gun.pen < cls_armor_of(tgt_cls).unwrap_or(95.0) * 0.95
    let mut gate_nav = false
    let mut nav_x = t.x
    let mut nav_z = t.z
    if gated && self.seen_now && rel <= side_arc() {
      if self.gate_tries < 2 {
        let arrived = match self.gate_pt {
          Some(gp) => dist2d(t.x, t.z, gp.0, gp.1) < 6.0
          None => false
        }
        if self.gate_pt is None ||
          arrived ||
          world.time_ref.val - self.gate_pt_t > 7.0 {
          self.gate_pt = Some(self.repos_pt(world, ref_.unwrap(), dist_p))
          self.gate_tries += 1
          self.gate_pt_t = world.time_ref.val
          self.flank_plan_t = world.time_ref.val + 4.0 // 侧向行进中 = 绕侧计划
        }
        let gp = self.gate_pt.unwrap()
        nav_x = gp.0
        nav_z = gp.1
        gate_nav = true
      } else {
        // 兑底第③步: 履带次选一发, 同时继续换位循环(配额未恢复就不置豁免态)
        self.gate_track = world.time_ref.val - self.track_t >
          t.spec.gun.reload + u.weak_track_quota_s
        if self.gate_pt is None || self.reposition_t <= 0.0 {
          self.reposition_t = 5.0 + random() * 5.0
          self.gate_pt = Some(self.repos_pt(world, ref_.unwrap(), dist_p))
          self.gate_pt_t = world.time_ref.val
          self.flank_plan_t = world.time_ref.val + 4.0
        }
        let gp = self.gate_pt.unwrap()
        nav_x = gp.0
        nav_z = gp.1
        gate_nav = true
      }
    } else {
      self.gate_pt = None
      self.gate_track = false
    }
    // --- 战术路由(G9) ---
    if u.tactics_on != 0 && self.g_gate {
      self.tactic_route(world, ref_.unwrap(), dist_p, dt, hi, gated)
    } else {
      self.tactic = "legacy"
    }
    let cf_go = self.tactic == "coverFlank" &&
      self.cf_pt is Some(_) &&
      not(self.hold)
    if not(gate_nav) {
      // --- 角色分工导航(G3) ---
      let in_band = dist_p >= lo && dist_p <= hi
      let blind_hold = self.station is Some(_) &&
        self.g_win &&
        u.fd_on != 0 &&
        not(self.win_open) &&
        t.reload_t <= 0.0 &&
        self.seen_now &&
        in_band // 就绪+窗口关=熄火傻站
      let line_push = blind_hold &&
        (self.role == Some("line") || self.role == Some("fallback")) &&
        dist_p > hi * 0.85
      // --- 高地强袭驾驶(G9-⑦) ---
      let hill_go = self.tactic == "hillAssault" && self.hill_auth
      if self.hill_commit {
        // JS: if (!ref || !ref.alive || crest || ...) 弃转进
        let give_up = match ref_ {
          None => true
          Some(r) => {
            let crest = world.terrain.height_at(t.x, t.z) >=
              world.terrain.height_at(r.x, r.z) - 2.0
            not(r.alive()) || crest || t.hp < t.spec.hp * (p.retreat_hp + 0.05)
          }
        }
        if give_up {
          self.hill_commit = false
        } else {
          self.advancing = true
          nav_x = ref_.unwrap().x
          nav_z = ref_.unwrap().z
        }
      } else if hill_go && world.time_ref.val >= self.hill_go_t {
        self.hill_commit = true
        self.advancing = true
        nav_x = ref_.unwrap().x
        nav_z = ref_.unwrap().z
      } else if hill_go {
        nav_x = t.x
        nav_z = t.z // 集结待命: 停在坡脚
      } else if cf_go {
        // 绕掩体掏侧后(G9-④)
        self.advancing = true
        let cfp = self.cf_pt.unwrap()
        nav_x = cfp.0
        nav_z = cfp.1
      } else if (dist_p > hi || line_push) && not(self.hold) {
        // 太远: 前压; 顶线熄火也压回射界
        self.advancing = true // 预瞄纪律(G8)
        let k = (dist_p - hi * 0.85) / dist_p * (if shy { 0.5 } else { 1.0 })
        nav_x = t.x + (ref_.unwrap().x - t.x) * k
        nav_z = t.z + (ref_.unwrap().z - t.z) * k
        // 沿掩体链推进(G9-③)
        match self.chain_hop(world, ref_.unwrap(), dist_p, dt) {
          Some(hop) => {
            nav_x = hop.0
            nav_z = hop.1
          }
          None => ()
        }
      } else if dist_p < lo {
        // 太近: 拉开(混合带口径)
        let k = (lo * 1.15 - dist_p) / dist_p.max(1.0)
        nav_x = t.x - (ref_.unwrap().x - t.x) * k
        nav_z = t.z - (ref_.unwrap().z - t.z) * k
      } else if (enemy_low || strong) && dist_p > lo * 1.1 {
        // 敌残血/以大欺小: 带内压上
        let k = (dist_p - lo) / dist_p
        nav_x = t.x + (ref_.unwrap().x - t.x) * k
        nav_z = t.z + (ref_.unwrap().z - t.z) * k
      } else if self.station is Some(_) && blind_hold && not(line_push) {
        if self.reposition_t <= 0.0 {
          // 找射界脉冲: 同半径弧上横移, keyOf 奇偶定方向
          self.reposition_t = 2.0 + random() * 2.0
          let st = self.station.unwrap()
          let bx = st.0 - ref_.unwrap().x
          let bz = st.1 - ref_.unwrap().z
          let bl0 = @math.hypot(bx, bz)
          let bl = if bl0 > 0.0 { bl0 } else { 1.0 }
          let side : Double = if key_of(t, world) % 2 == 0 { 1.0 } else { -1.0 }
          nav_x = st.0 - bz / bl * 12.0 * side
          nav_z = st.1 + bx / bl * 12.0 * side
        } else {
          let st = self.station.unwrap()
          nav_x = st.0
          nav_z = st.1 // 脉冲间保持站住
        }
      } else if self.station is Some(_) {
        let st = self.station.unwrap()
        if dist2d(t.x, t.z, st.0, st.1) > 12.0 {
          nav_x = st.0
          nav_z = st.1
        } else if self.reposition_t <= 0.0 {
          // 就位后小幅度游动(±8m, 不离站)
          self.reposition_t = (9.0 + random() * 8.0) *
            (if shy { u.trade_shy_hold_mul } else { 1.0 })
          nav_x = st.0 + (random() - 0.5) * 16.0
          nav_z = st.1 + (random() - 0.5) * 16.0
        }
      } else if self.reposition_t <= 0.0 {
        // 距离合适: 时不时换位/绕侧
        self.reposition_t = (5.0 + random() * 6.0) *
          (if shy { u.trade_shy_hold_mul } else { 1.0 })
        if random() < p.flank_chance {
          // 绕侧方向按合围扇区定
          let side : Double = if self.flank_slot > @math.PI {
            1.0
          } else {
            -1.0
          }
          let r = ref_.unwrap()
          let px = -(r.z - t.z)
          let pz = r.x - t.x
          let pl0 = @math.hypot(px, pz)
          let pl = if pl0 > 0.0 { pl0 } else { 1.0 }
          nav_x = t.x + px / pl * 35.0 * side
          nav_z = t.z + pz / pl * 35.0 * side
          self.flank_plan_t = world.time_ref.val + 4.0 // 绕侧行进中
        } else {
          nav_x = t.x + (random() - 0.5) * 24.0
          nav_z = t.z + (random() - 0.5) * 24.0
          self.rev_pulse_ok = true // 随机换位脉冲(G9-①)
        }
      }
    }
    // --- 掩体伸缩循环(G2)相位机 ---
    if u.cover_on != 0 &&
      self.g_peek &&
      not(gate_nav) &&
      ref_ is Some(_) &&
      not(self.hill_commit) &&
      not(cf_go) {
      self.cover_step(world, ref_.unwrap(), dist_p, dt, lo, enemy_low)
    } else if self.cover_phase != "none" {
      self.cover_phase = "none"
      self.cover_pt = None
      self.cover_peek = None // 模块关/gateNav/无参照: 退循环
    }
    // hold 单位: 只在小范围内机动(伸缩循环短途出位豁免)
    if self.hold &&
      self.cover_phase == "none" &&
      self.station is None &&
      dist2d(nav_x, nav_z, self.home_x, self.home_z) > 30.0 {
      let k = 30.0 / dist2d(nav_x, nav_z, self.home_x, self.home_z)
      nav_x = self.home_x + (nav_x - self.home_x) * k
      nav_z = self.home_z + (nav_z - self.home_z) * k
    }
    // 歼击车需车体对准才能瞄准
    let nav_arr = dist2d(t.x, t.z, nav_x, nav_z) < 6.0
    face_yaw = if t.no_turret {
      if (self.ang_use > 0.0 && t.speed.abs() >= 1.5) || not(nav_arr) {
        None
      } else {
        Some(to_player_yaw)
      }
    } else {
      None
    }
    // 藏相驾驶三级(方向感知)
    if self.cover_phase == "hide" && self.cover_pt is Some(_) {
      let cpt = self.cover_pt.unwrap()
      let d_h = dist2d(t.x, t.z, cpt.0, cpt.1)
      let facing = ang_diff(t.yaw, v8_atan2(cpt.0 - t.x, cpt.1 - t.z)).abs() <
        1.6
      let rev_blocked = world.nearest_cover_between(t.x, t.z, cpt.0, cpt.1)
        is Some(_)
      if d_h > 5.0 && facing {
        let vx = cpt.0 + (cpt.0 - t.x) / d_h * 4.0
        let vz = cpt.1 + (cpt.1 - t.z) / d_h * 4.0
        self.navigate(vx, vz, dt, world, None)
      } else if d_h > 5.0 && not(facing) && rev_blocked {
        let vx = cpt.0 + (cpt.0 - t.x) / d_h * 4.0
        let vz = cpt.1 + (cpt.1 - t.z) / d_h * 4.0
        self.navigate(vx, vz, dt, world, None) // 背对且直线被拦: 绕行
      } else {
        let done = self.hide_drive(cpt.0, cpt.1, dt, world, ref_.unwrap())
        let _ = done
        if d_h > 3.0 && t.speed.abs() < 0.3 {
          self.hide_stuck_t += dt
        } else {
          self.hide_stuck_t = 0.0
        }
        if self.hide_stuck_t > 1.5 {
          self.cover_phase = "none"
          self.cover_pt = None
          self.cover_peek = None
          self.hide_stuck_t = 0.0
          self.cover_t = 1.5
        }
      }
    } else if self.cover_phase == "peek" && self.cover_peek is Some(_) {
      let pk = self.cover_peek.unwrap()
      nav_x = pk.0
      nav_z = pk.1
      if t.no_turret {
        face_yaw = Some(to_player_yaw) // 探出途中就把车头压向敌
      }
    }
    // 倒车转移(G9-①, 收窄版)
    let mut rev_pulse = false
    if self.rev_pulse_ok &&
      t.reload_t > 0.0 &&
      self.cover_phase == "none" &&
      not(gate_nav) &&
      not(self.cover_spot_ok) &&
      self.seen_now &&
      ref_ is Some(_) {
      let d_n = dist2d(t.x, t.z, nav_x, nav_z)
      if d_n > 3.0 &&
        d_n < 25.0 &&
        ang_diff(t.yaw, v8_atan2(nav_x - t.x, nav_z - t.z)).abs() > 1.75 {
        let _ = self.hide_drive(nav_x, nav_z, dt, world, ref_.unwrap())
        rev_pulse = true
      }
    }
    self.rev_pulse_ok = false // 逐帧重置
    if self.cover_phase != "hide" && not(rev_pulse) {
      self.navigate(nav_x, nav_z, dt, world, face_yaw)
    }
    // --- 停车即射(双钉 throttle+steer) ---
    let al = t.spec.gun.autoloader is Some(_)
    let drive_by = self.cover_phase == "none" &&
      self.win_open &&
      t.reload_t <= 0.0 &&
      dist_p >= lo * 0.75 &&
      dist_p <= hi * 1.15
    let want_settle = u.fd_on != 0 &&
      self.g_win &&
      not(gate_nav) &&
      self.cover_phase == "none" &&
      not(self.hill_commit) &&
      not(cf_go) &&
      (p.aim_patience >= 0.85 || drive_by) &&
      (self.win_open || dist_p < (lo * 1.2).min(70.0)) &&
      dist_p <= hi * 1.15 &&
      dist_p >= lo * 0.75 &&
      t.reload_t <=
      t.spec.gun.reload *
      (if self.max_frac_reload != 0.0 { self.max_frac_reload } else { 0.55 }) &&
      not(al)
    if self.settle_cd > 0.0 {
      self.settle_cd -= dt
    }
    if not(want_settle) {
      self.settle_t = -1.0
    } else if self.settle_t < 0.0 && self.settle_cd <= 0.0 {
      self.settle_t = u.fd_settle_s // 冷却已过才重新进停车
    }
    if self.settle_t >= 0.0 {
      self.settle_t -= dt
      self.input.throttle = 0.0
      if not(t.no_turret) {
        self.input.steer = 0.0 // 双钉里的"钉舵"只对有炮塔的车
      }
      if self.settle_t < 0.0 {
        self.settle_cd = if self.win_open { 0.0 } else { 0.8 }
      }
    }
    // --- 装填期摆角度(G2/G5) ---
    let peek_swing_ok = self.cover_phase != "peek" // 探相不摆
    let far_off_ang = ang_diff(
        t.yaw,
        to_player_yaw +
        self.ang_side *
        self.ang_use *
        (if t.no_turret { self.td_mul } else { 1.0 }),
      ).abs() >
      0.44
    let tw_ang = t.reload_t >
      t.spec.gun.reload *
      (if self.cover_spot_ok {
        hide_frac_cls_of(t.spec.cls).unwrap_or(0.6)
      } else {
        0.0
      }) ||
      t.reload_t > self.straighten_lead + 0.2
    let angling = self.ang_use > 0.0 &&
      self.seen_now &&
      t.speed.abs() < 1.5 &&
      not(gate_nav) &&
      self.cover_phase == "none" &&
      peek_swing_ok &&
      self.settle_t < 0.0 &&
      not(dist_p > hi && not(self.hold)) &&
      dist_p >= lo * 0.8 &&
      (tw_ang || far_off_ang) &&
      (
        t.reload_t > 0.05 ||
        not(self.win_open) ||
        t.disp > 1.1 ||
        self.react_t > 0 ||
        ang_diff(t.turret_yaw, self.input.aim_yaw).abs() >= 0.05 ||
        ang_diff(t.yaw, to_player_yaw).abs() > 0.5
      ) // 冻结条件
    if angling {
      self.input.throttle = 0.0 // 摆角期不动
      let ang_tgt = to_player_yaw +
        self.ang_side *
        self.ang_use *
        (if t.no_turret { self.td_mul } else { 1.0 })
      if t.no_turret && t.reload_t <= self.straighten_lead + 0.2 {
        // 歼击车回正期(G5①): 死区内 steer 硬 0
        let d_a = ang_diff(t.yaw, to_player_yaw)
        self.input.steer = if d_a.abs() < self.ang_dead {
          0.0
        } else {
          clamp(d_a * 2.5, -1.0, 1.0)
        }
      } else {
        // 摆出/保持: 舵量分档(歼击车全速, 有炮塔车半速)
        self.input.steer = if t.no_turret {
          clamp(ang_diff(t.yaw, ang_tgt) * 2.5, -1.0, 1.0)
        } else {
          clamp(ang_diff(t.yaw, ang_tgt) * 1.25, -0.5, 0.5)
        }
      }
    }
  } else if self.state == "retreat" {
    // --- 撤退: 对"物理最近之敌"算脱离向量; 撤向优先 second 站位方向(G6③) ---
    let nav_p = nearest_plain(world, t)
    match self.last_seen {
      Some(ls) => aim_at = Some(ls)
      None =>
        match player {
          Some(pl) =>
            aim_at = Some({
              x: pl.x,
              z: pl.z,
              vx: 0.0,
              vz: 0.0,
              t: world.time_ref.val,
              yaw: pl.yaw,
              tk: None,
            })
          None => ()
        }
    }
    let mut sec_stn : (Double, Double)? = None
    match self.memo {
      Some(m) =>
        for k in sorted_keys(m.roles) {
          if m.roles.get(k) != Some("second") {
            continue
          }
          match m.stations.get(k) {
            Some(Some(st)) => {
              let known_alive = match m.byk.get(k) {
                Some(tk) => tk.alive
                None => false
              }
              if known_alive && k != key_of(t, world) {
                sec_stn = Some(st)
                break
              }
            }
            _ => continue
          }
        }
      None => ()
    }
    match sec_stn {
      Some(st) => {
        // 撤到二线火力的 60% 处
        let k3 = 0.6
        self.navigate(
          t.x + (st.0 - t.x) * k3,
          t.z + (st.1 - t.z) * k3,
          dt,
          world,
          None,
        )
      }
      None =>
        match nav_p {
          Some(npv) => {
            let cov = world.nearest_cover_between(npv.x, npv.z, t.x, t.z)
            let away = match cov {
              Some(c) => (c.x + (t.x - c.x) * 0.4, c.z + (t.z - c.z) * 0.4)
              None => (t.x + (t.x - npv.x) * 0.4, t.z + (t.z - npv.z) * 0.4)
            }
            self.navigate(away.0, away.1, dt, world, None)
          }
          None => {
            // (JS navP null 会在 retreat 分支解引用抛错; coop 人类恒在, 不可达, 兜底原地)
            self.input.throttle = 0.0
            self.input.steer = 0.0
          }
        }
    }
  }
  // --- 瞄准与开火(交战/撤退中均还击) ---
  if aim_at is Some(_) && player is Some(_) && player.unwrap().alive {
    let a = aim_at.unwrap()
    let pl = player.unwrap()
    let flight_t = dist_p / t.spec.gun.speed
    let lead = p.lead_skill // 预判能力(性格差异)
    let pred_x = a.x + a.vx * flight_t * lead
    let pred_z = a.z + a.vz * flight_t * lead
    // 瞄点高度三选(weakpoint.on) + 履带次选(R4-B)
    let gy = world.terrain.height_at(pl.x, pl.z)
    let quota_ok = world.time_ref.val - self.track_t >
      t.spec.gun.reload + u.weak_track_quota_s
    let track_aim = self.gate_track ||
      (
        u.weak_on != 0 &&
        self.g_weak &&
        (world.time_ref.val < self.flank_plan_t || pl.speed.abs() > 2.0) &&
        quota_ok
      )
    // 瞄点高度三选(weakpoint.on)+ 履带次选(R4-B); 表达式化(MoonBit 无先声明后赋值)
    let weak_sel = u.weak_on != 0 && self.g_weak
    let front_hit = rel < u.weak_front_deg * @math.PI / 180.0
    let side_hit = rel <= u.weak_side_deg * @math.PI / 180.0
    let hh = if p.aim_patience >= 0.85 { 0.7 } else { 1.2 }
    let zone_h : Double = if track_aim {
      0.55 // 履带弹有效带=履带+下裙板
    } else if weak_sel {
      if front_hit {
        u.weak_low_y
      } else if side_hit {
        u.weak_side_y
      } else {
        u.weak_rear_y + 0.25 // 车尾含引擎舱: 瞄区放宽一档
      }
    } else {
      hh
    }
    let mut ty : Double = if track_aim {
      gy + u.weak_track_y
    } else if weak_sel {
      if front_hit {
        gy + u.weak_low_y
      } else if side_hit {
        gy + u.weak_side_y
      } else {
        gy + u.weak_rear_y
      }
    } else {
      gy + hh
    }
    // 命中几何口径(G9-②b): 圈线半径 vs 瞄区带高覆盖比
    let d = t.spec.dispersion
    let gun_bad = if t.mod_gun > 0.0 { armor_cfg.gun_disp_penalty } else { 1.0 }
    let brawl = dist_p < self.band_for().0 * 1.2
    let disc_on = u.fd_on != 0 && self.g_win
    let snap = disc_on &&
      self.win_open &&
      world.time_ref.val - self.win_open_t <
      (if u.fd_snap_s != 0.0 { u.fd_snap_s } else { 1.2 }) &&
      pl.speed.abs() > 1.5
    let k_cov = if brawl {
      2.0
    } else if snap {
      1.8
    } else {
      2.05 + 0.25 * (1.0 - p.aim_patience)
    }
    let fire_threshold = clamp(
        zone_h * k_cov * 100.0 / dist_p.max(1.0),
        d.base * 1.08,
        d.max,
      ) *
      gun_bad
    // 瞄向先落(aimYaw 与 ty 无关): aimed/就绪判据要在窗口链前备好
    self.input.aim_yaw = v8_atan2(pred_x - t.x, pred_z - t.z)
    let aimed = ang_diff(t.turret_yaw, self.input.aim_yaw).abs() < 0.05
    let ready_no_win = self.seen_now &&
      self.react_t <= 0.0 &&
      t.reload_t <= 0.0 &&
      t.disp < fire_threshold
    // 开火窗口状态机(R4-C): 复评两个触发口都过 _winCheck→_winEdge 唯一链
    if not(disc_on) {
      self.win_open = true // 模块关: 窗口恒开
    } else if not(self.seen_now) {
      if self.win_open {
        self.win_open = false
        self.win_since = Some(world.time_ref.val) // 开→关: 记隐藏起点
      }
    } else if world.time_ref.val - self.win_chk_t >= u.fd_recheck_s ||
      (ready_no_win && aimed && not(self.win_open)) {
      self.win_chk_t = world.time_ref.val
      let res = self.win_check(pred_x, pred_z, ty, gy, track_aim, world)
      ty = res.1 // (JS: ty = res.ty —— 抬升后的瞄点高度回写同一变量)
      self.win_edge(res.0, brawl, world)
    }
    self.aim_ty = ty // 单一事实源: 本帧最终瞄点高度
    let dy = ty - (t.y + 2.0)
    let dh = @math.hypot(pred_x - t.x, pred_z - t.z)
    self.input.aim_pitch = clamp(
      v8_atan2(dy, dh.max(1.0)),
      t.spec.gun_depression,
      t.spec.gun_elevation,
    )
    // 开火门: reactT 就地重读
    self.input.fire = self.seen_now &&
      self.react_t <= 0.0 &&
      aimed &&
      t.reload_t <= 0.0 &&
      t.disp < fire_threshold &&
      self.win_open
    if self.input.fire && track_aim {
      self.track_t = world.time_ref.val // 履带弹配额记账
    }
    if self.input.fire {
      self.settle_t = -1.0 // 开火即完成停车即射
    }
  }
  self.input
}
