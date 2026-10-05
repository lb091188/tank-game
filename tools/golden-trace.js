#!/usr/bin/env node
// golden-trace.js — 阶段1 硬门禁: vehicle.js → sim-engine 提取的行为等价数值对账
//
// 为什么需要它: ai-bench 用自己的 stubUpdate(可计算子集)测 ai.js 决策, 证明不了 vehicle.js
// 平移没走样; sim-headless 只查 NaN/位移/双跑一致, 无基线可比。本工具用固定种子 + 脚本化输入,
// 把【改动前的 vehicle.js】(tools/fixtures/vehicle.golden.js, 提取当日原样快照)逐 tick 状态向量
// 录成基线, 再让【改动后的 vehicle.js(薄壳)+sim-engine】跑同一输入序列, 逐项断言最大偏差 < ε。
//
// 覆盖分支(60s @ 60Hz = 3600 tick × 2 车):
//   直线升挡 / 转向掉速 / 倒车换向(flip 窗口) / 迎面顶掩体(collideTank 推出+顶撞掉速) /
//   车车 OBB 互推 + 撞击伤害(takeRam) / 炮塔伺服 + 歼击车 noTurret ±gunArc 射界 / holdTurret 锁定 /
//   缩圈扩圈 / 弹夹装填(普通+弹药架损毁 rack) / 开炮(散布扩圈+fire 事件) / 坠落摔伤+概率断带 /
//   断带瘫痪 / 发动机损毁减速 / 另含炮弹数值积分对账(combat.js 旧物理循环 vs engine 弹道, 2s 逐 tick)。
//
// 用法: node tools/golden-trace.js [--record]   (--record 仅当 fixtures/golden-trace.json 需重建时用,
//        重录必须以 tools/fixtures/vehicle.golden.js == 改动前 vehicle.js 为前提)
// 退出码: 0 = 记录/复验两侧一致且基线偏差 <ε; 1 = 任何不一致。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const CJS = path.join(ROOT, 'client', 'js');
const FIXTURE = path.join(__dirname, 'fixtures', 'golden-trace.json');
const GOLDEN_VEHICLE = path.join(__dirname, 'fixtures', 'vehicle.golden.js');
const SEED = 20261005;            // 为什么独立于 ai-bench 的 20261004: 两把锁各开各的, 避免同流混淆
const DT = 1 / 60, TICKS = 3600;  // 60s 全程
const EPS = 1e-7;                 // 逐项绝对偏差上限(位级复刻下应为 0, 留浮点余量)

/* ---------- 确定性 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 加载一侧代码(每遍全新 SF + 重置 PRNG) ---------- */
globalThis.window = globalThis;
const aiBench = require('./ai-bench.js');   // 只复用 loadTerrain(PNG16 解码)/coverCol(掩体表); 它自带的
                                            // 脚本预载会被下方 loadSide 重置, 不影响本工具
function loadThree() {
  // three.min.js UMD 在 Node 里会命中 CommonJS 分支(module/exports 泄漏为全局), 显式传 undefined 堵住
  new Function('window', 'module', 'exports', 'define',
    fs.readFileSync(path.join(CJS, 'vendor', 'three.min.js'), 'utf8'))(globalThis, undefined, undefined, undefined);
  return globalThis.THREE;
}
const THREE = loadThree();

function loadSide(mode) {
  globalThis.SF = {};                        // 整包换新: config.js 闭包(SF.Bus 等)不跨遍残留
  Math.random = mulberry32(SEED);
  for (const f of ['simcore.js', 'config.js'])
    new Function('window', fs.readFileSync(path.join(CJS, f), 'utf8'))(globalThis);
  if (mode === 'record') {
    new Function('window', fs.readFileSync(GOLDEN_VEHICLE, 'utf8'))(globalThis);
  } else {
    new Function('window', fs.readFileSync(path.join(CJS, 'sim-engine.js'), 'utf8'))(globalThis);
    new Function('window', fs.readFileSync(path.join(CJS, 'vehicle.js'), 'utf8'))(globalThis);
  }
  const SF = globalThis.SF;

  /* 表现层桩: models.js 不加载, makeTank 给最小桩(位置/旋转吸收写入, 炮口/炮向确定性脚本) */
  const stub = { cur: null };
  SF.Models = { __stub: stub, makeTank(type) {
    const noTurret = SF.CFG.vehicles[type].gunArc !== undefined;
    return {
      root: { position: { set() { } }, rotation: { set() { } }, updateMatrixWorld() { }, traverse() { } },
      turret: { rotation: {} },
      gun: {
        rotation: {},
        getWorldQuaternion(q) {   // 确定性脚本炮向: (turretYaw, gunPitch) → 世界方向(两侧同式)
          const t = stub.cur;
          const d = new THREE.Vector3(Math.sin(t.turretYaw) * Math.cos(t.gunPitch), Math.sin(t.gunPitch), Math.cos(t.turretYaw) * Math.cos(t.gunPitch));
          return q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
        }
      },
      muzzle: { getWorldPosition(p) { const t = stub.cur; p.set(t.x + Math.sin(t.yaw) * 2.0, t.y + 2.1, t.z + Math.cos(t.yaw) * 2.0); return p; } },
      wheels: null, trackTex: null, noTurret, zones: []
    };
  } };

  /* 掩体碰撞桩 = models.js CoverField.collideTank(models.js:573-605)逐行移植:
     记录侧 vehicle 走这里, 复验侧 vehicle 走 engine 内的移植件 —— 两份实现若漂移即被对账抓出 */
  function collideTank(t, list) {
    let nx = t.x, nz = t.z;
    const S = t.spec, hw = S.sample.w, hl = S.sample.l;
    const circ = Math.hypot(hw, hl);
    const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
    for (const c of list) {
      if (!c.blocksMove) continue;
      const dx0 = nx - c.x, dz0 = nz - c.z, rr = c.r + circ;
      if (dx0 * dx0 + dz0 * dz0 > rr * rr) continue;
      if (c.shape === 'box') {
        const push = SF.Util.obbPushOut({ x: nx, z: nz, yaw: t.yaw, hx: hw, hz: hl }, c);
        if (push) { nx += push[0]; nz += push[1]; }
      } else {
        const rx = c.x - nx, rz = c.z - nz;
        let lx = cs * rx - sn * rz, lz = sn * rx + cs * rz;
        const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hl, Math.min(hl, lz));
        let ddx = lx - qx, ddz = lz - qz;
        let d = Math.hypot(ddx, ddz);
        if (d < 1e-6) {
          const bx = nx - c.x, bz = nz - c.z, bl = Math.hypot(bx, bz) || 1;
          nx += bx / bl * (c.r + hl); nz += bz / bl * (c.r + hl);
          continue;
        }
        if (d < c.r) {
          const k = (c.r - d) / d;
          const px2 = -ddx * k, pz2 = -ddz * k;
          nx += cs * px2 + sn * pz2; nz += -sn * px2 + cs * pz2;
        }
      }
    }
    return [nx, nz];
  }

  return { SF, collideTank, stub };
}

/* ---------- 脚本化输入(纯 tick 的确定函数, 不掷骰) ----------
   会合段(1200-1800)主车按搭档车当前位置追击(两侧同函数同世界 → 同轨迹):
   追击保证 OBB 相触且逼近速度>4m/s → 车车互推+撞击伤害(takeRam)分支确定走到 */
function mainInput(k, main, partner, T) {
  const i = { throttle: 0, steer: 0, aimYaw: 0.35, aimPitch: 0, fire: false, holdTurret: false };
  if (k < 540) i.throttle = 1;                                   // 直线升挡 D1→D3
  else if (k < 900) { i.throttle = 1; i.steer = 0.6; }           // 转向掉速
  else if (k < 1200) i.throttle = -1;                            // 倒车换向(flip 全扭矩窗口)
  else if (k < 1500) {                                           // 追击搭档车(迎面 OBB 互推/顶撞/撞伤)
    i.throttle = 1;
    const want = Math.atan2(partner.x - main.x, partner.z - main.z);
    i.steer = SF.Util.clamp(SF.Util.angDiff(main.yaw, want) * 2.5, -1, 1);
    i.aimYaw = want;
  }
  else if (k < 1800) { i.throttle = 1; i.steer = 0; }            // 冲崖直行(1500 已被传送到崖沿, 朝 +z 沟对岸)
  else if (k < 2400) { i.throttle = 0.5; i.steer = 0.8; }
  else if (k < 3000) { i.throttle = 1; }
  else { i.throttle = -0.6; i.steer = -1; }                      // 倒车满舵
  if (k < 1200) { i.aimYaw = 0.35 + 0.8 * Math.sin(k * 0.004); i.aimPitch = 0.1 * Math.sin(k * 0.002 + 1); }
  if (k >= 700 && k < 900) i.holdTurret = true;                  // 右键锁定分支(带转向, 车体转动炮塔随动)
  if (k % 150 === 100) i.fire = true;                            // 装填好了就开(散布/弹夹/rack 全走到)
  return i;
}
function partnerInput(k) {
  return { throttle: k % 400 < 200 ? 0.2 : 0, steer: -0.4, aimYaw: Math.PI + 0.6 * Math.sin(k * 0.003),
           aimPitch: 0.05 * Math.cos(k * 0.002), fire: k % 300 === 150, holdTurret: false };
}

/* ---------- 阶梯台地(确定性固定几何, 远离出生/追击区): A 台顶+8, 断层 7m, B 台顶+6。
   坠落落地结算(vehicle.js:227 `y<=targetY`)要求 fallV*dt 一步跨过剩余 gap —— 60Hz 下数学上不可达
   (需 >72m/s; 地图高程上限 70m 时落地 v≈52m/s), 该分支在真实游戏里只在掉帧(dt 飙升)时触发;
   故坠落段(k=1500..1560)用 dt=0.1 跑(两侧同参同注入, 对账有效性不受影响), 并只垫高 heightAt
   (slopeAhead/gradAt 仍看真实坡度 → 无爬坡门/滑坡干扰); 台面区远离其余剧情段, 区外 heightAt 全等 */
const BUMP = { ax0: 330, ax1: 340, az0: -40, az1: -25, aTop: 8, bz0: -18, bz1: -2, bTop: 5 };
function makeBumpT(T) {
  const zone = (x, z) => {
    if (x >= BUMP.ax0 && x <= BUMP.ax1 && z >= BUMP.az0 && z <= BUMP.az1) return BUMP.aTop;
    if (x >= BUMP.ax0 && x <= BUMP.ax1 && z >= BUMP.bz0 && z <= BUMP.bz1) return BUMP.bTop;
    return 0;
  };
  const h0 = T.heightAt;
  return Object.assign({}, T, { heightAt: (x, z) => h0(x, z) + zone(x, z) });
}

/* ---------- 单遍运行 ---------- */
function run(mode) {
  const rec = { mode, dt: DT, ticks: TICKS, fields: null, frames: [], events: [], shells: [], flight: [] };
  const { SF, collideTank, stub } = loadSide(mode);
  const U = SF.Util, CFG = SF.CFG;
  const { T } = aiBench.loadTerrain('l04-steppe');
  const coversList = aiBench.loadTerrain('l04-steppe').J.covers.map(aiBench.coverCol);
  const TB = makeBumpT(T);   // 坠落段专用台面(区外 heightAt 与 T 全等)

  // 主车出生点取最近硬掩体的反方向 25m: 起步段与追击段都会擦/顶掩体(collideTank 分支走到)
  const hard = coversList.filter(c => c.blocksMove && c.blocksShells);
  const h0 = hard.reduce((a, b) => Math.hypot(b.x + 100, b.z - 60) < Math.hypot(a.x + 156, a.z - 40) ? b : a, hard[0]);
  const sx = h0.x - Math.sin(0.35) * 25, sz = h0.z - Math.cos(0.35) * 25;

  const main = new SF.Tank('pz4', { x: sx, z: sz, yaw: 0.35, team: 0, netId: 1 });
  const partner = new SF.Tank('stug3', { x: sx + 18, z: sz - 14, yaw: Math.PI + 0.35, team: 1, netId: 2 });
  const world = {
    time: 0, terrain: TB,
    covers: { list: coversList, collideTank: (t) => collideTank(t, coversList) },
    tanks: [main, partner], enemies: [partner], player: main,
    shells: null, intel: { x: 0, z: 0, t: -99, level: 0 }
  };

  // 事件记录(Bus 监听; 点坐标只取数值)
  const idxOf = (t) => t === main ? 0 : 1;
  SF.Bus.on('fire', (e) => rec.events.push(['fire', world.time.toFixed(3), idxOf(e.tank), e.pos.x, e.pos.y, e.pos.z, e.dir.x, e.dir.y, e.dir.z]));
  SF.Bus.on('reloaded', (e) => rec.events.push(['reloaded', world.time.toFixed(3), idxOf(e.tank)]));
  SF.Bus.on('hit', (r) => rec.events.push(['hit', world.time.toFixed(3), r.kind, r.zone, r.dmg, r.module === null ? '' : r.module,
    idxOf(r.target), r.shooter ? idxOf(r.shooter) : -1, r.point.x, r.point.y, r.point.z]));
  SF.Bus.on('destroyed', (e) => rec.events.push(['destroyed', world.time.toFixed(3), idxOf(e.tank)]));

  // 弹出捕获: 记录侧桩 shells.spawn; 复验侧 engine 弹场 onCreate(出现即记)
  if (mode === 'record') {
    world.shells = { spawn(owner, pos, dir, disp) {
      // 旧实现在 combat.js Shells.spawn 内掷 2 次骰(散布偏转) —— 生产环境里这在 fire 同帧同步发生;
      // 本桩复刻这两掷, 使记录/复验两侧 fire 时刻的 RNG 流位次一致(散布本身由弹道段对账覆盖)
      const ang = (disp / 100) * Math.sqrt(Math.random());
      const rot = Math.random() * Math.PI * 2;
      rec.shells.push([pos.x, pos.y, pos.z, disp, ang, rot]);
    } };
  } else {
    world.shells = { field: SF.SimEngine.makeShells({
      onCreate: (sh) => rec.shells.push([sh.pos.x, sh.pos.y, sh.pos.z, sh._dispAtFire]),
      onImpact() { }, onPlayerMiss() { }, onNearMiss() { }, onFlight() { }, onKill() { },
      probeTank: () => null, onHitTank() { }, onExplode() { }
    }) };
  }

  const TRACE_FIELDS = ['x', 'z', 'y', 'yaw', 'pitch', 'roll', 'speed', 'gear', 'shiftT', 'flipT',
    'turretYaw', 'gunPitch', 'disp', 'reloadT', 'reloadTotal', 'clipLeft', 'clipPhase', 'hp',
    'lastYawRate', 'lastTurretRate', 'trackOffset', '_fallV'];
  rec.fields = TRACE_FIELDS;
  const snapTank = (t) => {
    const row = TRACE_FIELDS.map(f => {
      const v = t[f];
      return (typeof v === 'number') ? (Number.isFinite(v) ? v : 'inf') : v;
    });
    row.push(t.modules.track, t.modules.engine === Infinity ? 'inf' : t.modules.engine,
      t.modules.gun === Infinity ? 'inf' : t.modules.gun, t.modules.ammo === Infinity ? 'inf' : t.modules.ammo,
      t.alive ? 1 : 0, t.stats.shots);
    return row;
  };

  rec.bump = BUMP;

  for (let k = 0; k < TICKS; k++) {
    const dt = (k >= 1500 && k < 1560) ? 0.1 : DT;   // 坠落段低帧率: 落地结算只在 fallV*dt 够大时可达(见 BUMP 注释)
    // 剧情注入(两侧同 tick 同操作): 传送上台面 / 断带 / 发动机毁 / 弹药架毁 / 抬升
    if (k === 1500) {   // 送上 A 台(顶+8), 静止起步直冲断层 → 自由落体砸向 B 台沿 → 落地摔伤+概率断带
      main.x = 335; main.z = -38; main.yaw = 0; main.y = 0; main._yInit = false;
      main.speed = 0; main.gear = 'D1'; main.shiftT = 0; main.flipT = 0; main._fallV = 0;
      main.turretYaw = 0; main.gunPitch = 0; main.lastYawRate = 0; main.lastTurretRate = 0;
    }
    if (k === 1900) main.modules.track = 6;                          // 断带瘫痪
    if (k === 2100) main.modules.engine = Infinity;                  // 极速×slow
    if (k === 2300) main.modules.ammo = Infinity;                    // 装填×reloadMult(配 fire 脉冲)
    if (k === 2400) main.y = TB.heightAt(main.x, main.z) + 4;        // 再抬 4m: 坠落运动学(fallV/俯冲姿态)
    world.time += dt;
    stub.cur = main; main.update(mainInput(k, main, partner, T), dt, world);
    stub.cur = partner; partner.update(partnerInput(k), dt, world);
    rec.frames.push([snapTank(main), snapTank(partner)]);   // 逐 tick 记录(定位首分歧 tick)
  }

  /* ---------- 炮弹数值积分对账(旧 combat.js 物理循环 vs 新 combat.js+engine 弹场, 2s 逐 tick) ----------
     记录侧载 fixtures/combat.golden.js(改动前原样快照, 旧物理循环在自家类内);
     复验侧载现行 combat.js(物理已移 sim-engine 弹场, 本类只剩表现/判定钩子)。两侧同 world 同输入。 */
  const combatSrc = mode === 'record'
    ? fs.readFileSync(path.join(__dirname, 'fixtures', 'combat.golden.js'), 'utf8')
    : fs.readFileSync(path.join(CJS, 'combat.js'), 'utf8');
  new Function('window', combatSrc)(globalThis);
  // 记录侧另需引擎(旧 combat 无此依赖; 新 combat 构造需 SF.SimEngine, check 侧 loadSide 已载)
  if (mode === 'record') new Function('window', fs.readFileSync(path.join(CJS, 'sim-engine.js'), 'utf8'))(globalThis);
  const fxStub = { acquireTrail() { }, updateTrail() { }, impact() { }, explosion() { }, burst() { }, smoke() { }, flash() { } };
  const sh2 = new globalThis.SF.Shells({ add() { } }, fxStub);
  const owner = { spec: CFG.vehicles.pz4, team: 0, isPlayer: false, x: sx, z: sz };
  const w2 = { time: 0, terrain: T, player: null,
    covers: { blocked(ox, oz, oy, dx, dz, len, dy) { return SF.Sim.coversBlocked(coversList, T.heightAt, ox, oz, oy, dx, dz, len, dy); } },
    tanks: [] };
  sh2.spawn(owner, new THREE.Vector3(sx, T.heightAt(sx, sz) + 2.1, sz),
    new THREE.Vector3(0.3, 0.12, 0.9).normalize(), 1.2);
  sh2.spawn(owner, new THREE.Vector3(sx, T.heightAt(sx, sz) + 2.6, sz),
    new THREE.Vector3(-0.2, 0.35, 0.5).normalize(), 0.4);
  for (let k = 0; k < 120; k++) {
    sh2.update(DT, w2);
    rec.flight.push(sh2.list.map(s => [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.active ? 1 : 0]));
  }
  return rec;
}

/* ---------- 数值比较 ---------- */
function cmpNumbers(a, b, path, bad) {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = Math.abs(a - b);
    if (!(d <= EPS)) bad.push(`${path}: ${a} vs ${b} (Δ=${d})`);
    return d;
  }
  if (String(a) !== String(b)) bad.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return 0;
}
function compare(A, B, label) {
  const bad = [];
  if (A.frames.length !== B.frames.length) bad.push(`帧数不一致 ${A.frames.length} vs ${B.frames.length}`);
  const n = Math.min(A.frames.length, B.frames.length);
  let maxDev = 0;
  for (let i = 0; i < n; i++) {
    for (let ti = 0; ti < 2; ti++) {
      const ra = A.frames[i][ti], rb = B.frames[i][ti];
      for (let f = 0; f < ra.length; f++) {
        const name = (f < A.fields.length ? A.fields[f] : 'extra' + (f - A.fields.length)) + `@t${i}+car${ti}`;
        maxDev = Math.max(maxDev, cmpNumbers(ra[f], rb[f], name, bad));
      }
    }
  }
  if (A.events.length !== B.events.length) bad.push(`事件数不一致 ${A.events.length} vs ${B.events.length}`);
  for (let i = 0; i < Math.min(A.events.length, B.events.length); i++) {
    const ea = A.events[i], eb = B.events[i];
    if (ea[0] !== eb[0]) { bad.push(`事件${i}类型不一致 ${ea[0]} vs ${eb[0]}`); continue; }
    for (let f = 1; f < Math.max(ea.length, eb.length); f++) cmpNumbers(ea[f], eb[f], `ev${i}[${ea[0]}].${f}`, bad);
  }
  if (A.shells.length !== B.shells.length) bad.push(`开炮数不一致 ${A.shells.length} vs ${B.shells.length}`);
  for (let i = 0; i < Math.min(A.shells.length, B.shells.length); i++)
    for (let f = 0; f < 4; f++) cmpNumbers(A.shells[i][f], B.shells[i][f], `shell${i}[${f}]`, bad);
  if (A.flight.length !== B.flight.length) bad.push(`弹道帧数不一致`);
  for (let i = 0; i < Math.min(A.flight.length, B.flight.length); i++) {
    const fa = A.flight[i], fb = B.flight[i];
    if (fa.length !== fb.length) { bad.push(`弹道帧${i}弹数不一致 ${fa.length} vs ${fb.length}`); continue; }
    for (let s = 0; s < fa.length; s++)
      for (let f = 0; f < 7; f++) maxDev = Math.max(maxDev, cmpNumbers(fa[s][f], fb[s][f], `fly${i}.s${s}[${f}]`, bad));
  }
  if (bad.length) {
    // 首个分歧 tick 的全字段清单(定位根因用)
    const m = bad[0].match(/@t(\d+)\+car(\d+)/);
    if (m) {
      const tick = +m[1], car = +m[2];
      const sameTick = bad.filter(b => b.includes(`@t${tick}+car${car}`));
      console.error(`*** ${label} 不一致 ${bad.length} 处; 首分歧 t${tick} car${car} 全字段 ${sameTick.length} 条:`);
      for (const b of sameTick.slice(0, 60)) console.error('   ', b);
      const i0 = Math.max(0, tick - 2);
      if (A.frames[i0] && A.frames[i0][car]) {
        for (let i = i0; i <= Math.min(tick, A.frames.length - 1); i++) {
          console.error(`k${i} 记录`, JSON.stringify(A.frames[i][car]));
          if (B.frames[i] && B.frames[i][car]) console.error(`      复验`, JSON.stringify(B.frames[i][car]));
        }
      }
    } else {
      console.error(`*** ${label} 不一致 ${bad.length} 处(前 20 条):`);
      for (const b of bad.slice(0, 20)) console.error('   ', b);
    }
    return false;
  }
  console.error(`${label}: 一致 ✓ (逐项最大偏差 ${maxDev.toExponential(3)}, 帧=${A.frames.length} 事件=${A.events.length} 弹=${A.shells.length})`);
  return true;
}

function main() {
  const record = process.argv.includes('--record');
  if (record) {
    // provenance 自检(阶段5 复核): fixture 必须与 git HEAD vehicle.js 有且仅有炮塔段差异
    // (工作区阶段1前已含未提交炮塔物理改动 —— G8 申报例外, 非提取走样), 并打印校验和防后续篡改
    try {
      const headV = require('child_process').execSync(
        'git show HEAD:client/js/vehicle.js', { cwd: ROOT }).toString();
      const fixV = fs.readFileSync(GOLDEN_VEHICLE, 'utf8');
      if (headV === fixV) console.error('[provenance] fixture 与 git HEAD 一致(基线无未提交改动)');
      else {
        const diffLines = headV.split('\n').filter((l, i) => fixV.split('\n')[i] !== l).length;
        console.error(`[provenance] fixture 与 git HEAD 有差异(${diffLines} 行段) —— 预期: 工作区阶段1前未提交炮塔物理改动(G8 申报项), golden 基线=被提取源(工作区版)`);
        console.error('[provenance] fixture sha256:', require('crypto').createHash('sha256').update(fixV).digest('hex').slice(0, 16));
      }
    } catch (e) { console.warn('[provenance] 自检跳过:', e.message.slice(0, 80)); }
    const r1 = run('record'), r2 = run('record');
    if (JSON.stringify(r1) !== JSON.stringify(r2)) { console.error('*** 记录侧自验失败: 同种子两遍不一致'); process.exit(1); }
    fs.writeFileSync(FIXTURE, JSON.stringify(r1));
    console.error(`基线已录制: ${FIXTURE} (${(fs.statSync(FIXTURE).size / 1e6).toFixed(1)}MB, 帧=${r1.frames.length} 事件=${r1.events.length} 开炮=${r1.shells.length})`);
    return;
  }
  if (!fs.existsSync(FIXTURE)) { console.error('*** 缺基线 ' + FIXTURE + ', 先 node tools/golden-trace.js --record'); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const c1 = run('check'), c2 = run('check');
  if (JSON.stringify(c1) !== JSON.stringify(c2)) { console.error('*** 复验侧自验失败: 同种子两遍不一致'); process.exit(1); }
  const ok = compare(base, c1, 'golden-trace(旧vehicle.js vs sim-engine)') && compare(c1, c2, '复验侧双跑');
  console.log(JSON.stringify({ ok, maxDevReported: true, frames: c1.frames.length, events: c1.events.length, shells: c1.shells.length }));
  process.exit(ok ? 0 : 1);
}
main();
