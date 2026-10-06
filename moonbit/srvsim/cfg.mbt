// config.js (SF.CFG) 本链所需子集的直译: sim/armor/pickups/ai 配置 + 车辆规格结构。
// 数据主体在 cfg_data.mbt(由 config.js 机械导出); 本文件是结构与常量。
// 每个字段注释标 JS 原名; Infinity(永久毁伤/哨兵)用 inf()。

///|
/// JS ±Infinity(模块永久毁伤等); MoonBit 无 inf 字面量, 用溢出乘法(逐位 = +Infinity)
pub fn inf() -> Double {
  1.0e308 * 10.0
}

///|
/// JS Math.round 精确版(规范: floor(x)+1 当小数部分 ≥0.5; 不经 floor(x+0.5) 的 FP 加法
/// ——0.49999999999999994 这类输入在 JS 里 round 结果是 0 而不是 1)
pub fn js_round(x : Double) -> Double {
  let n = x.floor()
  let t = x - n
  if t >= 0.5 {
    n + 1.0
  } else {
    n
  }
}

///|
/// JS Math.sign
pub fn js_sign(x : Double) -> Double {
  if x > 0.0 {
    1.0
  } else if x < 0.0 {
    -1.0
  } else {
    x
  }
}

///|
pub(all) struct AutoLoader {
  clip : Int // al.clip
  mut intra : Double // al.intra
  mut long : Double // al.long
}

///|
pub(all) struct Gun {
  pen : Double
  dmg : Double
  mut reload : Double
  speed : Double
  cal : Double // 文件尾 IIFE: gun.cal = CAL[k] || 75
  grav : Double? // spec.grav(缺省走 CFG.sim.shellGravity)
  splash : Double? // spec.splash(|| 0)
  life : Double? // spec.life(|| 4)
  autoloader : AutoLoader? // gun.autoloader
}

///|
pub(all) struct Sample {
  l : Double
  w : Double
}

///|
pub(all) struct Dispersion {
  mut base : Double
  mut aim_time : Double // aimTime
  max : Double
  move_ : Double // move
  hull_turn : Double // hullTurn
  turret_turn : Double // turretTurn
  fire : Double
}

///|
/// 车辆规格(CFG.vehicles 条目)。pkRecompute 会写 max_speed/accel/hull_traverse/turret_traverse/
/// dispersion.aim_time/base/gun.reload/gun.autoloader.intra/long(JS 侧直接改共享 spec 对象,
/// 本直译同构: Spec 为可变结构, 同型车共享同一实例)。
pub(all) struct VSpec {
  typ : String // CFG.vehicles 的键(t.type)
  name : String
  nation : String
  cls : String
  tier : String // 罗』数字串(无 tier 车 = "")
  tier_num : Int // TIER_NUM(v.tier)(ROMAN 表; 缺失 = 0)
  mut hp : Double
  mut max_speed : Double // maxSpeed
  reverse_ratio : Double // reverseRatio
  mut accel : Double
  brake : Double
  coast_drag : Double // coastDrag
  mut hull_traverse : Double // hullTraverse
  mut turret_traverse : Double // turretTraverse
  gun_arc : Double? // gunArc(undefined ↔ None; parts.noTurret 判据)
  turret_hull_lock : Bool // turretHullLock(缺省 false)
  gun_depression : Double // gunDepression
  gun_elevation : Double // gunElevation
  gun : Gun
  sample : Sample
  dispersion : Dispersion
  view : Double // IIFE 后处理: view = VIEW[k] || 370
  camo : Double // IIFE 后处理: camo = CAMO_CLS[cls] || 0.12
}

///|
/// CFG.vehicles 查找: 线性扫描插入序数组(makeTank 的 `CFG.vehicles[name] || CFG.vehicles.sherman`)
pub fn vehicle_get(name : String) -> VSpec? {
  for i, e in vehicles_data {
    let _ = i
    if e.typ == name {
      return Some(e)
    }
  }
  None
}

///|
/// makeTank 的 fallback: `SF.CFG.vehicles[pl.tank] || SF.CFG.vehicles.sherman`
pub fn vehicle_get_or_sherman(name : String) -> VSpec {
  match vehicle_get(name) {
    Some(s) => s
    None => vehicle_get("sherman").unwrap()
  }
}

///|
/// CFG.sim(config.js:6-13)
pub(all) struct SimCfg {
  dt : Double
  shell_gravity : Double // shellGravity
  max_slope : Double // maxSlope
  fall : FallCfg
  gearbox : GearboxCfg
}

///|
pub(all) struct FallCfg {
  safe_v : Double // safeV
  k : Double
  track_v : Double // trackV
  track_chance : Double // trackChance
}

///|
pub(all) struct GearboxCfg {
  fwd : Array[Double] // fwd
  rev : Array[Double] // rev
  torque_f : Array[Double] // torqueF
  torque_r : Array[Double] // torqueR
  pause : Double
}

///|
let sim_cfg : SimCfg = {
  dt: 1.0 / 60.0,
  shell_gravity: 3.2,
  max_slope: 0.63,
  fall: { safe_v: 9.0, k: 4.0, track_v: 11.5, track_chance: 0.5, },
  gearbox: {
    fwd: [0.42, 0.72, 1.0],
    rev: [0.58, 1.0],
    torque_f: [1.25, 1.0, 0.9],
    torque_r: [1.15, 1.0],
    pause: 0.15,
  },
}

///|
/// CFG.armor(config.js:1136-1152)
pub(all) struct ArmorCfg {
  ricochet_angle : Double // ricochetAngle
  pen_variance : Double // penVariance
  dmg_variance : Double // dmgVariance
  track_duration : Double // modules.track.duration
  engine_slow : Double // modules.engine.slow
  engine_rear_chance : Double // modules.engine.rearChance
  ammo_chance : Double // modules.ammo.chance
  ammo_dmg_mult : Double // modules.ammo.dmgMult
  ammo_reload_mult : Double // modules.ammo.reloadMult
  gun_disp_penalty : Double // modules.gun.dispPenalty
}

///|
let armor_cfg : ArmorCfg = {
  ricochet_angle: 70.0 * @math.PI / 180.0,
  pen_variance: 0.25,
  dmg_variance: 0.25,
  track_duration: 6.0,
  engine_slow: 0.55,
  engine_rear_chance: 0.55,
  ammo_chance: 0.08,
  ammo_dmg_mult: 1.6,
  ammo_reload_mult: 1.25,
  gun_disp_penalty: 1.6,
}

///|
/// CFG.pickups(config.js:1310-1348)。weights 保有数组(插入序 = JS 对象字面量序,
/// pkPickType 的 for..in 消费次序敏感)。
pub(all) struct PickupsCfg {
  first_delay : Double // firstDelay
  interval_lo : Double // interval[0]
  interval_hi : Double // interval[1]
  max_on_field : Int // maxOnField
  lifetime : Double
  radius : Double
  spawn_ring_lo : Double // spawnRing[0]
  spawn_ring_hi : Double // spawnRing[1]
  drop_dist : Double // dropDist
  fall_speed : Double // fallSpeed
  repair_heal : Double // repairHeal
  buff_dur : Double // buffDur
  max_stack : Int // maxStack
  weights : Array[(String, Double)] // weights(插入序)
  need_repair_mul : Double // needRepairMul
  full_hp_mul : Double // fullHpMul
  eff_speed_max_speed : Double // effects.speed.maxSpeed
  eff_speed_accel : Double // effects.speed.accel
  eff_mobility_traverse : Double // effects.mobility.traverse
  eff_aim_aim_time : Double // effects.aim.aimTime
  eff_aim_base : Double // effects.aim.base
  eff_load_reload : Double // effects.load.reload
}

///|
let pickups_cfg : PickupsCfg = {
  first_delay: 5.0,
  interval_lo: 12.0,
  interval_hi: 20.0,
  max_on_field: 3,
  lifetime: 40.0,
  radius: 5.0,
  spawn_ring_lo: 35.0,
  spawn_ring_hi: 100.0,
  drop_dist: 70.0,
  fall_speed: 34.0,
  repair_heal: 0.4,
  buff_dur: 35.0,
  max_stack: 2,
  weights: [
    ("repair", 22.0),
    ("speed", 20.0),
    ("aim", 20.0),
    ("mobility", 19.0),
    ("load", 19.0),
  ],
  need_repair_mul: 2.5,
  full_hp_mul: 0.45,
  eff_speed_max_speed: 1.25,
  eff_speed_accel: 1.25,
  eff_mobility_traverse: 1.3,
  eff_aim_aim_time: 0.65,
  eff_aim_base: 0.85,
  eff_load_reload: 0.8,
}

///|
/// CFG.ai(config.js:1156-1330)本链被读字段的直译(ai.js 全部旋钮)
pub(all) struct AiCfg {
  view_range : Double // viewRange
  reaction_time : Double // reactionTime
  shot_hearing : Double // shotHearing
  search_time : Double // searchTime
  memory_time : Double // memoryTime
  radio_cooldown : Double // radio.cooldown
  perception_interval : Double // perceptionInterval
  weak_on : Int // weakpoint.on
  weak_front_deg : Double // weakpoint.frontDeg
  weak_side_deg : Double // weakpoint.sideDeg
  weak_low_y : Double // weakpoint.lowY
  weak_side_y : Double // weakpoint.sideY
  weak_rear_y : Double // weakpoint.rearY
  weak_track_y : Double // weakpoint.trackY
  weak_track_quota_s : Double // weakpoint.trackQuotaS
  trade_on : Int // trade.on
  trade_kill_mult : Double // trade.killMult
  trade_shy_ratio : Double // trade.shyRatio
  trade_shy_hold_mul : Double // trade.shyHoldMul
  trade_bully_margin : Double // trade.bullyMargin
  trade_bully_score : Double // trade.bullyScore
  trade_shy_max_s : Double // trade.shyMaxS
  skill_level : Double // skill.level
  angle_on : Int // angle.on
  angle_deg_mid : Double // angle.degMid
  angle_deg_max : Double // angle.degMax
  angle_settle_s : Double // angle.settleS
  angle_deadzone_deg : Double // angle.deadzoneDeg
  angle_max_frac_of_reload : Double // angle.maxFracOfReload
  angle_td_mul : Double // angle.tdMul
  fd_on : Int // fireDisc.on
  fd_recheck_s : Double // fireDisc.recheckS
  fd_rearm_s : Double // fireDisc.rearmS
  fd_rearm_brawl_s : Double // fireDisc.rearmBrawlS
  fd_settle_s : Double // fireDisc.settleS
  fd_rearm_min_hidden_s : Double // fireDisc.rearmMinHiddenS
  fd_snap_s : Double // fireDisc.snapS
  class_band : Array[(String, (Double, Double))] // classBand(插入序)
  crossfire_on : Int // crossfire.on
  crossfire_min_angle_sep : Double // crossfire.minAngleSep
  crossfire_push_out_deg : Double // crossfire.pushOutDeg
  crossfire_plug_window_s : Double // crossfire.plugWindowS
  focus_on : Int // focus.on
  focus_update_s : Double // focus.updateS
  focus_memory_s : Double // focus.memoryS
  focus_max_per_target : Int // focus.maxPerTarget
  focus_switch_s : Double // focus.switchS
  focus_slot_hyst_s : Double // focus.slotHystS
  role_on : Int // role.on
  role_recompute_s : Double // role.recomputeS
  role_yield_hp_pct : Double // role.yieldHpPct
  role_line_min_frac : Double // role.lineMinFrac
  role_band_mix : Double // role.bandMix
  role_td_depth_lo : Double // role.tdDepth[0]
  role_td_depth_hi : Double // role.tdDepth[1]
  role_td_rank_bias : Int // role.tdRankBias
  role_ht_rank_bias : Int // role.htRankBias
  role_squad_line_n : Int // role.squadLineN
  cover_on : Int // cover.on
  cover_max_cover_dist : Double // cover.maxCoverDist
  cover_hide_check_s : Double // cover.hideCheckS
  cover_peek_side_off : Double // cover.peekSideOff
  cover_cand_n : Int // cover.candN
  cover_bush_affinity : Double // cover.bushAffinity
  cover_min_dist_frac : Double // cover.minDistFrac
  cover_suppress_memory_timeout : Double // cover.suppressMemoryTimeout
  cover_hide_frac_cls : Array[(String, Double)] // cover.hideFracCls(插入序)
  cover_peek_pad : Double // cover.peekPad
  cover_peek_march_m : Double // cover.peekMarchM
  preaim_on : Int // preAim.on
  preaim_cap_steer : Double // preAim.capSteer
  tactics_on : Int // tactics.on
  tactics_recheck_s : Double // tactics.recheckS
  hill_min_adv : Double // tactics.hill.minAdv
  hill_min_n : Int // tactics.hill.minN
  hill_rally_s : Double // tactics.hill.rallyS
  hill_plan_s : Double // tactics.hill.planS
  hill_auth_hold_s : Double // tactics.hill.authHoldS
  cover_flank_after_s : Double // tactics.coverFlank.afterS
  lane_on : Int // tactics.lane.on
  chain_on : Int // tactics.coverChain.on
  chain_hop_max : Double // tactics.coverChain.hopMax
  chain_step_min : Double // tactics.coverChain.stepMin
  cls_armor : Array[(String, Double)] // clsArmor(插入序)
}

///|
/// CFG.ai 逐字段落盘(config.js:1156-1330 原值)
let ai_cfg : AiCfg = {
  view_range: 400.0,
  reaction_time: 0.35,
  shot_hearing: 9999.0,
  search_time: 26.0,
  memory_time: 7.0,
  radio_cooldown: 6.0,
  perception_interval: 0.13,
  weak_on: 1,
  weak_front_deg: 45.0,
  weak_side_deg: 110.0,
  weak_low_y: 0.6,
  weak_side_y: 1.0,
  weak_rear_y: 0.9,
  weak_track_y: 0.35,
  weak_track_quota_s: 2.0,
  trade_on: 1,
  trade_kill_mult: 1.2,
  trade_shy_ratio: 0.85,
  trade_shy_hold_mul: 1.6,
  trade_bully_margin: 1.08,
  trade_bully_score: 1.6,
  trade_shy_max_s: 12.0,
  skill_level: 1.0,
  angle_on: 1,
  angle_deg_mid: 28.5,
  angle_deg_max: 35.0,
  angle_settle_s: 0.45,
  angle_deadzone_deg: 10.0,
  angle_max_frac_of_reload: 0.55,
  angle_td_mul: 0.8,
  fd_on: 1,
  fd_recheck_s: 0.2,
  fd_rearm_s: 0.3,
  fd_rearm_brawl_s: 0.15,
  fd_settle_s: 1.5,
  fd_rearm_min_hidden_s: 0.4,
  fd_snap_s: 1.2,
  class_band: [
    ("LT", (55.0, 150.0)),
    ("MT", (70.0, 190.0)),
    ("HT", (60.0, 160.0)),
    ("TD", (130.0, 300.0)),
    ("SPG", (150.0, 330.0)),
  ],
  crossfire_on: 1,
  crossfire_min_angle_sep: 30.0,
  crossfire_push_out_deg: 35.0,
  crossfire_plug_window_s: 10.0,
  focus_on: 1,
  focus_update_s: 0.3,
  focus_memory_s: 5.0,
  focus_max_per_target: 3,
  focus_switch_s: 1.0,
  focus_slot_hyst_s: 0.8,
  role_on: 1,
  role_recompute_s: 0.8,
  role_yield_hp_pct: 0.3,
  role_line_min_frac: 0.34,
  role_band_mix: 0.5,
  role_td_depth_lo: 60.0,
  role_td_depth_hi: 110.0,
  role_td_rank_bias: 2,
  role_ht_rank_bias: -1,
  role_squad_line_n: 2,
  cover_on: 1,
  cover_max_cover_dist: 45.0,
  cover_hide_check_s: 0.2,
  cover_peek_side_off: 3.0,
  cover_cand_n: 10,
  cover_bush_affinity: 0.5,
  cover_min_dist_frac: 0.6,
  cover_suppress_memory_timeout: 1.0,
  cover_hide_frac_cls: [("HT", 0.55), ("MT", 0.65), ("TD", 0.7)],
  cover_peek_pad: 0.3,
  cover_peek_march_m: 8.0,
  preaim_on: 1,
  preaim_cap_steer: 0.14,
  tactics_on: 1,
  tactics_recheck_s: 0.3,
  hill_min_adv: 1.5,
  hill_min_n: 2,
  hill_rally_s: 3.0,
  hill_plan_s: 8.0,
  hill_auth_hold_s: 2.0,
  cover_flank_after_s: 2.5,
  lane_on: 1,
  chain_on: 1,
  chain_hop_max: 45.0,
  chain_step_min: 12.0,
  cls_armor: [
    ("LT", 55.0),
    ("MT", 95.0),
    ("TD", 120.0),
    ("HT", 160.0),
    ("SPG", 40.0),
  ],
}

///|
/// 性格表(CFG.ai.personalities; ai.js 构造时按 def.personality 取)
pub(all) struct Personality {
  band : (Double, Double) // band[lo, hi]
  flank_chance : Double // flankChance
  aim_patience : Double // aimPatience
  lead_skill : Double // leadSkill
  retreat_hp : Double // retreatHp
  hold_ground : Bool // holdGround
  angle_skill : Double // angleSkill
}

///|
fn personalities() -> Array[(String, Personality)] {
  [
    (
      "flanker",
      {
        band: (55.0, 115.0),
        flank_chance: 0.55,
        aim_patience: 0.78,
        lead_skill: 0.78,
        retreat_hp: 0.2,
        hold_ground: false,
        angle_skill: 0.85,
      },
    ),
    (
      "sniper",
      {
        band: (190.0, 300.0),
        flank_chance: 0.0,
        aim_patience: 1.0,
        lead_skill: 1.0,
        retreat_hp: 0.14,
        hold_ground: true,
        angle_skill: 1.0,
      },
    ),
    (
      "hold",
      {
        band: (70.0, 130.0),
        flank_chance: 0.2,
        aim_patience: 0.88,
        lead_skill: 0.9,
        retreat_hp: 0.16,
        hold_ground: true,
        angle_skill: 1.15,
      },
    ),
  ]
}

///|
/// SF.CFG.ai.personalities[def.personality] || SF.CFG.ai.personalities.flanker
pub fn personality_of(name : String) -> Personality {
  let ps = personalities()
  let mut fallback = ps[0].1
  for i, kv in ps {
    if kv.0 == name {
      let _ = i
      return kv.1
    }
    if kv.0 == "flanker" {
      fallback = kv.1
    }
  }
  fallback
}

///|
/// CFG.ai.classBand[cls] || [70, 190] 式查表
pub fn class_band_of(cls : String) -> (Double, Double) {
  for kv in ai_cfg.class_band {
    if kv.0 == cls {
      return kv.1
    }
  }
  (70.0, 190.0)
}

///|
/// CFG.ai.clsArmor[cls] 查表(无则调用方缺省 95)
pub fn cls_armor_of(cls : String) -> Double? {
  for kv in ai_cfg.cls_armor {
    if kv.0 == cls {
      return Some(kv.1)
    }
  }
  None
}

///|
/// CFG.ai.cover.hideFracCls[cls] 查表(JS `|| 0.6`)
pub fn hide_frac_cls_of(cls : String) -> Double? {
  for kv in ai_cfg.cover_hide_frac_cls {
    if kv.0 == cls {
      return Some(kv.1)
    }
  }
  None
}
