// config.js — 全部手感/数值参数（调参单一入口; 关卡数据在 assets/maps/*/map.json）
// 角度一律弧度, 速度 m/s, 距离米
window.SF = window.SF || {};

SF.CFG = {
  sim: {
    dt: 1 / 60,            // 固定模拟步长
    shellGravity: 3.2,     // 炮弹重力(WoT 风格弱下坠, 300m 外可感知)
      maxSlope: 0.63          // ~36° 超过则无法爬坡
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
      name: "谢尔曼 M4A3E8'闪电'", nation: 'USA', cls: 'MT', tier: 'VI', hp: 850,
      maxSpeed: 15.6, reverseRatio: 0.5, accel: 4.8, brake: 10, coastDrag: 5.6,
      hullTraverse: 45 * Math.PI / 180, turretTraverse: 44 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 108, dmg: 125, reload: 3.2, speed: 790 },
      sample: { l: 3.05, w: 1.45 },
      dispersion: { base: 0.36, aimTime: 2.0, max: 2.2, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    jumbo: {
      name: '谢尔曼 M4A3E2 突击型', nation: 'USA', cls: 'HT', tier: 'VI', hp: 1150,
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
      name: '四号坦克III型 J', nation: 'GER', cls: 'MT', tier: 'IV', hp: 620,
      maxSpeed: 17.78, reverseRatio: 0.42, accel: 5.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 42.0 * Math.PI / 180, turretTraverse: 40.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 82, dmg: 90, reload: 2.6, speed: 790 },
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    pz4: {
      name: '四号坦克 H 型', nation: 'GER', cls: 'MT', tier: 'V', hp: 720,
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
      name: '虎 I 重型坦克', nation: 'GER', cls: 'HT', tier: 'VII', hp: 1400,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 35.0 * Math.PI / 180, turretTraverse: 32.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 145, dmg: 220, reload: 6.4, speed: 820 },
      sample: { l: 3.3, w: 1.85 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    stug3: {
      name: '三号突击炮 G', nation: 'GER', cls: 'TD', tier: 'V', hp: 700,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 37.0 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,   // 固定战斗室: ±10° 射界内横向伺服, 超界自动转车体
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 132, dmg: 200, reload: 5.4, speed: 790 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    jagdpanther: {
      name: '猎豹歼击车', nation: 'GER', cls: 'TD', tier: 'VII', hp: 1250,
      maxSpeed: 12.78, reverseRatio: 0.42, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 41.0 * Math.PI / 180, turretTraverse: 26.0 * Math.PI / 180, gunArc: 11 * Math.PI / 180,   // 固定战斗室: ±11° 射界内横向伺服, 超界自动转车体
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 260, reload: 6.4, speed: 1000 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    bt7: {
      name: 'BT-7 快速坦克', nation: 'USSR', cls: 'LT', tier: 'III', hp: 420,
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
      name: 'KV-1 重型坦克', nation: 'USSR', cls: 'HT', tier: 'V', hp: 1050,
      maxSpeed: 8.33, reverseRatio: 0.42, accel: 2.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 30.0 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 110, dmg: 165, reload: 4.6, speed: 660 },
      sample: { l: 3.4, w: 1.75 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    kv2: {
      name: 'KV-2 突击坦克', nation: 'USSR', cls: 'HT', tier: 'VI', hp: 950,
      maxSpeed: 7.22, reverseRatio: 0.42, accel: 2.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 24.0 * Math.PI / 180, turretTraverse: 20.0 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 110, dmg: 550, reload: 14, speed: 600 },
      sample: { l: 3.4, w: 1.75 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    is2: {
      name: 'IS-2 重型坦克', nation: 'USSR', cls: 'HT', tier: 'VII', hp: 1300,
      maxSpeed: 10.28, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 28.0 * Math.PI / 180, turretTraverse: 28.0 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 390, reload: 11, speed: 795 },
      sample: { l: 3.45, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    su85: {
      name: 'SU-85 歼击车', nation: 'USSR', cls: 'TD', tier: 'V', hp: 700,
      maxSpeed: 13.06, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,   // 固定战斗室: ±10° 射界内横向伺服, 超界自动转车体
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 130, dmg: 220, reload: 6.0, speed: 792 },
      sample: { l: 3.0, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    su100: {
      name: 'SU-100 歼击车', nation: 'USSR', cls: 'TD', tier: 'VI', hp: 900,
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
      name: 'M3 李 中型坦克', nation: 'USA', cls: 'MT', tier: 'IV', hp: 700,
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
      name: '玛蒂尔达 II', nation: 'UK', cls: 'HT', tier: 'IV', hp: 750,
      maxSpeed: 6.67, reverseRatio: 0.42, accel: 2.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 34.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 100, dmg: 90, reload: 2.8, speed: 731 },
      sample: { l: 2.85, w: 1.4 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    cromwell: {
      name: '克伦威尔 VII', nation: 'UK', cls: 'MT', tier: 'VI', hp: 900,
      maxSpeed: 17.78, reverseRatio: 0.42, accel: 6.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 48.0 * Math.PI / 180, turretTraverse: 44.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 125, dmg: 150, reload: 3.2, speed: 790 },
      sample: { l: 3.2, w: 1.55 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    firefly: {
      name: '谢尔曼 萤火虫', nation: 'UK', cls: 'MT', tier: 'VI', hp: 850,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 34.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 180, reload: 5.5, speed: 887 },
      sample: { l: 3.0, w: 1.45 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    churchill7: {
      name: '丘吉尔 VII', nation: 'UK', cls: 'HT', tier: 'VI', hp: 1250,
      maxSpeed: 6.67, reverseRatio: 0.42, accel: 2.4, brake: 9, coastDrag: 5.2,
      hullTraverse: 26.0 * Math.PI / 180, turretTraverse: 28.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 120, dmg: 150, reload: 3.8, speed: 790 },
      sample: { l: 3.75, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    b1bis: {
      name: 'B1 bis 重型坦克', nation: 'FRA', cls: 'HT', tier: 'IV', hp: 720,
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
      name: '九七式中坦克', nation: 'JPN', cls: 'MT', tier: 'III', hp: 460,
      maxSpeed: 12.22, reverseRatio: 0.42, accel: 4.2, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 55, dmg: 75, reload: 3.0, speed: 700 },
      sample: { l: 2.8, w: 1.2 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    chinu: {
      name: '三式中坦克', nation: 'JPN', cls: 'MT', tier: 'IV', hp: 640,
      maxSpeed: 12.50, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 90, dmg: 120, reload: 3.4, speed: 750 },
      sample: { l: 3.05, w: 1.25 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    tiger2: {
      name: '虎 II 重型坦克', nation: 'GER', cls: 'HT', tier: 'VIII', hp: 1650,
      maxSpeed: 10.56, reverseRatio: 0.42, accel: 2.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 30.0 * Math.PI / 180, turretTraverse: 28.0 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 194, dmg: 240, reload: 7.5, speed: 1000 },
      sample: { l: 3.7, w: 1.85 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    ferdinand: {
      name: '斐迪南歼击车', nation: 'GER', cls: 'TD', tier: 'VII', hp: 1250,
      maxSpeed: 8.33, reverseRatio: 0.42, accel: 2.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 28.0 * Math.PI / 180, turretTraverse: 0.4 * Math.PI / 180, gunArc: 14 * Math.PI / 180,   // 固定战斗室: ±14° 射界内横向伺服, 超界自动转车体
      gunDepression: -9 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 194, dmg: 240, reload: 7.5, speed: 1000 },
      sample: { l: 3.5, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    is3: {
      name: 'IS-3 重型坦克', nation: 'USSR', cls: 'HT', tier: 'VIII', hp: 1550,
      maxSpeed: 10.28, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 28.0 * Math.PI / 180, turretTraverse: 26.0 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 175, dmg: 390, reload: 11, speed: 795 },
      sample: { l: 3.5, w: 1.65 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t44: {
      name: 'T-44 中型坦克', nation: 'USSR', cls: 'MT', tier: 'VIII', hp: 1450,
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
      name: 'T26E4 超级潘兴', nation: 'USA', cls: 'MT', tier: 'VIII', hp: 1500,
      maxSpeed: 11.11, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 38.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 240, reload: 7.5, speed: 853 },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    t29: {
      name: 'T29 重型坦克', nation: 'USA', cls: 'HT', tier: 'VII', hp: 1350,
      maxSpeed: 9.72, reverseRatio: 0.42, accel: 3.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 32.0 * Math.PI / 180, turretTraverse: 30.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 320, reload: 9.0, speed: 920 },
      sample: { l: 3.5, w: 1.7 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    centurion: {
      name: '百人队长 Mk.I', nation: 'UK', cls: 'MT', tier: 'VIII', hp: 1500,
      maxSpeed: 9.44, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 40.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 170, dmg: 190, reload: 6.0, speed: 887 },
      sample: { l: 3.4, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    chiri: {
      name: '三式奇狸 中坦克', nation: 'JPN', cls: 'MT', tier: 'VII', hp: 1100,
      maxSpeed: 10.56, reverseRatio: 0.42, accel: 4.0, brake: 9, coastDrag: 5.2,
      hullTraverse: 40.0 * Math.PI / 180, turretTraverse: 36.0 * Math.PI / 180,
      gunDepression: -12 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 125, dmg: 130, reload: 3.0, speed: 750 },
      sample: { l: 3.25, w: 1.3 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    type62: {
      name: '62式轻型坦克', nation: 'CHN', cls: 'LT', tier: 'VII', hp: 900,
      maxSpeed: 16.67, reverseRatio: 0.45, accel: 5.4, brake: 10, coastDrag: 5.6,
      hullTraverse: 46 * Math.PI / 180, turretTraverse: 44 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 145, dmg: 180, reload: 6.3, speed: 792 },
      sample: { l: 2.95, w: 1.4 },
      dispersion: { base: 0.38, aimTime: 2.1, max: 2.2, move: 1.6, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    type59: {
      name: '59式中型坦克', nation: 'CHN', cls: 'MT', tier: 'VIII', hp: 1450,
      maxSpeed: 13.89, reverseRatio: 0.45, accel: 4.6, brake: 9.5, coastDrag: 5.4,
      hullTraverse: 44 * Math.PI / 180, turretTraverse: 42 * Math.PI / 180,
      gunDepression: -9 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 175, dmg: 250, reload: 7.8, speed: 895 },
      sample: { l: 3.1, w: 1.6 },
      dispersion: { base: 0.40, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    wz111: {
      name: 'WZ-111 重型坦克', nation: 'CHN', cls: 'HT', tier: 'VIII', hp: 1550,
      maxSpeed: 12.5, reverseRatio: 0.42, accel: 3.6, brake: 9, coastDrag: 5.2,
      hullTraverse: 34 * Math.PI / 180, turretTraverse: 34 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 190, dmg: 440, reload: 12.5, speed: 900 },
      sample: { l: 3.6, w: 1.7 },
      dispersion: { base: 0.44, aimTime: 2.6, max: 2.5, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.8 }
    },
    /* ---------- 弹夹(连发)车: 夹内短装填连打, 打完整夹长装填 ---------- */
    amx13: {
      name: 'AMX 13 75 轻型坦克', nation: 'FRA', cls: 'LT', tier: 'VI', hp: 750,
      maxSpeed: 16.7, reverseRatio: 0.5, accel: 5.6, brake: 10.5, coastDrag: 5.8,
      hullTraverse: 46 * Math.PI / 180, turretTraverse: 42 * Math.PI / 180,
      gunDepression: -7 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 106, dmg: 110, reload: 2.3, speed: 800, autoloader: { clip: 6, intra: 2.3, long: 20 } },
      sample: { l: 2.6, w: 1.25 },
      dispersion: { base: 0.40, aimTime: 2.2, max: 2.2, move: 1.6, hullTurn: 1.2, turretTurn: 0.6, fire: 1.2 }
    },
    amx50100: {
      name: 'AMX 50 100 重型坦克', nation: 'FRA', cls: 'HT', tier: 'VIII', hp: 1500,
      maxSpeed: 15.0, reverseRatio: 0.45, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 32 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 13 * Math.PI / 180,
      gun: { pen: 170, dmg: 320, reload: 2.7, speed: 850, autoloader: { clip: 6, intra: 2.7, long: 27 } },
      sample: { l: 3.3, w: 1.55 },
      dispersion: { base: 0.44, aimTime: 2.6, max: 2.5, move: 1.7, hullTurn: 1.2, turretTurn: 0.65, fire: 1.1 }
    },
    lorr40t: {
      name: '洛林 40t 中型坦克', nation: 'FRA', cls: 'MT', tier: 'VIII', hp: 1150,
      maxSpeed: 18.0, reverseRatio: 0.5, accel: 5.0, brake: 10, coastDrag: 5.5,
      hullTraverse: 40 * Math.PI / 180, turretTraverse: 38 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 165, dmg: 300, reload: 2.6, speed: 830, autoloader: { clip: 4, intra: 2.6, long: 24 } },
      sample: { l: 3.1, w: 1.5 },
      dispersion: { base: 0.40, aimTime: 2.4, max: 2.3, move: 1.6, hullTurn: 1.15, turretTurn: 0.6, fire: 1.15 }
    },
    /* ---------- 自行火炮(SPG): 高抛弹道 + 溅射伤害, Shift 鹰眼俯视瞄准 ----------
       弹道参数按 WoT 火炮观感标定: 大重力+高仰角(78°) → 中远程(~360m 起)走高抛吊射,
       高抛仰角够不到的近距离退为低伸直射(火炮近战自保), 最大射程 ~860m 覆盖全图 */
    wespe: {
      name: '黄蜂 自行火炮', nation: 'GER', cls: 'SPG', tier: 'IV', hp: 460,
      maxSpeed: 11.1, reverseRatio: 0.4, accel: 3.6, brake: 8, coastDrag: 5.0,
      hullTraverse: 30 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 78 * Math.PI / 180,
      gun: { pen: 45, dmg: 340, reload: 13.5, speed: 245, grav: 70, splash: 4.4, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.4, w: 1.2 },
      dispersion: { base: 1.15, aimTime: 4.6, max: 2.6, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    hummel: {
      name: '野蜂 自行火炮', nation: 'GER', cls: 'SPG', tier: 'VI', hp: 540,
      maxSpeed: 12.5, reverseRatio: 0.4, accel: 3.8, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 28 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 78 * Math.PI / 180,
      gun: { pen: 62, dmg: 520, reload: 17, speed: 265, grav: 78, splash: 5.4, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.8, w: 1.4 },
      dispersion: { base: 1.3, aimTime: 5.0, max: 2.8, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    m7priest: {
      name: 'M7 牧师 自行火炮', nation: 'USA', cls: 'SPG', tier: 'V', hp: 500,
      maxSpeed: 12.2, reverseRatio: 0.42, accel: 3.8, brake: 8.5, coastDrag: 5.2,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 78 * Math.PI / 180,
      gun: { pen: 52, dmg: 430, reload: 15, speed: 250, grav: 72, splash: 4.8, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.9, w: 1.4 },
      dispersion: { base: 1.2, aimTime: 4.8, max: 2.7, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    su26: {
      name: 'SU-26 自行火炮', nation: 'USSR', cls: 'SPG', tier: 'IV', hp: 480,
      maxSpeed: 10.3, reverseRatio: 0.4, accel: 3.4, brake: 8, coastDrag: 5.0,
      hullTraverse: 30 * Math.PI / 180, turretTraverse: 16 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 78 * Math.PI / 180,
      gun: { pen: 50, dmg: 330, reload: 12, speed: 235, grav: 64, splash: 4.0, life: 10 },
      gunArc: 6 * Math.PI / 180,
      sample: { l: 2.4, w: 1.25 },
      dispersion: { base: 1.1, aimTime: 4.4, max: 2.6, move: 2.2, hullTurn: 1.6, turretTurn: 1.2, fire: 1.4 }
    },
    medium: {
      name: '敌方中型坦克', hp: 550,
      maxSpeed: 12.5, reverseRatio: 0.45, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.8, speed: 780 },
      sample: { l: 3.25, w: 1.5 },
      dispersion: { base: 0.42, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    td: {
      name: '敌方坦克歼击车', hp: 650,
      maxSpeed: 9.7, reverseRatio: 0.4, accel: 3.0, brake: 8, coastDrag: 4.6,
      hullTraverse: 20 * Math.PI / 180, turretTraverse: 0.45 * Math.PI / 180, gunArc: 10 * Math.PI / 180,   // 固定战斗室: ±10° 射界内横向伺服, 超界自动转车体
      gunDepression: -8 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 120, dmg: 280, reload: 8.0, speed: 1000 },
      sample: { l: 3.35, w: 1.45 },
      dispersion: { base: 0.30, aimTime: 2.6, max: 2.0, move: 2.0, hullTurn: 1.4, turretTurn: 0.5, fire: 1.8 }
    },
    heavy: {
      name: '敌方重型坦克', hp: 1000,
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
  camera: { dist: 15, minDist: 6.5, maxDist: 30, height: 4.0, pitch: 0.30, fov: 55, sniperFovMax: 26, sniperFovMin: 8, sens: 0.0009, sniperSens: 0.25 },

  player: { viewRange: 445 },   // WoT 级视野上限

  multiplayer: true,    // 联机入口开关(联机版开启; 单机纯净版可改 false 隐藏)

  // 出击前可选的坦克与地图(配合标题界面车库)
  garage: [],   // CFG 定义后由下方生成
  maps: [
    { id: 'l01', dir: 'l01-encounter', name: '诺曼底 · 遭遇战', desc: '树篱田野与村庄, 三路推进' },
    { id: 'l02', dir: 'l02-city', name: '废墟 · 城市巷战', desc: '街区废墟, 近距肉搏' },
    { id: 'l03', dir: 'l03-highland', name: '山川 · 高地争夺', desc: '峡谷隘口, 制高点对决' }
  ],

  // 音效: 引擎音量曲线(怠速近乎无声 → 全速渐强), engine:false 可完全关闭引擎音
  audio: {
    engine: true,
    voice: true,                        // 中文战斗语音播报(击穿/跳弹/装填完毕等)
    idleGain: 0.03, maxGain: 0.26,     // 怠速/全油门音量
    idleRate: 0.95, topRate: 1.62,     // 怠速/全速播放倍率
    idleLP: 500, topLP: 2200           // 怠速闷/全速亮的低通截止(Hz)
  }
};

// 车类图标(WoT 式, 全游戏统一): ◇轻坦 ◇◇中坦 ◇◇◇重坦 ▽歼击 □火炮 —— innerHTML 场景用
SF.ClsIcon = function (cls, opts = {}) {
  const s = opts.size || 9, col = opts.color || 'currentColor', gap = 2;
  const dm = (x) => `<polygon fill="${col}" points="${x + s / 2},0 ${x + s},${s / 2} ${x + s / 2},${s} ${x},${s / 2}"/>`;
  let w = s, body = '';
  if (cls === 'LT') body = dm(0);
  else if (cls === 'MT') { w = s * 2 + gap; body = dm(0) + dm(s + gap); }
  else if (cls === 'HT') { w = s * 3 + gap * 2; body = dm(0) + dm(s + gap) + dm(s * 2 + gap * 2); }
  else if (cls === 'TD') body = `<polygon fill="${col}" points="0,0 ${s},0 ${s / 2},${s}"/>`;
  else if (cls === 'SPG') body = `<rect fill="${col}" x="0.5" y="0.5" width="${s - 1}" height="${s - 1}"/>`;
  else return '';
  return `<svg width="${w}" height="${s}" viewBox="0 0 ${w} ${s}" style="vertical-align:-1px">${body}</svg>`;
};

// 车库列表(依赖 vehicles 数据, 必须在 CFG 定义后生成)
(() => {
  const sel = ['sherman', 'sherman76', 'jumbo', 'hellcat', 'pz3', 'pz4', 'panther', 'tiger1', 'stug3', 'jagdpanther',
    'bt7', 't34', 't3485', 'kv1', 'kv2', 'is2', 'su85', 'su100', 'isu152', 'm3lee', 'm10', 'm36',
    'matilda', 'cromwell', 'firefly', 'churchill7', 'b1bis', 'somua', 'chiha', 'chinu',
    'tiger2', 'ferdinand', 'is3', 't44', 'm26', 't26e4', 't29', 'centurion', 'chiri',
    'type62', 'type59', 'wz111', 'amx13', 'amx50100', 'lorr40t', 'wespe', 'hummel', 'm7priest', 'su26'];
  const NATION = { USA: 'US', GER: 'DE', USSR: 'RU', UK: 'UK', FRA: 'FR', JPN: 'JP', CHN: 'CN' };   // 国别码(纯首字母 US/USSR/UK 会撞车)
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
    stug3: 75, jagdpanther: 88, bt7: 45, t34: 76, t3485: 85, kv1: 76, kv2: 152, is2: 122, su85: 85, su100: 100,
    isu152: 152, m3lee: 75, m10: 76, m36: 90, matilda: 57, cromwell: 75, firefly: 76, churchill7: 75,
    b1bis: 75, somua: 47, chiha: 57, chinu: 75, tiger2: 88, ferdinand: 88, is3: 122, t44: 100, m26: 90, t26e4: 90,
    t29: 105, centurion: 76, chiri: 75, type62: 85, type59: 100, wz111: 122,
    amx13: 75, amx50100: 100, lorr40t: 100, wespe: 105, hummel: 150, m7priest: 105, su26: 122,
    medium: 75, td: 88, heavy: 105
  };
  const VIEW = {  // m, 点亮距离基数(再乘 (1-目标隐蔽))
    sherman: 370, sherman76: 380, jumbo: 350, hellcat: 370, pz3: 350, pz4: 365, panther: 390, tiger1: 370,
    stug3: 350, jagdpanther: 360, bt7: 330, t34: 350, t3485: 360, kv1: 330, kv2: 320, is2: 350, su85: 330, su100: 340,
    isu152: 330, m3lee: 330, m10: 370, m36: 370, matilda: 330, cromwell: 360, firefly: 370, churchill7: 350,
    b1bis: 310, somua: 320, chiha: 320, chinu: 340, tiger2: 380, ferdinand: 350, is3: 360, t44: 380, m26: 380, t26e4: 380,
    t29: 380, centurion: 390, chiri: 360, type62: 390, type59: 380, wz111: 370,
    amx13: 390, amx50100: 380, lorr40t: 380, wespe: 330, hummel: 330, m7priest: 330, su26: 330,
    medium: 370, td: 350, heavy: 340
  };
  const CAMO_CLS = { LT: 0.16, MT: 0.12, HT: 0.07, TD: 0.22, SPG: 0.08 };   // 静止隐蔽(移动减半/开炮近零/灌木+0.2, 见 SF.camoOf)
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
