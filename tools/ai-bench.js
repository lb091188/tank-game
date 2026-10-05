#!/usr/bin/env node
// ai-bench.js — 无头 AI 确定性测试台(零 npm 依赖, node tools/ai-bench.js 直接跑)
//
// 测什么: 加载 client/js 的 simcore.js → config.js → ai.js 三件套(ai-worker.js:6-9 的 window 注入同款,
// node 里用 new Function('window',src)(globalThis) 组装), 用真 heightmap.png + map.json 掩体碰撞表
// (models.js buildCover 的纯数据子集复刻)搭"复制品世界", SF.AI 原封不动跑在桩坦克上,
// 对手是同一套运动学驱动的固定技能脚本车(参考机器人), 命中/装甲用台内简化裁判(双方共用同一套)。
// 只读不改 ai.js / config.js / simcore.js —— 本台测到的就是被测代码的真实行为基线。
//
// 指标口径(stdout 末行 JSON, 全部以 AI 车为被测对象, 按 tick×6=10Hz 采样, 跨场景聚合;
// 混编小队场景按"逐车×逐采样点"拆样本, 与 1v1 同权并入):
//   fireLatencyS    每次开炮的迟滞: 从"就绪窗口"打开(AI 看见目标 && 反应时间过 && 炮口对准±0.05rad
//                   && 装填完毕, 不含缩圈条件)到该窗口内真正 input.fire=true 的平均秒数。
//                   衡量"能打了到真开火"的决策迟滞(缩圈纪律越严该值越大, 换来命中率)。
//                   整局无开火样本时记 10s(惩罚性上限)。
//   anglingOkPct    交战采样(state combat/retreat && seenNow)中, 车体纵轴与"自车→最近存活射手"方位的
//                   夹角 ∈ [20°,35°](摆角卖甲理想扇区)的时间占比%。
//   sideExposedPct  同上采样中, 夹角 ∈ (60°,120°](车体侧面朝敌)的时间占比%。越大越糟。
//   coverUsePct     装填期采样(交战/撤退中 && reloadT>0)中, 自车眼高(2m)到最近存活射手的地形+硬掩体
//                   通视被挡(反斜面或掩体后)的时间占比%。换弹期藏住自己=装填不被打断。
//   bandPct         交战采样中, 与锁定目标距离落在性格 band[lo,hi] 内的时间占比%。
//   dmgRatio        全场景累计: AI 对机器人输出伤害 / max(1, 机器人对 AI 输出伤害)。
//   firstShotHitPct 每车每段交战回合(非 combat → combat 跳变)的首发弹命中目标整车(含未击穿)的占比%。
//   survivalPct     各场景结束时 AI 车仍存活的占比%(逐车计: 混编小队按每车拆样本; 一方全灭即提前
//                   结束该场景 —— 1v1 场景即旧的"任一方死亡即止"语义)。
//   focusFireIdx    集火指数 0~1: 采样门 = 交战 AI 车 ≥2 && 存活机器人 ≥2(1v1 场景只有 1 辆 AI 车
//                   恒不进门, 只有混编小队 S4 贡献样本; 敌只剩 1 台时全队必然同靶, 计入会虚高, 故关门)。
//                   每次采样统计各交战 AI 车的锁定目标 —— 取 ai.js nearestTarget 的实际瞄准/开火对象
//                   (= 最近存活敌车, 台内 pickTarget 同源复刻, 单一事实源)—— 的分布,
//                   该次占比 = 锁定同一目标的最大车数 ÷ 参与锁定的交战车数(可用射车), 对采样次数求均值。
//   roleFitPct      角色站位符合度%: 仅混编小队场景采样(1v1 无队形可言)。结构性无站可达的采样从
//                  分母剔除并输出 roleCut(S5 走廊墙体 x≈-175~-188/z243~333: 翼侧点全被墙挡或直线
//                  穿墙, 绕行>2×半径 —— 指标量角色纪律不罚地图拓扑; 判据=任何合法站位都不存在)。
//                  几何参考: E=存活机器人质心,
//                   前线 dFront=存活 AI 车到 E 的最小距离, 轴线=AI 车中质心→E。交战采样中按车型判位:
//                   HT 顶线 = d ≤ dFront+30m; TD 二线 = 落后前线纵深 d−dFront ∈ [30,150]m;
//                   MT 翼侧机动 = 偏离轴线横向 ≥25m 且 |车速| ≥1.5m/s(站位+在动才算翼侧压制)。
//   tdSurvivalPct   TD 车型存活率%: 混编小队场景结束时 TD 类 AI 车存活数 ÷ 登场数 —— 二线站位对
//                   脆皮歼击车的保护效果。仅 S4 的 TD 计入(样本数=S4 的 TD 车数, 粒度粗但方向真实)。
//
// 总分 score(0~100) = Σ 权重×归一化, 权重(Σ=100)与及格线见 THRESH(线性插值, good=满分, bad=零分;
// sideExposedPct 反向): fireLatencyS 10 / anglingOkPct 10 / sideExposedPct 8 / coverUsePct 10 /
// bandPct 8 / dmgRatio 12 / firstShotHitPct 8 / survivalPct 8 / focusFireIdx 10 / roleFitPct 10 /
// tdSurvivalPct 6 —— 三项新指标(集火/站位/TD 存活)合计 26 分, 全部只有混编场景供样本, 权重即其
// 在"协同作战"维度的占比; 旧指标权重等比压缩但全部保留。
// 分数用于同版本代码回归比较, 不与真机(THREE Raycaster 打 GLB 部位网格)绝对等价 —— 台内裁判是
// 可计算子集(部位掷点+静态装甲表+等效甲/跳弹/±25%浮动, 见 resolveShot)。
//
// 场景(共 90s 模拟时长 ≤ 90s; 三种性格 flanker/hold/sniper 全出场; 原 1v1 三场景保留, 时长 28→18s
// 给混编场景腾预算):
//   S1 平地对射   18s l04-steppe 开阔谷地, AI=pz4/flanker vs 机器人 pz4 环绕 90m 对射(镜像局)
//   S2 村庄掩体   18s l01 村缘, AI=stug3/hold 蹲点 vs 机器人 pz4 环绕 90m, 房群间歇遮蔽弹道
//   S3 反斜面狙击 18s l01 南护脊缓垄, AI=pz4/sniper 蹲反斜面 vs 机器人 pz4 定点 133m;
//                 距离带(190-300m)与通视(≤135m)被地形二选一 → 逼出 peek/缩回反斜面循环
//   S4 混编小队   36s l01 村缘正面: AI 小队 = 虎I(HT/flanker 顶线) + T-34(MT/flanker 翼侧)
//                 + 三号突击炮(TD/sniper·hold) + SU-85(TD/sniper·hold) vs 3 台 pz4 参考机器人
//                 (各自环绕 90m) —— 集火/角色站位/TD 二线存活三项指标的全部样本出自本场景。
//                 TD 用 sniper 性格(带 190-300m, 不被迫贴脸) + hold 钳位出生点 30m = 蹲二线;
//                 机器人选靶与 AI 同口径(最近存活敌), 火力自然压向顶线车 → 测出二线保护效果。
//
// 确定性: 进程入口用 mulberry32(SEED) 全局替换 Math.random(先于任何游戏脚本加载);
// ai.js 全部随机(合围扇区/感知相位/无线电误差/搜剿点/换位)都走这一条流, 台内命中裁判(部位掷点/
// ±25%浮动/散布)同流取数 —— 同种子重跑输出逐字节一致(台内自跑两遍互验, 不一致则退出码 1)。
// 过程日志全走 stderr; stdout 末行(唯一一行)是 JSON:
//   {"score":..,"metrics":{fireLatencyS,anglingOkPct,sideExposedPct,coverUsePct,bandPct,
//    dmgRatio,firstShotHitPct,survivalPct,focusFireIdx,roleFitPct,tdSurvivalPct},
//    "scenarios":[...]}(scenarios 为逐场景明细, aiSide/robots 为逐车数组)
// 调试: AI_BENCH_TRACE=1 时在 stderr 打每发弹的裁判过程(遮挡/脱靶量/穿深)与逐秒战场快照。
// 复用: require() 本模块不自动开跑(module.exports 场景表/地形加载/掩体表等, 供位置探针复用;
//   直接 node 运行才是完整基准)。
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const CJS = path.join(ROOT, 'client', 'js');
const MAPS = path.join(ROOT, 'client', 'assets', 'maps');
const SEED = 20261004;
const SAMPLE_EVERY = 6;          // 每 6 tick 采样一次 = 10Hz

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

/* ---------- 加载三件套(顺序必须 simcore→config→ai; ai-worker.js:6-9 同款组装) ----------
   每遍基准前整包重载: config.js 闭包里的 SF.Bus 是全局事件总线, SF.AI 构造器会往里挂
   无线电/听声监听 —— 跨遍复用会让上一遍的死车监听器偷吃 Math.random 扰乱确定性, 必须换新。 */
globalThis.window = globalThis;
let SF = null, U = null, CFG = null;
function loadGameScripts() {
  for (const f of ['simcore.js', 'config.js', 'ai.js'])
    new Function('window', fs.readFileSync(path.join(CJS, f), 'utf8'))(globalThis);
  SF = globalThis.SF; U = SF.Util; CFG = SF.CFG;
  let W = null;
  SF.Game = { get world() { return W; } };     // ai.js nowT()/world2time() 的取时钩子(ai-worker.js:29 同款)
  SF.Game.__setWorld = (w) => { W = w; };
}
loadGameScripts();
const DT = CFG.sim.dt;
const clamp = U.clamp;
const D2R = Math.PI / 180;

/* ---------- 指标及格线/权重(线性归一: good=满分 bad=零分; sideExposed 反向) ----------
   权重 Σ=100: 旧八项 74(等比压缩自旧版 100) + 集火 10 + 站位 10 + TD 存活 6。
   三项新线标定口径: focusFireIdx bad=0.45 ≈ 3 敌时各打各的随机分散基线(期望最大重合
   ≈2/4 车), good=0.8 = 强集火(当前最近目标自然收敛实测 0.72, 留改进余量);
   roleFitPct bad=30 = 完全不守角色位, good=80 = 几乎全程在位(当前实测 76);
   tdSurvivalPct 与 survivalPct 同标尺(80=好 20=差, 样本=S4 的 TD 车数, 0/50/100 三档)。 */
const THRESH = {
  fireLatencyS:    { good: 0.8,  bad: 2.5, w: 12 },
  anglingOkPct:    { good: 45,   bad: 10,  w: 12 },
  sideExposedPct:  { good: 15,   bad: 50,  w: 6, inv: true },
  coverUsePct:     { good: 35,   bad: 5,   w: 12 },
  bandPct:         { good: 50,   bad: 15,  w: 6 },
  dmgRatio:        { good: 1.0,  bad: 0.3, w: 12 },
  firstShotHitPct: { good: 40,   bad: 5,   w: 6 },
  survivalPct:     { good: 80,   bad: 20,  w: 6 },
  focusFireIdx:    { good: 0.7,  bad: 0.3, w: 10 },
  roleFitPct:      { good: 75,   bad: 30,  w: 10 },
  tdSurvivalPct:   { good: 80,   bad: 30,  w: 8 },
};

/* ---------- 场景表(坐标为本台实探选定: grad/通视/掩体走廊均已用同款地形采样验证) ----------
   S1-S3 为 1v1(ai/robot 单数, 旧字段原样保留); S4 为混编小队(aiSide/robots 复数 + squad 标记)。 */
const SCENARIOS = [
  { id: 'S1', name: '平地对射', map: 'l04-steppe', dur: 18,
    ai: { type: 'pz4', personality: 'flanker', hold: false, pos: [-60, 80], yaw: 0 },
    robot: { type: 'pz4', pos: [-60, 210], yaw: Math.PI, move: 'orbit', orbitR: 90, orbitSide: 1,
             aimBias: 0.006, reactS: 0.5, dispMult: 1.15 } },
  { id: 'S2', name: '村庄掩体', map: 'l01-encounter', dur: 18,
    ai: { type: 'stug3', personality: 'hold', hold: true, pos: [-30, -20], yaw: 0.17 },
    robot: { type: 'pz4', pos: [0, 150], yaw: Math.PI + 0.17, move: 'orbit', orbitR: 90, orbitSide: 1,
             aimBias: 0.006, reactS: 0.5, dispMult: 1.15 } },
  { id: 'S3', name: '反斜面狙击', map: 'l01-encounter', dur: 18,
    ai: { type: 'pz4', personality: 'sniper', hold: false, pos: [0, 287], yaw: 0 },
    robot: { type: 'pz4', pos: [0, 415], yaw: Math.PI, move: 'static', aimBias: 0.006, reactS: 0.5, dispMult: 1.15 } },
  /* S4/S5 混编小队(G3): AI 桩带 id:1..n 且 netId:0 —— 复刻单机现场(线上敌车 netId 全 0,
     keyOf 必须不依赖 netId, 台上就能抓"分舷/抖动按 netId 做线上全同舷"的 A 类错误) */
  { id: 'S4', name: '村庄混编', map: 'l01-encounter', dur: 32, squad: true,
    aiSide: [
      { type: 'tiger1',  personality: 'hold',    hold: false, pos: [-65, 145], yaw: 0.6 },  // HT 顶线(25m 内 1 硬掩体)
      { type: 'cromwell', personality: 'flanker', hold: false, pos: [-80, 175], yaw: 0.4 }, // MT 翼侧(1 硬掩体)
      { type: 'su100',   personality: 'sniper',  hold: true,  pos: [-65, 175], yaw: 0.5 },  // TD 二线(2 硬掩体)
    ],
    robots: [
      { type: 'pz4', pos: [10, 160],  yaw: Math.PI - 0.9, move: 'orbit', orbitR: 90, orbitSide: 1, target: 'near',
        aimBias: 0.006, reactS: 0.5, dispMult: 1.15 },
      { type: 'pz4', pos: [-15, 195], yaw: Math.PI - 0.3, move: 'static', target: 'near',
        aimBias: 0.006, reactS: 0.5, dispMult: 1.15 },
    ] },
  { id: 'S5', name: '走廊混编', map: 'l01-encounter', dur: 32, squad: true,
    aiSide: [
      { type: 'tiger1', personality: 'hold',    hold: false, pos: [-185, 265], yaw: 0.9 },  // HT 顶线(25m 内 4 硬掩体)
      { type: 'pz4',   personality: 'flanker', hold: false, pos: [-200, 265], yaw: 0.9 },   // MT 翼侧(1; pz4=MT 不挂 HT 线)
      { type: 'pz4',   personality: 'flanker', hold: false, pos: [-215, 265], yaw: 0.9 },   // MT 翼侧(对舷)
      { type: 'stug3', personality: 'sniper',  hold: true,  pos: [-200, 280], yaw: 0.9 },   // TD 二线(2 硬掩体)
    ],
    robots: [
      { type: 'pz4', pos: [-90, 300], yaw: Math.PI - 0.9, move: 'orbit', orbitR: 90, orbitSide: 1, target: 'near',
        aimBias: 0.006, reactS: 0.5, dispMult: 1.15 },
      { type: 'pz4', pos: [-70, 260], yaw: Math.PI - 0.6, move: 'static', target: 'near',
        aimBias: 0.006, reactS: 0.5, dispMult: 1.15 },
    ] },
];

/* ---------- PNG16 手解(check-spawns.js:19-47 同款) → SF.Sim.makeTerrain ---------- */
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

const terrainCache = {};
function loadTerrain(dir) {
  if (terrainCache[dir]) return terrainCache[dir];
  const J = JSON.parse(fs.readFileSync(path.join(MAPS, dir, 'map.json'), 'utf8'));
  const { data } = loadPNG16(path.join(MAPS, dir, 'heightmap.png'));
  const heights = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) heights[i] = data[i] * J.terrain.maxHeight;
  return terrainCache[dir] = { J, T: SF.Sim.makeTerrain(heights, J.terrain) };
}

/* ---------- 掩体碰撞表: models.js buildCover 的纯数据子集(零 THREE)逐类型复刻 ----------
   校验: l01 → n=411 / blocksShells=94 / 草本(blocksSpot&&!blocksShells)=208, 与主线程 CoverField 同构 */
function coverCol(c) {
  const s = c.scale || 1;
  const OBB = (hx, hz) => ({ shape: 'box', hx, hz, yaw: c.yaw || 0, r: Math.hypot(hx, hz) });
  let col = { type: c.type, blocksMove: true, blocksShells: true, x: c.x, z: c.z, r: 2, h: 3, shape: 'circle', yaw: c.yaw || 0 };
  switch (c.type) {
    case 'house': Object.assign(col, OBB(3.5 * s, 2.75 * s), { h: 3.4 + 1.8 * s }); break;      // models.js:169
    case 'barn': Object.assign(col, OBB(5.5 * s, 3.75 * s), { h: 5 + 2.2 * s }); break;         // models.js:288
    case 'ruin': Object.assign(col, OBB(3.2 * s, 2.4 * s), { h: 4.5 }); break;                  // models.js:321
    case 'wall': Object.assign(col, OBB(3.5 * s, 0.35 * s), { h: 3.1 }); break;                 // models.js:328
    case 'hedge': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
      Object.assign(col, OBB(3.0 * s, 1.1 * s), { h: 3.2 }); break;                             // models.js:184 软草本
    case 'haystack': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
      col.r = 2.6 * s; col.h = 3.6 * s; break;                                                  // models.js:337
    case 'tree': col.blocksShells = false; col.r = 0.9; col.h = 1.6; break;                     // models.js:261 树干挡车不挡弹
    case 'trap': col.blocksShells = false; col.r = 1.2; col.h = 1.2; break;                     // models.js:230 刺猬
    case 'wreck': col.blocksShells = false; col.blocksSpot = true;
      Object.assign(col, OBB(1.75, 3.1), { h: 2.4 }); break;                                    // models.js:372 残骸
    case 'bush': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
      col.r = 1.6 * s; col.h = 1.9; break;                                                      // models.js:391 草丛
    case 'rock': col.r = 2.5 * s; col.h = 3.3 * s; break;                                       // models.js:215
  }
  return col;
}

/* ---------- 桩坦克字段(ai.js/simcore 会读的完整清单, 见 ai-worker.js:56-59 桩同构) ---------- */
function mkTank(type, opts) {
  const spec = CFG.vehicles[type];
  return {
    type, spec,
    x: opts.x, z: opts.z, y: 0, yaw: opts.yaw,
    speed: 0, velX: 0, velZ: 0, lastYawRate: 0, lastTurretRate: 0,
    turretYaw: opts.yaw, gunPitch: 0,
    reloadT: 1, reloadTotal: 1,                  // 出生装填宽限(vehicle.js reset 同款)
    disp: spec.dispersion.max,
    modules: { track: 0, engine: 0, gun: 0, ammo: 0 },
    parts: { noTurret: spec.gunArc !== undefined },   // 固定战斗室(TD 歼击车)以 gunArc 判定
    hp: spec.hp, alive: true,
    team: opts.team, netId: opts.netId, isPlayer: !!opts.isPlayer,
    id: opts.id !== undefined ? opts.id : undefined,   // AI 桩稳定键(worker 复制品 r.id 的台侧同构)
    lastFireT: -99,
    aimBias: 0,                                  // 参考机器人的恒定瞄准偏角(技能档)
    stats: { shots: 0, hits: 0, dmg: 0 },
    input: { throttle: 0, steer: 0, aimYaw: opts.yaw, aimPitch: 0, fire: false },
  };
}

/* ---------- 双方选靶口径(与 ai.js nearestTarget 同构: 最近存活敌, 先到先得打破平手) ----------
   AI 车的瞄准/开火对象、台内裁判的受弹方、集火/交战几何采样的"锁定目标"全部走这里 —— 单一事实源 */
function pickTarget(shooter, world) {
  const arr = shooter.team === 1 ? world.mpTargets : world.enemies;
  let best = null, bd = 1e9;
  for (const t of arr)
    if (t.alive) { const d = U.dist2d(shooter.x, shooter.z, t.x, t.z); if (d < bd) { bd = d; best = t; } }
  return best;
}

/* ---------- 掩体推挤(models.js collideTank 圆/OBB 分支的移植, 纯数学) ---------- */
function collideCovers(t, world) {
  let nx = t.x, nz = t.z;
  const hw = t.spec.sample.w, hl = t.spec.sample.l;
  const circ = Math.hypot(hw, hl);
  const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
  for (const c of world.covers.list) {
    if (!c.blocksMove) continue;
    const dx0 = nx - c.x, dz0 = nz - c.z, rr = c.r + circ;
    if (dx0 * dx0 + dz0 * dz0 > rr * rr) continue;
    if (c.shape === 'box') {
      const push = U.obbPushOut({ x: nx, z: nz, yaw: t.yaw, hx: hw, hz: hl }, c);
      if (push) { nx += push[0]; nz += push[1]; }
    } else {
      const rx = c.x - nx, rz = c.z - nz;
      const lx = cs * rx - sn * rz, lz = sn * rx + cs * rz;         // 掩体圆心→车体局部系
      const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hl, Math.min(hl, lz));
      const ddx = lx - qx, ddz = lz - qz;
      const d = Math.hypot(ddx, ddz);
      if (d < 1e-6) {
        const bx = nx - c.x, bz = nz - c.z, bl = Math.hypot(bx, bz) || 1;
        nx += bx / bl * (c.r + hl); nz += bz / bl * (c.r + hl);
        continue;
      }
      if (d < c.r) {
        const k = (c.r - d) / d, px = -ddx * k, pz = -ddz * k;
        nx += cs * px + sn * pz; nz += -sn * px + cs * pz;
      }
    }
  }
  return [nx, nz];
}

/* ---------- 简化运动学(vehicle.js:110-150/257-287 可计算子集) ----------
   油门→目标速度按 accel 收敛(无变速箱), 车体回转含高速限舵与急转掉速, 断带定住 6s,
   发动机损毁极速×0.55; 炮塔伺服(歼击车 ±gunArc 射界钳制); 缩圈/扩圈/装填与真机同式 */
function stubUpdate(t, dt, world) {
  if (!t.alive) return;
  const S = t.spec;
  const engSlow = t.modules.engine > 0 ? CFG.armor.modules.engine.slow : 1;
  const maxF = S.maxSpeed * engSlow, maxR = maxF * S.reverseRatio;

  if (t.modules.track > 0) {                       // 履带断裂: 定点维修(CFG 6s), 期间无法移动
    t.modules.track = Math.max(0, t.modules.track - dt);
    t.speed = U.moveToward(t.speed, 0, S.brake * dt);
    t.lastYawRate = 0;
  } else {
    const th = t.input.throttle;
    if (th > 0) t.speed = Math.min(maxF * th, t.speed + S.accel * dt);
    else if (th < 0) t.speed = Math.max(-maxR, t.speed - S.accel * dt);
    else t.speed = U.moveToward(t.speed, 0, S.coastDrag * dt);
    const yawRate = S.hullTraverse * t.input.steer * clamp(1 - Math.abs(t.speed) / (maxF * 2), 0.55, 1);
    t.yaw += yawRate * dt;
    t.lastYawRate = yawRate;
    if (Math.abs(t.speed) > 0.5) t.speed -= t.speed * Math.abs(t.input.steer) * 0.4 * dt;   // 急转掉速
  }

  // 爬坡门: 目标地面梯度超爬坡极限则进不去(与 maxSlope 语义一致; 台内不做滑落)
  const mx = t.x + Math.sin(t.yaw) * t.speed * dt, mz = t.z + Math.cos(t.yaw) * t.speed * dt;
  if (world.terrain.gradAt(mx, mz) > Math.tan(CFG.sim.maxSlope) * 1.02) t.speed = 0;
  else {
    t.x = clamp(mx, -world.terrain.half + 16, world.terrain.half - 16);
    t.z = clamp(mz, -world.terrain.half + 16, world.terrain.half - 16);
  }
  [t.x, t.z] = collideCovers(t, world);
  t.y = world.terrain.heightAt(t.x, t.z);
  t.velX = Math.sin(t.yaw) * t.speed;
  t.velZ = Math.cos(t.yaw) * t.speed;

  // 炮塔伺服(歼击车固定战斗室: 射界内横摆, vehicle.js:257-266 同式)
  const arc = S.gunArc !== undefined ? S.gunArc : Math.PI;
  const before = t.turretYaw;
  if (t.parts.noTurret) {
    t.turretYaw = t.yaw + clamp(U.angDiff(t.yaw, t.turretYaw), -arc, arc);
    const layYaw = clamp(U.angDiff(t.yaw, t.input.aimYaw), -arc, arc);
    t.turretYaw = U.angMoveToward(t.turretYaw, t.yaw + layYaw, Math.max(S.turretTraverse, 0.4) * dt);
  } else {
    t.turretYaw = U.angMoveToward(t.turretYaw, t.input.aimYaw, S.turretTraverse * dt);
  }
  t.lastTurretRate = U.angDiff(before, t.turretYaw) / dt;
  t.gunPitch = U.moveToward(t.gunPitch, clamp(t.input.aimPitch, S.gunDepression, S.gunElevation), 1.2 * dt);

  // 缩圈/扩圈(vehicle.js:282-287 同式)
  const D = S.dispersion;
  const moveK = Math.abs(t.speed) / S.maxSpeed * D.move;
  const turnK = Math.min(1, Math.abs(t.lastYawRate) / S.hullTraverse) * D.hullTurn;
  const turK = Math.min(1, Math.abs(t.lastTurretRate) / Math.max(S.turretTraverse, 0.01)) * D.turretTurn;
  const target = clamp(D.base * (1 + moveK + turnK + turK), D.base, D.max);
  t.disp += (target - t.disp) * (1 - Math.exp(-dt * 2.2 / D.aimTime));
  t.reloadT = Math.max(0, t.reloadT - dt);

  if (t.input.fire && t.reloadT <= 0) fireShot(t, world);
}

/* ---------- 开炮(vehicle.js:368-385 子集) + 台内即时弹道裁判 ---------- */
function fireShot(t, world) {
  const S = t.spec;
  t.reloadT = S.gun.reload * (t.modules.ammo > 0 ? CFG.armor.modules.ammo.reloadMult : 1);
  t.reloadTotal = t.reloadT;
  t.stats.shots++;
  t.lastFireT = world.time;
  const dispAtShot = t.disp;                    // 弹散布用开炮前圈(真机 combat.js 先取 disp 再扩圈)
  t.disp = Math.min(S.dispersion.max, S.dispersion.base + S.dispersion.fire);   // 开炮瞬间扩圈
  SF.Bus.emit('fire', { tank: t });                                            // AI 听声(ai.js:165)
  t._lastRes = resolveShot(t, world, dispAtShot);   // 裁判结果带回主循环(首发/迟滞记账用)
  return t._lastRes;
}

/* 部位装甲表(台内自定中间值, 对齐 build-models.js Z() 的量级): 20-60mm */
const ZONE_ARMOR = { tracks: 20, hullSide: 30, glacis: 45, turretFront: 50, hullRear: 25 };

/* 弹道地形遮挡(裸高程, combat.js 弹丸对撞 py<=heightAt 同语义, 无 spotting 的 +1.6 弹道高冗余):
   simcore.losBlocked 是点亮判定(眼高/车体高补贴), 拿来判弹会把平射弹全判成打土坡 */
function shellTerrainBlocked(T, ax, az, ay, bx, bz, by) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(d / 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (ay + (by - ay) * t <= T.heightAt(ax + (bx - ax) * t, az + (bz - az) * t)) return true;
  }
  return false;
}

/* ---------- 命中/装甲裁判(双方共用, vehicle.js takeHit:393-440 可计算子集) ----------
   受弹方 = pickTarget(最近存活敌, 与瞄准对象同源); 多车场景下即"谁的最近打谁"。
   散布: ang=disp/100×√rnd 弧度(combat.js:174 同式), 横/竖脱靶量=角×距离; 目标半宽 1.5m/半高 1.2m。
   部位掷点固定分布: tracks .10 / hullSide .30 / glacis .25 / turretFront .25 / hullRear .10。
   入射角按部位板法线: 正面板=弹向与车体朝向夹角 b; 侧板=|90°−b|; 尾板=180°−b; 履带无角度效应
   —— 摆角指标在此兑换成防护( angled 正面板 cos 变小→等效甲升, >70° 跳弹)。
   判定: eff=armor/cos(inc−归一化5°), pen×(1±0.25)≥eff 判穿, dmg×(1±0.25);
   履带打中即断(未穿=吸收0伤), 弹药架 8% ×1.6 伤, 尾板 55% 毁发动机(永久 ×0.55 极速)。 */
function resolveShot(shooter, world, dispAtShot) {
  // 多目标口径: 机器人带指定目标(_aimTgt)用指定, 其余(AI 车/旧配置)最近存活
  const tgt = (shooter._aimTgt && shooter._aimTgt.alive) ? shooter._aimTgt : pickTarget(shooter, world);
  if (!tgt || !tgt.alive) { if (process.env.AI_BENCH_TRACE) console.error(`[shot dead-tgt] ${shooter.type}#${shooter.team}`); return { hit: false }; }
  const dist = U.dist2d(shooter.x, shooter.z, tgt.x, tgt.z);
  const sy = shooter.y + 2.0;
  const ty = world.terrain.heightAt(tgt.x, tgt.z) + 1.2;
  const dx = (tgt.x - shooter.x) / dist, dz = (tgt.z - shooter.z) / dist;
  // 地形/硬掩体先吃弹(反斜面/掩体后的目标打不着 —— coverUsePct 的物理意义)
  const terrBlk = shellTerrainBlocked(world.terrain, shooter.x, shooter.z, sy, tgt.x, tgt.z, ty);
  const covT = terrBlk ? -1 : world.covers.blocked(shooter.x, shooter.z, sy, dx, dz, dist, (ty - sy) / dist);
  if (terrBlk || covT >= 0) {
    if (process.env.AI_BENCH_TRACE) console.error(`[shot blocked] ${shooter.type}#${shooter.team} d=${dist.toFixed(0)} ${terrBlk ? '地形' : '掩体@' + covT.toFixed(0) + 'm'}`);
    return { hit: false, blocked: true };
  }

  const ang = ((dispAtShot !== undefined ? dispAtShot : shooter.disp) / 100) * Math.sqrt(Math.random());
  const rot = Math.random() * Math.PI * 2;
  const latErr = U.angDiff(shooter.turretYaw, Math.atan2(tgt.x - shooter.x, tgt.z - shooter.z)) + shooter.aimBias;
  const pitchErr = shooter.gunPitch - Math.atan2(ty - sy, dist);
  const latMiss = latErr * dist + Math.cos(rot) * ang * dist;
  const verMiss = pitchErr * dist + Math.sin(rot) * ang * dist;
  if (Math.abs(latMiss) > 1.5 || Math.abs(verMiss) > 1.2) {
    if (process.env.AI_BENCH_TRACE) console.error(`[shot miss] ${shooter.type}#${shooter.team} d=${dist.toFixed(0)} disp=${(dispAtShot !== undefined ? dispAtShot : shooter.disp).toFixed(2)} latErr=${(latErr / D2R).toFixed(2)}° lat=${latMiss.toFixed(2)}m ver=${verMiss.toFixed(2)}m`);
    return { hit: false };
  }

  const r = Math.random();
  const zone = r < 0.10 ? 'tracks' : r < 0.40 ? 'hullSide' : r < 0.65 ? 'glacis' : r < 0.90 ? 'turretFront' : 'hullRear';
  const A = CFG.armor, armor = ZONE_ARMOR[zone], cal = shooter.spec.gun.cal || 75;
  const b = Math.abs(U.angDiff(tgt.yaw, Math.atan2(shooter.x - tgt.x, shooter.z - tgt.z)));
  let inc;
  if (zone === 'glacis' || zone === 'turretFront') inc = b;
  else if (zone === 'hullSide') inc = Math.abs(Math.PI / 2 - Math.min(b, Math.PI / 2));
  else if (zone === 'hullRear') inc = Math.max(0, Math.PI - b);
  else inc = 0;
  const over3 = cal > armor * 3;
  let norm = 5 * D2R; if (cal > armor * 2) norm *= 2;
  const eff = armor / Math.max(Math.cos(Math.max(0, inc - norm)), 0.05);
  const pen = shooter.spec.gun.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
  const rico = !over3 && inc > A.ricochetAngle;
  const res = { hit: true, zone, kind: 'nopen', dmg: 0 };
  shooter.stats.hits++;
  if (zone === 'tracks') {
    tgt.modules.track = A.modules.track.duration;
    if (!rico && pen >= eff) {
      res.kind = 'pen';
      res.dmg = Math.round(shooter.spec.gun.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance));
    } else res.kind = rico ? 'bounce' : 'absorb';
  } else if (rico) res.kind = 'bounce';
  else if (pen >= eff) {
    res.kind = 'pen';
    let dmg = shooter.spec.gun.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance);
    if (Math.random() < A.modules.ammo.chance) { dmg *= A.modules.ammo.dmgMult; tgt.modules.ammo = Infinity; res.module = 'ammo'; }
    else if (zone === 'hullRear' && Math.random() < A.modules.engine.rearChance) { tgt.modules.engine = Infinity; res.module = 'engine'; }
    res.dmg = Math.round(dmg);
  }
  if (res.dmg > 0) { tgt.hp -= res.dmg; shooter.stats.dmg += res.dmg; }
  if (process.env.AI_BENCH_TRACE) console.error(`[shot HIT] ${shooter.type}#${shooter.team} d=${dist.toFixed(0)} disp=${(dispAtShot !== undefined ? dispAtShot : shooter.disp).toFixed(2)} inc=${(inc / D2R).toFixed(0)}° eff=${eff.toFixed(0)} pen=${pen.toFixed(0)} ${zone} ${res.kind} -${res.dmg}hp (tgt hp=${Math.max(0, tgt.hp).toFixed(0)})`);
  if (tgt.hp <= 0 && tgt.alive) { tgt.hp = 0; tgt.alive = false; SF.Bus.emit('destroyed', { tank: tgt, shooter }); }
  if (tgt.ai && tgt.alive && shooter.team !== tgt.team) tgt.ai.onHurt(shooter);   // 被打感知(ai.js:178)
  return res;
}

/* ---------- 参考机器人的"看得见": 与被测 AI 同一套点阵几何(ai.js SF.losGrid) ----------
   不看距离/草丛(保持本台无限视距校准口径), 只把采样从"中心单射线"换成 25 柱点阵 ——
   两边同几何, ai-bench 量到的才是 AI 决策质量而非视觉不对称。 */
function robotSee(world, rob, ai) {
  const rw = rob.spec.sample, aw = ai.spec.sample;
  return SF.losGrid(world, rob.x, rob.z, rw.w, ai.x, ai.z, ai.yaw, aw.w, aw.l, null);
}

/* ---------- 参考机器人(固定技能脚本车): 三旋钮=瞄准偏角/反应延迟/开火圈阈 ----------
   目标 = pickTarget(最近存活 AI 车, 与 AI 选靶同口径)。move='orbit': 冲到 orbitR±10m 带内后
   定向环绕(车体沿切线, 炮口始终追目标); move='static': 原地站桩只开火。
   开火门: 通视 && 反应过 && 炮口±0.05rad && 装填好 && disp<base×dispMult */
function robotThink(rob, sc, world) {
  const inp = rob.input, S = rob.spec, rc = rob.rcfg;
  inp.fire = false;
  // 多目标: rcfg.target=near 最近存活(默认); front=最近的 HT(测顶线吃压); 每拍重选(目标死了不陪葬)
  if (rc.target === 'front') {
    let best = null, bd = 1e9;
    for (const a of world.enemies) if (a.alive && a.spec.cls === 'HT') {
      const d = U.dist2d(rob.x, rob.z, a.x, a.z); if (d < bd) { bd = d; best = a; }
    }
    rob._aimTgt = best;
  } else rob._aimTgt = null;
  const ai = rob._aimTgt && rob._aimTgt.alive ? rob._aimTgt : pickTarget(rob, world);
  if (!ai) { inp.throttle = 0; inp.steer = 0; return; }
  const dx = ai.x - rob.x, dz = ai.z - rob.z, dist = Math.hypot(dx, dz);
  const aimYaw = Math.atan2(dx, dz) + rob.aimBias;
  inp.aimYaw = aimYaw;
  const ty = world.terrain.heightAt(ai.x, ai.z) + 1.2;
  inp.aimPitch = clamp(Math.atan2(ty - (rob.y + 2.0), Math.max(dist, 1)), S.gunDepression, S.gunElevation);

  rob._visT = (rob._visT || 0) - DT;
  // 机器人视觉与被测 AI 同一套点阵几何(SF.losGrid, 不看距离/草丛, 保持本台无限视距校准):
  // 否则 AI 侧换成点阵后基准虚涨, 前后不可比
  if (rob._visT <= 0) { rob._visT = 0.1; rob.canSee = ai.alive ? robotSee(world, rob, ai) : false; }
  if (rob.canSee && !rob._saw) { rob._saw = true; rob._react = rc.reactS; }
  if (!rob.canSee) rob._saw = false;
  if (rob._react > 0) rob._react -= DT;

  let th = 0, st = 0;
  const D = S.dispersion;
  if (rc.move === 'orbit') {
    const want = Math.atan2(dx, dz);
    if (dist > rc.orbitR + 10) { st = clamp(U.angDiff(rob.yaw, want) * 2.5, -1, 1); th = 1; }
    else if (dist < rc.orbitR - 10) {   // 拉开: 掉头驶离(风筝), 炮塔独立追目标
      const away = Math.atan2(-dx, -dz);
      st = clamp(U.angDiff(rob.yaw, away) * 2.5, -1, 1); th = 1;
    } else { th = 0.75; st = 0.8 * rc.orbitSide; }
    // 停-射-走纪律(WoT 步法): 装填好且炮口对正就停车缩圈, 打完继续走 —— 否则移动扩圈永不达开火阈
    if (rob.canSee && rob._react <= 0 && rob.reloadT <= 0 &&
        Math.abs(U.angDiff(rob.turretYaw, aimYaw)) < 0.05 && rob.disp >= D.base * rc.dispMult) {
      th = 0; st = 0;
    }
  }               // 'static': 全零
  inp.throttle = th; inp.steer = st;

  inp.fire = rob.alive && ai.alive && rob.canSee && rob._react <= 0 && rob.reloadT <= 0 &&
    Math.abs(U.angDiff(rob.turretYaw, aimYaw)) < 0.05 && rob.disp < D.base * rc.dispMult;
}

/* ---------- 单场景: 复制品世界 + 主循环 + 指标采样(1v1 与混编小队同一套) ---------- */
function runScenario(sc) {
  const { J, T } = loadTerrain(sc.map);
  const list = J.covers.map(coverCol);
  const W = {
    time: 0, over: false, terrain: T,
    covers: {
      list, heightAt: T.heightAt,
      blocked(ox, oz, oy, dx, dz, len, dy, spot) { return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot); },
      nearestCoverBetween(ax, az, bx, bz) { return SF.Sim.nearestCoverBetween(this.list, ax, az, bx, bz); },
    },
    enemies: [], player: null, mpTargets: [],
    intel: { x: 0, z: 0, t: -99, level: 0 },
  };
  SF.Game.__setWorld(W);

  // 编队归一: 1v1 场景的 ai/robot 单数定义 → 单元素数组, 主循环不分叉
  const aiDefs = sc.aiSide || [sc.ai];
  const robDefs = sc.robots || [sc.robot];
  const ais = aiDefs.map((d, i) => {
    const t = mkTank(d.type, { x: d.pos[0], z: d.pos[1], yaw: d.yaw, team: 1,
                               netId: sc.squad ? 0 : 2 + i, id: sc.squad ? 1 + i : undefined });
    t.ai = new SF.AI(t, { personality: d.personality, patrol: [d.pos], hold: d.hold });
    t.input = t.ai.input;
    return t;
  });
  W.enemies = ais;
  const robs = robDefs.map((d, i) => {
    const r = mkTank(d.type, { x: d.pos[0], z: d.pos[1], yaw: d.yaw, team: 0, netId: 1 + i * 10, isPlayer: i === 0 });
    r.aimBias = d.aimBias || 0;
    r.rcfg = d;
    return r;
  });
  W.player = robs[0]; W.mpTargets = robs;

  // 逐车记账槽(开火迟滞窗口/首发回合边沿/卡死/死亡时刻)
  const bk = new Map();
  for (const t of [...ais, ...robs])
    bk.set(t, { lastShots: 0, readySince: null, pendingFirst: false, prevState: 'patrol', stuckT: 0, stuckEv: 0, deathT: null });

  // 采样聚合器(逐车拆样本后并入同一组计数)
  const m = {
    nCombat: 0, nAngOk: 0, nSideExp: 0, nBand: 0, nReload: 0, nCovered: 0,
    lat: [], firstShots: 0, firstHits: 0, focusN: 0, focusSum: 0, roleN: 0, roleFit: 0,
    states: {},
  };
  const ticks = Math.round(sc.dur / DT);

  for (let k = 0; k < ticks; k++) {
    if (!ais.some(a => a.alive) || !robs.some(r => r.alive)) break;   // 一方全灭即提前结束(1v1=任一方死亡)
    W.time += DT;

    for (const rob of robs) {
      if (!rob.alive) continue;
      robotThink(rob, sc, W);
      stubUpdate(rob, DT, W);
      if (!rob.alive) bk.get(rob).deathT = W.time;
    }
    // AI 车可能死于上段机器人炮火: 立即落死亡时刻(下一段的存活短循环会跳过记账)
    for (const aiT of ais) {
      const b = bk.get(aiT);
      if (!aiT.alive && b.deathT === null) b.deathT = W.time;
    }

    for (const aiT of ais) {
      if (!aiT.alive) continue;
      const b = bk.get(aiT);
      aiT.ai.update(DT, W);                          // AI 决策(内部按 perceptionInterval 节流感知)
      if (aiT.alive) stubUpdate(aiT, DT, W);

      // 本车本 tick 开炮 → 首发命中 / 开火迟滞 记账
      if (aiT.stats.shots > b.lastShots) {
        b.lastShots = aiT.stats.shots;
        const res = aiT._lastRes;
        if (b.pendingFirst) { m.firstShots++; if (res && res.hit) m.firstHits++; b.pendingFirst = false; }
        if (b.readySince !== null) { m.lat.push(W.time - b.readySince); b.readySince = null; }
      }

      // 交战回合检测(首发判定, 逐车)
      if (aiT.ai.state === 'combat' && b.prevState !== 'combat') b.pendingFirst = true;
      b.prevState = aiT.ai.state;
      m.states[aiT.ai.state] = (m.states[aiT.ai.state] || 0) + 1;

      // 卡死检测(ai.js:223-224 同判据, 仅报告)
      if (aiT.input.throttle > 0.4 && Math.abs(aiT.speed) < 0.25) b.stuckT += DT;
      else b.stuckT = 0;
      if (b.stuckT > 2) { b.stuckEv++; b.stuckT = 0; }
    }

    if (process.env.AI_BENCH_TRACE && k % 60 === 0) {
      const aiTxt = ais.map(a => `${a.type}@(${a.x.toFixed(0)},${a.z.toFixed(0)})${a.alive ? '' : '†'}${a.ai.state} v=${a.speed.toFixed(1)} d=${a.disp.toFixed(2)}`).join(' | ');
      const robTxt = robs.map(r => `(${r.x.toFixed(0)},${r.z.toFixed(0)})${r.alive ? '' : '†'}`).join(' ');
      console.error(`  [${sc.id}@${W.time.toFixed(0)}s]\n    AI  ${aiTxt}\n    ROB ${robTxt}`);
    }

    // 10Hz 指标采样(逐车)
    if (k % SAMPLE_EVERY === SAMPLE_EVERY - 1) {
      const aliveRobs = robs.filter(r => r.alive);
      const aliveAis = ais.filter(a => a.alive);
      const engaged = aliveAis.filter(a => (a.ai.state === 'combat' || a.ai.state === 'retreat') && a.ai.seenNow);

      // 交战几何: 射手/目标记录 = 最近存活机器人(pickTarget 与裁判同源; 1v1 即唯一机器人)
      for (const a of engaged) {
        const sh = pickTarget(a, W);
        if (!sh) continue;
        m.nCombat++;
        const bearing = Math.abs(U.angDiff(a.yaw, Math.atan2(sh.x - a.x, sh.z - a.z))) / D2R;
        if (bearing >= 20 && bearing <= 35) m.nAngOk++;
        if (bearing > 60 && bearing <= 120) m.nSideExp++;
        const d = U.dist2d(a.x, a.z, sh.x, sh.z);
        const B2 = a.ai.bandFor();   // G3: 实际行为带=性格×车型混合(带插值), 不再按纯性格带量
        if (d >= B2[0] && d <= B2[1]) m.nBand++;
      }

      for (const a of aliveAis) {
        const b = bk.get(a);
        if ((a.ai.state === 'combat' || a.ai.state === 'retreat') && a.reloadT > 0) {
          const sh = pickTarget(a, W);
          if (sh) {
            m.nReload++;
            if (!robotSee(W, sh, a)) m.nCovered++;    // 换弹期射手看不见我=有掩护(同点阵口径, 见 robotSee)
          }
        }
        // 开火就绪窗口(不含缩圈条件)追踪 → fireLatencyS。
        // 含窗口安全(G1 规格口径): 窗口关着(炮射线被挡)不算就绪 —— 点阵点亮下"躲在墙后仍
        // seenNow"的车不该空转 ready 时钟; 贴身豁免与 fire 门同口径
        const ready = a.ai.seenNow && a.ai.reactT <= 0 && a.reloadT <= 0 &&
          Math.abs(U.angDiff(a.turretYaw, a.input.aimYaw)) < 0.05 &&
          (!a.ai._winState || a.ai._winState.open || U.dist2d(a.x, a.z, pickTarget(a, W).x, pickTarget(a, W).z) < a.ai.bandFor()[0] * 1.2);
        if (!ready) b.readySince = null;
        else if (b.readySince === null) b.readySince = W.time;
      }

      // 集火指数: ≥2 交战车 && ≥2 存活敌才非平凡(1v1 恒不进门; 敌剩 1 台全队同靶会虚高)。
      // 目标口径: ai.js nearestTarget 的真实锁定(G4 起焦点感知)——单一事实源在 ai.js, 台内
      // 不再用最近近似复刻(那测不到集火模块的行为)
      if (engaged.length >= 2 && aliveRobs.length >= 2) {
        const tally = new Map();
        for (const a of engaged) {
          const sh = SF.nearestTarget ? SF.nearestTarget(W, a) : pickTarget(a, W);
          if (sh) tally.set(sh.netId, (tally.get(sh.netId) || 0) + 1);
        }
        if (tally.size) {
          let mx = 0, tot = 0;
          for (const v of tally.values()) { mx = Math.max(mx, v); tot += v; }
          m.focusN++;
          m.focusSum += mx / tot;        // tot=参与锁定的交战车数(可用射车)
        }
      }

      // 角色站位(G3 口径, 仅混编小队场景): threat=本车最近存活机器人, lead=全队距各自 threat 最近者
      //   HT=距 threat 最近(全队 argmin) 或 distP≤band.hi×1.1; MT/LT=从 threat 看
      //   |敌→队心 与 敌→我 的夹角|∈[40°,140°](真在翼侧而不是堆队心); TD=落后 lead ≥42m
      if (sc.squad && engaged.length && aliveRobs.length) {
        let fx = 0, fz = 0;
        for (const a of aliveAis) { fx += a.x; fz += a.z; }
        fx /= aliveAis.length; fz /= aliveAis.length;
        let dFront = 1e9, frontTank = null;
        const dOf = new Map();
        for (const a of aliveAis) {
          const sh = pickTarget(a, W);
          const d = sh ? U.dist2d(a.x, a.z, sh.x, sh.z) : 1e9;
          dOf.set(a, d);
          if (d < dFront) { dFront = d; frontTank = a; }
        }
        // 直线穿硬掩体判定(结构性剔除用): 圆近似, 与 coverCol 同源
        const segBlocked = (ax, az, bx, bz) => {
          const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
          for (const c of list) {
            if (!c.blocksShells) continue;
            const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / L2));
            if (Math.hypot(ax + dx * t - c.x, az + dz * t - c.z) < c.r) return true;
          }
          return false;
        };
        // 结构性无站可达(裁决#3): 该时刻任何合法站位都不存在(全被地形/硬掩体挡或直线不可达)
        // → 从分母剔除 —— 指标的职责是量角色纪律, 不是罚地图拓扑(S5 走廊墙体: 墙列 x≈-175~-188, z243~333)
        const noStation = (a, sh, kind) => {
          const bBase = Math.atan2(fx - sh.x, fz - sh.z);
          if (kind === 'MT' || kind === 'LT') {
            const rad = U.dist2d(a.x, a.z, sh.x, sh.z);
            for (let dd = 45; dd <= 135; dd += 30) for (const sd of [1, -1]) {
              const ang = bBase + sd * dd * D2R;
              const px = sh.x + Math.sin(ang) * rad, pz = sh.z + Math.cos(ang) * rad;
              if (!SF.losClear(W, px, pz, sh.x, sh.z)) continue;
              if (segBlocked(a.x, a.z, px, pz)) continue;
              return false;   // 存在可达翼侧点 → 不剔除
            }
            return true;
          }
          // TD: 队首背后 42m+ 纵深是否存在可达点(±60° 扇, 两个纵深档)
          const leadSh = frontTank ? pickTarget(frontTank, W) : null;
          if (!leadSh) return false;
          const backBase = Math.atan2(fx - leadSh.x, fz - leadSh.z);   // 敌→队心≈背敌向
          for (let dd = -60; dd <= 60; dd += 30) for (const rr of [dFront + 55, dFront + 90]) {
            const ang = backBase + dd * D2R;
            const px = leadSh.x + Math.sin(ang) * rr, pz = leadSh.z + Math.cos(ang) * rr;
            if (!SF.losClear(W, px, pz, sh.x, sh.z)) continue;
            if (segBlocked(a.x, a.z, px, pz)) continue;
            return false;
          }
          return true;
        };
        for (const a of engaged) {
          const cls = a.spec.cls;
          if (cls !== 'HT' && cls !== 'MT' && cls !== 'LT' && cls !== 'TD') continue;
          const sh = pickTarget(a, W);
          if (!sh) continue;
          if ((cls === 'MT' || cls === 'LT' || cls === 'TD') && noStation(a, sh, cls)) {
            m.roleCut = (m.roleCut || 0) + 1;   // 剔除计数(逐场景输出, 透明可审计)
            continue;
          }
          m.roleN++;
          const d = dOf.get(a);
          let fit = false;
          if (cls === 'HT') fit = (a === frontTank) || d <= a.ai.bandFor()[1] * 1.1;
          else if (cls === 'MT' || cls === 'LT') {
            const a1 = Math.atan2(fx - sh.x, fz - sh.z), a2 = Math.atan2(a.x - sh.x, a.z - sh.z);
            const ang = Math.abs(U.angDiff(a1, a2)) / D2R;
            fit = ang >= 40 && ang <= 140;
          } else if (cls === 'TD') fit = d - dFront >= 42;
          if (fit) m.roleFit++;
        }
      }
    }
  }

  // 收尾: TD 存活(仅小队场景; 二线保护效果)
  let tdAlive = 0, tdTotal = 0;
  if (sc.squad) for (const a of ais) if (a.spec.cls === 'TD') { tdTotal++; if (a.alive) tdAlive++; }

  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0);
  return {
    id: sc.id, name: sc.name, map: sc.map, dur: sc.dur,
    aiSide: ais.map((a, i) => ({ type: a.type, cls: a.spec.cls, personality: aiDefs[i].personality,
      alive: a.alive, hpLeft: Math.max(0, Math.round(a.hp)), deathT: bk.get(a).deathT })),
    robots: robs.map(r => ({ type: r.type, alive: r.alive, hpLeft: Math.max(0, Math.round(r.hp)), deathT: bk.get(r).deathT })),
    shots: { ai: sum(ais, t => t.stats.shots), aiHits: sum(ais, t => t.stats.hits),
             robot: sum(robs, t => t.stats.shots), robotHits: sum(robs, t => t.stats.hits) },
    dmg: { aiDealt: sum(ais, t => t.stats.dmg), robotDealt: sum(robs, t => t.stats.dmg) },
    samples: { combat: m.nCombat, angOk: m.nAngOk, sideExp: m.nSideExp, band: m.nBand, reload: m.nReload,
      covered: m.nCovered, fireLat: m.lat.length, focusN: m.focusN, roleN: m.roleN, roleFit: m.roleFit,
      roleCut: m.roleCut || 0 },
    states: m.states, stuckEvents: sum(ais, t => bk.get(t).stuckEv),
    lat: m.lat, firstShots: m.firstShots, firstHits: m.firstHits,
    focusSum: m.focusSum, tdAlive, tdTotal,
  };
}

/* ---------- 点亮灵敏度探针(G7, 只上报不动权重): 小格子效果度量 ----------
   受控曝光(纯地形遮挡, 掩体射线与 margin 无关不掺入): ①轴向爬脊——S3 反斜面(观察者
   (0,415)), 目标 z 从 258 到 270 以 0.1m 渐进(炮塔渐探出山脊的纵向缝); ②横向露角——固定
   z=265(脊后盲带), 目标 x 从 -8 到 8 横移(只露一角的横向缝)。统计被点亮步数占比:
   spotSliverPct=玩家口径(config.spot.playerMargin), spotSliverPctBase=旧 1.6 弹道口径。
   两键差=灵敏度上行量(实测窗口: 纵向带 m0.2 80% vs m1.6 20%, 横向带 100% vs 0%) */
function spotSliverProbe() {
  const { J, T } = loadTerrain('l01-encounter');
  const list = J.covers.map(coverCol);
  const W = { time: 0, terrain: T, covers: { list, heightAt: T.heightAt,
    blocked(ox, oz, oy, dx, dz, len, dy, spot) { return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot); } },
    enemies: [], player: null, mpTargets: [], intel: { level: 0 } };
  const pz4 = CFG.vehicles.pz4;
  const mk2 = (x, z) => ({ x, z, yaw: Math.PI, spec: pz4, alive: true });
  const obs = mk2(0, 415);
  const pm = SF.playerSpotMargin ? SF.playerSpotMargin() : 0.2;
  let hit = 0, hitBase = 0, tot = 0;
  const tick = (tgt) => {
    tot++;
    if (SF.losClearAny(W, obs, tgt, null, pm)) hit++;
    if (SF.losClearAny(W, obs, tgt, null, 1.6)) hitBase++;
  };
  for (let z = 258; z <= 270.0001; z += 0.1) tick(mk2(0, z));        // ① 爬脊纵向
  for (let x = -8; x <= 8.0001; x += 0.1) tick(mk2(x, 265));          // ② 露角横向
  const pct = (n) => Math.round(n / Math.max(1, tot) * 10000) / 100;
  return { spotSliverPct: pct(hit), spotSliverPctBase: pct(hitBase) };
}

/* ---------- 跑全部场景 → 聚合 → 评分 ---------- */
function runAll() {
  Math.random = mulberry32(SEED);                  // 每遍重置: 台内自验同种子两遍逐字节一致
  loadGameScripts();                               // 换新 Bus/SF.AI(上一遍监听器不残留)
  const details = SCENARIOS.map(runScenario);
  const agg = {
    nCombat: 0, nAngOk: 0, nSideExp: 0, nBand: 0, nReload: 0, nCovered: 0,
    lat: [], firstShots: 0, firstHits: 0, aiDmg: 0, robDmg: 0,
    aliveVeh: 0, totalVeh: 0, focusN: 0, focusSum: 0, roleN: 0, roleFit: 0, tdAlive: 0, tdTotal: 0,
  };
  for (const d of details) {
    agg.nCombat += d.samples.combat; agg.nAngOk += d.samples.angOk;
    agg.nSideExp += d.samples.sideExp; agg.nBand += d.samples.band;
    agg.nReload += d.samples.reload; agg.nCovered += d.samples.covered;
    agg.lat.push(...d.lat);
    agg.firstShots += d.firstShots; agg.firstHits += d.firstHits;
    agg.aiDmg += d.dmg.aiDealt; agg.robDmg += d.dmg.robotDealt;
    agg.aliveVeh += d.aiSide.filter(a => a.alive).length; agg.totalVeh += d.aiSide.length;
    agg.focusN += d.samples.focusN; agg.focusSum += d.focusSum;
    agg.roleN += d.samples.roleN; agg.roleFit += d.samples.roleFit;
    agg.tdAlive += d.tdAlive; agg.tdTotal += d.tdTotal;
    const aiSum = d.aiSide.map(a => `${a.type}(${a.cls}/${a.personality}) 剩${a.hpLeft}hp${a.alive ? '存活' : '阵亡@' + (a.deathT || 0).toFixed(1) + 's'}`).join(', ');
    console.error(`[${d.id} ${d.name}] ${aiSum}` +
      ` | 机器人 ${d.robots.filter(r => r.alive).length}/${d.robots.length} 存活` +
      ` | 弹 AI ${d.shots.ai}发${d.shots.aiHits}中/${d.dmg.aiDealt}伤 机器人 ${d.shots.robot}发${d.shots.robotHits}中/${d.dmg.robotDealt}伤` +
      ` | 采样 交战${d.samples.combat} 摆角${d.samples.angOk} 侧露${d.samples.sideExp} 带内${d.samples.band} 装填${d.samples.reload} 遮蔽${d.samples.covered} 迟滞${d.samples.fireLat}` +
      (d.samples.focusN ? ` 集火${(d.focusSum / d.samples.focusN).toFixed(2)}×${d.samples.focusN}` : '') +
      (d.samples.roleN ? ` 站位${Math.round(d.samples.roleFit / d.samples.roleN * 100)}%×${d.samples.roleN}` : '') +
      (d.tdTotal ? ` TD存活${d.tdAlive}/${d.tdTotal}` : '') +
      ` | 状态 ${JSON.stringify(d.states)} 卡死${d.stuckEvents}`);
  }
  const pct = (n, d) => d > 0 ? Math.round(n / d * 10000) / 100 : 0;
  const r2 = v => Math.round(v * 100) / 100;
  const sliver = spotSliverProbe();   // G7 探针: 只并入 metrics 上报, 不进 THRESH(跨版本可比)
  const metrics = Object.assign({
    fireLatencyS: agg.lat.length ? r2(agg.lat.reduce((a, b) => a + b, 0) / agg.lat.length) : 10,
    anglingOkPct: pct(agg.nAngOk, agg.nCombat),
    sideExposedPct: pct(agg.nSideExp, agg.nCombat),
    coverUsePct: pct(agg.nCovered, agg.nReload),
    bandPct: pct(agg.nBand, agg.nCombat),
    dmgRatio: r2(agg.aiDmg / Math.max(1, agg.robDmg)),
    firstShotHitPct: pct(agg.firstHits, agg.firstShots),
    survivalPct: pct(agg.aliveVeh, agg.totalVeh),
    focusFireIdx: agg.focusN ? r2(agg.focusSum / agg.focusN) : 0,
    roleFitPct: pct(agg.roleFit, agg.roleN),
    tdSurvivalPct: pct(agg.tdAlive, agg.tdTotal),
  }, sliver);
  let score = 0;
  for (const [k, th] of Object.entries(THRESH)) {
    const v = metrics[k];
    let n = (v - th.bad) / (th.good - th.bad);
    if (th.inv) n = (th.bad - v) / (th.bad - th.good);
    score += th.w * clamp(n, 0, 1);
  }
  return { score: Math.round(score * 10) / 10, metrics,
    scenarios: details.map(d => ({ id: d.id, name: d.name, map: d.map, dur: d.dur,
      aiSide: d.aiSide, robots: d.robots,
      dmg: d.dmg, shots: d.shots, samples: d.samples, states: d.states, stuckEvents: d.stuckEvents,
      firstShots: d.firstShots, firstHits: d.firstHits,
      focusAvg: d.samples.focusN ? r2(d.focusSum / d.samples.focusN) : null,
      tdAlive: d.tdAlive, tdTotal: d.tdTotal })) };
}

/* ---------- 台架自检: 掩体碰撞表与主线程 CoverField 同构性 ----------
   基准值来自本台搭建时的逐类型核对(models.js buildCover col 规则): l01 411 条,
   硬掩体 94, 草本(挡视线不挡弹) 208 —— map.json 掩体表改动后须同步更新 coverCol 规则与基准值 */
function selfCheck() {
  const J = JSON.parse(fs.readFileSync(path.join(MAPS, 'l01-encounter', 'map.json'), 'utf8'));
  const cols = J.covers.map(coverCol);
  const nHard = cols.filter(c => c.blocksShells).length;
  const nBush = cols.filter(c => c.blocksSpot && !c.blocksShells).length;
  const ok = cols.length === 411 && nHard === 94 && nBush === 208;
  console.error(`掩体表自检: l01 n=${cols.length}/411 硬掩体=${nHard}/94 草本=${nBush}/208 ${ok ? '✓' : '*** FAIL(coverCol 规则与 models.js 漂移?) ***'}`);
  return ok;
}

/* ---------- 主流程: 跑两遍互验确定性 → stdout 末行唯一 JSON ---------- */
function main() {
  const t0 = Date.now();
  const fixtureOk = selfCheck();
  const out1 = runAll();
  const out2 = runAll();
  const j1 = JSON.stringify(out1), j2 = JSON.stringify(out2);
  if (j1 !== j2) {
    console.error('*** 确定性自验失败: 同种子两遍输出不一致 ***');
    process.exit(1);
  }
  console.error(`确定性自验: 同种子(${SEED})两遍输出一致 ✓  总耗时 ${Date.now() - t0}ms(纯计算, 无真实时钟依赖)`);
  console.log(j1);
  process.exit(fixtureOk ? 0 : 1);
}
if (require.main === module) main();
module.exports = { SCENARIOS, THRESH, loadTerrain, coverCol, mkTank, pickTarget };
