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
      accel: 4.0, brake: 7.5, coastDrag: 1.6, // 起步迟滞与刹车滑行
      hullTraverse: 40 * Math.PI / 180,       // 车体回转 40°/s
      turretTraverse: 38 * Math.PI / 180,     // 炮塔回转 38°/s (独立于车体)
      gunDepression: -10 * Math.PI / 180, gunElevation: 18 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.5, speed: 750 },   // 75mm
      dispersion: { base: 0.38, aimTime: 2.2, max: 2.2,      // 基础圈(m@100m)/缩圈时间
        move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 } // 各动作扩圈系数
    },
    medium: {
      name: '敌方中型坦克', hp: 550,
      maxSpeed: 12.5, reverseRatio: 0.45, accel: 3.8, brake: 7, coastDrag: 1.6,
      hullTraverse: 42 * Math.PI / 180, turretTraverse: 40 * Math.PI / 180,
      gunDepression: -8 * Math.PI / 180, gunElevation: 16 * Math.PI / 180,
      gun: { pen: 95, dmg: 150, reload: 3.8, speed: 780 },
      dispersion: { base: 0.42, aimTime: 2.3, max: 2.4, move: 1.5, hullTurn: 1.1, turretTurn: 0.55, fire: 1.6 }
    },
    td: {
      name: '敌方坦克歼击车', hp: 650,
      maxSpeed: 9.7, reverseRatio: 0.4, accel: 3.0, brake: 6, coastDrag: 1.5,
      hullTraverse: 20 * Math.PI / 180, turretTraverse: 0,   // 战斗室固定: 无炮塔回转
      gunDepression: -6 * Math.PI / 180, gunElevation: 12 * Math.PI / 180,
      gun: { pen: 120, dmg: 280, reload: 8.0, speed: 1000 },
      dispersion: { base: 0.30, aimTime: 2.6, max: 2.0, move: 2.0, hullTurn: 1.4, turretTurn: 0.5, fire: 1.8 }
    },
    heavy: {
      name: '敌方重型坦克', hp: 1000,
      maxSpeed: 7.8, reverseRatio: 0.38, accel: 2.6, brake: 5.5, coastDrag: 1.4,
      hullTraverse: 24 * Math.PI / 180, turretTraverse: 28 * Math.PI / 180,
      gunDepression: -6 * Math.PI / 180, gunElevation: 14 * Math.PI / 180,
      gun: { pen: 110, dmg: 220, reload: 6.0, speed: 820 },
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
    viewRange: 350, reactionTime: 0.5, hearingRange: 80, memoryTime: 6,
    perceptionInterval: 0.15,
    personalities: {
      flanker: { band: [55, 115], flankChance: 0.5, aimPatience: 0.55, leadSkill: 0.5, retreatHp: 0.22, holdGround: false },
      sniper:  { band: [180, 280], flankChance: 0,   aimPatience: 1.0, leadSkill: 1.0, retreatHp: 0.15, holdGround: true },
      hold:    { band: [70, 130],  flankChance: 0.15, aimPatience: 0.7, leadSkill: 0.7, retreatHp: 0.18, holdGround: true }
    }
  },

  camera: { dist: 13, minDist: 6.5, maxDist: 26, height: 3.6, pitch: 0.32, fov: 60, sniperFov: 15, sens: 0.0022 },

  player: { viewRange: 380 }
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
