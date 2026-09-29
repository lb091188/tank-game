#!/usr/bin/env node
// steel-ws-test.js — 联机服务器协议回放测试: 完整走一遍建房/邀请/准备/开局/路由/解散
// 同时适用于 Node 版(server/server.js)与 MoonBit 原生版(moonbit/), 用于两版行为对拍.
// 前提: cd server && npm install (需要 ws 库)
// 用法: node tools/steel-ws-test.js [端口=8342]
'use strict';
const WebSocket = require('../server/node_modules/ws');
const PORT = process.argv[2] || 8342;
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    ws.queue = [];      // 未被认领的消息
    ws.pending = [];    // { match(m), res }
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
// 等待一条 t 类型的消息 (先查缓存, 再挂匹配器; 不会吞消息)
function expect(ws, t, timeout = 3000) {
  return new Promise((res, rej) => {
    const hit = ws.queue.findIndex(m => m.t === t);
    if (hit >= 0) return res(ws.queue.splice(hit, 1)[0]);
    const p = { match: m => m.t === t, res };
    ws.pending.push(p);
    setTimeout(() => {
      const i = ws.pending.indexOf(p);
      if (i >= 0) { ws.pending.splice(i, 1); rej(new Error(`等待 ${t} 超时`)); }
    }, timeout);
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));

(async () => {
  console.log(`== 协议回放 ${URL} ==`);

  // 1. 建房
  const host = await connect();
  send(host, { t: 'create', name: '房主测试', tank: 'tiger2' });
  const joined = await expect(host, 'joined');
  ok(joined.room && /^\d{4}$/.test(joined.room), `建房返回 4 位房间码 (${joined.room})`);
  const hostId = joined.you;
  ok(hostId >= 1, `you 编号有效 (${hostId}, 进程级递增, 与 server.js 一致)`);
  ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(joined.invite || ''), `8 位邀请码 (${joined.invite})`);
  ok(Array.isArray(joined.players) && joined.players.length === 1 &&
     joined.players[0].host === true && joined.players[0].ready === true, '建房玩家行(host+ready)');
  ok(joined.players[0].name === '房主测试' && joined.players[0].tank === 'tiger2', '名字与车型正确');

  // 2. 用邀请码入房
  const client = await connect();
  send(client, { t: 'join', invite: joined.invite, name: '客户端甲', tank: 'sherman' });
  const cjoined = await expect(client, 'joined');
  const clientId = cjoined.you;
  ok(clientId > hostId, `入房 you 递增 (${clientId} > ${hostId})`);
  ok(cjoined.players.length === 2, '入房后 2 人');
  const lobby = await expect(host, 'lobby');
  ok(lobby.players.length === 2, '房主收到 lobby(2人)');
  ok(!('invite' in cjoined), '入房 joined 不带 invite 键');

  // 3. 邀请码一次性
  const s3 = await connect();
  send(s3, { t: 'join', invite: joined.invite, name: '冒用者' });
  const err1 = await expect(s3, 'err');
  ok(err1.msg === '邀请码无效或已被使用', `复用邀请码被拒 (${err1.msg})`);
  s3.close();

  // 4. 准备 + 换车 (双向 lobby)
  send(client, { t: 'ready', v: true, tank: 'is2' });
  const lobbyA = await expect(host, 'lobby');
  const me = lobbyA.players.find(p => p.id === clientId);
  ok(me && me.ready === true && me.tank === 'is2', '准备+换车状态正确');
  const lobbySelf = await expect(client, 'lobby');
  ok(lobbySelf.players.length === 2, '发送者自己也收到 lobby');

  // 5. 普通玩家加入/掉线 (在开局前)
  const c2s = await connect();
  send(host, { t: 'invite' });
  const inv2 = await expect(host, 'invite');
  send(c2s, { t: 'join', invite: inv2.code, name: '路人乙' });
  await expect(c2s, 'joined');
  const lobbyJoin = await expect(host, 'lobby');
  ok(lobbyJoin.players.length === 3, '第三人入房 lobby(3人)');
  c2s.close();
  const lobbyAfter = await expect(host, 'lobby');
  ok(lobbyAfter.players.length === 2 && lobbyAfter.players.every(p => p.connected), '掉线后 lobby 剔除(2人)');

  // 6. 非房主不能开局
  send(client, { t: 'start', map: 'l01' });
  await new Promise(r => setTimeout(r, 300));
  ok(client.queue.every(m => m.t !== 'start') && host.queue.every(m => m.t !== 'start'), '非房主 start 被忽略');

  // 7. 房主再备一张新邀请码 (开局后应失效), 然后开局
  send(host, { t: 'invite' });
  const inv3 = await expect(host, 'invite');
  send(host, { t: 'start', map: 'l01', mode: 'coop' });
  const startC = await expect(client, 'start');
  ok(startC.map === 'l01' && startC.mode === 'coop', '开局参数透传');
  ok(typeof startC.seed === 'number', `seed 是数字 (${startC.seed})`);
  ok(startC.players.length === 2, '开局带玩家表');

  // 8. 开局后入房被拒
  const late = await connect();
  send(late, { t: 'join', invite: inv3.code, name: '迟到者' });
  const errStarted = await expect(late, 'err');
  ok(errStarted.msg === '对战已开始', `开局后入房被拒 (${errStarted.msg})`);
  late.close();

  // 9. 输入路由: 客户端 input → 只到房主 (原文)
  const rawInput = `{"t":"input","id":${clientId},"i":[0.5,-0.25,1.234,0.05,1]}`;
  client.send(rawInput);
  const inp = await expect(host, 'input');
  ok(inp.id === clientId && JSON.stringify(inp.i) === '[0.5,-0.25,1.234,0.05,1]', 'input 数据完整');
  await new Promise(r => setTimeout(r, 200));
  ok(client.queue.every(m => m.t !== 'input'), 'input 不回环给发送者');

  // 10. 快照/事件: 房主 → 广播其他人
  send(host, { t: 'snap', st: 42, tn: { '1': [1, 2, 3, 0, 4, 5, 6, 7, 100, 1] } });
  const snap = await expect(client, 'snap');
  ok(snap.st === 42 && snap.tn['1'][0] === 1, '快照原样转发');
  send(host, { t: 'ev', k: 'kill', d: { id: 2 } });
  const ev = await expect(client, 'ev');
  ok(ev.k === 'kill', '事件原样转发');
  send(client, { t: 'snap', st: 1 });
  await new Promise(r => setTimeout(r, 200));
  ok(host.queue.every(m => m.t !== 'snap'), '非房主快照被忽略');

  // 11. 垃圾输入不崩
  host.send('not json'); host.send('{"t":123}'); host.send('{"t":"unknown"}');
  await new Promise(r => setTimeout(r, 300));
  ok(!host.closed && !client.closed, '垃圾输入后连接仍存活');

  // 12. 房主掉线 → 解散 (客户端收到 err 并被断开)
  host.close();
  const errDissolve = await expect(client, 'err', 5000);
  ok(errDissolve.msg === '房主已离开，房间解散', `解散广播 (${errDissolve.msg})`);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('等待断开超时')), 5000);
    client.on('close', () => { clearTimeout(t); res(); });
  });
  ok(true, '客户端被服务器断开');

  // 13. 解散后邀请码全部作废
  const fresh = await connect();
  send(fresh, { t: 'join', invite: inv3.code, name: '再迟到者' });
  const err2 = await expect(fresh, 'err');
  ok(err2.msg === '邀请码无效或已被使用', '解散后邀请码作废');
  fresh.close();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 异常:', e.message); process.exit(1); });
