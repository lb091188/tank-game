// sim-engine.js 直译的数据类型: JS 侧为普通对象字面量, 这里以 struct/enum 承载。
// 字段注释标注 JS 原名; mut 字段 = 引擎逐帧读写的状态(与 SF.Tank 宿主同形)。

///|
pub(all) struct Vec3 {
  mut x : Double
  mut y : Double
  mut z : Double
}

///|
/// 旋转基(列向量约定: local = Rᵀ·world; sim-engine.js axesYXZ/axesRY/axesRX/mulAxes/axesQuat 产物)
pub(all) struct Axes {
  ex : Vec3
  ey : Vec3
  ez : Vec3
}

///|
/// OBB 框架(sim-engine.js tankOBBFrames 的 f.hull/f.turret/f.gun)
pub(all) struct Frame {
  base : Vec3
  r : Axes
}

///|
pub(all) struct ObbFrames {
  hull : Frame
  turret : Frame
  gun : Frame
}

///|
/// rayOBB3D 返回值(sim-engine.js:548): t + 命中点 + 面法线
pub(all) struct RayHit {
  t : Double
  point : Vec3
  normal : Vec3
}

///|
/// probeTankOBB 返回值(sim-engine.js:593)
pub(all) struct ObbHit {
  distance : Double
  point : Vec3
  normal : Vec3
  zone : String
  armor : Double
}

///|
/// SF.Util OBB 约定(config.js:1470-1472): { x, z, yaw, hx(半宽·左舷), hz(半长·前进) }
pub(all) struct Obb2d {
  mut x : Double
  mut z : Double
  yaw : Double
  hx : Double
  hz : Double
}

///|
/// CFG.partBoxes[t.type].zones[*] 的部位盒(build-models.js --part-boxes 产物)
pub(all) struct ZoneBox {
  z : String // z.z(部位名)
  armor : Double
  c : (Double, Double, Double) // z.c 盒中心(父空间)
  h : (Double, Double, Double) // z.h 半尺寸
  p : String // z.p 所属空间 'root'|'turret'|'gun'
  q : (Double, Double, Double, Double)? // z.q 可选姿态四元数
}

///|
/// CFG.partBoxes[t.type] 条目(partboxes.json 解析产物; 缺键 → probe 走兜底三盒)
pub(all) struct PartBoxEntry {
  turret_pivot : (Double, Double, Double)? // tb.turretPivot(stug3 为 null → 兜底 [0,1.5,0])
  gun_pivot : (Double, Double, Double)? // tb.gunPivot(缺 → 兜底 [0,0.4,1])
  gun_parent : String? // tb.gunParent(缺 → 'turret')
  zones : Array[ZoneBox]? // tb.zones(缺 → 兜底三盒)
}

///|
/// CFG.vehicles[*].gun.autoloader(弹夹炮; pz4/stug3 无)
pub(all) struct Autoloader {
  clip : Int
  intra : Double
  long : Double
}

///|
/// CFG.vehicles[*] 直译(引擎读到的字段集; gun/dispersion 子对象平铺, 注释标原名)
pub(all) struct Spec {
  typ : String // CFG.vehicles 键名(= t.type)
  cls : String // massOf 的 DENS 查表键
  hp : Double
  max_speed : Double // spec.maxSpeed
  reverse_ratio : Double // spec.reverseRatio
  accel : Double
  brake : Double
  coast_drag : Double // spec.coastDrag
  hull_traverse : Double // spec.hullTraverse
  turret_traverse : Double // spec.turretTraverse
  gun_depression : Double // spec.gunDepression
  gun_elevation : Double // spec.gunElevation
  gun_arc : Double? // spec.gunArc(undefined → None; noTurret 判定用)
  turret_hull_lock : Bool // spec.turretHullLock(缺省 false)
  sample_l : Double // spec.sample.l
  sample_w : Double // spec.sample.w
  disp_base : Double // spec.dispersion.base
  disp_aim_time : Double // spec.dispersion.aimTime
  disp_max : Double // spec.dispersion.max
  disp_move : Double // spec.dispersion.move
  disp_hull_turn : Double // spec.dispersion.hullTurn
  disp_turret_turn : Double // spec.dispersion.turretTurn
  disp_fire : Double // spec.dispersion.fire
  gun_reload : Double // spec.gun.reload
  gun_autoloader : Autoloader? // spec.gun.autoloader
  gun_pen : Double // spec.gun.pen
  gun_dmg : Double // spec.gun.dmg
  gun_cal : Double? // spec.gun.cal(undefined → || 75)
  gun_speed : Double // spec.gun.speed
  gun_life : Double? // spec.gun.life(|| 4)
  gun_grav : Double? // spec.gun.grav(|| CFG.sim.shellGravity)
  gun_splash : Double? // spec.gun.splash(|| 0)
}

///|
/// 车辆状态宿主(JS t 对象; 字段即状态, 与 SF.Tank 同形 → 全代码库零改动可读)
pub(all) struct Tank {
  tag : Int // JS 对象同一性(o === t)的承载; 构造处发号(场景内唯一)
  typ : String // t.type
  spec : Spec
  mut x : Double
  mut z : Double
  mut y : Double
  mut yaw : Double
  mut speed : Double
  // JS velX/velZ(表现层预判字段, 引擎不读写)不承载
  mut last_yaw_rate : Double // t.lastYawRate
  mut last_turret_rate : Double // t.lastTurretRate
  mut turret_yaw : Double // t.turretYaw
  mut gun_pitch : Double // t.gunPitch
  mut pitch : Double
  mut roll : Double
  mut track_offset : Double // t.trackOffset(表现层履带相位, 经 onMoved 钩子写)
  mut gear : String // 'D1'/'D2'/'D3'/'R1'/'R2'/'N'
  mut shift_t : Double // t.shiftT
  mut flip_t : Double // t.flipT
  mut y_init : Bool // t._yInit
  mut fall_v : Double // t._fallV(坠落垂直速度)
  mut ram_t : Double // t._ramT(撞击结算冷却)
  mut hp : Double
  mut alive : Bool
  mut reload_t : Double // t.reloadT
  mut reload_total : Double // t.reloadTotal
  mut clip_left : Int // t.clipLeft
  mut clip_phase : String // t.clipPhase 'intra'/'long'/'single'
  mut disp : Double
  mut mod_track : Double // t.modules.track(Infinity = 永久毁伤)
  mut mod_engine : Double // t.modules.engine
  mut mod_gun : Double // t.modules.gun
  mut mod_ammo : Double // t.modules.ammo
  no_turret : Bool // t.parts.noTurret(固定战斗室)
  mut obb_fallback : Bool // t._obbFallback(引擎内只写不读的兜底标记)
  team : Int
  net_id : Int // t.netId
  is_player : Bool // t.isPlayer
  mut st_shots : Int // t.stats.shots
  mut st_hits : Int // t.stats.hits
  mut st_pens : Int // t.stats.pens
  mut st_dmg_dealt : Double // t.stats.dmgDealt
  mut last_fire_t : Double // t.lastFireT(引擎不读写, 场景/直译宿主承载)
}

///|
/// updateTank 的 input 参数(vehicle.js 薄壳注入; fire 由薄壳在 update 返回后按同位序消费)
pub(all) struct Input {
  mut throttle : Double
  mut steer : Double
  mut aim_yaw : Double // input.aimYaw
  mut aim_pitch : Double // input.aimPitch
  mut fire : Bool // 引擎不读, 薄壳同位序消费
  mut hold_turret : Bool // input.holdTurret(缺省 falsy)
}

///|
/// emit 事件载荷(sim-engine.js 各 emit 调用点; JS d.shooter/d.module 可为 null → None)
pub(all) struct FireEv {
  tank : Tank
  pos : Vec3
  dir : Vec3
}

///|
pub(all) struct ReloadedEv {
  tank : Tank
}

///|
pub(all) struct RamEv {
  shooter : Tank
  target : Tank
  dmg : Int
}

///|
pub(all) struct DestroyedEv {
  tank : Tank
  shooter : Tank?
}

///|
pub(all) struct HitEv {
  target : Tank
  shooter : Tank?
  point : Vec3
  zone : String
  dmg : Int
  kind : String
  module_ : String? // JS d.module
}

///|
pub(all) enum EventData {
  Fire(FireEv)
  Reloaded(ReloadedEv)
  Ram(RamEv)
  Destroyed(DestroyedEv)
  Hit(HitEv)
}

///|
/// updateTank 的 env 参数(sim-engine.js:15-16 约定: terrain/coversList/tanks/time/emit?/
/// onMoved?/takeRam?)。emit 为必填(JS 缺省落 SF.Bus, 夹具恒显式注入)。
pub(all) struct Env {
  terrain : @simcore.Terrain
  covers_list : @simcore.CoverList // env.coversList
  tanks : Array[Tank]
  time : Double
  emit : (String, EventData) -> Unit
  on_moved : ((Tank, Double) -> Unit)? // env.onMoved
  take_ram : ((Tank, Tank, Int) -> Unit)? // env.takeRam
}

///|
/// 炮弹(makeShells.spawn 的 sh 对象; tracer 为表现层拖尾指针, 引擎不读写, 不承载)
pub(all) struct Shell {
  mut active : Bool
  owner : Tank
  team : Int
  mut pos : Vec3
  mut vel : Vec3
  mut pen : Double
  mut dmg : Double
  cal : Double // spec.cal || 75
  mut life : Double
  grav : Double // spec.grav || CFG.sim.shellGravity
  mut warned : Bool // sh.warned(初值 undefined → false)
  splash : Double // spec.splash || 0
  disp_at_fire : Double // _dispAtFire
}

///|
/// 炮弹场 hooks(sim-engine.js:362-364; 全可缺, JS 侧以 if 判空)。
/// 字段类型 = 可选的函数值(注意 `((A) -> B)?` 的括号: `A -> B?` 会被解析为返回 Option 的函数)。
pub(all) struct Hooks {
  on_create : ((Shell) -> Unit)?
  on_flight : ((Shell) -> Unit)?
  on_impact : ((String, Vec3) -> Unit)?
  on_player_miss : ((Vec3) -> Unit)?
  on_near_miss : ((Shell) -> Unit)?
  on_kill : ((Shell) -> Unit)?
  probe_tank : ((
    Shell,
    Tank,
    Double,
    Double,
    Double,
    Double,
    Double,
    Double,
    Double,
  ) -> ObbHit?)?
  on_hit_tank : ((Shell, Tank, ObbHit, Vec3) -> Unit)?
  on_explode : ((Shell, Vec3, Tank?, Double) -> Unit)?
}

///|
/// makeShells 的弹场对象(list + capped + spawn/update; JS 返回对象字面量)
pub struct Shells {
  mut list : Array[Shell]
  cap : Int // maxShells || 96
  hooks : Hooks
}

///|
/// Shells::update 的 env 参数(sim-engine.js:365: heightAt/coversBlocked/tanks/playerPos/playerTeam)
pub(all) struct ShellEnv {
  height_at : (Double, Double) -> Double
  covers_blocked : (Double, Double, Double, Double, Double, Double, Double) -> Double // (ox,oz,oy,dx,dz,len,dy)
  tanks : Array[Tank]
  player_pos : Tank? // env.playerPos(存活对象引用, 引擎读 .x/.z; JS 真值语义)
  player_team : Int
}

///|
/// fire 的 world 参数; JS (world.shells && world.shells.field) || world.shells 的解析结果
/// (浏览器=SF.Shells 壳内弹场, 无头=纯弹场直挂)
pub(all) struct World {
  shells_field : Shells
}
