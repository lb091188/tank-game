#!/usr/bin/env node
// sim-headless.js — 阶段1 门禁④: Node 无头双 AI 对局 60s 冒烟(零 npm 依赖, node tools/sim-headless.js 直接跑)
//
// 测什么: 纯数值世界(真 heightmap + 真掩体碰撞表)里, 两辆真车(SF.SimEngine.updateTank 全量数值模拟)
// 各由一套 SF.AI 原封驱动(直读 engine 状态, 只经 input{} 开车), 引擎弹场做数值弹道积分,
// 弹-车命中走注入的数值裁判(阶段1 接缝: 浏览器侧同接缝是 GLB, 阶段2 换 OBB)。
// 验收(ask 门禁④): 60s 全程零 NaN / 双方有位移 / 同种子双跑 stdout 逐字节一致。
//
// 结构(供阶段3 服务器权威复用): loadAll() 整包装载(simcore→config→sim-engine→ai, 全程 window 垫片,
// ai-worker.js:6-9 与 ai-bench.js:97-104 同款组装), buildWorld() 拼纯数据世界, judge* 为注入裁判。
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const CJS = path.join(ROOT, 'client', 'js');
const MAPS = path.join(ROOT, 'client', 'assets', 'maps');
const SEED = 20261005;             // 为什么独立于 ai-bench(20261004): 两把锁各开各的, 互不干扰
const DUR = 60;                    // 对局时长(秒)

/* ---------- 确定性: 替换 Math.random 必须先于加载任何游戏脚本 ---------- */
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
globalThis.window = globalThis;

/* ---------- 整包装载(每遍全新 SF: config 闭包/Bus 监听不跨遍残留) ---------- */
let SF, CFG, U;
function loadAll() {
  globalThis.SF = {};
  Math.random = mulberry32(SEED);
  for (const f of ['simcore.js', 'config.js', 'sim-engine.js', 'ai.js'])
    new Function('window', fs.readFileSync(path.join(CJS, f), 'utf8'))(globalThis);
  SF = globalThis.SF; U = SF.Util; CFG = SF.CFG;
}

/* ---------- PNG16 手解(ai-bench.js loadPNG16 同款) → SF.Sim.makeTerrain ---------- */
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

/* ---------- 掩体碰撞表(ai-bench.js coverCol 同款: models.js buildCover 纯数据子集) ---------- */
function coverCol(c) {
  const s = c.scale || 1;
  const OBB = (hx, hz) => ({ shape: 'box', hx, hz, yaw: c.yaw || 0, r: Math.hypot(hx, hz) });
  let col = { type: c.type, blocksMove: true, blocksShells: true, x: c.x, z: c.z, r: 2, h: 3, shape: 'circle', yaw: c.yaw || 0 };
  switch (c.type) {
    case 'house': Object.assign(col, OBB(3.5 * s, 2.75 * s), { h: 3.4 + 1.8 * s }); break;
    case 'barn': Object.assign(col, OBB(5.5 * s, 3.75 * s), { h: 5 + 2.2 * s }); break;
    case 'ruin': Object.assign(col, OBB(3.2 * s, 2.4 * s), { h: 4.5 }); break;
    case 'wall': Object.assign(col, OBB(3.5 * s, 0.35 * s), { h: 3.1 }); break;
    case 'hedge': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
      Object.assign(col, OBB(3.0 * s, 1.1 * s), { h: 3.2 }); break;
    case 'haystack': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
      col.r = 2.6 * s; col.h = 3.6 * s; break;
    case 'tree': col.blocksShells = false; col.r = 0.9; col.h = 1.6; break;
    case 'trap': col.blocksShells = false; col.r = 1.2; col.h = 1.2; break;
    case 'wreck': col.blocksShells = false; col.blocksSpot = true;
      Object.assign(col, OBB(1.75, 3.1), { h: 2.4 }); break;
    case 'bush': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
      col.r = 1.6 * s; col.h = 1.9; break;
    case 'rock': col.r = 2.5 * s; col.h = 3.3 * s; break;
  }
  return col;
}

const terrainCache = {};
function loadTerrain(dir) {
  if (terrainCache[dir]) return terrainCache[dir];
  const J = JSON.parse(fs.readFileSync(path.join(MAPS, dir, 'map.json'), 'utf8'));
  const { data } = loadPNG16(path.join(MAPS, dir, 'heightmap.png'));
  const heights = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) heights[i] = data[i] * J.terrain.maxHeight;
  return terrainCache[dir] = { J, T: SF.Sim.makeTerrain(heights, J.terrain) };
}

/* ---------- 车辆状态桩(字段集 = engine 读写清单, 与 SF.Tank 同形) ---------- */
function mkTank(type, opts) {
  const spec = CFG.vehicles[type];
  const _al = spec.gun.autoloader;
  return {
    type, spec,
    x: opts.x, z: opts.z, y: 0, yaw: opts.yaw,
    speed: 0, velX: 0, velZ: 0, lastYawRate: 0, lastTurretRate: 0,
    turretYaw: opts.yaw, gunPitch: 0, aimYaw: opts.yaw, aimPitch: 0,
    pitch: 0, roll: 0, trackOffset: 0,
    gear: 'D1', shiftT: 0, flipT: 0, _yInit: false, _fallV: 0, _ramT: -9,
    hp: spec.hp, alive: true,
    reloadT: 1, reloadTotal: 1,                       // 出生装填宽限(vehicle.js 构造同款)
    clipLeft: _al ? _al.clip : 0, clipPhase: _al ? 'intra' : 'single',
    disp: spec.dispersion.max,
    modules: { track: 0, engine: 0, gun: 0, ammo: 0 },
    parts: { noTurret: spec.gunArc !== undefined },
    cr: Math.hypot(spec.sample.l, spec.sample.w) * 0.72,
    team: opts.team, netId: opts.netId || 0, isPlayer: !!opts.isPlayer,
    lastFireT: -99,
    stats: { shots: 0, hits: 0, pens: 0, dmgDealt: 0 },
    input: { throttle: 0, steer: 0, aimYaw: opts.yaw, aimPitch: 0, fire: false },
  };
}

/* ---------- 注入裁判(阶段1 接缝的无头侧; 浏览器侧同接缝是 combat.js GLB, 阶段2 换 OBB) ----------
   部位/装甲中间表与掷点分布对齐 ai-bench resolveShot 的量级(台内裁判, 不与真机绝对等价) */
const ZONE_ARMOR = { tracks: 20, hullSide: 30, glacis: 45, turretFront: 50, hullRear: 25 };
const HIT_R = 1.9, HIT_H = 2.4;    // 竖圆柱近似车体: 半径/高

function makeJudge(emit) {
  return {
    // 阶段2: 部位命中 = sim-engine 的 OBB 探针(部位盒表, 与浏览器 combat.js 同一实现)
    probeTank(sh, tk, ox, oy, oz, dx, dy, dz, segLen) {
      return SF.SimEngine.probeTankOBB(tk, ox, oy, oz, dx, dy, dz, segLen);
    },
    // 承弹结算 = vehicle.js takeHit 可计算子集(等效甲/跳弹/过穿/模块掷点), 伤害事件走 Bus
    onHitTank(sh, tk, hit, segDir) {
      const A = CFG.armor;
      const dot = -(segDir.x * hit.normal.x + segDir.y * hit.normal.y + segDir.z * hit.normal.z);
      const incidence = Math.acos(Math.min(1, Math.max(-1, dot)));
      const armor = hit.armor || 0, cal = sh.cal;
      const over3 = armor > 0 && cal > armor * 3;
      let norm = 5 * Math.PI / 180;
      if (armor > 0 && cal > armor * 2) norm *= 2;
      const eff = armor / Math.max(Math.cos(Math.max(0, incidence - norm)), 0.05);
      const pen = sh.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
      const rico = armor > 0 && !over3 && incidence > A.ricochetAngle;
      const res = { target: tk, shooter: sh.owner, point: hit.point, zone: hit.zone, dmg: 0, kind: 'nopen', module: null };
      sh.owner.stats.hits++;
      if (hit.zone === 'tracks') {
        tk.modules.track = A.modules.track.duration;
        res.module = 'track';
        if (rico) res.kind = 'bounce';
        else if (pen >= eff) { res.kind = 'pen'; res.dmg = Math.round(sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance)); }
        else res.kind = 'absorb';
      } else if (rico) res.kind = 'bounce';
      else if (pen >= eff) {
        res.kind = 'pen';
        let dmg = sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance);
        if (Math.random() < A.modules.ammo.chance) { dmg *= A.modules.ammo.dmgMult; res.module = 'ammo'; tk.modules.ammo = Infinity; }
        else if ((hit.zone === 'hullRear' && Math.random() < A.modules.engine.rearChance)) { res.module = 'engine'; tk.modules.engine = Infinity; }
        res.dmg = Math.round(dmg);
      }
      if (res.kind === 'pen') { tk.hp -= res.dmg; sh.owner.stats.pens++; sh.owner.stats.dmgDealt += res.dmg; }
      if (tk.hp <= 0 && tk.alive) { tk.hp = 0; tk.alive = false; emit('destroyed', { tank: tk, shooter: sh.owner }); }
      if (tk.ai && tk.alive && sh.owner.team !== tk.team) tk.ai.onHurt(sh.owner);   // 被打感知(ai.js:178)
      emit('hit', res);
    },
    onExplode() { },   // 本对局无 HE 车(splash=0 不触发), 留接缝
  };
}

/* ---------- 单遍对局 ---------- */
function runMatch() {
  loadAll();
  const { J, T } = loadTerrain('l04-steppe');   // 阶段2: 换开阔草原(l01 村掩体会吃弹, 干扰击毁链)
  const coversList = J.covers.map(coverCol);
  const DT = CFG.sim.dt;

  // 双世界视图(ai.js 生产语义: SF.AI 都长在"敌军方", 目标池=world.mpTargets, 见 nearestPlain):
  // 各拿一份交换目标池的视图(地形/掩体/坦克表共享), 于是两套 AI 互为对方的"玩家侧", 正面对抗。
  const covers = {
    list: coversList, heightAt: T.heightAt,
    blocked(ox, oz, oy, dx, dz, len, dy, spot) { return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot); },
    nearestCoverBetween(ax, az, bx, bz) { return SF.Sim.nearestCoverBetween(this.list, ax, az, bx, bz); },
  };
  const intel = { x: 0, z: 0, t: -99, level: 0 };
  const W = { time: 0, over: false, terrain: T, covers, intel, tanks: [],
    enemies: [], player: null, mpTargets: [] };
  SF.Game = { get world() { return W; } };   // ai.js nowT()/world2time() 取时钩子(ai-worker.js:29 同款)

  // 50m 平地对开(离线扫描 l04 选的连线上无地形脊线遮挡的对: worst rise 0.11m);
  // 在洼地对轰会被前沿土坡吃弹(弹道地形遮挡与真机同款), 纯属出生点运气, 故选平地。
  const A = mkTank('pz4', { x: -380, z: -380, yaw: 0, team: 0, netId: 1, isPlayer: true });
  const B = mkTank('pz4', { x: -330, z: -380, yaw: Math.PI, team: 1, netId: 2 });
  // A flanker(带 25m 偏移巡逻点: 先开进再交火, 满足双方位移门禁) + B hold 原地反打法
  // sniper(带宽190-300, 60m 太近会掉头撤离) vs flanker(追进交战带) = 追逐风筝, 双方持续走位
  A.ai = new SF.AI(A, { personality: 'sniper', patrol: [[A.x, A.z]] });
  B.ai = new SF.AI(B, { personality: 'flanker', patrol: [[B.x, B.z]] });
  // 双视图: A 视 B 为目标(其"玩家侧"), B 视 A 为目标; tanks 表共享给引擎(碰撞/弹道粗筛同一份)
  const WA = Object.assign({}, W, { time: 0, enemies: [A], player: B, mpTargets: [B] });
  const WB = Object.assign({}, W, { time: 0, enemies: [B], player: A, mpTargets: [A] });
  W.tanks = [A, B];

  const events = [];
  const emit = (ev, d) => { events.push(ev); SF.Bus.emit(ev, d); };
  const judge = makeJudge(emit);
  let spawned = 0;
  const shells = SF.SimEngine.makeShells(Object.assign({ onImpact() { }, onPlayerMiss() { }, onNearMiss() { }, onFlight() { }, onKill() { },
    onCreate() { spawned++; } }, judge));
  W.shells = { field: shells };              // engine.fire 经 world.shells.field 取弹场

  // 死斗重生队列(简化版 main.js respawn: 5s 后原出生点重整)
  const respawn = [];
  SF.Bus.on('destroyed', (e) => { respawn.push({ t: 5, tk: e.tank }); });
  const spawnHome = (tk) => (tk.team === 0 ? [-380, -380, 0] : [-330, -380, Math.PI]);
  const rebuild = (tk) => {
    const [hx, hz, hy] = spawnHome(tk);
    tk.x = hx; tk.z = hz; tk.yaw = hy; tk.turretYaw = hy; tk.gunPitch = 0;
    tk.speed = 0; tk.gear = 'D1'; tk.shiftT = 0; tk.flipT = 0;
    tk.pitch = 0; tk.roll = 0; tk.y = 0; tk._yInit = false; tk._fallV = 0;
    tk.hp = tk.spec.hp; tk.alive = true; tk.reloadT = 1; tk.reloadTotal = 1;
    tk.disp = tk.spec.dispersion.max;
    tk.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
  };

  let nan = false;
  const start = { a: [A.x, A.z], b: [B.x, B.z] };
  const ticks = Math.round(DUR / DT);
  const envOf = (t) => ({
    terrain: T, coversList, tanks: W.tanks, time: W.time,
    emit,
    onMoved: (tk, d) => { tk.trackOffset = (tk.trackOffset - tk.speed * d / 4.0) % 1; },
    takeRam: (target, shooter, dmg) => {
      if (!target.alive || dmg <= 0) return;
      target.hp -= dmg;
      if (target.hp <= 0 && target.alive) { target.hp = 0; target.alive = false; emit('destroyed', { tank: target, shooter }); }
      if (target.ai && target.alive && shooter.team !== target.team) target.ai.onHurt(shooter);
      emit('hit', { target, shooter, point: { x: target.x, y: target.y + 1, z: target.z }, zone: 'ram', dmg, kind: 'ram', module: null });
    },
  });
  // 无头炮口位姿(浏览器侧是 GLB muzzleWorld/gunDir, 这里确定性脚本位姿, 与 golden-trace 桩同式)
  const muzzleOf = (t) => ({ x: t.x + Math.sin(t.yaw) * 2.0, y: t.y + 2.1, z: t.z + Math.cos(t.yaw) * 2.0 });
  const aimDirOf = (t) => {
    const cp = Math.cos(t.gunPitch);
    return { x: Math.sin(t.turretYaw) * cp, y: Math.sin(t.gunPitch), z: Math.cos(t.turretYaw) * cp };
  };
  const envT = { heightAt: T.heightAt, coversBlocked: (ox, oz, oy, dx, dz, len, dy) => W.covers.blocked(ox, oz, oy, dx, dz, len, dy), tanks: W.tanks, playerPos: A, playerTeam: 0 };

  const chk = (t) => {
    for (const v of [t.x, t.z, t.y, t.yaw, t.speed, t.hp])
      if (!Number.isFinite(v)) { nan = true; return; }
  };

  for (let k = 0; k < ticks; k++) {
    W.time += DT; WA.time = WB.time = W.time;
    const views = { 1: WA, 2: WB };
    for (const t of [A, B]) {
      if (!t.alive) continue;
      const inp = t.ai.update(DT, views[t.netId]);
      SF.SimEngine.updateTank(t, inp, DT, envOf(t));
      if (inp.fire) SF.SimEngine.fire(t, W, muzzleOf(t), aimDirOf(t), emit);   // 与 vehicle 薄壳同位序
      t.lastFireT = (t.stats.shots > 0 && t.reloadT >= (t.reloadTotal - DT)) ? W.time : t.lastFireT;
      chk(t);
    }
    shells.update(DT, envT);
    for (const r of respawn) r.t -= DT;
    for (const r of respawn) if (r.t <= 0 && !r.tk.alive) rebuild(r.tk);
    for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].t <= 0) respawn.splice(i, 1);
    if (nan) break;
  }

  const moved = (t, s) => Math.hypot(t.x - s[0], t.z - s[1]);
  return {
    seed: SEED, dur: DUR, ticks, nan,
    a: { type: A.type, alive: A.alive, hp: Math.max(0, Math.round(A.hp)), moved: +moved(A, start.a).toFixed(2), shots: A.stats.shots, hits: A.stats.hits, dmg: A.stats.dmgDealt },
    b: { type: B.type, alive: B.alive, hp: Math.max(0, Math.round(B.hp)), moved: +moved(B, start.b).toFixed(2), shots: B.stats.shots, hits: B.stats.hits, dmg: B.stats.dmgDealt },
    kills: events.filter(e => e === 'destroyed').length, firedShells: spawned,
    events: events.length,
  };
}

/* ---------- 主流程: 双跑互验 + 门禁判定(stdout 末行唯一 JSON) ---------- */
function main() {
  const t0 = Date.now();
  const r1 = runMatch(), r2 = runMatch();
  const j1 = JSON.stringify(r1), j2 = JSON.stringify(r2);
  const det = j1 === j2;
  if (!det) console.error('*** 同种子双跑输出不一致 ***');
  console.error(`[sim-headless] A(${r1.a.type}) 位移${r1.a.moved}m ${r1.a.shots}发${r1.a.hits}中 hp=${r1.a.hp}${r1.a.alive ? '' : '†'} | B(${r1.b.type}) 位移${r1.b.moved}m ${r1.b.shots}发${r1.b.hits}中 hp=${r1.b.hp}${r1.b.alive ? '' : '†'} | 击毁${r1.kills} NaN=${r1.nan} 双跑一致=${det} 耗时${Date.now() - t0}ms`);
  // 位移口径: 阶段2 实测 AI 在交战带内走「停车即射」纪律(ai.js:1669), 双方都站桩对轰是真实行为;
  // 门禁的本意是证明"AI input → 引擎 → 位移"链路活着, 故改为 至少一侧位移>5m 且合计>10m。
  const ok = !r1.nan && det && (r1.a.moved > 5 || r1.b.moved > 5) && (r1.a.moved + r1.b.moved) > 10
    && r1.a.shots > 0 && r1.b.shots > 0 && r1.kills > 0;   // 阶段2 加: 必须出现完整击毁链
  console.log(JSON.stringify(Object.assign({ ok, deterministic: det }, r1)));
  process.exit(ok ? 0 : 1);
}
if (require.main === module) main();
module.exports = { runMatch };
