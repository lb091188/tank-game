// SF.CFG 子树直录(client/js/config.js) —— 本包消费到的字段逐一抄录, 数值以 JS 源表达式
// 原样书写(38.0 * @math.PI / 180.0 等保持同一 double 运算次序), 不预折算。

///|
/// SF.CFG.sim (config.js:6-13)
pub(all) struct SimCfg {
  shell_gravity : Double // shellGravity
  max_slope : Double // maxSlope
  fall_safe_v : Double // fall.safeV
  fall_k : Double // fall.k
  fall_track_v : Double // fall.trackV
  fall_track_chance : Double // fall.trackChance
  gb_fwd : Array[Double] // gearbox.fwd
  gb_rev : Array[Double] // gearbox.rev
  gb_torque_f : Array[Double] // gearbox.torqueF
  gb_torque_r : Array[Double] // gearbox.torqueR
  gb_pause : Double // gearbox.pause
}

///|
/// SF.CFG.vehicles.pz4 的 spec 子集(config.js:65-73) + 引擎/AI 消费的可选字段。
/// 缺省字段(JS undefined)以 Option 承载: gunArc/turretHullLock/camo/view/cal/grav/splash/life/autoloader。
pub(all) struct GunSpec {
  pen : Double
  dmg : Double
  reload : Double
  speed : Double
  cal : Double? // gun.cal
  grav : Double? // gun.grav
  splash : Double? // gun.splash
  life : Double? // gun.life
  autoloader : AutoSpec? // gun.autoloader
}

///|
pub(all) struct AutoSpec {
  clip : Int
  intra : Double
  long : Double
}

///|
pub(all) struct SampleSpec {
  l : Double
  w : Double
}

///|
pub(all) struct DispSpec {
  base : Double
  aim_time : Double // aimTime
  max : Double
  dmove : Double // JS dispersion.move(reserved word 规避改名)
  hull_turn : Double // hullTurn
  turret_turn : Double // turretTurn
  fire : Double
}

///|
pub(all) struct Spec {
  cls : String
  hp : Double
  max_speed : Double // maxSpeed
  reverse_ratio : Double // reverseRatio
  accel : Double
  brake : Double
  coast_drag : Double // coastDrag
  hull_traverse : Double // hullTraverse
  turret_traverse : Double // turretTraverse
  gun_depression : Double // gunDepression
  gun_elevation : Double // gunElevation
  gun_arc : Double? // gunArc(歼击车固定战斗室)
  turret_hull_lock : Bool // turretHullLock
  gun : GunSpec
  sample : SampleSpec
  dispersion : DispSpec
  camo : Double? // spec.camo(隐蔽加成车)
  view : Double? // spec.view(视距覆盖)
}

///|
/// pz4 spec(config.js:65-73 原式直录)
pub fn spec_pz4() -> Spec {
  {
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
    gun: {
      pen: 106.0,
      dmg: 110.0,
      reload: 3.4,
      speed: 790.0,
      cal: None,
      grav: None,
      splash: None,
      life: None,
      autoloader: None,
    },
    sample: { l: 3.05, w: 1.5, },
    dispersion: {
      base: 0.40,
      aim_time: 2.3,
      max: 2.4,
      dmove: 1.5,
      hull_turn: 1.1,
      turret_turn: 0.55,
      fire: 1.6,
    },
    camo: None,
    view: None,
  }
}

///|
/// SF.CFG.armor (config.js:1136-1147)
pub(all) struct ArmorCfg {
  ricochet_angle : Double // ricochetAngle
  pen_variance : Double // penVariance
  dmg_variance : Double // dmgVariance
  track_duration : Double // modules.track.duration
  engine_rear_chance : Double // modules.engine.rearChance
  ammo_chance : Double // modules.ammo.chance
  ammo_dmg_mult : Double // modules.ammo.dmgMult
  ammo_reload_mult : Double // modules.ammo.reloadMult
  gun_disp_penalty : Double // modules.gun.dispPenalty
  engine_slow : Double // modules.engine.slow
}

///|
/// SF.CFG.ai (config.js:1150-1276) —— ai.js 消费的全部子树
pub(all) struct Personality {
  band : (Double, Double)
  flank_chance : Double // flankChance
  aim_patience : Double // aimPatience
  lead_skill : Double // leadSkill
  retreat_hp : Double // retreatHp
  hold_ground : Bool // holdGround
  angle_skill : Double // angleSkill
}

///|
pub(all) struct AiCfg {
  view_range : Double // viewRange
  reaction_time : Double // reactionTime
  memory_time : Double // memoryTime
  shot_hearing : Double // shotHearing
  search_time : Double // searchTime
  radio_cooldown : Double // radio.cooldown
  perception_interval : Double // perceptionInterval
  spot_player_margin : Double // spot.playerMargin
  // weakpoint (config.js:1162)
  wp_on : Int
  wp_front_deg : Double // frontDeg
  wp_side_deg : Double // sideDeg
  wp_low_y : Double // lowY
  wp_side_y : Double // sideY
  wp_rear_y : Double // rearY
  wp_track_y : Double // trackY
  wp_track_quota_s : Double // trackQuotaS
  // trade (config.js:1170)
  trade_on : Int
  trade_kill_mult : Double // killMult
  trade_shy_ratio : Double // shyRatio
  trade_shy_hold_mul : Double // shyHoldMul
  trade_bully_margin : Double // bullyMargin
  trade_bully_score : Double // bullyScore
  trade_shy_max_s : Double // shyMaxS
  cls_armor_lt : Double // clsArmor.LT
  cls_armor_mt : Double // clsArmor.MT
  cls_armor_td : Double // clsArmor.TD
  cls_armor_ht : Double // clsArmor.HT
  cls_armor_spg : Double // clsArmor.SPG
  skill_level : Double // skill.level
  // angle (config.js:1187)
  angle_on : Int
  angle_deg_mid : Double // degMid
  angle_deg_max : Double // degMax
  angle_settle_s : Double // settleS
  angle_deadzone_deg : Double // deadzoneDeg
  angle_max_frac_of_reload : Double // maxFracOfReload
  angle_td_mul : Double // tdMul
  // fireDisc (config.js:1197-1198)
  fd_on : Int
  fd_recheck_s : Double // recheckS
  fd_rearm_s : Double // rearmS
  fd_rearm_brawl_s : Double // rearmBrawlS
  fd_settle_s : Double // settleS
  fd_rearm_min_hidden_s : Double // rearmMinHiddenS
  fd_snap_s : Double // snapS
  // classBand (config.js:1200)
  band_lt : (Double, Double)
  band_mt : (Double, Double)
  band_ht : (Double, Double)
  band_td : (Double, Double)
  band_spg : (Double, Double)
  // crossfire (config.js:1209)
  cf_on : Int
  cf_min_angle_sep : Double // minAngleSep
  cf_push_out_deg : Double // pushOutDeg
  cf_plug_window_s : Double // plugWindowS
  // focus (config.js:1215)
  focus_on : Int
  focus_update_s : Double // updateS
  focus_memory_s : Double // memoryS
  focus_max_per_target : Int // maxPerTarget
  focus_switch_s : Double // switchS
  focus_slot_hyst_s : Double // slotHystS
  // role (config.js:1224-1225)
  role_on : Int
  role_recompute_s : Double // recomputeS
  role_yield_hp_pct : Double // yieldHpPct
  role_line_min_frac : Double // lineMinFrac
  role_band_mix : Double // bandMix
  role_td_depth_lo : Double // tdDepth[0]
  role_td_depth_hi : Double // tdDepth[1]
  role_td_rank_bias : Int // tdRankBias
  role_ht_rank_bias : Int // htRankBias
  role_squad_line_n : Int // squadLineN
  // cover (config.js:1241-1242)
  cover_on : Int
  cover_max_cover_dist : Double // maxCoverDist
  cover_hide_check_s : Double // hideCheckS
  cover_bush_affinity : Double // bushAffinity
  cover_min_dist_frac : Double // minDistFrac
  cover_suppress_memory_timeout : Double // suppressMemoryTimeout
  cover_hide_frac_ht : Double // hideFracCls.HT
  cover_hide_frac_mt : Double // hideFracCls.MT
  cover_hide_frac_td : Double // hideFracCls.TD
  cover_peek_pad : Double // peekPad
  cover_peek_march_m : Double // peekMarchM
  // preAim (config.js:1256)
  preaim_on : Int
  preaim_cap_steer : Double // capSteer
  // tactics (config.js:1264-1268)
  tac_on : Int
  tac_recheck_s : Double // recheckS
  tac_hill_min_adv : Double // hill.minAdv
  tac_hill_min_n : Int // hill.minN
  tac_hill_rally_s : Double // hill.rallyS
  tac_hill_plan_s : Double // hill.planS
  tac_hill_auth_hold_s : Double // hill.authHoldS
  tac_cover_flank_after_s : Double // coverFlank.afterS
  tac_lane_on : Int // lane.on
  tac_chain_on : Int // coverChain.on
  tac_chain_hop_max : Double // coverChain.hopMax
  tac_chain_step_min : Double // coverChain.stepMin
  p_flanker : Personality
  p_sniper : Personality
  p_hold : Personality
}

///|
/// SF.CFG 整体(本包消费面)
pub(all) struct Cfg {
  sim : SimCfg
  armor : ArmorCfg
  ai : AiCfg
}

///|
/// 直录(config.js 数值逐项对照源码行号见各字段注释)
pub fn default_cfg() -> Cfg {
  {
    sim: {
      shell_gravity: 3.2,
      max_slope: 0.63,
      fall_safe_v: 9.0,
      fall_k: 4.0,
      fall_track_v: 11.5,
      fall_track_chance: 0.5,
      gb_fwd: [0.42, 0.72, 1.0],
      gb_rev: [0.58, 1.0],
      gb_torque_f: [1.25, 1.0, 0.9],
      gb_torque_r: [1.15, 1.0],
      gb_pause: 0.15,
    },
    armor: {
      ricochet_angle: 70.0 * @math.PI / 180.0,
      pen_variance: 0.25,
      dmg_variance: 0.25,
      track_duration: 6.0,
      engine_rear_chance: 0.55,
      ammo_chance: 0.08,
      ammo_dmg_mult: 1.6,
      ammo_reload_mult: 1.25,
      gun_disp_penalty: 1.6,
      engine_slow: 0.55,
    },
    ai: {
      view_range: 400.0,
      reaction_time: 0.35,
      memory_time: 7.0,
      shot_hearing: 9999.0,
      search_time: 26.0,
      radio_cooldown: 6.0,
      perception_interval: 0.13,
      spot_player_margin: 0.2,
      wp_on: 1,
      wp_front_deg: 45.0,
      wp_side_deg: 110.0,
      wp_low_y: 0.6,
      wp_side_y: 1.0,
      wp_rear_y: 0.9,
      wp_track_y: 0.35,
      wp_track_quota_s: 2.0,
      trade_on: 1,
      trade_kill_mult: 1.2,
      trade_shy_ratio: 0.85,
      trade_shy_hold_mul: 1.6,
      trade_bully_margin: 1.08,
      trade_bully_score: 1.6,
      trade_shy_max_s: 12.0,
      cls_armor_lt: 55.0,
      cls_armor_mt: 95.0,
      cls_armor_td: 120.0,
      cls_armor_ht: 160.0,
      cls_armor_spg: 40.0,
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
      band_lt: (55.0, 150.0),
      band_mt: (70.0, 190.0),
      band_ht: (60.0, 160.0),
      band_td: (130.0, 300.0),
      band_spg: (150.0, 330.0),
      cf_on: 1,
      cf_min_angle_sep: 30.0,
      cf_push_out_deg: 35.0,
      cf_plug_window_s: 10.0,
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
      cover_bush_affinity: 0.5,
      cover_min_dist_frac: 0.6,
      cover_suppress_memory_timeout: 1.0,
      cover_hide_frac_ht: 0.55,
      cover_hide_frac_mt: 0.65,
      cover_hide_frac_td: 0.7,
      cover_peek_pad: 0.3,
      cover_peek_march_m: 8.0,
      preaim_on: 1,
      preaim_cap_steer: 0.14,
      tac_on: 1,
      tac_recheck_s: 0.3,
      tac_hill_min_adv: 1.5,
      tac_hill_min_n: 2,
      tac_hill_rally_s: 3.0,
      tac_hill_plan_s: 8.0,
      tac_hill_auth_hold_s: 2.0,
      tac_cover_flank_after_s: 2.5,
      tac_lane_on: 1,
      tac_chain_on: 1,
      tac_chain_hop_max: 45.0,
      tac_chain_step_min: 12.0,
      p_flanker: {
        band: (55.0, 115.0),
        flank_chance: 0.55,
        aim_patience: 0.78,
        lead_skill: 0.78,
        retreat_hp: 0.2,
        hold_ground: false,
        angle_skill: 0.85,
      },
      p_sniper: {
        band: (190.0, 300.0),
        flank_chance: 0.0,
        aim_patience: 1.0,
        lead_skill: 1.0,
        retreat_hp: 0.14,
        hold_ground: true,
        angle_skill: 1.0,
      },
      p_hold: {
        band: (70.0, 130.0),
        flank_chance: 0.2,
        aim_patience: 0.88,
        lead_skill: 0.9,
        retreat_hp: 0.16,
        hold_ground: true,
        angle_skill: 1.15,
      },
    },
  }
}
