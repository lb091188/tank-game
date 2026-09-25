#!/usr/bin/env node
// build-map.js — 生成第一关「遭遇战」地图资产（零 npm 依赖）
// 用法: node tools/build-map.js
// 输出: client/assets/maps/l01-encounter/{heightmap.png, map.json}
//   heightmap.png  16 位灰度高程图 256×256（渲染网格与物理采样同源）
//   map.json       关卡数据（掩体/出生点/巡逻/波次/灯光）——手改即生效，无需动引擎
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
const rng = mulberry32(20260925);

// 基于网格随机值的平滑噪声(双线性), fbm 多倍频
function makeNoise(seed, gridN) {
  const r = mulberry32(seed);
  const g = new Float32Array(gridN * gridN);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, z) => {  // x,z ∈ [0,1)
    const fx = x * gridN - 0.5, fz = z * gridN - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const at = (i, j) => g[((j + gridN) % gridN) * gridN + ((i + gridN) % gridN)];
    const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sz;
  };
}
const n1 = makeNoise(11, 8), n2 = makeNoise(77, 16), n3 = makeNoise(313, 48);
const fbm = (x, z) => n1(x, z) * 0.55 + n2(x, z) * 0.3 + n3(x, z) * 0.15;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));

/* ---------- 设计地形: h(x,z) 米 ---------- */
function terrain(x, z) {
  // 基础起伏
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 7;

  // 中央谷地(x≈0 南北向): 低于两侧, 公路走廊更平
  const valley = smoothstep(60, 150, Math.abs(x));
  h -= (1 - valley) * 3.5;

  // 东西两侧丘陵脊线(侧翼路线 + 反斜面卖头位)
  for (const rx of [-195, 195]) {
    const d = Math.abs(x - rx) * (1 + 0.25 * Math.sin(z * 0.012 + rx));
    h += gauss(d, 55) * 15;
  }

  // 北坡防御岭(z≈-230): 敌方阵地, 北面反斜面; 两端留缺口(x≈±100 可绕)
  const gap = Math.min(smoothstep(60, 100, Math.abs(Math.abs(x) - 100)), 1); // |x|≈100 处开缺口
  h += gauss(z + 230, 42) * 20 * (1 - gap * 0.85) * smoothstep(320, 220, -z - 0);

  // 南端出生地整平
  const spawnFlat = smoothstep(75, 30, Math.hypot(x - 0, z - 335));
  h = h * (1 - spawnFlat) + 6.5 * spawnFlat;

  // 村庄台地(z∈[-50,70]) 略整平
  const vil = smoothstep(95, 45, Math.abs(x)) * smoothstep(90, 50, Math.abs(z - 10));
  h = h * (1 - vil * 0.6) + 7.5 * (vil * 0.6);

  // 边界山体(不可越)
  const bx = Math.max(Math.abs(x) - 355, 0), bz = Math.max(Math.abs(z) - 355, 0);
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
// 2 轮箱式模糊消人工棱(边界 40m 内除外, 保持山体陡峭)
const blurred = Float32Array.from(H);
for (let pass = 0; pass < 2; pass++) {
  const src = Float32Array.from(blurred);
  for (let j = 1; j < RES - 1; j++)
    for (let i = 1; i < RES - 1; i++) {
      const x = -SIZE / 2 + (i / (RES - 1)) * SIZE, z = -SIZE / 2 + (j / (RES - 1)) * SIZE;
      if (Math.abs(x) > 352 || Math.abs(z) > 352) continue;
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += src[(j + dj) * RES + (i + di)];
      blurred[j * RES + i] = s / 9;
    }
}
H.set(blurred);

/* ---------- 坡度自检(道路与侧翼路线可通过) ---------- */
function slopeDeg(x0, z0, x1, z1) {
  const h0 = sampleH(x0, z0), h1 = sampleH(x1, z1);
  return Math.atan2(Math.abs(h1 - h0), Math.hypot(x1 - x0, z1 - z0)) * 180 / Math.PI;
}
function sampleH(x, z) {
  const fi = clamp((x + SIZE / 2) / SIZE, 0, 1) * (RES - 1), fj = clamp((z + SIZE / 2) / SIZE, 0, 1) * (RES - 1);
  const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
  const a = H[j * RES + i], b = H[j * RES + i + 1], c = H[(j + 1) * RES + i], d = H[(j + 1) * RES + i + 1];
  return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
}
let maxRoadSlope = 0;
for (let z = 330; z > -350; z -= 10) for (const lane of [0, -195, 195])
  maxRoadSlope = Math.max(maxRoadSlope, slopeDeg(lane, z, lane, z - 10));
console.log(`自检: 三条纵向路线最大坡度 ${maxRoadSlope.toFixed(1)}° (应 < 30°)`);

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
function writePNG16(file, w, h, getPixel) {  // getPixel(i,j) → 0..65535
  const raw = Buffer.alloc(h * (1 + w * 2));
  for (let j = 0; j < h; j++) {
    const row = j * (1 + w * 2);
    raw[row] = 0; // filter: None
    for (let i = 0; i < w; i++) {
      const v = Math.round(clamp(getPixel(i, j), 0, 1) * 65535);
      raw.writeUInt16BE(v, row + 1 + i * 2);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 16bit 灰度/无压缩/无滤波/无隔行
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

/* ---------- 掩体摆放(写入 map.json, 引擎按 type 程序化建模) ---------- */
// type: house 农舍 / hedge 树篱 / rock 岩石 / trap 坦克陷阱 / tree 树(视觉+车体碰撞, 不挡弹)
const covers = [];
const add = (type, x, z, yaw = 0, scale = 1) => covers.push({ type, x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2), scale: +scale.toFixed(2) });

// 村庄: 3 农舍 + 树篱围田
add('house', -45, 18, 0.3); add('house', 12, 34, -0.2, 1.1); add('house', 50, 10, 1.35, 0.9);
for (let x = -110; x <= 60; x += 24) { add('hedge', x, 78, 0); if (x < 40) add('hedge', x + 12, -60, 0.15); }
add('hedge', -118, 20, Math.PI / 2, 1.4); add('hedge', 72, 45, Math.PI / 2, 1.2);

// 谷地两侧树篱段(提供推进掩体)
for (let z = 240; z > 40; z -= 55) { add('hedge', -85 + (rng() - 0.5) * 30, z, 0.1 * (rng() - 0.5)); add('hedge', 85 + (rng() - 0.5) * 30, z - 25, 0.1 * (rng() - 0.5)); }

// 侧翼丘陵: 岩石(反斜面卖头位附近的硬掩体)
for (const rx of [-195, 195]) for (let z = 250; z > -250; z -= 48)
  add('rock', rx + (rng() - 0.5) * 40, z + (rng() - 0.5) * 30, rng() * 6, 0.9 + rng() * 0.9);
// 谷地散石
add('rock', -40, 150, 1, 1.2); add('rock', 38, -120, 2, 1.4); add('rock', -20, -170, 0.5, 1.1);

// 北坡前: 坦克陷阱线(提示玩家这是防线)
for (let x = -36; x <= 36; x += 18) add('trap', x, -186, rng() * 3);

// 树丛(视觉为主)
for (let i = 0; i < 34; i++) {
  const side = rng() < 0.5 ? -1 : 1;
  add('tree', side * (130 + rng() * 150), 320 - rng() * 620, rng() * 6, 0.8 + rng() * 0.6);
}

/* ---------- map.json ---------- */
const mapJson = {
  _说明: '手改本文件即可调整关卡(位置为世界坐标米, x 东西 / z 南北, 玩家在南 z=+335 朝北推进); yaw 弧度, 0=朝 +Z',
  id: 'l01-encounter',
  name: '第一关 · 遭遇战',
  briefing: '穿越谷地，肃清村庄巡逻队，随后突破北坡敌军阵地。全歼敌军即胜利。',
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
console.log(`✓ heightmap.png (${RES}×${RES}, 16bit)`);
console.log(`✓ map.json (掩体 ${covers.length} 个: ${['house','hedge','rock','trap','tree'].map(t => t + '×' + covers.filter(c => c.type === t).length).join(', ')})`);
console.log(`高程范围: ${Math.min(...H).toFixed(1)} ~ ${Math.max(...H).toFixed(1)} m`);
