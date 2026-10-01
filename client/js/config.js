// config.js — 全部手感/数值参数（调参单一入口; 关卡数据在 assets/maps/*/map.json）
// 角度一律弧度, 速度 m/s, 距离米
window.SF = window.SF || {};

SF.CFG = {
  sim: {
    dt: 1 / 60,            // 固定模拟步长
    shellGravity: 3.2,     // 炮弹重力(WoT 风格弱下坠, 300m 外可感知)
      maxSlope: 0.63,         // ~36° 超过则无法爬坡(梯度模超 tan×1.25 视为不可攀陡壁)
      fall: { safeV: 9, k: 4, trackV: 11.5, trackChance: 0.5 },  // 坠落: 落地冲击 >9m/s(≈4m)开始摔伤, 伤害=(v-9)²×4; >11.5m/s 半数断带
      gearbox: { fwd: [0.42, 0.72, 1], rev: [0.58, 1], torqueF: [1.25, 1, 0.9], torqueR: [1.15, 1], pause: 0.15 }
      // 变速箱: 前进 D1/D2/D3=极速的 42%/72%/100%, 倒车 R1/R2=58%/100%; 低挡扭力倍率; 升挡 0.15s 扭矩中断
  },

  // 车辆参数 —— 手感核心, 改这里就是改手感
  vehicles: {
    sherman: {
      name: 'M4 谢尔曼', nation: 'USA', cls: 'MT', tier: 'V', hp: 900,
      maxSpeed: 13.3, reverseRatio: 0.42,     // 极速 48km/h, 倒车 42%
      accel: 4.0, brake: 9.5, coastDrag: 5.5, // 履带滚动阻力大: 松油门快速站住
      hullTraverse: 40 * Math.PI / 180,       // 车体回转 40°/s
      turretTraverse: 38 * Math.PI / 180,     // 炮塔回转 38°/s (独立于车体)
      gunDepression: -12 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.5, speed: 750 },   // 75mm
      sample: { l: 3.05, w: 1.45 },   // 履带接地四角采样半径(前后/左右)——地形贴合用
      dispersion: { base: 0.38, aimTime: 2.2, max: 2.2,      // 基础圈(m@100m)/缩圈时间
        move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 } // 各动作扩圈系数
    },
    sherman76: {
      name: 'M4A3E8 闪电', nation: 'USA', cls: 'MT', tier: 'VI', hp: 850,
      maxSpeed: 15.6, reverseRatio: 0.5, accel: 4.8, brake: 10, coastDrag: 5.6,
      hullTraverse: 45 * Math.PI / 180, turretTraverse: 44 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 108, dmg: 125, reload: 3.2, speed: 790 },
      sample: { l: 3.05, w: 1.45 },
      dispersion: { base: 0.36, aimTime: 2.0, max: 2.2, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    jumbo: {
      name: 'M4A3E2', nation: 'USA', cls: 'HT', tier: 'VI', hp: 1150,
      maxSpeed: 11.0, reverseRatio: 0.4, accel: 3.2, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 30 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 101, dmg: 135, reload: 3.9, speed: 760 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.42, aimTime: 2.4, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.6, fire: 1.7 }
    },
    hellcat: {
      name: 'M18 地狱猫', nation: 'USA', cls: 'TD', tier: 'VI', hp: 620,
      maxSpeed: 20.0, reverseRatio: 0.55, accel: 6.5, brake: 11, coastDrag: 6.0,
      hullTraverse: 50 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 132, dmg: 240, reload: 7.5, speed: 850 },
      sample: { l: 2.75, w: 1.4 },   // 一比一贴合 5.5m 小车体(史实 M18 全长 6.65m 含炮)
      dispersion: { base: 0.34, aimTime: 2.1, max: 2.0, move: 1.8, hullTurn: 1.2, turretTurn: 0.5, fire: 1.8 }
    },
    pz3: {
      name: '三号 J 型', nation: 'GER', cls: 'MT', tier: 'IV', hp: 620,
      maxSpeed: 17.78, reverseRatio: 0.42, accel: 5.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 42.0 * Math.PI / 180, turretTraverse: 40.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 82, dmg: 90, reload: 2.6, speed: 790 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    pz4: {
      name: '四号 H 型', nation: 'GER', cls: 'MT', tier: 'V', hp: 720,
      maxSpeed: 11.67, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 35.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 106, dmg: 110, reload: 3.4, speed: 790 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    panther: {
      name: '黑豹 G 型', nation: 'GER', cls: 'MT', tier: 'VII', hp: 1250,
      maxSpeed: 15.28, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 44.0 * Math.PI / 180, turretTraverse: 35.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 160, dmg: 165, reload: 5.0, speed: 925 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    tiger1: {
      name: '虎 I', nation: 'GER', cls: 'HT', tier: 'VII', hp: 1400,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 35.0 * Math.PI / 180, turretTraverse: 32.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 145, dmg: 220, reload: 6.4, speed: 820 },
      sample: { l: 3.3, w: 1.85 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    stug3: {
      name: '三号突击炮', nation: 'GER', cls: 'TD', tier: 'V', hp: 700,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 37.0 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,   // 固定战斗室: ±10° 射界内横向伺服, 超界自动转车体
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 132, dmg: 200, reload: 5.4, speed: 790 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    jagdpanther: {
      name: '猎豹', nation: 'GER', cls: 'TD', tier: 'VII', hp: 1250,
      maxSpeed: 12.78, reverseRatio: 0.42, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 41.0 * Math.PI / 180, turretTraverse: 26.0 * Math.PI / 180, gunArc: 11 * Math.PI / 180,   // 固定战斗室: ±11° 射界内横向伺服, 超界自动转车体
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 260, reload: 6.4, speed: 1000 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    ru251: {   // 全场机动天花板: 极速/车体回转/炮塔回转/视距四项第一的侦察车
      name: 'Ru 251', nation: 'GER', cls: 'LT', tier: 'VIII', hp: 1100,
      maxSpeed: 22.22, reverseRatio: 0.45, accel: 7.5, brake: 11, coastDrag: 6.0,
      hullTraverse: 55.0 * Math.PI / 180, turretTraverse: 50.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 200, reload: 6.5, speed: 900 },
      sample: { l: 2.7, w: 1.25 },
      dispersion: { base: 0.36, aimTime: 1.8, max: 2.0, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.5 }
    },
    bt7: {
      name: 'BT-7', nation: 'USSR', cls: 'LT', tier: 'III', hp: 420,
      maxSpeed: 19.44, reverseRatio: 0.42, accel: 6.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 48.0 * Math.PI / 180, turretTraverse: 42.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 55, dmg: 70, reload: 2.0, speed: 760 },
      sample: { l: 2.75, w: 1.15 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t34: {
      name: 'T-34-76', nation: 'USSR', cls: 'MT', tier: 'V', hp: 750,
      maxSpeed: 14.17, reverseRatio: 0.42, accel: 4.2, brake: 9, coastDrag: 5.2,
      hullTraverse: 42.0 * Math.PI / 180, turretTraverse: 40.0 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 100, dmg: 160, reload: 4.2, speed: 660 },
      sample: { l: 3.0, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t3485: {
      name: 'T-34-85', nation: 'USSR', cls: 'MT', tier: 'VI', hp: 950,
      maxSpeed: 15.00, reverseRatio: 0.42, accel: 4.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 44.0 * Math.PI / 180, turretTraverse: 42.0 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 125, dmg: 180, reload: 5.2, speed: 792 },
      sample: { l: 3.0, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    kv1: {
      name: 'KV-1', nation: 'USSR', cls: 'HT', tier: 'V', hp: 1050,
      maxSpeed: 8.33, reverseRatio: 0.42, accel: 2.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 30.0 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 110, dmg: 165, reload: 4.6, speed: 660 },
      sample: { l: 3.4, w: 1.75 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    kv2: {
      name: 'KV-2', nation: 'USSR', cls: 'HT', tier: 'VI', hp: 950,
      maxSpeed: 7.22, reverseRatio: 0.42, accel: 2.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 24.0 * Math.PI / 180, turretTraverse: 20.0 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 110, dmg: 550, reload: 14, speed: 600 },
      sample: { l: 3.4, w: 1.75 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    is2: {
      name: 'IS-2', nation: 'USSR', cls: 'HT', tier: 'VII', hp: 1300,
      maxSpeed: 10.28, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 28.0 * Math.PI / 180, turretTraverse: 28.0 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 390, reload: 11, speed: 795 },
      sample: { l: 3.45, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    su85: {
      name: 'SU-85', nation: 'USSR', cls: 'TD', tier: 'V', hp: 700,
      maxSpeed: 13.06, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,   // 固定战斗室: ±10° 射界内横向伺服, 超界自动转车体
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 130, dmg: 220, reload: 6.0, speed: 792 },
      sample: { l: 3.0, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    su100: {
      name: 'SU-100', nation: 'USSR', cls: 'TD', tier: 'VI', hp: 900,
      maxSpeed: 13.33, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 0.42 * Math.PI / 180, gunArc: 11 * Math.PI / 180,   // 固定战斗室: ±11° 射界内横向伺服, 超界自动转车体
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 320, reload: 8.5, speed: 895 },
      sample: { l: 3.0, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    isu152: {
      name: 'ISU-152', nation: 'USSR', cls: 'TD', tier: 'VII', hp: 1150,
      maxSpeed: 11.94, reverseRatio: 0.42, accel: 3.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 0.35 * Math.PI / 180, gunArc: 8 * Math.PI / 180,   // 固定战斗室: ±8° 射界内横向伺服, 超界自动转车体
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 620, reload: 13, speed: 600 },
      sample: { l: 3.45, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    m3lee: {
      name: 'M3 李', nation: 'USA', cls: 'MT', tier: 'IV', hp: 700,
      maxSpeed: 11.67, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 38.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 92, dmg: 110, reload: 3.5, speed: 790 },
      sample: { l: 3.15, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    m10: {
      name: 'M10 狼獾', nation: 'USA', cls: 'TD', tier: 'V', hp: 700,
      maxSpeed: 13.33, reverseRatio: 0.42, accel: 4.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 38.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 120, dmg: 160, reload: 3.9, speed: 792 },
      sample: { l: 3.0, w: 1.45 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    m36: {
      name: 'M36 杰克逊', nation: 'USA', cls: 'TD', tier: 'VI', hp: 850,
      maxSpeed: 11.67, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 155, dmg: 240, reload: 7.0, speed: 853 },
      sample: { l: 3.0, w: 1.45 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    matilda: {
      name: '玛蒂尔达', nation: 'UK', cls: 'HT', tier: 'IV', hp: 750,
      maxSpeed: 6.67, reverseRatio: 0.42, accel: 2.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 34.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 100, dmg: 90, reload: 2.8, speed: 731 },
      sample: { l: 2.85, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    cromwell: {
      name: '克伦威尔', nation: 'UK', cls: 'MT', tier: 'VI', hp: 900,
      maxSpeed: 17.78, reverseRatio: 0.42, accel: 6.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 48.0 * Math.PI / 180, turretTraverse: 44.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 125, dmg: 150, reload: 3.2, speed: 790 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    firefly: {
      name: '萤火虫', nation: 'UK', cls: 'MT', tier: 'VI', hp: 850,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 34.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 180, reload: 5.5, speed: 887 },
      sample: { l: 3.0, w: 1.45 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    churchill7: {
      name: '丘吉尔', nation: 'UK', cls: 'HT', tier: 'VI', hp: 1250,
      maxSpeed: 6.67, reverseRatio: 0.42, accel: 2.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 26.0 * Math.PI / 180, turretTraverse: 28.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 120, dmg: 150, reload: 3.8, speed: 790 },
      sample: { l: 3.75, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    b1bis: {
      name: 'B1 bis', nation: 'FRA', cls: 'HT', tier: 'IV', hp: 720,
      maxSpeed: 7.78, reverseRatio: 0.42, accel: 2.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 32.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 85, dmg: 120, reload: 4.5, speed: 600 },
      sample: { l: 3.3, w: 1.35 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    somua: {
      name: '索玛 S35', nation: 'FRA', cls: 'MT', tier: 'III', hp: 480,
      maxSpeed: 12.50, reverseRatio: 0.42, accel: 4.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 42.0 * Math.PI / 180, turretTraverse: 38.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 60, dmg: 90, reload: 3.5, speed: 600 },
      sample: { l: 2.7, w: 1.15 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    chiha: {
      name: '九七式中战', nation: 'JPN', cls: 'MT', tier: 'III', hp: 460,
      maxSpeed: 12.22, reverseRatio: 0.42, accel: 4.2, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 55, dmg: 75, reload: 3.0, speed: 700 },
      sample: { l: 2.8, w: 1.2 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    chinu: {
      name: '三式中战', nation: 'JPN', cls: 'MT', tier: 'IV', hp: 640,
      maxSpeed: 12.50, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 90, dmg: 120, reload: 3.4, speed: 750 },
      sample: { l: 3.05, w: 1.25 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    tiger2: {
      name: '虎 II', nation: 'GER', cls: 'HT', tier: 'VIII', hp: 1650,
      maxSpeed: 10.56, reverseRatio: 0.42, accel: 2.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 28.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 194, dmg: 240, reload: 7.5, speed: 1000 },
      sample: { l: 3.7, w: 1.85 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    ferdinand: {
      name: '斐迪南', nation: 'GER', cls: 'TD', tier: 'VII', hp: 1250,
      maxSpeed: 8.33, reverseRatio: 0.42, accel: 2.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 28.0 * Math.PI / 180, turretTraverse: 0.4 * Math.PI / 180, gunArc: 14 * Math.PI / 180,   // 固定战斗室: ±14° 射界内横向伺服, 超界自动转车体
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 194, dmg: 240, reload: 7.5, speed: 1000 },
      sample: { l: 3.5, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    is3: {
      name: 'IS-3', nation: 'USSR', cls: 'HT', tier: 'VIII', hp: 1550,
      maxSpeed: 10.28, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 28.0 * Math.PI / 180, turretTraverse: 26.0 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 390, reload: 11, speed: 795 },
      sample: { l: 3.5, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t44: {
      name: 'T-44', nation: 'USSR', cls: 'MT', tier: 'VIII', hp: 1450,
      maxSpeed: 14.17, reverseRatio: 0.42, accel: 4.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 44.0 * Math.PI / 180, turretTraverse: 42.0 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 160, dmg: 200, reload: 6.5, speed: 792 },
      sample: { l: 3.1, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    m26: {
      name: 'M26 潘兴', nation: 'USA', cls: 'MT', tier: 'VIII', hp: 1450,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 38.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 160, dmg: 240, reload: 7.0, speed: 853 },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t26e4: {
      name: 'T26E4 超潘', nation: 'USA', cls: 'MT', tier: 'VIII', hp: 1500,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 240, reload: 7.5, speed: 853 },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t29: {
      name: 'T29', nation: 'USA', cls: 'HT', tier: 'VII', hp: 1350,
      maxSpeed: 9.72, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 32.0 * Math.PI / 180, turretTraverse: 30.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 320, reload: 9.0, speed: 920 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    centurion: {
      name: '百人队长', nation: 'UK', cls: 'MT', tier: 'VIII', hp: 1500,
      maxSpeed: 9.44, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 40.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 190, reload: 6.0, speed: 887 },
      sample: { l: 3.4, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    chiri: {
      name: '三式奇狸', nation: 'JPN', cls: 'MT', tier: 'VII', hp: 1100,
      maxSpeed: 10.56, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 125, dmg: 130, reload: 3.0, speed: 750 },
      sample: { l: 3.25, w: 1.3 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    type62: {
      name: '62式', nation: 'CHN', cls: 'LT', tier: 'VII', hp: 900,
      maxSpeed: 16.67, reverseRatio: 0.45, accel: 5.4, brake: 10, coastDrag: 5.6,
      hullTraverse: 46 * Math.PI / 180, turretTraverse: 44 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 145, dmg: 180, reload: 6.3, speed: 792 },
      sample: { l: 2.95, w: 1.4 },
      dispersion: { base: 0.38, aimTime: 2.1, max: 2.2, move: 1.6, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    type59: {
      name: '59式', nation: 'CHN', cls: 'MT', tier: 'VIII', hp: 1450,
      maxSpeed: 13.89, reverseRatio: 0.45, accel: 4.6, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 42 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 175, dmg: 250, reload: 7.8, speed: 895 },
      sample: { l: 3.1, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    wz111: {
      name: 'WZ-111', nation: 'CHN', cls: 'HT', tier: 'VIII', hp: 1550,
      maxSpeed: 12.5, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 190, dmg: 440, reload: 12.5, speed: 900 },
      sample: { l: 3.6, w: 1.7 },
      dispersion: { base: 0.44, aimTime: 2.6, max: 2.5, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.8 }
    },
    /* ---------- 弹夹(连发)车: 夹内短装填连打, 打完整夹长装填 ---------- */
    amx13: {
      name: 'AMX 13 75', nation: 'FRA', cls: 'LT', tier: 'VI', hp: 750,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.6, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 46 * Math.PI / 180, turretTraverse: 42 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 106, dmg: 110, reload: 2.3, speed: 800, autoloader: { clip: 6, intra: 2.3, long: 20 } },
      sample: { l: 2.6, w: 1.25 },
      dispersion: { base: 0.40, aimTime: 2.2, max: 2.2, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.2 }
    },
    amx50100: {
      name: 'AMX 50 100', nation: 'FRA', cls: 'HT', tier: 'VIII', hp: 1500,
      maxSpeed: 15.0, reverseRatio: 0.45, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 13 * Math.PI / 180,
      gun: { pen: 170, dmg: 320, reload: 2.7, speed: 850, autoloader: { clip: 6, intra: 2.7, long: 27 } },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.44, aimTime: 2.6, max: 2.5, move: 1.7, hullTurn: 1.2, turretTurn: 0.65, fire: 1.1 }
    },
    lorr40t: {
      name: '洛林 40t', nation: 'FRA', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 18.0, reverseRatio: 0.5, accel: 5.0, brake: 10, coastDrag: 5.5,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 165, dmg: 300, reload: 2.6, speed: 830, autoloader: { clip: 4, intra: 2.6, long: 24 } },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.40, aimTime: 2.4, max: 2.3, move: 1.6, hullTurn: 1.15, turretTurn: 0.6, fire: 1.15 }
    },
    /* ---------- 自行火炮(SPG): 高抛弹道 + 溅射伤害, Shift 鹰眼俯视瞄准 ----------
       弹道为纯曲射(WoT 火炮): 只走高抛根, 仰角 45°~84° 连续覆盖 ~180m 到最大射程;
       近于最小射程(高抛根超 84°)压最大仰角打不进 —— 和 WoT 一样有最小射程, 绝不退化为直射;
       最大射程 ~860-900m 覆盖全图;
       弹速/重力做保形放大(历史值 ×3.96 / ×15.7): 弧线形状与射程不变, 飞行时间压到 WoT 手感 ~1.3-1.8s */
    wespe: {
      name: '黄蜂', nation: 'GER', cls: 'SPG', tier: 'IV', hp: 460,
      maxSpeed: 11.1, reverseRatio: 0.4, accel: 3.6, brake: 8, coastDrag: 5.0,
      hullTraverse: 30 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 84 * Math.PI / 180,
      gun: { pen: 45, dmg: 340, reload: 13.5, speed: 972, grav: 1098, splash: 4.4, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.4, w: 1.2 },
      dispersion: { base: 1.15, aimTime: 4.6, max: 2.6, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    hummel: {
      name: '野蜂', nation: 'GER', cls: 'SPG', tier: 'VI', hp: 540,
      maxSpeed: 12.5, reverseRatio: 0.4, accel: 3.8, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 28 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 84 * Math.PI / 180,
      gun: { pen: 62, dmg: 520, reload: 17, speed: 1049, grav: 1225, splash: 5.4, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.8, w: 1.4 },
      dispersion: { base: 1.3, aimTime: 5.0, max: 2.8, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    m7priest: {
      name: 'M7 牧师', nation: 'USA', cls: 'SPG', tier: 'V', hp: 500,
      maxSpeed: 12.2, reverseRatio: 0.42, accel: 3.8, brake: 8.5, coastDrag: 5.2,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 84 * Math.PI / 180,
      gun: { pen: 52, dmg: 430, reload: 15, speed: 990, grav: 1128, splash: 4.8, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 1.2, aimTime: 4.8, max: 2.7, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    su26: {
      name: 'SU-26', nation: 'USSR', cls: 'SPG', tier: 'IV', hp: 480,
      maxSpeed: 10.3, reverseRatio: 0.4, accel: 3.4, brake: 8, coastDrag: 5.0,
      hullTraverse: 30 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 84 * Math.PI / 180,
      gun: { pen: 50, dmg: 330, reload: 12, speed: 931, grav: 1004, splash: 4.0, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.4, w: 1.25 },
      dispersion: { base: 1.1, aimTime: 4.4, max: 2.6, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    // ===== 扩充车组: WoT 同款 · 现实真实存在(含建造过的原型车), 数值游戏化平衡 =====
    /* ---------- 美国 ---------- */
    m5stuart: { name: 'M5 斯图亚特', nation: 'USA', cls: 'LT', tier: 'III', hp: 280,
      maxSpeed: 14.6, reverseRatio: 0.5, accel: 5.8, brake: 10, coastDrag: 5.4,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 45, dmg: 45, reload: 2.0, speed: 780 },
      sample: { l: 2.0, w: 1.05 },
      dispersion: { base: 0.44, aimTime: 2.0, max: 2.0, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    m24chaffee: { name: 'M24 霞飞', nation: 'USA', cls: 'LT', tier: 'V', hp: 450,
      maxSpeed: 16.9, reverseRatio: 0.52, accel: 6.2, brake: 10.5, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 92, dmg: 110, reload: 3.2, speed: 790 },
      sample: { l: 2.3, w: 1.15 },
      dispersion: { base: 0.42, aimTime: 2.1, max: 2.1, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    m41walker: { name: 'M41 斗牛犬', nation: 'USA', cls: 'LT', tier: 'VIII', hp: 750,
      maxSpeed: 19.4, reverseRatio: 0.52, accel: 7.0, brake: 11, coastDrag: 6.0,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 42 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 150, dmg: 150, reload: 3.4, speed: 900 },
      sample: { l: 2.5, w: 1.2 },
      dispersion: { base: 0.38, aimTime: 1.9, max: 2.0, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    t1heavy: { name: 'T1 重坦', nation: 'USA', cls: 'HT', tier: 'V', hp: 680,
      maxSpeed: 10.3, reverseRatio: 0.42, accel: 2.9, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 26 * Math.PI / 180, turretTraverse: 26 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 128, dmg: 150, reload: 4.0, speed: 790 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    m103: { name: 'M103', nation: 'USA', cls: 'HT', tier: 'VIII', hp: 1550,
      maxSpeed: 8.6, reverseRatio: 0.42, accel: 2.6, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 22 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 200, dmg: 320, reload: 9.5, speed: 950 },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.37, aimTime: 2.6, max: 2.4, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.6 }
    },
    t30: { name: 'T30', nation: 'USA', cls: 'TD', tier: 'VIII', hp: 1150,
      maxSpeed: 8.6, reverseRatio: 0.42, accel: 2.7, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 18 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 212, dmg: 480, reload: 12, speed: 930 },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.37, aimTime: 2.8, max: 2.5, move: 1.7, hullTurn: 1.2, turretTurn: 0.6, fire: 1.7 }
    },
    t28: { name: 'T28', nation: 'USA', cls: 'TD', tier: 'VIII', hp: 1250,
      maxSpeed: 7.2, reverseRatio: 0.4, accel: 2.0, brake: 8, coastDrag: 4.6,
      hullTraverse: 14 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 200, dmg: 320, reload: 7.5, speed: 950 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.34, aimTime: 2.5, max: 2.2, move: 1.7, hullTurn: 1.4, turretTurn: 0.5, fire: 1.6 }
    },
    m46patton: { name: 'M46 巴顿', nation: 'USA', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 15.3, reverseRatio: 0.46, accel: 4.6, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 180, dmg: 180, reload: 5.8, speed: 900 },
      sample: { l: 3.0, w: 1.5 },
      dispersion: { base: 0.37, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.5 }
    },
    /* ---------- 德国 ---------- */
    pz2: { name: '二号坦克', nation: 'GER', cls: 'LT', tier: 'II', hp: 180,
      maxSpeed: 13.9, reverseRatio: 0.5, accel: 6.0, brake: 10, coastDrag: 5.4,
      hullTraverse: 46 * Math.PI / 180, turretTraverse: 42 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 28, dmg: 13, reload: 0.55, speed: 760 },
      sample: { l: 1.9, w: 1.0 },
      dispersion: { base: 0.50, aimTime: 1.7, max: 1.9, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    pz38t: { name: '38(t) 坦克', nation: 'GER', cls: 'LT', tier: 'III', hp: 300,
      maxSpeed: 12.5, reverseRatio: 0.5, accel: 5.6, brake: 10, coastDrag: 5.4,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 48, dmg: 50, reload: 2.1, speed: 760 },
      sample: { l: 2.1, w: 1.05 },
      dispersion: { base: 0.42, aimTime: 2.0, max: 2.0, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    hetzer: { name: '追猎者', nation: 'GER', cls: 'TD', tier: 'IV', hp: 420,
      maxSpeed: 9.7, reverseRatio: 0.42, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 106, dmg: 110, reload: 3.6, speed: 790 },
      sample: { l: 2.6, w: 1.3 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.2, move: 1.5, hullTurn: 1.2, turretTurn: 0.5, fire: 1.6 }
    },
    jgdpz4: { name: '四号歼击车', nation: 'GER', cls: 'TD', tier: 'V', hp: 480,
      maxSpeed: 10.3, reverseRatio: 0.42, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 128, dmg: 110, reload: 3.6, speed: 860 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.38, aimTime: 2.3, max: 2.2, move: 1.5, hullTurn: 1.2, turretTurn: 0.5, fire: 1.6 }
    },
    nashorn: { name: '犀牛', nation: 'GER', cls: 'TD', tier: 'VI', hp: 480,
      maxSpeed: 12.5, reverseRatio: 0.42, accel: 4.2, brake: 9, coastDrag: 5.2,
      hullTraverse: 30 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 12 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 175, dmg: 220, reload: 6.0, speed: 1000 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.34, aimTime: 2.4, max: 2.1, move: 1.6, hullTurn: 1.3, turretTurn: 0.5, fire: 1.6 }
    },
    jagdtiger: { name: '猎虎', nation: 'GER', cls: 'TD', tier: 'VIII', hp: 1250,
      maxSpeed: 8.3, reverseRatio: 0.4, accel: 2.2, brake: 8.5, coastDrag: 4.6,
      hullTraverse: 18 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 230, dmg: 440, reload: 12, speed: 1000 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.32, aimTime: 2.9, max: 2.3, move: 1.8, hullTurn: 1.5, turretTurn: 0.5, fire: 1.7 }
    },
    /* ---------- 苏联 ---------- */
    t26: { name: 'T-26', nation: 'USSR', cls: 'LT', tier: 'II', hp: 210,
      maxSpeed: 11.7, reverseRatio: 0.45, accel: 5.0, brake: 9.5, coastDrag: 5.2,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 42, dmg: 55, reload: 2.0, speed: 760 },
      sample: { l: 2.0, w: 1.1 },
      dispersion: { base: 0.45, aimTime: 2.0, max: 2.0, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    t70: { name: 'T-70', nation: 'USSR', cls: 'LT', tier: 'III', hp: 260,
      maxSpeed: 13.3, reverseRatio: 0.45, accel: 5.4, brake: 9.5, coastDrag: 5.2,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 12 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 48, dmg: 55, reload: 1.9, speed: 760 },
      sample: { l: 1.9, w: 1.05 },
      dispersion: { base: 0.44, aimTime: 1.9, max: 2.0, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    t28ru: { name: 'T-28', nation: 'USSR', cls: 'MT', tier: 'IV', hp: 380,
      maxSpeed: 11.1, reverseRatio: 0.45, accel: 4.4, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 36 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 72, dmg: 110, reload: 3.6, speed: 780 },
      sample: { l: 2.7, w: 1.35 },
      dispersion: { base: 0.42, aimTime: 2.2, max: 2.2, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.5 }
    },
    kv85: { name: 'KV-85', nation: 'USSR', cls: 'HT', tier: 'VI', hp: 950,
      maxSpeed: 8.6, reverseRatio: 0.4, accel: 2.8, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 26 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 120, dmg: 160, reload: 5.6, speed: 800 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.40, aimTime: 2.4, max: 2.4, move: 1.6, hullTurn: 1.2, turretTurn: 0.55, fire: 1.6 }
    },
    is: { name: 'IS', nation: 'USSR', cls: 'HT', tier: 'VII', hp: 1150,
      maxSpeed: 9.4, reverseRatio: 0.4, accel: 3.0, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 26 * Math.PI / 180, turretTraverse: 24 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 150, dmg: 390, reload: 10, speed: 800 },
      sample: { l: 3.2, w: 1.5 },
      dispersion: { base: 0.40, aimTime: 2.8, max: 2.5, move: 1.7, hullTurn: 1.2, turretTurn: 0.6, fire: 1.7 }
    },
    su76: { name: 'SU-76', nation: 'USSR', cls: 'TD', tier: 'III', hp: 300,
      maxSpeed: 12.2, reverseRatio: 0.45, accel: 4.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 12 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 70, dmg: 110, reload: 3.2, speed: 780 },
      sample: { l: 2.2, w: 1.2 },
      dispersion: { base: 0.42, aimTime: 2.1, max: 2.1, move: 1.5, hullTurn: 1.2, turretTurn: 0.5, fire: 1.5 }
    },
    su152: { name: 'SU-152', nation: 'USSR', cls: 'TD', tier: 'VII', hp: 900,
      maxSpeed: 9.4, reverseRatio: 0.4, accel: 2.8, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 22 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 135, dmg: 550, reload: 13, speed: 640 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.42, aimTime: 3.0, max: 2.6, move: 1.8, hullTurn: 1.4, turretTurn: 0.5, fire: 1.7 }
    },
    t90a: { name: 'T-90A', nation: 'USSR', cls: 'MT', tier: 'VIII', hp: 1250,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.4, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 210, dmg: 320, reload: 7.0, speed: 950 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.36, aimTime: 2.2, max: 2.2, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.5 }
    },
    /* ---------- 英国 ---------- */
    vickersmed: { name: '维克斯中坦', nation: 'UK', cls: 'MT', tier: 'II', hp: 190,
      maxSpeed: 11.1, reverseRatio: 0.45, accel: 4.8, brake: 9.5, coastDrag: 5.2,
      hullTraverse: 38 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 40, dmg: 50, reload: 1.8, speed: 760 },
      sample: { l: 2.0, w: 1.15 },
      dispersion: { base: 0.46, aimTime: 2.0, max: 2.0, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    valentine: { name: '瓦伦丁', nation: 'UK', cls: 'MT', tier: 'IV', hp: 450,
      maxSpeed: 8.6, reverseRatio: 0.42, accel: 3.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 30 * Math.PI / 180, turretTraverse: 30 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 62, dmg: 45, reload: 1.7, speed: 790 },
      sample: { l: 2.5, w: 1.3 },
      dispersion: { base: 0.42, aimTime: 2.1, max: 2.1, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    crusader: { name: '十字军', nation: 'UK', cls: 'MT', tier: 'V', hp: 480,
      maxSpeed: 14.9, reverseRatio: 0.46, accel: 5.2, brake: 10, coastDrag: 5.4,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 84, dmg: 75, reload: 2.4, speed: 800 },
      sample: { l: 2.6, w: 1.3 },
      dispersion: { base: 0.40, aimTime: 2.1, max: 2.1, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    churchill1: { name: '丘吉尔 I', nation: 'UK', cls: 'HT', tier: 'V', hp: 640,
      maxSpeed: 8.2, reverseRatio: 0.4, accel: 2.4, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 22 * Math.PI / 180, turretTraverse: 24 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 75, dmg: 50, reload: 1.8, speed: 790 },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.42, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    comet: { name: '彗星', nation: 'UK', cls: 'MT', tier: 'VII', hp: 1000,
      maxSpeed: 13.3, reverseRatio: 0.46, accel: 4.6, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 38 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 148, dmg: 140, reload: 4.2, speed: 850 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.38, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.5 }
    },
    blackprince: { name: '黑太子', nation: 'UK', cls: 'HT', tier: 'VII', hp: 1250,
      maxSpeed: 7.2, reverseRatio: 0.4, accel: 2.2, brake: 8.5, coastDrag: 4.8,
      hullTraverse: 20 * Math.PI / 180, turretTraverse: 22 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 170, dmg: 150, reload: 5.2, speed: 880 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.38, aimTime: 2.3, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    conqueror: { name: '征服者', nation: 'UK', cls: 'HT', tier: 'VIII', hp: 1500,
      maxSpeed: 8.6, reverseRatio: 0.42, accel: 2.6, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 22 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 210, dmg: 300, reload: 9.0, speed: 950 },
      sample: { l: 3.35, w: 1.6 },
      dispersion: { base: 0.36, aimTime: 2.5, max: 2.4, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.6 }
    },
    tortoise: { name: '龟式', nation: 'UK', cls: 'TD', tier: 'VIII', hp: 1350,
      maxSpeed: 6.4, reverseRatio: 0.4, accel: 1.9, brake: 8, coastDrag: 4.5,
      hullTraverse: 16 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 190, dmg: 260, reload: 8.5, speed: 900 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.33, aimTime: 2.7, max: 2.3, move: 1.7, hullTurn: 1.5, turretTurn: 0.5, fire: 1.6 }
    },
    /* ---------- 法国 ---------- */
    ft: { name: '雷诺 FT', nation: 'FRA', cls: 'LT', tier: 'I', hp: 130,
      maxSpeed: 7.2, reverseRatio: 0.45, accel: 4.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 38 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 30, dmg: 40, reload: 2.0, speed: 740 },
      sample: { l: 1.4, w: 0.95 },
      dispersion: { base: 0.48, aimTime: 1.9, max: 1.9, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    elc: { name: 'ELC EVEN', nation: 'FRA', cls: 'LT', tier: 'V', hp: 380,
      maxSpeed: 17.2, reverseRatio: 0.5, accel: 6.8, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 46 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 150, dmg: 160, reload: 6.0, speed: 900 },
      sample: { l: 1.9, w: 1.0 },
      dispersion: { base: 0.40, aimTime: 2.2, max: 2.1, move: 1.5, hullTurn: 1.0, turretTurn: 0.55, fire: 1.5 }
    },
    bdr: { name: 'BDR G1B', nation: 'FRA', cls: 'HT', tier: 'V', hp: 620,
      maxSpeed: 8.6, reverseRatio: 0.4, accel: 2.6, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 26 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 130, dmg: 160, reload: 6.0, speed: 820 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.4, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    arl44: { name: 'ARL 44', nation: 'FRA', cls: 'HT', tier: 'VI', hp: 850,
      maxSpeed: 9.4, reverseRatio: 0.4, accel: 2.6, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 24 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 155, dmg: 200, reload: 6.5, speed: 850 },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.38, aimTime: 2.4, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    amx50120: { name: 'AMX 50 120', nation: 'FRA', cls: 'HT', tier: 'VIII', hp: 1350,
      maxSpeed: 13.3, reverseRatio: 0.46, accel: 4.2, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 30 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 280, reload: 3.2, speed: 950, autoloader: { clip: 2, intra: 3.0, long: 16 } },
      sample: { l: 3.1, w: 1.55 },
      dispersion: { base: 0.37, aimTime: 2.4, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.5 }
    },
    batchat: { name: '查狄伦 25t', nation: 'FRA', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 6.0, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 200, reload: 2.6, speed: 950, autoloader: { clip: 5, intra: 2.4, long: 22 } },
      sample: { l: 2.8, w: 1.45 },
      dispersion: { base: 0.37, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    /* ---------- 日本 ---------- */
    hago: { name: '九五式轻战', nation: 'JPN', cls: 'LT', tier: 'II', hp: 170,
      maxSpeed: 12.5, reverseRatio: 0.45, accel: 5.2, brake: 9.5, coastDrag: 5.2,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 30, dmg: 40, reload: 1.8, speed: 740 },
      sample: { l: 1.9, w: 1.0 },
      dispersion: { base: 0.47, aimTime: 1.9, max: 1.9, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.3 }
    },
    chihe: { name: '一式中战', nation: 'JPN', cls: 'MT', tier: 'V', hp: 480,
      maxSpeed: 11.7, reverseRatio: 0.45, accel: 4.2, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 36 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 70, dmg: 65, reload: 2.2, speed: 780 },
      sample: { l: 2.5, w: 1.25 },
      dispersion: { base: 0.42, aimTime: 2.1, max: 2.1, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    chito: { name: '四式中战', nation: 'JPN', cls: 'MT', tier: 'VI', hp: 620,
      maxSpeed: 11.7, reverseRatio: 0.45, accel: 4.4, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 36 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 100, dmg: 100, reload: 3.2, speed: 790 },
      sample: { l: 2.7, w: 1.3 },
      dispersion: { base: 0.40, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    type61: { name: '61式战车', nation: 'JPN', cls: 'MT', tier: 'VII', hp: 950,
      maxSpeed: 13.9, reverseRatio: 0.46, accel: 4.6, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 38 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 165, dmg: 180, reload: 5.4, speed: 900 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.37, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.5 }
    },
    oi: { name: 'O-I 试用重战', nation: 'JPN', cls: 'HT', tier: 'V', hp: 850,
      maxSpeed: 6.9, reverseRatio: 0.38, accel: 2.0, brake: 8, coastDrag: 4.5,
      hullTraverse: 16 * Math.PI / 180, turretTraverse: 20 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 90, dmg: 300, reload: 10, speed: 640 },
      sample: { l: 3.5, w: 1.9 },
      dispersion: { base: 0.44, aimTime: 2.9, max: 2.6, move: 1.8, hullTurn: 1.4, turretTurn: 0.6, fire: 1.7 }
    },
    /* ---------- 中国 ---------- */
    type63: { name: '63式水陆坦克', nation: 'CHN', cls: 'LT', tier: 'VI', hp: 700,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.6, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 115, dmg: 160, reload: 5.0, speed: 800 },
      sample: { l: 2.5, w: 1.3 },
      dispersion: { base: 0.40, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.55, fire: 1.4 }
    },
    type69: { name: '69式中型坦克', nation: 'CHN', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 15.3, reverseRatio: 0.48, accel: 4.8, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 220, reload: 6.2, speed: 900 },
      sample: { l: 3.0, w: 1.5 },
      dispersion: { base: 0.37, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.55, fire: 1.5 }
    },
    /* ---------- 战后与现代(数值游戏化平衡, 非史实穿甲口径) ---------- */
    leopard1: { name: '豹1', nation: 'GER', cls: 'MT', tier: 'VIII', hp: 1100,
      maxSpeed: 18.1, reverseRatio: 0.52, accel: 5.8, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 200, dmg: 220, reload: 6.5, speed: 1000 },
      sample: { l: 3.0, w: 1.5 },
      dispersion: { base: 0.34, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    is7: { name: 'IS-7', nation: 'USSR', cls: 'HT', tier: 'VIII', hp: 1600,
      maxSpeed: 11.7, reverseRatio: 0.42, accel: 3.2, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 26 * Math.PI / 180, turretTraverse: 24 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 195, dmg: 390, reload: 11, speed: 800 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.39, aimTime: 2.8, max: 2.5, move: 1.7, hullTurn: 1.2, turretTurn: 0.6, fire: 1.7 }
    },
    maus: { name: '鼠式', nation: 'GER', cls: 'HT', tier: 'VIII', hp: 1800,
      maxSpeed: 7.2, reverseRatio: 0.4, accel: 1.9, brake: 8, coastDrag: 4.5,
      hullTraverse: 16 * Math.PI / 180, turretTraverse: 18 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 225, dmg: 440, reload: 12, speed: 900 },
      sample: { l: 3.8, w: 1.95 },
      dispersion: { base: 0.33, aimTime: 2.9, max: 2.4, move: 1.8, hullTurn: 1.5, turretTurn: 0.6, fire: 1.7 }
    },
    stb1: { name: 'STB-1', nation: 'JPN', cls: 'MT', tier: 'VIII', hp: 1100,
      maxSpeed: 15.3, reverseRatio: 0.5, accel: 5.0, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -11 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 195, dmg: 210, reload: 6.2, speed: 1000 },
      sample: { l: 3.0, w: 1.5 },
      dispersion: { base: 0.35, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    chieftain: { name: '酋长', nation: 'UK', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 12.5, reverseRatio: 0.46, accel: 4.4, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 36 * Math.PI / 180, turretTraverse: 26 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 190, dmg: 300, reload: 8.5, speed: 950 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.35, aimTime: 2.4, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.5 }
    },
    m1abrams: { name: 'M1 艾布拉姆斯', nation: 'USA', cls: 'HT', tier: 'VIII', hp: 1650,
      maxSpeed: 18.1, reverseRatio: 0.55, accel: 6.0, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 20 * Math.PI / 180,
      gun: { pen: 220, dmg: 320, reload: 7.0, speed: 1100 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.33, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    leopard2: { name: '豹2A4', nation: 'GER', cls: 'MT', tier: 'VIII', hp: 1250,
      maxSpeed: 19.4, reverseRatio: 0.55, accel: 6.2, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 225, dmg: 310, reload: 6.8, speed: 1100 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.33, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    challenger2: { name: '挑战者2', nation: 'UK', cls: 'HT', tier: 'VIII', hp: 1700,
      maxSpeed: 12.5, reverseRatio: 0.46, accel: 4.2, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 22 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 230, dmg: 330, reload: 8.0, speed: 1050 },
      sample: { l: 3.35, w: 1.6 },
      dispersion: { base: 0.32, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.4 }
    },
    type99: { name: '99式', nation: 'CHN', cls: 'HT', tier: 'VIII', hp: 1600,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.4, brake: 10, coastDrag: 5.6,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 215, dmg: 320, reload: 7.2, speed: 1050 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.34, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.55, fire: 1.4 }
    },
    type90: { name: '90式', nation: 'JPN', cls: 'MT', tier: 'VIII', hp: 1200,
      maxSpeed: 18.1, reverseRatio: 0.52, accel: 5.8, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 220, dmg: 310, reload: 6.6, speed: 1100 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.33, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    merkava3: { name: '梅卡瓦 Mk.3', nation: 'ISR', cls: 'HT', tier: 'VIII', hp: 1650,
      maxSpeed: 13.9, reverseRatio: 0.5, accel: 4.4, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 36 * Math.PI / 180, turretTraverse: 28 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 220, dmg: 320, reload: 7.5, speed: 1050 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.34, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.4 }
    },
    strv103: { name: 'Strv 103', nation: 'SWE', cls: 'TD', tier: 'VIII', hp: 1300,
      maxSpeed: 16.7, reverseRatio: 0.75, accel: 5.0, brake: 10, coastDrag: 5.6,
      hullTraverse: 52 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 20 * Math.PI / 180,
      gunDepression: -11 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 205, dmg: 210, reload: 5.5, speed: 1000 },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.33, aimTime: 2.1, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    leclerc: { name: '勒克莱尔', nation: 'FRA', cls: 'MT', tier: 'VIII', hp: 1200,
      maxSpeed: 19.4, reverseRatio: 0.55, accel: 6.4, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 225, dmg: 310, reload: 6.2, speed: 1100 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.33, aimTime: 1.9, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    /* ---------- IX / X / XI 级(高阶: 真实战车, 数值游戏化) ---------- */
    t54: { name: 'T-54', nation: 'USSR', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 15.0, reverseRatio: 0.5, accel: 5.0, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 175, dmg: 220, reload: 6.5, speed: 900 },
      sample: { l: 3.0, w: 1.5 },
      dispersion: { base: 0.37, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.5 }
    },
    m48patton: { name: 'M48 巴顿', nation: 'USA', cls: 'MT', tier: 'IX', hp: 1250,
      maxSpeed: 15.3, reverseRatio: 0.46, accel: 4.8, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 190, dmg: 190, reload: 5.5, speed: 950 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.36, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.5, fire: 1.5 }
    },
    m60: { name: 'M60', nation: 'USA', cls: 'MT', tier: 'IX', hp: 1200,
      maxSpeed: 15.3, reverseRatio: 0.48, accel: 5.0, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 195, dmg: 220, reload: 6.3, speed: 1000 },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.35, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    t10: { name: 'T-10', nation: 'USSR', cls: 'HT', tier: 'IX', hp: 1550,
      maxSpeed: 10.3, reverseRatio: 0.42, accel: 3.0, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 26 * Math.PI / 180, turretTraverse: 24 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 210, dmg: 390, reload: 9.5, speed: 850 },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.38, aimTime: 2.6, max: 2.4, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.6 }
    },
    t62: { name: 'T-62', nation: 'USSR', cls: 'MT', tier: 'IX', hp: 1200,
      maxSpeed: 15.0, reverseRatio: 0.5, accel: 5.0, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 200, dmg: 300, reload: 7.5, speed: 950 },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.36, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.5 }
    },
    obj268: { name: 'Object 268', nation: 'USSR', cls: 'TD', tier: 'IX', hp: 1350,
      maxSpeed: 11.7, reverseRatio: 0.42, accel: 3.2, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 26 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 12 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 13 * Math.PI / 180,
      gun: { pen: 230, dmg: 460, reload: 11, speed: 900 },
      sample: { l: 3.35, w: 1.6 },
      dispersion: { base: 0.35, aimTime: 2.7, max: 2.3, move: 1.6, hullTurn: 1.3, turretTurn: 0.5, fire: 1.6 }
    },
    amx50b: { name: 'AMX 50 B', nation: 'FRA', cls: 'HT', tier: 'IX', hp: 1500,
      maxSpeed: 14.3, reverseRatio: 0.46, accel: 4.4, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 30 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 200, dmg: 260, reload: 2.8, speed: 1000, autoloader: { clip: 3, intra: 2.6, long: 24 } },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.36, aimTime: 2.3, max: 2.3, move: 1.4, hullTurn: 1.0, turretTurn: 0.55, fire: 1.4 }
    },
    type74: { name: '74式战车', nation: 'JPN', cls: 'MT', tier: 'IX', hp: 1150,
      maxSpeed: 15.3, reverseRatio: 0.5, accel: 5.2, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 195, dmg: 210, reload: 6.0, speed: 1000 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.34, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    type96: { name: '96式坦克', nation: 'CHN', cls: 'HT', tier: 'IX', hp: 1450,
      maxSpeed: 15.3, reverseRatio: 0.5, accel: 5.2, brake: 10, coastDrag: 5.6,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 205, dmg: 310, reload: 7.4, speed: 1050 },
      sample: { l: 3.25, w: 1.6 },
      dispersion: { base: 0.35, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.55, fire: 1.4 }
    },
    vickersmbt: { name: '维克斯 MBT', nation: 'UK', cls: 'MT', tier: 'IX', hp: 1100,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.4, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 200, dmg: 220, reload: 6.2, speed: 1000 },
      sample: { l: 3.0, w: 1.5 },
      dispersion: { base: 0.35, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    m1a2: { name: 'M1A2 艾布拉姆斯', nation: 'USA', cls: 'HT', tier: 'X', hp: 1800,
      maxSpeed: 18.1, reverseRatio: 0.55, accel: 6.2, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 20 * Math.PI / 180,
      gun: { pen: 240, dmg: 340, reload: 6.8, speed: 1150 },
      sample: { l: 3.35, w: 1.6 },
      dispersion: { base: 0.32, aimTime: 1.9, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    t80u: { name: 'T-80U', nation: 'USSR', cls: 'MT', tier: 'X', hp: 1350,
      maxSpeed: 17.2, reverseRatio: 0.5, accel: 5.6, brake: 10, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 225, dmg: 320, reload: 7.0, speed: 1000 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.35, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.4 }
    },
    type99a: { name: '99A式坦克', nation: 'CHN', cls: 'HT', tier: 'X', hp: 1700,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.6, brake: 10, coastDrag: 5.6,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 230, dmg: 330, reload: 7.0, speed: 1100 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.34, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.0, turretTurn: 0.55, fire: 1.4 }
    },
    type10: { name: '10式战车', nation: 'JPN', cls: 'MT', tier: 'X', hp: 1250,
      maxSpeed: 18.1, reverseRatio: 0.52, accel: 6.0, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 230, dmg: 310, reload: 6.0, speed: 1100 },
      sample: { l: 3.15, w: 1.55 },
      dispersion: { base: 0.33, aimTime: 1.9, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    merkava4: { name: '梅卡瓦 Mk.4', nation: 'ISR', cls: 'HT', tier: 'X', hp: 1750,
      maxSpeed: 13.9, reverseRatio: 0.5, accel: 4.6, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 36 * Math.PI / 180, turretTraverse: 28 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 230, dmg: 330, reload: 7.2, speed: 1100 },
      sample: { l: 3.35, w: 1.6 },
      dispersion: { base: 0.34, aimTime: 2.2, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.4 }
    },
    strv122: { name: 'Strv 122', nation: 'SWE', cls: 'HT', tier: 'X', hp: 1600,
      maxSpeed: 13.3, reverseRatio: 0.5, accel: 5.0, brake: 10, coastDrag: 5.6,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 230, dmg: 320, reload: 7.0, speed: 1100 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.33, aimTime: 2.1, max: 2.2, move: 1.4, hullTurn: 1.1, turretTurn: 0.55, fire: 1.4 }
    },
    k2: { name: 'K2 黑豹', nation: 'KOR', cls: 'MT', tier: 'X', hp: 1250,
      maxSpeed: 20.8, reverseRatio: 0.55, accel: 6.6, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 225, dmg: 310, reload: 6.4, speed: 1100 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.33, aimTime: 1.9, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    t14armata: { name: 'T-14 阿玛塔', nation: 'RUS', cls: 'HT', tier: 'XI', hp: 2000,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.8, brake: 10.5, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 245, dmg: 350, reload: 6.5, speed: 1150 },
      sample: { l: 3.35, w: 1.6 },
      dispersion: { base: 0.32, aimTime: 1.9, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    leopard2a7: { name: '豹2A7', nation: 'GER', cls: 'MT', tier: 'XI', hp: 1400,
      maxSpeed: 18.1, reverseRatio: 0.55, accel: 6.4, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 240, dmg: 320, reload: 6.4, speed: 1150 },
      sample: { l: 3.3, w: 1.6 },
      dispersion: { base: 0.32, aimTime: 1.9, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    t90m: { name: 'T-90M', nation: 'RUS', cls: 'MT', tier: 'XI', hp: 1350,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.8, brake: 10.5, coastDrag: 5.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 36 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 235, dmg: 320, reload: 6.8, speed: 1150 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.33, aimTime: 2.0, max: 2.1, move: 1.3, hullTurn: 1.0, turretTurn: 0.5, fire: 1.4 }
    },
    medium: {
      name: '敌方中坦', cls: 'MT', hp: 550,
      maxSpeed: 12.5, reverseRatio: 0.45, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.8, speed: 780 },
      sample: { l: 3.25, w: 1.5 },
      dispersion: { base: 0.42, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    td: {
      name: '敌方歼击车', cls: 'TD', hp: 650,
      maxSpeed: 9.7, reverseRatio: 0.4, accel: 3.0, brake: 8, coastDrag: 4.6,
      hullTraverse: 20 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,   // 固定战斗室: ±10° 射界内横向伺服, 超界自动转车体
      gunDepression: -8 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 120, dmg: 280, reload: 8.0, speed: 1000 },
      sample: { l: 3.35, w: 1.45 },
      dispersion: { base: 0.30, aimTime: 2.6, max: 2.0, move: 2.0, hullTurn: 1.4, turretTurn: 0.5, fire: 1.8 }
    },
    heavy: {
      name: '敌方重坦', cls: 'HT', hp: 1000,
      maxSpeed: 7.8, reverseRatio: 0.38, accel: 2.6, brake: 7.5, coastDrag: 4.2,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 28 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 110, dmg: 220, reload: 6.0, speed: 820 },
      sample: { l: 3.5, w: 1.6 },
      dispersion: { base: 0.46, aimTime: 2.9, max: 2.6, move: 1.8, hullTurn: 1.2, turretTurn: 0.6, fire: 1.8 }
    }
  },

  // 装甲判定规则(WoT 对齐)
  armor: {
    ricochetAngle: 70 * Math.PI / 180,  // 入射角超过即跳弹(口径>3倍装甲除外, 见过穿)
    penVariance: 0.25,                  // 穿深 ±25% 浮动
    dmgVariance: 0.25,                  // 伤害 ±25% 浮动(WoT 同款)
    modules: {
      // WoT: 只有履带自动修复; 发动机/火炮/弹药架损伤整局持续(波间维修可复位)
      track:  { duration: 6, text: '履带断裂！' },
      engine: { permanent: true, slow: 0.55, rearChance: 0.55, deckChance: 0.3, text: '发动机受损！' },
      ammo:   { chance: 0.08, dmgMult: 1.6, reloadMult: 1.25, text: '弹药架被击中！' },
      gun:    { permanent: true, dispPenalty: 1.6, text: '火炮受损！' }
    }
  },

  // AI 感知与性格(难度旋钮: aimPatience 越低越急着开炮 → 越不准)
  ai: {
    viewRange: 400, reactionTime: 0.35, hearingRange: 90, memoryTime: 7,
    shotHearing: 9999,  // 坦克炮声全图可闻(误差随距离增大): 开炮必暴露大致方位, 敌群会合围
    searchTime: 26,     // 丢失目标后围绕最后已知位置的搜剿时长(秒), 无果才回巡逻
    radio: { range: 220, cooldown: 6 },   // 无线电: 发现/听见=全队广播(range 仅兜底), cooldown=呼叫间隔
    perceptionInterval: 0.13,
    personalities: {
      flanker: { band: [55, 115], flankChance: 0.55, aimPatience: 0.78, leadSkill: 0.78, retreatHp: 0.2, holdGround: false },
      sniper:  { band: [190, 300], flankChance: 0,    aimPatience: 1.0,  leadSkill: 1.0,  retreatHp: 0.14, holdGround: true },
      hold:    { band: [70, 130],  flankChance: 0.2,  aimPatience: 0.88, leadSkill: 0.9,  retreatHp: 0.16, holdGround: true }
    }
  },

  // 相机灵敏度: 数值=每像素弧度; 觉得快→调小, 慢→调大(参考: 0.0009 约为鼠标垫横扫一圈)
  // touchSens: 触屏拖动专用(手指行程远短于鼠标, 需更高灵敏度)
  camera: { dist: 15, minDist: 6.5, maxDist: 30, height: 4.0, pitch: 0.30, fov: 55, sniperFovMax: 26, sniperFovMin: 8, sens: 0.0009, sniperSens: 0.25, touchSens: 0.0035 },

  player: { viewRange: 445 },   // WoT 级视野上限

  // PVE 修改器(仅单机战役生效, 联机一律 1 倍): 敌军规模 + 玩家坦克参数倍率(WoT 配件风格)
  pve: {
    enemyMul: 1,     // 敌军规模: 每波敌人数量倍率(1~10)
    reloadMul: 1,    // 输弹机: 装填时间倍率(<1 更快)
    aimMul: 1,       // 炮控: 缩圈时间倍率(<1 更快)
    mobilityMul: 1,  // 涡轮增压器: 极速/加速倍率
    hpMul: 1,        // 强化装甲: 血量倍率
    viewMul: 1       // 观瞄: 视距倍率
  },

  // PVE 补给空投(仅单机战役与合作闯关; 死斗不出): 随机定时空投奖励包, 开车碾过木箱即拾取
  pickups: {
    firstDelay: 5,           // 开战到第一箱(秒) —— 尽早出现, 让玩家第一波就见到这个机制
    interval: [12, 20],      // 空投间隔随机区间(秒) —— "随机出现, 次数多一点"
    maxOnField: 3,           // 场上未拾取上限(到顶暂停投放)
    lifetime: 40,            // 落地后存在时长(秒), 最后 8s 闪烁预警
    radius: 5,               // 拾取半径(米, 加车体半径 —— 车身擦到就算)
    spawnRing: [35, 100],    // 落点环绕玩家的距离环(米): 不贴脸也不放天边
    dropDist: 70,            // 空投起始高度(米, 带降落伞落下)
    fallSpeed: 34,           // 降落速度(米/秒)
    repairHeal: 0.4,         // 维修: 回血比例(×最大血量), 并复位全部模块损伤(含永久级)
    buffDur: 35,             // 属性增益持续(秒); 同类再拾 = 续时 +1 层
    maxStack: 2,             // 增益层数上限(第 3 次起只续时)
    weights: { repair: 22, speed: 20, aim: 20, mobility: 19, load: 19 },   // 类型权重(需求感知见下)
    needRepairMul: 2.5,      // 血量<50% 或带永久损伤时, 维修包权重 ×
    fullHpMul: 0.45,         // 满血无损伤时, 维修包权重 ×
    effects: {               // 每层增益倍率(乘法, 从战斗开始时的 baseSpec 重算)
      speed:    { maxSpeed: 1.25, accel: 1.25 },          // 引擎过载: 极速/加速
      mobility: { traverse: 1.30 },                       // 履带润滑: 车体/炮塔回转
      aim:      { aimTime: 0.65, base: 0.85 },            // 炮控校准: 缩圈更快 + 更准
      load:     { reload: 0.80 }                          // 输弹强化: 装填更快(含弹夹)
    }
  },

  multiplayer: true,    // 联机入口开关(联机版开启; 单机纯净版可改 false 隐藏)

  // 出击前可选的坦克与地图(配合标题界面车库)
  garage: [],   // CFG 定义后由下方生成
  maps: [
    { id: 'l01', dir: 'l01-encounter', name: '诺曼底 · 遭遇战', desc: '树篱田野与村庄, 三路推进' },
    { id: 'l02', dir: 'l02-city', name: '废墟 · 城市巷战', desc: '街区废墟, 近距肉搏' },
    { id: 'l03', dir: 'l03-highland', name: '山川 · 高地争夺', desc: '峡谷隘口, 制高点对决' },
    { id: 'l04', dir: 'l04-steppe', name: '东线 · 平原炮战', desc: '开阔麦田与反坦克壕, 远距对决' },
    { id: 'l05', dir: 'l05-airfield', name: '荒漠 · 机场争夺', desc: '沙地跑道与机堡, 快节奏冲锋' },
    { id: 'l06', dir: 'l06-winter', name: '冬境 · 河谷争夺', desc: '冰河走廊与谷壁高地, 唯一登顶路对决' }
  ],

  // 音效: 引擎音量曲线(怠速近乎无声 → 全速渐强), engine:false 可完全关闭引擎音
  audio: {
    engine: true,
    voice: true,                        // 中文战斗语音播报(击穿/跳弹/装填完毕等)
    idleGain: 0.03, maxGain: 0.30,     // 怠速/全油门音量(车速主导: 巡航滑行≈0.21 不再哑火)
    idleRate: 0.95, topRate: 1.62,     // 怠速/全速播放倍率
    idleLP: 500, topLP: 2200           // 怠速闷/全速亮的低通截止(Hz)
  }
};

// 车类图标(WoT 式, 全游戏统一): 轻坦=整颗菱形; 中坦=菱形被 1 道斜缝切 2 条带; 重坦=2 道斜缝 3 条带;
// 歼击车=倒三角 ▼; 火炮=方块 ■ (对照官方坦克类型图例) —— innerHTML 场景用
SF.ClsIcon = function (cls, opts = {}) {
  const h = opts.size || 9, w = Math.round(h * 1.35 * 10) / 10;
  const col = opts.color || 'currentColor';
  const f = (v) => Math.round(v * 100) / 100;
  if (cls === 'TD')
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:-1px"><polygon fill="${col}" points="0,0 ${w},0 ${w / 2},${h}"/></svg>`;
  if (cls === 'SPG')
    return `<svg width="${h}" height="${h}" viewBox="0 0 ${h} ${h}" style="vertical-align:-1px"><rect fill="${col}" x="0.5" y="0.5" width="${h - 1}" height="${h - 1}"/></svg>`;
  const n = cls === 'LT' ? 1 : cls === 'MT' ? 2 : cls === 'HT' ? 3 : 0;
  if (!n) return '';
  // 条带几何(中心坐标系): 缝平行于菱形左上边, 每条带 = 缝线与左下边/右上边交点构成的四边形
  // (端头自然落在菱形顶点上, 整体轮廓=完整菱形; 纯多边形无 clip, 无需唯一 id)
  const ext = w * h;                                              // c=h·x+w·y 轴总跨度
  const hyp = Math.sqrt(h * h + w * w);
  const gap = Math.max(1.2, h * 0.16) * hyp;                      // 视觉缝宽(px) → c 轴单位
  const bw = (ext - (n - 1) * gap) / n;
  const P1 = (c) => [(c - ext / 2) / (2 * h), (h / w) * ((c - ext / 2) / (2 * h)) + h / 2];   // 与左下边交点
  const P2 = (c) => [(c + ext / 2) / (2 * h), (h / w) * ((c + ext / 2) / (2 * h)) - h / 2];   // 与右上边交点
  let body = '';
  for (let k = 0; k < n; k++) {
    const c0 = -ext / 2 + k * (bw + gap), c1 = c0 + bw;
    const q = [P1(c0), P2(c0), P2(c1), P1(c1)].map(p => `${f(p[0] + w / 2)},${f(p[1] + h / 2)}`).join(' ');
    body += `<polygon fill="${col}" points="${q}"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:-1px">${body}</svg>`;
};

// 车库列表(依赖 vehicles 数据, 必须在 CFG 定义后生成)
(() => {
  const sel = ['sherman', 'sherman76', 'jumbo', 'hellcat', 'm5stuart', 'm24chaffee', 'm41walker', 't1heavy', 'm103', 't30', 't28', 'm46patton', 'm1abrams',
    'pz2', 'pz38t', 'pz3', 'pz4', 'panther', 'tiger1', 'stug3', 'jagdpanther', 'ru251', 'hetzer', 'jgdpz4', 'nashorn', 'jagdtiger', 'leopard1', 'leopard2', 'maus',
    'bt7', 't26', 't70', 't28ru', 't34', 't3485', 'kv1', 'kv85', 'kv2', 'is', 'is2', 'is7', 'su76', 'su85', 'su100', 'su152', 'isu152', 't44', 't90a',
    'vickersmed', 'valentine', 'crusader', 'matilda', 'cromwell', 'comet', 'firefly', 'churchill1', 'churchill7', 'blackprince', 'caernarvon', 'conqueror', 'tortoise', 'chieftain',
    'ft', 'elc', 'b1bis', 'somua', 'bdr', 'arl44', 'amx13', 'amx50100', 'amx50120', 'lorr40t', 'batchat', 'leclerc',
    'hago', 'chiha', 'chihe', 'chinu', 'chito', 'chiri', 'type61', 'oi', 'stb1', 'type90',
    'type62', 'type63', 'type59', 'type69', 'wz111', 'type99', 'type96', 'type99a',
    'tiger2', 'ferdinand', 'is3', 't26e4', 't29', 'centurion', 'm26', 'merkava3', 'merkava4', 'strv103', 'strv122',
    't54', 'm48patton', 'm60', 't10', 't62', 'obj268', 'amx50b', 'type74', 'vickersmbt',
    'm1a2', 't80u', 'type10', 'k2', 't14armata', 'leopard2a7', 't90m',
    'wespe', 'hummel', 'm7priest', 'su26'];
  const NATION = { USA: 'US', GER: 'DE', USSR: 'RU', UK: 'UK', FRA: 'FR', JPN: 'JP', CHN: 'CN', ISR: 'IL', SWE: 'SE', KOR: 'KR', RUS: 'RU' };   // 国别码(纯首字母 US/USSR/UK 会撞车; RUS 并入 RU 标签)
  const CLS_CN = { LT: '轻坦', MT: '中坦', HT: '重坦', TD: '歼击车', SPG: '火炮' };
  SF.CFG.garage = sel.filter(t => SF.CFG.vehicles[t]).map(t => {
    const v = SF.CFG.vehicles[t];
    const nat = v.nation ? NATION[v.nation] + '·' : '';
    return { type: t, tag: nat + (v.tier || '') + '级' + (CLS_CN[v.cls] || v.cls || ''), cls: v.cls, desc: v.name };
  });
})();

// 弹径(过穿判定)/视距(点亮)/隐蔽值 —— WoT 对齐: 每车独立视距与隐蔽, 弹径决定 2倍/3倍口径规则
(() => {
  const CAL = {   // mm, 近似史实口径
    sherman: 75, sherman76: 76, jumbo: 75, hellcat: 90, pz3: 50, pz4: 75, panther: 75, tiger1: 88,
    stug3: 75, jagdpanther: 88, ru251: 90, bt7: 45, t34: 76, t3485: 85, kv1: 76, kv2: 152, is2: 122, su85: 85, su100: 100,
    isu152: 152, m3lee: 75, m10: 76, m36: 90, matilda: 57, cromwell: 75, firefly: 76, churchill7: 75,
    b1bis: 75, somua: 47, chiha: 57, chinu: 75, tiger2: 88, ferdinand: 88, is3: 122, t44: 100, m26: 90, t26e4: 90,
    t29: 105, centurion: 76, chiri: 75, type62: 85, type59: 100, wz111: 122,
    amx13: 75, amx50100: 100, lorr40t: 100, wespe: 105, hummel: 150, m7priest: 105, su26: 122,
    ru251: 90, m5stuart: 37, m24chaffee: 75, m41walker: 76, t1heavy: 76, m103: 120, t30: 155, t28: 120, m46patton: 90,
    pz2: 20, pz38t: 37, hetzer: 75, jgdpz4: 75, nashorn: 88, jagdtiger: 128, leopard1: 105, leopard2: 120, maus: 128,
    t26: 45, t70: 45, t28: 76, t28ru: 76, kv85: 85, is: 122, su76: 76, su152: 152, t90a: 125, is7: 130,
    vickersmed: 47, valentine: 40, crusader: 57, churchill1: 40, comet: 77, blackprince: 76, conqueror: 120, tortoise: 94, chieftain: 120,
    ft: 37, elc: 90, bdr: 90, arl44: 90, amx50120: 120, batchat: 105, leclerc: 120,
    hago: 37, chihe: 47, chito: 75, type61: 90, oi: 100, stb1: 105, type90: 120,
    type63: 85, type69: 100, type99: 125, merkava3: 120, strv103: 105,
    t54: 100, m48patton: 90, m60: 105, t10: 122, t62: 115, obj268: 130, amx50b: 120, type74: 105, type96: 125, vickersmbt: 105,
    m1a2: 120, t80u: 125, type99a: 125, type10: 120, merkava4: 120, strv122: 120, k2: 120, t14armata: 125, leopard2a7: 120, t90m: 125,
    medium: 75, td: 88, heavy: 105
  };
  const VIEW = {  // m, 点亮距离基数(再乘 (1-目标隐蔽))
    sherman: 370, sherman76: 380, jumbo: 350, hellcat: 370, pz3: 350, pz4: 365, panther: 390, tiger1: 370,
    stug3: 350, jagdpanther: 360, ru251: 400, bt7: 330, t34: 350, t3485: 360, kv1: 330, kv2: 320, is2: 350, su85: 330, su100: 340,
    isu152: 330, m3lee: 330, m10: 370, m36: 370, matilda: 330, cromwell: 360, firefly: 370, churchill7: 350,
    b1bis: 310, somua: 320, chiha: 320, chinu: 340, tiger2: 380, ferdinand: 350, is3: 360, t44: 380, m26: 380, t26e4: 380,
    t29: 380, centurion: 390, chiri: 360, type62: 390, type59: 380, wz111: 370,
    amx13: 390, amx50100: 380, lorr40t: 380, wespe: 330, hummel: 330, m7priest: 330, su26: 330,
    ru251: 400, m5stuart: 320, m24chaffee: 370, m41walker: 390, t1heavy: 340, m103: 370, t30: 370, t28: 340, m46patton: 390,
    pz2: 310, pz38t: 320, hetzer: 330, jgdpz4: 350, nashorn: 380, jagdtiger: 350, leopard1: 400, leopard2: 405, maus: 330,
    t26: 310, t70: 320, t28: 340, t28ru: 340, kv85: 340, is: 350, su76: 320, su152: 330, t90a: 390, is7: 360,
    vickersmed: 300, valentine: 320, crusader: 340, churchill1: 320, comet: 380, blackprince: 330, conqueror: 380, tortoise: 320, chieftain: 380,
    ft: 280, elc: 360, bdr: 320, arl44: 340, amx50120: 380, batchat: 390, leclerc: 410,
    hago: 300, chihe: 320, chito: 340, type61: 370, oi: 310, stb1: 400, type90: 400,
    type63: 370, type69: 380, type99: 390, merkava3: 400, strv103: 380,
    t54: 390, m48patton: 395, m60: 395, t10: 370, t62: 385, obj268: 380, amx50b: 390, type74: 395, type96: 390, vickersmbt: 395,
    m1a2: 415, t80u: 400, type99a: 400, type10: 410, merkava4: 405, strv122: 400, k2: 415, t14armata: 420, leopard2a7: 415, t90m: 410,
    medium: 370, td: 350, heavy: 340
  };
  const CAMO_CLS = { LT: 0.16, MT: 0.12, HT: 0.07, TD: 0.22, SPG: 0.08 };   // 静止隐蔽(移动减半/开炮近零/蹲草丛+0.25且挡点亮, 见 SF.camoOf / SF.bushState)
  for (const k in SF.CFG.vehicles) {
    const v = SF.CFG.vehicles[k];
    v.gun.cal = CAL[k] || 75;
    v.view = VIEW[k] || 370;
    v.camo = CAMO_CLS[v.cls] || 0.12;
  }
})();

/* ---------- 通用小工具 ---------- */
SF.Util = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  // 角度差(结果 ∈ [-π,π], from a to b)
  angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; },
  moveToward(cur, target, maxStep) { const d = target - cur; return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; },
  angMoveToward(cur, target, maxStep) { const d = SF.Util.angDiff(cur, target); return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; },
  dist2d(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); },
  /* ---------- 有向矩形(OBB)碰撞: 一比一匹配模型形状 ----------
     约定与车体一致: yaw 朝向的前进方向 = (sin yaw, cos yaw), 左舷 = (cos yaw, -sin yaw);
     obb = { x, z, yaw, hx(半宽·左舷), hz(半长·前进) } */
  // 2D 射线 vs OBB(slab 法): 返回 t(0..len) 或 -1
  rayObb(ox, oz, dx, dz, len, c) {
    const cs = Math.cos(c.yaw || 0), sn = Math.sin(c.yaw || 0);
    const px = ox - c.x, pz = oz - c.z;
    let lo = -1e9, hi = 1e9;
    // 左舷轴 slab
    let ld = cs * dx - sn * dz, lp = cs * px - sn * pz;
    if (Math.abs(ld) < 1e-9) { if (Math.abs(lp) > c.hx) return -1; }
    else {
      let t1 = (-c.hx - lp) / ld, t2 = (c.hx - lp) / ld;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      lo = Math.max(lo, t1); hi = Math.min(hi, t2);
      if (lo > hi) return -1;
    }
    // 前进轴 slab
    ld = sn * dx + cs * dz; lp = sn * px + cs * pz;
    if (Math.abs(ld) < 1e-9) { if (Math.abs(lp) > c.hz) return -1; }
    else {
      let t1 = (-c.hz - lp) / ld, t2 = (c.hz - lp) / ld;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      lo = Math.max(lo, t1); hi = Math.min(hi, t2);
      if (lo > hi) return -1;
    }
    if (hi < 0 || lo > len) return -1;
    return Math.max(lo, 0);
  },
  // 两 OBB 的 SAT 最小平移推出: 相交时返回把 a 推离 b 的向量 [mx, mz], 不相交返回 null
  obbPushOut(a, b) {
    const aX = [Math.cos(a.yaw), -Math.sin(a.yaw)], aZ = [Math.sin(a.yaw), Math.cos(a.yaw)];
    const bX = [Math.cos(b.yaw), -Math.sin(b.yaw)], bZ = [Math.sin(b.yaw), Math.cos(b.yaw)];
    const dx = a.x - b.x, dz = a.z - b.z;
    let best = 1e9, mx = 0, mz = 0;
    for (const ax of [aX, aZ, bX, bZ]) {
      const ra = a.hx * Math.abs(ax[0] * aX[0] + ax[1] * aX[1]) + a.hz * Math.abs(ax[0] * aZ[0] + ax[1] * aZ[1]);
      const rb = b.hx * Math.abs(ax[0] * bX[0] + ax[1] * bX[1]) + b.hz * Math.abs(ax[0] * bZ[0] + ax[1] * bZ[1]);
      const dist = ax[0] * dx + ax[1] * dz;
      const ov = ra + rb - Math.abs(dist);
      if (ov <= 0) return null;
      if (ov < best) { best = ov; const s = dist >= 0 ? 1 : -1; mx = ax[0] * s * best; mz = ax[1] * s * best; }
    }
    return [mx, mz];
  },
  // 2D 射线-圆相交: 返回 t(0..len) 或 -1
  rayCircle(ox, oz, dx, dz, len, cx, cz, r) {
    const fx = ox - cx, fz = oz - cz;
    const b = fx * dx + fz * dz, c = fx * fx + fz * fz - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = 0;
    return t <= len ? t : -1;
  }
};

/* ---------- 事件总线(模拟层 → 表现层) ---------- */
SF.Bus = (() => {
  const map = {};
  return {
    on(ev, fn) { (map[ev] = map[ev] || []).push(fn); },
    emit(ev, data) { const l = map[ev]; if (l) for (const fn of l) fn(data); }
  };
})();
