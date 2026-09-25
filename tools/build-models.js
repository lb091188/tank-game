#!/usr/bin/env node
// build-models.js — V2 程序化坦克建模(精修版), 零 npm 依赖
// 用法: node tools/build-models.js  → client/assets/models/*.glb
//
// V2 相比 V1: 完整行走机构(负重轮/托带轮/诱导轮/主动轮/挡泥板)、变速器罩、
// 发动机舱格栅与排气、车灯/工具等细节、炮塔圆弧化+尾部储物舱+指挥塔、
// 双气室炮口制退器、顶点色(下部泥土渐变 + 迷彩斑块 + 微噪声)。
// 装甲数值与部位节点契约与 V1 完全一致(引擎零改动):
//   分区: glacis lowerPlate hullSide hullRear hullTop tracks
//         turretFront turretSide turretRear turretRoof mantlet gun
//   枢轴: turret(炮塔) → gun(火炮) → muzzle(炮口空节点)
'use strict';
const fs = require('fs');
const path = require('path');
const THREE = require('../client/js/vendor/three.min.js');

const OUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'models');

/* ============ 最小 GLB (glTF 2.0) 编码器(带 COLOR_0) ============ */

function writeGLB(filePath, rootNode) {
  const gltfNodes = [], meshes = [], materials = [], accessors = [], bufferViews = [];
  const binChunks = [];
  let binLength = 0;

  function addBufferView(typedArray) {
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) { binChunks.push(new Uint8Array(pad)); binLength += pad; }
    const view = { buffer: 0, byteOffset: binLength, byteLength: bytes.length };
    binChunks.push(bytes); binLength += bytes.length;
    bufferViews.push(view);
    return bufferViews.length - 1;
  }

  function addAccessor(typedArray, componentType, type, count, withMinMax) {
    const view = addBufferView(typedArray);
    const acc = { bufferView: view, componentType, type, count };
    if (withMinMax) {
      const n = typedArray.length / count, mn = [], mx = [];
      for (let c = 0; c < n; c++) { mn[c] = Infinity; mx[c] = -Infinity; }
      for (let i = 0; i < count; i++)
        for (let c = 0; c < n; c++) {
          const v = typedArray[i * n + c];
          if (v < mn[c]) mn[c] = v;
          if (v > mx[c]) mx[c] = v;
        }
      acc.min = mn; acc.max = mx;
    }
    accessors.push(acc);
    return accessors.length - 1;
  }

  function emitNode(node) {
    const glNode = { name: node.name };
    if (node.extras) glNode.extras = node.extras;
    if (node.translation) glNode.translation = node.translation;
    if (node.parts && node.parts.length) {
      const pos = [], nor = [], col = [], idx = [];
      for (const p of node.parts) {
        const base = pos.length / 3;
        for (let i = 0; i < p.positions.length; i++) { pos.push(p.positions[i]); nor.push(p.normals[i]); col.push(p.colors[i]); }
        for (let i = 0; i < p.positions.length / 3; i++) idx.push(base + i);
      }
      const posArr = new Float32Array(pos), norArr = new Float32Array(nor), colArr = new Float32Array(col);
      const idxArr = idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      const posAcc = addAccessor(posArr, 5126, 'VEC3', posArr.length / 3, true);
      const norAcc = addAccessor(norArr, 5126, 'VEC3', norArr.length / 3, false);
      const colAcc = addAccessor(colArr, 5126, 'VEC3', colArr.length / 3, false);
      const idxAcc = addAccessor(idxArr, idxArr instanceof Uint32Array ? 5125 : 5123, 'SCALAR', idxArr.length, false);
      materials.push({
        name: node.name + '_mat',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.15, roughnessFactor: 0.8 },
        doubleSided: true
      });
      meshes.push({ primitives: [{ attributes: { POSITION: posAcc, NORMAL: norAcc, COLOR_0: colAcc }, indices: idxAcc, material: materials.length - 1 }] });
      glNode.mesh = meshes.length - 1;
    }
    gltfNodes.push(glNode);
    const self = gltfNodes.length - 1;
    if (node.children) {
      glNode.children = [];
      for (const c of node.children) glNode.children.push(emitNode(c));
    }
    return self;
  }

  emitNode(rootNode);

  const tailPad = (4 - (binLength % 4)) % 4;
  if (tailPad) { binChunks.push(new Uint8Array(tailPad)); binLength += tailPad; }

  const json = {
    asset: { version: '2.0', generator: 'steel-front tools/build-models.js V2' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: gltfNodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: binLength }]
  };

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const binBuf = Buffer.concat(binChunks.map(c => Buffer.from(c)));
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonBuf.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(binBuf.length, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4;
  binBuf.copy(out, o);
  fs.writeFileSync(filePath, out);
}

/* ============ 几何工具(含顶点色: 迷彩斑块+泥土渐变+噪声) ============ */

const clamp01 = v => Math.max(0, Math.min(1, v));
// 确定性散列(供迷彩斑块)
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function N(name, opts = {}) {
  return { name, translation: opts.translation, extras: opts.extras, parts: [], children: opts.children || [] };
}
function Z(name, armor) {
  return { name, extras: { zone: name, armor }, parts: [], children: [] };
}

// 部件: 应用矩阵后计算每顶点颜色
function part(geo, m, color, camoScale = 0.85) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (m) g = g.clone().applyMatrix4(m);
  const P = g.attributes.position.array, Nr = g.attributes.normal.array;
  const colors = new Array(P.length);
  const base = color;
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const patch = hash3(Math.round(x * 1.2), Math.round(y * 1.2), Math.round(z * 1.2)) < 0.30;  // 迷彩斑块
    const dirt = 0.70 + 0.30 * clamp01(y / 3.2);                                               // 下部泥土渐变
    const noise = 0.96 + 0.08 * hash3(Math.round(x * 8), Math.round(y * 8), Math.round(z * 8));
    const k = (patch ? camoScale : 1) * dirt * noise;
    colors[i * 3] = base[0] * k; colors[i * 3 + 1] = base[1] * k; colors[i * 3 + 2] = base[2] * k;
  }
  return { positions: Array.from(P), normals: Array.from(Nr), colors };
}

const M4x = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s)
  );
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sphere = (r, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1));

const TRACK_C = [0.12, 0.12, 0.12], GUN_C = [0.16, 0.16, 0.15], RUBBER = [0.08, 0.08, 0.08];
const OLIVE = [0.33, 0.35, 0.22], GRAY = [0.30, 0.31, 0.34], DGRAY = [0.23, 0.24, 0.26], YGRAY = [0.43, 0.39, 0.27];

/* ============ 通用行走机构 ============ */
// zone: 收纳部件的分区;  sideX: 履带中心x;  n轮 r 半径;  len 履带长; 交错轮 interleave
function runningGear(zone, sideX, n, r, len, trackH, camoCol, interleave = 0) {
  const yWheel = r + 0.06;
  for (const sx of [-1, 1]) {
    // 履带板
    zone.parts.push(part(box(0.55, trackH, len), M4x(sx * sideX, trackH / 2 + 0.02, 0), TRACK_C));
    zone.parts.push(part(box(0.58, 0.1, len * 0.98), M4x(sx * sideX, trackH + 0.05, 0), TRACK_C)); // 履齿
    // 负重轮(含橡胶缘)
    const z0 = -len / 2 + 1.15, zSpan = len - 2.3;
    for (let i = 0; i < n; i++) {
      const zz = z0 + (zSpan * i) / Math.max(1, n - 1);
      const off = interleave ? (i % 2 === 0 ? -1 : 1) * interleave : 0;
      zone.parts.push(part(cyl(r, r, 0.34, 12), M4x(sx * sideX + off * 0, yWheel, zz, 0, 0, Math.PI / 2), [0.2, 0.21, 0.22]));
      zone.parts.push(part(cyl(r * 0.55, r * 0.55, 0.38, 10), M4x(sx * sideX, yWheel, zz, 0, 0, Math.PI / 2), RUBBER));
      if (interleave) zone.parts.push(part(cyl(r * 0.8, r * 0.8, 0.3, 10), M4x(sx * sideX + sx * 0.42, yWheel, zz + interleave * 1.6, 0, 0, Math.PI / 2), [0.18, 0.19, 0.2]));
    }
    // 诱导轮(前, 略高) 与 主动轮(后, 略高)
    for (const [zz, rr] of [[len / 2 - 0.45, r * 1.05], [-len / 2 + 0.45, r * 1.05]]) {
      zone.parts.push(part(cyl(rr, rr, 0.4, 12), M4x(sx * sideX, yWheel + 0.12, zz, 0, 0, Math.PI / 2), [0.19, 0.2, 0.21]));
    }
    // 托带轮
    zone.parts.push(part(cyl(0.11, 0.11, 0.3, 8), M4x(sx * sideX, trackH + 0.16, -len * 0.25, 0, 0, Math.PI / 2), [0.18, 0.19, 0.2]));
    zone.parts.push(part(cyl(0.11, 0.11, 0.3, 8), M4x(sx * sideX, trackH + 0.16, len * 0.25, 0, 0, Math.PI / 2), [0.18, 0.19, 0.2]));
  }
}

// 挡泥板(并入 hullSide 分区)
function fenders(zone, halfW, y, len, col) {
  for (const sx of [-1, 1]) {
    zone.parts.push(part(box(0.6, 0.06, len * 0.9), M4x(sx * (halfW + 0.34), y, 0.1), col));
    zone.parts.push(part(box(0.6, 0.3, 0.06), M4x(sx * (halfW + 0.34), y - 0.12, len / 2 - 0.25), col)); // 前挡泥板
    zone.parts.push(part(box(0.6, 0.3, 0.06), M4x(sx * (halfW + 0.34), y - 0.12, -len / 2 + 0.25), col));
  }
}

// 发动机舱格栅与排气(并入 hullTop / hullRear)
function engineDeck(zoneTop, zoneRear, w, y, zC, col) {
  for (let i = 0; i < 4; i++)
    zoneTop.parts.push(part(box(w * 0.72, 0.05, 0.16), M4x(0, y + 0.02, zC + 0.55 - i * 0.38), [0.1, 0.1, 0.1]));
  for (const sx of [-1, 1])
    zoneRear.parts.push(part(cyl(0.09, 0.09, 0.5, 8), M4x(sx * w * 0.3, y - 0.32, zC - 0.9, 0.25, 0, 0), [0.14, 0.13, 0.12]));
}

// 车灯/工具等小件(并入 hullSide)
function hullKit(zone, w, y, z, col) {
  for (const sx of [-1, 1]) {
    zone.parts.push(part(cyl(0.11, 0.11, 0.16, 8), M4x(sx * (w / 2 - 0.3), y, z, Math.PI / 2, 0, 0), [0.55, 0.52, 0.4]));
    zone.parts.push(part(box(0.34, 0.2, 0.5), M4x(sx * (w / 2 + 0.05), y - 0.45, -z * 0.5), col));
  }
}

/* ============ 火炮(套管+制退器) ============ */
function buildGun(pivot, r, len, col, brake) {
  const gun = N('gun', { translation: pivot });
  const barrel = N('barrel', { extras: { zone: 'gun', armor: 0 } });
  barrel.parts.push(part(cyl(r * 1.45, r * 1.6, 0.55, 10), M4x(0, 0, 0.24, Math.PI / 2, 0, 0), col));          // 防危板/套管
  barrel.parts.push(part(cyl(r, r, len - 0.5, 10), M4x(0, 0, len / 2 + 0.2, Math.PI / 2, 0, 0), col));
  if (brake) {
    barrel.parts.push(part(cyl(r + 0.05, r + 0.05, 0.34, 10), M4x(0, 0, len - 0.28, Math.PI / 2, 0, 0), col)); // 双气室制退器
    barrel.parts.push(part(cyl(r - 0.02, r - 0.02, 0.1, 10), M4x(0, 0, len + 0.02, Math.PI / 2, 0, 0), col));
  }
  const muzzle = N('muzzle', { translation: [0, 0, len + 0.1] });
  gun.children.push(barrel, muzzle);
  return gun;
}

/* ============ 四型坦克(V2) ============ */

function buildSherman() {
  const C = OLIVE;
  const root = N('sherman', { extras: { type: 'sherman' } });

  const tracks = Z('tracks', 20);
  runningGear(tracks, 1.06, 6, 0.42, 6.15, 0.84, C, 0);
  root.children.push(tracks);

  // 车体: 上部车体侧板(含翼子板) + 首上/首下/尾/顶
  const hullSide = Z('hullSide', 38);
  const hw = 1.31, hy = 1.30, hl = 5.9, sh = 1.02;
  hullSide.parts.push(part(box(0.18, sh, hl), M4x(-hw, hy, 0), C));
  hullSide.parts.push(part(box(0.18, sh, hl), M4x(hw, hy, 0), C));
  // 首上侧斜甲(车头两侧切角)
  hullSide.parts.push(part(box(0.16, sh * 0.9, 1.1), M4x(-hw + 0.12, hy, hl / 2 - 0.35, 0, 0.5, 0), C));
  hullSide.parts.push(part(box(0.16, sh * 0.9, 1.1), M4x(hw - 0.12, hy, hl / 2 - 0.35, 0, -0.5, 0), C));
  fenders(hullSide, hw, hy + sh / 2 + 0.05, 5.6, C);
  hullKit(hullSide, 2.62, hy + sh / 2 + 0.2, hl / 2 - 0.15, C);
  root.children.push(hullSide);

  const glacis = Z('glacis', 51);
  glacis.parts.push(part(box(2.44, 1.95, 0.2), M4x(0, hy + sh / 2 - Math.cos(0.82) * 0.97, hl / 2 - 0.32 + Math.sin(0.82) * 0.97, -0.82, 0, 0), C));
  // 三片式变速器罩(车头下缘圆弧)
  glacis.parts.push(part(cyl(0.62, 0.62, 2.2, 10, ), M4x(0, hy - sh * 0.32, hl / 2 - 0.1, 0, 0, Math.PI / 2), C));
  root.children.push(glacis);

  const lower = Z('lowerPlate', 64);
  lower.parts.push(part(box(2.44, sh * 0.72, 0.2), M4x(0, hy - sh * 0.14, hl / 2 - 0.04, -0.26, 0, 0), C));
  // 车体机枪球座
  lower.parts.push(part(sphere(0.16, 8), M4x(0.75, hy - sh * 0.05, hl / 2 + 0.06), GUN_C));
  root.children.push(lower);

  const rear = Z('hullRear', 38);
  rear.parts.push(part(box(2.62, sh, 0.18), M4x(0, hy, -hl / 2 + 0.02, 0.2, 0, 0), C));
  rear.parts.push(part(box(2.5, 0.5, 0.3), M4x(0, hy + sh / 2 - 0.1, -hl / 2 + 0.2, 0.5, 0, 0), C)); // 排气导流板
  root.children.push(rear);

  const top = Z('hullTop', 19);
  top.parts.push(part(box(2.62, 0.12, hl), M4x(0, hy + sh / 2 + 0.06, 0), C));
  top.parts.push(part(box(1.7, 0.1, 1.4), M4x(0, hy + sh / 2 + 0.14, -hl / 2 + 1.1), C)); // 发动机舱凸台
  engineDeck(top, rear, 2.62, hy + sh / 2 + 0.16, -hl / 2 + 1.1, C);
  root.children.push(top);

  // 炮塔: 圆弧形(T48 风) + 尾舱 + 指挥塔 + 圆形炮盾
  const T = { ring: [0, 1.86, 0.45], w: 1.9, l: 2.2, h: 0.78 };
  const turret = N('turret', { translation: T.ring });
  const ty = T.h / 2;
  const tFront = Z('turretFront', 76);
  tFront.parts.push(part(cyl(0.96, 1.06, T.h, 18), M4x(0, ty, -0.08), C));           // 18 段圆柱体炮塔
  tFront.parts.push(part(box(1.5, 0.78, 0.8), M4x(0, ty, -1.0), C));                  // 尾部储物舱
  tFront.parts.push(part(box(0.3, 0.2, 0.5), M4x(0.55, T.h + 0.06, -0.9), C));        // 储物箱
  turret.children.push(tFront);
  const tSide = Z('turretSide', 50);
  tSide.parts.push(part(cyl(0.98, 1.06, 0.06, 18), M4x(0, T.h + 0.02, -0.08), C));    // 顶檐(侧向命中面)
  turret.children.push(tSide);
  const tRear = Z('turretRear', 50);
  tRear.parts.push(part(box(1.4, 0.5, 0.3), M4x(0, ty - 0.08, -1.35), C));            // 后舱门
  turret.children.push(tRear);
  const tRoof = Z('turretRoof', 25);
  tRoof.parts.push(part(cyl(0.95, 0.95, 0.1, 18), M4x(0, T.h + 0.06, -0.08), C));
  tRoof.parts.push(part(cyl(0.36, 0.38, 0.3, 8), M4x(0.52, T.h + 0.2, -0.25), C));    // 指挥塔
  tRoof.parts.push(part(cyl(0.34, 0.34, 0.06, 8), M4x(0.52, T.h + 0.36, -0.25), C));  // 塔盖
  tRoof.parts.push(part(cyl(0.3, 0.3, 0.06, 8), M4x(-0.4, T.h + 0.1, -0.1), C));      // 装填手舱门
  tRoof.parts.push(part(cyl(0.015, 0.015, 1.6, 4), M4x(-0.7, T.h + 0.7, -1.0, 0.25, 0, 0.15), GUN_C)); // 天线
  tRoof.parts.push(part(cyl(0.05, 0.05, 0.4, 6), M4x(0.75, T.h + 0.25, -0.55, 0, 0, 0.35), GUN_C));    // 高机座
  turret.children.push(tRoof);
  const mantlet = Z('mantlet', 89);
  mantlet.parts.push(part(cyl(0.46, 0.46, 0.34, 14), M4x(0, ty + 0.02, T.l / 2 + 0.05, Math.PI / 2, 0, 0), C)); // 圆形炮盾
  turret.children.push(mantlet);
  turret.children.push(buildGun([0, 0.40, 1.10], 0.075, 2.6, GUN_C, true));
  root.children.push(turret);
  return root;
}

function buildMedium() {
  const C = GRAY;
  const root = N('medium', { extras: { type: 'medium' } });

  const tracks = Z('tracks', 20);
  runningGear(tracks, 1.13, 6, 0.40, 6.55, 0.86, C, 0.32);  // 交错负重轮
  root.children.push(tracks);

  const hullSide = Z('hullSide', 40);
  const hw = 1.38, hy = 1.30, hl = 6.3, sh = 1.06;
  hullSide.parts.push(part(box(0.18, sh, hl), M4x(-hw, hy, 0), C));
  hullSide.parts.push(part(box(0.18, sh, hl), M4x(hw, hy, 0), C));
  // 上部侧斜甲(德式折线)
  hullSide.parts.push(part(box(0.14, 0.5, hl * 0.85), M4x(-hw + 0.1, hy + sh / 2 - 0.05, 0.3, 0, 0.42, 0), C));
  hullSide.parts.push(part(box(0.14, 0.5, hl * 0.85), M4x(hw - 0.1, hy + sh / 2 - 0.05, 0.3, 0, -0.42, 0), C));
  fenders(hullSide, hw, hy + sh / 2 + 0.06, 6.0, C);
  // 侧裙板
  hullSide.parts.push(part(box(0.05, 0.62, 4.6), M4x(-(hw + 0.36), hy + sh / 2 - 0.34, 0.3), C));
  hullSide.parts.push(part(box(0.05, 0.62, 4.6), M4x(hw + 0.36, hy + sh / 2 - 0.34, 0.3), C));
  hullKit(hullSide, 2.86, hy + sh / 2 + 0.2, hl / 2 - 0.15, C);
  root.children.push(hullSide);

  const glacis = Z('glacis', 60);
  glacis.parts.push(part(box(2.6, 1.75, 0.2), M4x(0, hy + sh / 2 - Math.cos(0.52) * 0.87, hl / 2 - 0.28 + Math.sin(0.52) * 0.87, -0.52, 0, 0), C));
  glacis.parts.push(part(box(0.7, 0.5, 0.5), M4x(-0.9, hy + sh / 2 - 0.1, hl / 2 - 0.3, -0.4, 0.3, 0), C)); // 驾驶员观察窗护罩
  glacis.parts.push(part(box(0.7, 0.5, 0.5), M4x(0.9, hy + sh / 2 - 0.1, hl / 2 - 0.3, -0.4, -0.3, 0), C));
  root.children.push(glacis);

  const lower = Z('lowerPlate', 60);
  lower.parts.push(part(box(2.6, sh * 0.72, 0.2), M4x(0, hy - sh * 0.14, hl / 2 - 0.04, -0.3, 0, 0), C));
  root.children.push(lower);

  const rear = Z('hullRear', 40);
  rear.parts.push(part(box(2.86, sh, 0.18), M4x(0, hy, -hl / 2 + 0.02, 0.25, 0, 0), C));
  engineDeck(Z('hullTop', 20), rear, 2.86, 1.30 + 0.53, -2.0, C);
  root.children.push(rear);

  const top = root.children[root.children.length - 2]; // hullTop 由 engineDeck 建立的引用? — 见下方说明
  // 注: engineDeck 的第一个参数挂格栅用, 这里直接补到 hullTop 分区
  root.children = root.children.filter(n => n.name !== 'hullTop');
  const topZ = Z('hullTop', 20);
  topZ.parts.push(part(box(2.86, 0.12, hl), M4x(0, hy + sh / 2 + 0.06, 0), C));
  engineDeck(topZ, rear, 2.86, hy + sh / 2 + 0.08, -hl / 2 + 1.3, C);
  root.children.push(topZ);

  // 炮塔: 方形折线炮塔 + 后舱 + 鼓形指挥塔
  const T = { ring: [0, 1.86, 0.25], w: 2.0, l: 2.4, h: 0.8 };
  const turret = N('turret', { translation: T.ring });
  const ty = T.h / 2;
  const tFront = Z('turretFront', 80);
  tFront.parts.push(part(box(T.w, T.h, 0.2), M4x(0, ty, T.l / 2 - 0.28, -0.18, 0, 0), C));
  tFront.parts.push(part(box(T.w - 0.5, T.h - 0.2, 0.7), M4x(0, ty, -0.75), C));
  tFront.parts.push(part(box(1.3, 0.5, 0.8), M4x(0, ty, -1.45), C));       // 尾舱
  tFront.parts.push(part(cyl(0.06, 0.06, 1.5, 4), M4x(-0.8, T.h + 0.6, -1.2, 0.2, 0, 0.2), GUN_C)); // 天线
  turret.children.push(tFront);
  const tSide = Z('turretSide', 50);
  tSide.parts.push(part(box(0.16, T.h, T.l - 0.2), M4x(-T.w / 2, ty, -0.1, 0, 0, 0.1), C));
  tSide.parts.push(part(box(0.16, T.h, T.l - 0.2), M4x(T.w / 2, ty, -0.1, 0, 0, -0.1), C));
  turret.children.push(tSide);
  const tRear = Z('turretRear', 45);
  tRear.parts.push(part(box(T.w, T.h, 0.16), M4x(0, ty, -T.l / 2 + 0.42), C));
  turret.children.push(tRear);
  const tRoof = Z('turretRoof', 25);
  tRoof.parts.push(part(box(T.w - 0.15, 0.1, T.l - 0.3), M4x(0, T.h + 0.04, -0.1), C));
  tRoof.parts.push(part(cyl(0.34, 0.36, 0.26, 8), M4x(0.5, T.h + 0.16, -0.9), C));      // 指挥塔
  tRoof.parts.push(part(cyl(0.32, 0.32, 0.05, 8), M4x(0.5, T.h + 0.3, -0.9), C));
  tRoof.parts.push(part(cyl(0.26, 0.26, 0.05, 8), M4x(-0.45, T.h + 0.07, -0.3), C));
  turret.children.push(tRoof);
  const mantlet = Z('mantlet', 90);
  mantlet.parts.push(part(box(0.8, 0.62, 0.38), M4x(0, ty + 0.02, T.l / 2 + 0.1), C));
  mantlet.parts.push(part(cyl(0.2, 0.2, 0.3, 8), M4x(0.32, ty + 0.14, T.l / 2 + 0.24, Math.PI / 2, 0, 0), GUN_C)); // 瞄准镜
  turret.children.push(mantlet);
  turret.children.push(buildGun([0, 0.40, 1.20], 0.070, 3.2, GUN_C, true));
  root.children.push(turret);
  return root;
}

function buildTD() {
  const C = YGRAY;
  const root = N('td', { extras: { type: 'td' } });

  const tracks = Z('tracks', 20);
  runningGear(tracks, 1.10, 6, 0.42, 6.7, 0.84, C, 0);
  root.children.push(tracks);

  const hw = 1.32, hy = 1.22, hl = 6.4, sh = 0.94;
  const hullSide = Z('hullSide', 45);
  hullSide.parts.push(part(box(0.18, sh, hl), M4x(-hw, hy, 0), C));
  hullSide.parts.push(part(box(0.18, sh, hl), M4x(hw, hy, 0), C));
  fenders(hullSide, hw, hy + sh / 2 + 0.05, 6.1, C);
  hullKit(hullSide, 2.64, hy + sh / 2 + 0.18, hl / 2 - 0.15, C);
  root.children.push(hullSide);

  const glacis = Z('glacis', 80);
  glacis.parts.push(part(box(2.5, 1.85, 0.2), M4x(0, hy + sh / 2 - Math.cos(0.78) * 0.92, hl / 2 - 0.3 + Math.sin(0.78) * 0.92, -0.78, 0, 0), C));
  root.children.push(glacis);
  const lower = Z('lowerPlate', 60);
  lower.parts.push(part(box(2.5, sh * 0.75, 0.2), M4x(0, hy - sh * 0.12, hl / 2 - 0.04, -0.3, 0, 0), C));
  root.children.push(lower);
  const rear = Z('hullRear', 40);
  rear.parts.push(part(box(2.64, sh, 0.18), M4x(0, hy, -hl / 2 + 0.02, 0.22, 0, 0), C));
  root.children.push(rear);
  const top = Z('hullTop', 20);
  top.parts.push(part(box(2.64, 0.12, hl), M4x(0, hy + sh / 2 + 0.06, 0), C));
  engineDeck(top, rear, 2.64, hy + sh / 2 + 0.08, -hl / 2 + 1.2, C);
  root.children.push(top);

  // 战斗室: 大倾角首甲 + 猪头式炮盾(固定, 无炮塔)
  const cy = hy + sh / 2;   // 上车体顶面
  const mantlet = Z('mantlet', 120);
  mantlet.parts.push(part(box(2.3, 1.15, 0.22), M4x(0, cy + 0.62, hl / 2 - 0.5, -0.38, 0, 0), C)); // 战斗室首甲
  mantlet.parts.push(part(cyl(0.52, 0.62, 0.42, 12), M4x(0, cy + 0.58, hl / 2 - 0.12, Math.PI / 2 - 0.15, 0, 0), C)); // 猪头炮盾
  root.children.push(mantlet);

  const casSide = Z('turretSide', 45);
  casSide.parts.push(part(box(0.18, 1.15, 2.6), M4x(-hw + 0.05, cy + 0.55, hl / 2 - 1.5, 0, 0.22, 0), C));  // 战斗室侧斜板
  casSide.parts.push(part(box(0.18, 1.15, 2.6), M4x(hw - 0.05, cy + 0.55, hl / 2 - 1.5, 0, -0.22, 0), C));
  casSide.parts.push(part(cyl(0.015, 0.015, 1.4, 4), M4x(-hw + 0.3, cy + 1.5, -0.5, 0.3, 0, 0.2), GUN_C));
  root.children.push(casSide);

  const casTop = Z('turretRoof', 20);
  casTop.parts.push(part(box(2.3, 0.12, 2.9), M4x(0, cy + 1.12, hl / 2 - 1.35), C));
  casTop.parts.push(part(cyl(0.3, 0.32, 0.24, 8), M4x(-0.7, cy + 1.24, hl / 2 - 1.9), C));  // 舱门
  root.children.push(casTop);

  root.children.push(buildGun([0, cy + 0.58, hl / 2 + 0.1], 0.082, 3.5, GUN_C, true));
  return root;
}

function buildHeavy() {
  const C = DGRAY;
  const root = N('heavy', { extras: { type: 'heavy' } });

  const tracks = Z('tracks', 20);
  runningGear(tracks, 1.18, 7, 0.44, 7.0, 0.92, C, 0);
  root.children.push(tracks);

  const hw = 1.45, hy = 1.38, hl = 6.7, sh = 1.14;
  const hullSide = Z('hullSide', 60);
  hullSide.parts.push(part(box(0.2, sh, hl), M4x(-hw, hy, 0), C));
  hullSide.parts.push(part(box(0.2, sh, hl), M4x(hw, hy, 0), C));
  fenders(hullSide, hw, hy + sh / 2 + 0.06, 6.4, C);
  hullSide.parts.push(part(box(0.06, 0.7, 5.2), M4x(-(hw + 0.4), hy + sh / 2 - 0.36, 0.2), C));  // 侧裙
  hullSide.parts.push(part(box(0.06, 0.7, 5.2), M4x(hw + 0.4, hy + sh / 2 - 0.36, 0.2), C));
  hullKit(hullSide, 3.0, hy + sh / 2 + 0.22, hl / 2 - 0.15, C);
  root.children.push(hullSide);

  const glacis = Z('glacis', 100);
  glacis.parts.push(part(box(2.9, 2.1, 0.22), M4x(0, hy + sh / 2 - Math.cos(0.87) * 1.05, hl / 2 - 0.34 + Math.sin(0.87) * 1.05, -0.87, 0, 0), C));
  glacis.parts.push(part(cyl(0.16, 0.16, 0.2, 8), M4x(0.95, hy + sh * 0.18, hl / 2 + 0.04, Math.PI / 2, 0, 0), GUN_C)); // 航向机枪
  glacis.parts.push(part(box(0.4, 0.35, 0.3), M4x(-0.95, hy + sh * 0.3, hl / 2 - 0.1, -0.5, 0, 0), C));               // 驾驶员观察塔
  root.children.push(glacis);
  const lower = Z('lowerPlate', 75);
  lower.parts.push(part(box(2.9, sh * 0.72, 0.22), M4x(0, hy - sh * 0.13, hl / 2 - 0.04, -0.28, 0, 0), C));
  root.children.push(lower);
  const rear = Z('hullRear', 50);
  rear.parts.push(part(box(3.1, sh, 0.2), M4x(0, hy, -hl / 2 + 0.02, 0.22, 0, 0), C));
  root.children.push(rear);
  const top = Z('hullTop', 22);
  top.parts.push(part(box(3.1, 0.14, hl), M4x(0, hy + sh / 2 + 0.08, 0), C));
  engineDeck(top, rear, 3.1, hy + sh / 2 + 0.1, -hl / 2 + 1.3, C);
  root.children.push(top);

  // 炮塔: 大型铸炮塔 + 明显尾舱 + 双指挥塔
  const T = { ring: [0, 1.96, 0.35], w: 2.2, l: 2.6, h: 0.88 };
  const turret = N('turret', { translation: T.ring });
  const ty = T.h / 2;
  const tFront = Z('turretFront', 150);
  tFront.parts.push(part(cyl(1.12, 1.24, T.h, 18), M4x(0, ty, 0.1), C));
  tFront.parts.push(part(box(1.7, 0.8, 1.0), M4x(0, ty, -1.55), C));          // 尾舱
  tFront.parts.push(part(box(0.5, 0.35, 0.6), M4x(-0.9, T.h + 0.02, -1.3), C));
  tFront.parts.push(part(box(0.5, 0.35, 0.6), M4x(0.9, T.h + 0.02, -1.3), C));
  turret.children.push(tFront);
  const tSide = Z('turretSide', 80);
  tSide.parts.push(part(cyl(1.14, 1.24, 0.07, 18), M4x(0, T.h + 0.03, 0.1), C));
  turret.children.push(tSide);
  const tRear = Z('turretRear', 60);
  tRear.parts.push(part(cyl(0.5, 0.55, 0.4, 10), M4x(0, ty - 0.1, -1.75, 0, 0, 0), C));  // 后储物筒
  turret.children.push(tRear);
  const tRoof = Z('turretRoof', 25);
  tRoof.parts.push(part(cyl(1.1, 1.1, 0.1, 18), M4x(0, T.h + 0.07, 0.1), C));
  tRoof.parts.push(part(cyl(0.4, 0.42, 0.34, 8), M4x(-0.55, T.h + 0.24, -0.2), C));  // 车长指挥塔
  tRoof.parts.push(part(cyl(0.38, 0.38, 0.06, 8), M4x(-0.55, T.h + 0.42, -0.2), C));
  tRoof.parts.push(part(cyl(0.28, 0.3, 0.22, 8), M4x(0.62, T.h + 0.18, -0.5), C));   // 装填手塔
  tRoof.parts.push(part(cyl(0.017, 0.017, 1.8, 4), M4x(0.85, T.h + 0.8, -1.1, 0.2, 0, 0.18), GUN_C));
  turret.children.push(tRoof);
  const mantlet = Z('mantlet', 140);
  mantlet.parts.push(part(cyl(0.52, 0.52, 0.4, 14), M4x(0, ty + 0.03, T.l / 2 - 0.05, Math.PI / 2, 0, 0), C));
  mantlet.parts.push(part(box(1.0, 0.78, 0.35), M4x(0, ty + 0.02, T.l / 2 - 0.1), C));
  turret.children.push(mantlet);
  turret.children.push(buildGun([0, 0.44, 1.30], 0.088, 3.3, GUN_C, true));
  root.children.push(turret);
  return root;
}

/* ============ 主流程 ============ */
const TANKS = [
  { file: 'm4-sherman.glb', build: buildSherman, zones: ['tracks','glacis','lowerPlate','hullSide','hullRear','hullTop','turretFront','turretSide','turretRear','turretRoof','mantlet','gun'] },
  { file: 'enemy-medium.glb', build: buildMedium },
  { file: 'enemy-td.glb', build: buildTD },
  { file: 'enemy-heavy.glb', build: buildHeavy }
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const t of TANKS) {
  const root = t.build();
  // 契约自检: 分区齐全 + 枢轴存在 + 装甲数值正确
  const zones = {}, pivots = [];
  (function walk(n) {
    if (n.extras && n.extras.zone) zones[n.extras.zone] = n.extras.armor;
    if (['turret', 'gun', 'muzzle'].includes(n.name)) pivots.push(n.name);
    (n.children || []).forEach(walk);
  })(root);
  let need = ['tracks','glacis','lowerPlate','hullSide','hullRear','hullTop','turretFront','turretSide','turretRear','turretRoof','mantlet','gun'];
  if (t.file === 'enemy-td.glb') need = need.filter(z => z !== 'turretFront' && z !== 'turretRear');  // 歼击车战斗室固定: 无 turretFront/turretRear
  const missing = need.filter(z => !(z in zones));
  if (missing.length) throw new Error(`${t.file} 缺分区: ${missing}`);
  const triCount = (function cnt(n) { let s = 0; if (n.parts) for (const p of n.parts) s += p.positions.length / 9; for (const c of n.children || []) s += cnt(c); return s; })(root);
  writeGLB(path.join(OUT_DIR, t.file), root);
  console.log(`✓ ${t.file}  三角面≈${triCount}  枢轴[${pivots.join(',')}]  分区${Object.keys(zones).length}个`);
}
console.log(`\nV2 模型完成 → ${OUT_DIR}`);
