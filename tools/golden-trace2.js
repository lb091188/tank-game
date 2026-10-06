#!/usr/bin/env node
// golden-trace2.js — JS→MoonBit 直译黄金轨迹夹具生成器(逻辑内核四件套: simcore / sim-engine / ai / srv-sim)
//
// 与 tools/golden-trace.js 的分工: 那是「改动前 vehicle.js 快照 vs sim-engine 提取件」的行为等价对账
// (JS 内部两份实现的互证); 本工具是「JS 内核 → MoonBit 直译」的比对基准 —— 把四个纯逻辑内核
// (零 DOM/零 THREE: client/js/simcore.js, sim-engine.js, ai.js, srv-sim.js)在固定种子+脚本化输入下
// 的可观测状态逐 tick/逐查询录成 JSON 夹具, 供 moonbit/ 侧直译实现逐 snapshot 逐字段对账(容差 1e-6)。
//
// 产出(相对仓根, 默认写入, --check 只验不写):
//   moonbit/fixtures/golden/simcore.json    SF.Sim 纯函数: 地形高程/通视/坡度/遮挡/寻掩/隐蔽 (120 snapshot)
//   moonbit/fixtures/golden/simengine.json  SF.SimEngine: 行驶/变速箱/碰撞/坠落/装填/开炮/弹道 (91 snapshot)
//   moonbit/fixtures/golden/ai.json         SF.AI: FSM 感知/导航/开火纪律, 双 AI 对抗 (150 snapshot)
//   moonbit/fixtures/golden/srvsim.json     SF.SrvSim: 权威房 tick/快照/判伤/重生/结算 (90 snapshot)
//   每份 = meta(种子/tick 数/采样间隔/输入脚本/输入数据(heightmap u16 base64+covers)/字段说明) + snapshots。
//   结构/量化/判定标准见 moonbit/fixtures/golden/SPEC.md。
//
// 确定性: 进程内 mulberry32(SEED) 替换全局 Math.random, 在每次 boot() 加载内核脚本【之前】重置 ——
//   不改 client/js 任何文件; 每场景独立种子(基址+偏移), 每场景连跑两遍逐字节互验, 不一致即退出码 1。
//   srv-sim 出生池洗牌用房间自带 mulberry32(roomSeed)(srv-sim.js:76-89), 与全局流并行, 亦为定值。
// 零 npm 依赖(fs/path/zlib 内置); node tools/golden-trace2.js 直接跑。
//
// 用法:
//   node tools/golden-trace2.js            生成/覆盖 4 份 JSON( stderr 过程, stdout 末行汇总 JSON )
//   node tools/golden-trace2.js --check    重新计算并与盘上夹具逐字节比对(门禁用, 不写盘)
// 退出码: 0 = 双跑一致且(--check 时)与盘上一致; 1 = 任何不一致/NaN。
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const CJS = path.join(ROOT, 'client', 'js');
const MAPS = path.join(ROOT, 'client', 'assets', 'maps');
const OUTDIR = path.join(ROOT, 'moonbit', 'fixtures', 'golden');
const GENERATOR = 'tools/golden-trace2.js';
const SEED_BASE = 20261006;        // 独立于 ai-bench(20261004) 与 golden-trace/sim-headless(20261005)
const SEEDS = { simcore: SEED_BASE, simengine: SEED_BASE + 1, ai: SEED_BASE + 2, srvsim: SEED_BASE + 3 };
const ROOM_SEED = 777;             // srv-sim 房间自带 mulberry32 的出生池种子(srv-sim.js:176)
const DT = 1 / 60;                 // = CFG.sim.dt

/* ---------- 确定性随机源(与 ai-bench.js/golden-trace.js/sim-headless.js 同式) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 数值量化: 1e-6 网格; NaN=生成失败(硬错), ±Infinity→哨兵 -1(仅模块毁伤字段会出现) ---------- */
function q6(v) {
  if (typeof v !== 'number') return v;
  if (Number.isNaN(v)) throw new Error('NaN 泄入夹具数值(拒绝生成, 请查上游)');
  if (!Number.isFinite(v)) return -1;
  return Math.round(v * 1e6) / 1e6;
}
const b01 = (v) => (v ? 1 : 0);

/* ---------- PNG16 手解(ai-bench.js loadPNG16 同款滤波链, 但保留原始 u16 采样值) ---------- */
function loadPNG16u16(f) {
  const b = fs.readFileSync(f);
  let p = 8, w = 0, h = 0; const id = [];
  while (p < b.length) {
    const l = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8);
    if (t === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (t === 'IDAT') id.push(b.subarray(p + 8, p + 8 + l));
    p += 12 + l;
  }
  const raw = zlib.inflateSync(Buffer.concat(id));
  const o = new Uint16Array(w * h), bp = 2, st = w * bp;
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
      o[j * w + i] = v & 0xffff;
    }
  }
  return { w, h, data: o };
}

/* ---------- 地图数据束: 高程以 u16 base64 内嵌, 重建公式复刻 ai-bench 两级 f32 舍入 ---------- */
const mapCache = {};
function mapBundle(dir) {
    if (mapCache[dir]) return mapCache[dir];
    const J = JSON.parse(fs.readFileSync(path.join(MAPS, dir, 'map.json'), 'utf8'));
    const png = loadPNG16u16(path.join(MAPS, dir, 'heightmap.png'));
    if (png.w !== J.terrain.resolution || png.h !== J.terrain.resolution)
      throw new Error(`${dir} heightmap ${png.w}x${png.h} != resolution ${J.terrain.resolution}`);
    return mapCache[dir] = {
      dir, terrain: J.terrain, covers: J.covers, u16: png.data,
      waves: J.waves || [], repair: J.repairBetweenWaves || null,
      heightsB64: Buffer.from(png.data.buffer, png.data.byteOffset, png.data.byteLength).toString('base64'),
    };
  }
// u16 → Float32 高程: h = fround(fround(v/65535) * maxHeight) —— ai-bench.js loadPNG16(中间 Float32Array)
// + loadTerrain(目标 Float32Array) 的两级舍入逐位复刻; MoonBit 侧按同序两次 f32 舍入(SPEC.md §输入数据)
function heightsOf(mb) {
  const { u16 } = mb, TH = mb.terrain.maxHeight;
  const h = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) h[i] = Math.fround(Math.fround(u16[i] / 65535) * TH);
  return h;
}

/* ---------- 掩体碰撞表(models.js buildCover 纯数据子集, ai-bench.js:216 / srv-sim.js:23 同款) ---------- */
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

/* ---------- 内核装载: 每遍全新 SF(config 闭包/Bus 监听不跨遍残留) + 加载前重置全局 RNG ---------- */
const SRC = {};
for (const f of ['simcore.js', 'config.js', 'sim-engine.js', 'ai.js', 'srv-sim.js'])
  SRC[f] = fs.readFileSync(path.join(CJS, f), 'utf8');
function boot(files, seed) {
  globalThis.window = globalThis;
  globalThis.SF = {};
  Math.random = mulberry32(seed);
  for (const f of files) new Function('window', SRC[f])(globalThis);
  return globalThis.SF;
}

/* ---------- 车辆状态桩(字段集 = engine 读写清单, 与 SF.Tank 同形; sim-headless.js mkTank 同款) ---------- */
function mkTank(SF, type, opts) {
  const spec = SF.CFG.vehicles[type];
  const _al = spec.gun.autoloader;
  return {
    type, spec,
    x: opts.x, z: opts.z, y: 0, yaw: opts.yaw,
    speed: 0, velX: 0, velZ: 0, lastYawRate: 0, lastTurretRate: 0,
    turretYaw: opts.yaw, gunPitch: 0, pitch: 0, roll: 0, trackOffset: 0,
    gear: 'D1', shiftT: 0, flipT: 0, _yInit: false, _fallV: 0, _ramT: -9,
    hp: spec.hp, alive: true,
    reloadT: 1, reloadTotal: 1,
    clipLeft: _al ? _al.clip : 0, clipPhase: _al ? 'intra' : 'single',
    disp: spec.dispersion.max,
    modules: { track: 0, engine: 0, gun: 0, ammo: 0 },
    parts: { noTurret: spec.gunArc !== undefined },
    cr: Math.hypot(spec.sample.l, spec.sample.w) * 0.72,
    team: opts.team, netId: opts.netId || 0, isPlayer: !!opts.isPlayer,
    id: opts.id !== undefined ? opts.id : undefined,
    lastFireT: -99,
    stats: { shots: 0, hits: 0, pens: 0, dmgDealt: 0 },
    input: { throttle: 0, steer: 0, aimYaw: opts.yaw, aimPitch: 0, fire: false },
  };
}
/* 无头炮口位姿(srv-sim.js:254-258 同式; 浏览器侧是 GLB muzzleWorld/gunDir, 夹具用确定性脚本值) */
function muzzleOf(t) { return { x: t.x + Math.sin(t.yaw) * 2.0, y: t.y + 2.1, z: t.z + Math.cos(t.yaw) * 2.0 }; }
function aimDirOf(t) {
  const cp = Math.cos(t.gunPitch);
  return { x: Math.sin(t.turretYaw) * cp, y: Math.sin(t.gunPitch), z: Math.cos(t.turretYaw) * cp };
}

/* ================================================================
   场景 1: simcore — SF.Sim 纯函数(无随机; l01-encounter: 草本软掩体+护脊地形两类都采到)
   ================================================================ */
function runSimcore() {
  const seed = SEEDS.simcore;
  const mb = mapBundle('l01-encounter');
  const SF = boot(['simcore.js', 'config.js'], seed);
  const T = SF.Sim.makeTerrain(heightsOf(mb), mb.terrain);
  const list = mb.covers.map(coverCol);
  const NQ = 120;
  const snapshots = [];
  for (let k = 0; k < NQ; k++) {
    const time = k * 0.05;
    // 脚本化轨迹(纯公式, 无状态): A 车大范围扫过地图(速度/角速度/开火窗口周期变化), B 为远距目标
    const ax = 350 * Math.sin(k * 0.041), az = 330 * Math.sin(k * 0.023 + 1.3);
    const ayaw = 0.4 + 0.05 * k;
    const bx = -320 * Math.cos(k * 0.017 + 0.7), bz = 310 * Math.sin(k * 0.031 + 2.1);
    const a = { x: ax, z: az, y: T.heightAt(ax, az), yaw: ayaw,
      speed: 7 * Math.sin(k * 0.09), lastYawRate: 0.25 * Math.sin(k * 0.033),
      spec: { camo: 0.32 },
      lastFireT: time - ((k % 50) < 12 ? 1.5 : 99) };   // 周期进入"开炮后 4s 隐蔽失效"窗
    const b = { x: bx, z: bz, y: T.heightAt(bx, bz) };
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const bs = SF.Sim.bushState(list, a, time);
    const spot = { tx: b.x, tz: b.z, fired: bs.fired, concealed: bs.concealed };
    const covPlain = SF.Sim.coversBlocked(list, T.heightAt, a.x, a.z, a.y + 2, dx / len, dz / len, len, (b.y - a.y) / len);
    const covSpot = SF.Sim.coversBlocked(list, T.heightAt, a.x, a.z, a.y + 2, dx / len, dz / len, len, (b.y - a.y) / len, spot);
    const ncov = SF.Sim.nearestCoverBetween(list, a.x, a.z, b.x, b.z);
    const ncT = ncov === null ? -1 : SF.Util.rayCircle(a.x, a.z, dx / len, dz / len, len, ncov.x, ncov.z, ncov.r);
    snapshots.push({
      k, time: q6(time),
      in: {
        a: { x: q6(a.x), z: q6(a.z), y: q6(a.y), yaw: q6(a.yaw), speed: q6(a.speed),
             lastYawRate: q6(a.lastYawRate), lastFireT: q6(a.lastFireT), camo: a.spec.camo },
        b: { x: q6(b.x), z: q6(b.z), y: q6(b.y) },
      },
      out: {
        heightAtA: q6(a.y), heightAtB: q6(b.y),
        slopeAhead: q6(T.slopeAhead(a.x, a.z, a.yaw, 6)),
        gradAtA: q6(T.gradAt(a.x, a.z)), gradAtB: q6(T.gradAt(b.x, b.z)),
        losBlockedDefault: b01(T.losBlocked(a.x, a.z, a.y + 2, b.x, b.z, b.y + 2)),
        losBlockedMargin02: b01(T.losBlocked(a.x, a.z, a.y + 2, b.x, b.z, b.y + 2, 0.2)),
        coversBlockedPlain: q6(covPlain === -1 ? -1 : covPlain),
        coversBlockedSpot: q6(covSpot === -1 ? -1 : covSpot),
        nearestCoverBetween: q6(ncT),
        bushInBush: b01(bs.inBush), bushFired: b01(bs.fired), bushConcealed: b01(bs.concealed),
        camoOf: q6(SF.Sim.camoOf(list, a, time)),
      },
    });
  }
  return {
    meta: {
      name: 'simcore', generator: GENERATOR, seed, seed_note: '本场景无随机消费; 种子仅为口径统一',
      source: 'client/js/simcore.js (SF.Sim)', loads: ['simcore.js', 'config.js'],
      map: mb.dir, dt: 0.05, ticks: NQ, sampleEvery: 1, snapshots: NQ,   // 纯函数查询序列: "tick"=查询序 k, time=k*0.05
      inputs: mapInputsMeta(mb),
      input_script: [
        '纯函数查询序列, 无状态推进: k ∈ [0,120)',
        'A 点轨迹: x=350·sin(0.041k), z=330·sin(0.023k+1.3), yaw=0.4+0.05k(可超±π), speed=7·sin(0.09k),',
        '          lastYawRate=0.25·sin(0.033k), lastFireT=time-(k%50<12?1.5:99)(周期进开炮失效窗), spec.camo=0.32',
        'B 点轨迹: x=-320·cos(0.017k+0.7), z=310·sin(0.031k+2.1)',
        'time=0.05k; 眼高=heightAt+2;射线= A→B 归一化方向, len=|B-A|',
      ],
      fields: {
        snapshot: '{ k, time, in:{a,b 查询输入(量化后原样内嵌, MoonBit 直接喂这些值)}, out:{查询输出} }',
        'out.heightAtA/B': 'makeTerrain.heightAt 两点高程',
        'out.slopeAhead': 'slopeAhead(a, yaw, 6) 沿向坡度(rad)',
        'out.gradAtA/B': 'gradAt 梯度模(最陡坡度正切)',
        'out.losBlockedDefault/Margin02': '地形通视(余量 1.6 缺省 / 0.2 显), 0=通 1=挡',
        'out.coversBlockedPlain/Spot': '掩体射线最近命中 t(无命中 -1); Spot 带 {tx,tz,fired,concealed} 草丛上下文',
        'out.nearestCoverBetween': 'A→B 最近掩体的射线参 t(无 -1)',
        'out.bushInBush/fired/concealed': 'bushState 三布尔(0/1)',
        'out.camoOf': '隐蔽值 [0,0.8]',
      },
    },
    snapshots,
  };
}

/* ================================================================
   场景 2: simengine — SF.SimEngine 数值车辆+弹场(l04-steppe 开阔地)
   覆盖: 直线升挡/转向掉速/倒车换向/追击车车互推+撞击伤害/坠落实算/断带/发动机毁/
         弹药架毁/装填/散布扩圈/开炮(骰 2 次/发)/弹道积分/地形与掩体命中/OBB 部位判伤
   ================================================================ */
function runSimengine() {
  const seed = SEEDS.simengine;
  const mb = mapBundle('l04-steppe');
  const SF = boot(['simcore.js', 'config.js', 'sim-engine.js'], seed);
  const U = SF.Util, CFG = SF.CFG;
  const T = SF.Sim.makeTerrain(heightsOf(mb), mb.terrain);
  const coversList = mb.covers.map(coverCol);

  const counts = { fire: 0, reloaded: 0, hit: 0, destroyed: 0, ram: 0,
    shellSpawn: 0, shellGround: 0, shellCover: 0, shellHitTank: 0, shellExpire: 0 };
  const log = [];
  const emit = (ev, d) => {
    if (ev === 'fire') { counts.fire++; log.push(['fire', q6(world.time), d.tank.netId,
      q6(d.pos.x), q6(d.pos.y), q6(d.pos.z), q6(d.dir.x), q6(d.dir.y), q6(d.dir.z)]); }
    else if (ev === 'reloaded') { counts.reloaded++; log.push(['reloaded', q6(world.time), d.tank.netId]); }
    else if (ev === 'ram') { counts.ram++; counts.hit++; log.push(['ram', q6(world.time),
      d.shooter.netId, d.target.netId, d.dmg]); }
    else if (ev === 'destroyed') { counts.destroyed++; log.push(['destroyed', q6(world.time),
      d.tank.netId, d.shooter ? d.shooter.netId : -1]); }
    else if (ev === 'hit') { counts.hit++; log.push(['hit', q6(world.time), d.shooter ? d.shooter.netId : -1,
      d.target.netId, d.kind, d.zone, d.dmg, d.module || '', q6(d.point.x), q6(d.point.y), q6(d.point.z)]); }
  };

  // 出生点: 最近硬掩体反方向 25m(golden-trace.js:176-181 同款 → 起步/追击都会擦掩体)
  const hard = coversList.filter(c => c.blocksMove && c.blocksShells);
  const h0 = hard.reduce((a, b) => Math.hypot(b.x + 100, b.z - 60) < Math.hypot(a.x + 156, a.z - 40) ? b : a, hard[0]);
  const sx = h0.x - Math.sin(0.35) * 25, sz = h0.z - Math.cos(0.35) * 25;
  const main = mkTank(SF, 'pz4', { x: sx, z: sz, yaw: 0.35, team: 0, netId: 1 });
  const partner = mkTank(SF, 'stug3', { x: sx + 18, z: sz - 14, yaw: Math.PI + 0.35, team: 1, netId: 2 });
  const world = { time: 0, terrain: T, tanks: [main, partner] };

  const judge = {
    probeTank(sh, tk, ox, oy, oz, dx, dy, dz, segLen) { return SF.SimEngine.probeTankOBB(tk, ox, oy, oz, dx, dy, dz, segLen); },
    onHitTank(sh, tk, hit, segDir) { settleHit(sh, tk, hit, segDir, emit, world, counts, SF.CFG); },
  };
  const shells = SF.SimEngine.makeShells(Object.assign({
    onImpact(kind, p) { if (kind === 'ground') counts.shellGround++; else counts.shellCover++;
      log.push(['impact', q6(world.time), kind, q6(p.x), q6(p.y), q6(p.z)]); },
    onPlayerMiss() { }, onNearMiss() { }, onFlight() { }, onExplode() { },
    onCreate() { counts.shellSpawn++; },
    onKill() { counts.shellExpire++; },
  }, judge));

  const takeRam = (target, shooter, dmg) => {
    if (!target.alive || dmg <= 0) return;
    target.hp -= dmg;
    emit('ram', { shooter, target, dmg });
    if (target.hp <= 0 && target.alive) { target.hp = 0; target.alive = false; emit('destroyed', { tank: target, shooter }); }
  };
  const env = () => ({ terrain: T, coversList, tanks: world.tanks, time: world.time, emit,
    onMoved: (tk, d) => { tk.trackOffset = (tk.trackOffset - tk.speed * d / 4.0) % 1; }, takeRam });
  const envT = {
    heightAt: T.heightAt,
    coversBlocked(ox, oz, oy, dx, dz, len, dy) { return SF.Sim.coversBlocked(coversList, T.heightAt, ox, oz, oy, dx, dz, len, dy); },
    tanks: world.tanks, playerPos: main, playerTeam: 0,
  };
  const wf = { shells: { field: shells } };

  const mainInput = (k) => {
    const i = { throttle: 0, steer: 0, aimYaw: 0.35, aimPitch: 0, fire: false };
    if (k < 300) i.throttle = 1;                                   // 直线升挡 D1→D3
    else if (k < 600) { i.throttle = 1; i.steer = 0.6; }           // 转向掉速
    else if (k < 900) i.throttle = -1;                             // 倒车换向(flip 全扭矩窗口)
    else if (k < 1260 && k >= 1200) { /* 坠落段: 油门 0, 原地自由落体 */ }
    else {                                                         // 追击/交战(朝 partner)
      const want = Math.atan2(partner.x - main.x, partner.z - main.z);
      i.aimYaw = want;
      i.steer = U.clamp(U.angDiff(main.yaw, want) * 2.5, -1, 1);
      i.throttle = k < 1200 ? 1 : 0.4;                             // 900-1200 追击(互推/撞伤), 之后游走交战
      i.fire = k < 1200 ? (k % 150 === 100) : (k % 75 === 25);
      return i;
    }
    i.fire = false;
    return i;
  };
  const partnerInput = (k) => ({
    throttle: k % 400 < 200 ? 0.2 : 0, steer: -0.4,                // 半程溜车半程停(golden-trace 同款: 停车窗被追击撞上)
    aimYaw: Math.atan2(main.x - partner.x, main.z - partner.z), aimPitch: 0.02,
    fire: k % 120 === 60,
  });

  const TICKS = 1800, EVERY = 20;
  const snapshots = [];
  const snapTank = (t) => ({
    id: t.netId, type: t.type,
    x: q6(t.x), y: q6(t.y), z: q6(t.z), yaw: q6(t.yaw), pitch: q6(t.pitch), roll: q6(t.roll),
    speed: q6(t.speed), gear: t.gear, shiftT: q6(t.shiftT), flipT: q6(t.flipT),
    turretYaw: q6(t.turretYaw), gunPitch: q6(t.gunPitch),
    disp: q6(t.disp), reloadT: q6(t.reloadT), reloadTotal: q6(t.reloadTotal),
    clipLeft: t.clipLeft | 0, clipPhase: t.clipPhase,
    hp: q6(t.hp), alive: b01(t.alive),
    lastYawRate: q6(t.lastYawRate), lastTurretRate: q6(t.lastTurretRate),
    trackOffset: q6(t.trackOffset), fallV: q6(t._fallV),
    mod: { track: q6(t.modules.track), engine: q6(t.modules.engine), gun: q6(t.modules.gun), ammo: q6(t.modules.ammo) },
    shots: t.stats.shots, hits: t.stats.hits, pens: t.stats.pens, dmgDealt: t.stats.dmgDealt,
  });
  for (let k = 0; k < TICKS; k++) {
    // 坠落段(k 1200-1260)用 dt=0.1 低帧率(golden-trace.js:150-154 同款原理): 60Hz 下 fv·dt 一步跨不过
    // 剩余 gap 带(需 >72m/s), 落地结算数学上不可达; 0.1s 时 fv≈13 → fv·dt=1.3 > 1.2 可达
    const dt = (k >= 1200 && k < 1260) ? 0.1 : DT;
    world.time += dt;
    if (k === 1200) {   // 坠落试验: 原地悬空 targetY+11.5m(姿态/速度归零)。dt=0.1 窗下逐 tick 模拟:
      // 落地结算要求「tick 起点 gap>1.2 且 fv·dt 一步跨过剩余 gap」, H=12.5 落在 n=11 带内
      // (gap10=12.5-0.098·110=1.72>1.2, fv11·dt=2.156≥1.72, 且 0.098·132=12.936≥12.5) → v≈21.6, dmg=(21.6-9)²·4≈631, 另掷断带
      const s2 = Math.sin(main.yaw), c2 = Math.cos(main.yaw);
      const SL = main.spec.sample.l, SW = main.spec.sample.w;
      const hF2 = T.heightAt(main.x + s2 * SL, main.z + c2 * SL), hB2 = T.heightAt(main.x - s2 * SL, main.z - c2 * SL);
      const hL2 = T.heightAt(main.x + c2 * SW, main.z - s2 * SW), hR2 = T.heightAt(main.x - c2 * SW, main.z + s2 * SW);
      const tY2 = Math.max(T.heightAt(main.x, main.z), (hF2 + hB2 + hL2 + hR2) / 4);   // 与 engine 同式
      main.y = tY2 + 12.5; main._fallV = 0;
      main.speed = 0; main.gear = 'D1'; main.shiftT = 0; main.flipT = 0;
    }
    if (k === 1350) main.modules.track = Math.max(main.modules.track, 6);           // 断带瘫痪
    if (k === 1500) main.modules.engine = Infinity;                                  // 极速×slow
    if (k === 1650) main.modules.ammo = Infinity;                                    // 装填×reloadMult
    const mi = mainInput(k);
    SF.SimEngine.updateTank(main, mi, dt, env());
    if (mi.fire) SF.SimEngine.fire(main, wf, muzzleOf(main), aimDirOf(main), emit);
    const pi = partnerInput(k);
    SF.SimEngine.updateTank(partner, pi, dt, env());
    if (pi.fire) SF.SimEngine.fire(partner, wf, muzzleOf(partner), aimDirOf(partner), emit);
    shells.update(dt, envT);
    if (k % EVERY === 0)
      snapshots.push({ k, time: q6(world.time), ev: Object.assign({}, counts), tanks: [snapTank(main), snapTank(partner)] });
  }
  return {
    meta: {
      name: 'simengine', generator: GENERATOR, seed,
      seed_note: 'mulberry32 在 boot() 装载内核前重置; 消费点=开炮散布 2 骰/发(shoot spawn)、摔伤断带掷、判伤穿深/伤害/模块掷',
      source: 'client/js/sim-engine.js (SF.SimEngine)', loads: ['simcore.js', 'config.js', 'sim-engine.js'],
      map: mb.dir, dt: DT,
      fall_window_note: 'k∈[1200,1260) 全局 dt=0.1(golden-trace.js:150-154 同款): 60Hz 下 fallV·dt 跨不过剩余 gap, 落地结算不可达; 注入高度=targetY(四角同式)+12.5m, 该窗内两车同参同注入, 其余段 dt=1/60',
      ticks: TICKS, sampleEvery: EVERY, snapshots: snapshots.length,
      inputs: mapInputsMeta(mb),
      input_script: [
        'main(pz4, netId=1, 出生=最近硬掩体反方向25m, yaw=0.35):',
        '  k<300 油门1直行; 300-600 油门1+舵0.6; 600-900 油门-1倒车; 900-1200 追击 partner(舵=P(angDiff)·2.5, 油门1);',
        '  1200-1800 交战(油门0.4, 瞳向 partner); 开火: k<1200 时 k%150==100, 之后 k%75==25',
        '  注入: k==1200 y=地面+6(坠落); k==1350 modules.track=max(·,6); k==1500 engine=∞; k==1650 ammo=∞',
        'partner(stug3, netId=2, 出生=main+(18,-14), yaw=π+0.35): 油门 k%600<300?0.3:-0.2, 舵-0.3, 瞳向 main, 开火 k%120==60',
        '弹场 hooks: probeTank=SF.SimEngine.probeTankOBB; onHitTank=srv-sim 同款判伤(等效甲/跳弹/过穿/模块掷)',
      ],
      fields: {
        snapshot: '{ k, time, ev:{事件/弹场累计计数}, tanks:[main, partner 各自状态对象] }',
        'ev.*': 'fire/reloaded/hit/destroyed/ram 开火装填命中击毁撞击累计; shellSpawn/Ground/Cover/HitTank/Expire 弹场累计',
        'tanks[].mod.*': '模块剩余秒; -1 = Infinity(永久毁伤哨兵, SPEC §量化)',
        'tanks[].gear/clipPhase': '挡位 D1/D2/D3/R1/R2/N; 装填相 intra/long/single(字符串全等比对)',
        'tanks[].fallV': 'engine 内部 _fallV(坠落垂直速度)',
      },
    },
    snapshots,
    events: log,
  };
}

/* 判伤结算(srv-sim.js makeJudge.onHitTank:128-158 逐式移植; 事件改走 emit 记录) */
function settleHit(sh, tk, hit, segDir, emit, world, counts, CFG) {
  if (!tk.alive) return;
  counts.shellHitTank++;
  const A = CFG.armor;
  const incidence = Math.acos(Math.min(1, Math.max(-1, -(hit.normal.x * segDir.x + hit.normal.y * segDir.y + hit.normal.z * segDir.z))));
  const armor = hit.armor || 0, cal = sh.cal;
  const over3 = armor > 0 && cal > armor * 3;
  let norm = 5 * Math.PI / 180;
  if (armor > 0 && cal > armor * 2) norm *= 2;
  const eff = armor / Math.max(Math.cos(Math.max(0, incidence - norm)), 0.05);
  const pen = sh.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
  const rico = armor > 0 && !over3 && incidence > A.ricochetAngle;
  const res = { target: tk, shooter: sh.owner, point: hit.point, zone: hit.zone, dmg: 0, kind: 'nopen', module: null };
  sh.owner.stats.hits++;
  if (hit.zone === 'gun') {
    tk.modules.gun = Infinity; res.kind = 'gun'; res.module = 'gun';
  } else if (hit.zone === 'tracks') {
    tk.modules.track = A.modules.track.duration; res.module = 'track';
    if (rico) res.kind = 'bounce';
    else if (pen >= eff) { res.kind = 'pen'; res.dmg = Math.round(sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance)); }
    else res.kind = 'absorb';
  } else if (rico) res.kind = 'bounce';
  else if (pen >= eff) {
    res.kind = 'pen';
    let dmg = sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance);
    if (Math.random() < A.modules.ammo.chance) { dmg *= A.modules.ammo.dmgMult; res.module = 'ammo'; tk.modules.ammo = Infinity; }
    else if (hit.zone === 'hullRear' && Math.random() < A.modules.engine.rearChance) { res.module = 'engine'; tk.modules.engine = Infinity; }
    res.dmg = Math.round(dmg);
  }
  if (res.kind === 'pen') { tk.hp -= res.dmg; sh.owner.stats.pens++; sh.owner.stats.dmgDealt += res.dmg; }
  if (tk.hp <= 0 && tk.alive) { tk.hp = 0; tk.alive = false; emit('destroyed', { tank: tk, shooter: sh.owner }); }
  emit('hit', { shooter: sh.owner, target: tk, kind: res.kind, zone: res.zone, dmg: res.dmg, module: res.module, point: hit.point });
}

/* ================================================================
   场景 3: ai — SF.AI 双车对抗(sim-headless.js runMatch 同构 + 逐 24 tick 采样)
   覆盖: 感知/点亮/反应延迟/FSM 转移/导航避障/预瞄/开火纪律窗口/停车即射/摆角/听声/无线电
   ================================================================ */
function runAi() {
  const seed = SEEDS.ai;
  const mb = mapBundle('l04-steppe');
  const SF = boot(['simcore.js', 'config.js', 'sim-engine.js', 'ai.js'], seed);
  const U = SF.Util, CFG = SF.CFG;
  const T = SF.Sim.makeTerrain(heightsOf(mb), mb.terrain);
  const coversList = mb.covers.map(coverCol);

  const counts = { fire: 0, hit: 0, destroyed: 0, ram: 0, shellSpawn: 0, shellHitTank: 0 };
  const log = [];
  const emit = (ev, d) => {
    if (ev === 'fire') { counts.fire++; log.push(['fire', q6(W.time), d.tank.netId,
      q6(d.pos.x), q6(d.pos.y), q6(d.pos.z), q6(d.dir.x), q6(d.dir.y), q6(d.dir.z)]); }
    else if (ev === 'ram') { counts.ram++; counts.hit++; log.push(['ram', q6(W.time), d.shooter.netId, d.target.netId, d.dmg]); }
    else if (ev === 'destroyed') { counts.destroyed++; log.push(['destroyed', q6(W.time), d.tank.netId, d.shooter ? d.shooter.netId : -1]); }
    else if (ev === 'hit') { counts.hit++; log.push(['hit', q6(W.time), d.shooter ? d.shooter.netId : -1, d.target.netId,
      d.kind, d.zone, d.dmg, d.module || '', q6(d.point.x), q6(d.point.y), q6(d.point.z)]); }
  };

  const covers = {
    list: coversList, heightAt: T.heightAt,
    blocked(ox, oz, oy, dx, dz, len, dy, spot) { return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot); },
    nearestCoverBetween(ax, az, bx, bz) { return SF.Sim.nearestCoverBetween(this.list, ax, az, bx, bz); },
  };
  const intel = { x: 0, z: 0, t: -99, level: 0 };
  const W = { time: 0, over: false, terrain: T, covers, intel, tanks: [], enemies: [], player: null, mpTargets: [] };
  SF.Game = { get world() { return W; } };   // ai.js nowT()/world2time() 取时钩子

  // 50m 平地对开(sim-headless.js 同对: l04 连线上无脊线遮挡)
  const A = mkTank(SF, 'pz4', { x: -380, z: -380, yaw: 0, team: 0, netId: 1, id: 11 });
  const B = mkTank(SF, 'pz4', { x: -330, z: -380, yaw: Math.PI, team: 1, netId: 2, id: 12 });
  A.ai = new SF.AI(A, { personality: 'sniper', patrol: [[A.x, A.z]] });
  B.ai = new SF.AI(B, { personality: 'flanker', patrol: [[B.x, B.z]] });
  const WA = Object.assign({}, W, { time: 0, enemies: [A], player: B, mpTargets: [B] });
  const WB = Object.assign({}, W, { time: 0, enemies: [B], player: A, mpTargets: [A] });
  W.tanks = [A, B];

  const judge = {
    probeTank(sh, tk, ox, oy, oz, dx, dy, dz, segLen) { return SF.SimEngine.probeTankOBB(tk, ox, oy, oz, dx, dy, dz, segLen); },
    onHitTank(sh, tk, hit, segDir) {
      settleHit(sh, tk, hit, segDir, emit, W, counts, CFG);
      if (tk.ai && tk.alive && sh.owner.team !== tk.team) tk.ai.onHurt(sh.owner);   // 被打感知(ai.js:605)
    },
  };
  const shells = SF.SimEngine.makeShells(Object.assign({
    onImpact() { }, onPlayerMiss() { }, onNearMiss() { }, onFlight() { }, onExplode() { },
    onCreate() { counts.shellSpawn++; }, onKill() { },
  }, judge));
  W.shells = { field: shells };

  // 死斗重生(简化 main.js: 5s 后回出生点重整, sim-headless.js 同款)
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

  const envOf = (t) => ({
    terrain: T, coversList, tanks: W.tanks, time: W.time, emit,
    onMoved: (tk, d) => { tk.trackOffset = (tk.trackOffset - tk.speed * d / 4.0) % 1; },
    takeRam: (target, shooter, dmg) => {
      if (!target.alive || dmg <= 0) return;
      target.hp -= dmg;
      emit('ram', { shooter, target, dmg });
      if (target.hp <= 0 && target.alive) { target.hp = 0; target.alive = false; emit('destroyed', { tank: target, shooter }); }
      if (target.ai && target.alive && shooter.team !== target.team) target.ai.onHurt(shooter);
      emit('hit', { shooter, target, kind: 'ram', zone: 'ram', dmg, module: null, point: { x: target.x, y: target.y + 1, z: target.z } });
    },
  });
  const envT = {
    heightAt: T.heightAt,
    coversBlocked(ox, oz, oy, dx, dz, len, dy) { return W.covers.blocked(ox, oz, oy, dx, dz, len, dy); },
    tanks: W.tanks, playerPos: A, playerTeam: 0,
  };

  const TICKS = 3600, EVERY = 24;
  const snapshots = [];
  const snapOne = (t) => ({
    id: t.netId, type: t.type, alive: b01(t.alive),
    x: q6(t.x), y: q6(t.y), z: q6(t.z), yaw: q6(t.yaw), pitch: q6(t.pitch), roll: q6(t.roll),
    speed: q6(t.speed), gear: t.gear, turretYaw: q6(t.turretYaw), gunPitch: q6(t.gunPitch),
    hp: q6(t.hp), disp: q6(t.disp), reloadT: q6(t.reloadT),
    mod: { track: q6(t.modules.track), engine: q6(t.modules.engine), gun: q6(t.modules.gun), ammo: q6(t.modules.ammo) },
    shots: t.stats.shots, hits: t.stats.hits, pens: t.stats.pens, dmgDealt: t.stats.dmgDealt,
    ai: { state: t.ai.state, seen: b01(t.ai.seenNow), reactT: q6(t.ai.reactT),
          lastSeenAge: t.ai.lastSeen ? q6(W.time - t.ai.lastSeen.t) : -1 },
    inp: { throttle: q6(t.ai.input.throttle), steer: q6(t.ai.input.steer),
           aimYaw: q6(t.ai.input.aimYaw), aimPitch: q6(t.ai.input.aimPitch), fire: b01(t.ai.input.fire) },
  });
  for (let k = 0; k < TICKS; k++) {
    W.time += DT; WA.time = WB.time = W.time;
    const views = { 1: WA, 2: WB };
    for (const t of [A, B]) {
      if (!t.alive) continue;
      const inp = t.ai.update(DT, views[t.netId]);
      SF.SimEngine.updateTank(t, inp, DT, envOf(t));
      if (inp.fire) SF.SimEngine.fire(t, W, muzzleOf(t), aimDirOf(t), emit);   // 与 vehicle 薄壳同位序
      t.lastFireT = (t.stats.shots > 0 && t.reloadT >= (t.reloadTotal - DT)) ? W.time : t.lastFireT;
    }
    shells.update(DT, envT);
    for (const r of respawn) r.t -= DT;
    for (const r of respawn) if (r.t <= 0 && !r.tk.alive) rebuild(r.tk);
    for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].t <= 0) respawn.splice(i, 1);
    if (k % EVERY === 0)
      snapshots.push({ k, time: q6(W.time), ev: Object.assign({}, counts), tanks: [snapOne(A), snapOne(B)] });
  }
  return {
    meta: {
      name: 'ai', generator: GENERATOR, seed,
      seed_note: 'mulberry32 在 boot() 装载内核前重置; 消费点=AI 构造(扇区/感知相位/换位时钟)、无线电/听声误差、搜剿点、换位脉冲、绕侧掷、开炮散布、判伤掷',
      source: 'client/js/ai.js (SF.AI)', loads: ['simcore.js', 'config.js', 'sim-engine.js', 'ai.js'],
      map: mb.dir, dt: DT, ticks: TICKS, sampleEvery: EVERY, snapshots: snapshots.length,
      inputs: mapInputsMeta(mb),
      input_script: [
        '双 AI 互为对手(sim-headless.js 同构): A=pz4 netId=1 id=11 (-380,-380) yaw0 team0 personality=sniper 巡逻单点;',
        'B=pz4 netId=2 id=12 (-330,-380) yawπ team1 personality=flanker 巡逻单点',
        '每 tick: time+=dt → A,B 各 ai.update(dt, 各自视图) → SimEngine.updateTank → input.fire 时 engine.fire(脚本炮口)',
        '        → shells.update → 5s 重生队列; 视图 WA/WB 交换目标池(mpTargets), 地形/掩体/坦克表共享',
        '判伤: probeTankOBB + srv-sim 同款结算 + onHurt 被打感知',
      ],
      fields: {
        snapshot: '{ k, time, ev:{累计计数}, tanks:[A,B 各自状态对象] }',
        'tanks[].ai.state': 'FSM 状态字符串 patrol/alert/combat/retreat(全等比对)',
        'tanks[].ai.seen/reactT/lastSeenAge': '点亮布尔(0/1)/反应延迟余量/最后目视年龄秒(未见过 -1)',
        'tanks[].inp.*': 'AI 输出输入(喂给 updateTank 的同一份)',
        'tanks[].mod.*': '-1 = Infinity 毁伤哨兵',
      },
    },
    snapshots,
    events: log,
  };
}

/* ================================================================
   场景 4: srvsim — SF.SrvSim 权威死斗房(l04-steppe, 2v2, 30s 时限)
   覆盖: 出生池(u16 池+房间种子洗牌)/输入 clamp/60Hz tick/快照/OBB 判伤/撞击/击杀/
         重生队列/计分/时限结算; 脚本输入直驱 + testFire 调试钩子保证击毁链走到
   ================================================================ */
function runSrvsim() {
  const seed = SEEDS.srvsim;
  const mb = mapBundle('l04-steppe');
  const SF = boot(['simcore.js', 'config.js', 'sim-engine.js', 'ai.js', 'srv-sim.js'], seed);
  const U = SF.Util;
  const players = [
    { id: 1, name: 'red-1', tank: 'pz4', team: 0 },
    { id: 2, name: 'red-2', tank: 'sherman', team: 0 },
    { id: 3, name: 'blue-1', tank: 'stug3', team: 1 },
    { id: 4, name: 'blue-2', tank: 'tiger1', team: 1 },
  ];
  const counts = { fire: 0, hit: 0, kill: 0 };
  let testFires = 0, endRows = null;
  const api = SF.SrvSim.create({
    heights: heightsOf(mb), terrainCfg: mb.terrain, coversRaw: mb.covers,
    seed: ROOM_SEED, timeLimit: 30,
    players,
    onEvent(k) { if (counts[k] !== undefined) counts[k]++; },
    onEnd(rows) { endRows = rows; },
  });

  const ids = players.map(p => p.id);
  const nearestEnemy = (t) => {
    let best = null, bd = 1e9;
    for (const o of api.tanks.values()) {
      if (o.team === t.team || !o.alive) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  // 脚本输入(数组 5 元组, 过 clampInput): 朝最近敌推进/拉开, 瞳向敌, 上膛且 <260m 就开火
  const dmInput = (t) => {
    const e = nearestEnemy(t);
    if (!e) return [0, 0, t.yaw, 0, 0];
    const want = Math.atan2(e.x - t.x, e.z - t.z);
    const d = Math.hypot(e.x - t.x, e.z - t.z);
    const steer = U.clamp(U.angDiff(t.yaw, want) * 2.5, -1, 1);
    const throttle = d > 60 ? 1 : (d < 35 ? -0.5 : 0);
    const fire = (t.reloadT <= 0 && d < 260) ? 1 : 0;
    return [throttle, steer, want, 0.02, fire];
  };

  const TICKS = 1830, EVERY = 20;   // 1830>1800: 让 timeLeft 浮点累减确切过零 → finish(false) 分支走到
  const snapshots = [];
  for (let k = 0; k < TICKS; k++) {
    for (const id of ids) {
      const t = api.tanks.get(id);
      if (t && t.alive) api.setInput(id, dmInput(t));
    }
    if (k % 90 === 45) {   // 调试钩子点射(确定性): 保证 OBB 判伤/击毁/计分链走到
      for (const id of [1, 3]) {
        const from = api.tanks.get(id);
        if (!from || !from.alive) continue;
        const e = nearestEnemy(from);
        if (e && api.testFire(id, e.netId) === true) testFires++;
      }
    }
    api.tick(DT);
    if (k % EVERY === 0) {
      const s = api.snapshot();
      snapshots.push({ k, st: s.st, timeLeft: q6(api.timeLeft), finished: b01(api.finished),
        ev: Object.assign({}, counts), testFires,
        tnRows: ids.map(id => s.tn[id]), sc: ids.map(id => api.scores.get(id) | 0) });
    }
  }
  const result = { finished: b01(api.finished), win: b01(api.__win), scoreRows: api.scoreRows() };
  /* —— coop 段(阶段4 权威分支): 波次生成(Math.random 重)/AI 直读世界/波间维修/补给空投/失败宽限 ——
     上游已知缺陷(原样记录, 直译须同构, 见 SPEC §srvsim 已知行为): srv-sim.js:241 makeJudge(dispatch)
     按值捕获的是基础出口, :278 的全功能版(kill→计分+重生)只挂在外层变量上 → dm 的 shell/ram 击杀
     不进计分也不进重生队列(onEvent 计数不受影响)。本 fixture 忠实记录现状。 */
  const coopSeed = ROOM_SEED + 1;
  // 波间维修窗拉长为 60s(地图值 4s): ①空投落在随机人类 35~100m 环上而两人类各据一方, 窗开时最近
  // 掉落普遍 200m+; ②上游已知缺陷: tick() 与 checkWaveCoop 各扣一次 repairT(双扣, 见 commit
  // 53d043f 已知遗留), 实际窗=duration/2 —— 60 传入得 30s 实效 ≈ 330m 行程, 才接得住 pkGet/pkApply。
  // 夹具显式 create 参数(非内核改动), meta 记录实际传值与双扣事实
  const coopRepair = Object.assign({}, mb.repair, { duration: 60 });
  const coopPlayers = [
    { id: 1, name: 'h1', tank: 'pz4', team: 0 },
    { id: 2, name: 'h2', tank: 'sherman', team: 0 },
  ];
  const coopIds = coopPlayers.map(p => p.id);
  const coopCounts = { fire: 0, hit: 0, kill: 0, aiWave: 0, pkGet: 0 };
  const coopLog = [];
  let coopTestFires = 0, coopEnd = null;
  const SF2 = boot(['simcore.js', 'config.js', 'sim-engine.js', 'ai.js', 'srv-sim.js'], seed);
  const coopApi = SF2.SrvSim.create({
    heights: heightsOf(mb), terrainCfg: mb.terrain, coversRaw: mb.covers,
    seed: coopSeed, mode: 'coop',
    waves: mb.waves, repairWaves: coopRepair, hasModel: () => true,
    players: coopPlayers,
    onEvent(k, d) {
      if (coopCounts[k] !== undefined) coopCounts[k]++;
      if (k === 'aiWave') coopLog.push(['aiWave', d.list.map(e => [e.id, e.type])]);
      else if (k === 'kill') coopLog.push(['kill', d.id, d.by]);
      else if (k === 'pkGet') coopLog.push(['pkGet', d.id, d.by, d.type]);
    },
    onEnd(rows) { coopEnd = rows; },
  });
  const nearestFoe = (t) => {
    let best = null, bd = 1e9;
    for (const o of coopApi.tanks.values()) {
      if (o.team === t.team || !o.alive || o.netId < 100) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  const nearestPk = (t) => {   // 波间无敌时取最近落地空投(snapshot().pk 只含已落地的), 引 pkGet/pkApply 分支
    const s = coopApi.snapshot();
    let best = null, bd = 1e9;
    for (const r of (s.pk || [])) {
      const d = Math.hypot(r[2] - t.x, r[3] - t.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  };
  const coopInput = (t) => {
    const e = nearestFoe(t);
    let aim = e, firing = false;
    if (e) firing = (t.reloadT <= 0 && Math.hypot(e.x - t.x, e.z - t.z) < 260);
    else {
      const p = nearestPk(t);
      if (p) aim = { x: p[2], z: p[3] };
    }
    if (!aim) return [0, 0, t.yaw, 0.02, 0];
    const want = Math.atan2(aim.x - t.x, aim.z - t.z);
    const d = Math.hypot(aim.x - t.x, aim.z - t.z);
    return [d > 6 ? 1 : (d < 3 ? -0.5 : 0), U.clamp(U.angDiff(t.yaw, want) * 2.5, -1, 1), want, 0.02, firing ? 1 : 0];
  };
  const coopEnemies = () => {
    let alive = 0, total = 0; const types = [];
    for (const o of coopApi.tanks.values())
      if (o.netId >= 100) { total++; types.push([o.netId, o.type, b01(o.alive)]); if (o.alive) alive++; }
    return { alive, total, types };
  };
  const COOP_TICKS = 7200, COOP_EVERY = 80;   // 120s: 双扣折半后的 30s 实效窗 + 两波清剿都装得下; 90 snapshot
  const coopSnapshots = [];
  for (let k = 0; k < COOP_TICKS; k++) {
    for (const id of coopIds) {
      const t = coopApi.tanks.get(id);
      if (t && t.alive) coopApi.setInput(id, coopInput(t));   // 首条 input 触发第 0 波生成
    }
    if (k % 90 === 45) {
      for (const id of coopIds) {
        const from = coopApi.tanks.get(id);
        if (!from || !from.alive) continue;
        const e = nearestFoe(from);
        if (e && coopApi.testFire(id, e.netId) === true) coopTestFires++;
      }
    }
    coopApi.tick(DT);
    if (k % COOP_EVERY === 0) {
      const s = coopApi.snapshot();
      const en = coopEnemies();
      coopSnapshots.push({ k, st: s.st, wv: s.wv || null, rp: s.rp === undefined ? -1 : s.rp,
        pk: (s.pk || []).map(r => r.slice()), dtKeys: Object.keys(s.dt || {}).map(Number).sort((a, b) => a - b),
        humans: coopIds.map(id => s.tn[id]), enemiesAlive: en.alive, enemiesTotal: en.total,
        enemyTypes: en.types, ev: Object.assign({}, coopCounts), testFires: coopTestFires });
    }
  }
  const coopResult = { finished: b01(coopApi.finished), win: b01(coopApi.__win), scoreRows: coopEnd };
  return {
    meta: {
      name: 'srvsim', generator: GENERATOR, seed,
      seed_note: '全局 mulberry32 在 boot() 前重置; dm 段消费点=重生取点 rebuild/判伤掷/开炮散布, coop 段另含波次生成/空投/AI 构造; 出生池洗牌走房间内 mulberry32(roomSeed) 独立流(srv-sim.js:76-89)',
      source: 'client/js/srv-sim.js (SF.SrvSim)', loads: ['simcore.js', 'config.js', 'sim-engine.js', 'ai.js', 'srv-sim.js'],
      map: mb.dir, dt: DT, ticks: TICKS, sampleEvery: EVERY, snapshots: snapshots.length,   // dm 段; coop 段参数见 meta.coop
      dm: { seed: ROOM_SEED, timeLimit: 30,
        players: players.map(p => ({ id: p.id, name: p.name, tank: p.tank, team: p.team })) },
      coop: { seed: coopSeed, ticks: COOP_TICKS, sampleEvery: COOP_EVERY, snapshots: coopSnapshots.length,
        players: coopPlayers, waves: mb.waves, repairWaves: coopRepair,
        repairWaves_note: 'duration 由地图值 4 拉长为 30(夹具 create 参数): 空投环 35~100m 而窗开时最近掉落普遍 200~300m 外, 短窗接不住 pkGet/pkApply 分支',
        known_behavior: 'srv-sim.js:241 makeJudge(dispatch) 按值捕获基础事件出口, :278 全功能版(kill→计分+重生)只挂外层变量 —— dm 的 shell/ram 击杀不加分不重生(onEvent 计数照走); coop 的 AI 车被击杀同样经 judge, 但 kill 出口 onEvent 照发。夹具原样记录, MoonBit 直译须同构(含此缺陷)',
        coop_timeLimit_note: 'coop 分支 timeLimit=9999 写的是未声明的隐式全局(srv-sim.js:573), 局部 timeLeft 保持 create 的默认 180 → 快照 st 恒 180, 原样记录' },
      inputs: mapInputsMeta(mb),
      input_script: [
        'dm: 每 tick 对每个存活玩家 setInput(5 元组数组, 过 clampInput): 最近存活敌为参照,',
        '  [throttle = 距离>60?1:(距离<35?-0.5:0), steer = clamp(angDiff(yaw,方位)·2.5, -1, 1), aimYaw=方位, aimPitch=0.02, fire = reloadT<=0 且 距离<260]',
        'dm k%90==45: id∈{1,3} 调 api.testFire(id, 最近敌)(确定性钩子: 移至敌 25m 处点射); 1830 tick 后 timeLimit 到 → finish(false)',
        'coop: 玩家 id 1/2(team0), 输入同款但参照=最近存活敌(netId>=100); 首条 setInput 触发第 0 波;',
        'coop k%90==45: 两家对最近敌 testFire; 3600 tick(60s) 内走 波次→维修(4s)→第 1 波→结算/宽限分支',
      ],
      fields: {
        snapshots: 'dm 段: { k, st, timeLeft, finished, ev:{fire/hit/kill 累计}, testFires, tnRows:[4 个 14 字段行], sc:[4 家击杀数] }',
        'tnRows 列序': '[x, z, y, yaw, turretYaw, gunPitch, speed, hp(round), alive, reloadT, reloadTotal, clipLeft, pitch, roll](房内 toFixed 量化, 原样)',
        coopSnapshots: 'coop 段: { k, st, wv:[波次,波总数,波名,人类击杀,累计刷出], rp(波间维修剩余秒,无 -1), pk:[[id,typeIdx,x,z]], dtKeys(被锁定表键升序), humans:[2 个 14 字段行], enemiesAlive/Total, enemyTypes:[[netId,type,alive]], ev:{fire/hit/kill/aiWave/pkGet}, testFires }',
        coopLog: 'coop 事件流水: [aiWave [id,type]...] / [kill id by] / [pkGet id by type]',
        result: 'dm 结束态 {finished, win, scoreRows}; coopResult: coop 结束态 {finished, win, scoreRows(onEnd)}',
      },
    },
    snapshots,
    coopSnapshots,
    coopLog,
    result,
    coopResult,
  };
}

/* ---------- meta.inputs 公共段(地图数据内嵌说明) ---------- */
function mapInputsMeta(mb) {
  return {
    map: mb.dir,
    terrain_cfg: mb.terrain,
    heights_u16_le_b64: mb.heightsB64,
    heights_u16_layout: `Uint16Array ${mb.u16.length} = ${mb.u16.length ** 0.5 | 0}x${Math.sqrt(mb.u16.length)} 行主序(j*res+i), LittleEndian base64`,
    heights_formula: 'h[i] = fround(fround(u16[i]/65535) * maxHeight) —— 两级 f32 舍入逐位复刻 tools/ai-bench.js loadPNG16(中间 Float32Array)+loadTerrain(目标 Float32Array)',
    covers_raw: mb.covers,
    covers_note: 'map.json covers 原样(coverCol 的输入; coverCol 移植见 srv-sim.js:23-45 / ai-bench.js:216-238)',
  };
}

/* ---------- NaN/undefined 泄漏扫描: stringify 前的最后一道闸(NaN 会被 JSON 变 null, 静默失真) ---------- */
function assertNoBad(o, pathStr, bad) {
  if (bad.length > 4) return;
  if (typeof o === 'number') {
    if (Number.isNaN(o)) bad.push(`${pathStr}=NaN`);
    return;
  }
  if (o === undefined) { bad.push(`${pathStr}=undefined`); return; }
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) assertNoBad(o[i], `${pathStr}[${i}]`, bad); return; }
  if (o && typeof o === 'object') for (const k in o) assertNoBad(o[k], `${pathStr}.${k}`, bad);
}

/* ---------- 主流程: 每场景双跑逐字节互验 → 写盘 / --check ---------- */
const SCENARIOS = [
  ['simcore', runSimcore, 'simcore.json'],
  ['simengine', runSimengine, 'simengine.json'],
  ['ai', runAi, 'ai.json'],
  ['srvsim', runSrvsim, 'srvsim.json'],
];

function main() {
  const check = process.argv.includes('--check');
  fs.mkdirSync(OUTDIR, { recursive: true });
  const t0 = Date.now();
  const summary = { ok: true, mode: check ? 'check' : 'write', files: {}, deterministic: true };
  for (const [name, fn, file] of SCENARIOS) {
    let a, b, ja, jb;
    try {
      a = fn(); b = fn();
      ja = JSON.stringify(a); jb = JSON.stringify(b);
    } catch (e) {
      console.error(`*** ${name} 生成失败: ${e.message}`);
      process.exit(1);
    }
    if (ja !== jb) {
      // 首个分歧字节定位(辅助排查, 不改判定的严格性)
      let i = 0; while (i < ja.length && ja[i] === jb[i]) i++;
      console.error(`*** ${name} 同种子双跑不一致 @${i}: ...${ja.slice(Math.max(0, i - 60), i + 60)} vs ...${jb.slice(Math.max(0, i - 60), i + 60)}`);
      process.exit(1);
    }
    const bad = [];
    assertNoBad(a, name, bad);
    if (bad.length) {
      console.error(`*** ${name} 夹具含 NaN/undefined: ${bad.slice(0, 5).join('; ')}`);
      process.exit(1);
    }
    const bytes = Buffer.from(ja + '\n', 'utf8');
    const fp = path.join(OUTDIR, file);
    if (check) {
      if (!fs.existsSync(fp)) { console.error(`*** --check: 缺 ${fp}, 先不带 --check 跑一次生成`); process.exit(1); }
      const onDisk = fs.readFileSync(fp);
      if (!onDisk.equals(bytes)) {
        let i = 0; while (i < onDisk.length && i < bytes.length && onDisk[i] === bytes[i]) i++;
        console.error(`*** --check: ${file} 与重算不一致 @${i} (盘上 ${onDisk.length}B vs 重算 ${bytes.length}B)`);
        process.exit(1);
      }
    } else {
      fs.writeFileSync(fp, bytes);
    }
    const snapN = a.snapshots.length;
    if (snapN < 50) { console.error(`*** ${name} snapshot 数 ${snapN} < 50`); process.exit(1); }
    summary.files[file] = { bytes: bytes.length, snapshots: snapN, seed: a.meta.seed };
    console.error(`[${name}] ${file} ${bytes.length}B snapshots=${snapN} seed=${a.meta.seed} 耗时 ${Date.now() - t0}ms`);
  }
  summary.elapsedMs = Date.now() - t0;
  console.log(JSON.stringify(summary));
  process.exit(0);
}
main();
