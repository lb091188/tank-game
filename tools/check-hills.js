#!/usr/bin/env node
// check-hills.js — 全图高地"登顶路线"确定性门禁(零依赖)
// 规则(用户验收标准): 每个高坡必须有 1-2 条可爬登顶路(沿线最大坡度 ≤34.4°, 留余量于 36.2° 爬坡极限),
// 其余断面为断崖(>36.1° 不可爬; 滑落机制兜底: 上不去、滑下 ≤4.5m/s 不摔死)。
// ramp 探针 = 从坡道开口方位(φ)外侧 45m 沿径向直插山心, 逐 6m 采样坡度(与游戏 slopeAhead 同口径);
// cliff 探针 = 从断崖侧切入; info = 缓脊/缓丘(低梯度全场可上, 属设计特性, 只报告不判定)。
// ⚠ 坐标均为设计坐标(×1.25=世界坐标); 地形改动后须同步更新本表。
// 用法: node tools/check-hills.js   (退出码非 0 = 有 FAIL)
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', 'client', 'assets', 'maps');
const S = 1.25, LIM_RAMP = 0.60, LIM_CLIFF = 0.63;
function loadPNG16(f) {
  const b = fs.readFileSync(f); let p = 8, w = 0, h = 0, id = [];
  while (p < b.length) { const l = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8); if (t === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); } if (t === 'IDAT') id.push(b.subarray(p + 8, p + 8 + l)); p += 12 + l; }
  const raw = zlib.inflateSync(Buffer.concat(id)); const o = new Float32Array(w * h), bp = 2, st = w * bp;
  for (let j = 0; j < h; j++) { const ft = raw[j * (st + 1)], row = j * (st + 1) + 1; for (let i = 0; i < w; i++) { const x = i * bp; const a = i >= 1 ? ((raw[row + x - 2] << 8) | raw[row + x - 1]) : 0; const b2 = j >= 1 ? ((raw[row - (st + 1) + x] << 8) | raw[row - (st + 1) + x + 1]) : 0; const c = (j >= 1 && i >= 1) ? ((raw[row - (st + 1) + x - 2] << 8) | raw[row - (st + 1) + x - 1]) : 0; let v = (raw[row + x] << 8) | raw[row + x + 1]; if (ft === 1) v += a; else if (ft === 2) v += b2; else if (ft === 3) v += (a + b2) >> 1; else if (ft === 4) { const pp = a + b2 - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b2 : c); } o[j * w + i] = v / 65535; } }
  return { w, h, data: o };
}
const cache = {};
function terr(dir) {
  if (cache[dir]) return cache[dir];
  const { w, data } = loadPNG16(path.join(ROOT, dir, 'heightmap.png'));
  const size = 1000, half = 500, res = w, mh = 70, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const heightAt = (x, z) => { const fi = cl((x + half) / size, 0, 1) * (res - 1), fj = cl((z + half) / size, 0, 1) * (res - 1); const i = Math.min(res - 2, Math.floor(fi)), j = Math.min(res - 2, Math.floor(fj)), tx = fi - i, tz = fj - j; const a = data[j * res + i], b = data[j * res + i + 1], c = data[(j + 1) * res + i], d = data[(j + 1) * res + i + 1]; return (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz) * mh; };
  return cache[dir] = { heightAt };
}
function walk(dir, sx, sz, tx, tz, steps = 16) {
  const T = terr(dir);
  const dx = tx - sx, dz = tz - sz, d = Math.hypot(dx, dz) * S;
  let maxS = 0, maxAt = 0, hEnd = 0;
  for (let k = 0; k < steps; k++) {
    const ax = (sx + dx * k / steps) * S, az = (sz + dz * k / steps) * S;
    const bx = (sx + dx * (k + 1) / steps) * S, bz = (sz + dz * (k + 1) / steps) * S;
    const s = Math.atan2(T.heightAt(bx, bz) - T.heightAt(ax, az), d / steps);
    if (s > maxS) { maxS = s; maxAt = Math.round(d * k / steps); }
    hEnd = T.heightAt(bx, bz);
  }
  return { maxS, maxAt, hEnd };
}
let bad = 0;
function check(dir, name, kind, sx, sz, tx, tz) {
  const r = walk(dir, sx, sz, tx, tz, 20);
  const deg = (r.maxS * 180 / Math.PI).toFixed(0);
  let ok = true, note = '';
  if (kind === 'ramp') { ok = r.maxS <= LIM_RAMP; note = ` (限≤34°)`; }
  else if (kind === 'cliff') { ok = r.maxS > LIM_CLIFF; note = ` (要求>36°不可爬)`; }
  else note = ' (info 缓坡仅报告)';
  if (!ok && kind !== 'info') bad++;
  console.log(`${ok || kind === 'info' ? (kind === 'info' ? '·' : '✓') : '***FAIL***'} [${dir.slice(0, 3)}] ${name} max=${deg}°@${r.maxAt}m 终点h=${r.hEnd.toFixed(1)}m${note}`);
}
/* ---------- l01 诺曼底: 崖山×2(各1条) + 断面 + 缓脊信息 ---------- */
check('l01-encounter', '东山 登顶路(东坡)', 'ramp', 195, -28, 152, -28);
check('l01-encounter', '西北山 登顶路(西坡)', 'ramp', -137, -192, -94, -192);
check('l01-encounter', '东山 西断面', 'cliff', 120, -28, 148, -28);
check('l01-encounter', '西北山 东断面', 'cliff', -70, -192, -90, -192);
check('l01-encounter', '北垒 纵剖@x=-60(缓脊)', 'info', -60, -180, -60, -300);
check('l01-encounter', '南护脊 纵剖(缓垄)', 'info', 0, 180, 0, 280);
/* ---------- l02 城市: 废墟山×3(各1条) ---------- */
check('l02-city', '西山 登顶路(南坡)', 'ramp', -160, 77, -160, 34);
check('l02-city', '东北山 登顶路(北坡)', 'ramp', 158, -123, 158, -80);
check('l02-city', '南山 登顶路(西坡)', 'ramp', -9, 168, 34, 168);
check('l02-city', '西山 北断面', 'cliff', -160, 7, -160, 30);
check('l02-city', '东北山 南断面', 'cliff', 158, -53, 158, -78);
/* ---------- l03 山川: 崖山×4(各1条) + 缓高地信息 ---------- */
check('l03-highland', '西鞍口山 登顶路(北坡)', 'ramp', -98, 93, -98, 136);
check('l03-highland', '东鞍口山 登顶路(南坡)', 'ramp', 100, -43, 100, -86);
check('l03-highland', '谷心山 登顶路(北坡)', 'ramp', 0, -125, 0, -82);
check('l03-highland', '南中山 登顶路(南坡)', 'ramp', 70, 195, 70, 152);
check('l03-highland', '西鞍口山 南断面', 'cliff', -98, 163, -98, 140);
check('l03-highland', '东鞍口山 北断面', 'cliff', 100, -113, 100, -90);
check('l03-highland', '谷心山 南断面', 'cliff', 0, -35, 0, -78);
check('l03-highland', '南中山 北断面', 'cliff', 70, 105, 70, 148);
check('l03-highland', '北峰南坡(缓高地)', 'info', 0, -170, 0, -250);
check('l03-highland', '南岭(缓高地)', 'info', -8, 110, -8, 150);
check('l03-highland', '西脊 横剖(缓脊)', 'info', -104, 0, -178, 0);
check('l03-highland', '东脊 横剖(缓脊)', 'info', 104, 0, 178, 0);
/* ---------- l04 平原: 中野山×2(各1条) ---------- */
check('l04-steppe', '西山 登顶路(北坡·守方)', 'ramp', -142, -153, -142, -110);
check('l04-steppe', '东山 登顶路(东坡)', 'ramp', 103, 55, 60, 55);
check('l04-steppe', '西山 南断面', 'cliff', -142, -63, -142, -106);
check('l04-steppe', '东山 西断面', 'cliff', 33, 55, 56, 55);
/* ---------- l05 机场: 沙脊×4(各1条登坡道) + 断面×2 + 土丘信息 ---------- */
{
  const segs = [
    ['西脊1 登坡道', [-185, 250, -160, 120]],
    ['西脊2 登坡道', [-210, 20, -175, -120]],
    ['东脊1 登坡道', [175, 200, 150, 60]],
    ['东脊2 登坡道', [190, -60, 160, -190]],
  ];
  for (const [name, [ax, az, bx, bz]] of segs) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const px = -dz / L, pz = dx / L;
    const side = Math.sign(mx * px + mz * pz) || 1;
    check('l05-airfield', name, 'ramp', mx + px * 40 * side, mz + pz * 40 * side, mx, mz);
  }
  for (const [name, u] of [['西脊1 断面@20%', 0.2], ['东脊2 断面@75%', 0.75]]) {
    const [ax, az, bx, bz] = segs[name.includes('西') ? 0 : 3][1];
    const px2 = ax + (bx - ax) * u, pz2 = az + (bz - az) * u;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const ox = -dz / L, oz = dx / L, side = Math.sign(px2 * ox + pz2 * oz) || 1;
    check('l05-airfield', name, 'cliff', px2 + ox * 14 * side, pz2 + oz * 14 * side, px2, pz2, 6);
  }
  check('l05-airfield', '机堡土丘(缓丘)', 'info', 115, -20, 92, -20);
}
console.log(bad ? `\n*** ${bad} 项不达标 ***` : '\n全部达标: 每个高坡有 1-2 条登顶路(≤34°), 断面均不可爬(>36°)');
process.exit(bad ? 1 : 0);
