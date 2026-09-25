#!/usr/bin/env node
// build-map.js — 生成第一关「遭遇战」地图资产（零 npm 依赖）· V2 丰富版
// 用法: node tools/build-map.js
// 输出: client/assets/maps/l01-encounter/{heightmap.png, map.json}
//   heightmap.png  16 位灰度高程图 256×256（渲染网格与物理采样同源）
//   map.json       关卡数据（掩体/出生点/巡逻/波次/灯光）——手改即生效，无需动引擎
//
// V2 地形: 谷地横向褶皱(卖头位) / 干涸河床 / 东侧小丘 / 北坡弹坑群 / 侧翼鞍部 / 不规则边界
// V2 掩体: 树篱田块(诺曼底博卡热) / 石墙 / 废墟 / 坦克残骸 / 谷仓 / 干草垛 / 灌木 / 公路行道树
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAP_DIR = path.join(__dirname, '..', 'client', 'assets', 'maps', 'l01-encounter');
const SIZE = 800;        // 世界尺寸(米), 坐标 x,z ∈ [-400,400]
const RES = 256;         // 高程图分辨率
const MAX_H = 70;        // 高度编码范围(米): 0..65535 → 0..MAX_H

/* ---------- 伪随机 & 值噪声 ---------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261001);

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
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));
// 点到线段距离
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/* ---------- 设计地形 V2: h(x,z) 米 ---------- */
// 干涸河床(斜穿谷地)
const STREAM = { a: [-130, 245], b: [130, 165] };
// 弹坑群(北坡前)
const CRATERS = [];
for (let i = 0; i < 16; i++) CRATERS.push({ x: -70 + rng() * 140, z: -215 + rng() * 55, r: 3.5 + rng() * 3, d: 0.8 + rng() * 0.7 });

function terrain(x, z) {
  // 基础起伏
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 7;

  // 中央谷地(南北向): 低于两侧, 公路走廊更平
  const valley = smoothstep(60, 150, Math.abs(x));
  h -= (1 - valley) * 3.5;

  // 东西两侧丘陵脊线(侧翼路线 + 反斜面卖头位), 幅度起伏形成天然鞍部
  const wobE = 0.78 + 0.22 * Math.sin(z * 0.018 + 1.3);
  const wobW = 0.78 + 0.22 * Math.sin(z * 0.016 + 4.1);
  h += gauss(Math.abs(x - 195) * (1 + 0.25 * Math.sin(z * 0.012)), 55) * 15 * wobE;
  h += gauss(Math.abs(x + 195) * (1 + 0.22 * Math.cos(z * 0.013)), 55) * 15 * wobW;

  // 西侧鞍部通道(z≈110 明显下切, 步兵林间小路式绕行位)
  h -= gauss(x + 195, 30) * gauss(z - 110, 42) * 6.5;

  // 东侧小丘(狙击阵地, 250,-60): 与主脊之间有鞍部
  h += gauss(Math.hypot((x - 255) * 1.1, z + 60), 42) * 10;
  h -= gauss(Math.hypot((x - 222) * 1.2, z + 60), 16) * 3.2;   // 小丘西侧鞍部

  // 谷地横向褶皱 ×2(推进路上的卖头反斜面)
  for (const [fz, fw, fh] of [[188, 24, 3.2], [96, 22, 2.6]])
    h += gauss(z - fz, fw) * fh * (1 - smoothstep(120, 220, Math.abs(x)));

  // 干涸河床(两岸缓坡, 可通行)
  h -= gauss(distSeg(x, z, ...STREAM.a, ...STREAM.b), 6.5) * 2.6;

  // 北坡防御岭(z≈-230): 敌方阵地; 两端缺口(x≈±100 可绕)
  const gap = Math.min(smoothstep(60, 100, Math.abs(Math.abs(x) - 100)), 1);
  h += gauss(z + 230, 42) * 20 * (1 - gap * 0.85) * smoothstep(320, 220, -z - 0);

  // 弹坑群(微掩蔽)
  for (const c of CRATERS) h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d;

  // 南端出生地整平
  const spawnFlat = smoothstep(75, 30, Math.hypot(x, z - 335));
  h = h * (1 - spawnFlat) + 6.5 * spawnFlat;

  // 村庄台地(z∈[-50,70]) 略整平
  const vil = smoothstep(95, 45, Math.abs(x)) * smoothstep(90, 50, Math.abs(z - 10));
  h = h * (1 - vil * 0.6) + 7.5 * (vil * 0.6);

  // 边界山体(不可越, 边缘不规则)
  const bx = Math.max(Math.abs(x) - (352 + 20 * n4((x + 400) / SIZE, 0.3)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 20 * n4(0.7, (z + 400) / SIZE)), 0);
  h += smoothstep(0, 45, Math.hypot(bx, bz)) * 55;

  return h;
}

/* ---------- 生成高程网格 + 平滑 ---------- */
const H = new Float32Array(RES * RES);
for (let j = 0; j < RES; j++)
  for (let i = 0; i < RES; i++) {
    const x = -SIZE / 2 + (i / (RES - 1)) * SIZE;
    const z = -SIZE / 2 + (j / (RES - 1)) * SIZE;
    H[j * RES + i] = terrain(x, z);
  }
const blurred = Float32Array.from(H);
for (let pass = 0; pass < 2; pass++) {
  const src = Float32Array.from(blurred);
  for (let j = 1; j < RES - 1; j++)
    for (let i = 1; i < RES - 1; i++) {
      const x = -SIZE / 2 + (i / (RES - 1)) * SIZE, z = -SIZE / 2 + (j / (RES - 1)) * SIZE;
      if (Math.abs(x) > 350 || Math.abs(z) > 350) continue;
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += src[(j + dj) * RES + (i + di)];
      blurred[j * RES + i] = s / 9;
    }
}
H.set(blurred);

/* ---------- 坡度自检 ---------- */
function sampleH(x, z) {
  const fi = clamp((x + SIZE / 2) / SIZE, 0, 1) * (RES - 1), fj = clamp((z + SIZE / 2) / SIZE, 0, 1) * (RES - 1);
  const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
  const a = H[j * RES + i], b = H[j * RES + i + 1], c = H[(j + 1) * RES + i], d = H[(j + 1) * RES + i + 1];
  return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
}
let worstSlope = 0, worstAt = '';
const checkPath = (name, pts) => {
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const x = x0 + (x1 - x0) * s / steps, z = z0 + (z1 - z0) * s / steps;
      const h0 = sampleH(x, z), h1 = sampleH(x + (x1 - x0) / steps * 4, z + (z1 - z0) / steps * 4);
      const deg = Math.atan2(Math.abs(h1 - h0), Math.hypot((x1 - x0) / steps * 4, (z1 - z0) / steps * 4)) * 180 / Math.PI;
      if (deg > worstSlope) { worstSlope = deg; worstAt = `${name} @(${x.toFixed(0)},${z.toFixed(0)})`; }
    }
  }
};
checkPath('谷地公路', [[0, 330], [0, 100], [0, -150], [0, -260]]);
checkPath('东脊线', [[195, 300], [195, 0], [195, -250]]);
checkPath('西脊线(经鞍部)', [[-195, 300], [-195, 110], [-195, -250]]);
checkPath('河床穿越', [[-60, 215], [0, 205], [60, 195]]);
checkPath('东侧小丘', [[195, -60], [255, -60]]);
checkPath('北坡缺口西', [[-100, -180], [-100, -260]]);
console.log(`自检: 主要路径最大坡度 ${worstSlope.toFixed(1)}° @ ${worstAt} (应 < 30°)`);

/* ---------- 16 位灰度 PNG 编码器 ---------- */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'ascii');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
function writePNG16(file, w, h, getPixel) {
  const raw = Buffer.alloc(h * (1 + w * 2));
  for (let j = 0; j < h; j++) {
    const row = j * (1 + w * 2);
    raw[row] = 0;
    for (let i = 0; i < w; i++) {
      const v = Math.round(clamp(getPixel(i, j), 0, 1) * 65535);
      raw.writeUInt16BE(v, row + 1 + i * 2);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

/* ---------- 掩体摆放 V2(写入 map.json, 引擎按 type 程序化建模) ---------- */
const covers = [];
const add = (type, x, z, yaw = 0, scale = 1) => covers.push({ type, x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2), scale: +scale.toFixed(2) });

/* 村庄: 教堂式谷仓 + 农舍群 + 石墙院落 + 井场 */
add('barn', -60, 26, 0.15);
add('house', -45, 18, 0.3); add('house', 12, 34, -0.2, 1.1); add('house', 50, 10, 1.35, 0.9);
add('house', 58, 40, -0.5, 0.85); add('house', -20, 55, 0.1, 0.95); add('house', 85, 28, 1.6, 0.8);
add('ruin', -12, 8, 0.4); add('ruin', 75, 55, 1.2);
for (const [wx, wz] of [[30, 18], [-55, 45]]) add('wall', wx, wz, rng() * 3, 1);
add('haystack', -30, 65, 0); add('haystack', 42, 60, 0, 0.9); add('haystack', -78, 8, 0, 1.1);

/* 诺曼底树篱田块(南侧推进区 z 90..270): 网格田埂 + 随机豁口, 公路走廊留空 */
{
  const x0 = -150, x1 = 150, z0 = 95, z1 = 268, cw = 62, chh = 54;
  for (let gx = x0; gx < x1; gx += cw)
    for (let gz = z0; gz < z1; gz += chh) {
      // 田块北边/东边, 每边 2 段 + 概率豁口
      const edges = [
        { ax: gx, az: gz, bx: gx + cw, bz: gz, yaw: 0 },
        { ax: gx, az: gz, bx: gx, bz: gz + chh, yaw: Math.PI / 2 }
      ];
      for (const e of edges) {
        const segs = 3;
        for (let s2 = 0; s2 < segs; s2++) {
          if (rng() < 0.22) continue;                       // 豁口
          const t = (s2 + 0.5) / segs;
          const px = e.ax + (e.bx - e.ax) * t, pz = e.az + (e.bz - e.az) * t;
          if (Math.abs(px) < 14 && pz < 260) continue;      // 公路走廊不挡
          add(rng() < 0.65 ? 'hedge' : 'wall', px, pz, e.yaw + (rng() - 0.5) * 0.2, 0.9 + rng() * 0.35);
        }
      }
    }
}

/* 田块点缀: 干草垛/灌木/孤树 */
for (let i = 0; i < 10; i++) add('haystack', -140 + rng() * 280, 100 + rng() * 160, 0, 0.8 + rng() * 0.5);
for (let i = 0; i < 26; i++) add('bush', -150 + rng() * 300, 95 + rng() * 170, 0, 0.7 + rng() * 0.8);

/* 公路行道树(两侧) */
for (let z = 315; z > 95; z -= 21) {
  add('tree', -11.5, z, rng() * 6, 0.85 + rng() * 0.4);
  if (z < 300) add('tree', 11.5, z - 9, rng() * 6, 0.85 + rng() * 0.4);
}

/* 西侧林地(密林绕行线) */
for (let i = 0; i < 46; i++) add('tree', -285 + rng() * 110, -40 + rng() * 300, rng() * 6, 0.8 + rng() * 0.7);
for (let i = 0; i < 16; i++) add('bush', -280 + rng() * 100, -30 + rng() * 280, 0, 0.8 + rng() * 0.8);
for (const [rx, rz] of [[-240, 60], [-160, 180], [-230, 240]]) add('rock', rx, rz, rng() * 6, 1 + rng());

/* 东侧小丘狙击阵地: 岩石护位 + 残骸 */
add('rock', 248, -48, 1.2, 1.5); add('rock', 262, -70, 0.4, 1.3); add('rock', 240, -78, 2.2, 1.2);
add('wreck', 250, -95, 2.4);

/* 东侧废墟小村(绕行中继点) */
add('ruin', 150, -130, 0.8); add('ruin', 168, -118, 2.1); add('wall', 158, -140, 0.3, 1.2);
add('wreck', 140, -112, 0.6);
add('haystack', 172, -142, 0, 1.1);

/* 侧翼丘陵散岩 */
for (const rx of [-195, 195]) for (let z = 260; z > -260; z -= 46)
  add('rock', rx + (rng() - 0.5) * 36, z + (rng() - 0.5) * 26, rng() * 6, 0.9 + rng() * 0.9);

/* 谷地散石/残骸(褶皱线附近的硬掩体) */
add('rock', -38, 186, 1, 1.3); add('rock', 44, 92, 2, 1.2); add('wreck', 6, 150, 1.1); add('wreck', -52, 96, 2.8);
add('rock', -22, -170, 0.5, 1.1); add('rock', 38, -120, 2, 1.4);

/* 北坡防线: 双排坦克陷阱 + 铁丝墩(石墙) + 弹坑间残骸 */
for (let x = -52; x <= 52; x += 17) add('trap', x, -186, rng() * 3);
for (let x = -80; x <= 80; x += 26) add('trap', x * 1.0 + 8, -172, rng() * 3);
add('wall', -70, -196, 0.1, 1.2); add('wall', 62, -198, -0.1, 1.2);
add('wreck', -18, -206, 0.9); add('wreck', 30, -212, 2.2);

/* 树丛(远景氛围) */
for (let i = 0; i < 26; i++) {
  const side = rng() < 0.5 ? -1 : 1;
  add('tree', side * (315 + rng() * 55), 320 - rng() * 640, rng() * 6, 0.9 + rng() * 0.6);
}

/* ---------- map.json ---------- */
const mapJson = {
  _说明: '手改本文件即可调整关卡(位置为世界坐标米, x 东西 / z 南北, 玩家在南 z=+335 朝北推进); yaw 弧度, 0=朝 +Z',
  id: 'l01-encounter',
  name: '第一关 · 遭遇战',
  briefing: '穿越树篱田野与干河床，肃清村庄巡逻队，随后突破北坡敌军阵地。全歼敌军即胜利。',
  terrain: { size: SIZE, resolution: RES, maxHeight: MAX_H },
  lighting: {
    sunDir: [0.45, 0.75, 0.35], sunColor: [1.0, 0.95, 0.85], sunIntensity: 1.15,
    ambient: 0.55, ambientColor: [0.6, 0.7, 0.85],
    fogColor: [0.78, 0.83, 0.9], fogDensity: 0.0013,
    skyTop: [0.42, 0.6, 0.85], skyBottom: [0.87, 0.91, 0.95]
  },
  player: { model: 'sherman', spawn: [0, 335, Math.PI] },
  waves: [
    {
      name: '村庄巡逻队',
      enemies: [
        { type: 'medium', pos: [-28, -12], yaw: Math.PI, personality: 'flanker', patrol: [[-28, -12], [32, 6], [-24, 38]] },
        { type: 'medium', pos: [36, 18], yaw: Math.PI, personality: 'flanker', patrol: [[36, 18], [8, 44], [46, 48]] }
      ]
    },
    {
      name: '北坡阵地',
      enemies: [
        { type: 'td', pos: [58, -242], yaw: -2.55, personality: 'sniper', hold: true },
        { type: 'heavy', pos: [-16, -268], yaw: 3.14, personality: 'hold', patrol: [[-16, -268], [14, -262]] }
      ]
    }
  ],
  repairBetweenWaves: { hpRatio: 0.35, duration: 4, text: '维修组抢修中…' },
  covers,
  objectives: {
    winText: '敌军全歼 · 任务完成',
    loseText: '坦克被击毁 · 任务失败'
  }
};

/* ---------- 输出 ---------- */
fs.mkdirSync(MAP_DIR, { recursive: true });
writePNG16(path.join(MAP_DIR, 'heightmap.png'), RES, RES, (i, j) => H[j * RES + i] / MAX_H);
fs.writeFileSync(path.join(MAP_DIR, 'map.json'), JSON.stringify(mapJson, null, 2));
const byType = {};
for (const c of covers) byType[c.type] = (byType[c.type] || 0) + 1;
console.log(`✓ heightmap.png (${RES}×${RES}, 16bit)  高程 ${Math.min(...H).toFixed(1)}~${Math.max(...H).toFixed(1)}m`);
console.log(`✓ map.json 掩体 ${covers.length} 个:`, Object.entries(byType).map(([t, n]) => `${t}×${n}`).join(', '));
