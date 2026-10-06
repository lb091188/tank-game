// CFG 常量(config.js)直译 —— simengine 夹具场景消费的子集; 注释标原键位。
// 数值一律保留 JS 源的字面量与常量表达式(角度 = deg * Math.PI / 180 逐式)。

///|
/// CFG.sim.maxSlope (config.js:8): ~36° 超过则无法爬坡
pub const MAX_SLOPE : Double = 0.63

///|
/// CFG.sim.shellGravity (config.js:5): 炮弹重力(WoT 风格弱下坠)
pub const SHELL_GRAVITY : Double = 3.2

///|
/// CFG.sim.fall (config.js:9): 落地冲击 >9m/s 开始摔伤, 伤害=(v-9)²×4; >11.5m/s 半数断带
pub const FALL_SAFE_V : Double = 9.0

///|
pub const FALL_K : Double = 4.0

///|
pub const FALL_TRACK_V : Double = 11.5

///|
pub const FALL_TRACK_CHANCE : Double = 0.5

///|
/// CFG.sim.gearbox (config.js:12): 前进 D1/D2/D3=极速的 42%/72%/100%, 倒车 R1/R2=58%/100%
let gb_fwd : Array[Double] = [0.42, 0.72, 1.0]

///|
let gb_rev : Array[Double] = [0.58, 1.0]

///|
/// 低挡扭力倍率
let gb_torque_f : Array[Double] = [1.25, 1.0, 0.9]

///|
let gb_torque_r : Array[Double] = [1.15, 1.0]

///|
/// 升挡 0.15s 扭矩中断
let gb_pause : Double = 0.15

///|
/// CFG.armor.modules.engine.slow (config.js:1146): 发动机损毁极速系数
pub const ARMOR_ENGINE_SLOW : Double = 0.55

///|
/// CFG.armor.modules.ammo.reloadMult (config.js:1148): 弹药架受损装填变慢
pub const ARMOR_AMMO_RELOAD_MULT : Double = 1.25

///|
/// CFG.armor.modules.gun.dispPenalty (config.js:1150): 火炮受损扩圈系数
pub const ARMOR_GUN_DISP_PENALTY : Double = 1.6

///|
/// CFG.vehicles 查表(config.js:16-1130)。夹具仅需 pz4/stug3 两型, 其余车型后续按同式补。
pub fn vehicle_spec(typ : String) -> Spec? {
  match typ {
    // pz4 四号 H 型 (config.js:68-77)
    "pz4" =>
      Some({
        typ: "pz4",
        cls: "MT",
        hp: 720.0,
        max_speed: 11.67,
        reverse_ratio: 0.42,
        accel: 3.6,
        brake: 9.0,
        coast_drag: 5.2,
        hull_traverse: 38.0 * @math.PI / 180.0,
        turret_traverse: 35.0 * @math.PI / 180.0,
        gun_depression: -12.0 * @math.PI / 180.0,
        gun_elevation: 15.0 * @math.PI / 180.0,
        gun_arc: None,
        turret_hull_lock: false,
        sample_l: 3.05,
        sample_w: 1.5,
        disp_base: 0.40,
        disp_aim_time: 2.3,
        disp_max: 2.4,
        disp_move: 1.5,
        disp_hull_turn: 1.1,
        disp_turret_turn: 0.55,
        disp_fire: 1.6,
        gun_reload: 3.4,
        gun_autoloader: None,
        gun_pen: 106.0,
        gun_dmg: 110.0,
        gun_cal: None,
        gun_speed: 790.0,
        gun_life: None,
        gun_grav: None,
        gun_splash: None,
      })
    // stug3 三号突击炮 (config.js:103-112; 固定战斗室 gunArc=±10°)
    "stug3" =>
      Some({
        typ: "stug3",
        cls: "TD",
        hp: 700.0,
        max_speed: 11.11,
        reverse_ratio: 0.42,
        accel: 3.6,
        brake: 9.0,
        coast_drag: 5.2,
        hull_traverse: 37.0 * @math.PI / 180.0,
        turret_traverse: 0.45 * @math.PI / 180.0,
        gun_depression: -10.0 * @math.PI / 180.0,
        gun_elevation: 15.0 * @math.PI / 180.0,
        gun_arc: Some(10.0 * @math.PI / 180.0),
        turret_hull_lock: false,
        sample_l: 3.05,
        sample_w: 1.5,
        disp_base: 0.40,
        disp_aim_time: 2.3,
        disp_max: 2.4,
        disp_move: 1.5,
        disp_hull_turn: 1.1,
        disp_turret_turn: 0.55,
        disp_fire: 1.6,
        gun_reload: 5.4,
        gun_autoloader: None,
        gun_pen: 132.0,
        gun_dmg: 200.0,
        gun_cal: None,
        gun_speed: 790.0,
        gun_life: None,
        gun_grav: None,
        gun_splash: None,
      })
    _ => None
  }
}
