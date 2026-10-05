#!/usr/bin/env node
// browser-smoke.js — 阶段1 门禁⑥: Chrome 无头单机 60s 冒烟(驾驶/开炮/命中/HUD 零回归 + console 零报错)
//
// 链路: 本机 google-chrome(headless) 打开对战服务器托管页面(8352) → 点 #btnStart 开单机战斗 →
// CDP Input 派发真实键盘/鼠标(前进/转炮/开火) → 60s 后读 SF.Game.world 断言: 玩家有位移、有开炮、
// 有命中(或至少炮弹起飞)、HUD/模拟零异常; 期间收集 console.error/异常(已知设计内 404 单列)。
// 零 npm 依赖: ws 复用 server/node_modules(steel-ws-test.js 先例)。
// 用法: 先起服 (cd server && node server.js 8352), 再 node tools/browser-smoke.js [端口=8352] [秒数=60]
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('../server/node_modules/ws');

const PORT = process.argv[2] || '8352';
const SECONDS = Number(process.argv[3] || 60);
const URL_ = `http://127.0.0.1:${PORT}/`;
const CDP_PORT = 9333;
// 基线噪声白名单(A/B 实证: 用 git show HEAD 的 vehicle/combat/models/index 重建改动前客户端,
// 同款冒烟跑出完全相同的这些报错 —— 属存量/环境项, 非本阶段回归):
//   ① computeBoundingSphere NaN ×3 —— models.js bakeCover 掩体合批烘焙(开战前)顶点含 NaN, 存量;
//   ② favicon.ico 404 —— 无头环境请求, 页面本无 favicon;
//   ③ edition.js 404 —— 设计内(交接文档明示不要修)。
const BASELINE_NOISE = ['edition.js', 'favicon.ico'];
const isBaselineNoise = (t) => BASELINE_NOISE.some(k => t.includes(k)) ||
  (t.includes('computeBoundingSphere') && t.includes('NaN'));

const consoleErrors = [], exceptions = [], netErrors = [];
let ws, msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function evalJs(expression, awaitPromise = true) {
  return send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    .then(r => { if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path }, r => {
      let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
function key(code, type, mods = {}) {
  return send('Input.dispatchKeyEvent', { type: type === 'up' ? 'keyUp' : 'keyDown', windowsVirtualKeyCode: mods.vk || 0, code, key: code, text: mods.text });
}

(async () => {
  console.log(`[browser-smoke] ${URL_} 冒烟 ${SECONDS}s, CDP:${CDP_PORT}`);
  const chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${CDP_PORT}`, '--window-size=1280,720', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--user-data-dir=/tmp/sf-smoke-profile', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = (code, msg) => { try { chrome.kill('SIGKILL'); } catch (e) { } console.log(msg || ''); process.exit(code); };

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) { try { targets = await getJson('/json'); break; } catch (e) { await sleep(250); } }
    if (!targets) throw new Error('CDP 未就绪');
    const page = targets.find(t => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.on('message', (buf) => {
      const m = JSON.parse(buf);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
      if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 300));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const txt = m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300);
        if (!isBaselineNoise(txt)) consoleErrors.push(txt);
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        const txt = ((m.params.entry.text || '') + ' @' + (m.params.entry.url || '')).slice(0, 240);
        if (!isBaselineNoise(txt)) netErrors.push(txt);
      }
    });
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__nanStacks = [];
      const _ce = console.error;
      console.error = function (...a) {
        try {
          if (String(a[0]).includes('NaN') && window.__nanStacks.length < 3) window.__nanStacks.push(new Error().stack);
        } catch (e) {}
        _ce.apply(console, a);
      };` });
    await send('Log.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL_ });

    // 等车库就绪(资产装载)
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(500);
      ready = await evalJs(`!!(document.getElementById('btnStart') && window.SF && SF.Garage && SF.Garage.selTank)`).catch(() => false);
    }
    if (!ready) throw new Error('车库 60s 未就绪');
    console.log('[browser-smoke] 车库就绪, 点开战');
    await evalJs(`document.getElementById('btnStart').click(); 'ok'`);

    // 等战斗世界起来
    let inGame = false;
    for (let i = 0; i < 60 && !inGame; i++) {
      await sleep(500);
      inGame = await evalJs(`!!(window.SF && SF.Game && SF.Game.world && SF.Game.world.player && SF.Game.world.time > 0.5)`).catch(() => false);
    }
    if (!inGame) throw new Error('战斗 30s 未就绪');
    await evalJs(`(() => { const p = SF.Game.world.player;
      window.__smoke = { sx: p.x, sz: p.z, fired: 0, hits: 0, destroyed: 0, pen: 0, bounce: 0, absorb: 0, track: 0 };
      SF.Bus.on('fire', () => __smoke.fired++);
      SF.Bus.on('hit', (r) => { __smoke.hits++; if (r.kind === 'pen') __smoke.pen++; if (r.kind === 'bounce') __smoke.bounce++; if (r.kind === 'absorb') __smoke.absorb++; if (r.module === 'track') __smoke.track++; });
      SF.Bus.on('destroyed', () => __smoke.destroyed++);
      return 'ok'; })()`);
    console.log('[browser-smoke] 战斗已开始, 派发驾驶/开火输入');

    // 驾驶脚本: 每段 3s 换动作(W 前进 / A D 转向 / 开火), CDP 真实按键
    const phases = [
      { keys: ['KeyW'], fire: true }, { keys: ['KeyW', 'KeyA'] }, { keys: ['KeyW'], fire: true },
      { keys: ['KeyS'] }, { keys: ['KeyW', 'KeyD'], fire: true }, { keys: ['KeyW'] },
    ];
    const per = SECONDS * 1000 / phases.length;
    const t0 = Date.now();
    let phase = 0, nextAt = t0 + per, down = [];
    while (Date.now() - t0 < SECONDS * 1000) {
      if (Date.now() >= nextAt) {
        for (const k of down) await key(k, 'up');
        down = phases[phase % phases.length].keys;
        for (const k of down) await key(k, 'down', k === 'KeyW' ? { vk: 87, text: 'w' } : k === 'KeyS' ? { vk: 83, text: 's' } : k === 'KeyA' ? { vk: 65, text: 'a' } : { vk: 68, text: 'd' });
        if (phases[phase % phases.length].fire) {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
        }
        phase++; nextAt += per;
      }
      await sleep(200);
      // 游戏若因异常停摆(世界时钟不走)提前失败
      const alive = await evalJs(`SF.Game.world.time`).catch(() => -1);
      if (alive < 0) throw new Error('模拟时钟读取失败(页面异常?)');
    }
    for (const k of down) await key(k, 'up');

    const r = await evalJs(`(() => { const w = SF.Game.world, p = w.player, s = window.__smoke;
      return { time: +w.time.toFixed(1), pos: [Math.round(p.x), Math.round(p.z)],
        moved: +Math.hypot(p.x - s.sx, p.z - s.sz).toFixed(1),
        shots: p.stats.shots, myHits: p.stats.hits, pens: p.stats.pens, hp: Math.round(p.hp), alive: p.alive,
        busFired: s.fired, busHits: s.hits, busDestroyed: s.destroyed, pen: s.pen, bounce: s.bounce, absorb: s.absorb, trackBreak: s.track,
        enemies: w.enemies.length, enemiesAlive: w.enemies.filter(e => e.alive).length,
        workerOn: !!(window.SF_AIW && SF_AIW.on), gear: p.gear, speed: +p.speed.toFixed(1) }; })()`);
    console.log(`[browser-smoke] 结果: t=${r.time}s 位移=${r.moved}m shots=${r.shots} bus开火=${r.busFired} bus命中=${r.busHits}(击穿${r.pen}/跳弹${r.bounce}/吸收${r.absorb}/断带${r.trackBreak}) 击毁=${r.busDestroyed} myHits=${r.myHits} pens=${r.pens} hp=${r.hp} alive=${r.alive} 敌${r.enemiesAlive}/${r.enemies} gear=${r.gear} worker=${r.workerOn}`);
    console.log(`[browser-smoke] 计入报错: console.error=${consoleErrors.length} 异常=${exceptions.length} 网络错误=${netErrors.length}(基线噪声已按白名单剔除)`);
    if (consoleErrors.length) console.log('  console.error 明细:', consoleErrors.slice(0, 5));
    if (exceptions.length) console.log('  异常明细:', exceptions.slice(0, 5));
    if (netErrors.length) console.log('  网络错误明细:', netErrors.slice(0, 5));

    const errTotal = consoleErrors.length + exceptions.length + netErrors.length;
    // 门禁口径=ask 的「驾驶/开炮/命中/HUD 无回归 + console 零报错」: 位移/开火/命中链路必须发生。
    // 玩家存活不作硬门禁: 盲驾 60s 被 PVE 合围击杀是正常游戏行为(非回归; 物理等价由 golden-trace
    // 位级对账证明), 死亡反而多走完 destroyed/HUD 流程 —— 存活如实上报仅供观察。
    const ok = r.time >= SECONDS * 0.9 && r.moved > 10 && r.busFired > 0 && r.busHits > 0 && errTotal === 0;
    console.log(JSON.stringify({ ok, time: r.time, moved: r.moved, shots: r.shots, busFired: r.busFired,
      busHits: r.busHits, pen: r.pen, bounce: r.bounce, absorb: r.absorb, trackBreak: r.trackBreak,
      busDestroyed: r.busDestroyed, pens: r.pens, alive: r.alive, errors: errTotal, pos: r.pos, workerOn: r.workerOn }));
    cleanup(ok ? 0 : 1);
  } catch (e) {
    console.error('[browser-smoke] 失败:', e.message);
    cleanup(1);
  }
})();
