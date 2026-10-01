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
  h -= gauss(distSeg(x, z, 40, 150, 150, 60), 8) * 1.8;
  const gap = Math.min(ss(60, 100, Math.abs(Math.abs(x) - 100)), 1);
  h += gauss(z + 230, 42) * 20 * (1 - gap * 0.85) * ss(320, 220, -z - 0);
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
  h += cliffHill(x, z, -160, 32, 12, 0, 7, 36);            // 南坡上, 北崖堵北向侧街
  h += cliffHill(x, z, 158, -78, 13, Math.PI, 7, 38);      // 北坡上(敌纵深), 南崖堵出击直路
  h += cliffHill(x, z, 36, 168, 12, -Math.PI / 2, 6, 40); // 西坡上, 东崖堵东侧巷
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
  hillCovers(add, rng, -160, 32, 0, 36, true);            // 三座废墟山(残骸代树)
  hillCovers(add, rng, 158, -78, Math.PI, 38, true);
  hillCovers(add, rng, 36, 168, -Math.PI / 2, 32, true);
  // ---- 评审修订(追加在随机流末尾) ----
  add('rock', 36, -80, rng() * 6, 1.4); add('wreck', -36, -84, 1.5);              // 弹坑带南缘两个硬点: 90m冲击带不再裸奔
  add('rock', 78, -24, rng() * 6, 1.3);                                           // 东街反制peek位(对东北山顶su100)
  add('rock', -5.6, 44, rng() * 6, 1.4);                                          // 中央大道走廊中段硬点(偏西, 留东侧车道)
  add('rock', -80.8, 32, rng() * 6, 1.3); add('rock', -80.8, 120, rng() * 6, 1.3);  // 西街长廊侧步位: 360m通视切成三段对枪区
  for (const [sx2, sz2] of [[-208, 48], [208, 48], [-208, 128], [208, 128]]) {    // 外环城郊据点: >300m迂回线有了目的与蹲位(西列再外移, 实测(-192,48)山体贡献5.7m会悬浮)
    add('barn', sx2, sz2, 0, 0.9);
    add('wreck', sx2 - Math.sign(sx2) * 9, sz2 + 12, rng() * 3);
  }
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
  const spawnFlat = ss(110, 70, Math.hypot(x - 0, z - 325));
  h = h * (1 - spawnFlat) + 6 * spawnFlat;
  // 中部山间小村台地
  const vil = ss(40, 16, Math.hypot(x + 20, z - 40));
  h = h * (1 - vil * 0.5) + (h + 0.8) * vil * 0.5;
  // 南麓滚丘(出击通道起伏); 南岭加高为南方中继制高点(死斗公平: 对位北峰, 兼切断谷心山顶→南池 503m 狙线, 四方可登缓丘)
  for (const [mx, mz, mw, mh] of [[-65, 215, 30, 3.5], [50, 240, 26, 4], [-8, 150, 32, 8.5]]) h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  // 陡壁山×3: 西鞍口山(南崖堵绕脊直进, 北坡上顶接鞍口; 13/7.5 对齐谷心山封环强度——修前 12/7 南弧漏 70° 可之字登顶),
  // 东鞍口山翻转为南坡上顶/北崖(攻方中场唯一的可登卖头山, 与 m36 成制高点对决), 谷心山南崖把干河床分成双车道;
  // 谷心山加高到 15(死斗公平: 切断北池(0,-310)→南池 620m 开局狙线, 修前贴山顶余量仅1.6m), wRamp 42→46 保北坡可登
  h += cliffHill(x, z, -98, 138, 13, Math.PI, 7.5, 38);
  h += cliffHill(x, z, 100, -88, 12, 0, 7, 48);
  h += cliffHill(x, z, 0, -80, 15, Math.PI, 7.5, 48);
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
  hillCovers(add, rng, -98, 138, Math.PI, 38);            // 西鞍口山
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
  h += cliffHill(x, z, -142, -108, 13, Math.PI, 7.5, 42);
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
  hillCovers(add, rng, -142, -108, Math.PI, 42);         // 中野西山(翻转: 南崖北坡, 守军本方制高点)
  // ---- 评审修订(追加在随机流末尾) ----
  add('haystack', -72, -6, 0, 1.0); add('wreck', -108, -4, 1.2);   // 西缺口出口第一拍遮蔽(草垛可压过/残骸挡车挡视线)
  add('haystack', 92, -2, 0, 1.0); add('wreck', 128, -4, 1.6);     // 东缺口出口第一拍遮蔽
  add('haystack', 200, -100, 0, 0.95); add('haystack', 240, -72, 0, 0.95);  // 东北角机动歇脚点(修前北岸零草垛)
}

/* ============ l05 荒漠机场(快节奏冲锋) ============ */
function terrainL05(x, z) {
  let h = 6 + fbm((x + 400) / SIZE, (z + 400) / SIZE) * 1.8;   // 平缓沙地: 快节奏
  // 主跑道(南北贯穿, x=-20): 微抬硬地; 东西滑行道(z=80) 连西机堡区
  h += ss(18, 10, Math.abs(x + 20)) * 0.5;
  h += ss(14, 8, Math.abs(z - 80)) * 0.35 * (1 - ss(120, 200, Math.abs(x + 20)));
  // 两侧断续沙脊(不可攀): 各两段, 脊间缺口=冲锋通道
  h += cliffSeg(x, z, -185, 250, -160, 120, 8, 14) + cliffSeg(x, z, -210, 20, -175, -120, 8, 14);
  h += cliffSeg(x, z, 175, 200, 150, 60, 8, 14) + cliffSeg(x, z, 190, -60, 160, -190, 8, 14);
  // 机堡土丘(可攀缓丘, 顶上硬掩体位) + 塔台台地(加高到与机堡丘平齐, 南线灯塔)
  for (const [mx, mz, mw, mh] of [[-90, 40, 20, 4.5], [-100, -60, 20, 4.5], [90, -20, 20, 4.5], [100, -140, 20, 4], [20, 140, 16, 4.5]])
    h += gauss(Math.hypot(x - mx, z - mz), mw) * mh;
  // 散沙坑(弹坑感) + 微沙纹
  { const r = mulberry32(20261015); for (let i = 0; i < 10; i++) { const c = { x: -220 + r() * 440, z: -180 + r() * 380, r: 4 + r() * 3, d: 0.8 + r() * 0.6 }; h -= gauss(Math.hypot(x - c.x, z - c.z), c.r) * c.d; } }
  h += (n5((x + 400) / SIZE, (z + 400) / SIZE) - 0.5) * 1.2;
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
  // 沙脊顶巨石标记 + 缺口拒马
  add('rock', -172, 185, rng() * 6, 1.4); add('rock', -192, -50, rng() * 6, 1.4);
  add('rock', 162, 130, rng() * 6, 1.4); add('rock', 175, -125, rng() * 6, 1.4);
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
    briefing: '沙漠前线机场。跑道直通北端机堡阵地，两侧断续沙脊是仅有的遮蔽——快速穿插，别在跑道上停留。',
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
