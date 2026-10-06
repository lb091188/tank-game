// 世界/车辆状态宿主 + JS 全局注入的显式化(SF.Bus/SF.Game/Math.random → Ctx)。
// 字段集与 tools/golden-trace2.js mkTank 同形(= SF.Tank 引擎读写清单)。

///|
/// AI 输入(SF.Tank.input 同形; holdTurret 在本夹具恒 false, 保留字段承载 engine 分支)
pub(all) struct Inp {
  mut throttle : Double
  mut steer : Double
  mut aim_yaw : Double // aimYaw
  mut aim_pitch : Double // aimPitch
  mut fire : Bool
  mut hold_turret : Bool // holdTurret
}

///|
pub fn Inp::new(yaw : Double) -> Inp {
  {
    throttle: 0.0,
    steer: 0.0,
    aim_yaw: yaw,
    aim_pitch: 0.0,
    fire: false,
    hold_turret: false,
  }
}

///|
/// 车辆状态(mkTank 字段直译; 可变字段即 JS 的对象属性)
pub(all) struct Tank {
  typ : String // type
  spec : Spec
  mut x : Double
  mut y : Double
  mut z : Double
  mut yaw : Double
  mut speed : Double
  mut vel_x : Double // velX
  mut vel_z : Double // velZ
  mut last_yaw_rate : Double // lastYawRate
  mut last_turret_rate : Double // lastTurretRate
  mut turret_yaw : Double // turretYaw
  mut gun_pitch : Double // gunPitch
  mut pitch : Double
  mut roll : Double
  mut track_offset : Double // trackOffset
  mut gear : String
  mut shift_t : Double // shiftT
  mut flip_t : Double // flipT
  mut y_init : Bool // _yInit
  mut fall_v : Double // _fallV
  mut ram_t : Double // _ramT
  mut hp : Double
  mut alive : Bool
  mut reload_t : Double // reloadT
  mut reload_total : Double // reloadTotal
  mut clip_left : Int // clipLeft
  mut clip_phase : String // clipPhase
  mut disp : Double
  mut mod_track : Double // modules.track
  mut mod_engine : Double // modules.engine
  mut mod_gun : Double // modules.gun
  mut mod_ammo : Double // modules.ammo
  parts_no_turret : Bool // parts.noTurret
  cr : Double
  team : Int
  mut net_id : Int // netId
  is_player : Bool // isPlayer
  id : Int? // tank.id(worker 复制品唯一号; 缺失 None)
  uid : Int // keyOf 注册表兜底的 MoonBit 等价物(创建序递增; 见 keyOf 注)
  mut last_fire_t : Double // lastFireT
  mut stats_shots : Int // stats.shots
  mut stats_hits : Int // stats.hits
  mut stats_pens : Int // stats.pens
  mut stats_dmg_dealt : Int // stats.dmgDealt
  mut input : Inp
  mut ai : Ai? // t.ai 回指(构造后由 harness 挂上)
}

///|
/// mkTank(tools/golden-trace2.js:151-173 同式; 本夹具只产 pz4, 参数化 spec 以保引擎通用)
pub fn mk_tank(
  ctx : Ctx,
  spec : Spec,
  typ : String,
  x~ : Double,
  z~ : Double,
  yaw~ : Double,
  team~ : Int,
  net_id~ : Int,
  id? : Int,
) -> Tank {
  let _al = spec.gun.autoloader
  let t : Tank = {
    typ,
    spec,
    x,
    y: 0.0,
    z,
    yaw,
    speed: 0.0,
    vel_x: 0.0,
    vel_z: 0.0,
    last_yaw_rate: 0.0,
    last_turret_rate: 0.0,
    turret_yaw: yaw,
    gun_pitch: 0.0,
    pitch: 0.0,
    roll: 0.0,
    track_offset: 0.0,
    gear: "D1",
    shift_t: 0.0,
    flip_t: 0.0,
    y_init: false,
    fall_v: 0.0,
    ram_t: -9.0,
    hp: spec.hp,
    alive: true,
    reload_t: 1.0,
    reload_total: 1.0,
    clip_left: match _al {
      Some(al) => al.clip
      None => 0
    },
    clip_phase: match _al {
      Some(_) => "intra"
      None => "single"
    },
    disp: spec.dispersion.max,
    mod_track: 0.0,
    mod_engine: 0.0,
    mod_gun: 0.0,
    mod_ammo: 0.0,
    parts_no_turret: spec.gun_arc is Some(_),
    cr: @math.hypot(spec.sample.l, spec.sample.w) * 0.72,
    team,
    net_id,
    is_player: false,
    id: match id {
      Some(v) => Some(v)
      None => None
    },
    uid: ctx.next_uid(),
    last_fire_t: -99.0,
    stats_shots: 0,
    stats_hits: 0,
    stats_pens: 0,
    stats_dmg_dealt: 0,
    input: Inp::new(yaw),
    ai: None,
  }
  t
}

///|
/// world.intel(main.js 同形: {x,z,t,level})
pub(all) struct Intel {
  mut x : Double
  mut z : Double
  mut t : Double
  mut level : Int
}

///|
/// world.focus(G4 集火呼叫; per-view 一份)
pub(all) struct Focus {
  mut net_id : Int
  mut t : Double
  mut hp : Double
  mut hpw : Double
  mut sc : Double
}

///|
/// lastSeen / heard / lastSeen 点(字段集各调用点读写清单)
pub(all) struct Seen {
  mut x : Double
  mut z : Double
  vx : Double
  vz : Double
  mut t : Double
}

///|
pub(all) struct Heard {
  mut x : Double
  mut z : Double
  mut t : Double
}

///|
/// 二维点(藏点/探点/导航目标/绕点/搜剿点)
pub(all) struct Pt {
  x : Double
  z : Double
}

///|
/// 高地强袭共享计划登记项(_hillSync P.reg 值)
pub(all) struct RegEntry {
  mut t : Double
}

///|
/// _hillSync 计划(world._hillPlan)
pub(all) struct HillPlan {
  mut t : Double
  x : Double
  z : Double
  go_t : Double // goT
  reg : Map[Int, RegEntry]
}

///|
/// 顶位补防钉住项(teamMemo plugPinned 值)
pub(all) struct Plug {
  by : Int
  x : Double
  z : Double
  until : Double
}

///|
/// 角色站位(teamMemo stations 值; flank 候选带 side/d/deg/sc, 其余只有 x/z)
pub(all) struct St {
  x : Double
  z : Double
  side : Int? // 扇侧(flank 候选)
  d : Double? // 站点↔本车距离(flank 候选)
  mut deg : Double? // 对敌方位角(flank 候选; JS st.deg !== undefined 判定)
  mut sc : Double? // 评分(flank 候选)
}

///|
/// teamMemo(G3 全队协同备忘; world._teamMemo, per-view)
pub(all) struct Memo {
  sig : String
  t : Double
  list : Array[Tank]
  by_k : Map[Int, Tank] // byK
  roles : Map[Int, String]
  stations : Map[Int, St?] // 值可为 null(JS stations[k] = null)
  plug_for : Map[Int, Int] // plugFor
  focus_slots : Map[Int, Double] // focusSlots(跨重算持久, 按引用携带)
  slot_memo : Map[Int, Double] // slotMemo(结构占位, JS 侧仅存不读)
  plug_pinned : Map[Int, Plug]
  threat : Seen? // {x,z,t}
  lead : Tank? // leadE
}

///|
/// world(WA/WB 视图与主世界 W 同构; focus/_teamMemo/_hillPlan 挂视图, intel 共享)
pub(all) struct World {
  mut time : Double
  terrain : @simcore.Terrain
  terrain_uid : Int // nav 缓存键(T._navG 挂实例的等价物)
  covers : @simcore.CoverList // world.covers.list
  mut intel : Intel
  enemies : Array[Tank] // 本方 AI 车表(视图口径)
  player : Tank? // world.player(对手方参照; 可为 null)
  mp_targets : Array[Tank] // mpTargets(可瞄准目标池)
  mut focus : Focus?
  mut focus_prev : FocusPrev? // _focusPrev(换靶冷却)
  mut team_memo : Memo? // _teamMemo
  mut hill_plan : HillPlan? // _hillPlan
}

///|
/// 重生队列项(harness 死斗重生; Bus 'destroyed' 消费方)
pub(all) struct RespawnItem {
  mut t : Double
  tk : Tank
}

///|
/// world._focusPrev(_focusCall 换靶冷却记录)
pub(all) struct FocusPrev {
  net_id : Int
  until : Double
}

///|
/// world.covers.blocked(工具内 covers 对象方法 → simcore 直调; spot JS undefined ↔ None)
pub fn w_covers_blocked(
  world : World,
  ox : Double,
  oz : Double,
  oy : Double,
  dx : Double,
  dz : Double,
  len : Double,
  dy : Double,
  spot? : @simcore.Spot,
) -> Double {
  let hf = fn(x : Double, z : Double) { world.terrain.height_at(x, z) }
  @simcore.covers_blocked(world.covers, hf, ox, oz, oy, dx, dz, len, dy, spot?)
}

///|
/// world.covers.nearestCoverBetween
pub fn w_nearest_cover_between(
  world : World,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> @simcore.Cover? {
  @simcore.nearest_cover_between(world.covers, ax, az, bx, bz)
}

///|
/// Bus 事件负载(aiRadio/fire/destroyed 三种; 载荷字段=各注册回调读写清单)
pub(all) enum BusEvt {
  Radio(Tank, Double, Double) // {from, x, z}
  Fire(Tank) // {tank}
  Destroyed(Tank) // {tank}
}

///|
/// SF.Bus 直译(config.js:1526-1533): on 顺序注册, emit 按注册序同步调用
pub(all) struct Bus {
  mut handlers : Array[(String, (BusEvt) -> Unit)]
}

///|
pub fn Bus::new() -> Bus {
  { handlers: [], }
}

///|
pub fn Bus::on(self : Bus, ev : String, fn_ : (BusEvt) -> Unit) -> Unit {
  self.handlers.push((ev, fn_))
}

///|
pub fn Bus::emit(self : Bus, ev : String, data : BusEvt) -> Unit {
  for pair in self.handlers {
    if pair.0 == ev {
      (pair.1)(data)
    }
  }
}

///|
/// JS 全局注入束: Math.random / SF.Bus / SF.CFG / SF.Game.world.time
/// (ai.js 的 nowT()/world2time() = SF.Game.world.time, 主世界时钟)
pub(all) struct Ctx {
  mut rng : @simcore.Mulberry32 // Math.random(全局流, SPEC §4)
  bus : Bus
  cfg : Cfg
  mut game_time : Double // SF.Game.world.time
  mut game_world : World? // SF.Game.world(onHurt 写主世界 intel 用)
  mut uid_n : Int // 对象注册表计数(world._teamIds._n 的进程级等价)
  mut nav_grid : NavGrid? // T._navG 缓存(单地形口径; terrain_uid 变化即重建)
  mut nav_uid : Int
}

///|
pub fn Ctx::new(seed : Int) -> Ctx {
  {
    rng: @simcore.Mulberry32::new(seed),
    bus: Bus::new(),
    cfg: default_cfg(),
    game_time: 0.0,
    game_world: None,
    uid_n: 0,
    nav_grid: None,
    nav_uid: -1,
  }
}

///|
/// Math.random()
pub fn Ctx::rand(self : Ctx) -> Double {
  self.rng.next()
}

///|
fn Ctx::next_uid(self : Ctx) -> Int {
  self.uid_n = self.uid_n + 1
  self.uid_n
}

///|
/// nowT() / world2time() (ai.js:487/564)
pub fn now_t(ctx : Ctx) -> Double {
  ctx.game_time
}

///|
/// +Infinity(IEEE 溢出面; @math 无 inf 常量的替代)
pub const INF : Double = 1.0e308 * 1.0e308

///|
/// Math.sqrt
pub fn sqrt(v : Double) -> Double {
  v.sqrt()
}

// ---------- SF.Util 纯函数子集(config.js:1459-1523; simcore 包未覆盖的剩余函数) ----------

///|
/// SF.Util.lerp (config.js:1461)
pub fn lerp(a : Double, b : Double, t : Double) -> Double {
  a + (b - a) * t
}

///|
/// SF.Util.angDiff (config.js:1463): JS % 截断余号(被除号随被除数) — MoonBit Double % 同语义
pub fn ang_diff(a : Double, b : Double) -> Double {
  let mut d = (b - a) % (2.0 * @math.PI)
  if d > @math.PI {
    d = d - 2.0 * @math.PI
  }
  if d < -@math.PI {
    d = d + 2.0 * @math.PI
  }
  d
}

///|
/// SF.Util.moveToward (config.js:1464)
pub fn move_toward(cur : Double, target : Double, max_step : Double) -> Double {
  let d = target - cur
  if d.abs() <= max_step {
    target
  } else {
    cur + js_sign(d) * max_step
  }
}

///|
/// SF.Util.angMoveToward (config.js:1465)
pub fn ang_move_toward(
  cur : Double,
  target : Double,
  max_step : Double,
) -> Double {
  let d = ang_diff(cur, target)
  if d.abs() <= max_step {
    target
  } else {
    cur + js_sign(d) * max_step
  }
}

///|
/// SF.Util.dist2d (config.js:1466)
pub fn dist2d(ax : Double, az : Double, bx : Double, bz : Double) -> Double {
  @math.hypot(bx - ax, bz - az)
}

///|
/// SF.Util.obbPushOut (config.js:1497-1512): 两 OBB SAT 最小平移推出; 相交返回 [mx,mz], 否则 None
pub fn obb_push_out(
  ax : Double,
  az : Double,
  ayaw : Double,
  ahx : Double,
  ahz : Double,
  bx : Double,
  bz : Double,
  byaw : Double,
  bhx : Double,
  bhz : Double,
) -> (Double, Double)? {
  let a_x = (@math.cos(ayaw), -@math.sin(ayaw))
  let a_z = (@math.sin(ayaw), @math.cos(ayaw))
  let b_x = (@math.cos(byaw), -@math.sin(byaw))
  let b_z = (@math.sin(byaw), @math.cos(byaw))
  let dx = ax - bx
  let dz = az - bz
  let mut best = 1.0e9
  let mut mx = 0.0
  let mut mz = 0.0
  // JS: for (const ax of [aX, aZ, bX, bZ]) —— 轴序 aX,aZ,bX,bZ
  let axes = [a_x, a_z, b_x, b_z]
  for ax_ in axes {
    let ra = ahx * (ax_.0 * a_x.0 + ax_.1 * a_x.1).abs() +
      ahz * (ax_.0 * a_z.0 + ax_.1 * a_z.1).abs()
    let rb = bhx * (ax_.0 * b_x.0 + ax_.1 * b_x.1).abs() +
      bhz * (ax_.0 * b_z.0 + ax_.1 * b_z.1).abs()
    let dist = ax_.0 * dx + ax_.1 * dz
    let ov = ra + rb - dist.abs()
    if ov <= 0.0 {
      return None
    }
    if ov < best {
      best = ov
      let s = if dist >= 0.0 { 1.0 } else { -1.0 }
      mx = ax_.0 * s * best
      mz = ax_.1 * s * best
    }
  }
  Some((mx, mz))
}

// ---------- JS 语义小工具 ----------

///|
/// Math.sign
pub fn js_sign(v : Double) -> Double {
  if v > 0.0 {
    1.0
  } else if v < 0.0 {
    -1.0
  } else {
    v // JS: NaN → NaN, ±0 → ±0
  }
}

///|
/// Math.round = floor(x + 0.5)(半数向上; MoonBit .round() 负半数行为不同, 故自实现)
pub fn js_round(v : Double) -> Double {
  (v + 0.5).floor()
}

///|
/// SF.Util.clamp (config.js:1460)
pub fn clamp(v : Double, a : Double, b : Double) -> Double {
  a.max(b.min(v))
}

///|
/// JS `x || 0`(数值假值语义: 0/-0/NaN/undefined → 0; Option 版)
pub fn js_or0(v : Double?) -> Double {
  match v {
    Some(x) => if x == 0.0 || x.is_nan() { 0.0 } else { x }
    None => 0.0
  }
}

///|
/// JS `x || 0`(裸 Double 版)
pub fn js_or0v(v : Double) -> Double {
  if v == 0.0 || v.is_nan() {
    0.0
  } else {
    v
  }
}

///|
/// JS `x || default`(裸 Double 版: 0/-0/NaN → default)
pub fn js_orv(v : Double, default : Double) -> Double {
  if v == 0.0 || v.is_nan() {
    default
  } else {
    v
  }
}

///|
/// 稳定排序(V8 Array.sort ES2019+ 稳定; MoonBit sort 不保证稳定 → 归并自实现)。
/// JS comparator 返回负/0/正; 这里直接同口径传 (T,T)->Double 比较式。
pub fn[T] stable_sort_by(arr : Array[T], cmp : (T, T) -> Double) -> Unit {
  let n = arr.length()
  if n < 2 {
    return
  }
  let buf : Array[T] = []
  for _ in 0..<n {
    buf.push(arr[0])
  }
  let mut width = 1
  while width < n {
    let mut lo = 0
    while lo < n {
      let mid = (lo + width).min(n)
      let hi = (lo + width * 2).min(n)
      // 归并 arr[lo,mid) 与 arr[mid,hi) 到 buf 再拷回(稳定: 左半先取)
      let mut i = lo
      let mut j = mid
      let mut k = lo
      while i < mid && j < hi {
        if cmp(arr[j], arr[i]) < 0.0 {
          buf[k] = arr[j]
          j += 1
        } else {
          buf[k] = arr[i]
          i += 1
        }
        k += 1
      }
      while i < mid {
        buf[k] = arr[i]
        i += 1
        k += 1
      }
      while j < hi {
        buf[k] = arr[j]
        j += 1
        k += 1
      }
      for t in lo..<hi {
        arr[t] = buf[t]
      }
      lo += width * 2
    }
    width *= 2
  }
}

///|
/// JS Object 整数键遍历序: 升序数值(Map[Int,_] 的 keys 排序)
pub fn[T] sorted_keys(m : Map[Int, T]) -> Array[Int] {
  let ks : Array[Int] = []
  for k, _ in m {
    ks.push(k)
  }
  ks.sort()
  ks
}
