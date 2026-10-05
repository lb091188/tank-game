#!/usr/bin/env node
// test-srv-sim.js — 阶段3 门禁②: 服务器权威死斗(dm srvSim)消息级用例(零新依赖, ws 复用 server/node_modules)
//
// 用法: 先起服 (cd server && node server.js 8352), 再 node tools/test-srv-sim.js [端口=8352] (admin=端口+1)
// 退出码 0 = 全过。
//
// 用例清单(评审#6 要求的消息级覆盖):
//   ① dm 开局: start 载荷带 srvSim=true; 20Hz 快照节拍(1s ≥15 条); tn 行 12 字段全数值; st 时限倒计
//   ② 输入驱动: 30Hz 上行 throttle=1 → 本车 tn 位移 > 0(服务器在跑模拟的直接证据)
//   ③ input clamp: throttle=99/aimYaw=1e9 恶意值 → 快照不断、数值有界、无 NaN(clamp 生效)
//   ④ 房主断线续战: 关闭房主连接 → 快照仍持续 ≥3s(≥40 条)且无解散广播(本次迁移要消除的行为)
//   ⑤ 服务器判 end: admin 强制结算 → 广播 end(scores 数组) + battles.jsonl 落盘 + 房间复位可再战
//   ⑥ coop 不带 srvSim: start.srvSim 为假且无服务器快照(中继路径保留, coop 阶段4 再扩)
//   ⑦ 4 房并发 CPU 探针(评审#10): 4 房同时跑 sim, admin srv.tickP95 < 16ms(主线程无积压)
'use strict';
const WebSocket = require('../server/node_modules/ws');

const PORT = process.argv[2] || '8352';
const ADMIN = process.argv[3] || (Number(PORT) + 1);
const URL = `ws://127.0.0.1:${PORT}`;
const HDR = { 'X-Steel-Admin': '1', 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const SF_CLAMP = (v, a, b) => Math.max(a, Math.min(b, v));
const bear2 = (aiC, meC) => Math.atan2(aiC[0] - meC[0], aiC[1] - meC[1]);
function ok(cond, name) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } }

function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    ws.queue = []; ws.pending = [];
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf); } catch (e) { return; }
      const i = ws.pending.findIndex(p => p.match(m));
      if (i >= 0) ws.pending.splice(i, 1)[0].res(m);
      else ws.queue.push(m);
    });
    ws.on('open', () => res(ws));
    ws.on('error', rej);
    ws.on('close', () => { ws.closed = true; });
  });
}
function wait(ws, t, timeout = 4000, match) {
  const i = ws.queue.findIndex(m => m.t === t && (!match || match(m)));
  if (i >= 0) return Promise.resolve(ws.queue.splice(i, 1)[0]);
  return new Promise((res, rej) => {
    ws.pending.push({ match: m => m.t === t && (!match || match(m)), res });
    setTimeout(() => rej(new Error(`等 ${t} 超时`)), timeout);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function mint() {
  const r = await fetch(`http://127.0.0.1:${ADMIN}/admin/key?uses=30&ttl=600`, { method: 'POST', headers: HDR }).then(r => r.json());
  const rr = await fetch(`http://127.0.0.1:${PORT}/key/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: r.key }) }).then(r => r.json());
  return rr.token;
}
// 30Hz 上行 n 秒 input
async function drive(ws, row, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { ws.send(JSON.stringify({ t: 'input', i: row })); await sleep(33); }
}
function tnOf(ws, id) {
  for (let i = ws.queue.length - 1; i >= 0; i--) {
    const m = ws.queue[i];
    if (m.t === 'snap' && m.tn && m.tn[id] !== undefined) return m.tn[id];
  }
  return null;
}
async function collectSnaps(ws, ms) {
  const before = ws.queue.filter(m => m.t === 'snap').length;
  await sleep(ms);
  const arr = ws.queue.filter(m => m.t === 'snap');
  return { got: arr.length - before, snaps: arr };
}

(async () => {
  console.log(`== 服务器权威 dm(srvSim) 用例 ${URL} (admin 127.0.0.1:${ADMIN}) ==`);
  const token = await mint();

  /* —— ⑦ 4 房并发 CPU 探针(评审#10): 先占满 4 房跑 sim, 测主线程 p95 —— */
  {
    const rooms = [];
    for (let i = 0; i < 4; i++) {
      const a = await connect();
      a.send(JSON.stringify({ t: 'create', name: '测' + i, tank: 'tiger1', token, proto: 2 }));
      const j = await wait(a, 'joined');
      a.send(JSON.stringify({ t: 'start', map: 'l01', mode: 'dm' }));
      await wait(a, 'start', 4000, m => m.srvSim === true);
      rooms.push({ a, id: j.you });
    }
    for (const r of rooms) await drive(r.a, [1, 0.4, 0, 0, 1], 8000);   // 8s 满载驾驶+开火
    const st = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`, { headers: HDR }).then(r => r.json());
    ok(st.srv && st.srv.rooms >= 4, `4 房 sim 并发运行 (srv.rooms=${st.srv && st.srv.rooms})`);
    ok(st.srv && st.srv.tickP95 < 16, `主线程 tick p95 < 16ms (实测 ${st.srv && st.srv.tickP95}ms, 样本 ${st.srv && st.srv.tickSamples})`);
    // 阶段5 内存预算(设计 §3.4: 30-60MB/房 ×4 + 基础 <500MB RSS; 不达标再上 per-room worker_threads)
    ok(typeof st.mem === 'number' && st.mem > 0 && st.mem < 600, `4 房内存预算 <600MB RSS (实测 ${st.mem}MB)`);
    for (const r of rooms) r.a.close();
    await sleep(400);   // 房间随连接关闭清空, 释放 4 房上限
  }

  /* —— ⑥ coop 权威段(阶段4): srvSim + AI 波次 + 判伤 + coop 快照字段 + 房主断线 AI 继续 —— */
  {
    const a = await connect();
    a.send(JSON.stringify({ t: 'create', name: '合甲', tank: 'pz4', token, proto: 2 }));   // 对等车位: 一炮秒杀 AI 会使其来不及还击命中人类
    const ja = await wait(a, 'joined');
    const b0 = await connect();
    b0.send(JSON.stringify({ t: 'join', room: ja.room, pass: '', name: '合乙', tank: 'pz4', proto: 2 }));
    const jb0 = await wait(b0, 'joined');
    const b0id = jb0.you;
    a.send(JSON.stringify({ t: 'start', map: 'l01', mode: 'coop' }));   // l01 村庄波: 实证 AI 20s 内接敌开火命中
    const st = await wait(a, 'start', 4000);
    ok(st.srvSim === true, 'coop start 带 srvSim=true(阶段4 coop 上服务器)');
    await drive(a, [0, 0, 0, 0, 0], 400);   // 首条 input 触发服务器生成首波(srv-sim input 门)
    const wave = await wait(a, 'ev', 8000, m => m.k === 'aiWave');
    ok(Array.isArray(wave.d.list) && wave.d.list.length >= 1 && wave.d.list.every(it => it.id >= 100),
      `AI 波次生成(aiWave ${wave.d.list.length} 辆, id≥100)`);
    await sleep(600);
    const snap = a.queue.filter(m => m.t === 'snap').pop();
    const aiRows = snap && Object.keys(snap.tn).filter(id => +id >= 100);
    ok(snap && aiRows.length >= 1, `快照含 AI 实体行 (${aiRows ? aiRows.length : 0} 辆)`);
    ok(snap && Array.isArray(snap.wv) && snap.wv[1] >= 1 && typeof snap.wv[2] === 'string', `wv 波次字段 (${snap ? JSON.stringify(snap.wv).slice(0, 60) : '-'})`);
    // 房主断线 → AI 对局继续(乙仍在房: 快照/ev 持续, 无解散广播)
    let dissolved = false;
    b0.on('message', (buf) => { try { const m = JSON.parse(buf); if (m.t === 'err' && m.msg.includes('解散')) dissolved = true; } catch (e) { } });
    a.close();
    const kept = await collectSnaps(b0, 3000);
    ok(kept.got >= 40 && !dissolved, `coop 房主断线后对局继续 (3s 快照 ${kept.got} 条≥40, 解散广播=${dissolved})`);
    // AI 会开火且能命中: 人类先开到最近 AI 的 100m 内停稳(出生环随机点可能距 AI 巡逻区 300m+,
    // 不接敌则 AI 视距/LOS 外永不交火), 再站桩等 AI 开火命中 —— 移动靶会显著降低 AI 命中率;
    // 开火证据=AI fire ev/AI 装填对账, 命中证据=hit ev g<100 或 人类 tn hp 下降。窗口 100s。
    let fired = false, hurt = false, startHp = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000 && !(fired && hurt)) {   // 240s: 清波→新波循环内必互中(pz4 对同档)
      await sleep(400);
      const sNow = b0.queue.filter(m => m.t === 'snap').pop();
      if (!sNow) continue;
      const me = sNow.tn[b0id];
      if (me && startHp === null) startHp = me[7];   // 开局满血基准(掉血=AI 命中证据)
      const aiRow = Object.entries(sNow.tn).filter(([id, r]) => +id >= 100 && r[8] === 1)
        .sort((a, b) => Math.hypot(a[1][0] - me[0], a[1][1] - me[1]) - Math.hypot(b[1][0] - me[0], b[1][1] - me[1]))[0];
      if (me && aiRow) {
        // 距离带 40~90m + 避开大高差(贴脸停洼地会让 AI 炮管俯角不够、弹全部从头顶飞过 —— 真实炮管俯仰物理)
        const dX = aiRow[1][0] - me[0], dY = aiRow[1][1] - me[1];
        const dist = Math.hypot(dX, dY);
        const aiY = aiRow[1][2], dY2 = aiY - me[2];
        const bear = Math.atan2(dX, dY);
        const steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(bear - me[3]), Math.cos(bear - me[3])) * 2));
        if (dist > 90 || (dist < 40 && dY2 > 2.5)) {
          b0.send(JSON.stringify({ t: 'input', i: [1, steer, bear, 0.02, 1] }));   // 接近/后撤找平地; fire 常开触发 onHurt 接警
        } else if (dist < 40) {
          b0.send(JSON.stringify({ t: 'input', i: [-0.5, steer, bear, 0.02, 1] }));   // 太近且低洼: 倒车拉开
        } else {
          b0.send(JSON.stringify({ t: 'input', i: [0, 0, bear2(aiRow[1], me), Math.atan2(dY2, dist), 1] }));   // 距离带内停稳对炮
        }
      }
      const fireEv = b0.queue.find(m => m.t === 'ev' && m.k === 'fire' && m.d.id >= 100);
      const aiFired = sNow && Object.entries(sNow.tn).some(([id, r]) => +id >= 100 && r[10] > 1.5);
      if (fireEv || aiFired) fired = true;
      const hitEv = b0.queue.find(m => m.t === 'ev' && m.k === 'hit' && m.d.g < 100);
      if (hitEv) hurt = true;
      if (startHp !== null && me && me[7] < startHp - 0.5) hurt = true;   // 掉血 = AI 火力命中
    }
    b0.send(JSON.stringify({ t: 'input', i: [0, 0, 0, 0, 0] }));
    ok(fired, 'AI 自主开火(fire ev id≥100 或装填对账)');
    // 确定性命中链: admin srv-fire 命令存活 AI 向人类开一炮(真实引擎炮口/散布/弹道/OBB 判定/takeHit,
    // 只绕过 AI 开火时机决策 —— 测试钩子同 main.js SF.Game.test 先例), 人类必被命中(掉血+hit ev)
    // 确定性命中链: 从存活 AI 挑距人类最近者, 连射 srv-fire(真实引擎炮口/散布/弹道/OBB 判定/takeHit,
    // 只绕过 AI 开火时机决策)直至人类掉血 —— AI 弹目判定链路确定性验证
    const hpBefore0 = (b0.queue.filter(m => m.t === 'snap').pop() || { tn: {} }).tn[b0id];
    const hpBefore = hpBefore0 ? hpBefore0[7] : null;
    const hitBefore = b0.queue.filter(m => m.t === 'ev' && m.k === 'hit' && m.d.g < 100).length;
    let hitNow = false;
    for (let attempt = 0; attempt < 15 && !hitNow; attempt++) {
      const dbgInfo = await fetch(`http://127.0.0.1:${ADMIN}/admin/srv-dbg?room=${ja.room}`, { headers: HDR }).then(r => r.json());
      const humansPos = (dbgInfo.tanks || []).filter(t => !t.ai);
      const aliveAi = (dbgInfo.tanks || []).filter(t => t.ai && t.alive);
      if (!aliveAi.length || !humansPos.length) break;
      const meP = humansPos[0];
      aliveAi.sort((x, y) => Math.hypot(x.x - meP.x, x.z - meP.z) - Math.hypot(y.x - meP.x, y.z - meP.z));
      const fireRes = await fetch(`http://127.0.0.1:${ADMIN}/admin/srv-fire?room=${ja.room}&from=${aliveAi[0].id}&at=${b0id}`, { method: 'POST', headers: HDR }).then(r => r.json());
      if (attempt < 3) console.log(`  [srv-fire#${attempt}] ${JSON.stringify(fireRes)} 目标位置:`, JSON.stringify(humansPos[0]));
      for (let i = 0; i < 12 && !hitNow; i++) {
        await sleep(300);
        const sNow = b0.queue.filter(m => m.t === 'snap').pop();
        const hpNow = sNow && sNow.tn[b0id] ? sNow.tn[b0id][7] : hpBefore;
        if (hpBefore !== null && hpNow < hpBefore - 0.5) hitNow = true;
        if (b0.queue.some(m => m.t === 'ev' && m.k === 'hit' && m.d.g === b0id)) hitNow = true;
      }
    }
    ok(hitNow, `AI 炮弹命中人类车(存活 AI 连射 srv-fire, hp ${hpBefore} → 掉血/hit ev)`);
    const sPk = b0.queue.filter(m => m.t === 'snap').pop();
    ok(sPk && Array.isArray(sPk.pk), `pk 空投字段在 (${sPk ? JSON.stringify(sPk.pk).slice(0, 40) : '-'})`);
    // admin 强制结算 → end 落盘(mode coop)
    const endP = wait(b0, 'end', 6000);
    await fetch(`http://127.0.0.1:${ADMIN}/admin/srv-end?room=${ja.room}`, { method: 'POST', headers: HDR });
    const end = await endP;
    ok(Array.isArray(end.scores) && end.scores.length === 2, 'coop 服务器判 end 广播(scores 2 行)');
    await sleep(400);
    const recs = await fetch(`http://127.0.0.1:${ADMIN}/admin/records?limit=5`, { headers: HDR }).then(r => r.json());
    const rec = recs.records.find(x => x.room === ja.room);
    ok(rec && rec.mode === 'coop', 'coop end 落 battles.jsonl(mode coop)');
    b0.close();
    await sleep(300);
  }

  /* —— ①-⑤ dm 服务器权威主流程 —— */
  const c1 = await connect();
  c1.send(JSON.stringify({ t: 'create', name: '甲', tank: 'tiger1', token, pass: 'pw', proto: 2 }));
  const j1 = await wait(c1, 'joined');
  ok(j1.srvSimCap === true, 'joined 载荷带 srvSimCap 能力标记');
  const c2 = await connect();
  c2.send(JSON.stringify({ t: 'join', room: j1.room, pass: 'pw', name: '乙', tank: 'tiger1', proto: 2 }));
  const j2 = await wait(c2, 'joined');
  const room = j1.room;

  c1.send(JSON.stringify({ t: 'start', map: 'l01', mode: 'dm' }));
  const s1 = await wait(c1, 'start', 4000);
  const s2 = await wait(c2, 'start', 4000);
  ok(s1.srvSim === true && s2.srvSim === true, 'dm start 载荷带 srvSim=true(双端)');

  // ① 20Hz 快照 + tn 12 字段 + st 倒计
  const { got, snaps } = await collectSnaps(c2, 1000);
  ok(got >= 15, `20Hz 快照节拍 (1s 实测 ${got} 条, 期望 ≥15)`);
  const snap = snaps[snaps.length - 1];
  const rows = Object.values(snap.tn || {});
  ok(snap.tn && Object.keys(snap.tn).length === 2, 'tn 覆盖两辆参战车');
  ok(rows.every(r => r.length === 12 && r.every(v => typeof v === 'number' && Number.isFinite(v))), 'tn 行 12 字段全数值');
  ok(typeof snap.st === 'number' && snap.st > 170 && snap.st <= 180, `st 时限倒计 (st=${snap.st})`);
  ok(snap.sc && Object.keys(snap.sc).length === 2, 'sc 击杀表存在');

  // ② 输入驱动位移(c2 前进 2s)
  const myId = j2.you;
  const before = tnOf(c2, myId);
  await drive(c2, [1, 0, 0, 0, 0], 2000);
  const after = tnOf(c2, myId);
  const moved = before && after ? Math.hypot(after[0] - before[0], after[1] - before[1]) : 0;
  ok(moved > 0.5, `input 驱动本车位移 (实测 ${moved.toFixed(1)}m > 0.5)`);

  // ③ input clamp: 恶意值不炸、数值有界
  c2.queue = c2.queue.filter(m => m.t !== 'snap');
  await drive(c2, [99, 99, 1e9, 1e9, 1], 1200);
  const clamped = tnOf(c2, myId);
  ok(clamped && clamped.every(v => Number.isFinite(v)) && Math.abs(clamped[6]) < 60,
    `clamp 生效(油门99→速度有界 ${clamped ? clamped[6].toFixed(1) : '?'} m/s, 无 NaN)`);

  /* —— ④ 房主断线续战 —— */
  c2.queue = c2.queue.filter(m => m.t !== 'snap');
  c1.close();
  let dissolved = false;
  c2.on('message', (buf) => { try { if (JSON.parse(buf).t === 'err' && JSON.parse(buf).msg.includes('解散')) dissolved = true; } catch (e) { } });
  const kept = await collectSnaps(c2, 3000);
  ok(kept.got >= 40, `房主断线后快照仍持续 ≥3s (3s 实测 ${kept.got} 条, 期望 ≥40)`);
  ok(!dissolved, '无「房主已离开，房间解散」广播(对局继续)');

  /* —— ⑤ 服务器判 end + 落盘 —— */
  const endP = wait(c2, 'end', 6000);
  await fetch(`http://127.0.0.1:${ADMIN}/admin/srv-end?room=${room}`, { method: 'POST', headers: HDR });
  const end = await endP;
  ok(Array.isArray(end.scores) && end.scores.length === 2 && end.scores.every(r => r.length === 3), `服务器判 end 广播(scores ${end.scores.length} 行)`);
  await sleep(400);
  const recs = await fetch(`http://127.0.0.1:${ADMIN}/admin/records?limit=5`, { headers: HDR }).then(r => r.json());
  const rec = recs.records.find(x => x.room === room);
  ok(rec && rec.mode === 'dm' && rec.players.length === 2, 'end 落 battles.jsonl(记录含 mode/players)');
  // 房间复位可再战: 重新开局应再次带 srvSim
  c2.send(JSON.stringify({ t: 'start', map: 'l01', mode: 'dm' }));
  const s3 = await wait(c2, 'start', 4000);
  ok(s3.srvSim === true, '结算后房间复位, 可再次开局(仍 srvSim)');
  c2.close();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 异常:', e.message); process.exit(1); });
