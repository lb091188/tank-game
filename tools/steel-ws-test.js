#!/usr/bin/env node
// steel-ws-test.js — 阶段5 重写: 服务器权威协议回归(覆盖阶段3/4 权威路径) + 信令回归
//
// 阶段3/4 后架构: dm/coop 全部服务器权威(srvSim) —— 服务器 60Hz 跑车辆模拟(sim-engine)+coop AI,
// 20Hz 下发快照(tn 12 字段行), 客户端 30Hz 上行输入(clamp), 房主只是普通玩家(掉线不灭队);
// 旧协议(主机 relay input/snap/end)已退役: sim 房内客户端伪装主机包不采信。
// 必含三条新用例(阶段5 ask②): 房主中途断开后对局继续 / 快照由服务器下发 / 超幅 input 被 clamp。
// 其余: 钥匙/令牌门禁、proto 版本门禁(旧客户端拒+强刷提示)、建房/加入、昵称唯一、等级锚、
//       结算(admin srv-end)落盘+档案、令牌吊销、防爆破、垃圾输入容忍、未开局房解散语义保留。
// 注意: 「按昵称汇总档案」断言精确计数, 重跑前归档 server/records/battles.jsonl。
// 用法: 先起服 (cd server && node server.js 18342 18343), 再 node tools/steel-ws-test.js 18342 18343
'use strict';
const WebSocket = require('../server/node_modules/ws');

const PORT = process.argv[2] || '18342';
const ADMIN = process.argv[3] || (Number(PORT) + 1);
const URL = `ws://127.0.0.1:${PORT}`;
const HDR = { 'X-Steel-Admin': '1', 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
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
async function mint(uses = 30, ttl = 600) {
  const r = await fetch(`http://127.0.0.1:${ADMIN}/admin/key?uses=${uses}&ttl=${ttl}`, { method: 'POST', headers: HDR }).then(r => r.json());
  const rr = await fetch(`http://127.0.0.1:${PORT}/key/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: r.key }) }).then(r => r.json());
  return rr.token;
}
async function collectSnaps(ws, ms) {
  const before = ws.queue.filter(m => m.t === 'snap').length;
  await sleep(ms);
  const arr = ws.queue.filter(m => m.t === 'snap');
  return { got: arr.length - before, snaps: arr };
}

(async () => {
  console.log(`== 服务器权威协议回归 ${URL} (admin 127.0.0.1:${ADMIN}) ==`);
  const token = await mint();

  /* —— admin 基础 —— */
  {
    const no = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`).then(r => r.status);
    ok(no === 403, 'admin 无头被拒 (403)');
    const st = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`, { headers: HDR }).then(r => r.json());
    ok(st.ok && st.gated === true, 'admin status (gated=true)');
  }

  /* —— 钥匙: 次数 + 一次性耗尽 —— */
  {
    const k2 = await fetch(`http://127.0.0.1:${ADMIN}/admin/key?uses=3&ttl=600`, { method: 'POST', headers: HDR }).then(r => r.json());
    const rd = (key) => fetch(`http://127.0.0.1:${PORT}/key/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).then(r => r.json());
    const r1 = await rd(k2.key), r2 = await rd(k2.key), r3 = await rd(k2.key), r4 = await rd(k2.key);
    ok(r1.ok && r2.ok && r3.ok && r3.token !== r2.token, '钥匙 3 次兑换出 3 个不同令牌');
    ok(!r4.ok, '第 4 次兑换被拒 (次数用尽)');
    ok(!(await rd('ZZZZZZZZ')).ok, '野钥匙被拒');
  }

  /* —— proto 版本门禁(阶段5 新增): 旧客户端拒 + 升级提示 —— */
  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'create', name: '旧版客', token: token }));   // 无 proto → 旧客户端
    const e1 = await wait(ws, 'err');
    ok(e1.msg.includes('版本过旧') && e1.msg.includes('刷新'), '旧客户端建房被拒 + 升级提示(强刷)');
    ws.send(JSON.stringify({ t: 'create', name: '旧版客', token: token, proto: 1 }));
    const e2 = await wait(ws, 'err');
    ok(e2.msg.includes('版本过旧'), 'proto=1 同样被拒');
    ws.close();
  }

  /* —— 带密码建房 + 密码进房(proto=2) —— */
  const host = await connect();
  host.send(JSON.stringify({ t: 'create', name: '甲', tank: 'tiger2', token: token, pass: 'pw123', proto: 2 }));
  const joined = await wait(host, 'joined');
  const room = joined.room;
  ok(/^\d{4}$/.test(room), `建房成功 房间号 ${room}`);
  ok(joined.pass === 'pw123', 'joined 回显房间密码');
  ok(joined.srvSimCap === true && joined.proto === 2, 'joined 带 srvSimCap/proto 观测字段');
  ok(joined.players[0].host === true && joined.players[0].name === '甲', '建房者即房主');

  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'join', room, name: 'X' }));
    ok((await wait(ws, 'err')).msg === '房间密码错误', '无密码进房被拒');
    ws.close();
  }
  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'join', room: '9999', name: 'X' }));
    ok((await wait(ws, 'err')).msg === '房间不存在', '不存在房间被拒');
    ws.close();
  }

  const guest = await connect();
  guest.send(JSON.stringify({ t: 'join', room, pass: 'pw123', name: '乙', tank: 'tiger1', proto: 2 }));
  const j2 = await wait(guest, 'joined');
  ok(j2.you > joined.you && j2.players.length === 2, '凭房间号+密码加入成功');
  const lob = await wait(host, 'lobby');
  ok(lob.players.length === 2, '房主收到大厅更新');

  /* —— 准备 / 开局(服务器权威 dm… coop 均可, 此处 dm) —— */
  guest.send(JSON.stringify({ t: 'ready', v: true, tank: 'pz4' }));
  await wait(host, 'lobby');
  host.send(JSON.stringify({ t: 'start', map: '镇巷', mode: 'dm' }));
  const s1 = await wait(host, 'start'), s2 = await wait(guest, 'start');
  ok(s1.srvSim === true && s2.srvSim === true, '开局广播 srvSim=true(双端服务器权威)');

  /* —— 新用例1: 快照由服务器下发(20Hz, tn 12 字段) —— */
  const c0 = guest.queue.filter(m => m.t === 'snap').length;
  await sleep(1000);
  const snaps = guest.queue.filter(m => m.t === 'snap');
  ok(snaps.length - c0 >= 15, `服务器 20Hz 快照 (1s 实测 ${snaps.length - c0} 条, 期望 ≥15)`);
  const snap0 = snaps[snaps.length - 1];
  const rows = Object.values(snap0.tn || {});
  ok(rows.length === 2 && rows.every(r => r.length === 12 && r.every(v => typeof v === 'number' && Number.isFinite(v))), 'tn 两车 12 字段全数值');
  ok(snap0.st !== undefined && snap0.sc !== undefined, '快照带 st 时限 + sc 击杀表');

  /* —— 新用例2: 超幅 input 被 clamp(恶意值不炸、数值有界) —— */
  guest.send(JSON.stringify({ t: 'input', i: [99, 99, 1e9, 1e9, 1] }));
  await sleep(1200);
  const clamped = (guest.queue.filter(m => m.t === 'snap').pop() || { tn: {} }).tn[j2.you];
  ok(clamped && clamped.every(v => Number.isFinite(v)) && Math.abs(clamped[6]) < 60,
    `超幅 input 被 clamp (油门99 → 速度有界 ${clamped ? clamped[6].toFixed(1) : '?'} m/s, 无 NaN)`);

  /* —— 新用例3: 房主中途断开后对局继续 —— */
  host.close();
  let dissolved = false;
  guest.on('message', (buf) => { try { const m = JSON.parse(buf); if (m.t === 'err' && m.msg.includes('解散')) dissolved = true; } catch (e) { } });
  const kept = await collectSnaps(guest, 3000);
  ok(kept.got >= 40 && !dissolved, `房主断线后对局继续 (3s 快照 ${kept.got} 条≥40, 解散广播=${dissolved})`);

  /* —— 结算(服务器判) + 战斗记录 —— */
  const end = await (async () => {
    const p = wait(guest, 'end', 6000);
    await fetch(`http://127.0.0.1:${ADMIN}/admin/srv-end?room=${room}`, { method: 'POST', headers: HDR });
    return p;
  })();
  ok(Array.isArray(end.scores) && end.scores.length === 2, '服务器判 end 转发(scores 2 行)');
  await new Promise(r => setTimeout(r, 300));
  const recs = await fetch(`http://127.0.0.1:${ADMIN}/admin/records?limit=10`, { headers: HDR }).then(r => r.json());
  const rec = recs.records.find(x => x.room === room);
  ok(rec && rec.mode === 'dm' && rec.map === '镇巷', '战斗记录落盘 (地图/模式)');
  // 服务器权威: 结算时房主可能已断线离开(recordEnd 对中途离开者记 tank='?'), 断言名单而非车型
  ok(rec && rec.players.length === 2 && rec.players[0].name === '甲', '记录含用车名单(中途离开者 tank 记 ?)');
  ok(recs.records.filter(x => x.room === room).length === 1, '重复结算只记一次');

  /* —— 玩家档案 —— */
  const pls = await fetch(`http://127.0.0.1:${ADMIN}/admin/players`, { headers: HDR }).then(r => r.json());
  const me = pls.players.find(p => p.name === '甲');
  ok(me && me.games === 1 && me.wins === 0 && typeof me.kills === 'number', '按昵称汇总档案(强制结算 win=false)');

  /* —— 令牌吊销 —— */
  {
    await fetch(`http://127.0.0.1:${ADMIN}/admin/revoke?token=${token}`, { method: 'POST', headers: HDR });
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'create', name: '吊销后', token: token }));
    ok((await wait(ws, 'err')).msg.includes('通行令牌'), '吊销令牌建房被拒');
    ws.close();
  }

  /* —— 防爆破: 连续失败断连 —— */
  {
    const ws = await connect();
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ t: 'join', room: '9999', name: 'X' }));
    let last = null;
    for (let i = 0; i < 6; i++) last = await wait(ws, 'err');
    ok(last.msg.includes('断开'), '连续 5 次失败 → 通知断开');
    await new Promise(r => setTimeout(r, 500));
    ok(ws.closed === true, '连接已被服务器关闭');
  }

  /* —— 垃圾输入容忍 —— */
  {
    const ws = await connect();
    ws.send('not json'); ws.send('{}'); ws.send('{"t":"unknown"}');
    await new Promise(r => setTimeout(r, 200));
    ok(!ws.closed, '垃圾输入后连接仍存活');
    ws.close();
  }

  guest.close();
  await sleep(300);

  /* —— 未开局房: 房主解散语义保留(信令层) —— */
  {
    const h2 = await connect();
    h2.send(JSON.stringify({ t: 'create', name: '解散测', token: await mint(2), proto: 2 }));
    const jh = await wait(h2, 'joined');
    const g2 = await connect();
    g2.send(JSON.stringify({ t: 'join', room: jh.room, name: '解散乙', tank: 'pz4', proto: 2 }));
    await wait(g2, 'joined');
    h2.close();   // 未开局房无 sim → 房主解散语义保留
    const dis = await wait(g2, 'err');
    ok(dis.msg.includes('房主已离开'), '未开局房: 房主解散语义保留');
    g2.close();
  }

  await sleep(300);
  const st = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`, { headers: HDR }).then(r => r.json());
  ok(st.rooms === 0, '房间已清空');
  ok(st.srv && typeof st.srv.tickP95 === 'number' && typeof st.srv.tickSamples === 'number', `srv CPU 探针在 (p95 ${st.srv ? st.srv.tickP95 : '?'}ms)`);
  ok(typeof st.mem === 'number' && st.mem > 0, `内存探针在 (RSS ${st.mem}MB)`);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 异常:', e.message); process.exit(1); });
