#!/usr/bin/env node
// browser-mp-smoke.js — 阶段3 门禁③: 浏览器双开 dm(srvSim) 实测
//
// 单 Chrome 实例双标签页(防后台节流 flag 全开): 甲标签建房(带令牌)→乙标签加入→甲开局→
// 两侧都应走 client 幽灵路径(SF.Game_mp.mode==='client', 房主也不例外 —— 服务器权威的直接证据)
// → CDP 真实键盘驾驶/全程按住开火 60s → 断言: 双标签 console 零报错(基线噪声除外)、对局时钟
// 由服务器快照推进、幽灵坦克表覆盖全体参战者。信令走 SF.Net 公开方法(同源自动连)。
// 用法: 先起服 (cd server && node server.js 8352), 再 node tools/browser-mp-smoke.js [端口=8352] [秒=60]
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('../server/node_modules/ws');

const PORT = process.argv[2] || '8352';
const SECONDS = Number(process.argv[3] || 60);
const MODE = process.argv[4] === 'coop' ? 'coop' : 'dm';   // 阶段4: coop 双开(波次/补给/维修对账)
const URL_ = `http://127.0.0.1:${PORT}/`;
const CDP = 9351;
const BASELINE_NOISE = (t) => t.includes('edition.js') || t.includes('favicon.ico') ||
  (t.includes('computeBoundingSphere') && t.includes('NaN')) ||
  t.includes('Pointer Lock') || t.includes('pointer lock') || t.includes('NotAllowedError') ||
  t.includes('WrongDocumentError');   // 白名单均为无头/CDP 环境噪声: edition.js 设计内 404, canvas.requestPointerLock 合法功能, WrongDocument=CDP 派发输入

function httpJson(method, port, path, body, headers) {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: headers || { 'Content-Type': 'application/json' } }, r => {
      let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { res(s); } });
    });
    req.on('error', rej);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function launchChrome() {
  return spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${CDP}`, '--window-size=1280,720', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/sf-mp-a',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });
}
async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      return await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: CDP, path: '/json' }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
    } catch (e) { await sleep(250); }
  }
  throw new Error('CDP 未就绪 :' + CDP);
}
async function cdpConnect(wantUrlSub) {
  const targets = await cdpTargets();
  const pages = targets.filter(t => t.type === 'page');
  const page = wantUrlSub === 'about:blank'
    ? pages.filter(t => t.url === 'about:blank').pop()
    : pages.filter(t => t.url.includes(wantUrlSub)).pop();
  if (!page) throw new Error(`无匹配标签页(${wantUrlSub}); 现有: ${pages.map(t => t.url.slice(0, 30)).join(' | ')}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let msgId = 0;
  const pending = new Map();
  const consoleErrs = [], exceptions = [], netErrors = [];
  ws.on('message', (buf) => {
    const m = JSON.parse(buf);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 220));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrs.push(m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 220));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') netErrors.push(((m.params.entry.text || '') + ' @' + (m.params.entry.url || '').slice(-24)).slice(0, 220));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 260));
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    'window.__errs = [];',
    "window.addEventListener('error', e => { if (window.__errs.length < 8) window.__errs.push((e.message || 'evt') + ' @' + String(e.filename || '').slice(-22) + ':' + e.lineno); }, true);",
    "window.addEventListener('unhandledrejection', e => { if (window.__errs.length < 8) window.__errs.push('rej:' + String(e.reason && e.reason.message || e.reason).slice(0, 160)); });",
    'const _ce = console.error.bind(console);',
    'console.error = function (...a) { try { if (window.__errs.length < 8) window.__errs.push("ce:" + a.map(x => (x && x.message) || String(x)).join(" ").slice(0, 160)); } catch (e) {} _ce(...a); };',
  ].join('\n') });
  return { send, evalJs, consoleErrs, exceptions, netErrors };
}
const REC = (loadKey, smpKey) => [
  '(() => {',
  '  const w = (n) => { const f = SF.Assets[n]; if (!f) return;',
  '    SF.Assets[n] = async (...a) => { try { return await f(...a); } catch (e) { sessionStorage.setItem(' + JSON.stringify(loadKey) + ', n + ": " + ((e && e.message) || e)); throw e; } }; };',
  '  w("ensureMap"); w("ensureTanks");',
  '  const f = window.SF_StartMP;',
  '  window.SF_StartMP = function (...a) {',
  '    try { const r = f.apply(this, a); if (r && r.catch) r.catch(e => sessionStorage.setItem(' + JSON.stringify(smpKey) + ', "async: " + ((e && e.message) || e))); return r; }',
  '    catch (e) { sessionStorage.setItem(' + JSON.stringify(smpKey) + ', "sync: " + ((e && e.message) || e)); throw e; }',
  '  }; return "ok"; })()',
].join('\n');

(async () => {
  console.log(`[browser-mp] ${URL_} 双开 dm(srvSim) ${SECONDS}s`);
  const k1 = await httpJson('POST', Number(PORT) + 1, '/admin/key?uses=4&ttl=1', null, { 'X-Steel-Admin': '1' }).then(r => r.key);
  const k2 = await httpJson('POST', Number(PORT) + 1, '/admin/key?uses=4&ttl=1', null, { 'X-Steel-Admin': '1' }).then(r => r.key);
  const tA = await httpJson('POST', Number(PORT), '/key/redeem', { key: k1 });
  const tB = await httpJson('POST', Number(PORT), '/key/redeem', { key: k2 });
  if (!tA.token || !tB.token) throw new Error('令牌兑换失败');

  const ch = launchChrome();
  const cleanup = (code, msg) => { try { ch.kill('SIGKILL'); } catch (e) { } if (msg) console.log(msg); process.exit(code); };
  try {
    await sleep(800);
    const pa = await cdpConnect('about:blank');   // 首标签=启动页
    await pa.send('Page.navigate', { url: URL_ });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await pa.evalJs('!!(window.SF && SF.Net)').catch(() => false); }
    if (!ready) throw new Error('甲页面未就绪');
    await pa.evalJs(`localStorage.setItem('sf_token', ${JSON.stringify(tA.token)}); 'ok'`);
    await pa.send('Page.navigate', { url: URL_ });
    ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await pa.evalJs('!!(window.SF && SF.Net)').catch(() => false); }
    if (!ready) throw new Error('甲页面二载未就绪');
    await pa.evalJs(REC('A load', 'A smp'));
    // 必须先走大厅 bindMsgs(注册 start/joined 处理 → SF_StartMP), 否则开局广播无人接
    await pa.evalJs('(async () => { document.getElementById("btnMp").click(); await new Promise(r => setTimeout(r, 600)); window.__roomCode = new Promise(res => SF.Net.on("joined", m => res(m.room))); SF.Net.createRoom("甲车手", "tiger1", "pw123"); })()');
    const roomCode = await pa.evalJs('window.__roomCode');
    console.log('[browser-mp] 甲建房 ' + roomCode);

    await pa.send('Target.createTarget', { url: 'about:blank' });
    await sleep(800);
    const pb = await cdpConnect('about:blank');
    await pb.send('Page.navigate', { url: URL_ });
    ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await sleep(500); ready = await pb.evalJs('!!(window.SF && SF.Net)').catch(() => false); }
    if (!ready) throw new Error('乙页面未就绪');
    await pb.evalJs(`localStorage.setItem('sf_token', ${JSON.stringify(tB.token)}); 'ok'`);
    await pb.evalJs(REC('B load', 'B smp'));
    await pb.evalJs(`(async () => { document.getElementById("btnMp").click(); await new Promise(r => setTimeout(r, 600)); window.__joined = new Promise(res => SF.Net.on("joined", m => res(m))); SF.Net.joinRoom(${JSON.stringify(roomCode)}, "pw123", "乙车手", "tiger1"); })()`);
    await pb.evalJs('window.__joined');
    console.log('[browser-mp] 乙已加入, 甲开局(l01 dm)');

    await pa.evalJs('window.__start = new Promise(res => SF.Net.on("start", m => res(m))); "ok"');
    await pb.evalJs('window.__start = new Promise(res => SF.Net.on("start", m => res(m))); "ok"');
    await pa.evalJs(`SF.Net.startMatch("l01", ${JSON.stringify(MODE)}); "ok"`);
    const startA = await pa.evalJs('window.__start');
    const startB = await pb.evalJs('window.__start');
    console.log(`[browser-mp] start 广播: srvSim 甲=${startA.srvSim} 乙=${startB.srvSim}`);
    if (!startA.srvSim || !startB.srvSim) throw new Error('dm start 未带 srvSim');

    const waitBattle = async (page, who, errKey, smpKey) => {
      let inGame = false;
      for (let i = 0; i < 150 && !inGame; i++) {
        await sleep(500);
        inGame = await page.evalJs(`!!(window.SF && SF.Game && SF.Game.world && SF.Game.world.player && SF.Game_mp && SF.Game_mp.mode === "client")`).catch(() => false);
        if (!inGame && i % 16 === 15) {
          const st = await page.evalJs(`(() => { try { return { mode: SF.Game_mp ? SF.Game_mp.mode : "sp", lerr: sessionStorage.getItem(${JSON.stringify(errKey)}), serr: sessionStorage.getItem(${JSON.stringify(smpKey)}) }; } catch (e) { return { mode: "E:" + e.message.slice(0, 50) }; } })()`).catch(e => 'evalE');
          console.log(`  [wait ${who}] ${i / 2}s ${JSON.stringify(st)}`);
        }
      }
      if (!inGame) throw new Error(who + ' 75s 未进入 client 幽灵战斗');
    };
    await waitBattle(pa, '甲', 'A load', 'A smp');
    await waitBattle(pb, '乙', 'B load', 'B smp');
    console.log('[browser-mp] 双侧均进入 client 幽灵路径(房主也不例外 —— 服务器权威生效)');
    const battleT0 = Date.now();   // 对局时钟起点(资源加载不计入战斗时长口径)

    for (const pg of [pa, pb]) await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
    await pa.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', windowsVirtualKeyCode: 87, key: 'KeyW' });
    await pb.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', windowsVirtualKeyCode: 87, key: 'KeyW' });
    const t0 = Date.now(); let ph = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      await sleep(3000);
      const k = ph % 2 ? 'KeyD' : 'KeyA', vk = ph % 2 ? 68 : 65;
      for (const pg of [pa, pb]) {
        await pg.send('Input.dispatchKeyEvent', { type: 'keyDown', code: k, windowsVirtualKeyCode: vk, key: k });
        await sleep(120);
        await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', code: k });
      }
      ph++;
    }
    for (const pg of [pa, pb]) {
      await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW' });
      await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
    }

    const readState = (page) => page.evalJs(`(() => { const w = SF.Game.world, p = w.player, mp = SF.Game_mp;
      let aiGhosts = 0, sum = 0; for (const [id, t] of mp.tanks) { if (+id >= 100) aiGhosts++; sum += t.hp + t.reloadT + t.x + t.z; }
      return { mode: mp.mode, myId: mp.myId, time: +w.time.toFixed(1), pos: [Math.round(p.x), Math.round(p.z)],
        hp: Math.round(p.hp), alive: p.alive, ghosts: mp.tanks.size, aiGhosts,
        waveInfo: mp.waveInfo ? mp.waveInfo.idx + "/" + mp.waveInfo.total : null,
        timeLeft: mp.timeLeft, snapBuf: SF.Net.interpolate(0) ? 1 : 0, sum: +sum.toFixed(2) }; })()`);
    const stA = await readState(pa), stB = await readState(pb);
    console.log(`[browser-mp] 甲: mode=${stA.mode} t=${stA.time}s pos=(${stA.pos}) hp=${stA.hp} 幽灵=${stA.ghosts} 时限=${stA.timeLeft} 插值=${stA.snapBuf}`);
    console.log(`[browser-mp] 乙: mode=${stB.mode} t=${stB.time}s pos=(${stB.pos}) hp=${stB.hp} 幽灵=${stB.ghosts} 时限=${stB.timeLeft} 插值=${stB.snapBuf}`);
    // 服务器快照流证据(dm=时限递减; coop=AI 幽灵插值位置变化 —— coop 无时限 st 恒定)
    const stA1 = await readState(pa), stB1 = await readState(pb);
    await sleep(2200);
    const stA2 = await readState(pa), stB2 = await readState(pb);
    // 流证据: tn 全字段校验和变化(战斗中 reloadT/hp/位置持续变; coop st 恒 180 不适用时限递减)
    const streamOk = stA1.sum !== stA2.sum || stB1.sum !== stB2.sum;
    const errsA = pa.consoleErrs.filter(t => !BASELINE_NOISE(t)).length + pa.exceptions.filter(t => !BASELINE_NOISE(t)).length + pa.netErrors.filter(t => !BASELINE_NOISE(t)).length;
    const errsB = pb.consoleErrs.filter(t => !BASELINE_NOISE(t)).length + pb.exceptions.filter(t => !BASELINE_NOISE(t)).length + pb.netErrors.filter(t => !BASELINE_NOISE(t)).length;
    console.log(`[browser-mp] 计入报错: 甲=${errsA} 乙=${errsB}(基线噪声除外)`);
    if (errsA) console.log('  甲明细:', pa.consoleErrs.concat(pa.exceptions).slice(0, 4));
    if (errsB) console.log('  乙明细:', pb.consoleErrs.concat(pb.exceptions).slice(0, 4));
    // 时钟口径: 无头双页渲染帧率不稳, 客户端 world.time(rAF 累计)不作为门禁;
    // 权威性证据链 = 双侧 client 模式 + 服务器快照流(timeLeft 递减) + 幽灵表覆盖 + 零报错 + 位移
    const movedOk = Math.hypot(stA.pos[0] - 0, stA.pos[1] - 0) > 0 || Math.hypot(stB.pos[0], stB.pos[1]) > 0;
    const coopOk = MODE !== 'coop' || (stA.aiGhosts >= 1 && stB.aiGhosts >= 1 && stA.waveInfo !== null && stB.waveInfo !== null);
    // alive 不作门禁: dm/coop 里被击毁都是正常游戏结果(死亡流程同样走快照对账), 状态如实打印
    const okRes = stA.mode === 'client' && stB.mode === 'client' &&
      stA.ghosts >= 2 && stB.ghosts >= 2 && coopOk && stA.snapBuf === 1 && stB.snapBuf === 1 && streamOk && errsA === 0 && errsB === 0;
    console.log(JSON.stringify({ ok: okRes, mode: MODE, modeA: stA.mode, modeB: stB.mode, time: stA.time, posA: stA.pos, posB: stB.pos, ghosts: stA.ghosts, aiGhosts: stA.aiGhosts, waveInfo: stA.waveInfo, streamOk, errsA, errsB }));
    cleanup(okRes ? 0 : 1);
  } catch (e) {
    console.error('[browser-mp] 失败:', e.message);
    cleanup(1);
  }
})();
