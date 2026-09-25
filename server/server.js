#!/usr/bin/env node
// server.js — 钢铁前沿 内网对战服务器
// 一个进程三件事: ①静态托管 client/（局域网玩家浏览器直开） ②房间管理 ③消息路由（仅按房间转发）
// 游戏判定全部在房主浏览器（主机权威），本服务器不解析游戏数据。
// 用法: npm install && npm start [端口=8342]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8342', 10);
const ROOT = path.resolve(__dirname, '..', 'client');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.glb': 'model/gltf-binary', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon'
};

/* ---------- 房间 ---------- */
let nextPid = 1;
const rooms = new Map();   // code → { players: Map<ws→{id,name,tank,ready,host}> }

function roomState(room) {
  return [...room.players.entries()].map(([ws, p]) => ({ id: p.id, name: p.name, tank: p.tank, ready: p.ready, host: p.host, connected: true }));
}
function broadcast(room, msg, exceptWs) {
  const s = JSON.stringify(msg);
  for (const ws of room.players.keys())
    if (ws !== exceptWs && ws.readyState === 1) ws.send(s);
}
function genCode() {
  let c;
  do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c));
  return c;
}

/* ---------- HTTP 静态托管(内网 0.0.0.0) ---------- */
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404: ' + urlPath); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'Content-Length': data.length
    });
    res.end(data);
  });
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch (e) { return; }
    const room = ws._room;
    const me = room && room.players.get(ws);

    switch (m.t) {
      case 'create': {
        const code = genCode();
        const room0 = { players: new Map() };
        rooms.set(code, room0);
        ws._room = room0; ws._code = code;
        room0.players.set(ws, { id: nextPid, name: (m.name || '车长').slice(0, 12), tank: m.tank || 'sherman', ready: true, host: true });
        ws.send(JSON.stringify({ t: 'joined', room: code, you: nextPid, players: roomState(room0) }));
        nextPid++;
        console.log(`[房间${code}] 创建 by ${m.name}`);
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.room || ''));
        if (!r) { ws.send(JSON.stringify({ t: 'err', msg: '房间不存在' })); break; }
        if (r.started) { ws.send(JSON.stringify({ t: 'err', msg: '对战已开始' })); break; }
        if (r.players.size >= 8) { ws.send(JSON.stringify({ t: 'err', msg: '房间已满(8人)' })); break; }
        ws._room = r; ws._code = String(m.room);
        r.players.set(ws, { id: nextPid, name: (m.name || '车长').slice(0, 12), tank: m.tank || 'sherman', ready: false, host: false });
        ws.send(JSON.stringify({ t: 'joined', room: ws._code, you: nextPid, players: roomState(r) }));
        broadcast(r, { t: 'lobby', players: roomState(r) }, ws);
        nextPid++;
        console.log(`[房间${ws._code}] 加入 ${m.name}`);
        break;
      }
      case 'ready': {
        if (!me) break;
        me.ready = !!m.v;
        if (m.tank) me.tank = m.tank;
        broadcast(room, { t: 'lobby', players: roomState(room) });
        break;
      }
      case 'start': {          // 仅房主
        if (!me || !me.host) break;
        room.started = true;
        broadcast(room, { t: 'start', map: m.map, seed: Math.random(), players: roomState(room) });
        console.log(`[房间${ws._code}] 开战 ${m.map}`);
        break;
      }
      case 'input': {          // 客户端输入 → 只发给主机
        if (!me) break;
        const host = [...room.players.entries()].find(([, p]) => p.host);
        if (host && host[0] !== ws && host[0].readyState === 1) host[0].send(JSON.stringify(m));
        break;
      }
      case 'snap': case 'ev': case 'end': {   // 主机快照/事件/结算 → 广播给其他人
        if (!me || !me.host) break;
        broadcast(room, m, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws._room;
    if (!room) return;
    const me = room.players.get(ws);
    room.players.delete(ws);
    console.log(`[房间${ws._code}] 离开 ${me ? me.name : '?'}`);
    if (!room.players.size) { rooms.delete(ws._code); return; }
    if (me && me.host) {      // 主机掉线 → 房间解散
      broadcast(room, { t: 'err', msg: '房主已离开，房间解散' });
      for (const w of room.players.keys()) w.close();
      rooms.delete(ws._code);
      return;
    }
    broadcast(room, { t: 'lobby', players: roomState(room) });
  });

  // 心跳
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('钢铁前沿对战服务器已启动');
  console.log(`  页面地址(浏览器打开): http://127.0.0.1:${PORT}`);
  console.log(`  WebSocket 地址(填进客户端设置): ws://127.0.0.1:${PORT}`);
  for (const ip of ips) {
    console.log(`  内网页面:   http://${ip}:${PORT}`);
    console.log(`  内网 WS 地址: ws://${ip}:${PORT}  ← 其他玩家把这个填进游戏"联机设置"`);
  }
});
