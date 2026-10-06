// 坦克状态桩直译(srv-sim.js:92-112 makeTank; 字段集 = sim-engine/ai 读写清单, 与 SF.Tank 同形)。
// JS 侧散落在对象上的子对象(modules/parts/stats/input)与协作挂载字段(ai/_pkBase/_buffs)
// 一律展开为可变字段/可变引用字段; 注释标 JS 原名。

///|
/// 输入 5 元组(srv-sim.js:228-238 clampInput 产物 / ai.js this.input 同形)
pub(all) struct Input {
  mut throttle : Double
  mut steer : Double
  mut aim_yaw : Double // aimYaw
  mut aim_pitch : Double // aimPitch
  mut fire : Bool
  mut hold_turret : Bool // input.holdTurret(本链恒 false, updateTank 消费)
}

///|
/// 玩家/敌人定义行(srv-sim create opts.players 条目)
pub(all) struct PlayerDef {
  id : Int
  name : String
  tank : String
  team : Int
}

///|
/// 增益槽(t._buffs[k] = {lv, t})
pub(all) struct Buff {
  mut lv : Int
  mut t : Double
}

///|
/// 坦克实例。JS 以 netId 键控 Map 承载; 对象同一性(ai.js keyOf 注册表)用单调 uid 承载。
pub(all) struct Tank {
  uid : Int // JS 对象同一性替身(全局单调计数)
  typ : String // t.type(CFG.vehicles 键)
  spec : VSpec // t.spec(共享引用; pkRecompute 会原地改写部分字段)
  net_id : Int // netId
  name : String
  mut x : Double
  mut z : Double
  mut y : Double
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
  mut gear : String // 'D1'/'D2'/'D3'/'R1'/'R2'/'N'
  mut shift_t : Double // shiftT
  mut flip_t : Double // flipT
  mut y_init : Bool // _yInit
  mut fall_v : Double // _fallV
  mut ram_t : Double // _ramT(初值 -9)
  mut hp : Double
  mut alive : Bool
  mut reload_t : Double // reloadT
  mut reload_total : Double // reloadTotal
  mut clip_left : Int // clipLeft
  mut clip_phase : String // clipPhase 'intra'/'long'/'single'
  mut disp : Double
  mut mod_track : Double // modules.track
  mut mod_engine : Double // modules.engine(Infinity = 永久毁伤哨兵)
  mut mod_gun : Double // modules.gun
  mut mod_ammo : Double // modules.ammo
  no_turret : Bool // parts.noTurret = spec.gunArc !== undefined
  team : Int
  is_player : Bool // isPlayer
  mut last_fire_t : Double // lastFireT(初值 -99)
  mut shots : Int // stats.shots
  mut hits : Int // stats.hits
  mut pens : Int // stats.pens
  mut dmg_dealt : Int // stats.dmgDealt
  mut input : Input
  mut ai : Ai? // t.ai(coop 敌车挂载)
  mut cr : Double? // t.cr(srv-sim makeTank 不设 → None; 空投拾取半径 || 1.5)
  mut id : Int? // t.id(srv-sim makeTank 不设 → None; keyOf 第一优先键)
  mut ai_id : Int? // t._aiId(keyOf 第二优先键; 本链不设)
  mut pk_base : VSpec? // t._pkBase(pkAttach 的 spec 深拷贝)
  mut buffs : Ref[Array[(String, Buff)]]? // t._buffs(插入序数组承载 for..in)
}

///|
/// JS 对象同一性计数器(uid 分配)
let g_uid : Ref[Int] = { val: 0, }

///|
fn next_uid() -> Int {
  g_uid.val += 1
  g_uid.val
}

///|
/// spec 深拷贝(srv-sim.js:384 pkAttach 的 JSON.parse(JSON.stringify(spec)));
/// pkRecompute 只消费 maxSpeed/accel/hullTraverse/turretTraverse/dispersion.aimTime/
/// dispersion.base/gun.reload/gun.autoloader, 全字段照抄保真。
pub fn spec_deep_copy(s : VSpec) -> VSpec {
  {
    typ: s.typ,
    name: s.name,
    nation: s.nation,
    cls: s.cls,
    tier: s.tier,
    tier_num: s.tier_num,
    hp: s.hp,
    max_speed: s.max_speed,
    reverse_ratio: s.reverse_ratio,
    accel: s.accel,
    brake: s.brake,
    coast_drag: s.coast_drag,
    hull_traverse: s.hull_traverse,
    turret_traverse: s.turret_traverse,
    gun_arc: s.gun_arc,
    turret_hull_lock: s.turret_hull_lock,
    gun_depression: s.gun_depression,
    gun_elevation: s.gun_elevation,
    gun: {
      pen: s.gun.pen,
      dmg: s.gun.dmg,
      reload: s.gun.reload,
      speed: s.gun.speed,
      cal: s.gun.cal,
      grav: s.gun.grav,
      splash: s.gun.splash,
      life: s.gun.life,
      autoloader: match s.gun.autoloader {
        Some(al) => Some({ clip: al.clip, intra: al.intra, long: al.long, })
        None => None
      },
    },
    sample: { l: s.sample.l, w: s.sample.w, },
    dispersion: {
      base: s.dispersion.base,
      aim_time: s.dispersion.aim_time,
      max: s.dispersion.max,
      move_: s.dispersion.move_,
      hull_turn: s.dispersion.hull_turn,
      turret_turn: s.dispersion.turret_turn,
      fire: s.dispersion.fire,
    },
    view: s.view,
    camo: s.camo,
  }
}

///|
/// makeTank (srv-sim.js:92-112)。opts = {x, z, yaw}; players 行为 pl。
pub fn make_tank(
  pl : PlayerDef,
  ox : Double,
  oz : Double,
  oyaw : Double,
) -> Tank {
  let spec = vehicle_get_or_sherman(pl.tank)
  let uid = next_uid()
  {
    uid,
    typ: pl.tank,
    spec,
    net_id: pl.id,
    name: pl.name,
    x: ox,
    z: oz,
    y: 0.0,
    yaw: oyaw,
    speed: 0.0,
    vel_x: 0.0,
    vel_z: 0.0,
    last_yaw_rate: 0.0,
    last_turret_rate: 0.0,
    turret_yaw: oyaw,
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
    clip_left: match spec.gun.autoloader {
      Some(al) => al.clip
      None => 0
    },
    clip_phase: match spec.gun.autoloader {
      Some(_) => "intra"
      None => "single"
    },
    disp: spec.dispersion.max,
    mod_track: 0.0,
    mod_engine: 0.0,
    mod_gun: 0.0,
    mod_ammo: 0.0,
    no_turret: spec.gun_arc is Some(_),
    team: if pl.team == 1 {
      1
    } else {
      0
    },
    is_player: false,
    last_fire_t: -99.0,
    shots: 0,
    hits: 0,
    pens: 0,
    dmg_dealt: 0,
    input: {
      throttle: 0.0,
      steer: 0.0,
      aim_yaw: oyaw,
      aim_pitch: 0.0,
      fire: false,
      hold_turret: false,
    },
    ai: None,
    cr: None,
    id: None,
    ai_id: None,
    pk_base: None,
    buffs: None,
  }
}
