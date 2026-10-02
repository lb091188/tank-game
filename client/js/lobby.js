// lobby.js — 联机大厅
// 两个阶段: ①小大厅(连接/昵称/钥匙/建房/加入) ②进房后直接进车库 — 右侧房间面板(死斗红蓝双列/合作单列),
//           底部出击按钮换成 开始(房主)/准备(成员), 车库选车即时上报
window.SF = window.SF || {};

SF.Lobby = (() => {
  let connected = false, bound = false, myId = 0, roomCode = '', players = [], isHost = false;
  let started = false, roomPass = '', roomTier = null, roomMode = 'dm';
  const TIER_NUM = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11 };
  const tierName = (n) => Object.keys(TIER_NUM).find(k => TIER_NUM[k] === n) || '?';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function myName() { return ($('mpName') && $('mpName').value.trim()) || ''; }
  function myTank() {
    // 陈旧存档自愈: 存档车已下架或无模型 → 回默认(防一辆半成品车炸掉全房资源加载)
    const t = localStorage.getItem('sf_mp_tank');
    if (t && SF.CFG.vehicles[t] && SF.Assets.hasModel(t)) return t;
    if (t) { console.warn('[lobby] 存档车型不可用, 已回退默认:', t); localStorage.setItem('sf_mp_tank', 'sherman'); }
    return 'sherman';
  }
  // 建房/加入前的昵称门槛: 必填(服务器也会查重, 重名会回报错误)
  function checkName() {
    const n = myName();
    if (!n) { tip('请先填写昵称', true); $('mpName').focus(); return ''; }
    localStorage.setItem('sf_name', n);
    return n;
  }

  function tip(msg, isErr) {
    $('lobbyTip').textContent = msg || '';
    $('lobbyTip').style.color = isErr ? '#e06c5a' : '';
  }
  // 车库阶段(无小大厅)的提示: 复用出击界面的小贴士条
  function garageTip(msg, isErr) {
    const el = $('tipOnTitle');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isErr ? '#e06c5a' : '';
    if (garageTip._t) clearTimeout(garageTip._t);
    if (msg) garageTip._t = setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 4000);
  }

  function fillMaps() { /* 地图选择已并入车库战场卡片(房主开局用所选地图), 小大厅不再需要 */ }

  /* ---------- 选车: 与车库同源(SF.CFG.garage), 按国别分组; 房间有等级锚时超限项置灰 ---------- */
  function fillTanks() {
    const sel = $('mpTank');
    if (sel.options.length) return;
    const groups = new Map();
    for (const t of SF.CFG.garage) {
      const nat = (t.tag || '?').split('·')[0];
      if (!groups.has(nat)) groups.set(nat, []);
      groups.get(nat).push(t);
    }
    for (const [nat, list] of groups) {
      const og = document.createElement('optgroup');
      og.label = nat;
      for (const t of list) {
        const o = document.createElement('option');
        o.value = t.type;
        o.textContent = `${t.tag.replace('·', ' ')} · ${t.desc}`;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
  }
  function syncTankSel() {
    const sel = $('mpTank'), v = myTank();
    sel.value = v;
    if (!sel.value) sel.value = 'sherman';   // 存档车已下架 → 回默认
  }
  function applyTierLimit() {
    const sel = $('mpTank'), hint = $('mpTierHint');
    let overLimit = false;
    for (const o of sel.options) {
      const t = TIER_NUM[(SF.CFG.vehicles[o.value] || {}).tier] || null;
      const bad = !!(roomTier && t && Math.abs(t - roomTier) > 1);
      o.disabled = bad;
      if (bad && o.value === sel.value) overLimit = true;
    }
    if (roomTier) {
      hint.textContent = `等级匹配: 本房间 ${tierName(roomTier)} 级 ±1` + (overLimit ? ' — 当前车超限, 请换车后再进房/准备' : '');
    } else hint.textContent = '';
    $('roomFoot') && roomFootRender();
  }

  /* ---------- 连接 ---------- */
  function tokenState() { return !!localStorage.getItem('sf_token'); }
  function renderState() {
    const cs = $('connState');
    if (connected) { cs.textContent = '● 已连接 ' + SF.Net.address; cs.className = 'on'; }
    else { cs.textContent = '● 未连接'; cs.className = 'off'; }
    $('keyState').textContent = tokenState() ? '✓ 已授权建房 (通行证存本浏览器, 30 天有效)' : '未授权 — 建房需要管理员钥匙, 加入房间不需要';
    $('keyState').style.color = tokenState() ? '#9ec97e' : '#6a6f5e';
  }

  async function ensureConn() {
    if (connected) return true;
    const cs = $('connState');
    cs.textContent = '● 连接服务器…'; cs.className = '';
    try {
      await SF.Net.connect('');
      connected = true;
      bindMsgs();
      renderState();
      tip('填昵称 → 创建或加入房间 · 出击界面选的坦克即联机用车');
      return true;
    } catch (e) {
      tip('连接失败: ' + e.message, true);
      renderState();
      return false;
    }
  }

  async function open() {
    // 已在房(赛后返回/误关重开): 直接回车库房间面板
    if (roomCode) { enterGarage(); return; }
    document.getElementById('titleScreen').style.display = 'none';
    $('lobbyScreen').style.display = 'flex';
    fillMaps();
    fillTanks();
    syncTankSel();
    applyTierLimit();
    if (!$('mpName').value) $('mpName').value = localStorage.getItem('sf_name') || '';
    renderState();
    await ensureConn();
  }

  /* ---------- 进房后: 车库 + 房间面板 ---------- */
  function enterGarage() {
    $('lobbyScreen').style.display = 'none';
    document.getElementById('titleScreen').style.display = 'flex';
    $('roomPanel').style.display = 'block';
    $('btnStart').style.display = 'none';
    $('mpDock').style.display = 'flex';
    const b = $('btnMp'); if (b) b.style.display = 'none';   // 在房不再进小大厅
    render();
  }
  function exitGarageUI() {
    $('roomPanel').style.display = 'none';
    $('btnStart').style.display = '';
    $('mpDock').style.display = 'none';
    const b = $('btnMp'); if (b) b.style.display = '';       // 恢复 CSS .on 控制
  }
  function resetRoom() {
    roomCode = ''; roomTier = null; roomMode = 'dm'; players = []; isHost = false; started = false; roomPass = '';
    exitGarageUI();
    applyTierLimit();
  }

  function roomFootRender() {
    const el = $('roomFoot');
    if (!el || !roomCode) return;
    const bits = [];
    if (roomTier) bits.push(`等级 ${tierName(roomTier)}±1`);
    if (isHost) bits.push(roomPass ? `密码 ${roomPass} — 连同房间号发给朋友` : '本房间无密码 — 只发房间号即可');
    bits.push('车库点车即时换车');
    el.textContent = bits.join(' · ');
  }

  function render() {
    if (!roomCode) return;
    const me = players.find(p => p.id === myId) || {};
    // 头部
    $('roomTitle').textContent = `房间 ${roomCode}`;
    $('roomCnt').textContent = `${players.length}/20`;
    $('roomModeSel').style.display = isHost ? '' : 'none';
    $('roomModeLbl').style.display = isHost ? 'none' : '';
    if (isHost) $('roomModeSel').value = roomMode;
    else $('roomModeLbl').textContent = roomMode === 'coop' ? '合作闯关' : '阵营死斗';
    // 名单: 死斗红蓝双列 / 合作单列(蓝列隐藏)
    const coop = roomMode === 'coop';
    document.querySelector('.teamCol.blue').style.display = coop ? 'none' : '';
    document.querySelector('.teamCol.red .tn').textContent = coop ? '车组' : '红军';
    const row = (p) =>
      `<div class="pl2 ${p.id === myId ? 'me' : ''}">${p.host ? '👑' : ''}${esc(p.name)} <span class="tk">${esc((SF.CFG.vehicles[p.tank] || {}).name || p.tank)}</span> ${p.ready ? '<span class="ok">✓</span>' : '<span class="no">…</span>'}</div>`;
    document.querySelector('.teamCol.red .plist').innerHTML = players.filter(p => coop || p.team !== 1).map(row).join('') || '<div class="pl2" style="color:#5b6052">(空)</div>';
    if (!coop) document.querySelector('.teamCol.blue .plist').innerHTML = players.filter(p => p.team === 1).map(row).join('') || '<div class="pl2" style="color:#5b6052">(空)</div>';
    // 阵营加入按钮: 己方高亮"已在此侧", 对方可点; 合作隐藏
    for (const btn of document.querySelectorAll('.teamHead button')) {
      const t = +btn.dataset.team;
      btn.style.display = coop ? 'none' : '';
      btn.textContent = (me.team === t) ? '✓已在此侧' : '＋加入';
      btn.classList.toggle('mine', me.team === t);
    }
    // 底部主按钮: 房主=开始 / 成员=准备
    $('btnMpAction').textContent = isHost ? '开 始 对 战' : (me.ready ? '取消准备' : '准 备');
    $('btnMpAction').classList.toggle('ready', !isHost && !!me.ready);
    roomFootRender();
  }

  // 赛后从战场回车库(房间保留): 复位战斗态, 名单由服务端 end 后的 lobby 广播刷新
  function reenter() {
    started = false;
    enterGarage();
    garageTip('对战结束 — 可换车/换阵营/准备后再次开局');
  }

  function bindMsgs() {
    if (bound) return; bound = true;
    SF.Net.on('joined', (m) => {
      myId = m.you; roomCode = m.room; roomPass = m.pass || roomPass; roomTier = m.tier ?? null; roomMode = m.mode || 'dm';
      players = m.players; isHost = !!m.players.find(p => p.id === myId).host;
      tip(''); applyTierLimit(); enterGarage();
    });
    SF.Net.on('err', (m) => {
      if (started) return;
      tip(m.msg || '错误', true);
      garageTip(m.msg || '错误', true);
      const s = m.msg || '';
      if (s.includes('通行令牌')) { if ($('lobbyScreen').style.display !== 'none') { $('keyInput').focus(); $('keyInput').select(); } }
      else if (s.includes('昵称')) { if ($('lobbyScreen').style.display !== 'none') { $('mpName').focus(); $('mpName').select(); } }
      else if (s.includes('等级')) {   // 小大厅换车被拒: 选择器回滚到服务器登记的车(车库卡片以面板登记为准)
        const me = players.find(p => p.id === myId);
        if (me && $('lobbyScreen').style.display !== 'none') { $('mpTank').value = me.tank; localStorage.setItem('sf_mp_tank', me.tank); }
      } else if (s.includes('解散')) { resetRoom(); open(); }
    });
    SF.Net.on('left', () => { resetRoom(); open(); });   // 主动离房回小大厅
    SF.Net.on('lobby', (m) => {
      players = m.players;
      if (m.tier !== undefined) roomTier = m.tier;
      if (m.mode !== undefined) roomMode = m.mode;
      isHost = !!(players.find(p => p.id === myId) || {}).host;
      applyTierLimit();
      if (roomCode && !started) render();
    });
    SF.Net.on('start', (m) => {
      if (started) return;
      started = true;
      $('lobbyScreen').style.display = 'none';
      $('roomPanel').style.display = 'none';
      $('mpDock').style.display = 'none';
      SF_StartMP(isHost ? 'host' : 'client', { you: myId, players: m.players, map: m.map, mode: m.mode });
    });
    // 断线释放连接态: 下次操作自动重连(昵称随之释放/重新占用)
    SF.Net.on('disconnect', () => {
      if (!started) { connected = false; renderState(); resetRoom(); tip('与服务器断开, 操作时将自动重连', true); }
    });
  }

  async function redeem() {
    const k = $('keyInput').value.trim();
    if (!k) { tip('请输入管理员发的钥匙 (例如 AB3D9FKX)', true); return; }
    if (!(await ensureConn())) return;
    tip('授权中…');
    const r = await SF.Net.redeemKey(k);
    if (r.ok) {
      renderState();
      $('keyInput').value = '';
      tip('✓ 授权成功 — 现在可以建房了');
    } else {
      tip('授权失败: ' + (r.error || '钥匙无效'), true);
    }
  }

  function bind() {
    // PvE 版 (GitHub Pages) 不提供联机入口
    if (window.SF_EDITION === 'pve') { const b = $('btnMp'); if (b) b.style.display = 'none'; return; }
    $('btnMp').addEventListener('click', open);
    $('btnCreate').addEventListener('click', async () => {
      if (!(await ensureConn())) return;
      const name = checkName(); if (!name) return;
      SF.Net.createRoom(name, myTank(), $('roomPassInput').value.trim());
    });
    $('btnJoin').addEventListener('click', async () => {
      if (!(await ensureConn())) return;
      const room = $('roomInput').value.trim();
      if (!/^\d{4}$/.test(room)) { tip('请输入 4 位房间号', true); return; }
      const name = checkName(); if (!name) return;
      SF.Net.joinRoom(room, $('joinPassInput').value, name, myTank());
    });
    $('btnRedeem').addEventListener('click', redeem);
    $('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnRedeem').click(); });
    $('mpName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnCreate').focus(); });
    // 小大厅下拉换车: 存档 + 房内即时上报(ready 消息顺带车位, 保持当前准备态; 服务端校验等级)
    $('mpTank').addEventListener('change', () => {
      const t = $('mpTank').value;
      localStorage.setItem('sf_mp_tank', t);
      if (roomCode) {
        const me = players.find(p => p.id === myId) || {};
        SF.Net.setReady(!!me.ready, t);
      }
    });
    // 车库卡片换车(main.js 发 sf-mp-tank 事件): 同样即时上报
    document.addEventListener('sf-mp-tank', (e) => {
      if (!roomCode || started) return;
      const me = players.find(p => p.id === myId) || {};
      SF.Net.setReady(!!me.ready, e.detail);
    });
    $('roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
    $('joinPassInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

    $('btnMpBack').addEventListener('click', () => {
      $('lobbyScreen').style.display = 'none';
      document.getElementById('titleScreen').style.display = 'flex';
    });

    /* ----- 房间面板(车库阶段) ----- */
    $('roomModeSel').addEventListener('change', () => { if (isHost) SF.Net.setMode($('roomModeSel').value); });
    for (const btn of document.querySelectorAll('.teamHead button'))
      btn.addEventListener('click', () => { if (roomMode === 'dm' && !started) SF.Net.setTeam(+btn.dataset.team); });
    $('btnMpAction').addEventListener('click', () => {
      if (!roomCode || started) return;
      if (isHost) {
        const unready = players.filter(p => !p.ready);
        if (unready.length) { garageTip(`还有 ${unready.length} 人未准备 — ${unready.map(p => p.name).slice(0, 3).join('、')}${unready.length > 3 ? '…' : ''}`, true); return; }
        if (players.length < 2) { garageTip('至少需要 2 名玩家', true); return; }
        SF.Net.startMatch(localStorage.getItem('sf_map') || 'l01', roomMode);
      } else {
        const me = players.find(p => p.id === myId) || {};
        SF.Net.setReady(!me.ready, myTank());
      }
    });
    $('btnMpExit').addEventListener('click', () => { SF.Net.leave(); });
  }

  return { bind, reenter };
})();
