// ai.js 直译 · 实例层: 构造器(SF.AI constructor)/onHurt/perceive/_focusCall/navigate/
// bandFor/_winRayClear/_winCheck/_winEdge/_gridHidden。注释标原函数名/行号。

///|
/// SF.AI constructor (ai.js:490-601)。def = { personality, patrol, hold? }。
pub fn ai_new(
  tank : Tank,
  personality : String,
  patrol : Array[(Double, Double)],
  hold : Bool,
) -> Ai {
  let u = ai_cfg
  let p = personality_of(personality) // this.p(JS personalities[def.personality] || flanker)
  let lvl = u.skill_level // SK.level === undefined ? 1 : SK.level
  // 装填期摆角唯一公式(G2)
  let ang_rad = clamp(
      p.angle_skill * u.angle_deg_mid,
      0.0,
      lerp(0.0, u.angle_deg_max, lvl),
    ) *
    @math.PI /
    180.0
  let h_t = 0.4.max(tank.spec.hull_traverse).max(0.05) // JS Math.max(hullTraverse || 0.4, 0.05)
  let budget = tank.spec.gun.reload.max(0.0) * u.angle_max_frac_of_reload // JS (reload || 3)
  let ang_use = if u.angle_on == 0 {
    0.0
  } else {
    ang_rad.min((budget - u.angle_settle_s).max(0.0) * h_t)
  }
  let straighten_lead = ang_use / h_t + u.angle_settle_s
  let rearm_s = lerp(0.05, 0.3, lvl)
  // patrol 映射(def.patrol || []).map(w => ({x: w[0], z: w[1]}))
  let this_input : Input = {
    throttle: 0.0,
    steer: 0.0,
    aim_yaw: tank.yaw,
    aim_pitch: 0.0,
    fire: false,
    hold_turret: false,
  }
  let ai : Ai = {
    tank,
    p,
    ang_rad,
    ang_use,
    straighten_lead,
    td_mul: u.angle_td_mul,
    ang_side: 1.0,
    ang_dead: u.angle_deadzone_deg * @math.PI / 180.0,
    max_frac_reload: u.angle_max_frac_of_reload,
    rearm_s,
    rearm_brawl_s: rearm_s * (u.fd_rearm_brawl_s / u.fd_rearm_s),
    g_weak: lvl >= 0.4,
    g_gate: lvl >= 0.6,
    g_win: lvl >= 0.6,
    g_peek: lvl >= 0.6,
    g_preaim: lvl >= 0.4,
    preaim_yaw: None,
    advancing: false,
    win_open: false,
    win_since: None,
    win_blk: 0,
    win_open_t: 0.0,
    win_chk_t: -9.0,
    tactic: "skirmish",
    tac_t: 0.0,
    hill_auth: false,
    hill_commit: false,
    hill_go_t: 0.0,
    hill_t: -99.0,
    cf_pt: None,
    cf_t: -9.0,
    rev_pulse_ok: false,
    settle_t: -1.0,
    settle_cd: 0.0,
    patrol,
    hold,
    home_x: tank.x,
    home_z: tank.z,
    state: "patrol",
    wp: 0,
    last_radio: -99.0,
    alert_t: 0.0,
    search_t: 0.0,
    search_pt: None,
    flank_slot: random() * @math.PI * 2.0,
    heard: None, // 合围扇区(构造掷骰 #1)
    input: this_input,
    seen: false,
    seen_now: false,
    react_t: 0.0,
    seen_any_t: -9.0,
    last_seen: None,
    last_target_id: 0,
    percept_t: random() * u.perception_interval, // 构造掷骰 #2
    reposition_t: 3.0 + random() * 4.0, // 构造掷骰 #3
    retreat_t: 0.0,
    unstuck_t: 0.0,
    stuck_t: 0.0,
    nav_yaw_jitter: 0.0,
    nav_path: None,
    nav_goal: None,
    nav_t: -9.0,
    nav_chk: -9.0,
    f_hpw: Map::new(),
    hp_memo: Map::new(),
    gate_tries: 0,
    gate_pt: None,
    gate_pt_t: -99.0,
    gate_track: false,
    flank_plan_t: -99.0,
    track_t: -99.0,
    aim_ty: 0.0,
    cover_phase: "none",
    cover_pt: None,
    cover_peek: None,
    peek_lead: 2.0,
    hide_frac: 0.6,
    cover_t: 0.0,
    cover_enter_t: -9.0,
    rev_stuck_t: 0.0,
    hide_chk_t: -9.0,
    cover_spot_ok: false,
    cover_face: 0.0,
    cover_has_face: false,
    cover_ref: None,
    hide_cov: false,
    hide_stuck_t: 0.0,
    station: None,
    st_latch_x: 0.0,
    st_latch_z: 0.0,
    st_latch_role: None,
    st_latch: false,
    role: None,
    band: None,
    memo: None,
    shy_since: 0.0,
    hurt_t: 0.0,
    intel_t: 0.0,
    intel_t_has: false,
    push_at: 0.0,
    chain_t: 0.0,
    chain_pt: None,
  }
  tank.ai = Some(ai)
  // 无线电: 友军发现/听见玩家 → 全队广播坐标(ai.js:559-563)
  g_bus.ai_radio.push(fn(e : RadioEv) {
    let self2 = ai
    if not(self2.tank.alive) ||
      e.from.uid == self2.tank.uid ||
      self2.state == "combat" {
      return
    }
    self2.heard = Some({
      x: e.x + (random() - 0.5) * 24.0,
      z: e.z + (random() - 0.5) * 24.0,
      vx: 0.0,
      vz: 0.0,
      t: game_world_time(),
      yaw: 0.0,
      tk: None,
    })
    if self2.state != "alert" {
      self2.state = "alert"
      self2.alert_t = game_world_time()
    }
  })
  // 听觉: 玩家开炮 → 炮声全图可闻(ai.js:592-600; 本链 srv-sim 开炮不经 Bus, 监听不触发)
  g_bus.fire.push(fn(e : BusFireEv) {
    let self2 = ai
    if self2.tank.alive && (e.tank.is_player || e.tank.team == 0) {
      let d = dist2d(self2.tank.x, self2.tank.z, e.tank.x, e.tank.z)
      if d < u.shot_hearing {
        let err = 14.0 + d * 0.06
        self2.heard = Some({
          x: e.tank.x + (random() - 0.5) * 2.0 * err,
          z: e.tank.z + (random() - 0.5) * 2.0 * err,
          vx: 0.0,
          vz: 0.0,
          t: game_world_time(),
          yaw: 0.0,
          tk: None,
        })
      }
    }
  })
  ai
}

///|
/// onHurt (ai.js:605-616): 被击中感知(冲击方向大致可判, 全队上报)
pub fn Ai::on_hurt(self : Ai, shooter : Tank) -> Unit {
  if not(self.tank.alive) || shooter.team == self.tank.team {
    return
  }
  let err = 20.0 + random() * 14.0
  let hx = shooter.x + (random() - 0.5) * 2.0 * err
  let hz = shooter.z + (random() - 0.5) * 2.0 * err
  self.heard = Some({
    x: hx,
    z: hz,
    vx: 0.0,
    vz: 0.0,
    t: game_world_time(),
    yaw: 0.0,
    tk: None,
  })
  self.hurt_t = game_world_time()
  match g_game_world.val {
    Some(w) => {
      w.intel.x = hx
      w.intel.z = hz
      w.intel.t = game_world_time()
      w.intel.level = 2
    }
    None => ()
  }
  if not(self.seen_now) {
    self.last_seen = Some({
      x: hx,
      z: hz,
      vx: 0.0,
      vz: 0.0,
      t: game_world_time(),
      yaw: 0.0,
      tk: None,
    })
  }
  bus_emit_ai_radio({ from: self.tank, x: hx, z: hz, }) // 呼叫支援(不限距离)
  if self.state == "patrol" {
    self.state = "alert"
    self.alert_t = game_world_time()
  }
}

///|
/// perceive (ai.js:619-645)
fn Ai::perceive(self : Ai, world : World) -> Unit {
  let player = nearest_target(world, self.tank)
  let was_seen = self.seen
  self.seen = false
  match player {
    Some(player) =>
      if player.alive {
        let d = dist2d(self.tank.x, self.tank.z, player.x, player.z)
        // 点亮(WoT): 50m 内无视遮挡强制点亮; 否则 视距×(1-目标隐蔽) + 点阵通视
        let vr = if self.tank.spec.view > 0.0 {
          self.tank.spec.view
        } else {
          ai_cfg.view_range
        }
        if d < 50.0 ||
          (
            d < vr * (1.0 - camo_of(player, world)) &&
            los_clear_any(world, self.tank, player, false, None)
          ) {
          self.seen = true
          self.last_seen = Some({
            x: player.x,
            z: player.z,
            vx: player.vel_x,
            vz: player.vel_z,
            t: world.time_ref.val,
            yaw: player.yaw,
            tk: None,
          })
          self.last_target_id = player.net_id
          // 目视确认 → 上报全队情报
          world.intel.x = player.x
          world.intel.z = player.z
          world.intel.t = world.time_ref.val
          world.intel.level = 2
          if not(was_seen) && self.state != "combat" {
            self.react_t = ai_cfg.reaction_time *
              (1.0 + (1.0 - self.p.aim_patience))
          }
          // 无线电呼叫支援(冷却)
          if world.time_ref.val - self.last_radio > ai_cfg.radio_cooldown {
            self.last_radio = world.time_ref.val
            bus_emit_ai_radio({ from: self.tank, x: player.x, z: player.z, })
          }
          self.focus_call(player, world, d)
        }
      }
    None => ()
  }
  self.seen_now = self.seen
  if self.seen {
    self.seen_any_t = world.time_ref.val
  }
}

///|
/// _focusCall (ai.js:656-679): 集火呼叫写入(仅 perceive 入口)
fn Ai::focus_call(self : Ai, tgt : Tank, world : World, d : Double) -> Unit {
  let fo = ai_cfg
  if fo.focus_on == 0 || not(tgt.alive) {
    return
  }
  let pid = tgt.net_id
  let now = world.time_ref.val
  // memo = this._fHpw[pid] || (this._fHpw[pid] = { hpw: tgt.hp })
  let hpw0 = match self.f_hpw.get(pid) {
    Some(v) => v
    None => {
      self.f_hpw[pid] = tgt.hp
      tgt.hp
    }
  }
  if tgt.hp > hpw0 {
    self.f_hpw[pid] = tgt.hp // 见过更高血即抬分母
  }
  let hpw = self.f_hpw[pid]
  // 距离项用"队心→目标"
  let mut cx = 0.0
  let mut cz = 0.0
  let mut cn = 0
  for e in world.enemies {
    if e.alive {
      cx += e.x
      cz += e.z
      cn += 1
    }
  }
  let dc = if cn > 0 {
    dist2d(cx / cn.to_double(), cz / cn.to_double(), tgt.x, tgt.z)
  } else {
    d
  }
  let mut sc = 0.7 * (1.0 - tgt.hp / hpw.max(1.0)) +
    0.3 * (1.0 - dc.min(400.0) / 400.0)
  if tgt.hp <=
    self.tank.spec.gun.dmg *
    (if fo.trade_kill_mult != 0.0 { fo.trade_kill_mult } else { 1.2 }) {
    sc = 1.0
  }
  let f_opt = world.focus
  let stale = match f_opt {
    None => true
    Some(f) => {
      let mut any = false
      for e in world.mp_targets {
        if e.alive && e.net_id == f.net_id {
          any = true
        }
      }
      now - f.t > fo.focus_memory_s || not(any)
    }
  }
  match f_opt {
    None => {
      world.focus = Some({ net_id: pid, t: now, hp: tgt.hp, hpw, sc, })
      return
    }
    Some(_) => ()
  }
  if stale {
    world.focus = Some({ net_id: pid, t: now, hp: tgt.hp, hpw, sc, })
    return
  }
  let f = world.focus.unwrap()
  if f.net_id == pid {
    f.t = now
    f.hp = tgt.hp
    f.sc = sc
    return // 同目标心跳免分差门
  }
  if not(now - f.t > fo.focus_update_s && sc > f.sc + 0.1) {
    return // 节流+分差
  }
  match world.focus_prev {
    Some(prev) =>
      if prev.net_id == pid && now < prev.until {
        return // 换靶冷却内不回切
      }
    None => ()
  }
  world.focus_prev = Some({ net_id: f.net_id, until: now + fo.focus_switch_s, })
  world.focus = Some({ net_id: pid, t: now, hp: tgt.hp, hpw, sc, })
}

///|
/// navigate (ai.js:682-749): 朝目标点输出油门/转向(卡死检测/路径绕行/陡坡与掩体回避/预瞄压舵)
fn Ai::navigate(
  self : Ai,
  px_in : Double,
  pz_in : Double,
  dt : Double,
  world : World,
  face_yaw : Double?,
) -> Unit {
  let t = self.tank
  let t_terrain = world.terrain
  let mut px = px_in
  let mut pz = pz_in
  // 卡死检测
  if self.input.throttle > 0.4 && t.speed.abs() < 0.25 {
    self.stuck_t += dt
  } else {
    self.stuck_t = 0.0
  }
  if self.stuck_t > 2.0 {
    self.unstuck_t = 1.5
    self.stuck_t = 0.0
  }
  if self.unstuck_t > 0.0 {
    // 倒车脱困
    self.unstuck_t -= dt
    self.input.throttle = -1.0
    self.input.steer = if self.nav_yaw_jitter > 0.0 { 1.0 } else { -1.0 }
    return
  }
  // 路径级绕行(检查节流 0.3s)
  if world.time_ref.val - self.nav_chk > 0.3 {
    self.nav_chk = world.time_ref.val
    if nav_line_clear(t_terrain, t.x, t.z, px, pz) {
      self.nav_path = None
    } else {
      let need = match self.nav_goal {
        None => true
        Some(g) =>
          (g.0 - px).abs() + (g.1 - pz).abs() > 18.0 ||
          world.time_ref.val - self.nav_t >
          (if self.nav_path is Some(_) { 3.0 } else { 1.0 })
      }
      if need {
        self.nav_path = nav_find_path(t_terrain, world, t.x, t.z, px, pz)
        self.nav_goal = Some((px, pz))
        self.nav_t = world.time_ref.val
      }
    }
  }
  match self.nav_path {
    Some(path) =>
      if path.length() > 0 {
        while path.length() > 0 && dist2d(t.x, t.z, path[0].0, path[0].1) < 14.0 {
          ignore(path.remove(0))
        }
        if path.length() > 0 {
          px = path[0].0
          pz = path[0].1
        } else {
          self.nav_path = None
        }
      } else {
        self.nav_path = None
      }
    None => ()
  }
  let dx = px - t.x
  let dz = pz - t.z
  let dist = @math.hypot(dx, dz)
  let mut desired_yaw = match face_yaw {
    Some(fy) => if self.p.hold_ground { fy } else { v8_atan2(dx, dz) }
    None => v8_atan2(dx, dz)
  }
  // 前方陡坡回避: 试探 ±50° 找缓坡
  if t_terrain.slope_ahead(t.x, t.z, t.yaw, 6.0).abs() >
    sim_cfg.max_slope * 0.85 {
    let s_l = t_terrain.slope_ahead(t.x, t.z, t.yaw - 0.9, 6.0).abs()
    let s_r = t_terrain.slope_ahead(t.x, t.z, t.yaw + 0.9, 6.0).abs()
    desired_yaw = t.yaw + (if s_l < s_r { -0.9 } else { 0.9 })
  }
  // 前方掩体回避
  let fx = t.x + v8_sin(t.yaw) * 7.0
  let fz = t.z + v8_cos(t.yaw) * 7.0
  for c in world.covers_list {
    if not(c.blocks_move) || (not(c.blocks_shells) && c.r < 1.0) {
      continue
    }
    let d = @math.hypot(fx - c.x, fz - c.z)
    if d < c.r + 3.0 {
      desired_yaw = t.yaw +
        js_sign(
          ang_diff(t.yaw, v8_atan2(t.x - c.x, t.z - c.z) + @math.PI / 2.0),
        ) *
        0.8
      break
    }
  }
  let d_yaw = ang_diff(t.yaw, desired_yaw)
  self.input.steer = clamp(d_yaw * 2.5, -1.0, 1.0)
  // 预瞄纪律(G8): 仅推进导航压舵(读取的是上一拍 throttle, 与 JS 求值次序一致)
  if self.advancing &&
    self.preaim_yaw is Some(_) &&
    self.g_preaim &&
    not(t.no_turret) &&
    self.input.throttle != 0.0 {
    if ai_cfg.preaim_on != 0 {
      let a = d_yaw.abs()
      if a > 0.06 && a <= 0.15 {
        self.input.steer = clamp(
          d_yaw * 2.5,
          -ai_cfg.preaim_cap_steer,
          ai_cfg.preaim_cap_steer,
        )
      }
    }
  }
  let arrived = dist < 4.0
  self.input.throttle = if arrived {
    0.0
  } else if d_yaw.abs() > 1.3 {
    0.12
  } else {
    1.0
  }
  if arrived {
    self.input.steer = match face_yaw {
      Some(fy) => clamp(ang_diff(t.yaw, fy) * 2.5, -1.0, 1.0)
      None => 0.0
    }
  }
}

///|
/// bandFor (ai.js:756-759): 交战带取值闸
fn Ai::band_for(self : Ai) -> (Double, Double) {
  if not(self.g_weak) {
    return self.p.band // 低难度回退口径: 恒原带
  }
  match self.band {
    Some(b) => b
    None => self.p.band
  }
}

///|
/// _winRayClear (ai.js:767-780): 开火窗口射线(炮口→本帧瞄点; 地形裸采样 2m 步进)
/// 返回 0=通 / 1=地形挡 / 2=掩体挡。ox/oz 为外部起点覆盖(探点验收用)。
fn Ai::win_ray_clear(
  self : Ai,
  pred_x : Double,
  pred_z : Double,
  ty : Double,
  world : World,
  ox : Double?,
  oz : Double?,
) -> Int {
  let t = self.tank
  let t_terrain = world.terrain
  let sx = match ox {
    Some(v) => v
    None => t.x
  }
  let sz = match oz {
    Some(v) => v
    None => t.z
  }
  let ay = (match ox {
      Some(_) => t_terrain.height_at(sx, sz)
      None => t.y
    }) +
    2.0
  let dx = pred_x - sx
  let dz = pred_z - sz
  let len = @math.hypot(dx, dz)
  let steps = 2.0.max((len / 4.0).ceil()).to_int()
  for i in 1..<steps {
    let f = i.to_double() / steps.to_double()
    if ay + (ty - ay) * f <= t_terrain.height_at(sx + dx * f, sz + dz * f) {
      return 1 // 地形挡(反斜面)
    }
  }
  if len < 1.0 {
    return 0
  }
  if world.covers_blocked(
      sx,
      sz,
      ay,
      dx / len,
      dz / len,
      len,
      (ty - ay) / len,
      None,
    ) <
    0.0 {
    0
  } else {
    2 // 掩体挡
  }
}

///|
/// _winCheck (ai.js:788-796): 窗口判定唯一链(履带弹不回退; 地形挡抬瞄点试车体中线)
fn Ai::win_check(
  self : Ai,
  pred_x : Double,
  pred_z : Double,
  ty : Double,
  gy : Double,
  track_aim : Bool,
  world : World,
) -> (Bool, Double) {
  let blk = self.win_ray_clear(pred_x, pred_z, ty, world, None, None)
  if blk == 1 && not(track_aim) {
    let ty_hi = gy + 1.2
    if self.win_ray_clear(pred_x, pred_z, ty_hi, world, None, None) == 0 {
      self.win_blk = 0
      return (true, ty_hi)
    }
  }
  self.win_blk = blk
  (blk == 0, ty)
}

///|
/// _winEdge (ai.js:804-814): 关→开边沿 = 重露头补反应(rearm); 开→关 = 记隐藏起点
fn Ai::win_edge(self : Ai, clear : Bool, brawl : Bool, world : World) -> Unit {
  if clear && not(self.win_open) {
    let hidden = match self.win_since {
      None => 0.0
      Some(s) => world.time_ref.val - s
    }
    if hidden > ai_cfg.fd_rearm_min_hidden_s && self.cover_phase != "peek" {
      self.react_t = self.react_t.max(
        if brawl {
          self.rearm_brawl_s
        } else {
          self.rearm_s
        },
      )
    }
    self.win_open = true
    self.win_since = None
    self.win_open_t = world.time_ref.val
  } else if not(clear) && self.win_open {
    self.win_open = false
    self.win_since = Some(world.time_ref.val)
  }
}

///|
/// _gridHidden (ai.js:822-830): 藏点可见性判据(点阵口径, 与点亮同源)
fn Ai::grid_hidden(
  self : Ai,
  x : Double,
  z : Double,
  ref_ : NavRef,
  world : World,
  face_yaw : Double?,
) -> Bool {
  let t = self.tank
  let sw = t.spec.sample.w
  let sl = t.spec.sample.l
  let rw = match ref_.tk {
    Some(r) => r.spec.sample.w
    None => 1.5
  }
  // faceYaw 缺省=车头朝敌
  let face = match face_yaw {
    Some(f) => f
    None => v8_atan2(ref_.x - x, ref_.z - z)
  }
  not(los_grid(world, ref_.x, ref_.z, rw, x, z, face, sw, sl, None))
}
