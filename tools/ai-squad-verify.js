// ai-squad-verify.js — 2026-10-05 四项 AI 修复的定向验证台(零 npm 依赖)
// ① 以大欺小(trade.bullyMargin): 2×pz4(MT) vs 1×bt7(LT) 对峙 → _strong 全程 true、
//    _shy 全程 false, 且带内(55~115m)持续给油压近(旧版带内站桩等窗口, 油门空置)
// ② 小队全顶线(role.squadLineN): 同场景两台 MT 角色必须都是 line(旧版 1 line+1 flank,
//    顶线单进+残血补防 = 逐个送的节奏来源)
// ③ shy 止损(trade.shyMaxS): 1×pz4(45% 血) vs 1×tiger1(满血) —— 装甲账天然劣势 → strong=false,
//    单独检验止损通道: 前 ~12s _shy=true, 超时后翻 false(藏相没保住血就恢复正常打法)
// ④ 高地授权迟滞(hill.authHoldS): 3 行闩锁逻辑, 代码评审覆盖, 不在本台
// 用法: node tools/ai-squad-verify.js   (退出码 0/1; 装配复用 ai-bench: require 即装载游戏脚本,
//       不自动开跑基准。本台不跑运动学/弹道 —— 只读 AI 决策内部状态, 装填锁死防开火路径进裁判)
'use strict';
const BENCH = require('./ai-bench.js');
const SF = globalThis.SF;
const DT = 1 / 60;
let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log(`  ✓ ${name}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' ' + extra : ''}`); }
};

function buildWorld(mapDir) {
  const { J, T } = BENCH.loadTerrain(mapDir);
  const list = J.covers.map(BENCH.coverCol);
  const W = {
    time: 0, over: false, terrain: T,
    covers: {
      list, heightAt: T.heightAt,
      blocked(ox, oz, oy, dx, dz, len, dy, spot) { return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot); },
      nearestCoverBetween(ax, az, bx, bz) { return SF.Sim.nearestCoverBetween(this.list, ax, az, bx, bz); },
    },
    enemies: [], player: null, mpTargets: [], intel: { x: 0, z: 0, t: -99, level: 0 },
  };
  SF.Game = { world: W };
  return W;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// 恒上膛: 本台无运动学/弹道裁判, input.fire 按下无人接(不进弹道/伤害路径); reloadT 保持 0
// 是让战术路由走 standFight/压上而非 angle(摆角=停车)——否则 A4 的油门测量失真
const holdFire = (ais) => { for (const a of ais) a.reloadT = 0; };

console.log('== 场景A: 2×pz4(MT) vs 1×bt7(LT), l04 平地 100m 对峙(带内) ==');
{
  const W = buildWorld('l04-steppe');
  const defs = [{ type: 'pz4', p: [-60, 110] }, { type: 'pz4', p: [-40, 100] }];
  const ais = defs.map((d, i) => {
    const t = BENCH.mkTank(d.type, { x: d.p[0], z: d.p[1], yaw: 0, team: 1, netId: 0, id: 1 + i });
    t.ai = new SF.AI(t, { personality: 'flanker', patrol: [d.p], hold: false });
    return t;
  });
  W.enemies = ais;
  const rob = BENCH.mkTank('bt7', { x: -60, z: 210, yaw: Math.PI, team: 0, netId: 5, isPlayer: true });
  W.player = rob; W.mpTargets = [rob];
  const d0 = dist(ais[0], rob);
  let strongN = 0, shyN = 0, inBandN = 0, sampN = 0, combatN = 0;
  // A4 测导航目标而非油门: 本台无运动学, 车永不动 → navigate 的卡死检测会清油门(测量伪影);
  // "带内压近意图"以 navigate 目标点判: 目标比本车更靠近敌 = 在压近(旧版带内 nav 恒为站位/游动点)
  const navCloser = [];
  const wrapNav = (aiT) => {
    const orig = aiT.ai.navigate.bind(aiT.ai);
    aiT.ai.navigate = function (x, z, dt, world, face) { aiT._lastNav = { x, z }; return orig(x, z, dt, world, face); };
  };
  wrapNav(ais[0]);
  let navN = 0;
  for (let k = 0; k < 20 / DT; k++) {
    W.time += DT;
    holdFire(ais);
    for (const a of ais) if (a.alive) a.ai.update(DT, W);
    if (k % 30 === 0) {   // 0.5s 一采
      sampN++;
      const ai = ais[0].ai;
      if (ai._strong) strongN++;
      if (ai._shy) shyN++;
      if (ai.state === 'combat') combatN++;
      const band = ai._band || [55, 115];
      const dp = dist(ais[0], rob);
      if (ai.state === 'combat' && dp >= band[0] && dp <= band[1]) {
        inBandN++;
        const nv = ais[0]._lastNav;
        if (nv && dist(nv, rob) < dp - 5) navCloser.push(1); else navCloser.push(0);
      }
    }
  }
  navN = navCloser.reduce((s, v) => s + v, 0);
  ok(combatN >= sampN * 0.8, `A0 前提: 交战态占比 ${(combatN / sampN * 100).toFixed(0)}%(露头即锁定)`);
  ok(strongN === sampN, `A1 以大欺小: _strong 全程 (${strongN}/${sampN})`);
  ok(shyN === 0, `A2 优势压制 shy: _shy true 次数 ${shyN}(应为 0)`);
  const roles = W._teamMemo && W._teamMemo.roles;
  const r1 = roles && roles[1], r2 = roles && roles[2];
  ok(r1 === 'line' && r2 === 'line', `A3 小队全顶线: roles = ${JSON.stringify(roles)}(旧版 1 line + 1 flank)`);
  ok(inBandN > 0 && navN >= inBandN * 0.5,
    `A4 带内压近意图: 带内采样 ${inBandN} 次中导航目标朝敌 ${navN} 次(≥50%; 旧版带内导航恒为站位/游动点), 初距 ${d0.toFixed(0)}m`);
}

console.log('== 场景B: 1×pz4(45% 血) vs 1×tiger1(满血), l04 —— shy 止损时序 ==');
{
  const W = buildWorld('l04-steppe');
  const t = BENCH.mkTank('pz4', { x: -60, z: 80, yaw: 0, team: 1, netId: 2 });
  t.ai = new SF.AI(t, { personality: 'flanker', patrol: [[-60, 80]], hold: false });
  t.hp = t.spec.hp * 0.45;   // 血量%劣势(< 敌满血×0.85)但未到撤退线(> retreatHp+0.1=30%)
  W.enemies = [t];
  const rob = BENCH.mkTank('tiger1', { x: -60, z: 210, yaw: Math.PI, team: 0, netId: 5, isPlayer: true });
  W.player = rob; W.mpTargets = [rob];
  const shyAt = (absSec) => {   // 跑到绝对时刻 absSec 再采样(时间轴累计, 别写成"再跑 N 秒")
    let v = null;
    while (W.time < absSec) { W.time += DT; holdFire([t]); t.ai.update(DT, W); v = t.ai._shy; }
    return v;
  };
  const s6 = shyAt(6), s10 = shyAt(10), s13 = shyAt(13), s16 = shyAt(16);
  ok(t.ai._strong === false, `B0 前提: pz4 对 tiger1 装甲账劣势 → strong=false`);
  ok(s6 === true && s10 === true, `B1 前 10s 劣势保守: _shy=${s6}/${s10}(应 true)`);
  ok(s13 === false && s16 === false, `B2 止损翻转: ${s13}/${s16}(超 shyMaxS=12s 后应 false, 恢复正常打法)`);
}

console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
