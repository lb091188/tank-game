#!/usr/bin/env node
// check-spawns.js — 死斗出生池与南北公平性确定性校验(零依赖)
// 三段:
//   ① 地形门禁: 五图 covers/waves 齐备、单机出生点平坦、边界山体不可攀(等价 map-review 工作流 SCAN)
//   ② 出生池校验: 复刻 main.js 的螺旋找平地逻辑, 断言五图 8 池点的 ±11m 抖动圆盘全安全
//      (⚠ 与 client/js/main.js 的 _ptOk/_diskOk/螺旋参数保持同步修改)
//   ③ 通视对称探针: 各半场局部高点对对侧池环的地形通视计数, l01/l03 断言 |北→南 − 南→北| ≤ 2
// 用法: node tools/check-spawns.js   (退出码非 0 = 有 FAIL)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'client', 'assets', 'maps');
const MAPS = ['l01-encounter', 'l02-city', 'l03-highland', 'l04-steppe', 'l05-airfield'];
const ASSERT_LOS = { 'l01-encounter': 2, 'l03-highland': 2 };   // id → 允许的 |N-S| 上限

/* ---------- PNG16 解码(与 build-map.js writePNG16 对偶) ---------- */
function loadPNG16(f) {
  const b = fs.readFileSync(f);
  let p = 8, w = 0, h = 0, id = [];
  while (p < b.length) {
    const l = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8);
    if (t === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (t === 'IDAT') id.push(b.subarray(p + 8, p + 8 + l));
    p += 12 + l;
  }
  const raw = zlib.inflateSync(Buffer.concat(id));
  const o = new Float32Array(w * h), bp = 2, st = w * bp;
  for (let j = 0; j < h; j++) {
    const ft = raw[j * (st + 1)], row = j * (st + 1) + 1;
    for (let i = 0; i < w; i++) {
      const x = i * bp;
      const a = i >= 1 ? ((raw[row + x - 2] << 8) | raw[row + x - 1]) : 0;
      const b2 = j >= 1 ? ((raw[row - (st + 1) + x] << 8) | raw[row - (st + 1) + x + 1]) : 0;
      const c = (j >= 1 && i >= 1) ? ((raw[row - (st + 1) + x - 2] << 8) | raw[row - (st + 1) + x - 1]) : 0;
      let v = (raw[row + x] << 8) | raw[row + x + 1];
      if (ft === 1) v += a; else if (ft === 2) v += b2; else if (ft === 3) v += (a + b2) >> 1;
      else if (ft === 4) {
        const pp = a + b2 - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b2 : c);
      }
      o[j * w + i] = v / 65535;
    }
  }
  return { w, h, data: o };
}

/* ---------- makeTerrain 复刻(与 client/js/simcore.js 同款: 世界坐标入参) ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function loadMap(dir) {
  const J = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'map.json'), 'utf8'));
  const { w, data } = loadPNG16(path.join(ROOT, dir, 'heightmap.png'));
  const size = J.terrain.size, half = size / 2, res = w, mh = J.terrain.maxHeight;
  const heightAt = (x, z) => {
    const fi = clamp((x + half) / size, 0, 1) * (res - 1), fj = clamp((z + half) / size, 0, 1) * (res - 1);
    const i = Math.min(res - 2, Math.floor(fi)), j = Math.min(res - 2, Math.floor(fj)), tx = fi - i, tz = fj - j;
    const a = data[j * res + i], b = data[j * res + i + 1], c = data[(j + 1) * res + i], d = data[(j + 1) * res + i + 1];
    return (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz) * mh;
  };
  const gradAt = (x, z) => {
    const e = 2.5;
    return Math.hypot((heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e));
  };
  const losBlocked = (ax, az, ay, bx, bz, by) => {   // 6m 步进地形遮挡(与 simcore 一致)
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(d / 6));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (heightAt(ax + dx * t, az + dz * t) > ay + (by - ay) * t) {
        if (process.env.PROBE_LOS) console.log(`      [block@] (${Math.round(ax + dx * t)},${Math.round(az + dz * t)}) h=${heightAt(ax + dx * t, az + dz * t).toFixed(1)} line=${(ay + (by - ay) * t).toFixed(1)} t=${t.toFixed(2)}`);
        return true;
      }
    }
    return false;
  };
  return { J, size, half, res, heightAt, gradAt, losBlocked };
}

/* ---------- 出生点判定(与 client/js/main.js 保持同步!) ---------- */
const G_LIM = Math.tan(0.63) * 0.96;   // 可用梯度阈: 低于爬坡角 tan(0.63)=0.729 与滑落阈 ×1.02=0.744, 留余量
function grooveAt(T, x, z) {           // 凹槽(壕沟/深坑)判定: 任一轴两侧 ±14m 均高出中心 3m+ → 进得去出不来
  const hC = T.heightAt(x, z);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 4, dx = Math.sin(a) * 14, dz = Math.cos(a) * 14;
    if (T.heightAt(x + dx, z + dz) > hC + 3 && T.heightAt(x - dx, z - dz) > hC + 3) return true;
  }
  return false;
}
const pointOk = (T, x, z) => T.gradAt(x, z) <= G_LIM && !grooveAt(T, x, z);
function diskOk(T, x, z) {             // 重生 ±10m 抖动圆盘(r=11 留边) 5m 网格全过
  for (let dz = -11; dz <= 11; dz += 5)
    for (let dx = -11; dx <= 11; dx += 5)
      if (dx * dx + dz * dz <= 121 && !pointOk(T, x + dx, z + dz)) return false;
  return true;
}
function findSpawnSpot(T, x, z) {      // 螺旋找平地(确定性): 半径 12→108 步进 12, 8 方位, 逐环旋转 0.3rad
  if (diskOk(T, x, z)) return [x, z];
  for (let r = 12; r <= 108; r += 12)
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + (r / 12) * 0.3;
      const cx = clamp(x + Math.cos(a) * r, -T.half + 20, T.half - 20);
      const cz = clamp(z + Math.sin(a) * r, -T.half + 20, T.half - 20);
      if (diskOk(T, cx, cz)) return [cx, cz];
    }
  return null;
}

/* ---------- 通视对称探针: 半场局部高点 → 对侧池环 ---------- */
function poolRing(T) {                 // 死斗出生池 8 点(过螺旋校验后的最终位置)
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const p = findSpawnSpot(T, Math.cos(a) * 310, Math.sin(a) * 310);
    if (!p) return null;
    pts.push(p);
  }
  return pts;
}
function findSummits(T, zMin, zMax) {  // 局部高点: 15m 网格, 45m 邻域最大值, h≥25m
  const out = [];
  const H = (x, z) => T.heightAt(x, z);
  for (let z = zMin; z <= zMax; z += 15)
    for (let x = -330; x <= 330; x += 15) {
      const h = H(x, z);
      if (h < 25) continue;
      let isMax = true;
      for (let dz2 = -45; dz2 <= 45 && isMax; dz2 += 15)
        for (let dx2 = -45; dx2 <= 45; dx2 += 15)
          if ((dx2 || dz2) && H(x + dx2, z + dz2) > h) { isMax = false; break; }
      if (isMax) out.push({ x, z, h: +h.toFixed(1) });
    }
  return out;
}
function countLos(T, from, targets) {  // 高点(眼高2.2m)对目标池点(2.2m)的地形通视数
  let n = 0;
  for (const p of targets) {
    const ay = T.heightAt(from.x, from.z) + 2.2, by = T.heightAt(p[0], p[1]) + 2.2;
    const blk = T.losBlocked(from.x, from.z, ay, p[0], p[1], by);
    if (process.env.PROBE_LOS) console.log(`      [probe] (${from.x},${from.z},h${ay.toFixed(1)}) → (${p[0]},${p[1]},h${by.toFixed(1)}): ${blk ? '挡' : '通'}`);
    if (!blk) n++;
  }
  return n;
}

/* ---------- 主流程 ---------- */
let bad = 0;
for (const dir of MAPS) {
  const T = loadMap(dir);
  const J = T.J;
  // ① 地形门禁
  const gSpawn = T.gradAt(J.player.spawn[0], J.player.spawn[1]);
  const gBorder = Math.min(T.gradAt(470, 0), T.gradAt(-470, 0), T.gradAt(0, 470), T.gradAt(0, -470));
  const gateOk = J.covers.length >= 60 && J.waves.length >= 2 && gSpawn < 0.913 && gBorder > 0.913;
  if (!gateOk) bad++;
  console.log(`\n[${dir}] 门禁: covers=${J.covers.length} waves=${J.waves.length} gSpawn=${gSpawn.toFixed(2)} gBorder=${gBorder.toFixed(2)} ${gateOk ? 'OK' : '*** FAIL ***'}`);

  // ② 出生池校验
  const ring = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const bx = Math.cos(a) * 310, bz = Math.sin(a) * 310;
    const p = findSpawnSpot(T, bx, bz);
    if (!p) { bad++; ring.push(null); console.log(`  池点${i} (${bx.toFixed(0)},${bz.toFixed(0)}): *** 螺旋未找到合法位 ***`); continue; }
    ring.push(p);
    const d = Math.hypot(p[0] - bx, p[1] - bz);
    console.log(`  池点${i} (${bx.toFixed(0)},${bz.toFixed(0)}) → (${p[0].toFixed(0)},${p[1].toFixed(0)}) 位移 ${d.toFixed(0)}m${d > 0 ? ' ←地形修正' : ''}`);
  }

  // ③ 通视对称探针: 北高点→南半场池点(|z|>50 共3个), 南高点→北半场池点(与审计口径一致; 赤道两点不计)
  const north = findSummits(T, -330, -60), south = findSummits(T, 60, 330);
  const southPool = ring.filter(p => p && p[1] > 50), northPool = ring.filter(p => p && p[1] < -50);
  let N = 0, S = 0;
  const nDet = [], sDet = [];
  for (const s2 of north) { const c = countLos(T, s2, southPool); N += c; if (c) nDet.push(`(${s2.x},${s2.z},${s2.h}m)→南池${c}/${southPool.length}`); }
  for (const s2 of south) { const c = countLos(T, s2, northPool); S += c; if (c) sDet.push(`(${s2.x},${s2.z},${s2.h}m)→北池${c}/${northPool.length}`); }
  const diff = Math.abs(N - S), lim = ASSERT_LOS[dir];
  const losOk = lim === undefined ? true : diff <= lim;
  if (!losOk) bad++;
  console.log(`  通视: 北高点${north.length}处→南池 ${N} 对 [${nDet.join(' | ')}]`);
  console.log(`        南高点${south.length}处→北池 ${S} 对 [${sDet.join(' | ')}]`);
  console.log(`        |N-S|=${diff}${lim !== undefined ? ` (限≤${lim})` : ' (仅报告)'} ${losOk ? 'OK' : '*** FAIL ***'}`);
}
console.log(bad ? `\n*** ${bad} 项 FAIL ***` : '\n全部 OK');
process.exit(bad ? 1 : 0);
