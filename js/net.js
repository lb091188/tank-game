// net.js — WebSocket 传输层: 房间信令 + 输入上行(30Hz) + 快照缓冲插值(100ms)
// 游戏判定在主机(房主浏览器); 本模块只收发与插值
window.SF = window.SF || {};

SF.Net = (() => {
  let ws = null;
  const handlers = {};
  const snaps = [];           // 快照缓冲 [{recvT, data}]
  let inputTimer = null;
  // 快照 20Hz(50ms 周期)。到达时刻差低于此值一律视为投递伪影(TCP 合批/浏览器任务合帧),
  // 非服务器节奏: 若照抄 performance.now() 当 recvT, 紧邻两包的 span 被 max(1,·) 兜底成 1ms,
  // 插值 k 在 0/1 硬跳 → 幽灵位置 20Hz 台阶, 与正常对交替出现 = 肉眼可见的移动抖动。
  const SNAP_MIN_GAP = 40;

  function on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); }
  function emit(t, d) { const l = handlers[t]; if (l) for (const fn of l) fn(d); }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  let curAddr = '';
  // 同源自动地址: 页面由对战服务器托管(页面与 WS 同源), 打开即连无需填地址
  // http 页面 → ws://同host(含端口); https 页面 → wss://同host(默认443, 走反代)
  function autoAddr() {
    if (location.protocol === 'https:') return 'wss://' + location.host;
    if (location.protocol === 'http:') return 'ws://' + location.host;
    return '';
  }
  // 地址归一: 支持裸host:port / ws:// / wss:// / http:// / https://
  // wss/https 保留安全协议且不补端口(默认443), 其余补 :8342
  function normalizeAddr(raw) {
    let a = String(raw || '').trim(), secure = false;
    a = a.replace(/^wss:\/\//, () => { secure = true; return ''; })
      .replace(/^https:\/\//, () => { secure = true; return ''; })
      .replace(/^ws:\/\//, '').replace(/^http:\/\//, '').replace(/\/$/, '');
    if (!a) return '';
    if (!secure && !/:\d+$/.test(a)) a += ':8342';
    return (secure ? 'wss://' : 'ws://') + a;
  }
  function connect(addr) {
    const url = normalizeAddr(addr) || autoAddr();
    if (!url) return Promise.reject(new Error('请通过服务器网址打开本页面 (本地文件无法联机)'));
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } }
    curAddr = url;
    return new Promise((resolve, reject) => {
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('连接被浏览器拦截 (https 页面只能连 wss)')); return; }
      ws.onopen = () => resolve();
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.t === 'snap') {
          // 防坍缩: 相邻快照按上一包 recvT + SNAP_MIN_GAP 单调上轴(超大间隔是真实网络抖动照抄到达时刻),
          // 保证插值 span 恒 ≥ SNAP_MIN_GAP, 消掉硬跳台阶; 代价: 突发时插值时间轴最多提前一拍, 仍 < 20Hz 延迟预算。
          const now = performance.now();
          const last = snaps.length ? snaps[snaps.length - 1].recvT : 0;
          snaps.push({ recvT: now > last + SNAP_MIN_GAP ? now : last + SNAP_MIN_GAP, data: m });
        }
        else emit(m.t, m);
      };
      ws.onclose = () => { if (curAddr === url) emit('disconnect', {}); };
      ws.onerror = () => reject(new Error('服务器连接失败'));
    });
  }

  // 大厅操作 (建房带通行令牌+可选密码; 进房凭房间号+密码)
  const getToken = () => localStorage.getItem('sf_token') || '';
  // proto: 客户端协议版本(=3 = 快照 14 字段行含 bodyPitch/bodyRoll)。旧客户端服务器按版本门禁拒绝并提示强刷
  const createRoom = (name, tank, pass) => send({ t: 'create', name, tank, pass: pass || undefined, token: getToken() || undefined, proto: 3 });
  const joinRoom = (room, pass, name, tank) => send({ t: 'join', room: String(room).trim(), pass: pass || undefined, name, tank, proto: 3 });
  // 钥匙兑换: POST 到 WS 同源的 HTTP 端点 (ws://x:8342 → http://x:8342)
  async function redeemKey(key) {
    const base = curAddr.replace(/^ws/, 'http');
    const r = await fetch(base + '/key/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: String(key || '').trim() })
    }).then(r => r.json()).catch(() => ({ ok: false, error: '网络错误' }));
    if (r.ok) localStorage.setItem('sf_token', r.token);
    return r;
  }
  const setReady = (v, tank) => send({ t: 'ready', v, tank });
  const setMode = (mode) => send({ t: 'mode', mode: mode || 'dm' });            // 房主: 死斗/合作
  const setTeam = (v) => send({ t: 'team', v: v ? 1 : 0 });                      // 死斗: 选红/蓝阵营
  const leave = () => send({ t: 'leave' });                                      // 主动离房(区别于断线)
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
  // 行布局(量化后 14 字段): [x,z,y, yaw,tur,pitch,speed, hp,alive, reloadT,reloadTotal,clipLeft, bodyPitch, bodyRoll]
  // 快照节奏见上方 SNAP_MIN_GAP(到达时刻防坍缩); bodyPitch/bodyRoll 路尾追加, 旧客户端被 proto 门禁拒
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
      let dy = pb[3] - pa[3];
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      out[id] = {
        x: SF.Util.lerp(pa[0], pb[0], k), z: SF.Util.lerp(pa[1], pb[1], k),
        y: SF.Util.lerp(pa[2], pb[2], k), yaw: pa[3] + dy * k,
        tur: (() => { let d2 = pb[4] - pa[4]; if (d2 > Math.PI) d2 -= Math.PI * 2; if (d2 < -Math.PI) d2 += Math.PI * 2; return pa[4] + d2 * k; })(),
        pitch: SF.Util.lerp(pa[5], pb[5], k), speed: SF.Util.lerp(pa[6], pb[6], k),
        bodyPitch: SF.Util.lerp(pa[12] || 0, pb[12] || 0, k), bodyRoll: SF.Util.lerp(pa[13] || 0, pb[13] || 0, k),   // 小角度直接 lerp, 无需环绕
        hp: pb[7], alive: !!pb[8],
        reloadT: +pb[9] || 0, reloadTotal: +pb[10] || 0, clipLeft: pb[11] | 0   // 装填状态取最新帧(不需插值)
      };
    }
    return { poses: out, timeLeft: b.data.st, scores: b.data.sc, wv: b.data.wv, dt: b.data.dt, pk: b.data.pk };
  }

  function resetSnaps() { snaps.length = 0; }

  // 断开连接(退出战斗时调用); 置空 ws 使 send/状态查询安全失效
  function close() {
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } ws = null; }
  }

  return { connect, normalizeAddr, createRoom, joinRoom, redeemKey, getToken, setReady, setMode, setTeam, leave, startMatch, startInputLoop, stopInputLoop, interpolate, resetSnaps, on, send, close, get socket() { return ws; }, get address() { return curAddr; } };
})();
