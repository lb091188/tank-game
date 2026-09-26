// net.js — WebSocket 传输层: 房间信令 + 输入上行(30Hz) + 快照缓冲插值(100ms)
// 游戏判定在主机(房主浏览器); 本模块只收发与插值
window.SF = window.SF || {};

SF.Net = (() => {
  let ws = null;
  const handlers = {};
  const snaps = [];           // 快照缓冲 [{recvT, data}]
  let inputTimer = null;

  function on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); }
  function emit(t, d) { const l = handlers[t]; if (l) for (const fn of l) fn(d); }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  let curAddr = '';
  // 地址归一: 192.168.1.5 / 192.168.1.5:8342 / ws://… / http://… → ws://IP:端口(默认 8342)
  function normalizeAddr(raw) {
    let a = String(raw || '').trim().replace(/^ws(s?):\/\//, '').replace(/^http(s?):\/\//, '').replace(/\/$/, '');
    if (!a) return '';
    if (!/:\d+$/.test(a)) a += ':8342';
    return 'ws://' + a;
  }
  function connect(addr) {
    const url = normalizeAddr(addr || (location.protocol.startsWith('http') ? location.host : ''));
    if (!url) return Promise.reject(new Error('请填写服务器地址'));
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } }
    curAddr = url;
    return new Promise((resolve, reject) => {
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('地址无效')); return; }
      ws.onopen = () => resolve();
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.t === 'snap') snaps.push({ recvT: performance.now(), data: m });
        else emit(m.t, m);
      };
      ws.onclose = () => { if (curAddr === url) emit('disconnect', {}); };
      ws.onerror = () => reject(new Error('服务器连接失败'));
    });
  }

  // 大厅操作
  const createRoom = (name, tank) => send({ t: 'create', name, tank });
  const joinRoom = (room, name, tank) => send({ t: 'join', room: String(room).trim(), name, tank });
  const setReady = (v, tank) => send({ t: 'ready', v, tank });
  const startMatch = (map, mode) => send({ t: 'start', map, mode: mode || 'dm' });

  // 对战中: 本地输入 30Hz 上行
  function startInputLoop(getInput) {
    stopInputLoop();
    inputTimer = setInterval(() => {
      const i = getInput();
      const mp = window.SF && SF.Game_mp;
      send({ t: 'input', id: mp ? mp.myId : 0, i: [+i.throttle.toFixed(2), +i.steer.toFixed(2), +i.aimYaw.toFixed(3), +i.aimPitch.toFixed(3), i.fire ? 1 : 0] });
    }, 33);
  }
  function stopInputLoop() { if (inputTimer) { clearInterval(inputTimer); inputTimer = null; } }

  // 快照插值: 取 now-delay 时刻各坦克姿态 {id: {x,z,y,yaw,tur,pitch,speed,hp,alive}}
  function interpolate(delay = 120) {
    if (snaps.length < 2) return null;
    const target = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].recvT < target) snaps.shift();
    const a = snaps[0], b = snaps[1];
    const span = Math.max(1, b.recvT - a.recvT);
    const k = SF.Util.clamp((target - a.recvT) / span, 0, 1);
    const out = {};
    const ids = new Set([...Object.keys(a.data.tn), ...Object.keys(b.data.tn)]);
    for (const id of ids) {
      const pa = a.data.tn[id], pb = b.data.tn[id] || pa;
      if (!pa) continue;
      let dy = pb[4] - pa[4];
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      out[id] = {
        x: SF.Util.lerp(pa[0], pb[0], k), z: SF.Util.lerp(pa[1], pb[1], k),
        y: SF.Util.lerp(pa[2], pb[2], k), yaw: pa[4] + dy * k,
        tur: (() => { let d2 = pb[5] - pa[5]; if (d2 > Math.PI) d2 -= Math.PI * 2; if (d2 < -Math.PI) d2 += Math.PI * 2; return pa[5] + d2 * k; })(),
        pitch: SF.Util.lerp(pa[6], pb[6], k), speed: SF.Util.lerp(pa[7], pb[7], k),
        hp: pb[8], alive: !!pb[9]
      };
    }
    return { poses: out, timeLeft: b.data.st, scores: b.data.sc, wv: b.data.wv, dt: b.data.dt };
  }

  function resetSnaps() { snaps.length = 0; }

  // 断开连接(退出战斗时调用); 置空 ws 使 send/状态查询安全失效
  function close() {
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } ws = null; }
  }

  return { connect, normalizeAddr, createRoom, joinRoom, setReady, startMatch, startInputLoop, stopInputLoop, interpolate, resetSnaps, on, send, close, get socket() { return ws; }, get address() { return curAddr; } };
})();
