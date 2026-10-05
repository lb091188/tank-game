// test-mp.js — 联机大厅行为验证: 钥匙兑换 / 昵称全服唯一 / 重复登录拦截 / 换房清理 / 掉线释放
// 用法: node test-mp.js [port=8352]  (需先在对应端口跑 server/server.js)
'use strict';
// ws 依赖复用 server/node_modules (tools 目录自身不装依赖)
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));

const PORT = parseInt(process.argv[2] || '8352', 10);
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, failCnt = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`);
  ok ? pass++ : failCnt++;
}

// 开一条 WS, 收集消息; send(t, obj) 发 {t, ...obj}
function client() {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT);
  const queue = [], waiters = [];
  ws.on('message', (b) => {
    let m; try { m = JSON.parse(b); } catch (e) { return; }
    const i = waiters.findIndex(w => w.type === m.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else queue.push(m);
  });
  return {
    ws,
    open: () => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }),
    send: (t, o) => ws.send(JSON.stringify({ t, proto: 2, ...o })),   // 阶段5 协议版本门禁: 测试客户端视为新客户端
    // 等待下一条 t 类型消息 (先查积压)
    wait: (t, ms = 2500) => {
      const i = queue.findIndex(m => m.t === t);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve) => {
        waiters.push({ type: t, resolve });
        setTimeout(() => {
          const k = waiters.findIndex(w => w.type === t && w.resolve === resolve);
          if (k >= 0) { waiters.splice(k, 1); resolve(null); }
        }, ms);
      });
    },
    close: () => { try { ws.close(); } catch (e) { } }
  };
}

const redeem = async (key) => (await fetch(BASE + '/key/redeem', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key })
}).then(r => r.json())).token;

(async () => {
  // ---- 等级表(与客户端 config.js 同源, vm 解析; 供 ⑩⑬⑮ 用) ----
  const vm = require('vm');
  const veh = (() => {
    try {
      const ctx = { console };
      ctx.window = ctx; vm.createContext(ctx);
      vm.runInContext(require('fs').readFileSync(require('path').join(__dirname, '..', 'client', 'js', 'config.js'), 'utf8'), ctx);
      const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11 };
      const out = {};
      for (const [id, v] of Object.entries(ctx.SF.CFG.vehicles)) if (v.tier && ROMAN[v.tier]) out[id] = ROMAN[v.tier];
      return out;
    } catch (e) { return {}; }
  })();
  let near = null, far = null;
  {
    const aTier = veh.sherman || 5;
    for (const [id, t] of Object.entries(veh)) {
      if (id === 'sherman') continue;
      if (Math.abs(t - aTier) === 1 && !near) near = id;
      if (Math.abs(t - aTier) > 1 && !far) far = id;
    }
  }

  // ---- ① 钥匙兑换 (脚本自铸: 管理端口=游戏端口+1) ----
  const mint = await fetch(`http://127.0.0.1:${PORT + 1}/admin/key?uses=10&ttl=600`, { method: 'POST', headers: { 'X-Steel-Admin': '1' } }).then(r => r.json());
  const GOOD_KEY = mint.key;
  const bad = await fetch(BASE + '/key/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: '__BAD__' }) }).then(r => r.json());
  check('无效钥匙被拒绝', bad.ok === false && /无效|用完/.test(bad.error), JSON.stringify(bad));
  const t1 = await redeem(GOOD_KEY), t2 = await redeem(GOOD_KEY), t3 = await redeem(GOOD_KEY);
  check('有效钥匙兑换到令牌(可多次)', !!t1 && !!t2 && !!t3, '令牌缺失');

  // ---- ② 建房: 昵称必填 + 令牌门禁 ----
  const c1 = client(); await c1.open();
  c1.send('create', { name: '   ', token: t1 });      // 空白昵称
  check('空白昵称被拒', (await c1.wait('err')).msg.includes('昵称'), '期望包含"昵称"的错误');
  c1.send('create', { name: 'Noah' });                 // 无令牌
  check('无令牌建房被拒', (await c1.wait('err')).msg.includes('通行令牌'), '期望令牌错误');
  c1.send('create', { name: '  Noah  ', token: t1 });  // 规范化: 首尾空白去掉
  const j1 = await c1.wait('joined');
  check('建房成功 + 昵称去空白', j1.room && j1.players[0].name === 'Noah', JSON.stringify(j1.players));
  const room = j1.room;

  // ---- ③④ 同名(含大小写变体)加入同房间 → 拒绝 ----
  const c2 = client(); await c2.open();
  c2.send('join', { room, name: 'Noah' });
  check('同昵称加入同房间被拒', (await c2.wait('err')).msg.includes('已在线'), '期望"已在线"错误');
  c2.send('join', { room, name: 'nOaH' });
  check('忽略大小写的重名也被拒', (await c2.wait('err')).msg.includes('已在线'), '期望"已在线"错误');

  // ---- ⑤ 同名跨房间建房 → 拒绝 ----
  c2.send('create', { name: 'Noah', token: t2 });
  check('同昵称另开房间被拒', (await c2.wait('err')).msg.includes('已在线'), '期望"已在线"错误');

  // ---- ⑥ 不同昵称可正常加入 ----
  c2.send('join', { room, name: '老兵2号' });
  const j2 = await c2.wait('joined');
  check('不同昵称加入成功', j2.you && j2.players.length === 2, JSON.stringify(j2.players && j2.players.length));

  // ---- ⑦ 用自己的昵称另开房间 → 放行且自动退出旧房间 ----
  // c1 的 lobby 队列里可能积压了刚才"加入"的广播(2人), 要等到"离房"的那条(1人)
  const waitLobbyCount = async (c, n) => {
    for (let i = 0; i < 6; i++) {
      const m = await c.wait('lobby', 1500);
      if (m && m.players.length === n) return m;
    }
    return null;
  };
  const lobbyPromise = waitLobbyCount(c1, 1);
  c2.send('create', { name: '老兵2号', token: t2 });
  const j3 = await c2.wait('joined');
  check('本人昵称换房放行(自己不算重名)', !!j3.room && j3.players[0].host === true, JSON.stringify(j3));
  const lob = await lobbyPromise;
  check('旧房间收到离房通知', !!lob, '未等到旧房间人数变为1的广播');

  // ---- ⑧ 他人仍不能占用在线昵称 ----
  const c3 = client(); await c3.open();
  c3.send('join', { room, name: 'Noah' });
  check('在线昵称第三人也占用不了', (await c3.wait('err')).msg.includes('已在线'), '期望"已在线"错误');
  c3.send('join', { room, name: '老兵3号' });
  check('第四人正常进房', !!(await c3.wait('joined')), '加入失败');

  // ---- ⑨ 房主掉线 → 房间解散 + 昵称释放 ----
  c1.close(); await sleep(300);
  check('房主掉线房间解散消息送达', !!(await c3.wait('err', 1500)), '未收到解散消息');
  const c4 = client(); await c4.open();
  c4.send('create', { name: 'Noah', token: t3 });
  const jA = await c4.wait('joined');
  check('掉线后昵称释放可复用', !!jA, '建房失败');

  // ---- ⑩ 等级匹配: 房主车位 ±1 级准入 ----
  if (Object.keys(veh).length) {
    const aTier = veh.sherman;
    const jA2 = jA;                                 // Noah 已建房(sherman, V 级锚) — 上面⑨
    const roomA = jA2.room, hostId = jA2.you;
    check('房间等级锚随 joined 下发', jA2.tier === aTier, JSON.stringify({ tier: jA2.tier, aTier }));
    const c5 = client(); await c5.open();
    c5.send('join', { room: roomA, name: '坦克世界', tank: far });   // 超档 → 拒
    const eFar = await c5.wait('err');
    check('超等级车被拒入房', !!eFar && eFar.msg.includes('等级'), JSON.stringify(eFar));
    c5.send('join', { room: roomA, name: '坦克世界', tank: near });  // 同档 → 过
    const jNear = await c5.wait('joined');
    check('±1 级车正常入房', !!jNear.room, '加入失败');
    c5.send('ready', { v: true, tank: far });        // 房内换超档车 → 拒且保持原车
    const eFar2 = await c5.wait('err');
    check('房内换超档车被拒', !!eFar2 && eFar2.msg.includes('等级'), JSON.stringify(eFar2));
    // ---- ⑪ 开战→击杀→结算→房间复位(可再战) ----
    await sleep(200);
    c4.send('start', { map: 'l01', mode: 'dm' });
    const s4 = await c4.wait('start');
    check('开战广播送达', !!s4 && s4.players.length === 2, JSON.stringify(s4 && s4.players.length));
    // 阶段3 服务器权威: dm 房由 sim 判定胜负, 客户端 ev/end 不再采信; 结算走 admin 强制结算(sim.scoreRows 为准)
    await fetch(`http://127.0.0.1:${Number(PORT) + 1}/admin/srv-end?room=${roomA}`, { method: 'POST', headers: { 'X-Steel-Admin': '1' } });
    // c5 的队列里积压了之前 ready 的 lobby 广播, 轮询等到"仅房主就绪"那条复位广播
    const waitLobbyWhere = async (c, pred) => {
      for (let i = 0; i < 6; i++) {
        const m = await c.wait('lobby', 1500);
        if (m && pred(m)) return m;
      }
      return null;
    };
    const lob5 = await waitLobbyWhere(c5, (m) => m.players.every(p => p.ready === p.host));
    check('结算后广播房间复位(仅房主就绪)', !!lob5, '未等到复位广播');
    const c6 = client(); await c6.open();
    c6.send('join', { room: roomA, name: '迟到大王', tank: near });   // started 已复位 → 可入
    check('结算后新人可加入房间', !!(await c6.wait('joined')), '结算后入房被拒');
    c5.close(); c6.close();
  } else {
    console.log('SKIP  等级表不可用, 跳过等级匹配断言');
  }

  c2.close(); c3.close(); c4.close();
  await sleep(300);
  // ---- ⑫ 击杀时间线落盘 ----
  try {
    const lines = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'records', 'battles.jsonl'), 'utf8').split('\n').filter(l => l.trim());
    const last = JSON.parse(lines[lines.length - 1]);
    // srvSim 模式: 无真实击杀时时间线为空数组(机制字段保留); 中继房( coop )仍由主机注入
    check('战斗记录落盘含时间线结构', Array.isArray(last.feed) && last.mode === 'dm', JSON.stringify({ feed: last.feed, mode: last.mode }));
  } catch (e) { check('战斗记录含击杀时间线', false, e.message); }

  // ---- ⑬ 阵营: 自动平衡入队 + 自选换队(换队视为未准备) + 模式切换归一 ----
  {
    // 新房: 锚 sherman(V)
    const t4 = await redeem(GOOD_KEY);
    const c8 = client(); await c8.open();
    c8.send('create', { name: '红队长', token: t4 });
    const j8 = await c8.wait('joined');
    check('建房者默认红方(team=0)', j8.players[0].team === 0, JSON.stringify(j8.players));
    const roomC = j8.room;
    // 两人依次进房 → 自动平衡: 第二人应进蓝方
    const c9 = client(); await c9.open();
    c9.send('join', { room: roomC, name: '平衡客', tank: near });
    const j9 = await c9.wait('joined');
    check('第二人自动平衡进蓝方(team=1)', (j9.players.find(p => p.name === '平衡客') || {}).team === 1, JSON.stringify(j9.players));
    // c9 先准备再换队 → 应回到未准备态
    c9.send('ready', { v: true, tank: near });
    await c9.wait('lobby', 1500);
    c9.send('team', { v: 0 });
    const lobT = await c9.wait('lobby', 1500);
    const me9 = (lobT || {}).players ? lobT.players.find(p => p.name === '平衡客') : null;
    check('自选换队成功且视为未准备', !!me9 && me9.team === 0 && me9.ready === false, JSON.stringify(me9));
    // 换回蓝队并准备(下面用)
    c9.send('team', { v: 1 });
    await c9.wait('lobby', 1500);
    c9.send('ready', { v: true, tank: near });
    await c9.wait('lobby', 1500);
    // 房主切合作模式 → 全员 team=0
    c8.send('mode', { mode: 'coop' });
    const lobM = await c9.wait('lobby', 1500);
    check('切合作模式全队同阵营', !!lobM && lobM.mode === 'coop' && lobM.players.every(p => p.team === 0), JSON.stringify(lobM && lobM.players));
    // 合作下选阵营被拒
    c9.send('team', { v: 1 });
    const eTeam = await c9.wait('err', 1500);
    check('合作模式禁止选阵营', !!eTeam && eTeam.msg.includes('同阵营'), JSON.stringify(eTeam));
    // 切回死斗
    c8.send('mode', { mode: 'dm' });
    await c9.wait('lobby', 1500);
    // ---- ⑭ 主动离房: 收到 left, 原昵称可被新连接占用 ----
    c9.send('leave');
    check('主动离房收到 left', !!(await c9.wait('left', 1500)), '未收到 left');
    const c10 = client(); await c10.open();
    c10.send('join', { room: roomC, name: '平衡客', tank: near });   // 昵称已释放
    check('离房后昵称立即释放', !!(await c10.wait('joined')), '释放失败');
    c10.close(); c8.close(); c9.close();
    await sleep(300);
  }

  // ---- ⑮ 容量: 第 5 个房间被拒(4 房上限) ----
  {
    const toks = [];
    for (let i = 0; i < 4; i++) toks.push(await redeem(GOOD_KEY));
    const cs = [];
    for (let i = 0; i < 4; i++) {
      const c = client(); await c.open();
      c.send('create', { name: `容量${i}`, token: toks[i] });
      const j = await c.wait('joined');
      cs.push(c);
      if (!j) break;
    }
    const cX = client(); await cX.open();
    cX.send('create', { name: '第五间', token: toks[0] });
    const eFull = await cX.wait('err', 1500);
    check('第 5 个房间被拒(4 房上限)', !!eFull && eFull.msg.includes('满载'), JSON.stringify(eFull));
    for (const c of cs) c.close();
    cX.close();
    await sleep(400);   // 等房间清空
  }

  // ---- ⑯ 车型消毒: 未知/无模型车回默认, 合法车保留 ----
  {
    const t5 = await redeem(GOOD_KEY);
    const c11 = client(); await c11.open();
    c11.send('create', { name: '消毒官', token: t5, tank: 'challengerX' });   // 不存在的车型(篡改/陈旧存档)
    const j11 = await c11.wait('joined');
    check('未知车建房被消毒为默认车', (j11.players[0] || {}).tank === 'sherman', JSON.stringify(j11.players));
    c11.send('ready', { v: true, tank: '完全不存在的车' });
    const eBogus = await c11.wait('err', 1500);
    check('未知车型换车被拒并保持原车', !!eBogus && (await c11.wait('lobby', 1500) || { players: [] }).players[0].tank === 'sherman', JSON.stringify(eBogus));
    c11.send('ready', { v: true, tank: near });        // 合法有模型且符合 ±1 级
    let panther = null;
    for (let i = 0; i < 5 && !panther; i++) {
      const lob = await c11.wait('lobby', 1500);
      if (lob && (lob.players[0] || {}).tank === near) panther = lob;
    }
    check('合法车型正常换车', !!panther, '未等到换车广播');
    c11.close();
    await sleep(300);
  }

  console.log(`\n${pass} 通过, ${failCnt} 失败`);
  process.exit(failCnt ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
