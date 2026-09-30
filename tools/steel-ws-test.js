#!/usr/bin/env node
// steel-ws-test.js — 对战服务器协议回放测试: 房间密码 + 钥匙/令牌门禁 + 战斗记录 + admin
// 用法: 先起服务器 (cd server && node server.js 18342 18343), 再:
//       node tools/steel-ws-test.js [端口=8342] [管理端口=端口+1]
'use strict';
const WebSocket = require('../server/node_modules/ws');
const PORT = process.argv[2] || 8342;
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
// 等 type 消息 (先翻队列)
function wait(ws, t, timeout = 3000) {
  const i = ws.queue.findIndex(m => m.t === t);
  if (i >= 0) return Promise.resolve(ws.queue.splice(i, 1)[0]);
  return new Promise((res, rej) => {
    const p = { match: m => m.t === t, res };
    ws.pending.push(p);
    setTimeout(() => rej(new Error(`等 ${t} 超时`)), timeout);
  });
}
async function mint(uses = 3, ttl = 600) {
  const r = await fetch(`http://127.0.0.1:${ADMIN}/admin/key?uses=${uses}&ttl=${ttl}`, { method: 'POST', headers: HDR }).then(r => r.json());
  return r.key;
}
async function redeem(key) {
  return fetch(`http://127.0.0.1:${PORT}/key/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).then(r => r.json());
}

(async () => {
  console.log(`== 协议回放 ${URL} (admin 127.0.0.1:${ADMIN}) ==`);

  /* —— admin 基础 —— */
  {
    const no = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`).then(r => r.status);
    ok(no === 403, 'admin 无头被拒 (403)');
    const st = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`, { headers: HDR }).then(r => r.json());
    ok(st.ok && st.gated === true, 'admin status (gated=true)');
  }

  /* —— 钥匙: 次数 + 一次性耗尽 —— */
  const key = await mint(3);
  const r1 = await redeem(key), r2 = await redeem(key), r3 = await redeem(key), r4 = await redeem(key);
  ok(r1.ok && r2.ok && r3.ok && r3.token !== r2.token, '钥匙 3 次兑换出 3 个不同令牌');
  ok(!r4.ok, '第 4 次兑换被拒 (次数用尽)');
  ok(!(await redeem('ZZZZZZZZ')).ok, '野钥匙被拒');

  /* —— 建房门禁 —— */
  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'create', name: '无证' }));
    ok((await wait(ws, 'err')).msg.includes('通行令牌'), '无令牌建房被拒');
    ws.close();
  }
  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'create', name: '假证', token: 'deadbeef' }));
    ok((await wait(ws, 'err')).msg.includes('通行令牌'), '无效令牌建房被拒');
    ws.close();
  }

  /* —— 带密码建房 + 密码进房 —— */
  const host = await connect();
  host.send(JSON.stringify({ t: 'create', name: '甲', tank: 'tiger2', token: r1.token, pass: 'pw123' }));
  const joined = await wait(host, 'joined');
  const room = joined.room;
  ok(/^\d{4}$/.test(room), `建房成功 房间号 ${room}`);
  ok(joined.pass === 'pw123', 'joined 回显房间密码');
  ok(joined.players[0].host === true && joined.players[0].name === '甲', '建房者即房主');

  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'join', room, name: 'X' }));
    ok((await wait(ws, 'err')).msg === '房间密码错误', '无密码进房被拒');
    ws.close();
  }
  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'join', room, pass: 'WRONG', name: 'X' }));
    ok((await wait(ws, 'err')).msg === '房间密码错误', '错密码进房被拒');
    ws.close();
  }
  {
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'join', room: '9999', name: 'X' }));
    ok((await wait(ws, 'err')).msg === '房间不存在', '不存在房间被拒');
    ws.close();
  }

  const guest = await connect();
  guest.send(JSON.stringify({ t: 'join', room, pass: 'pw123', name: '乙', tank: 'wespe' }));
  const j2 = await wait(guest, 'joined');
  ok(j2.you > joined.you && j2.players.length === 2, '凭房间号+密码加入成功');
  const lob = await wait(host, 'lobby');
  ok(lob.players.length === 2, '房主收到大厅更新');

  /* —— 准备 / 开局 —— */
  guest.send(JSON.stringify({ t: 'ready', v: true, tank: 'wespe' }));
  const lob2 = await wait(host, 'lobby');
  ok(lob2.players.find(p => p.name === '乙').ready === true, '准备状态广播');
  host.send(JSON.stringify({ t: 'start', map: '镇巷', mode: 'coop' }));
  const s1 = await wait(host, 'start'), s2 = await wait(guest, 'start');
  ok(s1.map === '镇巷' && s2.mode === 'coop' && typeof s2.seed === 'number', '开局广播 (含房主回显)');
  ok(s2.players.length === 2, '开局携带玩家表');

  /* —— 输入路由 / 快照中继 —— */
  guest.send(JSON.stringify({ t: 'input', i: [1, 0, 0, 0, 0] }));
  const inp = await wait(host, 'input');
  ok(Array.isArray(inp.i), '客户端输入 → 只发主机');
  host.send(JSON.stringify({ t: 'snap', tn: { 1: [0, 0, 0, 0, 0, 0, 0, 0, 100, 1] }, st: 170 }));
  const snap = await wait(guest, 'snap');
  ok(snap.tn && snap.st === 170, '主机快照 → 广播他人');

  /* —— 结算 + 战斗记录 —— */
  host.send(JSON.stringify({ t: 'end', scores: [[joined.you, '甲', 7], [j2.you, '乙', 3]], win: true }));
  const end = await wait(guest, 'end');
  ok(Array.isArray(end.scores) && end.scores.length === 2, '结算转发');
  host.send(JSON.stringify({ t: 'end', scores: [[joined.you, '甲', 99]] }));
  await new Promise(r => setTimeout(r, 300));
  const recs = await fetch(`http://127.0.0.1:${ADMIN}/admin/records?limit=10`, { headers: HDR }).then(r => r.json());
  const rec = recs.records.find(x => x.room === room);
  ok(rec && rec.mode === 'coop' && rec.map === '镇巷' && rec.win === true, '战斗记录落盘 (地图/模式/胜负)');
  ok(rec && rec.players.length === 2 && rec.players[0].tank === 'tiger2' && rec.players[0].kills === 7, '记录含用车与击杀');
  ok(recs.records.filter(x => x.room === room).length === 1, '重复 end 只记一次');

  /* —— 玩家档案 —— */
  const pls = await fetch(`http://127.0.0.1:${ADMIN}/admin/players`, { headers: HDR }).then(r => r.json());
  const me = pls.players.find(p => p.name === '甲');
  ok(me && me.games === 1 && me.kills === 7 && me.wins === 1, '按昵称汇总档案');

  /* —— 令牌吊销 —— */
  {
    await fetch(`http://127.0.0.1:${ADMIN}/admin/revoke?token=${r3.token}`, { method: 'POST', headers: HDR });
    const ws = await connect();
    ws.send(JSON.stringify({ t: 'create', name: '吊销后', token: r3.token }));
    ok((await wait(ws, 'err')).msg.includes('通行令牌'), '吊销令牌建房被拒');
    ws.close();
  }

  /* —— 防爆破: 连续失败断连 —— */
  {
    const ws = await connect();
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ t: 'join', room: '9999', name: 'X' }));
    // 前 5 条是"房间不存在", 第 6 条才是断开通知
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

  /* —— 房主解散 —— */
  host.close();
  const dis = await wait(guest, 'err');
  ok(dis.msg.includes('房主已离开'), '房主掉线 → 广播解散');
  await new Promise(r => setTimeout(r, 300));
  const st = await fetch(`http://127.0.0.1:${ADMIN}/admin/status`, { headers: HDR }).then(r => r.json());
  ok(st.rooms === 0, '房间已清空');
  guest.close();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 异常:', e.message); process.exit(1); });
