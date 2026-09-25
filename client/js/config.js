// config.js — 全部手感/数值参数（调参单一入口; 关卡数据在 assets/maps/*/map.json）
// 角度一律弧度, 速度 m/s, 距离米
window.SF = window.SF || {};

SF.CFG = {
  sim: {
    dt: 1 / 60,            // 固定模拟步长
    shellGravity: 3.2,     // 炮弹重力(WoT 风格弱下坠, 300m 外可感知)
    maxSlope: 0.52         // ~30° 超过则无法爬坡
  },

  // 车辆参数 —— 手感核心, 改这里就是改手感
  vehicles: {
    sherman: {
      name: 'M4 谢尔曼', hp: 900,
      maxSpeed: 13.3, reverseRatio: 0.42,     // 极速 48km/h, 倒车 42%
      accel: 4.0, brake: 9.5, coastDrag: 5.5, // 履带滚动阻力大: 松油门快速站住
      hullTraverse: 40 * Math.PI / 180,       // 车体回转 40°/s
      turretTraverse: 38 * Math.PI / 180,     // 炮塔回转 38°/s (独立于车体)
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.5, speed: 750 },   // 75mm
      sample: { l: 3.05, w: 1.45 },   // 履带接地四角采样半径(前后/左右)——地形贴合用
      dispersion: { base: 0.38, aimTime: 2.2, max: 2.2,      // 基础圈(m@100m)/缩圈时间
        move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 } // 各动作扩圈系数
    },
    sherman76: {
      name: "谢尔曼 M4A3E8'闪电'", hp: 850,
      maxSpeed: 15.6, reverseRatio: 0.5, accel: 4.8, brake: 10, coastDrag: 5.6,
      hullTraverse: 45 * Math.PI / 180, turretTraverse: 44 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 108, dmg: 125, reload: 3.2, speed: 790 },
      sample: { l: 3.05, w: 1.45 },
      dispersion: { base: 0.36, aimTime: 2.0, max: 2.2, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    jumbo: {
      name: '谢尔曼 M4A3E2 突击型', hp: 1150,
      maxSpeed: 11.0, reverseRatio: 0.4, accel: 3.2, brake: 8.5, coastDrag: 5.0,
      hullTraverse: 32 * Math.PI / 180, turretTraverse: 30 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 15 * Math.PI / 180,
      gun: { pen: 101, dmg: 135, reload: 3.9, speed: 760 },
      sample: { l: 3.05, w: 1.5 },
      dispersion: { base: 0.42, aimTime: 2.4, max: 2.3, move: 1.5, hullTurn: 1.1, turretTurn: 0.6, fire: 1.7 }
    },
    hellcat: {
      name: 'M18 地狱猫', hp: 620,
      maxSpeed: 20.0, reverseRatio: 0.55, accel: 6.5, brake: 11, coastDrag: 6.0,
      hullTraverse: 50 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 132, dmg: 240, reload: 7.5, speed: 850 },
      sample: { l: 3.2, w: 1.4 },
      dispersion: { base: 0.34, aimTime: 2.1, max: 2.0, move: 1.8, hullTurn: 1.2, turretTurn: 0.5, fire: 1.8 }
    },
    medium: {
      name: '敌方中型坦克', hp: 550,
      maxSpeed: 12.5, reverseRatio: 0.45, accel: 3.8, brake: 9, coastDrag: 5.2,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.8, speed: 780 },
      sample: { l: 3.25, w: 1.5 },
      dispersion: { base: 0.42, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    td: {
      name: '敌方坦克歼击车', hp: 650,
      maxSpeed: 9.7, reverseRatio: 0.4, accel: 3.0, brake: 8, coastDrag: 4.6,
      hullTraverse: 20 * Math.PI / 180, turretTraverse: 0,   // 战斗室固定: 无炮塔回转
      gunDepression: -6 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 120, dmg: 280, reload: 8.0, speed: 1000 },
      sample: { l: 3.35, w: 1.45 },
      dispersion: { base: 0.30, aimTime: 2.6, max: 2.0, move: 2.0, hullTurn: 1.4, turretTurn: 0.5, fire: 1.8 }
    },
    heavy: {
      name: '敌方重型坦克', hp: 1000,
      maxSpeed: 7.8, reverseRatio: 0.38, accel: 2.6, brake: 7.5, coastDrag: 4.2,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 28 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 110, dmg: 220, reload: 6.0, speed: 820 },
      sample: { l: 3.5, w: 1.6 },
      dispersion: { base: 0.46, aimTime: 2.9, max: 2.6, move: 1.8, hullTurn: 1.2, turretTurn: 0.6, fire: 1.8 }
    }
  },

  // 装甲判定规则
  armor: {
    ricochetAngle: 70 * Math.PI / 180,  // 入射角超过即跳弹
    penVariance: 0.25,                  // 穿深 ±25% 浮动
    modules: {
      track:  { chance: 0.25, duration: 6, text: '履带断裂！' },
      engine: { chance: 0.20, duration: 10, slow: 0.55, text: '发动机受损！' },
      ammo:   { chance: 0.08, dmgMult: 1.6, text: '弹药架被击中！' },
      gun:    { chance: 1.0,  duration: 8, dispPenalty: 1.6, text: '火炮受损！' }
    }
  },

  // AI 感知与性格(难度旋钮: aimPatience 越低越急着开炮 → 越不准)
  ai: {
    viewRange: 380, reactionTime: 0.35, hearingRange: 90, memoryTime: 7,
    perceptionInterval: 0.13,
    personalities: {
      flanker: { band: [55, 115], flankChance: 0.55, aimPatience: 0.78, leadSkill: 0.78, retreatHp: 0.2, holdGround: false },
      sniper:  { band: [190, 300], flankChance: 0,    aimPatience: 1.0,  leadSkill: 1.0,  retreatHp: 0.14, holdGround: true },
      hold:    { band: [70, 130],  flankChance: 0.2,  aimPatience: 0.88, leadSkill: 0.9,  retreatHp: 0.16, holdGround: true }
    }
  },

  // 相机灵敏度: 数值=每像素弧度; 觉得快→调小, 慢→调大(参考: 0.0009 约为鼠标垫横扫一圈)
  camera: { dist: 13, minDist: 6.5, maxDist: 26, height: 3.6, pitch: 0.32, fov: 60, sniperFov: 15, sens: 0.0009, sniperSens: 0.25 },

  player: { viewRange: 380 },

  // 出击前可选的坦克与地图(配合标题界面车库)
  garage: [
    { type: 'sherman',   tag: '均衡', desc: '75mm · 全能可靠' },
    { type: 'sherman76', tag: '高射速', desc: '76mm · 快炮快车' },
    { type: 'jumbo',     tag: '重甲', desc: '厚甲 · 慢速推进' },
    { type: 'hellcat',   tag: '猎杀', desc: '90mm · 极速玻璃炮' }
  ],
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

/* ---------- 通用小工具 ---------- */
SF.Util = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  // 角度差(结果 ∈ [-π,π], from a to b)
  angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; },
  moveToward(cur, target, maxStep) { const d = target - cur; return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; },
  angMoveToward(cur, target, maxStep) { const d = SF.Util.angDiff(cur, target); return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; },
  dist2d(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); },
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
