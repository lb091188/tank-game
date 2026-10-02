#!/usr/bin/env node
// build-map.js — 生成五张地图资产（零 npm 依赖）
// 用法: node tools/build-map.js [l01|l02|l03|l04|l05|all]
//   l01 诺曼底遭遇战(树篱田野) / l02 城市巷战(废墟街区) / l03 山川高地(峡谷隘口)
//   l04 东线平原(开阔炮战+反坦克壕) / l05 荒漠机场(跑道机堡+断续沙脊)
// 输出: client/assets/maps/<dir>/{heightmap.png, map.json} —— 手改 json 即改关卡
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'client', 'assets', 'maps');
const SIZE = 1000;              // WoT 标准地图尺寸 1000×1000m
const S = 1.25;                 // 布局坐标缩放(原 800m 设计 ×1.25)
const RES = 288, MAX_H = 70;

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
const n1 = makeNoise(11, 8), n2 = makeNoise(77, 16), n3 = makeNoise(313, 48), n4 = makeNoise(909, 6), n5 = makeNoise(555, 96);
const fbm = (x, z) => n1(x, z) * 0.55 + n2(x, z) * 0.3 + n3(x, z) * 0.15;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));
// 不可攀陡壁剖面(平顶台地/mesa): 边缘梯度 ≈2.7×h/w, 经两次 3×3 网格平滑后仍远超 爬坡极限×1.25
// → 车辆梯度判定视为墙, 之字迂回/斜向逼近都上不去; h 取负 = 陡壁深沟
const cliffBump = (d, w, h) => { const t = clamp((w - d) / (w * 0.55) + 0.5, 0, 1); return t * t * (3 - 2 * t) * h; };
const cliffSeg = (x, z, ax, az, bx, bz, w, h) => cliffBump(distSeg(x, z, ax, az, bx, bz), w, h);
// 带登坡道的沙脊: w 宽度沿脊线变化——ramps 槽位(线段参数 0..1, 一般取 0.5 中点)局部展宽到 wr 成可爬坡道,
// 其余保持 w 陡壁断面(梯度≈2.7×h/w 远超挡墙阈, 上不去; 滑落机制兜底: 断面滑下 ≤4.5m/s 不摔死)。
// 脊顶平带 ≈0.95×w 可沿脊线行驶 —— 登顶后即全场最好的机动观察位。配套: 脊顶/道口放标记巨石。
function ridgeSeg(x, z, ax, az, bx, bz, w, h, ramps, wr) {
  const dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
  const u = clamp(((x - ax) * dx + (z - az) * dz) / (L * L), 0, 1);
  let g = 0;
  for (const s of ramps) g += gauss(Math.abs(u * L - s * L), 12);   // σ12: 坡道足印 ±25m, 之外 30m 即恢复全陡壁(σ20 会把邻段断面软化到可爬)
  return cliffBump(distSeg(x, z, ax, az, bx, bz), w + (wr - w) * Math.min(1, g), h);
}
// 陡壁山(可玩性基本件, 替代对称笋尖): 一侧悬崖(不可攀, 但站上去可沿坡慢慢滑下), 对侧缓环坡可开车上顶;
// 平顶=卖头/俯瞰位。phi=缓坡开口方位角(atan2 系, 东=π/2 南=0 西=-π/2 北=π), 反侧即悬崖。
// 坡面做旧: 等高线低频蜿蜒(不是规整几何体) + 缓坡中途两道浅垄(卖头小平台, 打断一坡到顶)
function cliffHill(x, z, cx, cz, H, phi, wCliff, wRamp) {
  const dx = x - cx, dz = z - cz, d0 = Math.hypot(dx, dz);
  if (d0 > wRamp * 1.34) return 0;
  const wob = 1 + (n2((x + 400) / 400, (z + 400) / 400) - 0.5) * 0.14;   // 等高线蜿蜒 ±7%
  const d = d0 * wob;
  let k = (Math.cos(Math.atan2(dx, dz) - phi) + 1) / 2;   // 1=缓坡侧, 0=悬崖侧
  k = ss(0.18, 0.82, k);                                   // 收窄过渡带: 悬崖弧与环坡弧各占大半
  let h = cliffBump(d, wCliff + (wRamp - wCliff) * k, H);
  if (h > 0.5 && h < H - 1) {                              // 只在坡面(非顶非麓)叠浅垄
    const rx = Math.sin(phi), rz = Math.cos(phi);
    for (const t of [0.42, 0.72])
      h += gauss(Math.hypot((x - (cx + rx * wRamp * t)) * 0.8, z - (cz + rz * wRamp * t)), 8) * 0.9;
  }
  return h;
}
// 陡壁山配套掩体: 崖顶缘巨石(视觉上标出悬崖边) + 环坡两簇灌木(爬坡掩蔽) + 顶面孤石/孤树(urban=城郊废墟山用残骸代树)
function hillCovers(add, rng, cx, cz, phi, wRamp, urban) {
  const rx = Math.sin(phi), rz = Math.cos(phi), px = -rz, pz = rx;
  add('rock', cx - rx * 9 + (rng() - 0.5) * 6, cz - rz * 9 + (rng() - 0.5) * 6, rng() * 6, 1.4 + rng() * 0.4);
  add('rock', cx - rx * 7 - px * 9, cz - rz * 7 - pz * 9, rng() * 6, 1.2 + rng() * 0.4);
  bushPatch(add, rng, cx + rx * wRamp * 0.5, cz + rz * wRamp * 0.5, 3);
  bushPatch(add, rng, cx + rx * wRamp * 0.78 + px * 11, cz + rz * wRamp * 0.78 + pz * 11, 3);
  add('rock', cx + rx * 5 + px * 5, cz + rz * 5 + pz * 5, rng() * 6, 1.1 + rng() * 0.3);
  add(urban ? 'wreck' : 'tree', cx - rx * 3 - px * 7, cz - rz * 3 - pz * 7, rng() * 6, urban ? 1 : 0.9 + rng() * 0.3);
}
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
const CRATERS2 = [];   // l02 广场前弹坑带
{ const r = mulberry32(20261005); for (let i = 0; i < 7; i++) CRATERS2.push({ x: -105 + r() * 210, z: -108 + r() * 32, r: 7 + r() * 3, d: 2.6 + r() * 0.9 }); }
function bushPatch(add, rng, x, z, n = 3) {   // 草丛簇: 战术隐蔽位(蹲入挡点亮, 开炮失效 4s)
  for (let k = 0; k < n; k++) add('bush', x + (rng() - 0.5) * 8, z + (rng() - 0.5) * 8, 0, 1.0 + rng() * 0.5);
}
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
  h -= gauss(distSeg(x, z, ...STREAM1.a, ...STREAM1.b), 7.5) * 3.0;
  // 中场微起伏 + 卖头土丘 + 东侧干沟(复杂化地形)
  h += (n5((x + 400) / SIZE, (z + 400) / SIZE) - 0.5) * 2.2;
  for (const [mx, mz, mw, mh] of [[-95, -40, 26, 4.5], [55, -70, 28, 5.5], [-40, 120, 24, 3.5], [110, 110, 28, 4.5], [-120, -130, 30, 4]])
    h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  h += gauss(Math.hypot(x - 190, z - 188), 45) * 9;   // 东南对位高地(死斗公平: 对位西北山——南翼第二处反向 vantage, 峰会≈25m 与西岭同档)
  h -= gauss(distSeg(x, z, 40, 150, 150, 60), 8) * 1.8;
  const gap = Math.min(ss(60, 100, Math.abs(Math.abs(x) - 100)), 1);
  h += gauss(z + 230, 42) * 20 * (1 - gap * 0.85) * ss(320, 220, -z - 0);
  // 南出生带护脊(死斗公平: 北垒镜像低配)——东山/西北山顶对南池的 300m+ 祸线切成翻棱接触;
  // 12m/42m 最大梯度 0.17 全线可翻(是"垄"不是墙), 中门与两翼低口公式同北垒; spawnFlat 在其后执行, 出生区不受影响
  h += gauss(z - 225, 42) * 12 * (1 - gap * 0.85) * ss(320, 220, z - 0);
  // 陡壁山×2: 东山悬崖朝西堵村庄东路(东坡缓上顶卖头), 西北山东崖堵直进(西坡绕上, 迂回敌阵侧后)
  h += cliffHill(x, z, 150, -28, 13, Math.PI / 2, 7.5, 44);
  h += cliffHill(x, z, -92, -192, 12, -Math.PI / 2, 7, 44);   // 西坡绕上(避开北坡主山体), 东崖堵村庄直进
  for (const c of CRATERS1) h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d;
  const spawnFlat = ss(115, 72, Math.hypot(x, z - 335));
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
  for (let i = 0; i < 26; i++) add('bush', -150 + rng() * 300, 95 + rng() * 170, 0, 0.9 + rng() * 0.7);
  for (const [cx2, cz2] of [[-62, 250], [58, 215], [-125, 65], [108, 35], [-75, -95], [42, -62], [-160, -35], [152, -65], [-105, -18]]) bushPatch(add, rng, cx2, cz2);
  for (let z = 315; z > 95; z -= 21) { add('tree', -11.5, z, rng() * 6, 0.85 + rng() * 0.4); if (z < 300) add('tree', 11.5, z - 9, rng() * 6, 0.85 + rng() * 0.4); }
  for (let i = 0; i < 46; i++) add('tree', -285 + rng() * 110, -40 + rng() * 300, rng() * 6, 0.8 + rng() * 0.7);
  for (let i = 0; i < 16; i++) add('bush', -280 + rng() * 100, -30 + rng() * 280, 0, 0.9 + rng() * 0.7);
  for (const [rx, rz] of [[-240, 60], [-160, 180], [-230, 240]]) add('rock', rx, rz, rng() * 6, 1 + rng());
  add('rock', 248, -48, 1.2, 1.5); add('rock', 262, -70, 0.4, 1.3); add('rock', 240, -78, 2.2, 1.2);
  add('wreck', 250, -95, 2.4);
  add('ruin', 150, -130, 0.8); add('ruin', 168, -118, 2.1); add('wall', 158, -140, 0.3, 1.2);
  add('wreck', 140, -112, 0.6);
  add('haystack', 172, -142, 0, 1.1);
  for (const rx of [-195, 195]) for (let z = 260; z > -260; z -= 46) add('rock', rx + (rng() - 0.5) * 36, z + (rng() - 0.5) * 26, rng() * 6, 1.1 + rng() * 0.9);
  for (const [bx2, bz2] of [[-95, -55], [61, -55], [-34, 128], [112, 100]]) add('rock', bx2 + (rng() - 0.5) * 10, bz2 + (rng() - 0.5) * 10, rng() * 6, 1.5 + rng() * 0.3);  // 土丘顶巨石(卖头位)
  add('rock', -38, 186, 1, 1.3); add('rock', 44, 92, 2, 1.2); add('wreck', 6, 150, 1.1); add('wreck', -52, 96, 2.8);
  add('rock', -22, -170, 0.5, 1.1); add('rock', 38, -120, 2, 1.4);
  for (let x = -52; x <= 52; x += 17) add('trap', x, -186, rng() * 3);
  for (let x = -80; x <= 80; x += 26) add('trap', x + 8, -172, rng() * 3);
  add('wall', -70, -196, 0.1, 1.2); add('wall', 62, -198, -0.1, 1.2);
  add('wreck', -18, -206, 0.9); add('wreck', 30, -212, 2.2);
  for (let i = 0; i < 26; i++) { const side = rng() < 0.5 ? -1 : 1; add('tree', side * (315 + rng() * 55), 320 - rng() * 640, rng() * 6, 0.9 + rng() * 0.6); }
  hillCovers(add, rng, 150, -28, Math.PI / 2, 44);        // 东陡壁山
  hillCovers(add, rng, -92, -192, -Math.PI / 2, 44);      // 西北陡壁山
  // ---- 评审修订(追加在随机流末尾, 不扰动上面已验证的布点) ----
  add('wall', -14, -218, 0.1, 1.2); add('wall', 14, -222, -0.1, 1.2);              // 中门口沿双墙: 翻棱后先手依托, 裸冲口变伸缩对决
  add('rock', 60, -270, rng() * 6, 1.5); add('rock', -60, -272, rng() * 6, 1.5);   // 北垒后盆地摆角锚点, 巨石视觉标出"后区可进"
  add('haystack', 172, 140, 0, 1.1); bushPatch(add, rng, 176, 60, 3);              // 东翼车道中段软隐蔽(与西翼森林隐蔽量对齐)
  bushPatch(add, rng, -230, 60, 3); bushPatch(add, rng, -230, 180, 3);             // 西翼林中战术隐蔽(树只挡车不挡点亮)
  bushPatch(add, rng, -195, 112, 3);                                               // 西岭鞍部: 穿鞍有真实隐蔽收益
  add('rock', 190, 188, rng() * 6, 1.4); bushPatch(add, rng, 194, 196, 2);         // 东南对位高地顶: 卖头锚点+蹲位
  add('rock', -14, 233, 0.4, 1.3); add('rock', 12, 232, 2.6, 1.2);                // 南护脊翻棱硬点(中门两侧, 与北垒中门双墙对位; 修前 -218 误落北垒墙位)
  // ---- 评审修订2: 隐蔽炮位(石旁配草) —— 蹲草藏身、被亮缩石挡弹的"隐蔽炮台", 补齐高地石头位缺的最后一块 ----
  bushPatch(add, rng, 146, -22, 2); bushPatch(add, rng, -96, -186, 2);            // 东山/西北山崖顶面(棱后侧, 避开顶面孤树)
  for (const [mx2, mz2] of [[-89, -50], [67, -50], [-28, 133], [118, 105]]) bushPatch(add, rng, mx2, mz2, 2);   // 四座土丘顶巨石旁(卖头位+蹲草)
  bushPatch(add, rng, 197, -62, 2); bushPatch(add, rng, 197, -154, 2);            // 东翼岩线北段(南段已有3簇)
  bushPatch(add, rng, -197, -16, 2); bushPatch(add, rng, -197, -108, 2); bushPatch(add, rng, -197, -200, 2);   // 西翼岩线北段
  bushPatch(add, rng, 63, -265, 2); bushPatch(add, rng, -63, -267, 2);            // 北垒后盆地巨石旁(后区反斜面炮位)
  bushPatch(add, rng, 16, 238, 2);                                                // 南护脊翻棱硬点旁
}

/* ============ l02 城市巷战 ============ */
function terrainL02(x, z) {
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 1.4;           // 城区近水平
  h += ss(120, 260, Math.abs(x)) * 3 + ss(140, 300, Math.abs(z - 40)) * 2;   // 郊区缓升
  h += gauss(z + 250, 60) * 6 * ss(200, 60, -z);                        // 北侧抬升(防区高地)
  const plaza = ss(90, 30, Math.hypot(x * 0.9, z + 130));              // 北广场略高台阶
  h = h * (1 - plaza * 0.5) + (h + 1.2) * plaza * 0.5;
  // 街区隔块台阶(1m 火力台阶, 只抬街区内部不动街道) + 大道旁瓦砾坡 + 广场前弹坑带 + 郊区粗糙化
  const dStreet = (v) => Math.abs(((v % 78) + 78) % 78 - 39);          // 到最近街道中心线的距离(街区中心=0)
  const interior = ss(30, 22, dStreet(x)) * ss(30, 22, dStreet(z)) * ss(185, 160, Math.abs(x)) * ss(270, 245, z) * ss(-115, -90, z);
  // 奇偶切换点取 (x-39)/78: 跳变发生在街道中心线(≡0 mod 78), 整块交替而非对角象限半抬升
  h += (((Math.round((x - 39) / 78) + Math.round((z - 39) / 78)) & 1) ? 1.05 : 0) * interior;
  h += gauss(x - 28, 6) * (ss(-40, -10, z) - ss(190, 220, z)) * 2.0;   // 中央大道东侧瓦砾坡(平滑后≈1.6m, T-34真半卖头)
  for (const c of CRATERS2) h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d;
  h += (n5((x + 400) / SIZE, (z + 400) / SIZE) - 0.5) * 2.0 * ss(180, 240, Math.abs(x));
  for (const [mx, mz, mw, mh] of [[-215, 140, 36, 4], [222, -20, 34, 3.5], [-190, -70, 32, 3]]) h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  // 陡壁废墟山×3(封侧街死路但各留一侧缓坡可上): 缓坡开口对着保留的街道
  h += cliffHill(x, z, -160, 32, 12, 0, 7, 42);            // 南坡上, 北崖堵北向侧街; wRamp 36→42 坡道余量
  h += cliffHill(x, z, 158, -78, 13, Math.PI, 7, 44);      // 北坡上(敌纵深), 南崖堵出击直路; wRamp 38→44: 修前北坡道 36° 贴爬坡极限零余量
  h += cliffHill(x, z, 36, 168, 12, -Math.PI / 2, 6, 46); // 西坡上, 东崖堵东侧巷; wRamp 32→46 坡道余量(噪声叠底比西山多 2°)
  const spawnFlat = ss(115, 72, Math.hypot(x, z - 330));
  h = h * (1 - spawnFlat) + 6 * spawnFlat;
  const bx = Math.max(Math.abs(x) - (352 + 18 * n4(0.2, (z + 400) / SIZE)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 18 * n4((x + 400) / SIZE, 0.8)), 0);
  h += ss(0, 45, Math.hypot(bx, bz)) * 55;
  return h;
}
// l02 三座陡壁山的山体高度采样(掩体摆放避山用): 建筑不落山体也不贴悬崖缘, 防悬空/防堵环坡登顶线
// 山缘呈扇贝形(方位角上 w_eff 差异大), 除本点外再十字探 ±7m(≈建筑半宽), 任一探点见山体即视为贴崖
const hillH02 = (x, z) => cliffHill(x, z, -160, 32, 12, 0, 7, 36) + cliffHill(x, z, 158, -78, 13, Math.PI, 7, 38) + cliffHill(x, z, 36, 168, 12, -Math.PI / 2, 6, 40);
const offHill02 = (x, z) => hillH02(x, z) < 0.8 && hillH02(x - 7, z) < 0.8 && hillH02(x + 7, z) < 0.8 && hillH02(x, z - 7) < 0.8 && hillH02(x, z + 7) < 0.8;
function coversL02(add, rng) {
  // 街区网格: 街宽 22m, 街区长 56m; 每块 1-2 建筑 + 废墟 + 街角墙
  // 网格对齐台阶格心(街区中心≡39 mod 78): 建筑居中整块街区, 街道(≡0)保持净空, 也解除西山对西列的挤压
  const x0 = -156, z0 = -78, cw = 78, chh = 78;
  for (let gx = x0; gx <= 168 - cw; gx += cw) {
    for (let gz = z0; gz <= 250 - chh; gz += chh) {
      const cx = gx + cw / 2, cz = gz + chh / 2;
      if (!offHill02(cx, cz)) continue;   // 山缘街区(如南山东南麓)不放建筑, 悬崖贴脸也不摆
      const roll = rng();
      if (roll < 0.55) {
        add('barn', cx, cz, rng() < 0.5 ? 0 : Math.PI / 2, 0.9 + rng() * 0.3);
        if (rng() < 0.5) add('house', cx + Math.sign(rng() - 0.5 || 1) * (12 + rng() * 8), cz + (rng() - 0.5) * 20, rng() * 3, 0.85);   // 配房横移≥12m, 不与谷仓嵌套
      }
      else if (roll < 0.8) { add('house', cx, cz, rng() * 3, 1.0 + rng() * 0.3); add('ruin', cx + 26, cz + (rng() - 0.5) * 30, rng() * 3); }
      else { add('ruin', cx, cz, rng() * 3); add('ruin', cx + 24, cz + 20, rng() * 3, 0.9); add('wall', cx - 8, cz - 18, rng() * 3, 1.1); }
      if (rng() < 0.5) add('wreck', gx + cw + (rng() - 0.5) * 10, cz + (rng() - 0.5) * 40, rng() * 3);   // 街上残骸(方块东缘=下一条街中心线)
    }
  }
  // 中央大道两侧路障
  for (let z = 250; z > -100; z -= 34) { add('trap', -13, z, rng() * 3); add('trap', 13, z - 15, rng() * 3); }
  // 北广场: 环形工事
  add('ruin', -50, -160, 0.3, 1.3); add('ruin', 52, -158, 2.8, 1.2); add('barn', 0, -195, 0.05, 1.2);
  add('rock', -104, -138, 0.8, 1.5); add('rock', 106, -132, 2.2, 1.45);   // 广场两翼巨石(弹坑带后掩体)
  for (let x = -60; x <= 60; x += 20) add('wall', x, -150, rng() * 0.2, 1.3);
  add('wreck', -26, -172, 1.5); add('wreck', 30, -170, 4.2); add('wreck', 0, -140, 2.6);
  // 瓦砾堆与弹坑感散岩
  for (let i = 0; i < 22; i++) add('rock', -160 + rng() * 320, -90 + rng() * 330, rng() * 6, 0.9 + rng() * 0.6);
  // 郊区行道树
  for (let z = 300; z > 200; z -= 24) { add('tree', -150, z, rng() * 6, 0.9); add('tree', 150, z - 10, rng() * 6, 0.9); }
  // 荒地草丛簇(郊区隐蔽位) + 南缘散草
  for (const [cx2, cz2] of [[-192, 80], [192, 80], [-200, -55], [205, -40], [-150, 255], [150, 250], [-95, 265], [95, 240]]) bushPatch(add, rng, cx2, cz2, 3);
  for (let i = 0; i < 10; i++) add('bush', -250 + rng() * 500, 190 + rng() * 90, 0, 0.9 + rng() * 0.6);
  // 城市加密: 外环街区建筑 + 混凝土围墙 + 瓦砾
  for (let gx = -246; gx <= 246; gx += 82) {
    if (Math.abs(gx) < 130) continue;
    for (let gz = -40; gz <= 180; gz += 70) {
      if (!offHill02(gx, gz)) continue;   // 山体上的外环行跳过(西山山顶/陡壁麓), 不再悬空也不再堵登顶线
      const roll = rng();
      if (roll < 0.5) add('barn', gx + (rng() - 0.5) * 20, gz + (rng() - 0.5) * 16, rng() < 0.5 ? 0 : Math.PI / 2, 0.85 + rng() * 0.3);
      else if (roll < 0.8) { add('house', gx + (rng() - 0.5) * 22, gz, rng() * 3, 0.9 + rng() * 0.35); add('wall', gx + 20, gz + 22, rng() * 3, 1.1); }
      else add('ruin', gx, gz, rng() * 3, 1.1);
    }
  }
  for (let i = 0; i < 26; i++) add('rock', -250 + rng() * 500, -80 + rng() * 320, rng() * 6, 0.8 + rng() * 0.7);
  for (let i = 0; i < 12; i++) add('wreck', -220 + rng() * 440, -60 + rng() * 300, rng() * 3);
  hillCovers(add, rng, -160, 32, 0, 42, true);            // 三座废墟山(残骸代树)
  hillCovers(add, rng, 158, -78, Math.PI, 44, true);
  hillCovers(add, rng, 36, 168, -Math.PI / 2, 46, true);
  // ---- 评审修订(追加在随机流末尾) ----
  add('rock', 36, -80, rng() * 6, 1.4); add('wreck', -36, -84, 1.5);              // 弹坑带南缘两个硬点: 90m冲击带不再裸奔
  add('rock', 78, -24, rng() * 6, 1.3);                                           // 东街反制peek位(对东北山顶su100)
  add('rock', -5.6, 44, rng() * 6, 1.4);                                          // 中央大道走廊中段硬点(偏西, 留东侧车道)
  add('rock', -80.8, 32, rng() * 6, 1.3); add('rock', -80.8, 120, rng() * 6, 1.3);  // 西街长廊侧步位: 360m通视切成三段对枪区
  for (const [sx2, sz2] of [[-208, 48], [208, 48], [-208, 128], [208, 128]]) {    // 外环城郊据点: >300m迂回线有了目的与蹲位(西列再外移, 实测(-192,48)山体贡献5.7m会悬浮)
    add('barn', sx2, sz2, 0, 0.9);
    add('wreck', sx2 - Math.sign(sx2) * 9, sz2 + 12, rng() * 3);
  }
  // ---- 评审修订2: 外围区域充实 —— 城外不再是大空地 ----
  // 南缘(郊野村舍带, 软掩体为主): 街区以南 z>250 原本全空; 避开出生平坦区(|x|<20 不放硬掩体)
  add('house', -100, 270, 0.2, 0.9); add('house', 95, 276, 1.1, 0.85);
  add('ruin', -35, 256, 0.6); add('ruin', 50, 260, 2.4);
  add('haystack', -70, 288, 0); add('haystack', 18, 296, 0, 0.9); add('haystack', 128, 290, 0, 1.0);
  bushPatch(add, rng, -135, 282, 3); bushPatch(add, rng, 65, 286, 3); bushPatch(add, rng, -8, 302, 2); bushPatch(add, rng, 150, 302, 2);
  // 北缘(硬掩体带, 顺带补齐"北侧出生点 100m 内无硬掩体"的审计发现): 广场以北 z<-210 原本全空
  add('house', -95, -234, 0.3, 0.9); add('house', 92, -240, 1.4, 0.85);
  add('ruin', -42, -258, 2.9); add('ruin', 45, -262, 0.7);
  add('wall', -70, -248, 0.2, 1.2); add('wall', 68, -252, -0.1, 1.2);
  bushPatch(add, rng, -15, -272, 3); bushPatch(add, rng, 18, -300, 2); bushPatch(add, rng, 140, -280, 2); bushPatch(add, rng, -138, -285, 2);
  // 东西侧带(外环立柱之间的空档) + 四角歇脚点
  add('ruin', -205, 5, 0.5); add('ruin', 205, 5, 2.8);
  bushPatch(add, rng, -208, 72, 3); bushPatch(add, rng, 208, 76, 3);
  add('wreck', -215, 138, 1.1); add('wreck', 212, 142, 2.2);
  add('rock', 236, 242, rng() * 6, 1.3); bushPatch(add, rng, 232, 250, 2);        // 东南角
  add('rock', -238, 246, rng() * 6, 1.3); bushPatch(add, rng, -234, 254, 2);      // 西南角
  add('rock', 234, -252, rng() * 6, 1.3); bushPatch(add, rng, 230, -260, 2);      // 东北角
  add('rock', -236, -256, rng() * 6, 1.3); bushPatch(add, rng, -232, -264, 2);    // 西北角
}

/* ============ l03 山川高地 ============ */
function terrainL03(x, z) {
  let h = 5 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 5;
  // 两条陡峭南北山脊 x=±140, 高 28m, 各带一处鞍部通道
  for (const rx of [-140, 140]) {
    const d = Math.abs(x - rx) * (1 + 0.3 * Math.sin(z * 0.01 + rx));
    h += gauss(d, 34) * 28;
  }
  h -= gauss(x + 140, 26) * gauss(z - 100, 46) * 11;    // 西脊鞍部(z≈100)
  h -= gauss(x - 140, 26) * gauss(z + 150, 46) * 11;    // 东脊鞍部(z≈-150)
  // 横向支脊(褶皱地形, 脊间即推进车道)
  for (const [ax, az, bx2, bz2, w, sh] of [[-140, 170, -30, 140, 24, 6.5], [-140, -60, -50, -30, 26, 7], [140, 90, 40, 60, 24, 6], [140, -240, 30, -215, 26, 6.5]])
    h += gauss(distSeg(x, z, ax, az, bx2, bz2), w) * sh;
  // 中央峡谷干河床(蜿蜒) + 两侧冲沟 + 谷中土丘(卖头位)
  const riverZ = 40 * Math.sin(x * 0.012) - 20;
  h -= gauss(z - riverZ, 26) * 2.2 * (1 - ss(70, 130, Math.abs(x)));
  h -= gauss(Math.abs(Math.abs(x) - 62), 9) * 1.5 * (1 - ss(60, 130, Math.abs(x)));
  h += gauss(Math.hypot(x - 46, z + 58), 26) * 4.5;
  h += (n5((x + 400) / SIZE, (z + 400) / SIZE) - 0.5) * 2.4;
  // 北峰高地(阵地) 与南坡
  h += gauss(Math.hypot(x * 0.8, z + 250), 90) * 19;
  h += gauss(Math.hypot(x + 95, z + 285), 55) * 8;      // 北峰西肩(第二制高点)
  h += gauss(Math.hypot(x - 152, z + 34), 20) * 2.2;    // 东脊东坡肩小丘(死斗公平: 切断东脊南顶对东北池的 1.1m 擦顶视线, t=0.45 中段可切)
  h += gauss(Math.hypot(x + 124, z - 122), 20) * 2.4;   // 西脊南麓护墩(死斗公平: 切断西南角高地对北中池的 1.7m 擦顶视线, 近射手端可切)
  const spawnFlat = ss(110, 70, Math.hypot(x - 0, z - 325));
  h = h * (1 - spawnFlat) + 6 * spawnFlat;
  // 中部山间小村台地
  const vil = ss(40, 16, Math.hypot(x + 20, z - 40));
  h = h * (1 - vil * 0.5) + (h + 0.8) * vil * 0.5;
  // 南麓滚丘(出击通道起伏); 南岭加高为南方主制高点(死斗公平: 峰会≈28m 对位北峰 33.4m, 兼切断谷心山顶→南池 503m 狙线;
  // 16m/44m 最大梯度 0.22=12° 四方可登缓丘, spawnFlat 在其后执行出生区不受影响)
  for (const [mx, mz, mw, mh] of [[-65, 215, 30, 3.5], [50, 240, 26, 4], [-8, 152, 44, 16]]) h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  // 陡壁山×3: 西鞍口山(南崖堵绕脊直进, 北坡上顶接鞍口; 13/7.5 对齐谷心山封环强度——修前 12/7 南弧漏 70° 可之字登顶;
  //           北坡道 wRamp 38→44: 修前 36° 贴爬坡极限零余量),
  // 东鞍口山翻转为南坡上顶/北崖(攻方中场唯一的可登卖头山, 与 m36 成制高点对决), 谷心山南崖把干河床分成双车道;
  // 谷心山加高到 15(死斗公平: 切断北池(0,-310)→南池 620m 开局狙线, 修前贴山顶余量仅1.6m), wRamp 42→46 保北坡可登
  h += cliffHill(x, z, -98, 138, 13, Math.PI, 7.5, 44);
  h += cliffHill(x, z, 100, -88, 12, 0, 7, 48);
  h += cliffHill(x, z, 0, -80, 15, Math.PI, 7.5, 48);
  h += cliffHill(x, z, 70, 150, 12, 0, 7, 48);   // 南中山(死斗公平: 对位北半场谷心山——南方本方可登卖头山, 南坡上顶/北崖对谷; H12/wRamp48 同东鞍口山已验证爬坡 0.591<0.63)
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
  // 峡谷乱石阵 + 谷中土丘顶巨石
  for (let i = 0; i < 34; i++) add('rock', -60 + rng() * 120, -140 + rng() * 320, rng() * 6, 1.0 + rng() * 1.2);
  add('rock', 46, -64, rng() * 6, 1.5);
  // 山坡松林
  for (let i = 0; i < 62; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    add('tree', side * (95 + rng() * 130), 300 - rng() * 600, rng() * 6, 0.85 + rng() * 0.7);
  }
  for (let i = 0; i < 14; i++) add('bush', -100 + rng() * 200, -100 + rng() * 300, 0, 0.9 + rng() * 0.7);
  for (const [cx2, cz2] of [[-58, 128], [52, 92], [-45, -118], [28, -188], [-78, 242], [68, 208], [-8, 258]]) bushPatch(add, rng, cx2, cz2, 3);
  // 脊线岩石(反斜面卖头位标记)
  for (const rx of [-140, 140]) for (let z = 270; z > -270; z -= 42) add('rock', rx + (rng() - 0.5) * 26, z + (rng() - 0.5) * 20, rng() * 6, 1.1 + rng() * 0.9);
  // 北峰阵地工事(拒马线随 is2 前移顺移至 z=-226, 保持坡沿前出)
  for (let x = -46; x <= 46; x += 19) add('trap', x, -226, rng() * 3);
  add('wall', -58, -240, 0.15, 1.2); add('wall', 56, -238, -0.1, 1.2);
  add('wreck', -20, -252, 0.8); add('wreck', 26, -250, 2.4); add('wreck', 12, -224, 1.6);   // 第三座残骸移出中轴: 不再挡谷心山顶↔is2 决斗线
  // 谷地残骸
  add('wreck', -30, 140, 2.9); add('wreck', 34, -40, 0.4);
  // 南侧出身掩护
  for (const [rx, rz] of [[-36, 268], [30, 276]]) add('rock', rx, rz, rng() * 6, 1.4);
  hillCovers(add, rng, -98, 138, Math.PI, 44);            // 西鞍口山
  hillCovers(add, rng, 100, -88, 0, 48);                  // 东鞍口山(翻转: 南坡上顶/北崖; wRamp48 游戏口径slopeAhead 0.591<0.63 可直爬, 42时0.653超限)
  hillCovers(add, rng, 0, -80, Math.PI, 42);              // 谷心山
  // ---- 评审修订(追加在随机流末尾) ----
  add('rock', -97, -282, rng() * 6, 1.5); add('rock', -92, -288, rng() * 6, 1.4);   // 北峰西肩狙击巢(唯一反斜面反制is2位, 123m决斗)
  bushPatch(add, rng, -99, -278, 3);
  add('rock', -20, -214, rng() * 6, 1.4); add('rock', 22, -210, rng() * 6, 1.4);    // 北峰南坡决战段 crest-fight 硬掩体(最后80m不再裸奔)
  for (const [fx, fz] of [[-172, -48], [-188, -152], [172, -32], [184, -136]]) {    // 东西松林外带迂回线: 息脚点+蹲位
    bushPatch(add, rng, fx, fz, 3);
    add('rock', fx + 6, fz + 6, rng() * 6, 1.3);
  }
  add('rock', -3, -83, rng() * 6, 1.6);                                              // 谷心山顶面对射掩体(is2前移后升值为决斗位)
  // 死斗公平: 南池(世界0,387.5)周边对位掩体——北池25~34m内有拒马/墙/残骸工事带, 南池原为光板
  add('rock', -30, 225, rng() * 6, 1.4); add('rock', 28, 222, rng() * 6, 1.4);
  bushPatch(add, rng, 0, 232, 2);
  hillCovers(add, rng, 70, 150, 0, 48);                 // 南中山(南方本方可登制高点)
  add('rock', -8, 152, rng() * 6, 1.5);                 // 南岭顶对位工事(北峰阵地工事的低配锚点)
  bushPatch(add, rng, -14, 158, 2);
  // ---- 评审修订2: 周边区域充实 —— 外车道南段对位(修前北半段有4处息脚点、南半段全空) + 南北远端 + 四角 ----
  for (const [fx, fz] of [[-172, 48], [-188, 152], [172, 32], [184, 136]]) {      // 东西外车道南段息脚点(镜像北段)
    bushPatch(add, rng, fx, fz, 3);
    add('rock', fx + 6, fz + 6, rng() * 6, 1.3);
  }
  add('rock', -95, 272, rng() * 6, 1.4); bushPatch(add, rng, -91, 278, 2);        // 南远端(滚丘外沿)
  add('rock', 90, 278, rng() * 6, 1.4); bushPatch(add, rng, 86, 284, 2);
  add('rock', -45, -298, rng() * 6, 1.4); bushPatch(add, rng, -41, -304, 2);      // 北远端(峰后松林间)
  add('rock', 48, -302, rng() * 6, 1.4); bushPatch(add, rng, 44, -296, 2);
  for (const [cx3, cz3] of [[-245, 262], [245, 258], [-242, -265], [240, -268]]) {   // 四角歇脚点
    add('rock', cx3, cz3, rng() * 6, 1.3); bushPatch(add, rng, cx3 + 4, cz3 + 6, 2);
  }
}

/* ============ l04 东线平原(开阔炮战) ============ */
function terrainL04(x, z) {
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 2.4;   // 极缓起伏: 大视野远距炮战
  // 大波长麦浪垛台(远距卖头微地形): 缓到可全图通行, 只提供 1-2m 的车体遮蔽;
  // 南岸加高+前置低垄: 让南岸纵深能越过北坡隆起线看到壕北(修前北岸是南岸视线死区)
  h += gauss(z - 120, 90) * 3.2 * (1 - ss(150, 260, Math.abs(x)));
  h += gauss(z - 60, 70) * 1.4;
  h += gauss(z + 60, 110) * 1.8;
  // 反坦克壕(东西横贯 z≈-30): 陡壁不可攀(壁内坠落会摔伤), 只留 x=-90 / x=110 两处缺口通道;
  // gates 用 max(任一缺口即可开闸; 修前误用 min 要求同时靠近两点→恒0→全图无缝);
  // 壕段延到 ±368 深入边界山体咬合(±352 时边界噪声晚开的 ~5m 边缝仍是第三通道, 实测 ±360 起封死)
  const ditchD = distSeg(x, z, -368, -33, 368, -7);
  const gates = Math.max(ss(30, 9, Math.abs(x + 90)), ss(30, 9, Math.abs(x - 110)));
  h -= cliffBump(ditchD, 6, 12) * (1 - gates);   // 窄而深: 11m 深 6m 半宽, 壁面不可攀
  // 中野陡壁山两座(平原仅有的硬遮蔽与制高点, 争夺焦点): 东山南移让出北向视线扫东缺口;
  // 西山翻转为南崖北坡——守军拥有本方可登制高点(与东山玩家侧成对), 玩家需过壕后从北坡仰攻夺顶
  h += cliffHill(x, z, 58, 55, 13, Math.PI / 2, 7.5, 47);
  h += cliffHill(x, z, -142, -108, 13, Math.PI, 7.5, 46);   // 西山翻转为南崖北坡——守军拥有本方可登制高点(与东山玩家侧成对), 玩家需过壕后从北坡仰攻夺顶; wRamp 42→46 保北坡道余量
  h += gauss(Math.hypot(x + 60, z + 148), 55) * 1.6;
  const spawnFlat = ss(115, 72, Math.hypot(x, z - 335));
  h = h * (1 - spawnFlat) + 6.5 * spawnFlat;
  const bx = Math.max(Math.abs(x) - (352 + 20 * n4((x + 400) / SIZE, 0.3)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 20 * n4(0.7, (z + 400) / SIZE)), 0);
  h += ss(0, 45, Math.hypot(bx, bz)) * 55;
  return h;
}
function coversL04(add, rng) {
  // 三处农庄(平原仅有的建筑群): 南二北一
  add('barn', -185, 148, 0.1); add('house', -158, 132, 0.4, 0.9); add('wall', -172, 160, rng() * 3, 1);
  add('barn', 142, 96, 1.6); add('house', 165, 84, 2.2, 0.95); add('haystack', 128, 118, 0, 1.1);
  add('barn', -62, -176, 0.05, 1.05); add('ruin', -36, -190, 0.8); add('ruin', -84, -198, 2.4);
  add('wall', -50, -208, 0.2, 1.2);
  // 反坦克壕沿: 树线与残骸(视觉上标出壕的走向) + 缺口两侧拒马; 草丛为主(挡视线)树干为辅——树只挡车不挡弹, 视觉暗示与机制一致
  for (let t = -320; t <= 320; t += 26) {
    if (Math.abs(t + 90) < 34 || Math.abs(t - 110) < 34) continue;   // 缺口不挡
    add(rng() < 0.35 ? 'tree' : 'bush', t + (rng() - 0.5) * 10, -34 + Math.sin(t * 0.05) * 14 + (rng() - 0.5) * 8, rng() * 6, 0.8 + rng() * 0.5);
  }
  add('trap', -118, -40, rng() * 3); add('trap', -66, -36, rng() * 3);
  add('trap', 86, -26, rng() * 3); add('trap', 138, -32, rng() * 3);
  add('wreck', -6, -28, 1.9); add('wreck', 34, -44, 0.7);
  // 独岩顶巨石(可见的不可攀标记)
  for (const [rx, rz] of [[58, 55], [-142, -66]]) add('rock', rx + (rng() - 0.5) * 8, rz + (rng() - 0.5) * 8, rng() * 6, 1.5);
  // 麦田零散草垛/草丛(平原稀缺隐蔽) + 田埂树列
  for (let i = 0; i < 8; i++) add('haystack', -240 + rng() * 480, 60 + rng() * 200, 0, 0.9 + rng() * 0.4);
  for (const [cx2, cz2] of [[-90, 210], [110, 170], [-30, 30], [180, -60], [-210, -20], [60, -120]]) bushPatch(add, rng, cx2, cz2, 3);
  for (let x2 = -300; x2 <= 300; x2 += 40) add('tree', x2 + (rng() - 0.5) * 14, 236 + (rng() - 0.5) * 18, rng() * 6, 0.85 + rng() * 0.4);
  // 北坡阵地工事
  for (let x3 = -44; x3 <= 44; x3 += 18) add('trap', x3, -242, rng() * 3);
  add('wall', -56, -252, 0.15, 1.2); add('wall', 54, -250, -0.1, 1.2);
  add('wreck', -22, -262, 0.9); add('wreck', 28, -258, 2.2);
  hillCovers(add, rng, 58, 55, Math.PI / 2, 47);         // 中野东山(南移: 山顶北向视线扫东缺口)
  hillCovers(add, rng, -142, -108, Math.PI, 46);         // 中野西山(翻转: 南崖北坡, 守军本方制高点)
  // ---- 评审修订(追加在随机流末尾) ----
  add('haystack', -72, -6, 0, 1.0); add('wreck', -108, -4, 1.2);   // 西缺口出口第一拍遮蔽(草垛可压过/残骸挡车挡视线)
  add('haystack', 92, -2, 0, 1.0); add('wreck', 128, -4, 1.6);     // 东缺口出口第一拍遮蔽
  add('haystack', 200, -100, 0, 0.95); add('haystack', 240, -72, 0, 0.95);  // 东北角机动歇脚点(修前北岸零草垛)
  // ---- 评审修订2: 周边区域充实 —— 东北角节奏点镜像到其余三角 + 南北远端轻点缀(平原特性保持开阔, 只给节奏点) ----
  add('haystack', -205, -95, 0, 0.95); bushPatch(add, rng, -211, -88, 2);    // 西北角(对位东北角)
  add('haystack', 215, 125, 0, 0.95); bushPatch(add, rng, 221, 132, 2);      // 东南角
  add('haystack', -220, 118, 0, 0.95); bushPatch(add, rng, -214, 125, 2);    // 西南角
  add('haystack', 105, 280, 0, 0.9); add('haystack', -100, 275, 0, 0.9);    // 南远端麦田(田埂树列以外)
  bushPatch(add, rng, 60, 285, 2); bushPatch(add, rng, -58, 282, 2);
  add('haystack', 95, -292, 0, 0.9); add('haystack', -98, -288, 0, 0.9);    // 北远端(北坡阵地后)
  bushPatch(add, rng, 55, -296, 2); bushPatch(add, rng, -52, -292, 2);
}

/* ============ l05 荒漠机场(快节奏冲锋) ============ */
function terrainL05(x, z) {
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 1.8;   // 平缓沙地: 快节奏
  // 主跑道(南北贯穿, x=-20): 微抬硬地; 东西滑行道(z=80) 连西机堡区
  h += ss(18, 10, Math.abs(x + 20)) * 0.5;
  h += ss(14, 8, Math.abs(z - 80)) * 0.35 * (1 - ss(120, 200, Math.abs(x + 20)));
  // 两侧断续沙脊: 每段中点一条登坡道(脊顶巨石即道口标记, 见 coversL05), 其余断面陡崖上不去;
  // 上顶走坡道、下坡沿断面缓滑(≤4.5m/s 不摔死); 脊顶平带可沿脊行驶 = 全场最好的机动观察位
  h += ridgeSeg(x, z, -185, 250, -160, 120, 8, 14, [0.5], 46) + ridgeSeg(x, z, -210, 20, -175, -120, 8, 14, [0.5], 46);
  h += ridgeSeg(x, z, 175, 200, 150, 60, 8, 14, [0.5], 46) + ridgeSeg(x, z, 190, -60, 160, -190, 8, 14, [0.5], 46);
  // 机堡土丘(可攀缓丘, 顶上硬掩体位) + 塔台台地(加高到与机堡丘平齐, 南线灯塔)
  for (const [mx, mz, mw, mh] of [[-90, 40, 20, 4.5], [-100, -60, 20, 4.5], [90, -20, 20, 4.5], [100, -140, 20, 4], [20, 140, 16, 4.5]])
    h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  // 散沙坑(弹坑感) + 微沙纹
  { const r = mulberry32(20261015); for (let i = 0; i < 10; i++) { const c = { x: -220 + r() * 440, z: -180 + r() * 380, r: 4 + r() * 3, d: 0.8 + r() * 0.6 }; h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d; } }
  h += (n5((x + 400) / SIZE, (z + 400) / SIZE) - 0.5) * 1.2;
  h += (n2((x + 400) / SIZE, (z + 400) / SIZE) - 0.5) * 3.0 * ss(190, 250, Math.abs(x));   // 东西侧翼沙垄(±1.5m 缓丘, 梯度~0.09 可通行; 补侧翼空旷, 出生环 |x|≤248 处振幅已收敛)
  const spawnFlat = ss(115, 72, Math.hypot(x, z - 335));
  h = h * (1 - spawnFlat) + 6.5 * spawnFlat;
  const bx = Math.max(Math.abs(x) - (352 + 20 * n4((x + 400) / SIZE, 0.55)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 20 * n4(0.45, (z + 400) / SIZE)), 0);
  h += ss(0, 45, Math.hypot(bx, bz)) * 55;
  return h;
}
function coversL05(add, rng) {
  // 西机堡区(沿滑行道) + 东检修场
  add('barn', -90, 40, 0.05, 1.6); add('barn', -100, -60, 0.05, 1.6);
  add('barn', 90, -20, Math.PI / 2, 1.5); add('barn', 100, -140, Math.PI / 2, 1.5);
  // 塔台与跑道设施: 塔台房(移出丘心让出北棱线 peek 位)/油料库/混凝土隔离墩列
  add('house', 30, 150, 0.3, 1.25); add('house', 34, 158, 1.2, 0.95); add('wall', 8, 150, 0.1, 1.1);
  for (let z2 = 220; z2 > -220; z2 -= 44) { add('wall', -44, z2, Math.PI / 2, 1); add('trap', 6, z2 + 18, rng() * 3); }
  // 沙脊顶巨石 = 四条登坡道道口标记(每段中点, 坡道就开在巨石两侧) + 缺口拒马
  add('rock', -172, 185, rng() * 6, 1.4); add('rock', -192, -50, rng() * 6, 1.4);
  add('rock', 162, 130, rng() * 6, 1.4); add('rock', 175, -125, rng() * 6, 1.4);
  // 登坡道坡脚草丛(坡道断面宽: 55 设计米处才是真正的坡脚, 进道口前蹲一拍避开脊顶观察): 西1/西2/东1/东2 靠中场一侧
  bushPatch(add, rng, -119, 195, 2); bushPatch(add, rng, -139, -37, 2);
  bushPatch(add, rng, 108, 140, 2); bushPatch(add, rng, 121, -113, 2);
  add('trap', -185, 70, rng() * 3); add('trap', 165, 30, rng() * 3);   // 缺口拒马镜像成对: 西侧移到西缺口对角线中点(修前孤悬 W1 脊外 23m 什么都不堵)
  // 跑道残骸(击毁运输机/油车) + 散岩 + 稀疏荒漠灌丛
  add('wreck', -20, 210, 1.1); add('wreck', -14, 60, 2.6); add('wreck', -26, -110, 0.4); add('wreck', -18, -210, 1.8);
  add('wreck', 60, 90, 3.0); add('wreck', -70, 130, 0.9);
  for (let i = 0; i < 14; i++) add('rock', -240 + rng() * 480, -220 + rng() * 460, rng() * 6, 0.8 + rng() * 0.7);
  for (const [cx2, cz2] of [[-60, 220], [70, 180], [-160, -100], [138, 96], [30, -60], [-40, -180]]) bushPatch(add, rng, cx2, cz2, 2);   // 东缺口簇从(150,100)崖坡移到(138,96)平地(修前两丛在滑坡带/31°崖坡上属死草)
  // 机堡丘向敌面棱线蹲草簇(卖头 peek 不再裸换血)
  for (const [hx2, hz2] of [[-86, 46], [-96, -52], [86, -26], [96, -152]]) bushPatch(add, rng, hx2, hz2, 2);
  // 远西/远东绕后带跳点岩(约90m间距) + 各1簇蹲草——600m裸奔带有了节奏点
  for (const [fx2, fz2] of [[-245, -80], [-235, -180], [-250, -260], [240, -60], [235, -160], [248, -250]]) add('rock', fx2, fz2, rng() * 6, 1.35);
  bushPatch(add, rng, -240, -170, 2); bushPatch(add, rng, 238, -110, 2);
  // 北端机堡阵地工事
  for (let x3 = -40; x3 <= 40; x3 += 18) add('trap', x3, -238, rng() * 3);
  add('wall', -52, -248, 0.15, 1.2); add('wall', 50, -246, -0.1, 1.2);
  add('wall', 0, -240, 0, 1.2);   // 切断塔台丘↔tiger 的 443m 超视距(AI视距400)白嫖线, 虎从缺口探头射击
  add('wreck', -18, -258, 0.7); add('wreck', 24, -254, 2.1);
  // ---- 评审修订2: 周边区域充实 —— 远侧绕后带南段对位(修前 6岩+2草全在北半场 z<0, 南段同型车道零节奏点) + 南北远端灌丛 ----
  for (const [fx2, fz2] of [[-245, 80], [-235, 180], [240, 60], [235, 160]]) add('rock', fx2, fz2, rng() * 6, 1.35);   // 远西/远东南段跳点岩(镜像北段)
  bushPatch(add, rng, -240, 110, 2); bushPatch(add, rng, 238, 100, 2);
  for (const [gx, gz] of [[-60, 232], [62, 238], [-130, 252], [128, 248]]) {   // 南远端荒漠灌丛(跑道南口两侧)
    bushPatch(add, rng, gx, gz, 2);
    add('rock', gx + 8, gz + 6, rng() * 6, 1.1);
  }
  bushPatch(add, rng, -58, -278, 2); add('rock', -50, -284, rng() * 6, 1.2);  // 北远端(机堡阵地后方)
  bushPatch(add, rng, 60, -282, 2); add('rock', 52, -288, rng() * 6, 1.2);
  // ---- 评审修订3: 东西侧翼充实 —— 散岩带+枯灌丛+弃车(配合地形侧翼沙垄), 东西边不再空旷 ----
  for (const side of [-1, 1]) {
    for (let z = -270; z <= 270; z += 62) {
      add('rock', side * (205 + rng() * 45), z + (rng() - 0.5) * 30, rng() * 6, 0.9 + rng() * 0.7);
      if (rng() < 0.75) bushPatch(add, rng, side * (205 + rng() * 45), z + 31 + (rng() - 0.5) * 20, 2);
    }
    add('wreck', side * (215 + rng() * 30), -120 + rng() * 240, rng() * 3);
  }
}

/* ============ l06 冬季河谷(冰河 + 谷壁高地 + 南北村落) ============ */
const RIVERX1 = { a: [-38, 330], b: [30, -330] };   // 冻结河道中心线(蜿蜒 N-S)
function riverX(z) { return RIVERX1.a[0] + (RIVERX1.b[0] - RIVERX1.a[0]) * (z - RIVERX1.a[1]) / (RIVERX1.b[1] - RIVERX1.a[1]) + 40 * Math.sin(z * 0.012); }
const CRATERS6 = [];
{ const r = mulberry32(20261021); for (let i = 0; i < 9; i++) CRATERS6.push({ x: -60 + r() * 120, z: -150 + r() * 100, r: 3.5 + r() * 3, d: 0.7 + r() * 0.6 }); }
function terrainL06(x, z) {
  let h = 5 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 4;
  // 冻结河道: 冰面低于两岸 2.5m, 岸坡 ~0.1 全线可进出; 河道即中央推进走廊(冰面无掩体, 快速但有暴露风险)
  h -= gauss(x - riverX(z), 26) * 2.5;
  // 冻湖(西岸): 开阔冰面俯角区
  h -= gauss(Math.hypot((x + 105) * 1.1, z - 30), 34) * 2.0;
  // 中场卖头微丘 + 弹坑带
  for (const [mx, mz, mw, mh] of [[-45, -75, 24, 3.5], [55, 60, 26, 4], [-60, 155, 22, 3], [65, -140, 24, 3.5]])
    h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  for (const c of CRATERS6) h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d;
  // 谷壁陡壁山×4: 唯一登顶路朝地图中心(坡道口朝内), 外侧断崖压黑不可攀 —— 每个高坡一条路规则
  h += cliffHill(x, z, -170, -120, 13, Math.PI / 2, 7.5, 44);   // 西北山(东坡上)
  h += cliffHill(x, z, -165, 140, 13, Math.PI / 2, 7.5, 44);    // 西南山(东坡上)
  h += cliffHill(x, z, 175, -100, 12, -Math.PI / 2, 7, 44);     // 东北山(西坡上)
  h += cliffHill(x, z, 170, 150, 12, -Math.PI / 2, 7, 44);      // 东南山(西坡上)
  // 南北村落台地(阶段目标): 近水平 + 屋群
  const vil = ss(60, 28, Math.hypot(x - (x > 0 ? 12 : -12), z - (z > 0 ? 205 : -205)));
  h = h * (1 - vil * 0.6) + (h + 0.6) * vil * 0.6;
  const spawnFlat = ss(115, 72, Math.hypot(x, z - 330));
  h = h * (1 - spawnFlat) + 6 * spawnFlat;
  const bx = Math.max(Math.abs(x) - (352 + 20 * n4((x + 400) / SIZE, 0.3)), 0);
  const bz = Math.max(Math.abs(z) - (352 + 20 * n4(0.5, (z + 400) / SIZE)), 0);
  h += ss(0, 45, Math.hypot(bx, bz)) * 55;
  return h;
}
function coversL06(add, rng) {
  // 南村(玩家推进第一目标) + 北村(敌守军阵地)
  for (const [cx, cz, n] of [[-22, 208, 5], [26, 214, 4], [-18, -208, 4], [24, -200, 5]]) {
    for (let i = 0; i < n; i++) {
      const hx = cx + (rng() - 0.5) * 70, hz = cz + (rng() - 0.5) * 55;
      add(rng() < 0.55 ? 'house' : 'barn', hx, hz, rng() * 3, 0.85 + rng() * 0.35);
      if (rng() < 0.5) add('ruin', hx + 20 + rng() * 14, hz + (rng() - 0.5) * 30, rng() * 3);
      if (rng() < 0.6) add('wall', hx - 14, hz + (rng() - 0.5) * 24, rng() * 3, 1.05);
    }
  }
  for (const [wx, wz] of [[-8, 190], [10, -186]]) add('wreck', wx, wz, rng() * 3);
  // 冻河岸树线(针叶林带, 视觉标出河道走向): 树只挡车不挡弹
  for (let z = 320; z > -320; z -= 26) {
    for (const side of [-1, 1]) {
      if (rng() < 0.28) continue;
      const rx = riverX(z) + side * (34 + rng() * 26);
      add('tree', rx, z + (rng() - 0.5) * 14, rng() * 6, 0.85 + rng() * 0.5);
    }
  }
  // 谷地松林(东西两翼纵深)
  for (let i = 0; i < 52; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    add('tree', side * (205 + rng() * 110), 300 - rng() * 600, rng() * 6, 0.85 + rng() * 0.6);
  }
  // 冰面与中场雪岩(卖头锚点) + 枯灌丛
  for (const [rx, rz] of [[-45, -75], [55, 60], [-60, 155], [65, -140]]) add('rock', rx + (rng() - 0.5) * 8, rz + (rng() - 0.5) * 8, rng() * 6, 1.4 + rng() * 0.3);
  for (const [cx2, cz2] of [[-14, 30], [22, -20], [-30, -120], [35, 120], [0, 250], [-5, -255]]) bushPatch(add, rng, cx2, cz2, 3);
  for (let i = 0; i < 16; i++) add('rock', -220 + rng() * 440, -260 + rng() * 520, rng() * 6, 0.9 + rng() * 0.7);
  // 东西谷壁山配套掩体(登顶路灌木 + 顶面锚点)
  hillCovers(add, rng, -170, -120, Math.PI / 2, 44);
  hillCovers(add, rng, -165, 140, Math.PI / 2, 44);
  hillCovers(add, rng, 175, -100, -Math.PI / 2, 44);
  hillCovers(add, rng, 170, 150, -Math.PI / 2, 44);
  // 南北出生带对位掩护
  for (const [rx2, rz2] of [[-42, 262], [38, 268], [-40, -265], [36, -258]]) add('rock', rx2, rz2, rng() * 6, 1.3);
  bushPatch(add, rng, 0, 240, 2); bushPatch(add, rng, 0, -244, 2);
  // ---- 评审预留(追加在随机流末尾, 不扰动上方布点) ----
  add('rock', 190, 60, rng() * 6, 1.3); bushPatch(add, rng, 196, 66, 2);      // 东北山登顶道口外锚点
  add('rock', -190, -45, rng() * 6, 1.3); bushPatch(add, rng, -196, -52, 2);  // 西北山登顶道口外锚点
}

/* ============ 地图定义 ============ */
const MAPS = {
  l01: {
    theme: 'grass',
    dir: 'l01-encounter', name: '诺曼底 · 遭遇战', seed: 20261001,
    briefing: '穿越树篱田野与干河床，肃清村庄巡逻队，随后突破北坡敌军阵地。全歼敌军即胜利。',
    terrain: terrainL01, covers: coversL01,
    lighting: { sunDir: [0.45, 0.75, 0.35], sunColor: [1.0, 0.95, 0.85], sunIntensity: 1.15, ambient: 0.55, ambientColor: [0.6, 0.7, 0.85], fogColor: [0.78, 0.83, 0.9], fogDensity: 0.0013, skyTop: [0.42, 0.6, 0.85], skyBottom: [0.87, 0.91, 0.95] },
    player: { spawn: [0, 335, Math.PI] },
    waves: [
      { name: '村庄巡逻队', enemies: [
        { type: 'pz4', pos: [-28, -12], yaw: 0, personality: 'flanker', patrol: [[-28, -12], [32, 6], [-24, 38], [60, -50]] },
        { type: 'pz4', pos: [36, 18], yaw: 0, personality: 'flanker', patrol: [[36, 18], [8, 44], [46, 48]] } ] },
      { name: '北坡阵地', enemies: [
        // stug3 原北垒北坡位被己方土垒反斜面挡瞎(对全部进攻轴0通视) → 移东农场平地, 掩护东侧两路且不压制中路;
        // 比评审点(157,-126)再南移8m避开东侧废墟(150,-130)对弹坑带视线的遮挡: 弹坑带东扇8/8通视, 村北出口(0,0)亦不可见
        { type: 'stug3', pos: [158, -134], yaw: -1.9, personality: 'sniper', hold: true },
        // 守方面向进攻方向出生(yaw 0=朝南), 巡逻拉过垒顶一格(45,-215): 翻棱即互见, 不再永远贴棱后
        { type: 'tiger1', pos: [-16, -268], yaw: 0, personality: 'hold', patrol: [[-16, -268], [14, -262], [45, -215]] } ] }
    ]
  },
  l02: {
    theme: 'city',
    dir: 'l02-city', name: '废墟 · 城市巷战', seed: 20261002,
    briefing: '逐街推进，肃清街区敌军，最终攻克北广场核心阵地。残垣断壁是掩体也是坟场。',
    terrain: terrainL02, covers: coversL02,
    lighting: { sunDir: [-0.4, 0.6, 0.5], sunColor: [1.0, 0.88, 0.75], sunIntensity: 1.0, ambient: 0.5, ambientColor: [0.55, 0.58, 0.62], fogColor: [0.72, 0.72, 0.72], fogDensity: 0.0019, skyTop: [0.5, 0.52, 0.55], skyBottom: [0.8, 0.78, 0.74] },
    player: { spawn: [0, 300, Math.PI] },
    waves: [
      { name: '街区巡逻队', enemies: [
        { type: 't34', pos: [-90, 60], yaw: Math.PI, personality: 'flanker', patrol: [[-90, 60], [-51, 60], [-51, -2], [-90, -2]] },
        { type: 't34', pos: [90, 20], yaw: Math.PI, personality: 'flanker', patrol: [[90, 20], [51, 20], [51, 98], [90, 98]] } ] },
      { name: '广场核心阵地', enemies: [
        { type: 'churchill7', pos: [0, -178], yaw: 3.14, personality: 'hold', hold: true },
        { type: 'su100', pos: [158, -80], yaw: -1.0, personality: 'sniper', hold: true },   // 东北山山顶(南崖不可攀/北坡敌方可上): 压制东街的制高点, yaw朝中央大道走廊口
        { type: 't3485', pos: [-78, -118], yaw: -2.2, personality: 'flanker', patrol: [[-78, -118], [-40, -80], [-78, -40]] } ] }
    ]
  },
  l03: {
    theme: 'rock',
    dir: 'l03-highland', name: '山川 · 高地争夺', seed: 20261003,
    briefing: '沿峡谷推进，夺取山间小村，翻越鞍部攻克北峰阵地。制高点决定一切。',
    terrain: terrainL03, covers: coversL03,
    lighting: { sunDir: [0.5, 0.85, 0.2], sunColor: [1.0, 0.98, 0.92], sunIntensity: 1.25, ambient: 0.5, ambientColor: [0.62, 0.72, 0.9], fogColor: [0.8, 0.86, 0.94], fogDensity: 0.0010, skyTop: [0.32, 0.52, 0.85], skyBottom: [0.85, 0.9, 0.96] },
    player: { spawn: [0, 322, Math.PI] },
    waves: [
      { name: '峡谷巡逻队', enemies: [
        { type: 'cromwell', pos: [-24, 80], yaw: Math.PI, personality: 'flanker', patrol: [[-24, 80], [30, 60], [-10, 130]] },
        { type: 'firefly', pos: [30, -10], yaw: Math.PI, personality: 'flanker', patrol: [[30, -10], [-28, 0], [26, 40], [-56, 56]] } ] },   // 末点进西道口: 西路不再零压力
      { name: '高地守军', enemies: [
        // su100 从西脊正顶(被自家东坡肩挡瞎)移东坡肩: 对村137m/中场159m/西车道全部通视, 真中走廊压制者
        { type: 'su100', pos: [-126, 12], yaw: 1.35, personality: 'sniper', hold: true },
        { type: 'm36', pos: [140, -190], yaw: -1.2, personality: 'sniper', hold: true },
        // is2 从峰后圆顶(南向视界仅50m)前移坡沿: 南坡腰/谷心山顶变互见成真锚点, yaw 0 面朝进攻方向不再送后装甲
        { type: 'is2', pos: [0, -240], yaw: 0, personality: 'hold', hold: true } ] }
    ]
  },
  l04: {
    theme: 'grass',
    dir: 'l04-steppe', name: '东线 · 平原炮战', seed: 20261011,
    briefing: '一望无际的麦田与反坦克壕。视野开阔、遮蔽稀少，先敌发现先敌开火；过壕只有两处缺口。',
    terrain: terrainL04, covers: coversL04,
    lighting: { sunDir: [-0.35, 0.7, 0.45], sunColor: [1.0, 0.93, 0.8], sunIntensity: 1.1, ambient: 0.55, ambientColor: [0.65, 0.68, 0.78], fogColor: [0.82, 0.85, 0.88], fogDensity: 0.0011, skyTop: [0.4, 0.56, 0.82], skyBottom: [0.88, 0.9, 0.9] },
    player: { spawn: [0, 335, Math.PI] },
    waves: [
      { name: '远距炮击组', enemies: [
        // su100 上西山山顶平台(-147,-113, 翻转后守军本方制高点): 南向越过崖唇瞰制西缺口两端口/麦垄脊/东缺口(含掩体模型5/5通视, 避开崖缘巨石)
        { type: 'su100', pos: [-147, -113], yaw: 0.6, personality: 'sniper', hold: true },
        { type: 'stug3', pos: [148, -198], yaw: -2.9, personality: 'sniper', hold: true } ] },
      { name: '装甲突击队', enemies: [
        { type: 'tiger1', pos: [-30, -268], yaw: 3.14, personality: 'hold', hold: true },
        { type: 'pz4', pos: [96, -140], yaw: -2.4, personality: 'flanker', patrol: [[96, -140], [150, -60], [210, -140]] },
        { type: 'pz4', pos: [-110, -120], yaw: 2.5, personality: 'flanker', patrol: [[-110, -120], [-130, -34], [-80, -90]] } ] }
    ]
  },
  l05: {
    theme: 'sand',
    dir: 'l05-airfield', name: '荒漠 · 机场争夺', seed: 20261012,
    briefing: '沙漠前线机场。两侧沙脊每段中点有一条登坡道（脊顶巨石是道口标记）直上脊顶观察位，其余断面陡崖上不去、滑下不摔死。跑道直通北端机堡阵地，快速穿插，别在跑道上停留。',
    terrain: terrainL05, covers: coversL05,
    lighting: { sunDir: [0.4, 0.8, -0.3], sunColor: [1.0, 0.95, 0.82], sunIntensity: 1.3, ambient: 0.5, ambientColor: [0.72, 0.66, 0.55], fogColor: [0.9, 0.84, 0.7], fogDensity: 0.0012, skyTop: [0.45, 0.58, 0.75], skyBottom: [0.92, 0.86, 0.72] },
    player: { spawn: [0, 335, Math.PI] },
    waves: [
      { name: '快速反应组', enemies: [
        { type: 'cromwell', pos: [-80, -40], yaw: 2.9, personality: 'flanker', patrol: [[-80, -40], [-160, 60], [-90, 100]] },
        { type: 'cromwell', pos: [70, -60], yaw: -2.9, personality: 'flanker', patrol: [[70, -60], [150, 40], [80, -118]] },   // 末点改走东北丘西麓(修前距谷仓14m顶牛),
        { type: 't34', pos: [-20, -120], yaw: 3.14, personality: 'flanker', patrol: [[-20, -120], [-80, -160], [40, -170]] } ] },
      { name: '机堡守军', enemies: [
        // tiger 退到拒马线后缺口正后方(修前在拒马前2m), 塔台丘↔tiger 的 443m 超视距白嫖线被墙切断
        { type: 'tiger1', pos: [0, -250], yaw: 3.14, personality: 'hold', hold: true },
        // churchill 上西机堡丘2顶北缘(修前距最近硬掩体152m蹲裸沙; -47 因谷仓碰撞比评审的-55 北移8m)
        { type: 'churchill7', pos: [-100, -47], yaw: 2.6, personality: 'hold', hold: true },
        // su100 东北丘南麓反斜面(修前58m外被反斜面挡成互盲; -158 因谷仓碰撞比评审的-152 南移6m, 东缺口方向仍可侧击)
        { type: 'su100', pos: [100, -158], yaw: -2.5, personality: 'sniper', hold: true } ] }
    ]
  },
  l06: {
    theme: 'winter',
    dir: 'l06-winter', name: '冬境 · 河谷争夺', seed: 20261021,
    briefing: '冰封河谷，两军隔岸相望。冻结的河道是中央快攻走廊——冰面无掩体，冲得快也死得快；两岸谷壁高地各有唯一登顶路（坡道口朝向地图中心），夺下制高点就锁住冰面。',
    terrain: terrainL06, covers: coversL06,
    lighting: { sunDir: [0.4, 0.7, 0.3], sunColor: [1.0, 0.97, 0.9], sunIntensity: 1.05, ambient: 0.65, ambientColor: [0.72, 0.78, 0.9], fogColor: [0.85, 0.88, 0.93], fogDensity: 0.0014, skyTop: [0.5, 0.62, 0.8], skyBottom: [0.88, 0.9, 0.94] },
    player: { spawn: [0, 335, Math.PI] },
    waves: [
      { name: '河岸前哨', enemies: [
        { type: 'pz4', pos: [-38, -20], yaw: 0, personality: 'flanker', patrol: [[-38, -20], [30, 40], [-20, 80]] },
        { type: 't34', pos: [42, -60], yaw: Math.PI, personality: 'flanker', patrol: [[42, -60], [-25, -95], [55, -130]] } ] },
      { name: '北村守军', enemies: [
        { type: 'stug3', pos: [-64, -238], yaw: 0.3, personality: 'sniper', hold: true },
        { type: 'tiger1', pos: [22, -246], yaw: 0, personality: 'hold', patrol: [[22, -246], [-14, -238], [-40, -210]] } ] }
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
    for (let i = 0; i < RES; i++) {
      const wx = -SIZE / 2 + (i / (RES - 1)) * SIZE, wz = -SIZE / 2 + (j / (RES - 1)) * SIZE;
      H[j * RES + i] = M.terrain(wx / S, wz / S);   // 等比放大: 同样的山, 更宽的坡与更长的视线
    }
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
    x /= S; z /= S;
    const fi = clamp((x + 400) / 800, 0, 1) * (RES - 1), fj = clamp((z + 400) / 800, 0, 1) * (RES - 1);
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
  const add0 = (type, x, z, yaw = 0, scale = 1) => covers.push({ type, x: +(x * S).toFixed(1), z: +(z * S).toFixed(1), yaw: +yaw.toFixed(2), scale: +scale.toFixed(2) });
  const add = add0;
  M.covers(add, rng);
  const mapJson = {
    _说明: '手改本文件即可调整关卡(世界坐标米, x 东西 / z 南北, 玩家在南朝北推进)',
    id: id + '-' + M.dir, name: M.name, briefing: M.briefing,
    terrain: { size: SIZE, resolution: RES, maxHeight: MAX_H },
    lighting: M.lighting, theme: M.theme,
    player: { spawn: [M.player.spawn[0] * S, M.player.spawn[1] * S, M.player.spawn[2]] },
    waves: M.waves.map(w => ({ ...w, enemies: w.enemies.map(e => ({ ...e, pos: [e.pos[0] * S, e.pos[1] * S], patrol: (e.patrol || []).map(q => [q[0] * S, q[1] * S]) })) })),
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
// 地图资产变了 → 更新版本戳(客户端按 version.txt 盖 ?v=, 旧缓存自动过期; CI 部署时会重写为提交时刻)
try { fs.writeFileSync(path.join(ROOT, '..', '..', 'version.txt'), new Date().toISOString()); } catch (e) { }
