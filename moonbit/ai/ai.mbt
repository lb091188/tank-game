// client/js/ai.js SF.AI 类直译 —— 字段/构造器/感知/集火呼叫/被击感知/导航/窗口链。
// 每个方法注释标注原 JS 方法名与行号; 掷骰次序与字段读写次序逐句对应。

///|
/// 焦点血账(_fHpw 值)
pub(all) struct HpwMemo {
  mut hpw : Double
}

///|
/// 换血血账(hpMemo 值)
pub(all) struct HpMemo {
  mut hp : Double
  mut max : Double
}

///|
/// 站位闩锁(_stLatch)
pub(all) struct StLatch {
  x : Double
  z : Double
  role : String?
}

///|
/// 藏/探点计划(_findCoverSpot/_ridgeSpot 返回)
pub(all) struct CoverPlan {
  hide : Pt
  peek : Pt
  face : Double
  cov : @simcore.Cover?
  mut lead : Double
}

///|
/// SF.AI (ai.js:489) —— 字段集=构造器+update 动态字段全清单
pub(all) struct Ai {
  ctx : Ctx
  tank : Tank
  p : Personality // this.p
  mut lvl : Double // _lvl
  mut ang_rad : Double // _angRad
  mut ang_use : Double // _angUse
  mut straighten_lead : Double // _straightenLead
  mut td_mul : Double // _tdMul
  mut ang_side : Double // _angSide
  mut ang_dead : Double // _angDead
  mut max_frac_reload : Double // _maxFracReload
  mut rearm_s : Double // _rearmS
  mut g_weak : Bool // _gWeak
  mut g_gate : Bool // _gGate
  mut g_win : Bool // _gWin
  mut g_peek : Bool // _gPeek
  mut g_preaim : Bool // _gPreAim
  mut preaim_yaw : Double? // _preAimYaw
  mut advancing : Bool // _advancing
  // _fd = fireDisc 配置快照(JS 存整对象; 直译取平字段)
  mut rearm_brawl_s : Double // _rearmBrawlS
  mut win_open : Bool // _winState.open
  mut win_since : Double? // _winState.since
  mut win_blk : Int // _winState.blk
  mut win_open_t : Double // _winState.openT
  mut win_chk_t : Double // _winChkT
  mut tactic : String // _tactic
  mut tac_t : Double // _tacT
  mut hill_auth : Bool // _hillAuth
  mut hill_commit : Bool // _hillCommit
  mut hill_go_t : Double // _hillGoT
  mut cf_pt : Pt? // _cfPt
  mut cf_t : Double // _cfT
  mut rev_pulse_ok : Bool // _revPulseOk
  mut settle_t : Double // _settleT
  mut settle_cd : Double // _settleCd
  patrol : Array[Pt]
  hold : Bool
  home : Pt
  mut state : String
  mut wp : Int
  mut last_radio : Double // _lastRadio
  mut alert_t : Double // _alertT
  mut search_t : Double // _searchT
  mut search_pt : Pt? // _searchPt
  mut flank_slot : Double // flankSlot
  mut input : Inp
  mut seen : Bool
  mut react_t : Double
  mut seen_any_t : Double // _seenAnyT
  mut last_seen : Seen? // lastSeen
  mut seen_now : Bool // seenNow
  mut last_target_id : Int // lastTargetId(只写不读, 直译保留)
  mut heard : Heard?
  mut percept_t : Double
  mut reposition_t : Double
  mut retreat_t : Double
  mut unstuck_t : Double
  mut stuck_t : Double
  mut nav_yaw_jitter : Double // navYawJitter(只写不读, 直译保留)
  mut nav_path : Array[(Double, Double)]? // _navPath
  mut nav_goal : (Double, Double)? // _navGoal
  mut nav_t : Double // _navT
  mut nav_chk : Double // _navChk
  f_hpw : Map[Int, HpwMemo] // _fHpw
  hp_memo : Map[Int, HpMemo] // hpMemo
  mut gate_tries : Int // _gateTries
  mut gate_pt : Pt? // _gatePt
  mut gate_pt_t : Double // _gatePtT
  mut gate_track : Bool // _gateTrack
  mut flank_plan_t : Double // _flankPlanT
  mut track_t : Double // _trackT
  mut aim_ty : Double // _aimTy
  mut cover_phase : String // _coverPhase
  mut cover_pt : Pt? // _coverPt
  mut cover_peek : Pt? // _coverPeek
  mut peek_lead : Double // _peekLead
  mut hide_frac : Double // _hideFrac
  mut cover_t : Double // _coverT
  mut cover_enter_t : Double // _coverEnterT
  mut rev_stuck_t : Double // _revStuckT
  mut hide_chk_t : Double // _hideChkT
  mut cover_spot_ok : Bool // _coverSpotOK
  mut cover_ref : Tank? // _coverRef
  mut cover_face : Double? // _coverFace
  mut cover_cov : @simcore.Cover? // _coverCov(只写不读, 直译保留)
  mut hide_stuck_t : Double? // _hideStuckT(undefined ↔ None)
  mut hide_cov : Bool // _hideCov
  mut shy_since : Double? // _shySince(undefined/0 均假值)
  mut shy : Bool // _shy
  mut strong : Bool // _strong
  mut band : (Double, Double)? // _band
  mut memo : Memo? // _memo
  mut role : String? // _role
  mut station : St? // _station
  mut st_latch : StLatch? // _stLatch
  mut hill_t : Double? // _hillT(读处 `|| -99`)
  mut intel_t : Double? // _intelT(undefined 判定)
  mut push_at : Double? // _pushAt(读处 `|| 0`, 可置 null)
  mut hurt_t : Double? // _hurtT(真值判定)
  mut chain_t : Double // _chainT(读处 `|| 0`)
  mut chain_pt : Pt? // _chainPt
}

///|
/// 构造器 (ai.js:490-601)。掷骰次序: flankSlot → perceptT → repositionT(与 JS 逐位对应);
/// Bus.on('aiRadio')/'fire' 注册序 = 构造序(A 先 B 后), radio 广播按注册序派发。
pub fn Ai::new(
  ctx : Ctx,
  tank : Tank,
  personality : String,
  patrol_pts : Array[(Double, Double)],
) -> Ai {
  let cfg = ctx.cfg
  let p = match personality {
    "flanker" => cfg.ai.p_flanker
    "sniper" => cfg.ai.p_sniper
    "hold" => cfg.ai.p_hold
    _ => cfg.ai.p_flanker
  }
  // 难度总闸快照(ai.js:498)
  let lvl = cfg.ai.skill_level
  // 装填期摆角度(G2, ai.js:506-510)
  let ang_rad = clamp(
      p.angle_skill * cfg.ai.angle_deg_mid,
      0.0,
      lerp(0.0, cfg.ai.angle_deg_max, lvl),
    ) *
    @math.PI /
    180.0
  let h_t = js_or0v(tank.spec.hull_traverse).max(0.05) // JS: (hullTraverse || 0.4) 取 max(…, 0.05)
  let budget = js_orv(tank.spec.gun.reload, 3.0) *
    cfg.ai.angle_max_frac_of_reload
  let ang_use = if cfg.ai.angle_on == 0 {
    0.0
  } else {
    ang_rad.min(0.0.max(budget - cfg.ai.angle_settle_s) * h_t)
  }
  let straighten_lead = ang_use / h_t + cfg.ai.angle_settle_s
  let rearm_s = lerp(0.05, 0.3, lvl)
  let patrol : Array[Pt] = []
  for w in patrol_pts {
    patrol.push({ x: w.0, z: w.1, })
  }
  let ai : Ai = {
    ctx,
    tank,
    p,
    lvl,
    ang_rad,
    ang_use,
    straighten_lead,
    td_mul: cfg.ai.angle_td_mul, // JS: AN.tdMul || 0.8(cfg 恒有 0.8)
    ang_side: 1.0,
    ang_dead: cfg.ai.angle_deadzone_deg * @math.PI / 180.0,
    max_frac_reload: cfg.ai.angle_max_frac_of_reload,
    rearm_s,
    g_weak: lvl >= 0.4,
    g_gate: lvl >= 0.6,
    g_win: lvl >= 0.6,
    g_peek: lvl >= 0.6,
    g_preaim: lvl >= 0.4,
    preaim_yaw: None,
    advancing: false,
    rearm_brawl_s: rearm_s * (cfg.ai.fd_rearm_brawl_s / cfg.ai.fd_rearm_s),
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
    cf_pt: None,
    cf_t: -9.0,
    rev_pulse_ok: false,
    settle_t: -1.0,
    settle_cd: 0.0,
    patrol,
    hold: false, // def.hold 未传 ↔ !!undefined = false
    home: { x: tank.x, z: tank.z, },
    state: "patrol",
    wp: 0,
    last_radio: -99.0,
    alert_t: 0.0,
    search_t: 0.0,
    search_pt: None,
    flank_slot: 0.0,
    input: Inp::new(tank.yaw),
    seen: false,
    react_t: 0.0,
    seen_any_t: -9.0,
    last_seen: None,
    seen_now: false,
    last_target_id: 0,
    heard: None,
    percept_t: 0.0,
    reposition_t: 0.0,
    retreat_t: 0.0,
    unstuck_t: 0.0,
    stuck_t: 0.0,
    nav_yaw_jitter: 0.0,
    nav_path: None,
    nav_goal: None,
    nav_t: -9.0,
    nav_chk: -9.0,
    f_hpw: Map([]),
    hp_memo: Map([]),
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
    cover_ref: None,
    cover_face: None,
    cover_cov: None,
    hide_stuck_t: None,
    hide_cov: false,
    shy_since: None,
    shy: false,
    strong: false,
    band: None,
    memo: None,
    role: None,
    station: None,
    st_latch: None,
    hill_t: None,
    intel_t: None,
    push_at: None,
    hurt_t: None,
    chain_t: 0.0,
    chain_pt: None,
  }
  // 无线电: 友军发现/听见 → 全队广播(ai.js:559-564)
  ctx.bus.on("aiRadio", fn(e) {
    match e {
      Radio(from, x, z) => {
        if !ai.tank.alive || from.uid == ai.tank.uid || ai.state == "combat" {
          return
        }
        ai.heard = Some({
          x: x + (ctx.rand() - 0.5) * 24.0,
          z: z + (ctx.rand() - 0.5) * 24.0,
          t: now_t(ctx),
        })
        if ai.state != "alert" {
          ai.state = "alert"
          ai.alert_t = now_t(ctx)
        }
      }
      _ => ()
    }
  })

  // 掷骰次序: flankSlot(556) → perceptT(569) → repositionT(570); 其余字段已按同值初始化于字面量
  ai.flank_slot = ctx.rand() * @math.PI * 2.0
  ai.percept_t = ctx.rand() * cfg.ai.perception_interval
  ai.reposition_t = 3.0 + ctx.rand() * 4.0
  // 听觉: 玩家开炮 → 炮声全图可闻(ai.js:592-600; 本夹具 Bus 无 'fire' 发射点, 恒静默)
  ctx.bus.on("fire", fn(e) {
    match e {
      Fire(et) =>
        if ai.tank.alive && (et.is_player || et.team == 0) {
          let d = dist2d(ai.tank.x, ai.tank.z, et.x, et.z)
          if d < cfg.ai.shot_hearing {
            let err = 14.0 + d * 0.06
            ai.heard = Some({
              x: et.x + (ctx.rand() - 0.5) * 2.0 * err,
              z: et.z + (ctx.rand() - 0.5) * 2.0 * err,
              t: now_t(ctx),
            })
          }
        }
      _ => ()
    }
  })

  ai
}

///|
/// onHurt (ai.js:605-616): 被击中感知 —— 掷骰次序: err → hx → hz
pub fn Ai::on_hurt(self : Ai, shooter : Tank) -> Unit {
  let ctx = self.ctx
  if !self.tank.alive || shooter.team == self.tank.team {
    return
  }
  let err = 20.0 + ctx.rand() * 14.0
  let hx = shooter.x + (ctx.rand() - 0.5) * 2.0 * err
  let hz = shooter.z + (ctx.rand() - 0.5) * 2.0 * err
  self.heard = Some({ x: hx, z: hz, t: now_t(ctx), })
  self.hurt_t = Some(now_t(ctx))
  // JS: const w = SF.Game.world; if (w) w.intel = {...} —— 写主世界 intel(视图各自的 intel
  // 字段独立, 视图侧读不到此写入 —— 夹具内为死存储, 直译保形)
  match ctx.game_world {
    Some(w) => w.intel = { x: hx, z: hz, t: now_t(ctx), level: 2, }
    None => ()
  }
  if !self.seen_now {
    self.last_seen = Some({ x: hx, z: hz, vx: 0.0, vz: 0.0, t: now_t(ctx), })
  }
  ctx.bus.emit("aiRadio", Radio(self.tank, hx, hz))
  if self.state == "patrol" {
    self.state = "alert"
    self.alert_t = now_t(ctx)
  }
}

///|
/// perceive (ai.js:619-645): 感知/点亮/反应延迟/无线电
pub fn Ai::perceive(self : Ai, world : World) -> Unit {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let player = nearest_target(world, ctx, self.tank)
  let was_seen = self.seen
  self.seen = false
  if player is Some(pl) {
    if pl.alive {
      let d = dist2d(self.tank.x, self.tank.z, pl.x, pl.z)
      let vr = js_or(self.tank.spec.view, cfg.ai.view_range)
      // 点亮(WoT): 50m 强制 或 视距×(1-目标隐蔽)+点阵通视
      if d < 50.0 ||
        (
          d < vr * (1.0 - camo_of_tank(pl, world)) &&
          los_clear_any(world, self.tank, pl, None)
        ) {
        self.seen = true
        self.last_seen = Some({
          x: pl.x,
          z: pl.z,
          vx: js_or0v(pl.vel_x),
          vz: js_or0v(pl.vel_z),
          t: world.time,
        })
        self.last_target_id = pl.net_id
        // 目视确认 → 上报全队情报(视图各自的 intel 字段整体替换)
        world.intel = { x: pl.x, z: pl.z, t: world.time, level: 2, }
        if !was_seen && self.state != "combat" {
          self.react_t = cfg.ai.reaction_time *
            (1.0 + (1.0 - self.p.aim_patience))
        }
        if world.time - self.last_radio > cfg.ai.radio_cooldown {
          self.last_radio = world.time
          ctx.bus.emit("aiRadio", Radio(self.tank, pl.x, pl.z))
        }
        self.focus_call(pl, world, d)
      }
    }
  }
  self.seen_now = self.seen
  if self.seen {
    self.seen_any_t = world.time
  }
}

///|
/// _focusCall (ai.js:656-679): 集火呼叫写入(仅 perceive 入口)
pub fn Ai::focus_call(self : Ai, tgt : Tank, world : World, d : Double) -> Unit {
  let cfg = self.ctx.cfg
  if cfg.ai.focus_on == 0 || !tgt.alive {
    return
  }
  let pid = tgt.net_id
  let now = world.time
  let memo = match self.f_hpw.get(pid) {
    Some(m) => m
    None => {
      let m : HpwMemo = { hpw: tgt.hp, }
      self.f_hpw[pid] = m
      m
    }
  }
  if tgt.hp > memo.hpw {
    memo.hpw = tgt.hp
  }
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
  let mut sc = 0.7 * (1.0 - tgt.hp / memo.hpw.max(1.0)) +
    0.3 * (1.0 - dc.min(400.0) / 400.0)
  if tgt.hp <= self.tank.spec.gun.dmg * cfg.ai.trade_kill_mult {
    sc = 1.0
  }
  match world.focus {
    None =>
      world.focus = Some({ net_id: pid, t: now, hp: tgt.hp, hpw: memo.hpw, sc, })
    Some(f) => {
      let stale = now - f.t > cfg.ai.focus_memory_s
      let mut stale2 = stale
      if !stale2 {
        let mut found = false
        for e in world.mp_targets {
          if e.alive && e.net_id == f.net_id {
            found = true
            break
          }
        }
        stale2 = !found
      }
      if stale2 {
        world.focus = Some({
          net_id: pid,
          t: now,
          hp: tgt.hp,
          hpw: memo.hpw,
          sc,
        })
        return
      }
      if f.net_id == pid {
        f.t = now
        f.hp = tgt.hp
        f.sc = sc
        return
      }
      if !(now - f.t > cfg.ai.focus_update_s && sc > f.sc + 0.1) {
        return
      }
      match world.focus_prev {
        Some(prev) => if prev.net_id == pid && now < prev.until { return }
        None => ()
      }
      world.focus_prev = Some({
        net_id: f.net_id,
        until: now + cfg.ai.focus_switch_s,
      })
      world.focus = Some({ net_id: pid, t: now, hp: tgt.hp, hpw: memo.hpw, sc, })
    }
  }
}

///|
/// navigate (ai.js:682-749): 朝目标点输出油门/转向(避陡坡/避掩体/防卡死/BFS 绕行)
pub fn Ai::navigate(
  self : Ai,
  px_ : Double,
  pz_ : Double,
  dt : Double,
  world : World,
  face_yaw? : Double,
) -> Unit {
  let ctx = self.ctx
  let cfg = ctx.cfg
  let t = self.tank
  let t_terrain = world.terrain
  let mut px = px_
  let mut pz = pz_
  // 卡死检测(读上一帧 input.throttle)
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
    self.unstuck_t -= dt
    self.input.throttle = -1.0
    self.input.steer = if self.nav_yaw_jitter > 0.0 { 1.0 } else { -1.0 }
    return
  }
  // 路径级绕行
  if world.time - self.nav_chk > 0.3 {
    self.nav_chk = world.time
    let path_age_limit = if self.nav_path is Some(_) { 3.0 } else { 1.0 }
    let need = match self.nav_goal {
      None => true
      Some(g) => (g.0 - px).abs() + (g.1 - pz).abs() > 18.0
    }
    if nav_line_clear(ctx, world, t.x, t.z, px, pz) {
      self.nav_path = None
    } else if need || world.time - self.nav_t > path_age_limit {
      self.nav_path = nav_find_path(ctx, world, t.x, t.z, px, pz)
      self.nav_goal = Some((px, pz))
      self.nav_t = world.time
    }
  }
  match self.nav_path {
    Some(pth) =>
      if pth.length() > 0 {
        while pth.length() > 0 && dist2d(t.x, t.z, pth[0].0, pth[0].1) < 14.0 {
          let _ = pth.remove(0)
        }
        if pth.length() > 0 {
          px = pth[0].0
          pz = pth[0].1
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
    Some(fy) => if self.p.hold_ground { fy } else { @math.atan2(dx, dz) }
    None => @math.atan2(dx, dz)
  }
  // 前方陡坡回避
  if t_terrain.slope_ahead(t.x, t.z, t.yaw, 6.0).abs() >
    cfg.sim.max_slope * 0.85 {
    let s_l = t_terrain.slope_ahead(t.x, t.z, t.yaw - 0.9, 6.0).abs()
    let s_r = t_terrain.slope_ahead(t.x, t.z, t.yaw + 0.9, 6.0).abs()
    desired_yaw = t.yaw + (if s_l < s_r { -0.9 } else { 0.9 })
  }
  // 前方掩体回避
  let fx = t.x + @math.sin(t.yaw) * 7.0
  let fz = t.z + @math.cos(t.yaw) * 7.0
  for c in world.covers.items {
    if !c.blocks_move || (c.blocks_shells == false && c.r < 1.0) {
      continue
    }
    let d = @math.hypot(fx - c.x, fz - c.z)
    if d < c.r + 3.0 {
      desired_yaw = t.yaw +
        js_sign(
          ang_diff(t.yaw, @math.atan2(t.x - c.x, t.z - c.z) + @math.PI / 2.0),
        ) *
        0.8
      break
    }
  }
  let d_yaw = ang_diff(t.yaw, desired_yaw)
  self.input.steer = clamp(d_yaw * 2.5, -1.0, 1.0)
  // 预瞄纪律(G8, ai.js:739-745): 推进中压舵(读上一帧 throttle)
  if self.advancing &&
    self.preaim_yaw is Some(_) &&
    self.g_preaim &&
    !t.parts_no_turret &&
    self.input.throttle != 0.0 {
    if cfg.ai.preaim_on != 0 {
      let a = d_yaw.abs()
      if a > 0.06 && a <= 0.15 {
        self.input.steer = clamp(
          d_yaw * 2.5,
          -cfg.ai.preaim_cap_steer,
          cfg.ai.preaim_cap_steer,
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
/// bandFor (ai.js:756-759): 交战带取值闸(带插值唯一接线点)
pub fn Ai::band_for(self : Ai) -> (Double, Double) {
  if !self.g_weak {
    return self.p.band
  }
  match self.band {
    Some(b) => b
    None => self.p.band
  }
}

///|
/// _winRayClear (ai.js:767-780): 开火窗口射线(炮口→瞄点; 0=通/1=地形挡/2=掩体挡)
pub fn Ai::win_ray_clear(
  self : Ai,
  pred_x : Double,
  pred_z : Double,
  ty : Double,
  world : World,
  ox? : Double,
  oz? : Double,
) -> Int {
  let t = self.tank
  let t_terrain = world.terrain
  let sx = ox.unwrap_or(t.x)
  let sz = oz.unwrap_or(t.z)
  let ay = (match ox {
      Some(_) => t_terrain.height_at(sx, sz)
      None => t.y
    }) +
    2.0
  let dx = pred_x - sx
  let dz = pred_z - sz
  let len = @math.hypot(dx, dz)
  let steps = (len / 4.0).ceil().to_int().max(2)
  for i in 1..<steps {
    let f = i.to_double() / steps.to_double()
    if ay + (ty - ay) * f <= t_terrain.height_at(sx + dx * f, sz + dz * f) {
      return 1
    }
  }
  if len < 1.0 {
    return 0
  }
  if w_covers_blocked(
      world,
      sx,
      sz,
      ay,
      dx / len,
      dz / len,
      len,
      (ty - ay) / len,
    ) <
    0.0 {
    0
  } else {
    2
  }
}

///|
/// _winCheck (ai.js:788-796): 窗口判定唯一链(履带弹不回退; 地形挡抬瞄车体中线重试)
pub fn Ai::win_check(
  self : Ai,
  pred_x : Double,
  pred_z : Double,
  ty : Double,
  gy : Double,
  track_aim : Bool,
  world : World,
) -> (Bool, Double) {
  let blk = self.win_ray_clear(pred_x, pred_z, ty, world)
  if blk == 1 && !track_aim {
    let ty_hi = gy + 1.2
    if self.win_ray_clear(pred_x, pred_z, ty_hi, world) == 0 {
      self.win_blk = 0
      return (true, ty_hi)
    }
  }
  self.win_blk = blk
  (blk == 0, ty)
}

///|
/// _winEdge (ai.js:804-814): 窗口边沿 + 重露头补反应(rearm)
pub fn Ai::win_edge(
  self : Ai,
  clear : Bool,
  brawl : Bool,
  world : World,
) -> Unit {
  if clear && !self.win_open {
    let hidden = match self.win_since {
      None => 0.0
      Some(s) => world.time - s
    }
    if hidden > self.ctx.cfg.ai.fd_rearm_min_hidden_s &&
      self.cover_phase != "peek" {
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
    self.win_open_t = world.time
  } else if !clear && self.win_open {
    self.win_open = false
    self.win_since = Some(world.time)
  }
}

///|
/// _gridHidden (ai.js:822-830): 藏点可见性判据(点阵口径, 与点亮同几何)
pub fn Ai::grid_hidden(
  self : Ai,
  x : Double,
  z : Double,
  ref_t : RefT,
  world : World,
  face_yaw? : Double,
) -> Bool {
  let t = self.tank
  let face = match face_yaw {
    Some(f) => f
    None => @math.atan2(ref_t.x() - x, ref_t.z() - z)
  }
  // JS: rs = (ref.spec && ref.spec.sample) || { w: 1.5 } —— Seen 无 spec ↔ 兜底 1.5
  let rs_w = match ref_t {
    RT(r) => r.spec.sample.w
    RS(_) => 1.5
  }
  !los_grid(
    world,
    ref_t.x(),
    ref_t.z(),
    rs_w,
    x,
    z,
    face,
    t.spec.sample.w,
    t.spec.sample.l,
    None,
  )
}
