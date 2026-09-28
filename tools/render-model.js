#!/usr/bin/env node
// render-model.js — GLB 软渲染预览(零依赖): 解析 build-models 产物 → 画家算法平面着色 → PNG
// 用法: node tools/render-model.js stug3 [yaw度] [输出.png]   (相机在右前 3/4 方向)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const file = process.argv[2] || 'stug3';
const yawDeg = parseFloat(process.argv[3] || '35');
const outFile = process.argv[4] || path.join(__dirname, '..', `preview-${file}.png`);
const buf = fs.readFileSync(path.join(__dirname, '..', 'client', 'assets', 'models', file + '.glb'));

/* ---- GLB 解析(只取 POSITION/COLOR_0/indices + 节点平移) ---- */
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
const acc = (ai) => {
  const a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
  const n = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
  const Arr = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const ab = bin.buffer.slice(off, off + a.count * n * Arr.BYTES_PER_ELEMENT);   // 拷贝切片, 避开对齐限制
  return new Arr(ab);
};
const tris = [];   // { v:[[x,y,z]x3], c:[r,g,b], n:[x,y,z] }
(function walk(nodeIdx, parent) {
  const node = json.nodes[nodeIdx];
  const t = parent.slice();
  if (node.translation) for (let i = 0; i < 3; i++) t[i] += node.translation[i];
  if (node.mesh !== undefined) {
    for (const prim of json.meshes[node.mesh].primitives) {
      const P = acc(prim.attributes.POSITION), C = prim.attributes.COLOR_0 !== undefined ? acc(prim.attributes.COLOR_0) : null;
      const I = acc(prim.indices);
      for (let k = 0; k < I.length; k += 3) {
        const v = [];
        for (let j = 0; j < 3; j++) {
          const ii = I[k + j];
          v.push([P[ii * 3] + t[0], P[ii * 3 + 1] + t[1], P[ii * 3 + 2] + t[2]]);
        }
        const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
        const w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const c = C ? [C[(I[k] + 0) * 3], C[I[k] * 3 + 1], C[I[k] * 3 + 2]] : [0.4, 0.4, 0.4];
        tris.push({ v, c, n });
      }
    }
  }
  for (const ch of node.children || []) walk(ch, t);
})(json.scenes[json.scene || 0].nodes[0], [0, 0, 0]);

/* ---- 相机(右前 3/4) + 透视投影 + 画家算法 ---- */
const W = 960, H = 540;
const yaw = yawDeg * Math.PI / 180, pitch = 0.32, dist = 14.5;
const eye = [Math.sin(yaw) * dist * Math.cos(pitch), 1.4 + Math.sin(pitch) * dist, Math.cos(yaw) * dist * Math.cos(pitch)];
const at = [0, 1.2, 0];
const fwd = at.map((a, i) => a - eye[i]);
const fl = Math.hypot(...fwd); fwd.forEach((v, i) => fwd[i] = v / fl);
const right = [fwd[2], 0, -fwd[0]];                        // fwd×up
const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
const proj = (p) => {
  const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
  const x = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / z * 640 + W / 2;
  const y = H / 2 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z * 640;
  return [x, y, z];
};
const L = [0.45, 0.78, 0.43];
const img = new Float64Array(W * H * 3);
img.fill(0.055);
const depthKey = (t) => t.v.reduce((s, p) => s + Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]), 0) / 3;
tris.sort((a, b) => depthKey(b) - depthKey(a));
for (const t of tris) {
  const pv = t.v.map(proj);
  if (pv.some(p => p[2] < 0.5)) continue;
  const nl = Math.hypot(...t.n) || 1;
  const sh = 0.38 + 0.62 * Math.max(0, (t.n[0] * L[0] + t.n[1] * L[1] + t.n[2] * L[2]) / nl);
  const x0 = Math.max(0, Math.floor(Math.min(pv[0][0], pv[1][0], pv[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(pv[0][0], pv[1][0], pv[2][0])));
  const y0 = Math.max(0, Math.floor(Math.min(pv[0][1], pv[1][1], pv[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(pv[0][1], pv[1][1], pv[2][1])));
  const e = (px, py, a, b) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const area = e(pv[1][0], pv[1][1], pv[0], pv[2]);
  if (Math.abs(area) < 1e-9) continue;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let w0 = e(x + 0.5, y + 0.5, pv[1], pv[2]) / area, w1 = e(x + 0.5, y + 0.5, pv[2], pv[0]) / area;
    if (area < 0) { w0 = -w0; w1 = -w1; }   // 屏幕 y 向下: 兼容两种绕序(先翻符号再算 w2)
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const o = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) img[o + c] = Math.min(1, t.c[c] * sh + 0.05);
  }
}

/* ---- PNG 输出 ---- */
function crc32(b2) {
  let table = crc32.t;
  if (!table) { table = crc32.t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c; } }
  let c = -1; for (let i = 0; i < b2.length; i++) c = (c >>> 8) ^ table[(c ^ b2[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
const chunk = (type, data) => {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
};
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++)
    raw[y * (1 + W * 3) + 1 + x * 3 + c] = Math.round(Math.pow(img[(y * W + x) * 3 + c], 1 / 2.2) * 255);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(outFile, png);
console.log(`✓ ${outFile}  三角面=${tris.length}`);
