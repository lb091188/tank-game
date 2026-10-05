#!/usr/bin/env node
// hit-rate-bench.js — 阶段2 门禁①②: 命中判定基线台(GLB 真形状 vs OBB 盒, 同种子同弹幕配对比较)
//
// 为什么存在: 阶段2 把弹-车命中从 THREE Raycaster 打 GLB 部位网格换成 sim-engine 的 3D 线段-OBB
// (Util.rayObb 是 2D XZ slab, 无 pitch/法线/命中点, 不可用 —— 评审修改要求#3)。形状近似必然
// 漂移, 靠固定种子弹幕的命中/击穿/跳弹率配对比较守住 ≤3pp。
//
// 基线侧不是"复刻近似"而是真形状: tools/build-models.js --emit-hit-geo 导出每车型每部位的
// 三角面汤(父空间, 与 GLB 同源同变换), 本台重建 BufferGeometry 网格 + THREE.Raycaster ——
// 与生产 combat.js 旧路径(GRB intersectObjects(tk.parts.zones))几何完全一致(同顶点同树)。
//
// 用法:
//   node tools/build-models.js --emit-hit-geo /tmp/hit-geo.json   (bench 启动时自动执行)
//   node tools/hit-rate-bench.js --judge glb --save tools/hit-rate-baseline.json   # 建基线
//   node tools/hit-rate-bench.js --judge obb                       # 复验(自动对比基线, ≤3pp)
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SEED = 20261006;                  // 独立种子(不与 ai-bench/golden-trace 混流)
const SHOTS_PER_CELL = 26;              // 4 车 × 4 距离 × 5 方位角 × 26 = 2080 弹 ≥2000
const DISTANCES = [60, 100, 175, 260];  // 距离段(m)
const ASPECTS = [0, 45, 90, 180, 270];  // 方位角(0=正面)
const TYPES = ['pz4', 'tiger1', 'stug3', 'is3'];
const DISP_M = 6;                       // 散布(米@100m): 瞄准收敛后的交战量级(过宽则命中样本太少)
const SHOOTER = 'pz4';                  // 射手车(穿深/口径取其 spec.gun)
const PP_TOL = 3.0;                     // 门禁②: 命中/击穿/跳弹率偏差 ≤3 个百分点

/* ---------- 装载(window 垫片 + 真 THREE + simcore/config/sim-engine) ---------- */
globalThis.window = globalThis;
const THREE = (() => {
  new Function('window', 'module', 'exports', 'define',
    fs.readFileSync(path.join(ROOT, 'client/js/vendor/three.min.js'), 'utf8'))(globalThis, undefined, undefined, undefined);
  return globalThis.THREE;
})();
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(SEED);
for (const f of ['simcore.js', 'config.js', 'sim-engine.js'])
  new Function('window', fs.readFileSync(path.join(ROOT, 'client/js', f), 'utf8'))(globalThis);
const SF = globalThis.SF, CFG = SF.CFG, U = SF.Util;
const A = CFG.armor, D2R = Math.PI / 180;

/* ---------- 命中几何: build-models.js --emit-hit-geo → THREE 网格树(与 GLB 同源同变换) ---------- */
const GEO_FILE = '/tmp/hit-geo.json';
execSync(`node ${JSON.stringify(path.join(__dirname, 'build-models.js'))} --emit-hit-geo ${GEO_FILE}`, { stdio: 'pipe' });
const HIT_GEO = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
const geoCache = {};
function buildTankRig(type) {
  if (geoCache[type]) return geoCache[type];
  const g = HIT_GEO[type];
  if (!g) throw new Error('无命中几何: ' + type);
  const root = new THREE.Object3D();
  const mk = (space) => {
    if (space === 'root') return root;
    if (space === 'turret') {
      if (!root.userData.turret) {
        const t = new THREE.Object3D();
        t.position.fromArray(g.turretPivot || [0, 1.5, 0]);
        root.add(t); root.userData.turret = t;
      }
      return root.userData.turret;
    }
    if (space === 'gun') {
      const parent = g.gunParent === 'turret' ? mk('turret') : root;
      if (!parent.userData.gun) {
        const gun = new THREE.Object3D();
        gun.position.fromArray(g.gunPivot || [0, 0.4, 1]);
        parent.add(gun); parent.userData.gun = gun;
      }
      return parent.userData.gun;
    }
    return root;
  };
  const zoneMeshes = [];
  for (const z of g.zones) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(z.positions), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));  // GLB 材质 doubleSided:true → 背面命中同样计入
    mesh.userData = { zone: z.z, armor: z.armor };
    mk(z.p).add(mesh);
    zoneMeshes.push(mesh);
  }
  return geoCache[type] = { root, zoneMeshes, gun: mk('gun'), turret: root.userData.turret };
}
// 与 production probeTank 逐式一致(旧 combat.js 路径): 粗筛包围球 3.6m + Raycaster far=segLen + transformDirection 法线
const ray = new THREE.Raycaster();
function probeGLB(rig, tk, ox, oy, oz, dx, dy, dz, segLen) {
  const cy = tk.y + 1.5;
  const ocx = tk.x - ox, ocy = cy - oy, ocz = tk.z - oz;
  const proj = Math.max(0, Math.min(segLen, ocx * dx + ocy * dy + ocz * dz));
  const qx = ox + dx * proj - tk.x, qy = oy + dy * proj - cy, qz = oz + dz * proj - tk.z;
  if (Math.sqrt(qx * qx + qy * qy + qz * qz) > 3.6) return null;
  rig.root.updateMatrixWorld(true);
  ray.set(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dx, dy, dz));
  ray.far = segLen;
  const hits = ray.intersectObjects(rig.zoneMeshes, false);
  if (!hits.length) return null;
  const h = hits[0];
  return { distance: h.distance, point: { x: h.point.x, y: h.point.y, z: h.point.z },
    zone: h.object.userData.zone, armor: h.object.userData.armor || 0,
    normal: (() => { const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize(); return { x: n.x, y: n.y, z: n.z }; })() };
}

/* ---------- 承弹结算(vehicle.js takeHit 可计算子集, 两种判官共用同一套) ---------- */
function resolve(shooterSpec, tk, hit) {
  const incidence = Math.acos(Math.min(1, Math.max(-1, -(hit.normal.x * hit.ndx + hit.normal.y * hit.ndy + hit.normal.z * hit.ndz))));
  const armor = hit.armor || 0, cal = shooterSpec.gun.cal || 75;
  const over3 = armor > 0 && cal > armor * 3;
  let norm = 5 * D2R;
  if (armor > 0 && cal > armor * 2) norm *= 2;
  const eff = armor / Math.max(Math.cos(Math.max(0, incidence - norm)), 0.05);
  const pen = shooterSpec.gun.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
  const rico = armor > 0 && !over3 && incidence > A.ricochetAngle;
  if (hit.zone === 'gun') return 'gun';
  if (hit.zone === 'tracks') {
    if (rico) return 'bounce';
    return pen >= eff ? 'pen' : 'absorb';
  }
  if (rico) return 'bounce';
  if (pen >= eff) return 'pen';
  return 'nopen';
}

/* ---------- 主流程 ---------- */
function run(judge) {
  Math.random = mulberry32(SEED);
  const shooterSpec = CFG.vehicles[SHOOTER];
  const stats = { shells: 0, hits: 0, pens: 0, bounces: 0, nopens: 0, absorbs: 0, guns: 0 };
  const byDist = {}, byZone = {};
  // 基线台关闭弹量上限(Infinity): 上限是服务器预算缓解, 与弹道/判定语义无关; 台内无 field.update, 弹不消亡
  const field = SF.SimEngine.makeShells({ onCreate() { }, onImpact() { }, onFlight() { }, onKill() { } }, Infinity);
  for (const type of TYPES) {
    const spec = CFG.vehicles[type];
    const rig = judge === 'glb' ? buildTankRig(type) : null;
    const tk = { type, spec, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretYaw: 0, gunPitch: 0 };
    if (judge === 'glb' && rig.turret) rig.turret.rotation.y = U.angDiff(tk.yaw, tk.turretYaw);
    for (const dist of DISTANCES) {
      byDist[dist] = byDist[dist] || { shells: 0, hits: 0, pens: 0 };
      for (const deg of ASPECTS) {
        const phi = deg * D2R;
        const sx = Math.sin(phi) * dist, sz = Math.cos(phi) * dist, sy = tk.y + 2.0;
        // 瞄准目标车体中心高度; 弹向先归一
        let dx = tk.x - sx, dy = (tk.y + 1.1) - sy, dz = tk.z - sz;
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx /= L; dy /= L; dz /= L;
        for (let i = 0; i < SHOTS_PER_CELL; i++) {
          // 散布: 与 combat.js/sim-engine spawn 同式(2 掷/弹, 圆内偏转)
          const sh = field.spawn({ spec: shooterSpec, team: 9 }, { x: sx, y: sy, z: sz }, { x: dx, y: dy, z: dz }, DISP_M);
          if (!sh) { stats.shells++; continue; }   // 弹量上限拒发(不应发生: Infinity) — 防御性计为未命中
          const vlen = Math.sqrt(sh.vel.x ** 2 + sh.vel.y ** 2 + sh.vel.z ** 2);
          const ddx = sh.vel.x / vlen, ddy = sh.vel.y / vlen, ddz = sh.vel.z / vlen;
          const hit = judge === 'glb' ? probeGLB(rig, tk, sx, sy, sz, ddx, ddy, ddz, dist + 8)
            : SF.SimEngine.probeTankOBB(tk, sx, sy, sz, ddx, ddy, ddz, dist + 8);
          stats.shells++;
          byDist[dist].shells++;
          if (!hit) continue;
          stats.hits++;
          byDist[dist].hits++;
          byZone[hit.zone] = (byZone[hit.zone] || 0) + 1;
          const nd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          const kind = resolve(shooterSpec, tk, { ...hit, ndx: ddx / nd, ndy: ddy / nd, ndz: ddz / nd });
          if (process.env.HR_TRACE && kind === 'bounce' && stats.bounces < 12)
            console.error(`  [bounce] ${type} d=${dist} aspect=${deg} zone=${hit.zone} normal=${hit.normal.x.toFixed(2)},${hit.normal.y.toFixed(2)},${hit.normal.z.toFixed(2)} dir=${ddx.toFixed(2)},${ddy.toFixed(2)},${ddz.toFixed(2)}`);
          if (kind === 'pen') { stats.pens++; byDist[dist].pens++; }
          else if (kind === 'bounce') stats.bounces++;
          else if (kind === 'nopen') stats.nopens++;
          else if (kind === 'absorb') stats.absorbs++;
          else if (kind === 'gun') stats.guns++;
        }
      }
    }
  }
  const pct = (n, d) => d > 0 ? Math.round(n / d * 10000) / 100 : 0;
  return {
    seed: SEED, judge, shells: stats.shells,
    hitRate: pct(stats.hits, stats.shells),
    penRate: pct(stats.pens, stats.hits),
    bounceRate: pct(stats.bounces, stats.hits),
    nopenRate: pct(stats.nopens, stats.hits),
    absorbRate: pct(stats.absorbs, stats.hits),
    gunRate: pct(stats.guns, stats.hits),
    zoneRate: Object.fromEntries(Object.entries(byZone).map(([z, n]) => [z, pct(n, stats.hits)])),
    hitByDist: Object.fromEntries(Object.entries(byDist).map(([d, s]) => [d, pct(s.hits, s.shells)])),
    penByDist: Object.fromEntries(Object.entries(byDist).map(([d, s]) => [d, pct(s.pens, s.hits)])),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const judge = argv.includes('--judge') ? argv[argv.indexOf('--judge') + 1] : 'obb';
  const saveIdx = argv.indexOf('--save');
  const t0 = Date.now();
  const r = run(judge);
  console.error(`[${judge}] ${r.shells}弹: 命中${r.hitRate}% 击穿${r.penRate}%(按命中) 跳弹${r.bounceRate}% 未穿${r.nopenRate}% 吸收${r.absorbRate}% 炮管${r.gunRate}%`);
  console.error(`  分区命中: ${JSON.stringify(r.zoneRate)}`);
  console.error(`  分距离命中率: ${JSON.stringify(r.hitByDist)}  击穿率: ${JSON.stringify(r.penByDist)}`);
  if (saveIdx >= 0) {
    fs.writeFileSync(argv[saveIdx + 1], JSON.stringify(r, null, 1));
    console.log(JSON.stringify({ saved: argv[saveIdx + 1], hitRate: r.hitRate, penRate: r.penRate, bounceRate: r.bounceRate }));
    return;
  }
  // 复验: 对基线逐项 ≤3pp(总体三项 + 分距离命中率)
  const BASE = path.join(__dirname, 'hit-rate-baseline.json');
  if (!fs.existsSync(BASE)) { console.error('*** 缺基线 ' + BASE + ', 先 --judge glb --save'); process.exit(1); }
  const b = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const deltas = {};
  let worst = 0, ok = true;
  const cmp = (label, a, bb, tol = PP_TOL) => {
    const d = Math.round((a - bb) * 100) / 100;
    deltas[label] = d;
    if (Math.abs(d) > tol) ok = false;
    worst = Math.max(worst, Math.abs(d));
  };
  // 门禁口径=ask ②「命中/击穿率 ≤3pp」; 跳弹率(设计 §3.2 跳弹表现)与分距离命中率一并硬卡;
  // 分区分布差只打印不上门禁(它受面片→盒的分配漂移影响, 头条三项已覆盖物理口径)。
  cmp('hitRate', r.hitRate, b.hitRate);
  cmp('penRate', r.penRate, b.penRate);
  cmp('bounceRate', r.bounceRate, b.bounceRate);
  for (const d of DISTANCES) cmp('hit@' + d, r.hitByDist[d], b.hitByDist[d]);
  for (const [z, v] of Object.entries(r.zoneRate))
    if (v >= 2 || (b.zoneRate[z] || 0) >= 2) cmp('zone:' + z, v, b.zoneRate[z] || 0, 99);
  console.error(`配对偏差(pp): ${JSON.stringify(deltas)}`);
  console.log(JSON.stringify({ ok, judge, worstPP: worst, deltas, hitRate: r.hitRate, penRate: r.penRate, bounceRate: r.bounceRate }));
  process.exit(ok ? 0 : 1);
}
main();
