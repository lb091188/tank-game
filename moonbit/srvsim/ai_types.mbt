// ai.js 直译 · 数据结构层: SF.Bus / world 视图 / teamMemo / AI 实例状态。
// JS 侧全部是动态对象 + world 挂载字段; 逐字段注释标 JS 原名。

///|
/// SF.Bus 'aiRadio' 事件载荷(ai.js:559/614/638: {from, x, z})
pub(all) struct RadioEv {
  from : Tank
  x : Double
  z : Double
}

///|
/// SF.Bus 'fire' 事件载荷(ai.js:592: {tank, pos, dir}; 本链只消费 tank)
pub(all) struct BusFireEv {
  tank : Tank
}

///|
/// SF.Bus 直译(config.js:1526-1534; boot 每遍新建 → bus_reset 对齐)
pub(all) struct Bus {
  mut ai_radio : Array[(RadioEv) -> Unit]
  mut fire : Array[(BusFireEv) -> Unit]
}

///|
let g_bus : Bus = { ai_radio: [], fire: [], }

///|
/// boot() 的新 SF 语义: 清空监听表
pub fn bus_reset() -> Unit {
  g_bus.ai_radio = []
  g_bus.fire = []
}

///|
/// SF.Bus.emit('aiRadio', e)
pub fn bus_emit_ai_radio(e : RadioEv) -> Unit {
  for f in g_bus.ai_radio {
    f(e)
  }
}

///|
/// SF.Bus.emit('fire', e)(本链 srv-sim 的开炮走 dispatch, 不经 Bus; 保留发射点语义)
pub fn bus_emit_fire(e : BusFireEv) -> Unit {
  for f in g_bus.fire {
    f(e)
  }
}

///|
/// world.intel(ai.js worldRef: {x,z,t,level})
pub(all) struct Intel {
  mut x : Double
  mut z : Double
  mut t : Double
  mut level : Int
}

///|
/// world.focus(ai.js _focusCall: {netId, t, hp, hpw, sc})
pub(all) struct Focus {
  net_id : Int
  mut t : Double
  mut hp : Double
  mut hpw : Double
  mut sc : Double
}

///|
/// world._focusPrev({netId, until})
pub(all) struct FocusPrev {
  net_id : Int
  until : Double
}

///|
/// world._hillPlan(ai.js _hillSync: {t, x, z, goT, reg})
pub(all) struct HillPlan {
  mut t : Double
  x : Double
  z : Double
  go_t : Double // goT
  reg : Map[Int, Double] // 键=keyOf, 值=登记时刻
}

///|
/// 目标引用桩(ai.js 里 Tank 与 lastSeen/heard/intel 混用的位置统一承载):
/// tk = Some(tank) 时 alive 读坦克, 否则恒真。
pub(all) struct NavRef {
  x : Double
  z : Double
  vx : Double
  vz : Double
  t : Double
  yaw : Double // JS ref.yaw(点式参照无 yaw → 0, 消费点 `ref.yaw || 0`)
  tk : Tank?
}

///|
/// NavRef.alive(JS ref.alive; 无坦克载荷时视为真)
pub fn NavRef::alive(self : NavRef) -> Bool {
  match self.tk {
    Some(t) => t.alive
    None => true
  }
}

///|
/// 地形导航网格(ai.js navGrid 挂 terrain._navG; Terrain 为 simcore 固定结构, 缓存挪挂 world)
pub(all) struct NavGrid {
  n : Int
  lo : Double
  st : Double
  pass : FixedArray[Bool]
}

///|
/// AI 世界视图(srv-sim.js:575-582 worldRef + ai.js world 挂载字段)。
/// time 走 time_ref(= 房间 time 的共享引用); 覆盖 simcore 射线的入口方法见文件尾。
pub(all) struct World {
  time_ref : Ref[Double] // worldRef.get time
  mut over : Bool
  terrain : @simcore.Terrain
  covers_list : Array[@simcore.Cover] // world.covers.list
  mut enemies : Array[Tank] // worldRef.enemies(netId>=100, 首波生成后回填)
  mut player : Tank? // worldRef.player = humans[0]
  mut mp_targets : Array[Tank] // worldRef.mpTargets = humans
  tanks : Array[Tank] // envT.tanks(与房间共享的同一数组)
  intel : Intel // worldRef.intel
  mut focus : Focus? // world.focus
  mut focus_prev : FocusPrev? // world._focusPrev
  mut team_memo : Memo? // world._teamMemo
  mut team_ids : Map[Int, Int]? // world._teamIds(keyOf 注册表; uid → keyOf)
  mut team_ids_n : Int // world._teamIds._n
  mut hill_plan : HillPlan? // world._hillPlan
  mut nav_cache : NavGrid? // terrain._navG(挪挂 world)
}

///|
/// covers.blocked 入口(SF.Sim.coversBlocked(coversList, T.heightAt, ..., spot?))
pub fn World::covers_blocked(
  self : World,
  ox : Double,
  oz : Double,
  oy : Double,
  dx : Double,
  dz : Double,
  len : Double,
  dy : Double,
  spot : @simcore.Spot?,
) -> Double {
  fn hf(x : Double, z : Double) -> Double {
    self.terrain.height_at(x, z)
  }
  let cl : @simcore.CoverList = { items: self.covers_list, bushes: None, }
  match spot {
    Some(sp) =>
      @simcore.covers_blocked(cl, hf, ox, oz, oy, dx, dz, len, dy, spot=sp)
    None => @simcore.covers_blocked(cl, hf, ox, oz, oy, dx, dz, len, dy)
  }
}

///|
/// covers.nearestCoverBetween 入口
pub fn World::nearest_cover_between(
  self : World,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> @simcore.Cover? {
  @simcore.nearest_cover_between(
    { items: self.covers_list, bushes: None, },
    ax,
    az,
    bx,
    bz,
  )
}

///|
/// 补位钉住(world 层 memo.plugPinned 条目)
pub(all) struct PlugPinned {
  by : Int
  x : Double
  z : Double
  until : Double
}

///|
/// teamMemo 产物(ai.js:480-481 memo 对象)
pub(all) struct Memo {
  sig : String
  t : Double
  list : Array[Tank]
  byk : Map[Int, Tank] // byK
  roles : Map[Int, String]
  stations : Map[Int, (Double, Double)?]
  plug_for : Map[Int, Int] // plugFor(JS 侧只写不读, 原样保留)
  focus_slots : Map[Int, Double] // focusSlots(键=keyOf, 值=心跳时刻)
  plug_pinned : Map[Int, PlugPinned]
  threat : (Double, Double, Double)? // {x,z,t}
  lead : Tank?
}

///|
/// SF.Game.world 的直译宿主(ai.js nowT/world2time 的取时钩子; 房间 create 时注入)
let g_game_world : Ref[World?] = { val: None, }

///|
/// SF.Game = { get world() { return W; } } 注入点
pub fn game_world_set(w : World?) -> Unit {
  g_game_world.val = w
}

///|
/// ai.js nowT() / world2time()
pub fn game_world_time() -> Double {
  match g_game_world.val {
    Some(w) => w.time_ref.val
    None => 0.0
  }
}

///|
/// AI 实例(SF.AI)。JS this.* 字段逐一对映; 数值字段默认值 = 构造器赋值。
pub(all) struct Ai {
  mut tank : Tank // this.tank
  p : Personality // this.p
  mut ang_rad : Double // _angRad
  mut ang_use : Double // _angUse
  straighten_lead : Double // _straightenLead
  td_mul : Double // _tdMul
  mut ang_side : Double // _angSide(1/-1)
  ang_dead : Double // _angDead
  max_frac_reload : Double // _maxFracReload
  rearm_s : Double // _rearmS
  rearm_brawl_s : Double // _rearmBrawlS
  g_weak : Bool // _gWeak
  g_gate : Bool // _gGate
  g_win : Bool // _gWin
  g_peek : Bool // _gPeek
  g_preaim : Bool // _gPreAim
  mut preaim_yaw : Double? // _preAimYaw
  mut advancing : Bool // _advancing
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
  mut hill_t : Double // _hillT(JS (this._hillT || -99); 初值 -99)
  mut cf_pt : (Double, Double)? // _cfPt
  mut cf_t : Double // _cfT(初值 -9)
  mut rev_pulse_ok : Bool // _revPulseOk
  mut settle_t : Double // _settleT(初值 -1)
  mut settle_cd : Double // _settleCd
  patrol : Array[(Double, Double)]
  hold : Bool
  home_x : Double
  home_z : Double
  mut state : String
  mut wp : Int
  mut last_radio : Double // _lastRadio(初值 -99)
  mut alert_t : Double // _alertT
  mut search_t : Double // _searchT
  mut search_pt : (Double, Double)? // _searchPt
  mut flank_slot : Double // flankSlot(构造掷骰; spawnWave 会重排)
  mut heard : NavRef? // this.heard
  input : Input // this.input(跨 tick 复用的同一对象)
  mut seen : Bool // this.seen
  mut seen_now : Bool // this.seenNow
  mut react_t : Double // reactT
  mut seen_any_t : Double // _seenAnyT(初值 -9)
  mut last_seen : NavRef? // lastSeen
  mut last_target_id : Int // lastTargetId(perceive 写; 初值 0 = JS undefined || 0)
  mut percept_t : Double // perceptT(构造掷骰)
  mut reposition_t : Double // repositionT(构造掷骰)
  mut retreat_t : Double // retreatT
  mut unstuck_t : Double // unstuckT
  mut stuck_t : Double // stuckT
  nav_yaw_jitter : Double // navYawJitter
  mut nav_path : Array[(Double, Double)]? // _navPath
  mut nav_goal : (Double, Double)? // _navGoal
  mut nav_t : Double // _navT(初值 -9)
  mut nav_chk : Double // _navChk(初值 -9)
  mut f_hpw : Map[Int, Double] // _fHpw(netId → 见过最高血)
  mut hp_memo : Map[Int, (Double, Double)] // hpMemo(netId → {hp, max})
  mut gate_tries : Int // _gateTries
  mut gate_pt : (Double, Double)? // _gatePt
  mut gate_pt_t : Double // _gatePtT(初值 -99)
  mut gate_track : Bool // _gateTrack
  mut flank_plan_t : Double // _flankPlanT(初值 -99)
  mut track_t : Double // _trackT(初值 -99)
  mut aim_ty : Double // _aimTy
  mut cover_phase : String // _coverPhase 'none'/'hide'/'peek'
  mut cover_pt : (Double, Double)? // _coverPt
  mut cover_peek : (Double, Double)? // _coverPeek
  mut peek_lead : Double // _peekLead(初值 2)
  mut hide_frac : Double // _hideFrac(初值 0.6)
  mut cover_t : Double // _coverT(初值 0)
  mut cover_enter_t : Double // _coverEnterT(初值 -9)
  mut rev_stuck_t : Double // _revStuckT
  mut hide_chk_t : Double // _hideChkT(初值 -9)
  mut cover_spot_ok : Bool // _coverSpotOK
  mut cover_face : Double // _coverFace(JS undefined ↔ 本链初值 0; 只在 face 缺省分支消费,
  //   消费点恒先有写入 —— 见 _coverStep 的复用校验)
  mut cover_has_face : Bool // (JS this._coverFace !== undefined 的可判定化)
  mut cover_ref : Tank? // _coverRef(粘滞参照)
  mut hide_cov : Bool // _hideCov(初值 false)
  mut hide_stuck_t : Double // _hideStuckT(JS (this._hideStuckT || 0))
  mut station : (Double, Double)? // _station
  mut st_latch_x : Double // _stLatch.x
  mut st_latch_z : Double // _stLatch.z
  mut st_latch_role : String? // _stLatch.role(JS 可为 null)
  mut st_latch : Bool // (JS this._stLatch 真值判定)
  mut role : String? // _role
  mut band : (Double, Double)? // _band
  mut memo : Memo? // _memo
  mut shy_since : Double // _shySince(JS undefined ↔ 0; falsy 等价)
  mut hurt_t : Double // _hurtT(JS undefined ↔ 0; `this._hurtT && ...` 恒假等价)
  mut intel_t : Double // _intelT(JS undefined ↔ -inf; 用 has 标志)
  mut intel_t_has : Bool
  mut push_at : Double // _pushAt(JS (this._pushAt || 0))
  mut chain_t : Double // _chainT(JS (this._chainT || 0))
  mut chain_pt : (Double, Double)? // _chainPt
}
