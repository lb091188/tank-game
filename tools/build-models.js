#!/usr/bin/env node
// build-models.js — 程序化生成四型坦克 GLB 模型文件（零 npm 依赖）
// 用法: node tools/build-models.js
// 输出: client/assets/models/{m4-sherman, enemy-medium, enemy-td, enemy-heavy}.glb
//
// 引擎契约（引擎 raycast 与本文件必须保持一致）:
//   节点层级: root → [部位网格节点..., turret(枢轴) → [炮塔部位..., gun(枢轴) → [barrel, muzzle]]]
//   部位节点名 = 装甲分区名, extras: { zone, armor(毫米, 垂直厚度; 等效由命中角计算) }
//   分区: glacis首上 lowerPlate首下 hullSide hullRear hullTop tracks
//         turretFront turretSide turretRear turretRoof mantlet炮盾 gun火炮(armor=0→火炮损伤)
//   歼击车无 turret 枢轴（战斗室固定, gun 直挂 root, 由车体转向瞄准）
//   坐标: +Z 车头方向, Y 上; 单位米
'use strict';
const fs = require('fs');
const path = require('path');
const THREE = require('../client/js/vendor/three.min.js');

const OUT_DIR = path.join(__dirname, '..', 'client', 'assets', 'models');

/* ============ 最小 GLB (glTF 2.0 binary) 编码器 ============ */

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

  function addMaterial(name, rgb) {
    materials.push({
      name,
      pbrMetallicRoughness: { baseColorFactor: [rgb[0], rgb[1], rgb[2], 1], metallicFactor: 0.1, roughnessFactor: 0.85 },
      doubleSided: true
    });
    return materials.length - 1;
  }

  // 收集节点树: 每个“部位节点”持有一个网格(parts 合并)
  function emitNode(node) {
    const glNode = { name: node.name };
    if (node.extras) glNode.extras = node.extras;
    if (node.translation) glNode.translation = node.translation;
    if (node.parts && node.parts.length) {
      const pos = [], nor = [], idx = [];
      for (const p of node.parts) {
        const base = pos.length / 3;
        for (let i = 0; i < p.positions.length; i++) { pos.push(p.positions[i]); nor.push(p.normals[i]); }
        for (let i = 0; i < p.positions.length / 3; i++) idx.push(base + i);
      }
      const posArr = new Float32Array(pos), norArr = new Float32Array(nor);
      const idxArr = idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      const posAcc = addAccessor(posArr, 5126, 'VEC3', posArr.length / 3, true);
      const norAcc = addAccessor(norArr, 5126, 'VEC3', norArr.length / 3, false);
      const idxAcc = addAccessor(idxArr, idxArr instanceof Uint32Array ? 5125 : 5123, 'SCALAR', idxArr.length, false);
      const matIdx = addMaterial(node.name, node.parts[0].color);
      meshes.push({ primitives: [{ attributes: { POSITION: posAcc, NORMAL: norAcc }, indices: idxAcc, material: matIdx }] });
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

  // bin 补齐 4 字节
  const tailPad = (4 - (binLength % 4)) % 4;
  if (tailPad) { binChunks.push(new Uint8Array(tailPad)); binLength += tailPad; }

  const json = {
    asset: { version: '2.0', generator: 'steel-front tools/build-models.js' },
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
  out.writeUInt32LE(0x46546c67, o); o += 4;          // magic "glTF"
  out.writeUInt32LE(2, o); o += 4;                    // version
  out.writeUInt32LE(total, o); o += 4;                // total length
  out.writeUInt32LE(jsonBuf.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4;           // "JSON"
  jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(binBuf.length, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4;           // "BIN\0"
  binBuf.copy(out, o);
  fs.writeFileSync(filePath, out);
}

/* ============ 几何工具 ============ */

function N(name, opts = {}) {
  return { name, translation: opts.translation, extras: opts.extras, parts: [], children: opts.children || [] };
}

// 把一个 three 几何体(带变换矩阵)转为部件
function part(geo, m, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (m) g = g.clone().applyMatrix4(m);
  return { positions: Array.from(g.attributes.position.array), normals: Array.from(g.attributes.normal.array), color };
}

const M4 = (x, y, z, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

/* ============ 坦克建造器 ============ */
// spec: {
//   hull: {w,l,sideH,y}, glacis:{len,ang,armor}, lower:{armor}, sideArmor, rearArmor, topArmor,
//   turret: {ring:[x,y,z], w,l,h, frontArmor, sideArmor, rearArmor} | null(歼击车),
//   gun: {pivot:[x,y,z], r, len, brake}, tracks:{w,h,l,y}, colors:{body,track,gun}
// }
function buildTank(spec) {
  const root = N(spec.name, { extras: { type: spec.type } });
  const c = spec.colors;

  // --- 履带(含负重轮) ---
  const tracks = N('tracks', { extras: { zone: 'tracks', armor: 20 } });
  const halfW = spec.hull.w / 2 + 0.16;
  for (const sx of [-1, 1]) {
    tracks.parts.push(part(box(spec.tracks.w, spec.tracks.h, spec.tracks.l), M4(sx * halfW, spec.tracks.y, 0), c.track));
    for (let i = 0; i < 5; i++) {
      const wz = -spec.tracks.l / 2 + 1.1 + i * ((spec.tracks.l - 2.2) / 4);
      tracks.parts.push(part(cyl(0.40, 0.40, spec.tracks.w + 0.06, 10), M4(sx * halfW, 0.40, wz, 0, 0, Math.PI / 2), c.track));
    }
  }
  root.children.push(tracks);

  // --- 车体板(分区) ---
  const H = spec.hull;
  const glacis = N('glacis', { extras: { zone: 'glacis', armor: spec.glacis.armor } });
  const ga = -spec.glacis.ang; // 首上向后倾斜(法线朝前上)
  glacis.parts.push(part(box(H.w, spec.glacis.len, 0.18), M4(0, H.y + H.sideH / 2 - Math.cos(spec.glacis.ang) * spec.glacis.len / 2, H.l / 2 - 0.35 + Math.sin(spec.glacis.ang) * spec.glacis.len / 2, ga, 0, 0), c.body));
  root.children.push(glacis);

  const lower = N('lowerPlate', { extras: { zone: 'lowerPlate', armor: spec.lower.armor } });
  lower.parts.push(part(box(H.w, H.sideH * 0.72, 0.18), M4(0, H.y - H.sideH * 0.14, H.l / 2 - 0.02, -0.26, 0, 0), c.body));
  root.children.push(lower);

  const side = N('hullSide', { extras: { zone: 'hullSide', armor: spec.sideArmor } });
  for (const sx of [-1, 1]) side.parts.push(part(box(0.18, H.sideH, H.l), M4(sx * (H.w / 2), H.y, 0), c.body));
  root.children.push(side);

  const rear = N('hullRear', { extras: { zone: 'hullRear', armor: spec.rearArmor } });
  rear.parts.push(part(box(H.w, H.sideH, 0.18), M4(0, H.y, -H.l / 2 + 0.02, 0.2, 0, 0), c.body));
  root.children.push(rear);

  const top = N('hullTop', { extras: { zone: 'hullTop', armor: spec.topArmor } });
  top.parts.push(part(box(H.w, 0.14, H.l), M4(0, H.y + H.sideH / 2 + 0.06, 0), c.body));
  root.children.push(top);

  // --- 炮塔(歼击车无) ---
  if (spec.turret) {
    const T = spec.turret;
    const turret = N('turret', { translation: T.ring });
    const ty = T.h / 2;

    const tFront = N('turretFront', { extras: { zone: 'turretFront', armor: T.frontArmor } });
    tFront.parts.push(part(box(T.w, T.h, 0.18), M4(0, ty, T.l / 2 - 0.05), c.body));
    turret.children.push(tFront);

    const tSide = N('turretSide', { extras: { zone: 'turretSide', armor: T.sideArmor } });
    for (const sx of [-1, 1]) tSide.parts.push(part(box(0.16, T.h, T.l), M4(sx * (T.w / 2), ty, 0), c.body));
    turret.children.push(tSide);

    const tRear = N('turretRear', { extras: { zone: 'turretRear', armor: T.rearArmor } });
    tRear.parts.push(part(box(T.w, T.h, 0.16), M4(0, ty, -T.l / 2 + 0.05), c.body));
    turret.children.push(tRear);

    const tRoof = N('turretRoof', { extras: { zone: 'turretRoof', armor: 25 } });
    tRoof.parts.push(part(box(T.w, 0.12, T.l), M4(0, T.h + 0.05, 0), c.body));
    // 指挥塔
    tRoof.parts.push(part(cyl(0.34, 0.36, 0.24, 10), M4(T.w * 0.28, T.h + 0.22, -T.l * 0.18), c.body));
    turret.children.push(tRoof);

    const mantlet = N('mantlet', { extras: { zone: 'mantlet', armor: T.mantletArmor } });
    mantlet.parts.push(part(box(0.95, 0.68, 0.3), M4(0, ty + 0.02, T.l / 2 + 0.08), c.body));
    turret.children.push(mantlet);

    turret.children.push(buildGun(spec.gun, c));
    root.children.push(turret);
  } else {
    // 歼击车: 战斗室固定, 火炮直挂车体
    const cas = N('mantlet', { extras: { zone: 'mantlet', armor: spec.casemateArmor } });
    cas.parts.push(part(box(H.w * 0.8, 1.0, 0.24), M4(0, H.y + H.sideH / 2 + 0.5, H.l / 2 - 0.1, -0.35, 0, 0), c.body));
    // 战斗室侧/顶板(并入相邻分区, 不新增分区名)
    const casSide = N('turretSide', { extras: { zone: 'turretSide', armor: 45 } });
    for (const sx of [-1, 1]) casSide.parts.push(part(box(0.16, 1.05, 2.4), M4(sx * (H.w * 0.4), H.y + H.sideH / 2 + 0.5, H.l / 2 - 1.3), c.body));
    const casTop = N('turretRoof', { extras: { zone: 'turretRoof', armor: 20 } });
    casTop.parts.push(part(box(H.w * 0.85, 0.12, 2.6), M4(0, H.y + H.sideH / 2 + 1.02, H.l / 2 - 1.3), c.body));
    root.children.push(cas, casSide, casTop);
    root.children.push(buildGun(spec.gun, c));
  }
  return root;
}

function buildGun(g, c) {
  const gun = N('gun', { translation: g.pivot });
  const barrel = N('barrel', { extras: { zone: 'gun', armor: 0 } });
  barrel.parts.push(part(cyl(g.r, g.r, g.len, 8), M4(0, 0, g.len / 2, Math.PI / 2, 0, 0), c.gun));
  if (g.brake) barrel.parts.push(part(cyl(g.r + 0.04, g.r + 0.04, 0.3, 8), M4(0, 0, g.len - 0.14, Math.PI / 2, 0, 0), c.gun));
  const muzzle = N('muzzle', { translation: [0, 0, g.len + 0.1] }); // 炮口点(空节点, 引擎取炮口位置/方向)
  gun.children.push(barrel, muzzle);
  return gun;
}

/* ============ 四型坦克定义 ============ */

const OLIVE = [0.34, 0.35, 0.23], GRAY = [0.30, 0.31, 0.34], DGRAY = [0.24, 0.25, 0.27], YGRAY = [0.42, 0.39, 0.28];
const TRACK_C = [0.13, 0.13, 0.13], GUN_C = [0.18, 0.18, 0.16];

const TANKS = [
  {
    // 玩家: M4 谢尔曼(75) — 首上 51mm@47°, 等效≈75; 侧面 38 是明显弱点
    file: 'm4-sherman.glb', type: 'sherman',
    colors: { body: OLIVE, track: TRACK_C, gun: GUN_C },
    hull: { w: 2.62, l: 5.9, sideH: 1.02, y: 1.30 },
    glacis: { len: 1.9, ang: 0.82, armor: 51 },
    lower: { armor: 64 }, sideArmor: 38, rearArmor: 38, topArmor: 19,
    turret: { ring: [0, 1.86, 0.45], w: 1.9, l: 2.2, h: 0.76, frontArmor: 76, sideArmor: 50, rearArmor: 50, mantletArmor: 89 },
    gun: { pivot: [0, 0.40, 1.10], r: 0.075, len: 2.6, brake: true },
    tracks: { w: 0.58, h: 0.84, l: 6.15, y: 0.42 }
  },
  {
    // 敌中型坦克 — 机动接近玩家, 首上 60@30° 等效≈69(玩家 95 穿深可穿), 火力 95/150
    file: 'enemy-medium.glb', type: 'medium',
    colors: { body: GRAY, track: TRACK_C, gun: GUN_C },
    hull: { w: 2.90, l: 6.3, sideH: 1.06, y: 1.32 },
    glacis: { len: 1.7, ang: 0.52, armor: 60 },
    lower: { armor: 60 }, sideArmor: 40, rearArmor: 40, topArmor: 20,
    turret: { ring: [0, 1.88, 0.25], w: 2.0, l: 2.4, h: 0.78, frontArmor: 80, sideArmor: 50, rearArmor: 45, mantletArmor: 90 },
    gun: { pivot: [0, 0.41, 1.20], r: 0.070, len: 3.2, brake: false },
    tracks: { w: 0.62, h: 0.88, l: 6.55, y: 0.44 }
  },
  {
    // 敌坦克歼击车 — 战斗室固定, 正面 120(75 炮难穿→教绕侧), 火力 120/280 装填 8s
    file: 'enemy-td.glb', type: 'td',
    colors: { body: YGRAY, track: TRACK_C, gun: GUN_C },
    hull: { w: 2.86, l: 6.4, sideH: 1.0, y: 1.26 },
    glacis: { len: 1.8, ang: 0.78, armor: 80 },
    lower: { armor: 60 }, sideArmor: 45, rearArmor: 40, topArmor: 20,
    turret: null, casemateArmor: 120,
    gun: { pivot: [0, 2.28, 3.02], r: 0.082, len: 3.5, brake: true },
    tracks: { w: 0.62, h: 0.84, l: 6.7, y: 0.42 }
  },
  {
    // 敌重型坦克 — 首上 100@50° 等效≈156(正面不可穿), 首下 75(可穿~60%), 侧面 60 需绕
    file: 'enemy-heavy.glb', type: 'heavy',
    colors: { body: DGRAY, track: TRACK_C, gun: GUN_C },
    hull: { w: 3.10, l: 6.7, sideH: 1.14, y: 1.38 },
    glacis: { len: 2.1, ang: 0.87, armor: 100 },
    lower: { armor: 75 }, sideArmor: 60, rearArmor: 50, topArmor: 22,
    turret: { ring: [0, 1.96, 0.35], w: 2.2, l: 2.6, h: 0.86, frontArmor: 150, sideArmor: 80, rearArmor: 60, mantletArmor: 140 },
    gun: { pivot: [0, 0.45, 1.30], r: 0.088, len: 3.3, brake: true },
    tracks: { w: 0.66, h: 0.92, l: 7.0, y: 0.46 }
  }
];

/* ============ 主流程 ============ */
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const t of TANKS) {
  t.name = t.type;
  const root = buildTank(t);
  const out = path.join(OUT_DIR, t.file);
  writeGLB(out, root);
  const zones = [];
  (function walk(n) { if (n.extras && n.extras.zone) zones.push(`${n.extras.zone}:${n.extras.armor}mm`); (n.children || []).forEach(walk); })(root);
  console.log(`✓ ${t.file}  分区[${zones.join(', ')}]`);
}
console.log(`\n完成: ${TANKS.length} 个模型 → ${OUT_DIR}`);
