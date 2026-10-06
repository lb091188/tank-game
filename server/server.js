#!/usr/bin/env node
// server.js — 钢铁前沿对战服务器
// 一个进程四件事:
//   ① 同源静态托管 client/ — 浏览器打开即玩, 联机自动连本服, 无需填地址
//   ② 房间管理: 房间号 + 房间密码(按需选填, 替代旧邀请码)
//   ③ 建房门禁: 一次性钥匙(次数+有效期) → 兑换成通行令牌(默认30天) → 才能建房
//   ④ 战斗记录 JSONL 落盘 + 127.0.0.1 管理端点 (curl 友好, 见 README)
// 游戏判定全部在房主浏览器 (主机权威), 本服务器不解析游戏数据。
//
// 用法: npm install && npm start [端口=8342] [管理端口=端口+1 | 0=关闭]
//   STEEL_OPEN=1 或 --open   关闭建房门禁 (局域网自由模式, 不验令牌)
//
// 管理端点速查 (全部要求头 X-Steel-Admin: 1):
//   POST /admin/key?uses=5&ttl=86400   铸造钥匙 (次数/秒数, 默认 5 次 24 小时)
//   GET  /admin/status                 房间/玩家/记录概况
//   GET  /admin/keys                   未用完的钥匙 + 在役令牌
//   POST /admin/revoke?token=xxx       吊销令牌
//   GET  /admin/records?limit=50       最近战斗记录
//   GET  /admin/players                按昵称汇总战绩
//   POST /admin/srv-end?room=CODE      强制结束服务器权威对局(dm srvSim, 结算照常落盘)
//   GET  /admin/                       内置管理页 (浏览器用)
// 玩家端点 (游戏端口, 公开):
//   POST /key/redeem   {key:"XXXX"}    钥匙兑换通行令牌
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8342', 10);
const ADMIN_PORT = parseInt(process.argv[3] ?? process.env.ADMIN_PORT ?? String(PORT + 1), 10);
const OPEN = process.env.STEEL_OPEN === '1' || process.argv.includes('--open');
const ROOT = path.resolve(__dirname, '..', 'client');
const RECORDS_DIR = path.join(__dirname, 'records');
const RECORDS_FILE = path.join(RECORDS_DIR, 'battles.jsonl');
const TOKEN_TTL = 30 * 86400 * 1000;   // 通行令牌 30 天
const MAX_JOIN_FAILS = 5;              // 连续进房/建房失败次数 → 断开 (防爆破)
const MAX_PLAYERS = 20;                // 单房人数上限 (j4005/8G 容量: 中继为主, 快照带宽按 4 房×20 人预算)
const MAX_ROOMS = 4;                   // 同时在线房间上限 (40Mbps 出向 ≈ 16Mbps 满载快照, 留一半余量)

/* ---------- 坦克等级表 (与客户端 config.js 同源, 供等级匹配校验) ---------- */
// vm 沙箱执行 client/js/config.js → window.SF.CFG.vehicles; 解析失败则退化为不校验
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11 };
const TIER_SPREAD = 1;                 // 等级匹配: 房主车位 ±1 级可入
const TIERS = (() => {
  try {
    const ctx = { console };
    ctx.window = ctx;                  // window 指向自身 → window.SF 即全局 SF
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'), ctx);
    const out = {};
    for (const [id, v] of Object.entries(ctx.SF.CFG.vehicles || {}))
      if (v.tier && ROMAN[v.tier]) out[id] = ROMAN[v.tier];
    console.log(`等级表: ${Object.keys(out).length} 辆车 (匹配规则 ±${TIER_SPREAD} 级)`);
    return out;
  } catch (e) {
    console.warn(`等级表解析失败, 等级匹配停用: ${e.message}`);
    return {};
  }
})();
const tierOf = (tank) => TIERS[tank] || null;

/* ---------- 服务器权威仿真(阶段3): 游戏脚本上下文 + 地图数据 + 60Hz 房间 tick ----------
   dm 房开局(start)即建 SrvSim 实例: 主线程 60Hz 跑车辆数值模拟(sim-engine)+部位 OBB 判伤(阶段2),
   20Hz 广播与房主快照同构的 tn 12 字段行(客户端 net.js interpolate 零改动); coop 房不建 sim,
   沿用房主中继(评审修改要求#4: srvSim 仅 dm, coop 阶段4 再扩, 中继路径保留即旧版回退保证)。 */
// 脚本源读一次, 每房独立 vm 上下文: coop 的 SF.AI 会在 SF.Bus 挂无线电监听、SF.Game 指向本房
// world —— 多房共享单上下文会跨房串台(无线电互听/AI 目标串房), 故一房一上下文(4 房 × 数 MB 可控)。
const GAME_SCRIPTS = ['simcore.js', 'config.js', 'ai.js', 'sim-engine.js', 'srv-sim.js']
  .map(f => ({ f, src: fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') }));
function newGameCtx() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const { f, src } of GAME_SCRIPTS) vm.runInContext(src, ctx, { filename: f });
  ctx.SF.Game = { get world() { return ctx.__world || null; } };   // AI nowT/world2time 取时/取世界钩子(ai-worker.js:29 同款)
  if (!GAME) { GAME = ctx.SF; console.log(`[srv-sim] 游戏脚本上下文就绪 (${Object.keys(GAME.CFG.vehicles).length} 车, partBoxes ${GAME.CFG.partBoxes ? Object.keys(GAME.CFG.partBoxes).length : 0} 型)`); }
  return ctx;
}
let GAME = null;   // 首个上下文的 SF(仅用于 CFG.maps 查表)
// 高程 PNG16 手解(zlib, tools/sim-headless.js 同款) + map.json, 按图缓存
const mapDataCache = new Map();
function loadMapData(mapKey) {
  const SFg = GAME || newGameCtx().SF;
  const meta = SFg.CFG.maps.find(m => m.id === mapKey || m.name === mapKey) || SFg.CFG.maps[0];
  if (mapDataCache.has(meta.id)) return mapDataCache.get(meta.id);
  const dir = path.join(ROOT, 'assets', 'maps', meta.dir);
  const J = JSON.parse(fs.readFileSync(path.join(dir, 'map.json'), 'utf8'));
  const b = fs.readFileSync(path.join(dir, 'heightmap.png'));
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < b.length) {
    const l = b.readUInt32BE(p), ty = b.toString('ascii', p + 4, p + 8);
    if (ty === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (ty === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + l));
    p += 12 + l;
  }
  const raw = require('zlib').inflateSync(Buffer.concat(idat));
  const heights = new Float32Array(w * h);
  const st = w * 2;
  for (let j = 0; j < h; j++) {
    const ft = raw[j * (st + 1)], row = j * (st + 1) + 1;
    for (let i = 0; i < w; i++) {
      const x = i * 2;
      const a = i >= 1 ? ((raw[row + x - 2] << 8) | raw[row + x - 1]) : 0;
      const b2 = j >= 1 ? ((raw[row - (st + 1) + x] << 8) | raw[row - (st + 1) + x + 1]) : 0;
      const c = (j >= 1 && i >= 1) ? ((raw[row - (st + 1) + x - 2] << 8) | raw[row - (st + 1) + x - 1]) : 0;
      let v = (raw[row + x] << 8) | raw[row + x + 1];
      if (ft === 1) v += a; else if (ft === 2) v += b2; else if (ft === 3) v += (a + b2) >> 1;
      else if (ft === 4) {
        const pp = a + b2 - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b2 : c);
      }
      heights[j * w + i] = v / 65535 * J.terrain.maxHeight;
    }
  }
  const data = { heights, terrainCfg: J.terrain, coversRaw: J.covers, waves: J.waves || [], repairBetweenWaves: J.repairBetweenWaves || null };
  mapDataCache.set(meta.id, data);
  console.log(`[srv-sim] 地图数据 ${meta.id}(${meta.dir}): ${w}x${h} 高程, ${J.covers.length} 掩体`);
  return data;
}
// 60Hz 房间 tick(单一定时器驱动全部 sim 房; 20Hz 广播快照; tick 时长进 p95 窗口供 admin 探针)
const srvStats = { ticks: [] };
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.sim || room.started !== true) continue;
    const dt = Math.min(0.05, Math.max(0.001, (now - (room.simLast || now)) / 1000));
    room.simLast = now;
    const t0 = process.hrtime.bigint();
    try { room.sim.tick(dt); } catch (e) {
      console.error(`[房间${ws_code_of(room)}] sim 异常, 强制结算: ${e.message}
${(e.stack || "").slice(0, 600)}`);
      finishSrvRoom(room); continue;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    srvStats.ticks.push(ms);
    if (ms > 12 && !room._budgetWarned) {   // 60Hz 预算 16ms: 连续超 12ms 举报一次(评审#10: 不达标才上 worker_threads)
      room._budgetWarned = true;
      console.warn(`[房间${ws_code_of(room)}] tick 超预算 ${ms.toFixed(1)}ms (>12ms) — 满员开火场景, 建议评估 per-room worker_threads`);
    }
    if (srvStats.ticks.length > 600) srvStats.ticks.splice(0, srvStats.ticks.length - 600);
    if (++room._snapN >= 3) {   // 60Hz tick → 20Hz 快照(3 分频)
      room._snapN = 0;
      broadcast(room, room.sim.snapshot());
    }
    if (room.sim && room.sim.finished) finishSrvRoom(room);   // onEnd 回调可能已置空 sim
  }
}, 15).unref();
function ws_code_of(room) { for (const [code, r] of rooms) if (r === room) return code; return '?'; }
function tickP95() {
  if (!srvStats.ticks.length) return 0;
  const a = srvStats.ticks.slice().sort((x, y) => x - y);
  return Math.round(a[Math.floor(a.length * 0.95)] * 100) / 100;
}
function finishSrvRoom(room) {   // 服务器判 end: 广播结算 + 落盘 + 房间复位可再战
  if (!room.sim || room.ended) return;
  room.ended = true;
  const scores = room.sim.scoreRows();
  const m = { t: 'end', scores, win: false };
  broadcast(room, m);
  recordEnd(room, ws_code_of(room), m);
  room.sim = null; room.started = false; room.gameCtx = null;
  for (const q of room.players.values()) q.ready = q.host;
  broadcast(room, lobbyMsg(room));
  console.log(`[房间${ws_code_of(room)}] 服务器结算 — ${scores.map(([id, name, k]) => `${name} ${k}杀`).join(', ')}; 房间保留, 可再次开局`);
}

/* ---------- 模型表 (与客户端 assets.js MODEL_FILES 同源: 有 glb 才可上场) ---------- */
const MODELS = (() => {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'assets.js'), 'utf8');
    const m = src.match(/MODEL_FILES\s*=\s*\{([\s\S]*?)\}/);
    const out = new Set();
    for (const mm of m[1].matchAll(/:\s*'([\w-]+)'/g)) out.add(mm[1]);   // 值=车型 id, 键=glb 文件名
    // 有配置数据没模型的半成品车: 启动点名(运行时会被消毒回默认车)
    const missing = Object.keys(TIERS).filter(k => !out.has(k));
    console.log(`模型表: ${out.size} 辆有模型` + (missing.length ? `; 缺模型(不可选): ${missing.join(',')}` : ''));
    return out;
  } catch (e) {
    console.warn('模型表解析失败, 消毒停用:', e.message);
    return null;
  }
})();
// 车型消毒: 未知/无模型的 id 一律回默认车(客户端存档可能来自旧版本)
const saneTank = (t, fallback) => (t && MODELS && MODELS.has(t) ? t : (fallback || 'sherman'));

/* ---------- 钥匙与通行令牌 ---------- */
// 钥匙: 8 位随机串(去易混字符), 按次数+有效期铸造, 团队可多人共用一把
const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const keys = new Map();     // key → { uses, expires }
const tokens = new Map();   // token → { expires, created }

function genKey() {
  for (;;) {
    let c = '';
    for (const b of crypto.randomBytes(8)) c += ALPH[b % ALPH.length];
    if (!keys.has(c)) return c;
  }
}
function mintKey(uses, ttlSec) {
  const k = genKey();
  keys.set(k, { uses: Math.max(1, uses | 0), expires: Date.now() + ttlSec * 1000 });
  return k;
}
// 兑换: 有效则次数-1, 次数归零销毁; 返回新令牌
function redeemKey(raw) {
  const k = String(raw || '').trim().toUpperCase();
  const e = keys.get(k);
  if (!e) return { error: '钥匙无效或已用完' };
  if (Date.now() > e.expires) { keys.delete(k); return { error: '钥匙已过期' }; }
  e.uses -= 1;
  if (e.uses <= 0) keys.delete(k);
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { expires: Date.now() + TOKEN_TTL, created: Date.now() });
  return { token, expires: Date.now() + TOKEN_TTL };
}
function tokenOk(t) {
  const e = tokens.get(String(t || ''));
  if (!e) return false;
  if (Date.now() > e.expires) { tokens.delete(t); return false; }
  return true;
}
// 过期清扫 (钥匙/令牌都不攒垃圾)
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of keys) if (now > e.expires) keys.delete(k);
  for (const [t, e] of tokens) if (now > e.expires) tokens.delete(t);
}, 10 * 60 * 1000).unref();

/* ---------- 房间 ---------- */
let nextPid = 1;
const rooms = new Map();    // code → { players:Map<ws,p>, started, ended, map, mode, pass }

function roomState(room) {
  return [...room.players.entries()].map(([ws, p]) => ({ id: p.id, name: p.name, tank: p.tank, ready: p.ready, host: p.host, team: p.team, connected: true }));
}
// 大厅广播统一载荷(名单+等级锚+模式), 各处共用
function lobbyMsg(room) { return { t: 'lobby', players: roomState(room), tier: room.tier, mode: room.mode }; }
// 阵营平衡: 加入人数少的一方(平局进红方)
function balancedTeam(room) {
  let r = 0, b = 0;
  for (const p of room.players.values()) (p.team === 1 ? b++ : r++);
  return r <= b ? 0 : 1;
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

/* ---------- 等级匹配 ---------- */
// 房间以房主建车位锚定 tier, 其他人(含房主自己换车)只允许 ±TIER_SPREAD 级; 房主换车不重锚(避免中途改门槛把已入房者变非法)
const tierName = (n) => Object.keys(ROMAN).find(k => ROMAN[k] === n) || '?';
function tierCheck(room, tank, ws) {
  if (!room.tier || !TIERS[tank]) return null;         // 房间无锚或车不在等级表(自定义) → 不限制
  const t = TIERS[tank];
  if (Math.abs(t - room.tier) > TIER_SPREAD)
    return `等级不符 — 本房间 ${tierName(room.tier)} 级 ±${TIER_SPREAD}(即 ${tierName(Math.max(1, room.tier - TIER_SPREAD))}~${tierName(room.tier + TIER_SPREAD)}), 当前车 ${tierName(t)} 级, 请在大厅换车`;
  return null;
}

/* ---------- 昵称唯一 ---------- */
// 昵称规范化: 折叠空白+去首尾+限12字
const normName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 12);
// 全服在线昵称查重(忽略大小写): 一个昵称只允许一处在线; exceptWs=换房时排除自己
function nameOnline(name, exceptWs) {
  const want = name.toLowerCase();
  for (const r of rooms.values())
    for (const [ws, p] of r.players.entries())
      if (ws !== exceptWs && p.name.toLowerCase() === want) return true;
  return false;
}
// 离房清理: 建房/加入前把本连接从旧房间移出(一个连接同一时刻只占一个房间一个昵称);
// 房主离房 → 房间解散(与掉线同规则)
function leaveRoom(ws) {
  const room = ws._room;
  if (!room) return;
  const me = room.players.get(ws);
  room.players.delete(ws);
  if (me && me.host && !room.sim) {
    // 房主权威房(中继/coop): 房主掉线 = 灭队(旧语义)
    broadcast(room, { t: 'err', msg: '房主已离开，房间解散' });
    for (const w of room.players.keys()) w.close();
  } else if (me && me.host && room.sim) {
    // 服务器权威房: 房主只是普通玩家, 掉线/离开对局继续(本次迁移要消除的行为), 提升新 host 保再战
    const next = room.players.keys().next();
    if (!next.done) { const pw = room.players.get(next.value); if (pw) pw.host = true; broadcast(room, lobbyMsg(room)); }
  } else if (room.players.size) {
    broadcast(room, lobbyMsg(room));
  }
  if (!room.players.size) { rooms.delete(ws._code); if (room.sim) room.sim = null; }
  ws._room = null;
}

/* ---------- 战斗记录 ---------- */
let recordCount = 0;
function initRecords() {
  fs.mkdirSync(RECORDS_DIR, { recursive: true });
  try {
    recordCount = fs.readFileSync(RECORDS_FILE, 'utf8').split('\n').filter(l => l.trim()).length;
  } catch (e) { /* 首次运行无文件 */ }
  console.log(`战斗记录: ${RECORDS_FILE} (${recordCount} 条)`);
}
// 主机 end 消息 → 一行 JSON; 名单以 scores 为准, tank 查房间登记(中途离开记 '?')
function recordEnd(room, code, m) {
  const players = (Array.isArray(m.scores) ? m.scores : []).map(row => {
    if (!Array.isArray(row) || row.length < 3) return null;
    const id = row[0], name = row[1], kills = row[2] | 0;
    const p = [...room.players.values()].find(p => p.id === id);
    return { name: String(name).slice(0, 12), tank: p ? p.tank : '?', kills, host: p ? p.host : false };
  }).filter(Boolean);
  const line = JSON.stringify({
    time: Date.now(), room: code, mode: room.mode || 'dm', map: room.map || '',
    win: !!m.win, players,
    feed: (room.feed || []).slice(0, 100)   // 击杀时间线(相对开战秒): [{t, killer, victim}]
  });
  fs.appendFile(RECORDS_FILE, line + '\n', () => { });
  recordCount++;
}

/* ---------- HTTP: 同源静态托管 + 钥匙兑换 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
function readBody(req) {
  return new Promise(res => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 4096) req.destroy(); });
    req.on('end', () => res(b));
  });
}
const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  // 玩家钥匙兑换 (POST /key/redeem, 支持 JSON 体或 ?key= 查询参数)
  if (urlPath === '/key/redeem' && req.method === 'POST') {
    const body = await readBody(req);
    let key = '';
    try { const j = JSON.parse(body || '{}'); key = j.key || ''; } catch (e) { key = ''; }
    key = key || new URL(req.url, 'http://x').searchParams.get('key') || '';
    const r = redeemKey(key);
    res.writeHead(r.token ? 200 : 403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(r.token ? { ok: true, token: r.token, expires: r.expires } : { ok: false, error: r.error }));
    console.log(`[钥匙] 兑换 ${key} → ${r.token ? '成功' : r.error}`);
    return;
  }
  // 静态文件: 引导文件不缓存, 带版本戳资源长缓存 (URL 变即失效)
  const hasV = /[?&]v=/.test(req.url);
  let p = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404: ' + p);
      return;
    }
    const cache = (p === '/index.html' || p === '/version.txt') ? 'no-store'
      : hasV ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache, 'Content-Length': data.length
    });
    res.end(data);
  });
});

/* ---------- WebSocket: 房间信令与中继 ---------- */
const wss = new WebSocketServer({ server });
const sendJson = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
// 连续失败 (房间不存在/密码错/令牌无效) 达到上限 → 断开, 防穷举
function fail(ws, msg) {
  sendJson(ws, { t: 'err', msg });
  ws._fails = (ws._fails || 0) + 1;
  if (ws._fails >= MAX_JOIN_FAILS) {
    sendJson(ws, { t: 'err', msg: '失败次数过多, 连接已断开' });
    setTimeout(() => ws.close(), 100);
  }
  return false;
}

wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch (e) { return; }
    const room = ws._room;
    const me = room && room.players.get(ws);

    switch (m.t) {
      case 'create': {
        if (!OPEN && !tokenOk(m.token)) { fail(ws, '建房需要通行令牌 — 请先在联机大厅用钥匙授权'); break; }
        if ((parseInt(m.proto || '0', 10) || 0) < 3) {   // 协议版本门禁(设计 §6.3 强升): ≥3 = 快照 14 字段含 bodyPitch/bodyRoll; 旧客户端 err→alert→reload 拉新包
          fail(ws, '客户端版本过旧 — 请强制刷新页面(Ctrl+Shift+R)后重进(服务器权威战斗)'); break;
        }
        if (rooms.size >= MAX_ROOMS) { fail(ws, `服务器满载(${MAX_ROOMS} 个房间对局中), 请稍后再试`); break; }
        const name = normName(m.name);
        if (!name) { fail(ws, '请先填写昵称'); break; }
        if (nameOnline(name, ws)) { fail(ws, `昵称「${name}」已在线 — 一人一名, 请换一个`); break; }
        ws._fails = 0;
        leaveRoom(ws);
        const tank = saneTank(m.tank);
        if (m.tank && tank !== m.tank) console.log(`[消毒] ${name} 请求不可用车型 ${m.tank} → ${tank}`);
        const code = genCode();
        const room0 = { players: new Map(), started: false, ended: false, map: '', mode: 'dm', pass: String(m.pass || '').trim().slice(0, 24), tier: tierOf(tank), feed: [] };
        rooms.set(code, room0);
        ws._room = room0; ws._code = code;
        room0.players.set(ws, { id: nextPid, name, tank, ready: true, host: true, team: 0 });
        sendJson(ws, { t: 'joined', room: code, you: nextPid, players: roomState(room0), pass: room0.pass || undefined, tier: room0.tier, mode: room0.mode, srvSimCap: true, proto: 3 });
        nextPid++;
        console.log(`[房间${code}] 创建 by ${m.name}${room0.pass ? ' (带密码)' : ''} (${rooms.size}/${MAX_ROOMS} 房)`);
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.room || '').trim());
        if (!r) { fail(ws, '房间不存在'); break; }
        if (r.pass && String(m.pass || '') !== r.pass) { fail(ws, '房间密码错误'); break; }
        const name = normName(m.name);
        if (!name) { fail(ws, '请先填写昵称'); break; }
        if (nameOnline(name, ws)) { fail(ws, `昵称「${name}」已在线 — 一人一名, 请换一个`); break; }
        const tank = saneTank(m.tank);
        if (m.tank && tank !== m.tank) console.log(`[消毒] ${name} 请求不可用车型 ${m.tank} → ${tank}`);
        if ((parseInt(m.proto || '0', 10) || 0) < 3) {   // 协议版本门禁(同 create; ≥3 = 快照 14 字段)
          fail(ws, '客户端版本过旧 — 请强制刷新页面(Ctrl+Shift+R)后重进(服务器权威战斗)'); break;
        }
        const tErr = tierCheck(r, tank, ws);   // 等级匹配: 房主车位 ±1 级(按消毒后的车)
        if (tErr) { fail(ws, tErr); break; }
        ws._fails = 0;
        if (r.started) { sendJson(ws, { t: 'err', msg: '对战已开始' }); break; }
        if (r.players.size >= MAX_PLAYERS) { sendJson(ws, { t: 'err', msg: `房间已满(${MAX_PLAYERS}人)` }); break; }
        leaveRoom(ws);
        ws._room = r; ws._code = String(m.room).trim();
        r.players.set(ws, { id: nextPid, name, tank, ready: false, host: false, team: r.mode === 'coop' ? 0 : balancedTeam(r) });
        sendJson(ws, { t: 'joined', room: ws._code, you: nextPid, players: roomState(r), tier: r.tier, mode: r.mode, srvSimCap: true, proto: 3 });
        broadcast(r, lobbyMsg(r), ws);
        nextPid++;
        console.log(`[房间${ws._code}] 加入 ${m.name} (红${[...r.players.values()].filter(p => p.team === 0).length}/蓝${[...r.players.values()].filter(p => p.team === 1).length})`);
        break;
      }
      case 'mode': {           // 房主切模式(未开局时): 死斗=双阵营, 合作=同阵营
        if (!me || !me.host || room.started) break;
        const mode = m.mode === 'coop' ? 'coop' : 'dm';
        if (mode === room.mode) break;
        room.mode = mode;
        if (mode === 'coop') for (const p of room.players.values()) p.team = 0;
        broadcast(room, lobbyMsg(room));
        console.log(`[房间${ws._code}] 模式 → ${mode === 'coop' ? '合作闯关' : '阵营死斗'}`);
        break;
      }
      case 'team': {           // 死斗模式自选阵营(未开局时); 合作固定同阵营
        if (!me || room.started) break;
        if (room.mode === 'coop') { sendJson(ws, { t: 'err', msg: '合作模式全队同阵营' }); break; }
        const t = m.v === 1 ? 1 : 0;
        if (me.team !== t) { me.team = t; me.ready = false; }   // 换阵营视为未准备(房主除外, 恒就绪)
        if (me.host) me.ready = true;
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'leave': {          // 主动离房回大厅(区别于掉线: 客户端留在小大厅界面)
        if (!me) break;
        leaveRoom(ws);
        sendJson(ws, { t: 'left' });
        break;
      }
      case 'ready': {
        if (!me) break;
        me.ready = !!m.v;
        if (m.tank && m.tank !== me.tank) {   // 换车: 先消毒再过等级匹配(不合法保持原车并回错误)
          const want = saneTank(m.tank, me.tank);
          if (want !== m.tank) { sendJson(ws, { t: 'err', msg: `车型不可用(${m.tank}), 请另选` }); }
          else {
            const tErr = tierCheck(room, want, ws);
            if (tErr) { sendJson(ws, { t: 'err', msg: tErr }); }
            else {
              me.tank = want;
              if (me.host) console.log(`[房间${ws._code}] 房主换车 → ${want} (房间等级仍锚定 ${tierName(room.tier)})`);
            }
          }
        }
        broadcast(room, lobbyMsg(room));
        break;
      }
      case 'start': {          // 仅房主; 登记地图/模式供战斗记录用
        if (!me || !me.host) break;
        room.started = true; room.ended = false;
        room.map = m.map || ''; room.mode = m.mode && m.mode !== room.mode ? m.mode : room.mode;
        if (room.mode === 'coop') for (const q of room.players.values()) q.team = 0;   // coop 全员同阵营(与 mode 处理器同语义; 直发 start 的旧流程未切模式时兜底)
        room.feed = []; room.startedAt = Date.now();
        const srvSim = true;   // 阶段4: dm+coop 全服务器权威(阶段3 已定: 客户端包不采信, 回退=部署回滚)
        const seed = (Math.random() * 4294967296) >>> 0;   // 唯一随机源: 广播给客户端(出生池占位推导) + 权威 sim 共用同一颗
        broadcast(room, { t: 'start', map: room.map, mode: room.mode, seed, players: roomState(room), srvSim });
        if (srvSim) {
          // 服务器权威: 建仿真房实例(60Hz tick 由全局定时器驱动), 房主/客户端全员走幽灵路径
          const md = loadMapData(room.map || 'l01');
          room.gameCtx = newGameCtx();
          room.sim = room.gameCtx.SF.SrvSim.create({
            heights: md.heights, terrainCfg: md.terrainCfg, coversRaw: md.coversRaw,
            waves: md.waves, repairWaves: md.repairBetweenWaves,
            hasModel: (k) => MODELS.has(k),
            mode: room.mode,
            seed, timeLimit: 180,   // 与 start 广播同一颗 seed(权威端不二次取随机)
            players: roomState(room).map(pl => ({ id: pl.id, name: pl.name, tank: pl.tank, team: pl.team })),
            onEvent: (k, d) => {
              if (k === 'kill' && room.startedAt) {   // 击杀时间线(与中继路径同口径)
                const idOf = (id) => { const q = [...room.players.values()].find(p => p.id === id); return q ? q.name : `#${id}`; };
                const rel = ((Date.now() - room.startedAt) / 1000) | 0;
                room.feed.push({ t: rel, killer: d.by ? idOf(d.by) : '环境', victim: idOf(d.id) });
                console.log(`[房间${ws._code}] ${rel}s 击杀: ${d.by ? idOf(d.by) : '环境'} → ${idOf(d.id)}`);
              }
              // 引擎事件 → 线协议形状(main.js bindMpRelay 客户端还原所依赖的字段):
              // fire 事件引擎侧为 {tank,pos,dir}, 线上要 {id, p:[x,y,z]}; hit/kill/aiWave/pkGet 判官已按线协议产出;
              // 其余引擎内部事件(如 reloaded——装填完成, d.tank 循环引用)只属本地表现, 客户端 coop 由快照对账, 不出线
              const KNOWN = { fire: 1, hit: 1, kill: 1, aiWave: 1, pkGet: 1 };
              if (!KNOWN[k]) return;
              let wire = d;
              if (k === 'fire') wire = { id: d.tank.netId, p: [+d.pos.x.toFixed(1), +d.pos.y.toFixed(1), +d.pos.z.toFixed(1)] };
              broadcast(room, { t: 'ev', k, d: wire });
            },
            onEnd: () => finishSrvRoom(room),
          });
          room.gameCtx.__world = room.sim.world || null;   // AI 直读本实例世界的钩子
          room.gameCtx.__shellTrace = [];   // 弹道追踪(admin srv-dbg 读; 默认空数组=未启用零开销)
          room.simLast = Date.now(); room._snapN = 0;
        }
        const red = [...room.players.values()].filter(p => p.team === 0).length;
        console.log(`[房间${ws._code}] 开战 ${room.map} (${room.mode}${srvSim ? '/srvSim' : ''}) 红${red}/蓝${room.players.size - red} — ${[...room.players.values()].map(p => `${p.name}(${p.tank})`).join(', ')}`);
        break;
      }
      case 'input': {          // sim 房: 服务器判(30Hz 5 元组 + clamp); 中继房: 只发给主机
        if (!me) break;
        if (room.sim) { room.sim.setInput(me.id, m.i); break; }
        const host = [...room.players.entries()].find(([, p]) => p.host);
        if (host && host[0] !== ws && host[0].readyState === 1) host[0].send(JSON.stringify(m));
        break;
      }
      case 'snap': case 'ev': case 'end': {   // 主机快照/事件/结算 → 广播
        if (!me || !me.host) break;
        if (room.sim) break;   // 服务器权威房: 快照/事件/结算由 sim 出, 客户端包不采信(旧版回退=部署回滚)
        // 击杀时间线: 控制台即时一行 + 进战斗记录(相对开战秒数)
        if (m.t === 'ev' && m.k === 'kill' && room.startedAt) {
          const idOf = (id) => { const q = [...room.players.values()].find(p => p.id === id); return q ? q.name : `#${id}`; };
          const rel = ((Date.now() - room.startedAt) / 1000) | 0;
          room.feed.push({ t: rel, killer: idOf(m.d.by), victim: idOf(m.d.id) });
          console.log(`[房间${ws._code}] ${rel}s 击杀: ${m.d.by ? idOf(m.d.by) : '环境'} → ${idOf(m.d.id)}`);
        }
        broadcast(room, m, ws);
        if (m.t === 'end' && !room.ended) {
          room.ended = true;
          recordEnd(room, ws._code, m);
          // 赛后房间复位: 保留成员回车库再战, 未准备态重新集结(房主恒就绪)
          room.started = false;
          for (const q of room.players.values()) q.ready = q.host;
          broadcast(room, lobbyMsg(room));
          console.log(`[房间${ws._code}] 结算 — ${(m.scores || []).map(([id, name, k]) => `${name} ${k}杀`).join(', ')}; 房间保留, 可再次开局`);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws._room;
    if (!room) return;
    const me = room.players.get(ws);
    leaveRoom(ws);
    console.log(`[房间${ws._code}] 离开 ${me ? me.name : '?'}`);
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000).unref();

/* ---------- 管理端点 (仅 127.0.0.1, curl 友好) ---------- */
function adminPage() {
  const H = '{ \"X-Steel-Admin\": \"1\" }';
  return `<!doctype html><meta charset="utf-8"><title>钢铁前沿 · 管理</title>
<body style="font:14px/1.6 monospace;background:#141610;color:#c8cdb8;padding:24px;max-width:860px">
<h2 style="color:#e8dcae">钢铁前沿 · 服务器管理</h2>
<p id="st">…</p>
<h3>铸造钥匙</h3>
<p>次数 <input id="uses" value="5" size="3"> 有效期(小时) <input id="hrs" value="24" size="3">
<button onclick="mint()">铸造</button> <span id="mintOut" style="color:#ffd97a"></span></p>
<h3>钥匙 / 令牌</h3><div id="keys">…</div>
<h3>最近对局</h3><div id="recs">…</div>
<h3>玩家档案 (按昵称)</h3><div id="pls">…</div>
<script>
var HDR = { 'X-Steel-Admin': '1' };
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
function fmt(t) { return new Date(t).toLocaleString(); }
function refresh() {
  fetch('/admin/status', { headers: HDR }).then(function (r) { return r.json(); }).then(function (st) {
    $('st').textContent = '端口 ' + st.port + ' · 房间 ' + st.rooms + ' · 玩家 ' + st.players + ' · 记录 ' + st.records + ' 条 · 建房门禁 ' + (st.gated ? '开' : '关');
  });
  fetch('/admin/keys', { headers: HDR }).then(function (r) { return r.json(); }).then(function (ks) {
    var kh = ks.keys.length ? ks.keys.map(function (k) { return k.key + ' ×' + k.uses + ' (至 ' + fmt(k.expires) + ')'; }).join(' · ') : '无';
    var th = ks.tokens.length ? '<ul>' + ks.tokens.map(function (t) {
      return '<li>' + t.token.slice(0, 12) + '… 至 ' + fmt(t.expires) + ' <button onclick="revoke(\'' + t.token + '\')">吊销</button></li>';
    }).join('') + '</ul>' : '无';
    $('keys').innerHTML = '<b>钥匙</b>: ' + kh + '<br><b>令牌</b>: ' + th;
  });
  fetch('/admin/records?limit=15', { headers: HDR }).then(function (r) { return r.json(); }).then(function (rc) {
    $('recs').innerHTML = rc.records.length ? '<ul>' + rc.records.map(function (r) {
      var mode = r.mode === 'coop' ? (r.win ? '合作胜' : '合作败') : '对战';
      var ps = (r.players || []).map(function (p) { return esc(p.name) + ' ' + p.kills + '杀'; }).join(', ');
      return '<li>' + fmt(r.time) + ' · ' + esc(r.map || '?') + ' · ' + mode + ' · ' + ps + '</li>';
    }).join('') + '</ul>' : '(暂无)';
  });
  fetch('/admin/players', { headers: HDR }).then(function (r) { return r.json(); }).then(function (pl) {
    $('pls').innerHTML = pl.players.length ? '<ul>' + pl.players.map(function (p) {
      return '<li>' + esc(p.name) + ': ' + p.games + ' 场 · ' + p.kills + ' 杀 · 合作胜 ' + p.wins + '</li>';
    }).join('') + '</ul>' : '(暂无)';
  });
}
function mint() {
  var q = '/admin/key?uses=' + $('uses').value + '&ttl=' + (($('hrs').value | 0) * 3600);
  fetch(q, { method: 'POST', headers: HDR }).then(function (r) { return r.json(); }).then(function (r) {
    $('mintOut').textContent = r.ok ? ' → ' + r.key + ' (发进团队群, 每人兑换一次)' : r.error;
    refresh();
  });
}
function revoke(t) { fetch('/admin/revoke?token=' + t, { method: 'POST', headers: HDR }).then(refresh); }
refresh(); setInterval(refresh, 15000);
</script>`;
}

function startAdmin() {
  const adm = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/admin/' || u.pathname === '/admin') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(adminPage()); return;
    }
    // 防浏览器跨站驱动 (自定义头强制预检); curl 加 -H 'X-Steel-Admin: 1' 即可
    if (req.headers['x-steel-admin'] !== '1') { json(403, { ok: false, error: '缺少 X-Steel-Admin 头' }); return; }
    if (u.pathname === '/admin/key' && req.method === 'POST') {
      const uses = parseInt(u.searchParams.get('uses') || '5', 10) || 5;
      const ttl = parseInt(u.searchParams.get('ttl') || '86400', 10) || 86400;
      const k = mintKey(uses, ttl);
      console.log(`[钥匙] 铸造 ${k} (${uses}次/${ttl}秒)`);
      json(200, { ok: true, key: k, uses, ttl });
      return;
    }
    if (u.pathname === '/admin/keys') {
      json(200, {
        keys: [...keys.entries()].map(([k, e]) => ({ key: k, uses: e.uses, expires: e.expires })),
        tokens: [...tokens.entries()].map(([t, e]) => ({ token: t, expires: e.expires }))
      });
      return;
    }
    if (u.pathname === '/admin/revoke' && req.method === 'POST') {
      const t = u.searchParams.get('token') || '';
      const ok = tokens.delete(t);
      console.log(`[令牌] 吊销 ${t.slice(0, 12)}… ${ok ? '成功' : '不存在'}`);
      json(200, { ok });
      return;
    }
    if (u.pathname === '/admin/status') {
      let players = 0, sims = 0; for (const r of rooms.values()) { players += r.players.size; if (r.sim) sims++; }
      json(200, { ok: true, port: PORT, rooms: rooms.size, players, records: recordCount, gated: !OPEN, keys: keys.size, tokens: tokens.size,
        srv: { rooms: sims, tickP95: tickP95(), tickSamples: srvStats.ticks.length },
        mem: Math.round(process.memoryUsage().rss / 1e6) });   // 阶段5 内存预算探针(设计 §3.4: 30-60MB/房)
      return;
    }
    if (u.pathname === '/admin/srv-dbg' && req.method === 'GET') {
      const code = u.searchParams.get('room') || '';
      const room = rooms.get(code);
      if (!room || !room.gameCtx) { json(404, { ok: false }); return; }
      json(200, { ok: true, dbg: room.gameCtx.__j || null, trace: (room.gameCtx.__shellTrace || []).slice(0, 40), timeLeft: room.sim ? room.sim.timeLeft : null,
        tanks: room.sim ? [...room.sim.tanks.values()].map(t => ({ id: t.netId, type: t.type, x: +t.x.toFixed(0), y: +(t.y || 0).toFixed(1), z: +t.z.toFixed(0), hp: Math.round(t.hp), alive: t.alive, ai: !!t.ai })) : [] });
      return;
    }
    if (u.pathname === '/admin/srv-fire' && req.method === 'POST') {
      const code = u.searchParams.get('room') || '';
      const room = rooms.get(code);
      if (!room || !room.sim) { json(404, { ok: false, error: '无进行中的对局' }); return; }
      const okF = room.sim.testFire(parseInt(u.searchParams.get('from') || '0', 10), parseInt(u.searchParams.get('at') || '0', 10));
      json(200, { ok: okF !== false, log: (room.gameCtx && room.gameCtx.__fireLog ? room.gameCtx.__fireLog.slice(-3) : []) });
      return;
    }
    if (u.pathname === '/admin/srv-end' && req.method === 'POST') {
      const code = u.searchParams.get('room') || '';
      const room = rooms.get(code);
      if (!room || !room.sim) { json(404, { ok: false, error: '无进行中的服务器权威对局' }); return; }
      room.sim.forceEnd();   // 下个 tick 走 finishSrvRoom: 广播 end + 落盘 + 房间复位
      json(200, { ok: true, room: code });
      return;
    }
    if (u.pathname === '/admin/records') {
      const limit = Math.min(500, parseInt(u.searchParams.get('limit') || '50', 10) || 50);
      let lines = [];
      try { lines = fs.readFileSync(RECORDS_FILE, 'utf8').split('\n').filter(l => l.trim()); } catch (e) { }
      const out = [];
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        try { out.push(JSON.parse(lines[i])); } catch (e) { }
      }
      json(200, { ok: true, records: out });
      return;
    }
    if (u.pathname === '/admin/players') {
      let lines = [];
      try { lines = fs.readFileSync(RECORDS_FILE, 'utf8').split('\n').filter(l => l.trim()); } catch (e) { }
      const agg = new Map();
      for (const l of lines) {
        let r; try { r = JSON.parse(l); } catch (e) { continue; }
        const seen = new Set();
        for (const p of r.players || []) {
          if (seen.has(p.name)) continue;   // 同名同行只计一次
          seen.add(p.name);
          const a = agg.get(p.name) || { name: p.name, games: 0, kills: 0, wins: 0 };
          a.games++; a.kills += p.kills | 0;
          if (r.mode !== 'dm' && r.win) a.wins++;
          agg.set(p.name, a);
        }
      }
      json(200, { ok: true, players: [...agg.values()].sort((a, b) => b.kills - a.kills) });
      return;
    }
    json(404, { ok: false, error: 'not found' });
  });
  adm.listen(ADMIN_PORT, '127.0.0.1', () => console.log(`管理端点: http://127.0.0.1:${ADMIN_PORT} (curl 加 -H 'X-Steel-Admin: 1'; 浏览器直接开)`));
}

/* ---------- 启动 ---------- */
initRecords();
server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('钢铁前沿对战服务器已启动');
  console.log(`  本机:   http://127.0.0.1:${PORT}   (页面即客户端, 自动连本服, 无需填地址)`);
  for (const ip of ips) console.log(`  局域网: http://${ip}:${PORT}   ← 发给朋友`);
  if (OPEN) console.log('  建房门禁: 关闭 (--open, 任何人可建房)');
  console.log(`  容量: ${MAX_ROOMS} 房 × ${MAX_PLAYERS} 人`);
  if (ADMIN_PORT > 0) startAdmin();
});
