// ai.js — 敌方 AI: FSM(巡逻/警戒/交战/撤退) + 三种车型性格 + 感知(视距/遮挡/反应延迟/听觉/记忆)
// 关键设计: AI 与玩家走同一 Tank.update 接口, 同样受缩圈/回转/装填规则约束
// 本文件在主线程与 Worker(ai-worker.js) 各跑一份: 只依赖 world 注入接口
// (time/terrain.heightAt/covers.blocked/list/enemies/player/mpTargets), 不直接摸 THREE。
window.SF = window.SF || {};

// 通用通视检查(玩家 spotting 与 AI 共用): 地形 + 掩体遮挡, 眼高 2m
SF.losClear = function (world, ax, az, bx, bz) {
  const ay = world.terrain.heightAt(ax, az) + 2.0, by = world.terrain.heightAt(bx, bz) + 2.0;
  if (world.terrain.losBlocked(ax, az, ay, bx, bz, by)) return false;   // 视线余量 0.2: 1.6
  // 的弹道余量会把探出山脊 0.3~0.5m 的炮塔判成被挡('非要出一个车身才点亮'根因)
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1) return true;
  return world.covers.blocked(ax, az, ay, dx / len, dz / len, len, (by - ay) / len) < 0;
};

/* ---------- 点阵通视(点亮): WoT 式 —— 双方都撒点, 任一对通视即可见 ----------
   目标点阵 5×5(25 柱): 在目标 OBB 足迹上铺开 —— 横(左右, 含履带外缘两列) ±0.95w / ±0.5w / 0,
   纵(前后, 按目标 yaw 旋转) ±0.85l / ±0.45l / 0; 每柱只测其顶(+3.3m)。
   观察者 3 视点: 中心 + 视线垂直方向 ±0.55w(探头只露车体一侧也要能点别人); 每点只测 +3.0m。
   高度单调性(精确等价, 非近似): 同柱两条射线内点逐点相同(losBlocked 2m 步进与 covers 命中 t
   完全一致), 且高点线在每个内点都高于低点线 —— 故"柱顶被挡 ⇒ 该柱全部低点全被挡",
   每柱 1 射线与测全高度(1.2/2.0/2.8/3.3)结果完全相同, 低点没有独立回报。
   灵敏度只由柱子在 XZ 上的铺开度决定; 旧 8 条中心射线全部被本点阵覆盖(严格超集, 不会变迟钝)。
   通判即亮: 25×3=75 对里任一对通视即 true 并早退(先测 观察者中心×目标中心 这一最常见命中);
   常见 1~3 射线(比旧 8 射线还便宜), 最坏 75 射线只发生在目标被全遮挡时。
   tst = 草丛上下文 {tx, tz, concealed, fired}(simcore coversBlocked 的 spot); null = 纯几何。 */
const GRID_LAT = [0, -0.95, 0.95, -0.5, 0.5];    // 横向列序: 中心优先, 再履带外缘, 再内柱
const GRID_LON = [0, -0.85, 0.85, -0.45, 0.45];  // 纵列序: 中心优先, 再前/后尖, 再前/后内柱
const GRID_OBS = [0, -0.55, 0.55];               // 观察者视点序: 中心优先, 再两侧(探头)
const GRID_OBS_H = 3.0, GRID_TGT_H = 3.3;        // 视点高(塔顶)/柱顶高(车体最高棱线)
// aw = 观察者半宽(视点横向铺开用); bw/bl = 目标半宽/半长(足迹柱距)
// margin: 地形遮挡的视线余量——缺省 1.6(弹道口径, AI 双侧对称的旧平衡); 玩家侧点亮传小余量
// (0.2, config.spot.playerMargin): 1.6 会把探出山脊 0.3~0.5m 的炮塔判成被挡('非要出一个
// 车身才点亮'), AI 侧保持 1.6 = 难度不因灵敏度上抬而变(ask⑤ 的回标定就是这里做的)
SF.losGrid = function (world, ax, az, aw, bx, bz, byaw, bw, bl, tst, margin) {
  const T = world.terrain, heightAt = T.heightAt, losBlocked = T.losBlocked;
  // covers.blocked 是方法(靠 this.list), 不可解构; 每对射线就地调
  const len0 = Math.hypot(bx - ax, bz - az);
  if (len0 < 1) return true;
  const pX = -(bz - az) / len0, pZ = (bx - ax) / len0;   // 视线垂直方向 = 观察者横向轴
  const fX = Math.sin(byaw), fZ = Math.cos(byaw);        // 目标纵轴(车头)
  const rX = Math.cos(byaw), rZ = -Math.sin(byaw);       // 目标横轴(右)
  for (const oOff of GRID_OBS) {
    const ox = ax + pX * (oOff * aw), oz = az + pZ * (oOff * aw);
    const oy = heightAt(ox, oz) + GRID_OBS_H;
    for (const lon of GRID_LON) {
      const fx = bx + fX * (lon * bl), fz = bz + fZ * (lon * bl);
      for (const lat of GRID_LAT) {
        const px = fx + rX * (lat * bw), pz = fz + rZ * (lat * bw);
        const py = heightAt(px, pz) + GRID_TGT_H;
        if (margin === undefined ? losBlocked(ox, oz, oy, px, pz, py) : losBlocked(ox, oz, oy, px, pz, py, margin)) continue;
        const dx = px - ox, dz = pz - oz, len = Math.hypot(dx, dz);
        if (len < 1) return true;
        if (world.covers.blocked(ox, oz, oy, dx / len, dz / len, len, (py - oy) / len, tst) < 0) return true;
      }
    }
  }
  return false;
};

// 点亮策略壳: 50m 强制与视距×(1−隐蔽) 距离门在调用方; 这里取双方尺寸(spec.sample;
// worker DM 幽灵 spec={} 兜底 1.5/3.05)与目标草丛上下文后走点阵。
// tst 显式传 null = 不判草丛(纯几何): 联机客户端本地复算主机口径时用(见 main.js clientFrame)
SF.losClearAny = function (world, src, tgt, tst, margin) {
  const st = tst === null ? null : (tst || SF.bushState(tgt, world));
  const ss = src.spec && src.spec.sample, ts = tgt.spec && tgt.spec.sample;
  const spot = st ? { tx: tgt.x, tz: tgt.z, concealed: st.concealed, fired: st.fired } : null;
  return SF.losGrid(world, src.x, src.z, ss ? ss.w : 1.5,
    tgt.x, tgt.z, tgt.yaw, ts ? ts.w : 1.5, ts ? ts.l : 3.05, spot, margin);
};

// 隐蔽物状态/隐蔽值: 委托 simcore(参数化 coversList + time, 主线程与 worker 同一实现)
SF.bushState = function (t, world) {
  return SF.Sim.bushState(world.covers.list, t, world.time);
};
// 玩家侧点亮的地形视线余量(G7⑤): AI 侧保持 1.6 旧口径(双侧对称旧平衡=难度不动), 玩家看
// 见敌人用小余量——1.6 的弹道余量把探出山脊 0.3~0.5m 的炮塔判成被挡('非要出一个车身才
// 点亮'); 惰性读 config(main.js 加载序在 config 前后不定, 不能加载期取值)
SF.playerSpotMargin = function () {
  const sp = SF.CFG && SF.CFG.ai && SF.CFG.ai.spot;
  return sp && sp.playerMargin !== undefined ? sp.playerMargin : 0.2;
};
SF.camoOf = function (t, world) {
  return SF.Sim.camoOf(world.covers.list, t, world.time);
};

/* ---------- 地形导航: 绕行不可攀地形(反坦克壕/陡壁/边界山) ----------
   网格 15m; 格可用 = 5 子采样全部 梯度≤NAV_G 且非凹槽(与 main.js 出生判定同一套规则, 参数保持同步;
   凹槽判定必需——壕底沿轴是平的, 纯坡度会让 AI 认为"横穿壕底是条路", 进得去出不来)。
   懒构建挂 terrain 实例(每局 terrain 重建即自动失效); 主线程与 worker 复制品世界通用, 只依赖注入的 world.terrain。 */
const NAV_G = Math.tan(SF.CFG.sim.maxSlope) * 0.96;
const NAV_SUB = [[0, 0], [5, 5], [5, -5], [-5, 5], [-5, -5]];
// 侧向射界夹角(穿深门判据): 敌鼻向与(敌→我)方位夹角超过此值 = 打得到敌侧甲, 无需再换位找侧向
const SIDE_ARC = 60 * Math.PI / 180;
function navGroove(T, x, z) {
  const hC = T.heightAt(x, z);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 4, dx = Math.sin(a) * 14, dz = Math.cos(a) * 14;
    if (T.heightAt(x + dx, z + dz) > hC + 3 && T.heightAt(x - dx, z - dz) > hC + 3) return true;
  }
  return false;
}
const navBlockedPt = (T, x, z) => T.gradAt(x, z) > NAV_G || navGroove(T, x, z);
function navGrid(T) {
  if (T._navG) return T._navG;
  const N = 64, lo = -(T.half - 20), st = (T.half * 2 - 40) / (N - 1);
  const pass = new Uint8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = lo + i * st, z = lo + j * st;
      let ok = 1;
      for (const [ox, oz] of NAV_SUB)
        if (navBlockedPt(T, x + ox, z + oz)) { ok = 0; break; }
      pass[j * N + i] = ok;
    }
  T._navG = { N, lo, st, pass };
  return T._navG;
}
// 直线可达: 每 8m 采样过同一套判定
function navLineClear(T, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
  const n = Math.max(2, Math.ceil(d / 8));
  for (let s = 1; s < n; s++)
    if (navBlockedPt(T, ax + dx * s / n, az + dz * s / n)) return false;
  return true;
}
// 4 邻域 BFS + 贪心拉直(前瞻≤8格); 返回 [[x,z],...](末点为真实目标) 或 null(无解/起终点本身不可用)
function navFindPath(T, ax, az, bx, bz) {
  const G = navGrid(T), N = G.N;
  const ci = (v) => Math.max(0, Math.min(N - 1, Math.round((v - G.lo) / G.st)));
  const si = ci(ax), sj = ci(az), gi = ci(bx), gj = ci(bz);
  if (!G.pass[sj * N + si] || !G.pass[gj * N + gi]) return null;
  const prev = new Int32Array(N * N).fill(-1);
  const q = [sj * N + si];
  prev[sj * N + si] = sj * N + si;
  for (let h = 0; h < q.length && prev[gj * N + gi] === -1; h++) {
    const c = q[h], cx = c % N;
    for (const d of [1, -1, N, -N]) {
      if ((d === 1 && cx === N - 1) || (d === -1 && cx === 0)) continue;   // 不跨行环绕
      const n2 = c + d;
      if (n2 < 0 || n2 >= N * N || !G.pass[n2] || prev[n2] !== -1) continue;
      prev[n2] = c; q.push(n2);
    }
  }
  if (prev[gj * N + gi] === -1) return null;
  const cells = [];
  for (let c = gj * N + gi; ;) { cells.push(c); if (c === prev[c]) break; c = prev[c]; }
  cells.reverse();
  const pts = cells.map(c => [G.lo + (c % N) * G.st, G.lo + ((c / N) | 0) * G.st]);
  pts[pts.length - 1] = [bx, bz];
  const out = [];
  let i0 = 0;
  while (i0 < pts.length - 1) {
    let j2 = Math.min(pts.length - 1, i0 + 8);
    while (j2 > i0 + 1 && !navLineClear(T, pts[i0][0], pts[i0][1], pts[j2][0], pts[j2][1])) j2--;
    out.push(pts[j2]); i0 = j2;
  }
  return out;
}

// 纯最近兜底: 驾驶参考用(撤退/藏相"focus 只改炮口不改驾驶"——撤退的脱离向量与藏点几何
// 始终对物理上最近之敌算, 焦点切换不许牵着车体走)
function nearestPlain(world, from) {
  if (world.mpTargets && world.mpTargets.length) {
    let best = null, bd = 1e9;
    for (const t of world.mpTargets)
      if (t.alive) { const d = SF.Util.dist2d(from.x, from.z, t.x, t.z); if (d < bd) { bd = d; best = t; } }
    if (best) return best;
  }
  return world.player;
}

/* AI 目标选择(炮口): 集火槽在位者锁全队焦点目标(G4), 其余回退最近。
   消费门(全部满足才锁): 焦点新鲜(≤focus.memoryS) && 本车在 teamMemo.focusSlots && 焦点
   目标存活 && 距焦点 < 视距×1.3(超程不追焦, 追了也是空炮)——单机 PVE 单目标时焦点与最近
   恒同, 行为零变化。挂 SF 供测试台按"真实瞄准对象"计量集火指数(单一事实源在 ai.js) */
function nearestTarget(world, from) {
  const FO = SF.CFG.ai.focus, f = world.focus;
  const hot = FO && FO.on && f && world.time - f.t <= FO.memoryS
    && world.mpTargets && world.mpTargets.some(e => e.alive && (e.netId || 0) === f.netId);
  const sl = hot && from.ai && from.ai._memo ? from.ai._memo.focusSlots : null;
  const teamCalled = sl && Object.keys(sl).length > 0;   // 全队集火在呼(有槽才算呼——无槽=未
  // 达规模门/焦点失效, 分流与锁定一并不起, 各车打自己的)
  const inSlot = teamCalled && sl[keyOf(from, world)] !== undefined;
  if (hot && inSlot) {
    const ft = world.mpTargets.find(e => e.alive && (e.netId || 0) === f.netId);
    if (ft) {
      const dF = SF.Util.dist2d(from.x, from.z, ft.x, ft.z);
      const vr = (from.spec.view || SF.CFG.ai.viewRange) * 1.3;
      const np = nearestPlain(world, from);
      const dN = np && np.alive ? SF.Util.dist2d(from.x, from.z, np.x, np.z) : 1e9;
      if (dF < vr && dF <= dN * 1.15)
        return ft;   // 槽内: 锁焦点。超程不追焦(空炮); 比最近敌远 15% 以上不重排炮口——
                   // 重排的转塔+窗口重建+站位几何全要重对, 追着机动焦点跑实测输出掉 40%,
                   // 集火呼叫只该在"打谁都不亏"时改炮口, 亏的仗各车打自己带内的
    }
  }
  /* 槽外分流: 焦点热 && 存活敌≥2 时, 非槽车选"最近的非焦点敌" —— 只回退最近的话, 自然
     最近收敛让全队仍打同一台(实测指数恒 1.0), cap 形同虚设; 分流后同焦点车数=槽位数
     (PVE 护栏的本义: 残血玩家至多被 cap 台锁定, 其余车压制另一目标, 给玩家留反打窗口)。
     敌只剩焦点目标(或单机 PVE 单目标)时分流集为空, 自然回退最近, 行为与旧版零差异 */
  if (teamCalled && !inSlot && world.mpTargets.filter(e => e.alive).length >= 2
      && from.ai._seenAnyT !== undefined && world.time - from.ai._seenAnyT < 2) {
    let best = null, bd = 1e9;
    for (const e of world.mpTargets) {
      if (!e.alive || (e.netId || 0) === f.netId) continue;
      const d = SF.Util.dist2d(from.x, from.z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    /* 分流的带合身门: 分流目标要落在本车交战带(lo×0.75~hi×1.15)内才接 —— 二线 TD 被分流到
       52m 处的近敌=逼它放弃纵深去打贴脸(实测全队输出掉 40%, 挨打翻倍); 带不合身就退回最近
       (它自然会打自己带内的目标), 分流的代价只由打得着的车付 */
    const B = from.ai.bandFor ? from.ai.bandFor() : null;
    if (best && B && bd >= B[0] * 0.75 && bd <= B[1] * 1.15) return best;
  }
  return nearestPlain(world, from);
}
SF.nearestTarget = nearestTarget;   // 测试台集火计量用(读真实锁定, 不再用最近近似)

/* ---------- 协同稳定键(R4-A): 全部协同推导(分舷奇偶/哈希抖动/槽位记忆/提拔排序)用它 ----------
   禁用 netId —— main.js 只在 MP 模式给敌车发号, 单机 PVE 所有 AI 的 netId=0(线上快照列里
   全是 0), 按 netId 分舷/抖动会全车同舷同角(两翼塌成单翼); 而 bench 曾给各车不同 netId →
   台上全绿、线上全灭的 A 类错位。取键顺序: 复制品唯一 id(worker 主路径, main.js spawn 带
   _aiId → ai-worker 收成 r.id) → _aiId(降级模式若未来补发) → 注册表兜底(对象引用→递增号,
   懒建挂 world, 跨 teamMemo 重算持久 —— bench/主线程降级路径都走这里) */
function keyOf(tank, world) {
  if (tank.id !== undefined) return tank.id;
  if (tank._aiId !== undefined) return tank._aiId;
  if (!world._teamIds) { world._teamIds = new Map(); world._teamIds._n = 0; }
  let k = world._teamIds.get(tank);
  if (k === undefined) { k = ++world._teamIds._n; world._teamIds.set(tank, k); }
  return k;
}

/* ---------- 全队协同备忘(G3): 挂 world._teamMemo, 全队共读, 节流重算 ----------
   重算条件: 存活签名(keyOf 升序列)变化 或 超 recomputeS —— 一局十余辆车每 0.8s 一次 O(n²)内,
   复杂度可控。roles=角色分工纯函数产物; stations=各角色站位; plugFor=补位映射(顶线让位后
   谁顶它的位); slotMemo=槽位记忆(跨重算持久, 键=keyOf —— 分舷/翼侧归属稳定不闪变);
   focusSlots=集火槽(预留给集火呼叫模块, 本轮只立结构)。
   威胁参考: 各车 lastSeen 与 world.intel 取最新 —— 全队打的是同一个"敌人在哪" */
function teamMemo(world) {
  const RO = SF.CFG.ai.role, now = world.time;
  const list = [];
  for (const e of world.enemies) if (e.alive && e.ai) list.push(e);
  const sig = list.map(e => keyOf(e, world)).sort((a, b) => a - b).join(',');
  const M = world._teamMemo;
  if (M && M.sig === sig && now - M.t < RO.recomputeS) return M;
  // 威胁参考点: 最新情报(目视 lastSeen / 全队 intel), 谁新听谁的
  let tx = (world.intel && world.intel.level > 0) ? world.intel.x : null, tz = 0, tt = -99;
  if (tx !== null) { tz = world.intel.z; tt = world.intel.t; }
  for (const e of list) {
    const ls = e.ai.lastSeen;
    if (ls && ls.t > tt) { tt = ls.t; tx = ls.x; tz = ls.z; }
  }
  // 威胁参考闩锁: newest-lastSeen 在两台敌车间摆动(各自被轮流目视) → 全队站点跟着溜溜球,
  // 站位闩锁 25m 也拦不住。上一任威胁 60m 内且有更新情报时沿用旧向 —— 队形稳, 角度不闪变
  if (M && M.threat && tx !== null) {
    if (SF.Util.dist2d(tx, tz, M.threat.x, M.threat.z) < 60 && tt > M.threat.t) {
      const ang0 = Math.atan2(tx - M.threat.x, tz - M.threat.z);
      const ang1 = Math.atan2(M.threat.x - tx, M.threat.z - tz);
      if (Math.abs(SF.Util.angDiff(ang0, ang1)) < 0.7) { tx = M.threat.x; tz = M.threat.z; }
    }
  }
  const n = list.length;
  const roles = {};
  const byK = {};
  for (const e of list) byK[keyOf(e, world)] = e;
  const keys = Object.keys(byK).map(Number);
  const slotMemo = (M && M.slotMemo) || {};   // 槽位记忆跨重算持久(键=keyOf)
  const lineKeys = [], flankKeys = [], secondKeys = [];
  const nTD = list.filter(e => (e.spec.cls || 'MT') === 'TD').length;
  for (const e of list) {
    const k = keyOf(e, world), cls = e.spec.cls || 'MT';
    if (cls === 'TD' && n > 1 && nTD > 0) { roles[k] = 'second'; secondKeys.push(k); }   // TD 二线(全队只剩自己→顶线)
    else if (cls === 'TD') { roles[k] = 'line'; lineKeys.push(k); }
    else if (cls === 'HT') { roles[k] = 'line'; lineKeys.push(k); }
    else if (cls === 'SPG') { roles[k] = 'second'; secondKeys.push(k); }                // 火炮也二线, 纵深×1.3
    else { roles[k] = 'flank'; flankKeys.push(k); }                                     // MT/LT 翼侧
  }
  /* 小队全顶线(role.squadLineN): 前线车(非二线 TD/SPG)≤此数时全员顶线 —— 2 车分 顶线+翼侧
     会退化成"顶线单进、残血让位再送一台"的逐个上节奏(顶位补防时序); 全员顶线沿敌向环位
     分站, 配合以大欺小强推(trade.strong)才有小队合力 */
  const frontN = lineKeys.length + flankKeys.length;
  const lineWant = frontN > 0 && frontN <= (RO.squadLineN || 2)
    ? frontN : Math.max(1, Math.round(n * RO.lineMinFrac));
  // 顶线不足 → 从 flank 按 hp% 提拔(血量高的先顶, 挨得起; 排序键=keyOf 保稳定)
  if (lineKeys.length < lineWant && flankKeys.length) {
    flankKeys.sort((a, b) => (byK[b].hp / byK[b].spec.hp) - (byK[a].hp / byK[a].spec.hp));
    while (lineKeys.length < lineWant && flankKeys.length) {
      const k = flankKeys.shift();
      roles[k] = 'line'; lineKeys.push(k);
    }
  }
  // 顶线残血让位: line 且 hp% < yieldHpPct → fallback, 由最近的 flank 补位(补谁的位记进 plugFor)
  const plugFor = {};
  for (const k of lineKeys.slice()) {
    const e = byK[k];
    if (roles[k] === 'line' && e.hp / e.spec.hp < RO.yieldHpPct) {
      roles[k] = 'fallback';
      let bestF = null, bd = 1e9;
      for (const fk of flankKeys) {
        if (roles[fk] !== 'flank') continue;
        const d = SF.Util.dist2d(e.x, e.z, byK[fk].x, byK[fk].z);
        if (d < bd) { bd = d; bestF = fk; }
      }
      if (bestF) { roles[bestF] = 'line'; plugFor[bestF] = k; }
    }
  }
  // 站位(威胁参考缺失时全空, 各车退回原行为):
  //   line=敌向环位(带 lo~mid); flank=敌→队心方位 ±(55~75°+keyOf 哈希±15°)×带中值, keyOf 奇偶分舷;
  //   second=队首(离威胁最近者)反向 tdDepth 钳程 + 1 次 LOS 验证(不通视退 20m 重试一次)
  const teamC = { x: 0, z: 0 };
  for (const e of list) { teamC.x += e.x; teamC.z += e.z; }
  teamC.x /= Math.max(1, n); teamC.z /= Math.max(1, n);
  let leadE = null, ld = 1e9;
  if (tx !== null) for (const e of list) {
    const k0 = keyOf(e, world);
    if (roles[k0] !== 'line') continue;   // 二线锚在顶线车身后: 开局 TD 常比 HT 更靠近敌, 锚"最近车"会把二线锚到自己身后
    const d = SF.Util.dist2d(e.x, e.z, tx, tz);
    if (d < ld) { ld = d; leadE = e; }
  }
  if (tx !== null && !leadE) for (const e of list) {   // 没有顶线车(全灭/未提拔)才退回最近者
    const d = SF.Util.dist2d(e.x, e.z, tx, tz);
    if (d < ld) { ld = d; leadE = e; }
  }
  const stations = {};   // n=1(单挑)不派站位: 没有队形可言, lone 车按性格打(追"翼侧 65°"纯添乱)
  const hash = k => { const s = Math.sin(k * 12.9898) * 43758.5453; return s - Math.floor(s); };   // keyOf→[0,1) 稳定哈希
  const lo0 = (cb) => cb[0];
  // 站点掩体亲和: 站在可探射的硬掩体旁(≤r+12m)——伸缩循环(G2)锚在站点旁, 藏相与角色同尺;
  // 站点本身就是射位(losClear 已验), 到位即有窗, 修"MT/TD 站位 0% 及格"的同时把开火量带回来。
  // 只做布尔距离环扫, 不逐站点跑点阵(节流: 重算拍 0.8s 一次)
  const covNear = (x, z) => {
    for (const c of world.covers.list)
      if (c.blocksShells && SF.Util.dist2d(x, z, c.x, c.z) < c.r + 12) return true;
    return false;
  };
  // 站位必须打得着: 不通视的站位=停进去就熄火(seenNow 由点阵点亮仍真, ready 时钟空转等开窗,
  // fireLatency 被拉爆)。朝威胁拉近 15m 重试一次 —— 拉近保住翼侧角度, 还不通就随它(伸缩循环兜底)
  const losFix = (pt) => {
    if (SF.losClear(world, pt.x, pt.z, tx, tz)) return pt;
    const a = Math.atan2(tx - pt.x, tz - pt.z);
    const p2 = { x: pt.x + Math.sin(a) * 15, z: pt.z + Math.cos(a) * 15 };
    return SF.losClear(world, p2.x, p2.z, tx, tz) ? p2 : null;   // 两处都打不着=弃站(距离链兜底), 不发瞎点
  };
  const CF = SF.CFG.ai.crossfire || { on: 1, minAngleSep: 30, pushOutDeg: 35, plugWindowS: 10 };
  const sideUse = CF.on ? { 1: [], [-1]: [] } : null;   // 本拍同舷已占方位角(重算拍局部, 随 memo 重建)
  for (const k of keys) {
    const e = byK[k], r = roles[k];
    if (tx === null || !leadE || n < 2) { stations[k] = null; continue; }
    const cb = SF.CFG.ai.classBand[e.spec.cls || 'MT'] || [70, 190];
    const mid = (cb[0] + cb[1]) * 0.5;
    if (r === 'flank') {
      const side = (k % 2 === 0) ? 1 : -1;                                  // 奇偶分舷(禁 netId, 用 keyOf)
      const base = Math.atan2(teamC.x - tx, teamC.z - tz);                  // 敌→队心方位
      const deg0 = 55 + 20 * hash(k) + (hash(k * 7 + 1) - 0.5) * 30;        // 55~75° ± 15°
      // 弧线扫掠找射界: 翼侧角 55→125° 逐档试(10° 步进, 全程在 roleFit 的 40~140° 判据内),
      // 本舷优先、越档越宽; 打得着才有站位的意义, 盲站=熄火呆等拉爆迟滞
      // 站点半径取本车当前距离(钳到带内): 翼侧走位=沿自己的弧横移, 不是瞬移到固定 mid 半径的
      // 地图对侧(村屋挡住近弧时固定半径的"最近候选"可能在 170m 外, 趋近耗整局)
      const rad = SF.Util.clamp(SF.Util.dist2d(e.x, e.z, tx, tz), lo0(cb), (cb[0] + cb[1]) * 0.5);
      const mk = (sd, deg) => {
        const ang = base + sd * deg * Math.PI / 180;
        const p = { x: tx + Math.sin(ang) * rad, z: tz + Math.cos(ang) * rad };
        return SF.losClear(world, p.x, p.z, tx, tz) ? Object.assign(p, { side: sd, d: SF.Util.dist2d(p.x, p.z, e.x, e.z) }) : null;
      };
      // 扫掠角钳在 [40°,130°]: 拟合判据是 |角度|∈[40°,140°], deg0−d 无钳会绕回队心轴上
      // (本车那片空域本来就通视, 最近距离规则专挑它 → 站点上轴, 翼侧永不及格)
      let st = null;
      // 同舷方位角占用表(G6①): 两翼互拉——同舷两站对敌方位角差<minAngleSep 时后者外推
      // pushOutDeg(都在同一扇区=交叉火力退化成双打一线, 拉开才有互拉射角); 占用表随重算拍
      // 重建, 记录"本拍已定站的同舷方位"(键空间=对敌方位角, 非标 netId/keyOf——纯几何量)
      for (let d = -30; d <= 60; d += 10) {
        const deg = SF.Util.clamp(deg0 + d, 40, 130);
        for (const c0 of [mk(side, deg), mk(-side, deg)]) {
          if (!c0) continue;
          let c = c0;
          if (c0.side === side) {   // 只对本舷候选查同舷间隔(对舷候选天然分离)
            let deg2 = deg;
            for (const used of sideUse[side])
              if (Math.abs(used - deg) < CF.minAngleSep) { deg2 = deg + CF.pushOutDeg; break; }
            if (Math.abs(deg2) > 130) continue;   // 外推越界(绕到敌后)弃此候选
            if (deg2 !== deg) {
              const c2 = mk(side, deg2);
              if (!c2) continue;
              c = c2; c.deg = deg2;
            } else c.deg = deg;
          } else c.deg = deg;
          c.sc = c.d - (covNear(c.x, c.z) ? 35 : 0);   // 掩体旁站点优先(折算 35m 路程)
          if (!st || c.sc < st.sc) st = c;
        }
      }
      if (st && st.d > 90) st = null;   // 弧上还到不了=弃站: 墙后站点直线 90m 绕行可能 200m, 追它整局白跑(还烧迟滞)
      if (st && st.deg !== undefined) sideUse[st.side].push(st.deg);   // 占用本舷方位(供后车拉距)
      stations[k] = st;
    } else if (r === 'second' || r === 'fallback') {
      const depth = SF.Util.clamp(mid * 0.9, RO.tdDepth[0], RO.tdDepth[1]) * ((e.spec.cls || '') === 'SPG' ? 1.3 : 1);
      const back = Math.atan2(teamC.x - tx, teamC.z - tz);                  // 背敌向(队心侧)
      let d = depth, pt = { x: leadE.x + Math.sin(back) * d, z: leadE.z + Math.cos(back) * d };
      if (!SF.losClear(world, pt.x, pt.z, tx, tz)) {                        // 不通视: 退 20m 重试一次
        d = Math.max(RO.tdDepth[0] * 0.6, d - 20);
        pt = { x: leadE.x + Math.sin(back) * d, z: leadE.z + Math.cos(back) * d };
      }
      // 侧偏 ±14° 再各试一个: 深度带内挑掩体旁(藏相锚), 都不在掩体旁就保底基位
      if (!covNear(pt.x, pt.z)) {
        for (const da of [0.25, -0.25]) {
          const p2 = { x: leadE.x + Math.sin(back + da) * d, z: leadE.z + Math.cos(back + da) * d };
          if (SF.losClear(world, p2.x, p2.z, tx, tz) && covNear(p2.x, p2.z)) { pt = p2; break; }
        }
      }
      stations[k] = pt;
    } else {
      const a0 = Math.atan2(e.x - tx, e.z - tz) + (hash(k) - 0.5) * 0.4;    // 各自扇区微抖, 不叠一起
      const rr = (cb[0] + mid) * 0.5;                                       // 带 lo~mid: 离敌够近才叫顶线
      let st = losFix({ x: tx + Math.sin(a0) * rr, z: tz + Math.cos(a0) * rr });
      for (let d = 10; d <= 30 && !st; d += 10)                             // 挡了就环上扫 ±30° 找射口
        st = losFix({ x: tx + Math.sin(a0 + d) * rr, z: tz + Math.cos(a0 + d) * rr })
          || losFix({ x: tx + Math.sin(a0 - d) * rr, z: tz + Math.cos(a0 - d) * rr });
      stations[k] = st;
    }
  }
  /* 集火槽(G4): 焦点新鲜且目标在存活集时, 按"距焦点近者先占"分 cap 个槽(全队共读)。
     cap=clamp(ceil(存活×0.6), 2, maxPerTarget) —— PVE 护栏: 同时打同一目标的车数有上限,
     残血玩家被 cap 台锁定是设计内强协同但绝不秒杀。槽位滞回(slotHystS): 排名跌出期望集
     且滞回期满才让位, 新进入者只能等空位 —— 两车距焦点距离抖动时槽位来回倒手, 炮口全队
     跟着摆(键=keyOf, 勿按 netId——线上单机 netId 全 0, 同源 R4-A) */
  const FS = SF.CFG.ai.focus;
  const fSlots = (M && M.focusSlots) || {};
  const fObj = world.focus;
  const fTgt = fObj && (world.mpTargets || []).find(e => e.alive && (e.netId || 0) === fObj.netId);
  // 队伍规模门: 活力≥4 才分工集火 —— 3 车小队分 2+1 实测输出掉 40% 挨打翻倍(被分流的那台
  // 独扛另一敌, 集火的两台追机动目标), 人少时各打各带内目标是最优; PVE coop 主战场(10+ 车
  // vs 3~5 玩家)天然过门, 集火护栏(cap≤maxPerTarget)在那边才是主战场
  if (FS.on && fObj && fTgt && now - fObj.t <= FS.memoryS && list.length >= 4) {
    const cap = Math.max(2, Math.min(FS.maxPerTarget, Math.ceil(list.length * 0.6)));
    const ranked = list.slice().sort((a, b) => SF.Util.dist2d(a.x, a.z, fTgt.x, fTgt.z) - SF.Util.dist2d(b.x, b.z, fTgt.x, fTgt.z));
    const desired = new Set(ranked.slice(0, cap).map(e => keyOf(e, world)));
    for (const k of Object.keys(fSlots)) {                        // 淘汰: 死车/掉出且滞回期满
      if (!byK[k] || !byK[k].alive || (!desired.has(k) && now - fSlots[k] > FS.slotHystS)) delete fSlots[k];
    }
    for (const e of ranked) {                                     // 递补: 空位按距焦点近者
      if (Object.keys(fSlots).length >= cap) break;
      const k = keyOf(e, world);
      if (!(k in fSlots)) fSlots[k] = now;
    }
    for (const k of Object.keys(fSlots)) if (desired.has(k)) fSlots[k] = now;   // 在位者心跳
  } else {
    for (const k of Object.keys(fSlots)) delete fSlots[k];        // 无有效焦点: 清槽
  }
  /* 顶位补防(G6②, R2-M4): line 车撤退(ai.state==='retreat')或残血(hp%<yieldHpPct)时,
     补位车=flank 中 hp% 最高者, 其站位钉到该 line 车的站点坐标 —— 钉站点不钉人: threat
     漂移牵动常规站位重排, 补防位必须顶在"顶线缺口"上而不是跟着谁跑; 持续 plugWindowS
     或 line 车阵亡/回线后解除(下次重算自然回 flank 站位)。钉住实现: 记进 memo.plugPinned
     (跨重算持久, 键=keyOf), 站位组装时若在钉住期直接覆盖。前顶-后撤-补位链在此闭合 */
  const plugPinned = (M && M.plugPinned) || {};
  if (CF.on) {
    for (const k of Object.keys(plugPinned))   // 清理: 被钉的 line 车阵亡/补位车阵亡/超窗
      if (!byK[k] || !byK[k].alive || !byK[plugPinned[k].by] || !byK[plugPinned[k].by].alive
          || now > plugPinned[k].until) delete plugPinned[k];
    for (const k of Object.keys(roles)) {
      if (roles[k] !== 'line' || !byK[k].alive) continue;
      const e = byK[k];
      const retreat = e.ai && e.ai.state === 'retreat';
      const low = e.hp / e.spec.hp < RO.yieldHpPct;
      if (!retreat && !low) continue;
      if (plugPinned[k] && now < plugPinned[k].until) continue;   // 已在钉住期, 续期在下方
      let best = null, bh = -1;
      for (const fk of Object.keys(roles)) {
        if (roles[fk] !== 'flank' || !byK[fk].alive || !stations[fk]) continue;
        const h = byK[fk].hp / byK[fk].spec.hp;
        if (h > bh) { bh = h; best = fk; }
      }
      if (best) plugPinned[k] = { by: best, x: stations[k] ? stations[k].x : e.x, z: stations[k] ? stations[k].z : e.z, until: now + CF.plugWindowS };
    }
    for (const k of Object.keys(plugPinned)) {   // 覆盖补位车站位(钉住期)
      const p = plugPinned[k];
      if (roles[p.by] === 'flank') stations[p.by] = { x: p.x, z: p.z };
    }
  }
  const memo = { sig, t: now, list, byK, roles, stations, plugFor, focusSlots: fSlots, slotMemo,
                 plugPinned, threat: tx === null ? null : { x: tx, z: tz, t: tt }, lead: leadE };
  world._teamMemo = memo;
  return memo;
}

// 模拟时钟(类方法内取世界时间用)
function nowT() { return SF.Game && SF.Game.world ? SF.Game.world.time : 0; }

SF.AI = class {
  constructor(tank, def) {
    const U = SF.Util;
    this.tank = tank;
    this.p = SF.CFG.ai.personalities[def.personality] || SF.CFG.ai.personalities.flanker;
    /* ---------- 难度总闸(构造时快照, 全部 AI 强度旋钮的唯一标定口) ----------
       level: 0=现行为完全回退(A/B 基线口径), 0.5≈450效率, 1=800效率默认档。
       快照而非逐帧读: 中途改档只影响新出生的车, 单车内参数恒定(A/B 口径稳定)。
       闸位: 弱点瞄高≥0.4 / 穿深门·换血门·窗口射线·停车即射·伸缩循环≥0.6 —— G1-G3 落地时只消费这些闸, 不另定义 */
    const SK = SF.CFG.ai.skill || { level: 1 };
    const lvl = SK.level === undefined ? 1 : SK.level;
    this._lvl = lvl;
    /* ---------- 装填期摆角度(G2): 唯一角度公式(全下游弧度) ----------
       _angRad = clamp(性格angleSkill×degMid, 0, lerp(0,degMax,level))×π/180
       level=1: flanker 24.2°/sniper 28.5°/hold 32.8°; level=0.6: cap 21°; level=0: 0°(角度归零=模块退化)
       回正预算: 回正耗时=角/转速+settleS, 超过 reload×maxFracOfReload 就把角压到恰好装得下
       (按"可用回正时长×转速"截角——settleS 不随角缩, 若按整个 lead 等比缩会略微超预算) */
    const AN = SF.CFG.ai.angle || { on: 1, degMid: 28.5, degMax: 35, settleS: 0.45, deadzoneDeg: 10, maxFracOfReload: 0.55 };
    this._angRad = SF.Util.clamp(this.p.angleSkill * AN.degMid, 0, SF.Util.lerp(0, AN.degMax, lvl)) * Math.PI / 180;
    const hT = Math.max(tank.spec.hullTraverse || 0.4, 0.05);   // rad/s(G4 协议扩列后 worker 主路径可得)
    const budget = (tank.spec.gun.reload || 3) * AN.maxFracOfReload;
    this._angUse = !AN.on ? 0 : Math.min(this._angRad, Math.max(0, budget - AN.settleS) * hT);   // 预算内实际摆角
    // 回正提前量(角÷转速+静止收敛尾): 仅歼击车消费——固定战斗室炮随车体, 开火前必须物理
    // 回正到敌向(G5①, +0.2 裕量)。有炮塔车不回正: 炮塔独立瞄准, 车体全程保持受弹角
    // (G5 回归轮实测: 回正-再摆出的振荡才是 fireLat 0.43→0.63 的根源——每装填周期两次
    // 满舵转体, bloom 全落在 ready 时钟上; 保持角度既是最优装甲姿态也让 bloom 在保持期掉完)
    this._straightenLead = this._angUse / hT + AN.settleS;
    this._tdMul = AN.tdMul || 0.8;   // 歼击车摆角系数(G5): 摆小一点, 换回正短一点(伺服尾已在
    // 等待窗, 摆角窗本身是全装的——0.8×角省 20% 的摆+回正时长)
    this._angSide = 1;                                          // 摆边: 进战边沿按 flankSlot 奇偶定, 整回合保持(onHurt 不翻)
    this._angDead = AN.deadzoneDeg * Math.PI / 180;             // 回正死区(区内 steer 硬 0, 防车体微调带炮塔随动持续扩圈)
    this._maxFracReload = AN.maxFracOfReload;                    // 装填预算比例(停车即射同款阈值, 单一来源)
    this._rearmS = SF.Util.lerp(0.05, 0.3, lvl);   // 再瞄准窗口时长: level=1 时=fireDisc.rearmS(0.3)
    this._gWeak = lvl >= 0.4;   // 弱点瞄高选面闸: <0.4 退回二值瞄高(aimPatience 阈值)
    this._gGate = lvl >= 0.6;   // 穿深门/换血门闸
    this._gWin = lvl >= 0.6;    // 窗口射线/停车即射/重露头再反应闸(开火纪律整模块)
    this._gPeek = lvl >= 0.6;   // 伸缩循环闸(G3 落地时消费)
    this._gPreAim = lvl >= 0.4; // 预瞄纪律闸(G8): 推进中转向分档, 保炮塔回服敌向(与弱点瞄高同闸)
    this._preAimYaw = null;     // 本帧预瞄方位(null=未知, navigate 不分档); 各状态分支每帧重置重写
    this._advancing = false;    // 本帧是否推进导航(突入/前压/围攻接近) —— 预瞄压舵只挂推进, 弧线机动豁免
    /* ---------- 开火纪律(窗口状态机/停车即射/重露头再反应)状态 ----------
       _winState.open: 粗门=seenNow, 精化=炮口射线(每 recheckS 复评); since=本次关闭时刻(null=开着)。
       隐藏时长由 since 计量, 不设 reloadT 门槛 —— 长装填期照常计量, 重露头才好按隐藏时长补反应 */
    const FD = SF.CFG.ai.fireDisc || { on: 1, recheckS: 0.2, rearmS: 0.3, rearmBrawlS: 0.15, settleS: 1.5, rearmMinHiddenS: 0.4 };
    this._fd = FD;
    this._rearmBrawlS = this._rearmS * (FD.rearmBrawlS / FD.rearmS);   // 贴身重露头减半, 随 level 同比例缩
    this._winState = { open: false, since: null, blk: 0, openT: 0 };   // blk=最近遮挡类型(0通/1地形挡/2掩体挡); openT=窗口起开时刻
    this._winChkT = -9;         // 射线复评节流
    this._tactic = 'skirmish';  // 当前战术(G9 路由): 交战态每拍重估, 非交战态无意义
    this._tacT = 0;             // 路由节流时钟
    this._hillAuth = false;     // 高地强袭授权(共享计划登记数达标)
    this._hillCommit = false;   // 高地转进闩锁(已开始爬坡: 爬到棱线为止, 不看窗口闪断)
    this._hillGoT = 0;          // 共享计划的同拍转进时刻
    this._cfPt = null;          // 绕掩体转进点(G9-④)
    this._cfT = -9;             // 绕点重估时钟
    this._revPulseOk = false;   // 本帧导航是否来自随机换位脉冲(倒车转移 G9-① 的唯一准入源)
    this._settleT = -1;         // 停车即射剩余时长(-1=未在停车)
    this._settleCd = 0;         // settle 超时后的重试冷却(超时要让车动起来, 防站桩挨打)
    this.patrol = (def.patrol || []).map(w => ({ x: w[0], z: w[1] }));
    this.hold = !!def.hold;
    this.home = { x: tank.x, z: tank.z };

    this.state = 'patrol';
    this.wp = 0;
    this._lastRadio = -99;
    this._alertT = 0;
    this._searchT = 0; this._searchPt = null;
    this.flankSlot = Math.random() * Math.PI * 2;   // 合围扇区(spawnWave 会按波次均匀重排)

    // 无线电: 友军发现/听见玩家 → 全队广播坐标(不限距离), 收到即前往支援
    SF.Bus.on('aiRadio', (e) => {
      if (!this.tank.alive || e.from === this.tank || this.state === 'combat') return;
      this.heard = { x: e.x + (Math.random() - 0.5) * 24, z: e.z + (Math.random() - 0.5) * 24, t: world2time() };
      if (this.state !== 'alert') { this.state = 'alert'; this._alertT = world2time(); }
    });
    function world2time() { return SF.Game && SF.Game.world ? SF.Game.world.time : 0; }
    this.input = { throttle: 0, steer: 0, aimYaw: tank.yaw, aimPitch: 0, fire: false };
    this.seen = false; this.reactT = 0; this._seenAnyT = -9;
    this.lastSeen = null; this.lastSeenT = -99;
    this.heard = null;
    this.perceptT = Math.random() * SF.CFG.ai.perceptionInterval;
    this.repositionT = 3 + Math.random() * 4;
    this.retreatT = 0; this.unstuckT = 0; this.stuckT = 0;
    this.navYawJitter = 0;
    this._navPath = null; this._navGoal = null; this._navT = -9; this._navChk = -9;   // 地形绕行路径缓存
    this._fHpw = {};   // 焦点血账: netId → 见过最高血(评分分母, 首写=当前血, 见更高即抬)
    // 换血血账(快照 r.hp 增量记忆): netId → {hp 当前, max 见过最高血≈敌上限估计}
    // max 只能靠"见过的最高血"估计(快照不带敌 spec), 首见残血会低估上限 → ePct 偏高 → 更谨慎, 方向安全
    this.hpMemo = {};
    // 穿深门兑底链状态: _gateTries 换位配额(每回合重置, 上限 2), _gatePt 当前侧向换位点, _gateTrack 履带次选豁免态
    this._gateTries = 0; this._gatePt = null; this._gatePtT = -99; this._gateTrack = false;
    this._flankPlanT = -99;    // 绕侧计划有效期: 绕侧/侧向换位行进中 = 履带次选条件之一
    this._trackT = -99;        // 上一发履带弹时刻: 连续≤1发配额(reload+弹道时间后才允许下一发)
    this._aimTy = 0;           // 本帧瞄点绝对高度: G1 窗口射线终点高度的单一事实源(同帧取, 勿另算)
    /* ---------- 掩体伸缩循环(G2)状态 ----------
       _coverPhase: none/hide/peek —— 只在 combat 内运行; 藏点/探点在相位入口重找一次。
       _peekLead: 探出提前量(藏→探车程+收敛尾+垫), 装填余量低于它就出掩 —— 宁早到等装填, 不迟到吃迟滞 */
    this._coverPhase = 'none';
    this._coverPt = null; this._coverPeek = null;
    this._peekLead = 2; this._hideFrac = 0.6;
    this._coverT = 0; this._coverEnterT = -9; this._revStuckT = 0; this._hideChkT = -9; this._coverSpotOK = false;

    // 听觉: 玩家开炮 → 炮声全图可闻, 记下大致方位(误差随距离增大: 远处只知个大概)
    SF.Bus.on('fire', (e) => {
      if (this.tank.alive && (e.tank.isPlayer || e.tank.team === 0)) {   // 合作: 任何玩家开炮都会被听见
        const d = SF.Util.dist2d(this.tank.x, this.tank.z, e.tank.x, e.tank.z);
        if (d < SF.CFG.ai.shotHearing) {
          const err = 14 + d * 0.06;
          this.heard = { x: e.tank.x + (Math.random() - 0.5) * 2 * err, z: e.tank.z + (Math.random() - 0.5) * 2 * err, t: world2time() };
        }
      }
    });
  }

  /* ---------- 被击中感知: 中弹 = 确切知道自己挨了打, 冲击方向大致可判 ----------
     立即上报全队(等级2情报: 有目标准接触), 自己转入警觉/追击, 炮口转向来袭方向 */
  onHurt(shooter) {
    if (!this.tank.alive || !shooter || shooter.team === this.tank.team) return;
    const err = 20 + Math.random() * 14;
    const hx = shooter.x + (Math.random() - 0.5) * 2 * err, hz = shooter.z + (Math.random() - 0.5) * 2 * err;
    this.heard = { x: hx, z: hz, t: nowT() };
    this._hurtT = nowT();
    const w = SF.Game.world;
    if (w) w.intel = { x: hx, z: hz, t: nowT(), level: 2 };   // 中弹=确认接触, 全队共享
    if (!this.seenNow) this.lastSeen = { x: hx, z: hz, vx: 0, vz: 0, t: nowT() };
    SF.Bus.emit('aiRadio', { from: this.tank, x: hx, z: hz });   // 呼叫支援(不限距离)
    if (this.state === 'patrol') { this.state = 'alert'; this._alertT = nowT(); }
  }

  /* ---------- 感知 ---------- */
  perceive(world) {
    const player = nearestTarget(world, this.tank);
    const wasSeen = this.seen;
    this.seen = false;
    if (player && player.alive) {
      const d = SF.Util.dist2d(this.tank.x, this.tank.z, player.x, player.z);
      // 点亮(WoT): 50m 内无视遮挡强制点亮; 否则 视距×(1-目标隐蔽) + 点阵通视(草丛对蹲草目标算遮挡)
      const vr = this.tank.spec.view || SF.CFG.ai.viewRange;
      if (d < 50 || (d < vr * (1 - SF.camoOf(player, world)) && SF.losClearAny(world, this.tank, player))) {
        this.seen = true;
        this.lastSeen = { x: player.x, z: player.z, vx: player.velX || 0, vz: player.velZ || 0, t: world.time };
        this.lastTargetId = player.netId || 0;
        // 目视确认 → 上报全队情报(任何一辆看见, 全队都知道玩家在哪)
        world.intel = { x: player.x, z: player.z, t: world.time, level: 2 };
        if (!wasSeen && this.state !== 'combat')
          this.reactT = SF.CFG.ai.reactionTime * (1 + (1 - this.p.aimPatience));  // 反应延迟
        // 无线电呼叫支援(冷却)
        if (world.time - this._lastRadio > SF.CFG.ai.radio.cooldown) {
          this._lastRadio = world.time;
          SF.Bus.emit('aiRadio', { from: this.tank, x: player.x, z: player.z });
        }
        this._focusCall(player, world, d);   // 集火呼叫写入(仅 perceive 入口, 见函数头注)
      }
    }
    this.seenNow = this.seen;
    if (this.seen) this._seenAnyT = world.time;   // 分流车熄灯判据: 最近看见(自己的)目标时刻
  }

  /* ---------- 集火呼叫写入(G4): 仅 perceive 入口 ----------
     world.focus={netId,t,hp,hpw,sc} 本线程一份, 永不跨线程——勿仿照 intel 把 focus 加进
     sendAISnap(那将违反禁改 10Hz 快照协议的硬约束; intel 有跨线程同步链是它的先例, focus 没有)。
     入口只在 perceive: onHurt 载荷只有 {id,x,z}(worker 组装 {x,z,team:0}), 无 netId 无 hp,
     在 worker 无从维护 hpw/评分, 砍掉; onHurt 的 heard/intel 上报照旧不动。
     评分(R2-M1): 0.7×(1−hp/hpw)+0.3×(1−min(dist,400)/400) —— 残血与近距优先; 击杀窗
     (hp≤自身dmg×trade.killMult)直取 1(能收的人头全队都该收)。
     换靶纪律: 换目标须距上次写入>updateS 且分差>0.1; 换靶后 switchS 内不回切旧目标
     (两目标分数接近时会来回翻, 全队炮口跟着摆, 谁都打不全)。 */
  _focusCall(tgt, world, d) {
    const FO = SF.CFG.ai.focus;
    if (!FO.on || !tgt || !tgt.alive) return;
    const pid = tgt.netId || 0, now = world.time;
    const memo = this._fHpw[pid] || (this._fHpw[pid] = { hpw: tgt.hp });
    if (tgt.hp > memo.hpw) memo.hpw = tgt.hp;                     // 见过更高血即抬分母
    // 距离项用"队心→目标"而非"写入者→目标": 写入者距离使焦点取决于谁先感知(同一时刻各车
    // 写出不同分, 先到先得), 队心距离是全队一致的标尺——焦点稳定, 换靶只随血量走(0.7 权重)
    let cx = 0, cz = 0, cn = 0;
    for (const e of world.enemies) if (e.alive) { cx += e.x; cz += e.z; cn++; }
    const dc = cn ? SF.Util.dist2d(cx / cn, cz / cn, tgt.x, tgt.z) : d;
    let sc = 0.7 * (1 - tgt.hp / Math.max(memo.hpw, 1)) + 0.3 * (1 - Math.min(dc, 400) / 400);
    if (tgt.hp <= this.tank.spec.gun.dmg * (SF.CFG.ai.trade.killMult || 1.2)) sc = 1;
    const f = world.focus;
    const stale = !f || now - f.t > FO.memoryS
      || !(world.mpTargets || []).some(e => e.alive && (e.netId || 0) === f.netId);
    if (stale) { world.focus = { netId: pid, t: now, hp: tgt.hp, hpw: memo.hpw, sc }; return; }
    if (f.netId === pid) { f.t = now; f.hp = tgt.hp; f.sc = sc; return; }   // 同目标心跳免分差门
    if (!(now - f.t > FO.updateS && sc > f.sc + 0.1)) return;      // 节流+分差
    const prev = world._focusPrev;
    if (prev && prev.netId === pid && now < prev.until) return;    // 换靶冷却内不回切
    world._focusPrev = { netId: f.netId, until: now + FO.switchS };
    world.focus = { netId: pid, t: now, hp: tgt.hp, hpw: memo.hpw, sc };
  }

  /* ---------- 导航: 朝目标点输出油门/转向, 含避障/避陡坡/防卡死 ---------- */
  navigate(px, pz, dt, world, faceYaw = null) {
    const U = SF.Util, t = this.tank, T = world.terrain;
    // 卡死检测
    if (this.input.throttle > 0.4 && Math.abs(t.speed) < 0.25) { this.stuckT += dt; } else this.stuckT = 0;
    if (this.stuckT > 2) { this.unstuckT = 1.5; this.stuckT = 0; }
    if (this.unstuckT > 0) {   // 倒车脱困
      this.unstuckT -= dt;
      this.input.throttle = -1; this.input.steer = this.navYawJitter > 0 ? 1 : -1;
      return;
    }

    // 路径级绕行: 直线穿不过(壕/崖/凹槽)时改走网格 BFS 路径点——过壕走缺口、遇山绕环坡;
    // 检查节流 0.3s, 直线恢复畅通即弃路, 目标移出当前格(>18m)或超龄(有路 3s/无路 1s)重算
    if (world.time - this._navChk > 0.3) {
      this._navChk = world.time;
      if (navLineClear(T, t.x, t.z, px, pz)) this._navPath = null;
      else if (!this._navGoal ||
               Math.abs(this._navGoal[0] - px) + Math.abs(this._navGoal[1] - pz) > 18 ||
               world.time - this._navT > (this._navPath ? 3 : 1)) {
        this._navPath = navFindPath(T, t.x, t.z, px, pz);
        this._navGoal = [px, pz]; this._navT = world.time;
      }
    }
    if (this._navPath && this._navPath.length) {
      while (this._navPath.length && SF.Util.dist2d(t.x, t.z, this._navPath[0][0], this._navPath[0][1]) < 14) this._navPath.shift();
      const wp = this._navPath[0];
      if (wp) { px = wp[0]; pz = wp[1]; } else this._navPath = null;
    } else this._navPath = null;

    const dx = px - t.x, dz = pz - t.z, dist = Math.hypot(dx, dz);
    let desiredYaw = (faceYaw !== null && this.p.holdGround) ? faceYaw : Math.atan2(dx, dz);

    // 前方陡坡回避: 试探 ±50° 找缓坡
    if (Math.abs(T.slopeAhead(t.x, t.z, t.yaw, 6)) > SF.CFG.sim.maxSlope * 0.85) {
      const sL = Math.abs(T.slopeAhead(t.x, t.z, t.yaw - 0.9, 6)), sR = Math.abs(T.slopeAhead(t.x, t.z, t.yaw + 0.9, 6));
      desiredYaw = t.yaw + (sL < sR ? -0.9 : 0.9);
    }
    // 前方掩体回避
    const fx = t.x + Math.sin(t.yaw) * 7, fz = t.z + Math.cos(t.yaw) * 7;
    for (const c of world.covers.list) {
      if (!c.blocksMove || c.blocksShells === false && c.r < 1) continue;
      const d = Math.hypot(fx - c.x, fz - c.z);
      if (d < c.r + 3) { desiredYaw = t.yaw + Math.sign(SF.Util.angDiff(t.yaw, Math.atan2(t.x - c.x, t.z - c.z) + Math.PI / 2)) * 0.8; break; }
    }

    const dYaw = SF.Util.angDiff(t.yaw, desiredYaw);
    this.input.steer = SF.Util.clamp(dYaw * 2.5, -1, 1);
    /* 预瞄纪律(G8): 仅"推进"导航(_advancing: 突入直插/交战前压/围攻接近)时压舵, 保炮塔回服敌向 ——
       vehicle 的炮塔刚体随动在 |steer|>0.15 时锁炮塔跟车体, 旧导航航向修正动辄满舵,
       炮管一路指行进方向, 敌露头才从半圈外从头转炮(慢炮塔 3~6s), 首发必慢。
       压舵: 偏差 0.06~0.15rad(推进航点沿敌向线, 微修正天然落此档)舵量钳 ≤capSteer(0.14,
       恰低于随动阈值)——车体边走边修而炮塔持续伺服敌向, 全程炮口压敌;
       >0.15rad(绕行/掉头)全舵快转, 锁炮塔就锁——快速完成转向本身就是少侧露;
       <0.06rad 原样(P 控制本就低于阈值, 炮塔自由伺服)。
       只挂推进: 战术弧线(翼侧横移/绕侧/换位/伸缩)豁免——角度门(±75°)/bang-bang 脉冲/宽压舵带
       (≤0.35)各版实测都把 sideExposed 从基线 ~10.4 拖到 11.5~20.8(慢转过 60~90° 侧露带)。
       歼击车(noTurret)豁免: 炮随车体, 转向即转炮, 到点由 faceYaw 回正管 */
    if (this._advancing && this._preAimYaw !== null && this._gPreAim && !t.parts.noTurret && this.input.throttle !== 0) {
      const PA = SF.CFG.ai.preAim;
      if (PA && PA.on) {
        const a = Math.abs(dYaw);
        if (a > 0.06 && a <= 0.15) this.input.steer = SF.Util.clamp(dYaw * 2.5, -PA.capSteer, PA.capSteer);   // 只压微修正(≤8.6°); 真转向全舵快过侧露带
      }
    }
    const arrived = dist < 4;
    this.input.throttle = arrived ? 0 : (Math.abs(dYaw) > 1.3 ? 0.12 : 1);
    if (arrived) this.input.steer = faceYaw !== null ? SF.Util.clamp(SF.Util.angDiff(t.yaw, faceYaw) * 2.5, -1, 1) : 0;
  }

  /* ---------- 交战带取值闸: 带插值的唯一接线点 ----------
     level<0.4 恒退回性格原带(低难度完全回现行为); ≥0.4 按角色分工(G3)插值:
     [lo,hi] = lerp(性格带, 车型带, bandMix) —— 纯性格带会让歼击车贴脸/火炮前压, 纯车型带抹掉
     性格差异, 各掺一半; 二线角色(second/fallback)再 lo×1.1(本就不该顶在最前)。
     带值在 update 头部算好缓存(this._band), 这里只读 —— bandFor 的调用点都拿不到 world */
  bandFor() {
    if (!this._gWeak) return this.p.band;   // 低难度回退口径: 恒原带
    return this._band || this.p.band;
  }

  /* ---------- 开火窗口射线: 炮口→本帧瞄点(G4 弱点选面或 legacy 二值) ----------
     终点高度取瞄点段的同一个 ty(与 aimPitch 同一变量, 单一事实源), 不用固定眼高 ——
     矮掩体(顶 0.7~0.9m)挡住瞄点时窗口同步判关, 不对掩体白费弹。
     地形段不能调 terrain.losBlocked: 它是点亮判定, 每采样点给地形 +1.6m 视高补贴(simcore 同源),
     打向 0.6~1.2m 瞄点的下降射线在平地上也会被判"撞土坡" → 窗口永远打不开;
     这里按同款 2m 步进自己采样裸 heightAt(只依赖注入的 world.terrain, 主线程/worker 通用) */
  _winRayClear(predX, predZ, ty, world, ox, oz) {
    const t = this.tank, T = world.terrain;
    const sx = ox !== undefined ? ox : t.x, sz = oz !== undefined ? oz : t.z;   // 起点覆盖(探点验收用)
    const ay = (ox !== undefined ? T.heightAt(sx, sz) : t.y) + 2.0;   // 外部起点眼高取该点地形高
    // (用本车当前 y 会在坡地上差出好几米, 探点验收被假挡)
    const dx = predX - sx, dz = predZ - sz, len = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(len / 4));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (ay + (ty - ay) * f <= T.heightAt(sx + dx * f, sz + dz * f)) return 1;   // 地形挡(反斜面)
    }
    if (len < 1) return 0;
    return world.covers.blocked(sx, sz, ay, dx / len, dz / len, len, (ty - ay) / len) < 0 ? 0 : 2;   // 2=掩体挡
  }

  /* ---------- 窗口判定唯一链(R4-C): 周期复评与 fire gate 即时复评都过这同一对函数 ----------
     边沿语义与重露头补反应(rearm)完全同构, 无路径差异可被绕过 —— 同步路径不补 rearm 的话,
     "seenNow 且射线被挡且炮已就绪"的车每 tick 都满足'其余全真而 open=false', 同步几乎总抢在
     周期前开窗, 周期路径的 rearm 会沦为死代码(重露头不再补反应, 白送 AI 反应速度)。
     _winCheck: 地形挡(反斜面只露上车体)且非履带弹 → 抬瞄点试车体中线(gy+1.2), 通则连抬后的
     ty 一起返回(aimPitch 与窗口射线仍同一变量); 掩体挡(矮墙头顶窄条)→ 按关, 不对掩体浪费弹。 */
  _winCheck(predX, predZ, ty, gy, trackAim, world) {
    const blk = this._winRayClear(predX, predZ, ty, world);
    if (blk === 1 && !trackAim) {   // 履带弹不回退(那本就是打低部位)
      const tyHi = gy + 1.2;
      if (this._winRayClear(predX, predZ, tyHi, world) === 0) { this._winState.blk = 0; return { clear: true, ty: tyHi }; }
    }
    this._winState.blk = blk;   // 0/1/2=通/地形挡/掩体挡 —— 战术路由(G9)靠它区分"敌踞高地"与"敌蹲掩体"
    return { clear: blk === 0, ty };
  }

  /* _winEdge: 关→开边沿 = 重露头 —— 隐藏够久(rearmMinHiddenS)才补反应, 抖动探头不重罚,
     首见(since=null)不补(首次反应由 perceive 的 reactionTime 管); 开→关边沿 = 记隐藏起点;
     其余情况不写字段(含已关着仍被挡 —— since 锚点不滑动, 隐藏时长不被反复刷新注水)。
     例外: 掩体伸缩(G2)自己探出的那次重露头不补 —— 藏相里炮口一直指着目标最后位置, 探出
     是本车主动行为(预先瞄准好了), 再吃 0.3s 反应就成了"出掩即射"的反面; 对面真换位偷袭
     仍走 seenNow/aimed 门兜底(打出 stale 弈的代价由 fire 门前的对准判定兜住)。 */
  _winEdge(res, brawl, world) {
    const W = this._winState;
    if (res.clear && !W.open) {
      const hidden = W.since === null ? 0 : world.time - W.since;
      if (hidden > this._fd.rearmMinHiddenS && this._coverPhase !== 'peek')
        this.reactT = Math.max(this.reactT, brawl ? this._rearmBrawlS : this._rearmS);
      W.open = true; W.since = null; W.openT = world.time;   // openT=窗口起开时刻(果断快炮 G9-② 判"新鲜窗口"用)
    } else if (!res.clear && W.open) {
      W.open = false; W.since = world.time;
    }
  }

  /* ---------- 藏点可见性判据(点阵口径): 与点亮同一套几何 ----------
     旧判据是眼高 2m 单线通视(SF.losClear) —— 棱线/矮掩体后车体中线被挡就算"藏住", 但
     敌方点亮走 SF.losGrid 25 柱点阵(柱顶 +3.3m): 炮塔顶仍露在掩体/棱线上, 点亮照样
     成立, "藏相"实际是在掩体后挨打。藏点验证/到点判定/遮断复验统一改点阵口径
     (obs 取 ref 车宽铺 3 视点, 目标按本车足迹转 OBB) —— AI 对"我藏没藏住"的认知与
     敌方点亮规则同源, 不再自欺。节流: 只在相位入口(0.25s 拍)与到点复验(0.2s 拍)调用。 */
  _gridHidden(x, z, ref, world, faceYaw) {
    const t = this.tank, s = (t.spec && t.spec.sample) || { w: 1.5, l: 3.05 };
    const rs = (ref.spec && ref.spec.sample) || { w: 1.5 };
    const face = faceYaw !== undefined ? faceYaw : Math.atan2(ref.x - x, ref.z - z);
    // faceYaw 缺省=车头朝敌(倒车入位的设计终态, 找点用); 复验/到点判定传实际 t.yaw ——
    // 点阵 OBB 足迹随车头转, 探出方向驶入的"车头朝舷"姿态比"朝敌"宽出一截, 不按实际
    // 车头验会把侧停的车判成藏住(S3 实测停进 H 格仍被点亮, coverUse 记 0)
    return !SF.losGrid(world, ref.x, ref.z, rs.w, x, z, face, s.w, s.l, null);
  }

  /* ---------- 掩体伸缩循环(G2): 藏点搜索(相位入口 0.25s 拍跑) ----------
     藏点硬口径=点阵全柱隐藏(_gridHidden, 见上): 半藏(只挡眼高中线, 炮塔顶柱仍亮)在台内
     = 机器人 canSee 照旧 true 照旧开火, coverUse 记 0 —— 挨打且白跑(S1 实测眼高藏点 57+28
     采样覆盖全 0), 压不出全藏位就弃掉该候选, 宁可不进循环也不做空转循环。
     两类藏点:
     ①硬掩体(blocksShells)在我与敌之间(s≥4)—— 不设走廊横距门: 旧门只认"掩体圆心贴弹道
       线 ±(r+2.5)", 实测把 S4/S5 车旁 2~18m 的墙/岩全拒成 noSpot(机器人绕行后掩体挡的
       是当前方位的楔形阴影, 藏点构造沿"掩体→背敌向"推 r+3, 本就不需要在直线上)。
       藏点=背敌侧 r+3 起步逐 1.5m 压深到点阵全藏(≤3 步); 探点=贴角侧探(见 _peekMarch),
       行程比旧"近敌缘构造"(2r+6≈14m)短一半以上, 装填窗装得下往返。草丛不作藏点(挡视线
       不挡弹), 只作 bushAffinity 探点加分(自己 >4s 未开炮才有静止隐蔽加成)。
     ②反斜面棱线(见 _ridgeSpot): 扇扫找点阵全藏口袋。 */
  _findCoverSpot(world, ref, distP, lo, tripMax) {
    const CV = SF.CFG.ai.cover, U = SF.Util, t = this.tank;
    const ux = (ref.x - t.x) / Math.max(distP, 1), uz = (ref.z - t.z) / Math.max(distP, 1);   // 我→敌
    let best = null, bs = -1e9;
    // 探点纵深钳: 距敌不过分近(带纪律的本地化身); 上限=带下沿×minDistFrac, 但不超过
    // 当前距的 0.9 —— 二线 TD 带下沿 176m 而实际交战 51m 时, 纯带钳会把全部本地掩体判废
    const minPD = Math.max(20, Math.min(lo * CV.minDistFrac, distP * 0.9));
    const fresh = world.time - (t.lastFireT || -99) > 4;   // 蹲草加分只在静止候选段(移动隐蔽减半)
    const march = CV.peekMarchM || 8;
    for (const c of world.covers.list) {
      if (!c.blocksShells) continue;                          // 只认挡弹的硬掩体
      const cx = c.x - t.x, cz = c.z - t.z, cd = Math.hypot(cx, cz);
      if (cd > CV.maxCoverDist || cd > distP - 8) continue;    // 太远 / 越过敌身
      const s = cx * ux + cz * uz;                             // 走廊投影(沿敌向)
      if (s < -(c.r + 3)) continue;                            // 深藏身后(>r+3)才弃: 倒车都骑不上去的
                                                             // 远背墙藏实测无增益且小队输出减半;
                                                             // 近背后墙(S5 走廊墙就在车旁 2~3m)退几米
                                                             // 就是背敌侧藏位, 行程界由 appMax 兜
      let hx = c.x - ux * (c.r + 3), hz = c.z - uz * (c.r + 3);
      if (world.terrain.gradAt(hx, hz) > NAV_G) continue;      // 陡壁/壕里是白跑
      // 先探点后验藏: 藏点的验收姿态=入位终态车头(有炮塔=探出舷向, 无炮塔=对敌), 见下
      const pk0 = this._peekMarch(hx, hz, ux, uz, ref, minPD, march, world, false);
      if (!pk0) continue;                                      // 压不出探位=探出去也开不了窗
      const faceH = t.parts.noTurret ? Math.atan2(ref.x - hx, ref.z - hz)
                                     : Math.atan2(pk0.x - hx, pk0.z - hz);
      let hid = this._gridHidden(hx, hz, ref, world, faceH);
      for (let i = 1; i <= 3 && !hid; i++) {                   // 点阵压深(硬要求, 见头注)
        const nx = hx - ux * 1.5 * i, nz = hz - uz * 1.5 * i;
        if (world.terrain.gradAt(nx, nz) > NAV_G) break;
        if (this._gridHidden(nx, nz, ref, world, faceH)) { hx = nx; hz = nz; hid = true; }
      }
      if (!hid) continue;                                      // 半藏=白跑, 弃
      const pk = pk0;
      const face = faceH;
      if (U.dist2d(hx, hz, pk.x, pk.z) > tripMax) continue;    // 往返装不进装填窗
      let sc = -cd / 15 - Math.max(0, lo - U.dist2d(pk.x, pk.z, ref.x, ref.z)) / 20;   // 少跑路 + 不无故压进带内
      // 站位亲和(藏点→站位距离): 循环锚在角色站位旁=循环期不脱角色(roleFit) —— 前提是
      // 站位旁真有掩体; 没有就靠少跑路项自然选, 不硬拉
      if (this._station) sc += Math.max(0, 3 - U.dist2d(hx, hz, this._station.x, this._station.z) / 15);
      if (CV.bushAffinity && fresh) {
        for (const b of world.covers.list)
          if (b.blocksSpot && !b.blocksShells && U.dist2d(b.x, b.z, pk.x, pk.z) < b.r + 2) { sc += CV.bushAffinity; break; }
      }
      if (sc > bs) { bs = sc; best = { hide: { x: hx, z: hz }, peek: pk, face: faceH, cov: c }; }
    }
    if (!best) best = this._ridgeSpot(world, ref, ux, uz, lo, tripMax, march);
    if (!best) return null;
    // 探出提前量: 藏→探是前进档(≈0.6×极速, 横向贴角探出)+收敛尾+垫 —— 早到等装填的裸奔
    // 时间要压到最小: 提前量按实际车速计, 到点即装填完毕, ready 时钟不在移动扩圈上空转
    const vP = Math.max(4, (t.spec.maxSpeed || 8) * 0.6);
    best.lead = U.dist2d(best.hide.x, best.hide.z, best.peek.x, best.peek.z) / vP + 0.45 + (CV.peekPad || 0.3);
    return best;
  }

  /* 贴角侧探: 从藏点沿垂直于敌向的两侧(合围舷优先)逐米探出, 首个"眼高通视"点=探点;
     侧向压不出(长墙/深檐)再沿敌向翻掩体缘。探点判定必须用炮口射线口径(眼高 2m 中线通视)
     而不是点阵可见 —— 点阵是"任一柱对通"(含擦角柱对), 探点上炮口中线仍可能吃掩体角,
     开火窗口(_winCheck 的中线射线)永不开 → 探相干等到超时退相, 循环拆链(S2/S5 实测
     探相 2.1~2.5s 全程 cap 退出一发没打)。纵深钳/陡壁照旧。 */
  _peekMarch(hx, hz, ux, uz, ref, minPD, march, world, ridge) {
    const side = this.flankSlot > Math.PI ? 1 : -1;
    // 方向序: ridge=对敌向优先(直线往复, 车头朝敌入位=出掩即射); 硬掩体=侧探优先(行程短,
    // 往返装得进装填窗 —— 直线优先实测把点位选择搅乱, S4 覆盖 50.6→16)
    const dirs = ridge ? [[ux, uz], [-uz * side, ux * side], [uz * side, -ux * side]]
                       : [[-uz * side, ux * side], [uz * side, -ux * side], [ux, uz]];
    for (const [mx, mz] of dirs) {
      for (let e = 1; e <= march; e++) {
        const px = hx + mx * e, pz = hz + mz * e;
        if (world.terrain.gradAt(px, pz) > NAV_G) break;       // 探点不落陡壁
        if (SF.Util.dist2d(px, pz, ref.x, ref.z) < minPD) break;   // 纵深钳(再探只会更近)
        // 探点可用性=开火窗射线在探点能开(含地形抬高回退, 与 _winCheck 的 tyHi 同构) ——
        // 开火门全面走窗口后, 点阵口径的探位"看得见打不着"(贴角 1~3m 处柱对擦角可见而炮口
        // 中线吃角), 旧版靠贴身豁免盲射出的假循环(S4 追踪 46 发全打进掩体/地形, 8 中)
        const gy = world.terrain.heightAt(ref.x, ref.z);
        let blk = this._winRayClear(ref.x, ref.z, gy + 1.0, world, px, pz);
        if (blk === 1) blk = this._winRayClear(ref.x, ref.z, gy + 1.2, world, px, pz);
        if (blk === 0) return { x: px, z: pz };
      }
    }
    return null;
  }

  /* 反斜面棱线: 8 向扇扫(背敌向优先)3m 步进 ≤24m 找首个点阵全藏格, 再从藏格探出首发位。
     为什么扇扫而不是只沿背敌轴: 缓坡的半盲带(眼高挡/点阵列)沿轴常有 10m+ 宽(S3 实测眼高
     藏 d10 起、点阵藏 d20 起, 12m 往返装不进 3.4s 装填), 而棱线锐缘的贴棱口袋往往在斜向
     (S3 实测 x+18m 处藏/探只隔 3~5m) —— 直轴扫到的是缓坡, 扇扫才找得到口袋。
     全程点阵口径: 压不出全藏格(平地 S1 实测 40m 内零点阵藏位)→ 返回 null 不进循环,
     摆角相维持全装填窗。评分取"到藏格行程+藏↔探行程"最小(少跑路)。 */
  _ridgeSpot(world, ref, ux, uz, lo, tripMax, march) {
    const U = SF.Util, t = this.tank;
    const minPD = Math.max(20, Math.min(lo * SF.CFG.ai.cover.minDistFrac, SF.Util.dist2d(t.x, t.z, ref.x, ref.z) * 0.9));
    const dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.sin(k * Math.PI / 4), Math.cos(k * Math.PI / 4)]);
    dirs.sort((a, b) => (b[0] * -ux + b[1] * -uz) - (a[0] * -ux + a[1] * -uz));   // 背敌向优先
    let best = null, bs = 1e9;
    for (const [dx, dz] of dirs) {
      for (let d = 3; d <= 24; d += 2) {
        const x = t.x + dx * d, z = t.z + dz * d;
        if (world.terrain.gradAt(x, z) > NAV_G) break;         // 这方向撞陡壁, 弃向
        if (world.terrain.gradAt(x, z) > NAV_G * 0.75) continue;     // 唇沿陡坡: 爬得进停不稳
        if (!this._gridHidden(x, z, ref, world)) continue;
        const pk = this._peekMarch(x, z, ux, uz, ref, minPD, march, world, true);
        if (!pk) continue;
        const trip = U.dist2d(x, z, pk.x, pk.z);
        if (trip > tripMax) continue;                          // 往返装不进装填窗
        const sc = d + trip;                                   // 少跑路: 到藏格 + 藏↔探
        if (sc < bs) { bs = sc; best = { hide: { x, z }, peek: pk, face: Math.atan2(ref.x - x, ref.z - z), cov: null }; }
        break;                                                 // 该向最近藏格已比出, 深处不再扫
      }
    }
    return best;
  }

  /* ---------- 战术路由(G9): 局面→打法 的优先级仲裁层 ----------
     800 战力玩家不是把所有技巧并联挂着, 而是按局面排优先级: 打不穿先找角度 / 够不着先上坡 /
     敌蹲掩体先绕后 / 换弹先藏 / 上膛先打 / 没得打才摆角/推进/机动。路由器每拍(recheckS)按
     下表评估, 第一命中即本拍战术, 驾驶权随战术分配 —— 各行为模块照旧管实现细节, 不再靠
     代码书写顺序隐式仲裁(旧结构里伸缩/摆角/换位谁赢全靠 else-if 次序的巧合)。
     优先级表(自上而下, 第一命中生效):
       gateFlank   打不穿正面(穿深门) —— 不解决射界其他都是白搭
       hillAssault 窗口被地形挡+敌居高(≥hill.minAdv m) —— 只退后拉距离是送主动权, 该协同上坡
       coverFlank  窗口被掩体挡持续 coverFlank.afterS —— 绕掩体缘掏侧后
       peekBoom    装填中+藏点可用 —— 倒车藏/探出打
       standFight  上膛+窗口开 —— 停车即射(火权优先)
       angle       静止装填无藏点 —— 摆角卖甲
       advance     带外 —— 前压推进
       holdBand    带内站位
       skirmish    换位脉冲(默认)
     信号源全是既有状态(穿深门 gated/_winState.blk 遮挡类型/装填相位/_coverSpotOK), 零新扫描;
     高地判据的两处 heightAt 每 0.3s 一拍, 忽略不计。on=0 或 skill.level<0.6 整层旁路
     (this._tactic 恒 'legacy', 各模块走原条件, 行为与旧版一致)。 */
  _tacticRoute(world, ref, distP, dt, lo, hi, gated) {
    this._tacT -= dt;
    if (this._tacT > 0) return;
    const TC = SF.CFG.ai.tactics || { recheckS: 0.3, hill: { minAdv: 3 }, coverFlank: { afterS: 2.5 } };
    this._tacT = TC.recheckS;
    const t = this.tank, W = this._winState;
    const reloadMid = t.reloadT > 0;
    let tac = 'skirmish';
    if (gated && this.seenNow) tac = 'gateFlank';   // 穿深门在身: 换侧向优先于一切走位
    else if (W.blk === 1 && ref
             && world.terrain.heightAt(ref.x, ref.z) - world.terrain.heightAt(t.x, t.z) >= (TC.hill ? TC.hill.minAdv : 3))
      tac = 'hillAssault';                          // 地形挡+敌居高: 高地局(⑦)
    else if (W.blk === 2 && W.since !== null && world.time - W.since > (TC.coverFlank ? TC.coverFlank.afterS : 2.5))
      tac = 'coverFlank';                           // 掩体挡窗持续: 绕后局(④)
    else if (reloadMid && this._coverSpotOK) tac = 'peekBoom';     // 换弹有藏点: 藏探(⑥)
    else if (t.reloadT <= 0 && W.open) tac = 'standFight';         // 上膛有窗: 火权优先
    else if (reloadMid) tac = 'angle';                              // 换弹没藏点: 摆角
    else if (distP > hi) tac = 'advance';                           // 带外: 前压(③⑤挂这)
    else if (this._station) tac = 'holdBand';
    this._tactic = tac;
    /* 高地强袭的授权与集结(G9-⑦): 战术命中 ≠ 可以爬 —— 单车爬坡=逐个送人头, 必须共享计划
       登记-集结-同拍转进(见 _hillSync); 二线角色(TD/SPG)不上山(山脊不是它们的战场)。
       战术离开高地局即弃授权(转进闩锁 _hillCommit 另管, 见战斗导航段)。 */
    if (tac === 'hillAssault') {
      if (this._role === 'second') this._hillAuth = false;
      else { this._hillSync(world, ref); this._hillT = world.time; }
    } else if (world.time - (this._hillT || -99) > ((TC.hill && TC.hill.authHoldS) || 2)) this._hillAuth = false;
    /* 集结授权迟滞(hill.authHoldS): 敌露头开窗会把战术拍甩到 standFight(路由 0.3s 一评), 旧版
       每拍清 _hillAuth → 集结权反复归零, 配合 shy 就是"钉在坡脚当固定靶"。现在离开高地局
       authHoldS 秒内不清权, 战术一回来即续(_hillCommit 闩锁只保转进后, 这里补集结期的抗闪摆) */
    /* 绕掩体掏侧后(G9-④): 敌蹲硬掩体只露头, 正面窗口持续打不开 —— 找到挡窗的那块掩体,
       沿缘侧绕(合围舷定侧: 多车天然分两侧对绕=钳形), 绕过缘即得侧/尾射界, blk 归 0 本战术
       自动退场。守位单位(hold)不绕: 掉锚去追掩体缘是 TD 送死, 它的"够不着"由换位脉冲兜。
       绕点 6s 重估一次(掩体不动, 防逐拍抖动); 挡窗掩体找不到(移动中的车体挡? 判定口径差)
       就弃 —— 宁可按原逻辑打, 不瞎绕 */
    if (tac === 'coverFlank' && !this.hold) {
      if (!this._cfPt || world.time - this._cfT > 6) {
        this._cfT = world.time;
        const cov = this._blockCov(world, ref);
        if (cov) {
          const side = this.flankSlot > Math.PI ? 1 : -1;
          const px = -(ref.z - cov.z), pz = (ref.x - cov.x), pl = Math.hypot(px, pz) || 1;
          this._cfPt = { x: cov.x + px / pl * (cov.r + 10) * side + (ref.x - cov.x) * 0.2,
                         z: cov.z + pz / pl * (cov.r + 10) * side + (ref.z - cov.z) * 0.2 };
        } else this._cfPt = null;
      }
    } else if (this._tactic !== 'coverFlank') this._cfPt = null;
  }

  /* 沿掩体链推进(G9-③)的下一跳: 前方硬掩体里挑"朝敌投影前进最多、横偏最少"的一块,
     落点=掩体背敌侧(与 G2 藏点同构: c - 敌向×(r+3)) —— 到位即断敌视线, 装填期 G2 无缝
     接力伸缩。纯几何(无射线/无点阵), 0.5s 一拍摊薄; 跳点到达(<6m)即弃(下一跳或直线)。 */
  _chainHop(world, ref, distP, dt) {
    const CH = (SF.CFG.ai.tactics || {}).coverChain;
    if (!CH || !CH.on) return null;
    this._chainT = (this._chainT || 0) - dt;
    if (this._chainPt && this._chainT > 0) {
      if (SF.Util.dist2d(this.tank.x, this.tank.z, this._chainPt.x, this._chainPt.z) > 6) return this._chainPt;
      this._chainPt = null;   // 到达: 本跳完成, 直线段/下一跳由调用方重算
    }
    if (this._chainT > 0) return null;
    this._chainT = 0.5;
    const t = this.tank, U = SF.Util;
    const ux = (ref.x - t.x) / Math.max(distP, 1), uz = (ref.z - t.z) / Math.max(distP, 1);
    let best = null, bs = -1e9;
    for (const c of world.covers.list) {
      if (!c.blocksShells) continue;
      const cx = c.x - t.x, cz = c.z - t.z, cd = Math.hypot(cx, cz);
      if (cd < 8 || cd > (CH.hopMax || 45)) continue;          // 贴脚的没意义 / 太远跑不到
      const s = cx * ux + cz * uz;                             // 朝敌投影(前进量)
      if (s < (CH.stepMin || 12)) continue;                    // 不构成前进的一跳不配改变路线
      const perp = Math.abs(cx * uz - cz * ux);                // 横向偏距
      if (perp > 18) continue;                                 // 绕太远不算"沿路推进"
      if (s > distP - 8) continue;                             // 越过敌身
      const hx = c.x - ux * (c.r + 3), hz = c.z - uz * (c.r + 3);
      if (world.terrain.gradAt(hx, hz) > NAV_G) continue;      // 背敌侧站不住(陡壁/壕)
      const sc = s - perp * 0.5;                               // 前进多优先, 横偏少绕
      if (sc > bs) { bs = sc; best = { x: hx, z: hz }; }
    }
    this._chainPt = best;
    return best;
  }

  /* 挡窗掩体定位(G9-④): 沿我→敌连线 4m 步进采样, 首个圈住采样点的 blocksShells 掩体即凶手
     (窗口射线 _winRayClear 判 blk=2 的元凶)。只在绕点重估时跑(6s 一遇), 非逐帧开销 */
  _blockCov(world, ref) {
    const t = this.tank;
    const dx = ref.x - t.x, dz = ref.z - t.z, len = Math.hypot(dx, dz);
    if (len < 4) return null;
    const steps = Math.ceil(len / 4);
    for (let i = 1; i < steps; i++) {
      const f = i / steps, mx = t.x + dx * f, mz = t.z + dz * f;
      for (const c of world.covers.list) {
        if (!c.blocksShells) continue;
        if (Math.hypot(mx - c.x, mz - c.z) < c.r + 2) return c;
      }
    }
    return null;
  }

  /* 高地强袭共享计划(G9-⑦): 与 teamMemo 同款 world 级缓存 —— 同线程全队共读一份(主线程/
     Worker 各自世界各自算; Worker 复制品世界的威胁几何与主世界一致, 计划亦一致)。
     登记制: 首个发现者建计划(威胁位+goT=建立时刻+rallyS), 各车每拍登记(键=keyOf),
     惰性清退 >1.5s 未登记者; 存活登记数 ≥hill.minN 才授权强袭。goT 建计划时钉死不滑动
     —— 集结窗是"到点一起上"的约定时刻, 后来者赶不上就等下一计划(planS 过期重建)。 */
  _hillSync(world, ref) {
    const TC = SF.CFG.ai.tactics, now = world.time, U = SF.Util;
    let P = world._hillPlan;
    if (!P || now - P.t > TC.hill.planS || now > P.goT + 12
        || U.dist2d(P.x, P.z, ref.x, ref.z) > 50) {
      P = world._hillPlan = { t: now, x: ref.x, z: ref.z, goT: now + TC.hill.rallyS, reg: {} };
    } else P.t = now;   // 仍在窗内: 只续命不改 goT(集结时刻不滑动)
    P.reg[keyOf(this.tank, world)] = now;
    let n = 0;
    for (const k of Object.keys(P.reg)) {
      if (now - P.reg[k] > 1.5) { delete P.reg[k]; continue; }
      const m = this._memo && this._memo.byK && this._memo.byK[k];
      if (!this._memo || !m || m.alive) n++;
    }
    this._hillAuth = n >= (TC.hill.minN || 2);
    this._hillGoT = P.goT;
  }

  /* ---------- 掩体伸缩循环(G2): 相位机 ----------
     none→hide: 摆角相(1-hideFrac, 按车类)用完且剩余装填装得下"回藏+探出"才进;
     hide→peek: 装填余量≤探出提前量(_peekLead)时换相 —— 宁早到等装填;
     peek→hide: 开火即回藏(装填重启=reloadT 回满, 打完回藏点, 藏点即新锚);
     出口: 相位硬上限(藏相窗×1.2)/敌残血(能收的人头不藏)/弹夹车/倒车解困(倒不动 1.5s 弃
     藏点直接探; navigate 的卡死检测只认 throttle>0.4, 对倒车帮不上)。藏相遮断每
     hideCheckS 复验: 敌绕到掩体侧面/藏点不再挡 → 弃点重找。节流: 入口判定 0.25s 一拍。 */
  _coverStep(world, ref, distP, dt, lo, enemyLow) {
    const CV = SF.CFG.ai.cover, t = this.tank, R = t.spec.gun.reload;
    /* 粘滞参照的择主: 在"距最近敌 1.25×内"的候选里选 |速度| 最小者(平手取近) —— 环行敌的
       方位持续漂移, 它今天在这明天在那, 对它的藏点阴影一会儿就转失效(循环拆链); 蹲点敌
       (静止/慢速)方位恒定, 背它的掩体阴影永久有效(S4 cromwell 对静止机器人 84% 藏相覆盖
       的根源)。车速度是既有快照字段, 零新增开销 */
    if (ref && ref.alive) {
      const pool = (world.mpTargets && world.mpTargets.length ? world.mpTargets : [world.player])
        .filter(e => e && e.alive && SF.Util.dist2d(t.x, t.z, e.x, e.z) < distP * 1.45);
      if (pool.length) {
        pool.sort((a, b) => (Math.abs(a.speed || 0) - Math.abs(b.speed || 0))
          || (SF.Util.dist2d(t.x, t.z, a.x, a.z) - SF.Util.dist2d(t.x, t.z, b.x, b.z)));
        const want = pool[0];
        if (!this._coverRef || !this._coverRef.alive
            || (this._coverRef !== want
                && SF.Util.dist2d(t.x, t.z, want.x, want.z) < SF.Util.dist2d(t.x, t.z, this._coverRef.x, this._coverRef.z) * 0.7))
          this._coverRef = want;
      }
    } else this._coverRef = null;
    const cref = this._coverRef || ref;   // 粘滞参照(藏点验收/驾驶用); 无活参照(记忆点)时退回传入 ref
    // 藏↔探行程预算: 探出腿是前进档(≈0.6×极速, 见 lead 公式), 旧 3.2 倒车折中把行程卡死
    // 一半 —— 开火门全走窗口后探位要探出掩体角 2~4m 才打得着, 行程随之变长, 旧预算把这些
    // 真探位全拒了(实测 S4 覆盖 50.6→2); 下限 4m 保住贴棱微伸缩
    const tripMax = Math.max(4, (R - 1.05) * Math.max(4, (t.spec.maxSpeed || 8) * 0.6));
    // 首次进场行程预算(藏点离当前位可远 —— 赶站/出生锚定用): 行进中豁免相位窗(见下),
    // 只要 1.5 个装填窗内跑得到即可; 有炮塔车赶路用前进档(0.6×极速), 无炮塔只能倒车
    const vT = (t.spec.maxSpeed || 8) * (t.parts.noTurret ? 0.42 : 0.6);
    const appMax = Math.max(tripMax, R * 1.5 * vT);
    if (this._coverPhase !== 'none') {
      const cap = (this._coverPhase === 'hide' ? R * this._hideFrac * 1.2 : (this._peekLead || 2) * 1.2 + 1);
      const al = t.spec.gun.autoloader || null;
      // 行进中豁免相位窗 ×2.5+4s: 藏点在 20~40m 外时赶路本身就吃掉整个藏相窗, 按窗硬切
      // 会把每次进场切成"走一半退相"的永久空转(实测 noSpot→进场→cap 切退循环); 赶到点
      // 或卡死(|speed|<0.4, 躲不了 _hideStuckT/_revStuckT 解困)后恢复常规窗
      const enRoute = this._coverPhase === 'hide' && this._coverPt
        && SF.Util.dist2d(t.x, t.z, this._coverPt.x, this._coverPt.z) > 4 && Math.abs(t.speed) > 0.4;
      if (!ref || enemyLow || al || world.time - this._coverEnterT > cap * (enRoute ? 2.5 : 1) + (enRoute ? 4 : 0)) {
        this._coverPhase = 'none'; this._coverPt = null; this._coverPeek = null;
        return;
      }
      if (this._coverPhase === 'hide') {
        if (this._revStuckT > 1.5) { this._coverPhase = 'peek'; this._coverEnterT = world.time; this._revStuckT = 0; return; }
        // 换相时机按"当前位→探点"实际行程取 max(藏↔探提前量), 前进档车速 —— 用倒车折中
        // 车速会把换相提前 2~3 倍, 探点上裸奔等装填(coverUse 与 fireLatency 双输, 实测 S2
        // peek 相占了装填采样 59% 而藏相只有 12%)
        const tpk = this._coverPeek ? SF.Util.dist2d(t.x, t.z, this._coverPeek.x, this._coverPeek.z) : 0;
        const vP2 = Math.max(4, (t.spec.maxSpeed || 8) * 0.6);
        // +1.2s 裕量(G5 遗留修复): 赶探点的移动扩圈(disp 2.0)静止收敛要 ~1.2-1.6s, 0.6s 裕量
        // 让"到点即上膛"——ready 时钟在移动扩圈上空转(实测 S4 cromwell 0.9s/S5 tiger 1.65s
        // 迟滞样本); 提前换相, 到点后圈在等待窗里掉完, 上膛即射
        if (t.reloadT <= Math.max(this._peekLead, tpk / vP2 + 0.6)) { this._coverPhase = 'peek'; this._coverEnterT = world.time; return; }
        // 遮断复验(到点后才有意义, 点阵口径——与藏点验收同源, 眼高口径会把半藏当藏住):
        // 敌绕到掩体侧/棱线漂移 → 弃点重找(追着阴影挪, 机器人环绕时贴着掩体缘转)
        if (t.reloadT > 0 && world.time - this._hideChkT > CV.hideCheckS && SF.Util.dist2d(t.x, t.z, this._coverPt.x, this._coverPt.z) < 3) {
          this._hideChkT = world.time;
          if (!this._gridHidden(t.x, t.z, cref, world, t.yaw)) {
            const s = this._findCoverSpot(world, cref, distP, lo, tripMax);
            if (s) { this._coverPt = s.hide; this._coverPeek = s.peek; this._peekLead = s.lead; this._coverFace = s.face; this._coverCov = s.cov; }
            else { this._coverPhase = 'peek'; this._coverEnterT = world.time; }
          }
        }
      } else if (t.reloadT > R * 0.8) {   // 探出后已开火(装填回满) → 打完回藏
        // 锚点稳定: 旧藏/探点还验得过(藏=入位姿态点阵全藏, 探=打得着)就直接复用 —— 每次都
        // 重搜的话扇扫起点=当前位, 藏/探点逐拍搬家, 车在场子里打转不进位(S3 实测 hover 在
        // 藏点 3~5m 外 75 采样零覆盖); 失效(敌绕侧/点漂)才重找=追阴影挪
        let s = null;
        if (this._coverPt && this._coverPeek && this._coverFace !== undefined
            && this._gridHidden(this._coverPt.x, this._coverPt.z, cref, world, this._coverFace)
            && !this._gridHidden(this._coverPeek.x, this._coverPeek.z, cref, world))
          s = { hide: this._coverPt, peek: this._coverPeek, lead: this._peekLead };
        if (!s) {
          s = this._findCoverSpot(world, cref, distP, lo, tripMax);
          if (s) { this._coverFace = s.face; }   // 找点函数写入入位姿态
        }
        // 离站位远: 弃循环先归位(顶线 HT 例外, 见入口注)——站位已带掩体亲和, 归位后照样有
        // 藏点可循环; 赖在顺路掩体上实测让 MT/TD 全程脱岗(翼侧/纵深判据 0% 及格)
        if (!s || (this._station && this._role !== 'line' && SF.Util.dist2d(t.x, t.z, this._station.x, this._station.z) > 25)
            || SF.Util.dist2d(t.x, t.z, s.hide.x, s.hide.z) > appMax) {
          this._coverPhase = 'none'; this._coverPt = null; this._coverPeek = null;
        } else { this._coverPt = s.hide; this._coverPeek = s.peek; this._peekLead = s.lead; this._coverCov = s.cov; this._coverPhase = 'hide'; this._coverEnterT = world.time; this._revStuckT = 0; this._hideChkT = -9; this._hideCov = false; }
      }
      return;
    }
    this._coverT -= dt;
    if (this._coverT > 0 || t.reloadT <= 0 || !ref) return;
    this._coverT = 0.25;
    const al = t.spec.gun.autoloader || null;
    this._hideFrac = (CV.hideFracCls || {})[t.spec.cls] || 0.6;
    this._coverSpotOK = false;   // 本拍没有可用藏点(下面找到才置真)——摆角分时窗的"有藏点"判据
    if (al || enemyLow || R < 2.2 || distP < lo * CV.minDistFrac) return;
    // 有炮塔车恢复入循环(G9 路由联动): 旧标定把它们整类关掉(贴角探位难开窗+循环吃摆角窗),
    // 等于 HT/MT 永不找掩体 —— 用户实测"对战不会找掩体"的主因。入口只开一道门: 窗口关着
    // (敌藏起/我够不着, 藏了也不损失火权, 藏是纯免费收益)才进。自由进(撤门)实测基准大崩:
    // sideExp 25/摆角 24 —— 机器人常驻可见窗口常开, 循环与摆角/带纪律三方互踩, 旧标定在
    // "敌常开窗"语境下是对的; 而实战玩家会藏会探头, 窗口关着的拍正是该藏的拍。TD 照旧
    // 不受此门(炮随车体, 摆角零机会成本); 路由旁路(legacy/低难度)时保持旧口径。
    if (!t.parts.noTurret && (this._tactic === 'legacy' || this._winState.open)) return;
    // 离自己的角色站位还远不进循环: 先归位再伸缩 —— 二线(TD/SPG)会跟出生点旁的掩体锁死,
    // 蹲在距敌 54m 处打伸缩, 二线纵深(42m+ 判据)永远出不来。例外: 藏点就在脚边(≤20m,
    // 顺路掩体)照进 —— 赶站途中贴手掩体装填伸缩不算离岗(S5 走廊 pz4 距站位 60m+, 但墙
    // 就在 2m 处, 全程不伸缩 coverUse 白丢)。顶线 HT 例外: 本就该顶着火力打, 归位途中
    // 借掩体装填伸缩是本分, 不藏才是站桩挨打
    const s0 = this._findCoverSpot(world, cref, distP, lo, tripMax);
    if (!s0) return;                     // 无可用藏点: _coverSpotOK 保持 false → 摆角全窗(G5③)
    this._coverSpotOK = true;            // 有可用藏点 → 摆角只摆顶部时片, 剩余让给藏相入位
    // 有炮塔车只收贴手藏点(≤20m): 打完缩两步的贴角掩体, 不为藏跑远路 —— 远藏位的转场段
    // 全程裸奔(遮蔽采样掉 + 挨打), 得不偿失; TD 照旧可跑 appMax(藏打纵深是它们的主战法)
    if (!t.parts.noTurret && SF.Util.dist2d(t.x, t.z, s0.hide.x, s0.hide.z) > 20) return;
    if (this._station && this._role !== 'line' && SF.Util.dist2d(t.x, t.z, this._station.x, this._station.z) > 25) return;
    if (SF.Util.dist2d(t.x, t.z, s0.hide.x, s0.hide.z) > appMax) return;   // 赶不到的藏点不进(防空转)
    const s = s0;
    // 摆角相(1-hideFrac 按车类)给多少: 取"类别份额"与"给循环留出可行窗"的较小者 —— 本地几何
    // (S2 ruin 往返≈12m/peekLead≈4.3s vs TD 藏相份额 3.78s)下纯份额会把入口窗算成空集,
    // 分时降级为"物理允许才摆角": 血厚车仍有先摆后藏的次序, 脆皮车打完即藏
    const angleShare = Math.min((1 - this._hideFrac) * R, Math.max(0, R - s.lead - 1.2));
    if (t.reloadT <= R - angleShare && t.reloadT > s.lead + 0.3) {   // 摆角相用完 且 行程可行: 进藏相
      this._coverPt = s.hide; this._coverPeek = s.peek; this._peekLead = s.lead; this._coverFace = s.face; this._coverCov = s.cov;
      this._coverPhase = 'hide'; this._coverEnterT = world.time; this._revStuckT = 0; this._hideChkT = -9; this._hideCov = false;
    }
  }

  /* ---------- 藏相驾驶: 车尾朝敌倒车入位(炮口全程对敌, 探出即射) ----------
     倒车朝向=藏点方位+π(藏点在背敌侧, 与"车尾朝敌"天然一致); 偏差超 60° 先原地转正
     再倒(斜着倒会甩屁股)。到点判定=遮蔽达成(losClear 被挡, 0.2s 节流)或贴近 1.2m 兜底:
     棱线循环藏/探只隔 1-1.5m, 纯距离容差会把车停在挡线北侧一两米——循环在跑但全程可见。
     倒不动 1.5s(卡掩体/顶坡)记 _revStuckT 交相位机弃点 */
  _hideDrive(px, pz, dt, world, ref) {
    const t = this.tank, d = SF.Util.dist2d(t.x, t.z, px, pz);
    if (d < 5 && world.time - this._hideChkT > SF.CFG.ai.cover.hideCheckS) {
      this._hideChkT = world.time;
      this._hideCov = this._gridHidden(t.x, t.z, ref, world, t.yaw);   // 到点=点阵全藏(按实际车头, 与
      //   藏点验收同源)——眼高口径会把缓坡半盲带当"已藏住"(S3 实测停短 5m, coverUse 记 0)
    }
    if (d < 1.2 || this._hideCov) { this.input.throttle = 0; this.input.steer = 0; return true; }
    const want = Math.atan2(px - t.x, pz - t.z) + Math.PI;   // 倒车期望车头向
    const aErr = SF.Util.angDiff(t.yaw, want);
    if (Math.abs(aErr) >= Math.PI / 3) { this.input.throttle = 0; this.input.steer = SF.Util.clamp(aErr * 2.5, -1, 1); }
    else {
      this.input.throttle = -1;
      this.input.steer = SF.Util.clamp(aErr * 2.5, -1, 1);
      if (Math.abs(t.speed) < 0.3) this._revStuckT += dt; else this._revStuckT = 0;
    }
    return false;
  }

  /* ---------- 评分制换位: 穿深门(打不穿正面)专用找侧向 ----------
     候选点: 以合围扇区为中心 6 向采样, 距离压在性格带内(守位单位取 28m, 落在 home 30m 钳内);
     评分: "敌鼻向与(敌→候选)夹角>SIDE_ARC = 从该点打得到敌侧甲" ×2 主权重, 再减带心偏离与路程。
     故意不走 flankChance 门控 —— sniper 的 flankChance=0, 穿深门若被它门控就永远站桩挨打;
     只在换位触发时算一次(每车几秒一遇), 非逐帧开销 */
  _reposPt(world, ref, distP) {
    const U = SF.Util, t = this.tank, [lo, hi] = this.bandFor();
    const rMax = this.hold ? 28 : Math.min(Math.max(distP, (lo + hi) * 0.5), hi);
    let best = null, bs = -1e9;
    for (let i = 0; i < 6; i++) {
      const a = this.flankSlot + (i - 2.5) * 0.8;
      const cx = U.clamp(t.x + Math.sin(a) * rMax, -430, 430), cz = U.clamp(t.z + Math.cos(a) * rMax, -430, 430);
      if (world.terrain.gradAt(cx, cz) > NAV_G) continue;   // 候选落在陡壁/壕里是白跑, 直接弃
      const crel = Math.abs(U.angDiff(ref.yaw || 0, Math.atan2(cx - ref.x, cz - ref.z)));   // 敌鼻向 vs 敌→候选
      let s = (crel > SIDE_ARC ? 20 : 0)                    // 侧向射界 ×2 权重(×10 量级拉开主次)
        - Math.abs(Math.hypot(cx - ref.x, cz - ref.z) - (lo + hi) * 0.5) / 30   // 留在交战带内
        - Math.hypot(cx - t.x, cz - t.z) / 60;              // 少跑路
      if (s > bs) { bs = s; best = { x: cx, z: cz }; }
    }
    return best || { x: t.x, z: t.z };
  }

  /* ---------- 主逻辑 ---------- */
  update(dt, world) {
    const U = SF.Util, t = this.tank, player = nearestTarget(world, this.tank), P = this.p;
    const WP = SF.CFG.ai.weakpoint, TRADE = SF.CFG.ai.trade, FD = this._fd;
    if (!t.alive) return;
    this.input.fire = false;
    this._gateTrack = false;   // 履带次选豁免态只在战斗导航段重估(撤退/警戒中不带旧态还击)

    this.perceptT -= dt;
    if (this.perceptT <= 0) { this.perceptT = SF.CFG.ai.perceptionInterval; this.perceive(world); }
    if (this.reactT > 0) this.reactT -= dt;

    // 导航参考点: 看得见用真实位置, 看不见用最后已知位置(不偷读玩家坐标)。
    // 导航参考取"纯最近"(非焦点)——G4⑥ 集火只改炮口不改驾驶的推广: 锁定焦点目标的车若把
    // 驾驶也挂在焦点上, 焦点是机动目标时全队跟着追着屁股跑(站位/带/藏点几何全在晃, 实测
    // 输出掉 40% 挨打翻倍); 车体对物理最近之敌保持站位, 炮口打被呼叫的目标
    const playerNav = nearestPlain(world, this.tank);
    const ref = (this.seenNow && playerNav && playerNav.alive) ? playerNav : (this.lastSeen || playerNav);
    const distP = ref ? SF.Util.dist2d(t.x, t.z, ref.x, ref.z) : 1e9;
    const toPlayerYaw = ref ? Math.atan2(ref.x - t.x, ref.z - t.z) : t.yaw;

    /* --- 角色分工(G3): 全队共读 teamMemo(存活签名/0.8s 节流重算), 帧内缓存本车角色/站位/带 ---
       站位/排位修正挂难度闸 level≥0.6(低难度无协同); 带插值按既有闸 level≥0.4(bandFor 注释) */
    const RO = SF.CFG.ai.role;
    this._memo = (RO.on && this._gGate) ? teamMemo(world) : null;
    this._role = this._memo ? (this._memo.roles[keyOf(t, world)] || 'flank') : null;
    /* 站位闩锁: 威胁参考随敌机动每 0.8s 漂移, 站点跟着抖会变"永动追逐"(圈炸开→开火迟滞)。
       新站点离已闩站点 <25m 不换(角色变了强制换) —— 站住才谈得上缩圈/摆角/伸缩接力 */
    const stNew = (this._memo && this._memo.stations[keyOf(t, world)]) || null;
    /* 站位闩锁(吸到失效为止): 威胁参考在环行敌/静止敌间漂移会让站点每 0.8s 重算±跳 95m,
       车追着跑(不停原地转向掉速到 2~6m/s)整场到不了位, 翼侧/纵深判据 0% 及格 —— 旧站只要
       ①角色没变 ②对当前威胁还打得着(losClear) ③新站没远到换防(>60m 才算真换站), 就钉住 */
    const latchOk = this._stLatch && this._stLatch.role === this._role
      && (!this._memo || !this._memo.threat
          || SF.losClear(world, this._stLatch.x, this._stLatch.z, this._memo.threat.x, this._memo.threat.z))
      && (!stNew || SF.Util.dist2d(stNew.x, stNew.z, this._stLatch.x, this._stLatch.z) < 60);
    if (latchOk) this._station = this._stLatch;
    else { this._station = stNew; this._stLatch = stNew ? { x: stNew.x, z: stNew.z, role: this._role } : null; }
    if (this._gWeak && RO.on) {   // 带插值(G3 展开): [lo,hi]=lerp(性格带,车型带,bandMix), 二线 lo×1.1; role.on=0 整模块退回性格带
      const CB = SF.CFG.ai.classBand[t.spec.cls || 'MT'] || this.p.band;
      const k = (RO && this._role) ? RO.bandMix : 0.5;
      let bLo = SF.Util.lerp(this.p.band[0], CB[0], k), bHi = SF.Util.lerp(this.p.band[1], CB[1], k);
      if (this._role === 'second' || this._role === 'fallback') bLo *= 1.1;
      this._band = [bLo, bHi];
    } else this._band = null;

    /* --- 弱点选暴露面输入: rel = 敌车鼻向与(敌→我)方位的夹角 --- */
    // 参考方向取"敌→我"(= toPlayerYaw + π)而不是字面的 toPlayerYaw: 正对=敌鼻指着我=两向重合 → rel≈0,
    // 与「正对<frontDeg 打首下 / 背对>sideDeg 打车尾」的阈值语义一致(车尾命中才有 rearChance 毁发动机, 方向不能反)
    let rel = 0;   // 默认 0=正对: 拿不到敌 yaw 时按首下打(最稳的弱点)
    if (player && player.alive)
      rel = Math.abs(U.angDiff(player.yaw, toPlayerYaw + Math.PI));

    /* --- 换血判断(trade.on): 血账记忆 + 残血压制/劣势转保守/以大欺小强推 --- */
    let enemyLow = false, shy = false, strong = false;
    if (TRADE.on && this._gGate && player && player.alive) {   // 难度闸: level≥0.6 才启用
      const pid = player.netId || 0;
      const memo = this.hpMemo[pid] || (this.hpMemo[pid] = { hp: player.hp, max: player.hp });
      memo.hp = player.hp;
      if (player.hp > memo.max) memo.max = player.hp;   // 见过更高血即抬上限(满血路过一次就记住了)
      enemyLow = player.hp <= t.spec.gun.dmg * TRADE.killMult;   // ≤我1-2发可收 → 值得换血
      /* 以大欺小(trade.bullyMargin): 换血收益不再只看血量% —— 装甲/穿深/射速/人数三账同算,
         综合占优 → strong(带内压上换血 + 压制 shy)。旧版两台中坚打一台轻坦也只会蹲带内站桩,
         因为"装甲更硬/射速不慢/人多"没有一项进得了账。三账粗估(够判强弱, 不追求精确):
         ①装甲账: 我pen/敌类等效甲 vs 敌pen/我类等效甲(穿深门同表 clsArmor, 双向比值)
         ②射速账: 单发/装填 的 DPM 比 ③人数账: 我方存活 AI vs 敌方存活人类(mpTargets, sp=1)
         判优 = 装甲或射速任一维 ≥margin 且无任何一维亏过 1/margin(人数只要求不劣势) */
      const myCls = t.spec.cls || 'MT', foeCls = player.cls || (player.spec && player.spec.cls) || 'MT';
      const CA = SF.CFG.ai.clsArmor || {}, gFoe = (player.spec && player.spec.gun) || {};
      const penMine = (t.spec.gun.pen || 0) / Math.max(CA[foeCls] || 95, 1);
      const penFoe = (gFoe.pen || 0) / Math.max(CA[myCls] || 95, 1);
      const dpmMine = (t.spec.gun.dmg || 0) / Math.max(t.spec.gun.reload || 1, 0.1);
      const dpmFoe = (gFoe.dmg || 0) / Math.max(gFoe.reload || 1, 0.1);
      let myN = 0; for (const e of world.enemies) if (e.alive && e.ai) myN++;
      let foeN = 1;
      if (world.mpTargets && world.mpTargets.length) { foeN = 0; for (const h of world.mpTargets) if (h && h.alive) foeN++; }
      else if (world.player && !world.player.alive) foeN = 0;
      const mg = TRADE.bullyMargin || 1.08;
      const rArm = penMine / Math.max(penFoe, 1e-3), rDpm = dpmMine / Math.max(dpmFoe, 1e-3), rCnt = myN / Math.max(foeN, 1);
      /* 判优: 装甲账与人数账是硬否决(打得穿我才欺负得动 / 人不能少); DPM 小亏可被装甲与人数
         的净值抵掉 —— 轻坦纸面 DPM 常更高, 但打不穿我的 DPM 是无效 DPM(综合分按乘积)。
         例: pz4×2 vs bt7: rArm=3.3 rDpm=0.92 rCnt=2 → 综合 6.1 ≥ bullyScore → 强推 ✓;
             pz4 vs tiger1: rArm=0.43(打不穿) → 否决 → 不推 ✓ */
      strong = !enemyLow && rCnt >= 1 / mg && rArm >= 1 / mg
        && (rDpm >= mg || rArm * rDpm * rCnt >= (TRADE.bullyScore || 1.6));
      // 劣势换血转保守: 我方血量% 明显低于敌(敌%按血账 max 估计) → 缩着打。
      // 两道豁免: strong(优势不缩) / shyMaxS 止损(连缩 N 秒血量未崩到撤退线 = 藏相没保住血,
      // 继续缩只是慢性死, 恢复正常打法 —— 防蹲坑螺旋: 越挨打越缩→越像固定靶→挨更多打)
      shy = !enemyLow && !strong && t.hp / t.spec.hp < (memo.hp / Math.max(memo.max, 1)) * TRADE.shyRatio;
      if (shy) {
        if (!this._shySince) this._shySince = world.time;
        if (world.time - this._shySince > (TRADE.shyMaxS || 12) && t.hp / t.spec.hp > P.retreatHp + 0.1) shy = false;
      } else this._shySince = 0;
    }
    this._shy = shy; this._strong = strong;   // 帧内缓存: _coverStep 的有炮塔车劣势藏点门读 _shy; _strong 备查

    /* --- 状态转移 --- */
    if (this.seenNow && this.state !== 'retreat') {
      // 本守卫在 combat 中逐帧为真(原逻辑原地重入无害), 换位配额重置必须只在真正转入 combat 时做一次
      if (this.state !== 'combat') {
        this._gateTries = 0; this._gatePt = null;   // 新回合: 穿深门换位配额重置(上限 2 次/回合)
        this._angSide = this.flankSlot > Math.PI ? 1 : -1;   // 摆边: 合围扇区奇偶定, 整回合保持(onHurt 不翻边)
        this._coverPhase = 'none'; this._coverPt = null; this._coverPeek = null;   // 藏/探相不跨回合(参照已换, 藏点重找)
        this._hillCommit = false;   // 高地转进不跨回合(上回合的坡这回合未必还是高地局)
      }
      this.state = 'combat'; this._alertT = 0;
      // 敌残血: 压制 retreatHp 撤退门 —— 能收的人头不缩, 换血抢死
      if (t.hp / t.spec.hp < P.retreatHp && this.retreatT <= 0 && !enemyLow) { this.state = 'retreat'; this.retreatT = 8; }
    } else if (this.state === 'combat' && !this.seenNow) {
      // 藏相装填期对记忆超时的抑制: 循环中目标短暂不可见是循环本义(自己藏起来了), 不按"丢了"处理;
      // 循环自身有相位硬上限兜底, 不会赖在藏相不走。出相后再给 suppressMemoryTimeout 秒宽限收尾
      const memExt = this._coverPhase !== 'none'
        ? (t.reloadT > 0 ? 1e9 : SF.CFG.ai.cover.suppressMemoryTimeout) : 0;
      if (!this.lastSeen || world.time - this.lastSeen.t > SF.CFG.ai.memoryTime + memExt) this.state = 'alert';
    } else if (this.state === 'patrol' && this.heard) {
      this.state = 'alert';
    }
    if (this.state === 'retreat') {
      this.retreatT -= dt;
      if (this.retreatT <= 0) this.state = 'combat';
    }

    /* --- 各状态行为 --- */
    let aimAt = null, faceYaw = null;
    this._preAimYaw = null;   // 预瞄方位逐帧重置(各状态分支按情报新鲜度重写; null=navigate 不分档)
    this._advancing = false;  // 推进导航标记逐帧重置(仅突入直插/交战前压/围攻接近置位)
    if (this.state === 'patrol') {
      if (this.patrol.length) {
        const w = this.patrol[this.wp];
        this.navigate(w.x, w.z, dt, world);
        if (SF.Util.dist2d(t.x, t.z, w.x, w.z) < 5) this.wp = (this.wp + 1) % this.patrol.length;
      } else { this.input.throttle = 0; this.input.steer = 0; }
      // 巡逻时炮塔警戒朝向前方
      this.input.aimYaw = t.yaw; this.input.aimPitch = 0.02;
    }
    else if (this.state === 'alert') {
      if (!this._alertT) this._alertT = world.time;
      // 情报源: 取最新更新的(目视 lastSeen / 听见 heard / 全队 intel)
      const cands = [this.lastSeen, this.heard, world.intel.level > 0 ? world.intel : null].filter(Boolean);
      cands.sort((a, b) => b.t - a.t);
      const tgt = cands[0] || this.home;
      const intel = world.intel;
      const intelFresh = intel.level > 0 && world.time - intel.t < SF.CFG.ai.searchTime;
      const intelFresh2 = intel.level === 2 && world.time - intel.t < 8;   // 确认接触且情报新鲜
      const hurtRecent = this._hurtT && world.time - this._hurtT < 12;   // 刚挨打: 反应升级
      // 守位单位(蹲点歼击/守线重坦): 敌情未确认只原地警戒炮口指向;
      // 自己挨了打 / 全队确认接触且警戒数秒无果 → 离位加入围剿
      const holdHold = this.hold && !hurtRecent && !(intelFresh2 && world.time - this._alertT > 4);
      if (holdHold) {
        this.input.throttle = 0; this.input.steer = 0;
        this.input.aimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);
        this.input.aimPitch = 0.02;
      } else if (intelFresh2 && !this.hold) {
        /* --- 协同突入: 确认接触且情报新鲜 → 最近的先压上去掏人, 其余架枪支援后错峰跟进 ---
           不再傻等"看见"才动: 你躲进反斜面/掩体, 他们直接压到脸上把你掀出来 */
        let rank = 0, myD = SF.Util.dist2d(t.x, t.z, tgt.x, tgt.z);
        for (const o of world.enemies) {
          if (o === t || !o.alive || !o.ai || o.ai.state === 'combat') continue;
          const od = SF.Util.dist2d(o.x, o.z, tgt.x, tgt.z);
          if (od < myD || (od === myD && o.ai.flankSlot < this.flankSlot)) rank++;
        }
        // 角色排位修正(G3): TD 不抢首亮(+2, 二线等前排先探明火力), HT 先顶(−1)
        if (this._memo) rank += ((t.spec.cls === 'TD') ? RO.tdRankBias : (t.spec.cls === 'HT') ? RO.htRankBias : 0);
        if (this._intelT === undefined || intel.t > this._intelT + 0.5) {   // 情报刷新 → 重新排突入次序
          this._intelT = intel.t;
          this._pushAt = world.time + rank * 2.5;
        }
        if (world.time >= (this._pushAt || 0) || hurtRecent) {
          this._preAimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);   // 预瞄纪律(G8): 先定方位再导航, 压进途中炮口不离情报点
          this._advancing = true;
          // 同路集中(G9-⑤): 突入不各开一条路 —— 后车(rank>0)贴领车(全队距情报最近者)车辙纵队,
          // 全队从同一方向压到火线; 领车直插, 阵亡/掉队由每拍重找自动顺位顶上
          let pushPt = { x: tgt.x, z: tgt.z };
          if (rank > 0 && ((SF.CFG.ai.tactics || {}).lane || { on: 1 }).on) {
            let lead = null, ld = SF.Util.dist2d(t.x, t.z, tgt.x, tgt.z);
            for (const o of world.enemies) {
              if (o === t || !o.alive || o.ai === undefined) continue;
              const od = SF.Util.dist2d(o.x, o.z, tgt.x, tgt.z);
              if (od < ld) { ld = od; lead = o; }
            }
            if (lead) {
              const dl = Math.max(1, ld);
              pushPt = { x: lead.x - (tgt.x - lead.x) / dl * 18, z: lead.z - (tgt.z - lead.z) / dl * 18 };
            }
          }
          this.navigate(pushPt.x, pushPt.z, dt, world);                    // 直插情报点(后车纵队贴车辙)
          this.input.aimYaw = this._preAimYaw;                             // 边压边瞄
          this.input.aimPitch = 0.02;
        } else {
          // 等待突入次序: 压到自己的环位, 炮口始终瞄准情报点(支援架枪)。
          // 角色分工(G3): 有角色站位直接预占位(翼侧的先去翼侧, 二线的先蹲纵深), 没有才退回扇区环
          let bx, bz;
          if (this._station) { bx = this._station.x; bz = this._station.z; }
          else {
            const B0 = this.bandFor(), ringR = (B0[0] + B0[1]) * 0.5;   // 支援架枪环半径同源交战带(低难度恒原带)
            bx = tgt.x + Math.sin(this.flankSlot) * ringR; bz = tgt.z + Math.cos(this.flankSlot) * ringR;
          }
          if (SF.Util.dist2d(t.x, t.z, bx, bz) > 10) this.navigate(bx, bz, dt, world);
          else { this.input.throttle = 0; this.input.steer = 0; }
          this.input.aimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);
          this.input.aimPitch = 0.02;
        }
      } else {
        // 有方法的围攻: 各车从自己的合围扇区接近; 刚挨打的车压得更近(报复性追击)。
        // 角色分工(G3): 有站位走站位(与 combat 站位同源, 转战斗不换位), 没有才退回扇区环
        let bx, bz, ringR;
        if (this._station) { bx = this._station.x; bz = this._station.z; ringR = 90; }
        else {
          const B = this.bandFor(); ringR = hurtRecent ? B[0] * 0.7 : (B[0] + B[1]) * 0.5;
          bx = tgt.x + Math.sin(this.flankSlot) * ringR; bz = tgt.z + Math.cos(this.flankSlot) * ringR;
        }
        if (SF.Util.dist2d(t.x, t.z, bx, bz) > 12) {
          this.navigate(bx, bz, dt, world);   // 环位接近不挂预瞄: 环位在敌侧方, 航向横穿 60~90° 侧露带, 拖慢转向=漏屁股
        } else if (this._station) {
          this.input.throttle = 0; this.input.steer = 0;   // 角色站位者就位即守位(游走搜索会拖离站位)
        } else {
          // 包围圈就位仍未接触: 围绕情报点游走搜索(偏向内圈, 更敢掏)
          this._searchT -= dt;
          if (this._searchT <= 0 || !this._searchPt) {
            this._searchT = 3.5 + Math.random() * 3.5;
            const rr = Math.random() < 0.5 ? ringR * 0.55 : ringR;
            this._searchPt = { x: U.clamp(tgt.x + (Math.random() - .5) * 2 * rr, -430, 430),
                               z: U.clamp(tgt.z + (Math.random() - .5) * 2 * rr, -430, 430) };
          }
          this.navigate(this._searchPt.x, this._searchPt.z, dt, world);
        }
        // 炮口压向情报点而不是车头方向(边追边瞄): 搜剿游走中也保持预瞄, 敌露头即射
        this.input.aimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);
        this.input.aimPitch = 0.02;
        this._preAimYaw = this.input.aimYaw;   // 预瞄纪律(G8): 换位/游走途中炮口不离情报点
      }
      // 搜剿超时仍无果 → 回归巡逻(玩家一直开炮/命中则情报持续刷新, 搜剿不结束)
      if (!this.seenNow && !intelFresh && world.time - this._alertT > SF.CFG.ai.searchTime) {
        this._alertT = 0; this._searchT = 0; this._searchPt = null; this.heard = null; this._pushAt = null; this.state = 'patrol';
      }
    }
    else if (this.state === 'combat') {
      aimAt = this.lastSeen || { x: ref.x, z: ref.z, vx: 0, vz: 0 };
      // 预瞄方位(G8): 交战态全程(lastSeen 在忆即可, 不要求 seenNow)——前压/拉开/换位/绕侧/藏相
      // 倒车全程炮口压着敌向预测位, 与瞄准段同一提前量公式, 露头只剩反应窗+缩圈尾
      if (aimAt) {
        const fl = distP / t.spec.gun.speed;
        this._preAimYaw = Math.atan2(aimAt.x + (aimAt.vx || 0) * fl * P.leadSkill - t.x,
                                     aimAt.z + (aimAt.vz || 0) * fl * P.leadSkill - t.z);
      }
      const [lo, hi] = this.bandFor();   // 难度总闸: 带插值唯一接线点(低难度恒原带)
      this.repositionT -= dt;

      /* --- 穿深门(weakpoint.on): 我pen < 敌车类等效甲×0.95 = 正面打不穿, 永不站桩对轰 ---
         兑底链: ①立即评分制换位找侧向(_reposPt, 不吃 flankChance 门控——sniper 的 flankChance=0
         靠它必站桩等死; 不受 holdGround 限制, 仅守位单位仍受 home 30m 钳制) ②换位后仍无侧向射界
         → 再换位(上限 2 次/回合) ③2 次后仍无 → 履带次选(唯一稳定可穿部位, 断腿停车造机会),
         一发一换位循环。已在侧向射界(rel>SIDE_ARC)则正常打侧面, 不折腾 */
      const tgtCls = (player && player.cls) || (player && player.spec && player.spec.cls) || 'MT';
      const gated = WP.on && this._gGate && player && player.alive &&   // 难度闸: level≥0.6 才启用
        t.spec.gun.pen < (SF.CFG.ai.clsArmor[tgtCls] || 95) * 0.95;
      let gateNav = false;
      let navX = t.x, navZ = t.z;
      if (gated && this.seenNow && rel <= SIDE_ARC) {
        if (this._gateTries < 2) {
          const arrived = this._gatePt && SF.Util.dist2d(t.x, t.z, this._gatePt.x, this._gatePt.z) < 6;
          if (!this._gatePt || arrived || world.time - this._gatePtT > 7) {
            this._gatePt = this._reposPt(world, ref, distP);
            this._gateTries++; this._gatePtT = world.time;
            this._flankPlanT = world.time + 4;   // 侧向行进中 = 绕侧计划(履带次选条件之一)
          }
          navX = this._gatePt.x; navZ = this._gatePt.z; gateNav = true;
        } else {
          // 兑底第③步: 履带次选一发, 同时继续换位循环。配额与瞄点段 quotaOK 同一判据同一旋钮
          // (weakpoint.trackQuotaS, 旧版这里 +1 与憋炮处 +3 不一致 —— R4-B 统一同源):
          // 配额未恢复就不置豁免态, 兑底链这一拍落弱点/车体瞄高正常开火, 不再憋炮
          this._gateTrack = world.time - this._trackT > t.spec.gun.reload + WP.trackQuotaS;
          if (!this._gatePt || this.repositionT <= 0) {
            this.repositionT = 5 + Math.random() * 5;
            this._gatePt = this._reposPt(world, ref, distP);
            this._gatePtT = world.time;
            this._flankPlanT = world.time + 4;
          }
          navX = this._gatePt.x; navZ = this._gatePt.z; gateNav = true;
        }
      } else {
        this._gatePt = null; this._gateTrack = false;
      }

      /* --- 战术路由(G9): 本拍该用什么打法(优先级表见 _tacticRoute 头注) ---
         放在穿深门之后(要读它的 gated 终值)、导航之前(导航按战术分配驾驶权)。
         闸外(tactics.on=0 或 level<0.6)恒 legacy: 各模块走原条件, 行为与旧版一致 */
      if ((SF.CFG.ai.tactics || {}).on && this._gGate) this._tacticRoute(world, ref, distP, dt, lo, hi, gated);
      else this._tactic = 'legacy';
      const cfGo = this._tactic === 'coverFlank' && this._cfPt && !this.hold;   // 绕掩体转进(G9-④): 驾驶权归绕行

      if (!gateNav) {
        /* --- 角色分工导航(G3), 三层: 距离纪律恒在 > 带内站位精修 > 无站位退回换位脉冲 ---
           距离纪律(前压/拉开)用混合带: 二线 lo×1.1 会把 TD 自然拉出 42m+ 纵深(roleFit 判据),
           不能被站位/循环豁免——否则 TD 蹲出生点掩体打伸缩, 距敌 54m 反成全队最近(二线=顶线)。
           站位只在带内接管角度(翼侧分舷/顶线环位); 熄火(就绪+窗口关)时顶线前压压回射界,
           翼侧/二线沿对敌弧横移找射界(不弃位, 直压敌会把角色角度全打没) */
        const inBand = distP >= lo && distP <= hi;
        const blindHold = this._station && this._gWin && FD.on && !this._winState.open
          && t.reloadT <= 0 && this.seenNow && inBand;   // 就绪+窗口关=熄火傻站(迟滞主源)
        const linePush = blindHold && (this._role === 'line' || this._role === 'fallback') && distP > hi * 0.85;   // 限定带外: 前压公式 k=(distP-hi·0.85)/distP 在带内为负(倒着走, 油门空置); 带内熄火交给 strong 压上/找射界脉冲
        /* --- 高地强袭驾驶(G9-⑦): 授权(共享计划 ≥minN 车登记)后接管交战导航 ---
           集结窗内(goT 未到): 坡脚待命, 不前压不拉开 —— 就位等着, 就近掩体的 G2 照旧藏探。
           到点全队同拍转进: navigate 直插威胁位, BFS 自会沿可爬坡度绕行(陡坡回避仍生效,
           路线沿缓坡盘上去)。转进闩锁 _hillCommit 只看"爬到棱线/威胁消失/血线崩", 不看窗口
           闪断 —— 肩坡短暂开窗是爬坡常态, 看窗会半坡泄气。爬坡全程 _advancing(G8 预瞄):
           炮口一直压着敌位, 登顶窗口一开即射。孤车未授权时走原路(拉开/带内), 不送。 */
        const hillGo = this._tactic === 'hillAssault' && this._hillAuth;
        if (this._hillCommit) {
          const crest = world.terrain.heightAt(t.x, t.z) >= world.terrain.heightAt(ref.x, ref.z) - 2;
          if (!ref || !ref.alive || crest || t.hp < t.spec.hp * (P.retreatHp + 0.05)) this._hillCommit = false;
          else { this._advancing = true; navX = ref.x; navZ = ref.z; }
        } else if (hillGo && world.time >= this._hillGoT) {
          this._hillCommit = true; this._advancing = true;
          navX = ref.x; navZ = ref.z;
        } else if (hillGo) {
          navX = t.x; navZ = t.z;   // 集结待命: 停在坡脚, 炮口由预瞄压着敌位
        } else if (cfGo) {
          // 绕掩体掏侧后(G9-④): 掩体缘外接点, 绕过即侧/尾射界; 绕行中 _advancing 保预瞄
          // (炮口压着掩体缘, 敌露头/我绕过缘都能第一时间响炮)
          this._advancing = true;
          navX = this._cfPt.x; navZ = this._cfPt.z;
        } else if ((distP > hi || linePush) && !this.hold) {            // 太远: 前压(失去视野时压向最后已知位置); 顶线熄火也压回射界
          this._advancing = true;   // 预瞄纪律(G8): 推进全程炮口压敌向, 敌露头只剩反应+缩圈
          const k = (distP - hi * 0.85) / distP * (shy ? 0.5 : 1);   // 劣势换血: 前压步长减半
          navX = t.x + (ref.x - t.x) * k; navZ = t.z + (ref.z - t.z) * k;
          /* 沿掩体链推进(G9-③): 前压不裸奔 —— 领车沿掩体链逐跳推进(每跳落点=掩体背敌侧,
             与 G2 藏点同构, 到位装填期伸缩无缝接力)。同路集中(G9-⑤)不挂这里: 战斗态跟车
             是追移动目标, 后车永不停稳(实测 fireLatency 0.48→0.53 水位线破), 纵队集中在
             警戒态突入段实现(见 alert), 战斗态用静态跳点保开火节奏。 */
          const hop = this._chainHop(world, ref, distP, dt);
          if (hop) { navX = hop.x; navZ = hop.z; }
        } else if (distP < lo) {                                 // 太近: 拉开(混合带口径 —— 二线纵深的主要执行者)
          const k = (lo * 1.15 - distP) / Math.max(distP, 1);
          navX = t.x - (ref.x - t.x) * k; navZ = t.z - (ref.z - t.z) * k;
        } else if ((enemyLow || strong) && distP > lo * 1.1) {   // 敌残血/以大欺小(strong 换血占优): 带内压上(压到带下沿, 不贴脸换炮)。
          // 必须排在站位分支之前 —— 旧版在站位分支之后, 有站位的车永远走不到这条(死分支:
          // 残血该收的头也缩在站位上), 全员有站位时"带内压上"整体失效, 是蹲坑观感的成因之一
          const k = (distP - lo) / distP;
          navX = t.x + (ref.x - t.x) * k; navZ = t.z + (ref.z - t.z) * k;
        } else if (this._station && blindHold && !linePush) {
          if (this.repositionT <= 0) {
            this.repositionT = 2 + Math.random() * 2;   // 找射界脉冲: 同半径弧上横移, keyOf 奇偶定方向
            const bx = this._station.x - ref.x, bz = this._station.z - ref.z, bl2 = Math.hypot(bx, bz) || 1;
            const side = (keyOf(t, world) % 2 === 0) ? 1 : -1;
            navX = this._station.x - bz / bl2 * 12 * side; navZ = this._station.z + bx / bl2 * 12 * side;
          } else { navX = this._station.x; navZ = this._station.z; }   // 脉冲间保持站住(缩圈/伸缩接力)
        } else if (this._station) {
          if (SF.Util.dist2d(t.x, t.z, this._station.x, this._station.z) > 12) {
            navX = this._station.x; navZ = this._station.z;
          } else if (this.repositionT <= 0) {
            // 就位后小幅度游动(±8m, 不离站), 保留机动性不至于当固定炮台。
            // 间隔拉稀(9~17s): 游动瞬间 |speed|≥1.5 会打断摆角相, 频繁游动=摆角样本被吃掉
            this.repositionT = (9 + Math.random() * 8) * (shy ? TRADE.shyHoldMul : 1);
            navX = this._station.x + (Math.random() - 0.5) * 16; navZ = this._station.z + (Math.random() - 0.5) * 16;
          }
        } else if (this.repositionT <= 0) {                      // 距离合适: 时不时换位/绕侧
          this.repositionT = (5 + Math.random() * 6) * (shy ? TRADE.shyHoldMul : 1);   // 劣势: 藏相延长
          if (Math.random() < P.flankChance) {
            // 绕侧方向按合围扇区定: 一半顺时针一半逆时针, 多车围攻时形成对转包夹
            const side = this.flankSlot > Math.PI ? 1 : -1;
            const px = -(ref.z - t.z), pz = (ref.x - t.x), pl = Math.hypot(px, pz);
            navX = t.x + px / pl * 35 * side; navZ = t.z + pz / pl * 35 * side;
            this._flankPlanT = world.time + 4;                   // 绕侧行进中: 履带次选条件之一
          } else {
            navX = t.x + (Math.random() - 0.5) * 24; navZ = t.z + (Math.random() - 0.5) * 24;
            this._revPulseOk = true;   // 随机换位脉冲(G9-①): 唯一允许倒车转移的导航源(见 navigate 派发段)
          }
        }
      }
      /* --- 掩体伸缩循环(G2)相位机: none/hide/peek, 摆角相(none)与藏相按车类分时 ---
         优先级: hide/peek 驾驶 > angling > 随机换位(它们接管 navX/navZ 或直接写 input);
         穿深门换位(gateNav)是生存优先级, 让位给它(模块照旧退相)。 */
      const CVG = SF.CFG.ai.cover;
      if (CVG.on && this._gPeek && !gateNav && ref && !this._hillCommit && !cfGo) {
        this._coverStep(world, ref, distP, dt, lo, enemyLow);
      } else if (this._coverPhase !== 'none') {
        this._coverPhase = 'none'; this._coverPt = null; this._coverPeek = null;   // 模块关/gateNav/无参照: 退循环
      }
      // hold 单位(蹲点歼击车/守线重坦): 只在小范围内机动, 炮口始终对敌(穿深门换位同样被钳在 home 30m 内)。
      // 伸缩循环短途出位豁免(R4-D): 藏点常恰在 30m 圈缘(S2 唯一藏点距 home 26.6~30m, 30m 钳会把它吃掉)——
      // 打完回藏点, 藏点即新锚, 与守位语义不冲突
      if (this.hold && this._coverPhase === 'none' && !this._station && SF.Util.dist2d(navX, navZ, this.home.x, this.home.z) > 30) {
        const k = 30 / SF.Util.dist2d(navX, navZ, this.home.x, this.home.z);
        navX = this.home.x + (navX - this.home.x) * k; navZ = this.home.z + (navZ - this.home.z) * k;
      }
      // 歼击车需车体对准才能瞄准; 摆角模块启用时行进中(>1.5m/s)不锁敌——锁着敌开炮位会拖住车体走不动,
      // 静止才回锁(伸缩平移归 G3)。模块关/level=0(_angUse=0)时退回恒锁敌(旧行为, A/B 口径)
      // 歼击车锁敌只在"已到驾驶目标"时生效: 行进中还锁会把车头拽回对敌方向, 速度过 1.5 又解锁
      // 回行驶向 —— 阈值上振荡实测把 TD 钉在 1.4m/s(S5 stug3 归位 84m 走整场, 纵深判据 0%)
      const navArr = SF.Util.dist2d(t.x, t.z, navX, navZ) < 6;
      faceYaw = t.parts.noTurret ? (((this._angUse > 0 && Math.abs(t.speed) >= 1.5) || !navArr) ? null : toPlayerYaw) : null;
      // 藏相驾驶三级(方向感知): ①面对藏点(±92°)且 >5m → 前向快通(虚拟目标=藏点再往前 4m,
      //   抵消 navigate 的 4m 到位半径, 过冲后交倒车贴点即"车尾朝敌"); ②背对藏点 → 倒车
      //   直达(探点打完炮口朝敌而藏点在身后, 倒车零转体 4.9m/s 直线到; 前向要 180° 掉头
      //   ~5s, 实测掉头爬行 dH 8~17m 靠不拢, S5 全程 cov=0 的主因)——直线被硬掩体拦时改
      //   navigate 绕行(BFS 路径把掉头摊平成曲线); ③≤5m 交 _hideDrive 倒车贴点对向。
      //   卡掩体/顶坡门清速 1.5s 不动 → 退相交常规导航绕行再重找
      if (this._coverPhase === 'hide' && this._coverPt) {
        const dH = SF.Util.dist2d(t.x, t.z, this._coverPt.x, this._coverPt.z);
        const facing = Math.abs(SF.Util.angDiff(t.yaw, Math.atan2(this._coverPt.x - t.x, this._coverPt.z - t.z))) < 1.6;
        const revBlocked = world.covers.nearestCoverBetween(t.x, t.z, this._coverPt.x, this._coverPt.z) !== null;
        if (dH > 5 && facing) {
          const vx = this._coverPt.x + (this._coverPt.x - t.x) / dH * 4, vz = this._coverPt.z + (this._coverPt.z - t.z) / dH * 4;
          this.navigate(vx, vz, dt, world, null);
        } else if (dH > 5 && !facing && revBlocked) {
          const vx = this._coverPt.x + (this._coverPt.x - t.x) / dH * 4, vz = this._coverPt.z + (this._coverPt.z - t.z) / dH * 4;
          this.navigate(vx, vz, dt, world, null);   // 背对且直线被拦: 绕行
        } else {
          this._hideDrive(this._coverPt.x, this._coverPt.z, dt, world, ref);
          if (dH > 3 && Math.abs(t.speed) < 0.3) this._hideStuckT = (this._hideStuckT || 0) + dt;
          else this._hideStuckT = 0;
          if (this._hideStuckT > 1.5) {
            this._coverPhase = 'none'; this._coverPt = null; this._coverPeek = null;
            this._hideStuckT = 0; this._coverT = 1.5;
          }
        }
      } else if (this._coverPhase === 'peek' && this._coverPeek) {
        navX = this._coverPeek.x; navZ = this._coverPeek.z;
        if (t.parts.noTurret) faceYaw = toPlayerYaw;   // 探出途中就把车头压向敌: 固定战斗室到了探点要立刻能开炮
      }
      /* 倒车转移(G9-①, 收窄版): 只认装填期的随机换位脉冲(_revPulseOk, 本帧由换位分支置位) ——
         脉冲目标在身后(转身>100°, 正转必横穿 60~90° 侧露带)且敌看得见我、目标近(≤25m) → 改
         倒车过去: 前甲全程对敌, 慢一半换侧露零暴露。站点归位/前压/绕侧/掩体链不受此门(实测
         全导航源放开会把 roleFit/coverUse/dmg 全拖破: 慢速倒车吃掉到位与输出节奏)。 */
      let revPulse = false;
      if (this._revPulseOk && t.reloadT > 0 && this._coverPhase === 'none' && !gateNav && !this._coverSpotOK
          && this.seenNow && ref) {
        const dN = SF.Util.dist2d(t.x, t.z, navX, navZ);
        if (dN > 3 && dN < 25 && Math.abs(SF.Util.angDiff(t.yaw, Math.atan2(navX - t.x, navZ - t.z))) > 1.75) {
          this._hideDrive(navX, navZ, dt, world, ref);
          revPulse = true;
        }
      }
      this._revPulseOk = false;   // 逐帧重置: 只在换位脉冲拍为真
      if (this._coverPhase !== 'hide' && !revPulse) this.navigate(navX, navZ, dt, world, faceYaw);

      /* --- 停车即射: 缩圈收敛靠车体全静止 —— 必须双钉 throttle+steer, 只钉油门时 steer 仍驱动
         lastYawRate(vehicle.js 的 turnK 扩圈源), 圈永远收不到开火阈, 1.5s 超时内开不出火 --- */
      const al = t.spec.gun.autoloader || null;
      /* 停-射纪律补充(G3): 低耐心性格(机动流)在"赶站点途中"若窗口开着+炮已上膛+带内 —— 也停一拍
         把这发打掉再走。不补这条: 移动扩圈永远够不到开火阈, ready 时钟在赶路里空转(fireLatency),
         站位机动与开火纪律打架; 高耐心性格原本就 settle, 不受影响 */
      const driveBy = !!(this._coverPhase === 'none'
        && this._winState.open && t.reloadT <= 0 && distP >= lo * 0.75 && distP <= hi * 1.15);
        // 不再要求有站位: 无站(走廊弧扫落空)的翼侧游走车同样停一拍——否则漫游中 ready 窗口
        // 全程空转在移动扩圈上(S5 pz4 实测 1.2~1.7s 迟滞样本)
      const wantSettle = FD.on && this._gWin && !gateNav && this._coverPhase === 'none' && !this._hillCommit && !cfGo
        && (P.aimPatience >= 0.85 || driveBy)   // 高纪律性格才常态停车即射: 机动流只在赶路携弹+有窗时停一拍
        && (this._winState.open || distP < Math.min(lo * 1.2, 70))   // 窗口开着, 或贴身狗斗(贴身豁免窗口;
        // 狗斗半径加 70m 绝对上限: 二线/狙击的 lo 大(130-190), ×1.2 会把 156-228m 的对射也当
        // "狗斗"豁免窗口 —— 窗口关着(反斜面/掩体挡弹道)还钉在原地, 既不开火也不拉开,
        // 拉开退到反斜面后(S3 本义)被执行不了, 装填期全程裸露)
        && distP <= hi * 1.15                                   // 太远照旧机动前压, 不停下挨打
        && distP >= lo * 0.75                                   // 太近也不泊车: 该拉开(G3 混合带下, 二线纵深靠它执行)
        && t.reloadT <= t.spec.gun.reload * (this._maxFracReload || 0.55)   // 装填后段才停: 全程钉在
        && !al;                                                 // 空地上=站桩挨打(换弹该藏, 藏相归 G3); 弹夹车不 settle,
      if (this._settleCd > 0) this._settleCd -= dt;             //   长装填期留给 G3 藏相(站 20s+ 挨打违背纪律本意)
      if (!wantSettle) this._settleT = -1;
      else if (this._settleT < 0 && this._settleCd <= 0) this._settleT = FD.settleS;   // 冷却已过才重新进停车
      if (this._settleT >= 0) {
        this._settleT -= dt;
        this.input.throttle = 0;
        // 双钉里的"钉舵"只对有炮塔的车: 歼击车固定战斗室, 炮只随车体转, 钉死 steer = 车体永远转不回
        // 对炮位 → aimed 永假 → 永不开火(装填样本/掩体利用全垮)。旧版靠 2s 超时强制机动意外续命,
        // 冷却改短后死锁显形。放开车体回转对正后 steer 自然归 0(P 控制), 缩圈照常收敛, 只是慢半拍
        if (!t.parts.noTurret) this.input.steer = 0;
        // 超时: 窗口关着才强制动 0.8s 再试(看不见目标还站桩=白挨打); 窗口开着超时多是圈没收敛完,
        // 立即重进停车继续收 —— 旧版固定 2s 强制机动会把刚收好的圈重新炸开, 是开火迟滞的主源之一
        // (开火完成走瞄点段置位)
        if (this._settleT < 0) this._settleCd = this._winState.open ? 0 : 0.8;
      }

      /* --- 装填期摆角度(G2): 静止装填时车体摆出受弹角, 装填尾段回正 ---
         探相也摆(coverPhase==='peek' 放行): 探点是本循环唯一的被看见窗口, 贴角侧探的
         车头朝舷姿态(±90° 侧露)换成对敌 ±angUse 的受弹角(24~33°, 落在摆角指标 [20°,35°]
         带内), 打的就是"贴角侧刮"——防护与指标同向; |speed|<1.5 门天然把赶探点的驾驶让给
         navigate, 到点停稳才起摆 ---
         收益全靠既有判定(eff=armor/cos, >70°跳弹), 判定端零改动。
         前置: 交战中+可见+近乎静止+有炮塔(TD 无炮塔靠 faceYaw 锁敌)+非穿深门换位驾驶
         (换位是持久任务会被 throttle=0 吞掉, 摆角必须让位)+非前压/拉开段(|speed| 拦住起步/收尾瞬间,
         但前压刚起步 speed<1.5 时若被摆角钉住油门会永远压不上去, 故显式排除这两个驾驶段);
         带内随机换位是单 tick 脉冲, 装填期被摆角吞掉属设计内——装填期本就该站桩卖甲而非抖动送侧面。
         摆角让位停车即射(G1): settle 的双钉(油门+舵)是缩圈收敛的前提, 本块在其后覆写 steer 会让
         "车停了但车体还在满舵回正"——大偏差(赶站驾驶朝向/藏相倒车残留 90~120°, 摆角本身只摆
         ≤33°)下回正是 2~3s 的满舵回转, turnK 扩圈源全程钉住圈, ready 窗口空转到超时(fireLatency
         主源)。让位窗口=正在停车待射(_settleT>=0), 冻结期间炮塔独立瞄准(aimed 本就不看车头);
         开火即复位 settleT → 摆角立刻接管装填期照摆, 回转扩圈发生在装填期(不进 ready 时钟),
         与既有摆角收益不冲突。
         摆角期间炮塔由刚体随动保持世界炮向(vehicle.js 同源), 瞄向不丢 */
      // 探相摆角的时间门: 摆得完(转角差/转速+收圈尾 ≤ 剩余装填)才摆, 摆不完硬摆=迟滞发弹
      // +探相超时拆循环(S5 实测整场归零); 打完后的装填头部(reloadT>90%)摆不误发, 放行
      const peekSwingOk = this._coverPhase !== 'peek';   // 探相不摆(实测任何时间门都迟滞发弹/拆循环,
      //   探相姿态靠侧探几何本身; 摆角收益走 none 相的 0.85lo 放宽)
      /* --- 装填期摆角度(G5 分时窗): 无可用藏点=全窗摆角(reloadT>回正提前量); 有可用藏点
         (G2 锚点, 入口 0.25s 拍评估过)则只摆顶部时片(reloadT>R×hideFracCls[cls]), 剩余
         时片让给藏相入位 —— 摆角与藏相按车类分时(G2 的 hideFracCls 语义反置复用), 不互踩。
         例外: 车体偏离受弹角 >25°(探出/站位微移后的侧停, 实测 S5 pz4 侧停 94°)时不受时窗
         限制, 回摆角——深侧露对着射手等开火比多一次转体更亏 ---
         歼击车也摆(TD 摆角): 固定战斗室炮只随车体, 摆出受弹角的代价是炮口也要转回来, 故
         ①仅装填前段摆(reloadT>回正提前量+0.2, 回正预算只管车体归位) ②角打 tdMul(0.8)
         ③伺服扩圈尾(炮口一动 turK 即 1, ~1.1s)显式认账落在装填后的等待窗, 联调若 S2 的
         fireLatency 被拖破 0.8 首选降 tdMul 而非关模块。 */
      const farOffAng = Math.abs(SF.Util.angDiff(t.yaw, toPlayerYaw + this._angSide * this._angUse * (t.parts.noTurret ? this._tdMul : 1))) > 0.44;
      const twAng = t.reloadT > t.spec.gun.reload * (this._coverSpotOK ? (CVG.hideFracCls || {})[t.spec.cls] || 0.6 : 0)
        || t.reloadT > this._straightenLead + 0.2;
      const angling = this._angUse > 0 && this.seenNow && Math.abs(t.speed) < 1.5
        && !gateNav && this._coverPhase === 'none' && peekSwingOk && this._settleT < 0
        && !(distP > hi && !this.hold) && distP >= lo * 0.8
        && (twAng || farOffAng)
        && (t.reloadT > 0.05 || !this._winState.open || t.disp > 1.1 || this.reactT > 0
            || Math.abs(SF.Util.angDiff(t.turretYaw, this.input.aimYaw)) >= 0.05
            || Math.abs(SF.Util.angDiff(t.yaw, toPlayerYaw)) > 0.5);   // 冻结条件
        // (续)①炮塔追瞄中开火本就不可能(aimed 门), 车体回摆角与炮塔转并行; ②车体偏离敌向
        // >30°(探出/站位微移后的侧停, 实测 S5 pz4 侧停 94° 挂 sidExp 采样)时回摆角优先——
        // 侧装甲对着射手等开火比多 0.9s 收圈更亏; 旧'回正-再摆出'下宽逃逸口=满舵转体注
        // bloom(fireLat 0.43→0.63), 保持角姿态下摆角块只钉住不转体
        // 收窄到"此刻真的要开火"(上膛+窗口开+无补反应+圈已收)才锁车体——探出/站位微移后的
        // 侧停姿态(实测 S5 pz4 侧停 up to 94° 挂 sidExp 204 采样)在补反应/装填期自由回摆角,
        // 不占发弹时钟(要开火的那一发本来就被 aimed/reactT 挡着); 旧'回正-再摆出'下宽逃逸口
        // =满舵转体注 bloom(fireLat 0.43→0.63), 保持角姿态下摆角块只钉住不转体, 已无害
      if (angling) {
        this.input.throttle = 0;   // 摆角期不动: 动着摆没有受弹面意义, 还扩圈
        const angTgt = toPlayerYaw + this._angSide * this._angUse * (t.parts.noTurret ? this._tdMul : 1);
        if (t.parts.noTurret && t.reloadT <= this._straightenLead + 0.2) {
          // 歼击车回正期(G5①): 炮随车体, 开火前必须物理归正到敌向——死区内 steer 硬 0
          // (车体微调带动炮口随动持续扩圈, 不归零缩圈收敛不完); 伺服扩圈尾认账在等待窗
          const dA = SF.Util.angDiff(t.yaw, toPlayerYaw);
          this.input.steer = Math.abs(dA) < this._angDead ? 0 : SF.Util.clamp(dA * 2.5, -1, 1);
        } else {
          // 摆出/保持(有炮塔车全程): P 控制钉在受弹角(无死区——死区停摆实测冻结在目标前
          // 10°, 既不在受弹角带也不朝敌); 到位后 dA→0 舵自然归零, bloom 在保持期掉完,
          // ready 一开即射(fireLat 回归的根治: 旧'回正-再摆出'每周期两次满舵转体)。
          // 舵量分档(按炮塔): 歼击车全速——摆窗紧(时窗×tdMul), 减速实测摆不完(S2 17→2%);
          // 有炮塔车半速——turnK 峰值 0.5 时 disp 目标≈base×1.5 仍在开火阈之下, 边转边可射
          // (实测聚合 fireLat 0.66→0.56), 同角度装甲姿态下开火等待更短
          this.input.steer = t.parts.noTurret ? SF.Util.clamp(SF.Util.angDiff(t.yaw, angTgt) * 2.5, -1, 1)
                                              : SF.Util.clamp(SF.Util.angDiff(t.yaw, angTgt) * 1.25, -0.5, 0.5);
        }
      }
    }
    else if (this.state === 'retreat') {
      // 撤退驾驶对"物理最近之敌"算脱离向量(纯最近, 非焦点)——集火只改炮口不改驾驶(G4⑥):
      // 撤退车被焦点牵着掉头是送死; 炮口还击(aimAt)仍走焦点目标。
      // 撤向优先(G6③): 朝本队 second 站位方向撤(TD 火力掩护圈里, 敌追击=吃二线交叉火力),
      // 无 second 站位才退回掩体/背敌原逻辑
      const navP = nearestPlain(world, this.tank);
      aimAt = this.lastSeen || { x: player.x, z: player.z, vx: 0, vz: 0 };
      let secStn = null;
      if (this._memo) {
        for (const k of Object.keys(this._memo.roles)) {
          if (this._memo.roles[k] !== 'second' || !this._memo.stations[k]) continue;
          const m8 = this._memo.byK && this._memo.byK[k];
          if (m8 && m8.alive && k !== String(keyOf(t, world))) { secStn = this._memo.stations[k]; break; }
        }
      }
      if (secStn) {
        // 撤到二线火力的 60% 处(不贴 TD 身, 留纵深); 炮口仍对敌还击
        const k3 = 0.6;
        this.navigate(t.x + (secStn.x - t.x) * k3, t.z + (secStn.z - t.z) * k3, dt, world);
      } else {
        const cov = world.covers.nearestCoverBetween(navP.x, navP.z, t.x, t.z);
        const away = cov ? { x: cov.x + (t.x - cov.x) * 0.4, z: cov.z + (t.z - cov.z) * 0.4 }
          : { x: t.x + (t.x - navP.x) * 0.4, z: t.z + (t.z - navP.z) * 0.4 };
        this.navigate(away.x, away.z, dt, world);
      }
    }

    /* --- 瞄准与开火(交战/撤退中均还击) --- */
    if (aimAt && player && player.alive) {
      const flightT = distP / t.spec.gun.speed;
      const lead = P.leadSkill;                              // 预判能力(性格差异)
      const predX = aimAt.x + (aimAt.vx || 0) * flightT * lead;
      const predZ = aimAt.z + (aimAt.vz || 0) * flightT * lead;
      // 瞄点高度三选(weakpoint.on): 按 rel 选暴露面弱点 —— 正对<frontDeg 打首下(lowY),
      // 侧对 打侧面(hullSide sideY), 背对>sideDeg 打车尾(rearY, 命中掷 rearChance 毁发动机)。
      // 履带次选(R4-B 布尔式): 触发条件原样保留(穿深门兑底链 _gateTrack / 有绕侧计划 / 敌正在转移
      // 速度>2m/s 瞄履带断腿造停车), 但配额未恢复(quotaOK=false)时不再选履带也不再 holdFire ——
      // 落到弱点/车体瞄高正常开火。旧版配额期憋炮会把"就绪窗口"拖满(静止目标周期吃瞄高 0.35 的
      // 履带弹, 还拉爆 fireLatency); 配额两处同源: 这里与兑底链赋值处都用 reload+trackQuotaS。
      // 断腿后敌 speed→0, 转移条件自然解除 → 回弱点瞄高。模块关(weakpoint.on=0, G5 level<0.4 同款): 退回旧二值瞄高
      const gy = world.terrain.heightAt(player.x, player.z);
      const quotaOK = world.time - this._trackT > t.spec.gun.reload + WP.trackQuotaS;
      const trackAim = this._gateTrack
        || (WP.on && this._gWeak && (world.time < this._flankPlanT || Math.abs(player.speed || 0) > 2) && quotaOK);
      let ty, zoneH;   // zoneH=瞄区带特征高(m): 与瞄点选带同源(单一事实源), 覆盖比开火门用
      if (trackAim) {
        ty = gy + WP.trackY; zoneH = 0.55;   // 履带弹有效带=履带+下裙板(打高半档还是下车体), 不按纯履带 0.35 卡门
      } else if (WP.on && this._gWeak) {   // 难度闸: level<0.4 连同履带次选一起退回二值瞄高(A/B 口径)
        if (rel < WP.frontDeg * Math.PI / 180) { ty = gy + WP.lowY; zoneH = WP.lowY; }
        else if (rel <= WP.sideDeg * Math.PI / 180) { ty = gy + WP.sideY; zoneH = WP.sideY; }
        else { ty = gy + WP.rearY; zoneH = WP.rearY + 0.25; }   // 车尾含引擎舱: 瞄区放宽一档
      } else {
        ty = gy + (P.aimPatience >= 0.85 ? 0.7 : 1.2);       // 旧逻辑回退(weakpoint.on=0 或 level<0.4): 高纪律打首下, 其余瞄车体中心
        zoneH = P.aimPatience >= 0.85 ? 0.7 : 1.2;
      }
      /* 命中几何口径(G9-②b): 缩圈门不看圈的绝对档位, 看"圈在目标处的线半径 vs 瞄区带高"的
         覆盖比 —— disp 单位是 m@100m, 线半径=disp×distP/100。大瞄区(车尾/侧面/近距)圈没缩
         也罩得住 → 装填完即射("对着屁股直接就是一炮"); 小瞄区(远距首下/履带)按比例多等
         (zone 比满缩圈小多少, 阈值就比 base 低多少, 一直钳到 base×1.08 为止 —— 圈只能收敛
         到 base, 等得比满瞄还久物理上不可达, 只剩低概率硬打)。kCov=容许覆盖倍数(圈半径为
         瞄区高的几倍内仍可射): 性格耐心收紧耐心党, 贴身×1.5/快炮×1.4 放宽(移动探头先打出
         去这一发)。上限钳 max: 圈比瞄区大太多还打=浪费装填。损炮同倍放宽, 损炮不是哑炮。 */
      const D = t.spec.dispersion;
      const gunBad = t.modules.gun > 0 ? SF.CFG.armor.modules.gun.dispPenalty : 1;
      const brawl = distP < this.bandFor()[0] * 1.2;
      const discOn = FD.on && this._gWin;
      const W9 = this._winState;
      const snap = discOn && W9.open && W9.openT !== undefined && world.time - W9.openT < (FD.snapS || 1.2)
        && Math.abs(player.speed || 0) > 1.5;
      const kCov = brawl ? 2.0 : snap ? 1.8 : 2.05 + 0.25 * (1 - P.aimPatience);   // 标定(实测二分): 正面首下@100m 略松于旧门, 侧面/车尾/近距即射, 远距小瞄区收紧多等
      let fireThreshold = SF.Util.clamp(zoneH * kCov * 100 / Math.max(distP, 1), D.base * 1.08, D.max) * gunBad;
      // 开火窗口状态机: 粗门=seenNow(可见即窗口, 0 射线), 精化=炮口射线至本帧瞄点(仅 seenNow 时复评);
      // !seenNow 窗口按关。射线终点高度=瞄点段同一 ty(矮掩体挡瞄点时窗口同步判关, 不对掩体浪费)。
      // 复评两个触发口都过 _winCheck→_winEdge 唯一链(R4-C): ①周期 recheckS 节流 ②fire gate 即时探测
      // (其余开火条件全真而窗口关着时逐 tick 探) —— 出掩到开火不再吃最长一个复评周期的迟滞;
      // rearm 补反应在链内同构生效, 同步路径抢开窗也照补, 重露头不会白送反应速度。
      // 瞄向先落(aimYaw 与 ty 无关): aimed/就绪判据要在窗口链前备好, 链内可能抬 ty 改的是 pitch
      this.input.aimYaw = Math.atan2(predX - t.x, predZ - t.z);
      const aimed = Math.abs(SF.Util.angDiff(t.turretYaw, this.input.aimYaw)) < 0.05;
      const readyNoWin = this.seenNow && this.reactT <= 0 && t.reloadT <= 0 && t.disp < fireThreshold;
      if (!discOn) {
        this._winState.open = true;   // 模块关: 窗口恒开 → 开火门退化为与旧逻辑等价
      } else if (!this.seenNow) {
        if (this._winState.open) { this._winState.open = false; this._winState.since = world.time; }   // 开→关: 记隐藏起点
      } else if (world.time - this._winChkT >= FD.recheckS || (readyNoWin && aimed && !this._winState.open)) {
        this._winChkT = world.time;
        const res = this._winCheck(predX, predZ, ty, gy, trackAim, world);
        ty = res.ty;
        this._winEdge(res, brawl, world);
      }
      this._aimTy = ty;   // 单一事实源: 本帧最终瞄点高度(可能含车体中线回退), G1 窗口射线终点与 aimPitch 同源
      const dy = ty - (t.y + 2.0), dh = Math.hypot(predX - t.x, predZ - t.z);
      this.input.aimPitch = SF.Util.clamp(Math.atan2(dy, Math.max(dh, 1)), t.spec.gunDepression, t.spec.gunElevation);
      // 开火门: reactT 就地重读(窗口链的重露头补反应可能刚把它抬起来, 不能用链前的旧值)
      this.input.fire = this.seenNow && this.reactT <= 0 && aimed && t.reloadT <= 0 && t.disp < fireThreshold
        && this._winState.open;   // 开火纪律: 须炮口窗口开着。旧版贴身豁免窗口实测在 60~70m 掩体
        // 交战带(lo×1.2 内)逐发把弹打进墙里(S4 追踪 46 发被挡 vs 8 中, 同一弹位每装填复读一次
        // —— 即时探窗又被 !brawl 排除, 窗口状态再准也白搭); 贴身的"敢开炮"保留在缩圈阈放宽
        // (brawl ? 0.5 : 耐心档), 不再保留"隔着掩体也打"
      if (this.input.fire && trackAim) this._trackT = world.time;   // 履带弹配额记账(连续≤1发)
      if (this.input.fire) this._settleT = -1;                      // 开火即完成停车即射
    }
    return this.input;
  }
};
