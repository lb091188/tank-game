#!/usr/bin/env node
// build-map.js — 生成三张地图资产（零 npm 依赖）
// 用法: node tools/build-map.js [l01|l02|l03|all]
//   l01 诺曼底遭遇战(树篱田野) / l02 城市巷战(废墟街区) / l03 山川高地(峡谷隘口)
// 输出: client/assets/maps/<dir>/{heightmap.png, map.json} —— 手改 json 即改关卡
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'client', 'assets', 'maps');
const SIZE = 800, RES = 256, MAX_H = 70;

/* ---------- 噪声/工具 ---------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed, gridN) {
  const r = mulberry32(seed);
  const g = new Float32Array(gridN * gridN);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, z) => {
    const fx = x * gridN - 0.5, fz = z * gridN - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const at = (i, j) => g[((j + gridN) % gridN) * gridN + ((i + gridN) % gridN)];
    const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sz;
  };
}
const n1 = makeNoise(11, 8), n2 = makeNoise(77, 16), n3 = makeNoise(313, 48), n4 = makeNoise(909, 6);
const fbm = (x, z) => n1(x, z) * 0.55 + n2(x, z) * 0.3 + n3(x, z) * 0.15;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/* ---------- PNG(16bit 灰度) ---------- */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c; }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
function writePNG16(file, w, h, getPixel) {
  const raw = Buffer.alloc(h * (1 + w * 2));
  for (let j = 0; j < h; j++) {
    const row = j * (1 + w * 2); raw[row] = 0;
    for (let i = 0; i < w; i++) raw.writeUInt16BE(Math.round(clamp(getPixel(i, j), 0, 1) * 65535), row + 1 + i * 2);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
}

/* ============ l01 诺曼底(沿用 V2 设计) ============ */
const STREAM1 = { a: [-130, 245], b: [130, 165] };
const CRATERS1 = [];
{ const r = mulberry32(20261001); for (let i = 0; i < 16; i++) CRATERS1.push({ x: -70 + r() * 140, z: -215 + r() * 55, r: 3.5 + r() * 3, d: 0.8 + r() * 0.7 }); }
function terrainL01(x, z) {
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 7;
  h -= (1 - ss(60, 150, Math.abs(x))) * 3.5;
  const wobE = 0.78 + 0.22 * Math.sin(z * 0.018 + 1.3), wobW = 0.78 + 0.22 * Math.sin(z * 0.016 + 4.1);
  h += gauss(Math.abs(x - 195) * (1 + 0.25 * Math.sin(z * 0.012)), 55) * 15 * wobE;
  h += gauss(Math.abs(x + 195) * (1 + 0.22 * Math.cos(z * 0.013)), 55) * 15 * wobW;
  h -= gauss(x + 195, 30) * gauss(z - 110, 42) * 6.5;
  h += gauss(Math.hypot((x - 255) * 1.1, z + 60), 42) * 10;
  h -= gauss(Math.hypot((x - 222) * 1.2, z + 60), 16) * 3.2;
  for (const [fz, fw, fh] of [[188, 24, 3.2], [96, 22, 2.6]])
    h += gauss(z - fz, fw) * fh * (1 - ss(120, 220, Math.abs(x)));
  h -= gauss(distSeg(x, z, ...STREAM1.a, ...STREAM1.b), 6.5) * 2.6;
  const gap = Math.min(ss(60, 100, Math.abs(Math.abs(x) - 100)), 1);
  h += gauss(z + 230, 42) * 20 * (1 - gap * 0.85) * ss(320, 220, -z - 0);
  for (const c of CRATERS1) h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d;
  const spawnFlat = ss(75, 30, Math.hypot(x, z - 335));
  h = h * (1 - spawnFlat) + 6.5 * spawnFlat;
  const vil = ss(95, 45, Math.abs(x)) * ss(90, 50, Math.abs(z - 10));
  h = h * (1 - vil * 0.6) + 7.5 * (vil * 0.6);
  const bx = Math.max(Math.abs(x) - (352 + 20 * n4((x + 400) / SIZE, 0.3)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 20 * n4(0.7, (z + 400) / SIZE)), 0);
  h += ss(0, 45, Math.hypot(bx, bz)) * 55;
  return h;
}
function coversL01(add, rng) {
  add('barn', -60, 26, 0.15);
  add('house', -45, 18, 0.3); add('house', 12, 34, -0.2, 1.1); add('house', 50, 10, 1.35, 0.9);
  add('house', 58, 40, -0.5, 0.85); add('house', -20, 55, 0.1, 0.95); add('house', 85, 28, 1.6, 0.8);
  add('ruin', -12, 8, 0.4); add('ruin', 75, 55, 1.2);
  for (const [wx, wz] of [[30, 18], [-55, 45]]) add('wall', wx, wz, rng() * 3, 1);
  add('haystack', -30, 65, 0); add('haystack', 42, 60, 0, 0.9); add('haystack', -78, 8, 0, 1.1);
  { // 树篱田块
    const x0 = -150, z0 = 95, cw = 62, chh = 54;
    for (let gx = x0; gx < 150; gx += cw) for (let gz = z0; gz < 268; gz += chh) {
      for (const e of [{ ax: gx, az: gz, bx: gx + cw, bz: gz, yaw: 0 }, { ax: gx, az: gz, bx: gx, bz: gz + chh, yaw: Math.PI / 2 }]) {
        for (let s2 = 0; s2 < 3; s2++) {
          if (rng() < 0.22) continue;
          const t = (s2 + 0.5) / 3;
          const px = e.ax + (e.bx - e.ax) * t, pz = e.az + (e.bz - e.az) * t;
          if (Math.abs(px) < 14 && pz < 260) continue;
          add(rng() < 0.65 ? 'hedge' : 'wall', px, pz, e.yaw + (rng() - 0.5) * 0.2, 0.9 + rng() * 0.35);
        }
      }
    }
  }
  for (let i = 0; i < 10; i++) add('haystack', -140 + rng() * 280, 100 + rng() * 160, 0, 0.8 + rng() * 0.5);
  for (let i = 0; i < 26; i++) add('bush', -150 + rng() * 300, 95 + rng() * 170, 0, 0.7 + rng() * 0.8);
  for (let z = 315; z > 95; z -= 21) { add('tree', -11.5, z, rng() * 6, 0.85 + rng() * 0.4); if (z < 300) add('tree', 11.5, z - 9, rng() * 6, 0.85 + rng() * 0.4); }
  for (let i = 0; i < 46; i++) add('tree', -285 + rng() * 110, -40 + rng() * 300, rng() * 6, 0.8 + rng() * 0.7);
  for (let i = 0; i < 16; i++) add('bush', -280 + rng() * 100, -30 + rng() * 280, 0, 0.8 + rng() * 0.8);
  for (const [rx, rz] of [[-240, 60], [-160, 180], [-230, 240]]) add('rock', rx, rz, rng() * 6, 1 + rng());
  add('rock', 248, -48, 1.2, 1.5); add('rock', 262, -70, 0.4, 1.3); add('rock', 240, -78, 2.2, 1.2);
  add('wreck', 250, -95, 2.4);
  add('ruin', 150, -130, 0.8); add('ruin', 168, -118, 2.1); add('wall', 158, -140, 0.3, 1.2);
  add('wreck', 140, -112, 0.6);
  add('haystack', 172, -142, 0, 1.1);
  for (const rx of [-195, 195]) for (let z = 260; z > -260; z -= 46) add('rock', rx + (rng() - 0.5) * 36, z + (rng() - 0.5) * 26, rng() * 6, 0.9 + rng() * 0.9);
  add('rock', -38, 186, 1, 1.3); add('rock', 44, 92, 2, 1.2); add('wreck', 6, 150, 1.1); add('wreck', -52, 96, 2.8);
  add('rock', -22, -170, 0.5, 1.1); add('rock', 38, -120, 2, 1.4);
  for (let x = -52; x <= 52; x += 17) add('trap', x, -186, rng() * 3);
  for (let x = -80; x <= 80; x += 26) add('trap', x + 8, -172, rng() * 3);
  add('wall', -70, -196, 0.1, 1.2); add('wall', 62, -198, -0.1, 1.2);
  add('wreck', -18, -206, 0.9); add('wreck', 30, -212, 2.2);
  for (let i = 0; i < 26; i++) { const side = rng() < 0.5 ? -1 : 1; add('tree', side * (315 + rng() * 55), 320 - rng() * 640, rng() * 6, 0.9 + rng() * 0.6); }
}

/* ============ l02 城市巷战 ============ */
function terrainL02(x, z) {
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 1.4;           // 城区近水平
  h += ss(120, 260, Math.abs(x)) * 3 + ss(140, 300, Math.abs(z - 40)) * 2;   // 郊区缓升
  h += gauss(z + 250, 60) * 6 * ss(200, 60, -z);                        // 北侧抬升(防区高地)
  const plaza = ss(90, 30, Math.hypot(x * 0.9, z + 130));              // 北广场略高台阶
  h = h * (1 - plaza * 0.5) + (h + 1.2) * plaza * 0.5;
  const spawnFlat = ss(80, 30, Math.hypot(x, z - 330));
  h = h * (1 - spawnFlat) + 6 * spawnFlat;
  const bx = Math.max(Math.abs(x) - (352 + 18 * n4(0.2, (z + 400) / SIZE)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 18 * n4((x + 400) / SIZE, 0.8)), 0);
  h += ss(0, 45, Math.hypot(bx, bz)) * 55;
  return h;
}
function coversL02(add, rng) {
  // 街区网格: 街宽 22m, 街区长 56m; 每块 1-2 建筑 + 废墟 + 街角墙
  const x0 = -168, z0 = -80, cw = 78, chh = 78;
  for (let gx = x0; gx <= 168 - cw; gx += cw) {
    for (let gz = z0; gz <= 250 - chh; gz += chh) {
      const cx = gx + cw / 2 - 11, cz = gz + chh / 2;
      const roll = rng();
      if (roll < 0.55) { add('barn', cx, cz, rng() < 0.5 ? 0 : Math.PI / 2, 0.9 + rng() * 0.3); if (rng() < 0.5) add('house', cx + (rng() - 0.5) * 24, cz + (rng() - 0.5) * 24, rng() * 3, 0.85); }
      else if (roll < 0.8) { add('house', cx, cz, rng() * 3, 1.0 + rng() * 0.3); add('ruin', cx + 26, cz + (rng() - 0.5) * 30, rng() * 3); }
      else { add('ruin', cx, cz, rng() * 3); add('ruin', cx + 24, cz + 20, rng() * 3, 0.9); add('wall', cx - 8, cz - 18, rng() * 3, 1.1); }
      if (rng() < 0.5) add('wreck', gx + 39 + (rng() - 0.5) * 10, cz + (rng() - 0.5) * 40, rng() * 3);   // 街上残骸
    }
  }
  // 中央大道两侧路障
  for (let z = 250; z > -100; z -= 34) { add('trap', -13, z, rng() * 3); add('trap', 13, z - 15, rng() * 3); }
  // 北广场: 环形工事
  add('ruin', -50, -160, 0.3, 1.3); add('ruin', 52, -158, 2.8, 1.2); add('barn', 0, -195, 0.05, 1.2);
  for (let x = -60; x <= 60; x += 20) add('wall', x, -150, rng() * 0.2, 1.3);
  add('wreck', -26, -172, 1.5); add('wreck', 30, -170, 4.2); add('wreck', 0, -140, 2.6);
  // 瓦砾堆与弹坑感散岩
  for (let i = 0; i < 22; i++) add('rock', -160 + rng() * 320, -90 + rng() * 330, rng() * 6, 0.7 + rng() * 0.6);
  // 郊区行道树
  for (let z = 300; z > 200; z -= 24) { add('tree', -150, z, rng() * 6, 0.9); add('tree', 150, z - 10, rng() * 6, 0.9); }
}

/* ============ l03 山川高地 ============ */
function terrainL03(x, z) {
  let h = 5 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 5;
  // 两条陡峭南北山脊 x=±140, 高 26m, 各带一处鞍部通道
  for (const rx of [-140, 140]) {
    const d = Math.abs(x - rx) * (1 + 0.3 * Math.sin(z * 0.01 + rx));
    h += gauss(d, 34) * 26;
  }
  h -= gauss(x + 140, 26) * gauss(z - 100, 46) * 11;    // 西脊鞍部(z≈100)
  h -= gauss(x - 140, 26) * gauss(z + 150, 46) * 11;    // 东脊鞍部(z≈-150)
  // 中央峡谷干河床(蜿蜒)
  const riverZ = 40 * Math.sin(x * 0.012) - 20;
  h -= gauss(z - riverZ, 26) * 2.2 * (1 - ss(70, 130, Math.abs(x)));
  // 北峰高地(阵地) 与南坡
  h += gauss(Math.hypot(x * 0.8, z + 250), 90) * 16;
  const spawnFlat = ss(70, 28, Math.hypot(x - 0, z - 325));
  h = h * (1 - spawnFlat) + 6 * spawnFlat;
  // 中部山间小村台地
  const vil = ss(40, 16, Math.hypot(x + 20, z - 40));
  h = h * (1 - vil * 0.5) + (h + 0.8) * vil * 0.5;
  const bx = Math.max(Math.abs(x) - (350 + 26 * n4((x + 400) / SIZE, 0.5)), 0);
  const bz = Math.max(Math.abs(z) - (350 + 26 * n4(0.5, (z + 400) / SIZE)), 0);
  h += ss(0, 42, Math.hypot(bx, bz)) * 60;
  return h;
}
function coversL03(add, rng) {
  // 山间小村
  add('barn', -32, 52, 0.2, 0.9); add('house', -8, 30, 0.4, 0.95); add('house', -46, 28, 1.9, 0.9);
  add('ruin', -20, 62, 2.9); add('wall', -30, 44, 0.6, 1.1); add('wall', -2, 52, 0.1, 1.0);
  add('haystack', -50, 48, 0, 0.9); add('haystack', 6, 44, 0, 0.8);
  // 峡谷乱石阵
  for (let i = 0; i < 34; i++) add('rock', -60 + rng() * 120, -140 + rng() * 320, rng() * 6, 0.9 + rng() * 1.1);
  // 山坡松林
  for (let i = 0; i < 62; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    add('tree', side * (95 + rng() * 130), 300 - rng() * 600, rng() * 6, 0.85 + rng() * 0.7);
  }
  for (let i = 0; i < 14; i++) add('bush', -100 + rng() * 200, -100 + rng() * 300, 0, 0.8 + rng() * 0.7);
  // 脊线岩石(反斜面卖头位标记)
  for (const rx of [-140, 140]) for (let z = 270; z > -270; z -= 42) add('rock', rx + (rng() - 0.5) * 26, z + (rng() - 0.5) * 20, rng() * 6, 1 + rng() * 0.9);
  // 北峰阵地工事
  for (let x = -46; x <= 46; x += 19) add('trap', x, -232, rng() * 3);
  add('wall', -58, -240, 0.15, 1.2); add('wall', 56, -238, -0.1, 1.2);
  add('wreck', -20, -252, 0.8); add('wreck', 26, -250, 2.4); add('wreck', 0, -224, 1.6);
  // 谷地残骸
  add('wreck', -30, 140, 2.9); add('wreck', 34, -40, 0.4);
  // 南侧出身掩护
  for (const [rx, rz] of [[-36, 268], [30, 276]]) add('rock', rx, rz, rng() * 6, 1.2);
}

/* ============ 地图定义 ============ */
const MAPS = {
  l01: {
    dir: 'l01-encounter', name: '诺曼底 · 遭遇战', seed: 20261001,
    briefing: '穿越树篱田野与干河床，肃清村庄巡逻队，随后突破北坡敌军阵地。全歼敌军即胜利。',
    terrain: terrainL01, covers: coversL01,
    lighting: { sunDir: [0.45, 0.75, 0.35], sunColor: [1.0, 0.95, 0.85], sunIntensity: 1.15, ambient: 0.55, ambientColor: [0.6, 0.7, 0.85], fogColor: [0.78, 0.83, 0.9], fogDensity: 0.0013, skyTop: [0.42, 0.6, 0.85], skyBottom: [0.87, 0.91, 0.95] },
    player: { spawn: [0, 335, Math.PI] },
    waves: [
      { name: '村庄巡逻队', enemies: [
        { type: 'medium', pos: [-28, -12], yaw: Math.PI, personality: 'flanker', patrol: [[-28, -12], [32, 6], [-24, 38]] },
        { type: 'medium', pos: [36, 18], yaw: Math.PI, personality: 'flanker', patrol: [[36, 18], [8, 44], [46, 48]] } ] },
      { name: '北坡阵地', enemies: [
        { type: 'td', pos: [58, -242], yaw: -2.55, personality: 'sniper', hold: true },
        { type: 'heavy', pos: [-16, -268], yaw: 3.14, personality: 'hold', patrol: [[-16, -268], [14, -262]] } ] }
    ]
  },
  l02: {
    dir: 'l02-city', name: '废墟 · 城市巷战', seed: 20261002,
    briefing: '逐街推进，肃清街区敌军，最终攻克北广场核心阵地。残垣断壁是掩体也是坟场。',
    terrain: terrainL02, covers: coversL02,
    lighting: { sunDir: [-0.4, 0.6, 0.5], sunColor: [1.0, 0.88, 0.75], sunIntensity: 1.0, ambient: 0.5, ambientColor: [0.55, 0.58, 0.62], fogColor: [0.72, 0.72, 0.72], fogDensity: 0.0019, skyTop: [0.5, 0.52, 0.55], skyBottom: [0.8, 0.78, 0.74] },
    player: { spawn: [0, 300, Math.PI] },
    waves: [
      { name: '街区巡逻队', enemies: [
        { type: 'medium', pos: [-90, 60], yaw: Math.PI, personality: 'flanker', patrol: [[-90, 60], [-51, 60], [-51, -2], [-90, -2]] },
        { type: 'medium', pos: [90, 20], yaw: Math.PI, personality: 'flanker', patrol: [[90, 20], [51, 20], [51, 98], [90, 98]] } ] },
      { name: '广场核心阵地', enemies: [
        { type: 'heavy', pos: [0, -178], yaw: 3.14, personality: 'hold', hold: true },
        { type: 'td', pos: [78, -120], yaw: 2.2, personality: 'sniper', hold: true },
        { type: 'medium', pos: [-78, -118], yaw: -2.2, personality: 'flanker', patrol: [[-78, -118], [-40, -80], [-78, -40]] } ] }
    ]
  },
  l03: {
    dir: 'l03-highland', name: '山川 · 高地争夺', seed: 20261003,
    briefing: '沿峡谷推进，夺取山间小村，翻越鞍部攻克北峰阵地。制高点决定一切。',
    terrain: terrainL03, covers: coversL03,
    lighting: { sunDir: [0.5, 0.85, 0.2], sunColor: [1.0, 0.98, 0.92], sunIntensity: 1.25, ambient: 0.5, ambientColor: [0.62, 0.72, 0.9], fogColor: [0.8, 0.86, 0.94], fogDensity: 0.0010, skyTop: [0.32, 0.52, 0.85], skyBottom: [0.85, 0.9, 0.96] },
    player: { spawn: [0, 322, Math.PI] },
    waves: [
      { name: '峡谷巡逻队', enemies: [
        { type: 'medium', pos: [-24, 80], yaw: Math.PI, personality: 'flanker', patrol: [[-24, 80], [30, 60], [-10, 130]] },
        { type: 'medium', pos: [30, -10], yaw: Math.PI, personality: 'flanker', patrol: [[30, -10], [-28, 0], [26, 40]] } ] },
      { name: '高地守军', enemies: [
        { type: 'td', pos: [-140, 10], yaw: 1.35, personality: 'sniper', hold: true },
        { type: 'td', pos: [140, -190], yaw: -1.2, personality: 'sniper', hold: true },
        { type: 'heavy', pos: [0, -258], yaw: 3.14, personality: 'hold', hold: true } ] }
    ]
  }
};

/* ============ 生成 ============ */
const which = process.argv[2] || 'all';
for (const id in MAPS) {
  if (which !== 'all' && which !== id) continue;
  const M = MAPS[id];
  const rng = mulberry32(M.seed);
  const H = new Float32Array(RES * RES);
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++)
      H[j * RES + i] = M.terrain(-SIZE / 2 + (i / (RES - 1)) * SIZE, -SIZE / 2 + (j / (RES - 1)) * SIZE);
  // 平滑(保留边界陡峭)
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(H);
    for (let j = 1; j < RES - 1; j++)
      for (let i = 1; i < RES - 1; i++) {
        const x = -SIZE / 2 + (i / (RES - 1)) * SIZE, z = -SIZE / 2 + (j / (RES - 1)) * SIZE;
        if (Math.abs(x) > 346 || Math.abs(z) > 346) continue;
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += src[(j + dj) * RES + (i + di)];
        H[j * RES + i] = s / 9;
      }
  }
  // 坡度自检(出生点→敌阵主轴)
  const sampleH = (x, z) => {
    const fi = clamp((x + SIZE / 2) / SIZE, 0, 1) * (RES - 1), fj = clamp((z + SIZE / 2) / SIZE, 0, 1) * (RES - 1);
    const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
    const a = H[j * RES + i], b = H[j * RES + i + 1], c = H[(j + 1) * RES + i], d = H[(j + 1) * RES + i + 1];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
  };
  const [sx0, sz0] = M.player.spawn;
  let worst = 0;
  const pts = [[sx0, sz0], [0, 0], [0, -260]];
  for (let k = 0; k < pts.length - 1; k++)
    for (let s = 0; s < 24; s++) {
      const x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * s / 24, z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * s / 24;
      const h0 = sampleH(x, z), h1 = sampleH(x + 8, z + 8);
      worst = Math.max(worst, Math.atan2(Math.abs(h1 - h0), Math.hypot(8, 8)) * 180 / Math.PI);
    }
  // 掩体
  const covers = [];
  const add = (type, x, z, yaw = 0, scale = 1) => covers.push({ type, x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2), scale: +scale.toFixed(2) });
  M.covers(add, rng);
  const mapJson = {
    _说明: '手改本文件即可调整关卡(世界坐标米, x 东西 / z 南北, 玩家在南朝北推进)',
    id: id + '-' + M.dir, name: M.name, briefing: M.briefing,
    terrain: { size: SIZE, resolution: RES, maxHeight: MAX_H },
    lighting: M.lighting, player: M.player,
    waves: M.waves,
    repairBetweenWaves: { hpRatio: 0.35, duration: 4, text: '维修组抢修中…' },
    covers,
    objectives: { winText: '敌军全歼 · 任务完成', loseText: '坦克被击毁 · 任务失败' }
  };
  const dir = path.join(ROOT, M.dir);
  fs.mkdirSync(dir, { recursive: true });
  writePNG16(path.join(dir, 'heightmap.png'), RES, RES, (i, j) => H[j * RES + i] / MAX_H);
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(mapJson, null, 2));
  const byType = {};
  for (const c of covers) byType[c.type] = (byType[c.type] || 0) + 1;
  console.log(`✓ ${id} ${M.dir}: 主轴最大坡度 ${worst.toFixed(1)}°, 掩体 ${covers.length} 个 [${Object.entries(byType).map(([t, n]) => t + '×' + n).join(' ')}]`);
}
