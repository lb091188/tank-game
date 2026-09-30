// lobby.js — 联机大厅: 钥匙兑换/建房(带密码)/凭房间号+密码加入, 准备, 房主开局
window.SF = window.SF || {};

SF.Lobby = (() => {
  let connected = false, myId = 0, roomCode = '', players = [], isHost = false;
  let started = false, roomPass = '';

  const $ = (id) => document.getElementById(id);

  function myName() { return ($('mpName') && $('mpName').value.trim()) || localStorage.getItem('sf_name') || '车长' + ((Math.random() * 90 + 10) | 0); }
  function myTank() { return localStorage.getItem('sf_mp_tank') || 'sherman'; }

  function fillMaps() {
    const sel = $('mpMap');
    if (sel.options.length) return;
    for (const m of SF.CFG.maps) {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.name;
      sel.appendChild(o);
    }
  }

  function tokenState() { return !!localStorage.getItem('sf_token'); }
  function renderTokenState() {
    $('keyState').textContent = tokenState() ? '✓ 已持有通行证' : '未兑换 (建房前需兑换钥匙)';
    $('keyState').style.color = tokenState() ? '#9ec97e' : '#6a6f5e';
  }

  async function ensureConn() {
    if (connected) return true;
    const addr = $('srvInput').value.trim() || (location.protocol.startsWith('http') ? location.host : '');
    localStorage.setItem('sf_server', addr);
    $('lobbyTip').textContent = '连接中… ' + (SF.Net.normalizeAddr(addr) || '(未填地址)');
    try {
      await SF.Net.connect(addr);
      connected = true;
      bindMsgs();
      $('lobbyTip').innerHTML = `已连接 <b>${SF.Net.address}</b> · 用车: ${SF.CFG.vehicles[myTank()] ? SF.CFG.vehicles[myTank()].name : myTank()}`;
      return true;
    } catch (e) {
      $('lobbyTip').innerHTML = `<span style="color:#e06c5a">连接失败: ${e.message}</span>`;
      return false;
    }
  }

  async function open() {
    document.getElementById('titleScreen').style.display = 'none';
    $('lobbyScreen').style.display = 'flex';
    fillMaps();
    if (!$('srvInput').value) $('srvInput').value = localStorage.getItem('sf_server') || (location.protocol.startsWith('http') ? location.host : '');
    if (!$('mpName').value) $('mpName').value = localStorage.getItem('sf_name') || '';
    renderTokenState();
    if (!connected) await ensureConn();
  }

  function bindMsgs() {
    SF.Net.on('joined', (m) => { myId = m.you; roomCode = m.room; roomPass = m.pass || roomPass; players = m.players; isHost = !!m.players.find(p => p.id === myId).host; render(); });
    SF.Net.on('err', (m) => {
      if (started) return;
      $('lobbyTip').textContent = m.msg || '错误';
      if ((m.msg || '').includes('通行令牌')) { $('keyInput').focus(); $('keyInput').select(); }
    });
    SF.Net.on('lobby', (m) => { players = m.players; render(); });
    SF.Net.on('start', (m) => {
      if (started) return;
      started = true;
      $('lobbyScreen').style.display = 'none';
      SF_StartMP(isHost ? 'host' : 'client', { you: myId, players: m.players, map: m.map, mode: m.mode });
    });
    SF.Net.on('disconnect', () => { if (!started) $('lobbyTip').textContent = '与服务器断开'; });
  }

  function render() {
    $('roomCodeShow').textContent = roomCode ? `房间 ${roomCode}` : '';
    $('inviteShow').textContent = isHost && roomCode ? (roomPass ? `密码 ${roomPass} — 连同房间号发给朋友` : '本房间无密码 — 只发房间号即可') : '';
    $('playerList').innerHTML = players.map(p =>
      `<div class="pl ${p.id === myId ? 'me' : ''}">${p.host ? '👑' : ''}${p.name}${p.id === myId ? ' (我)' : ''} · ${SF.CFG.vehicles[p.tank] ? SF.CFG.vehicles[p.tank].name : p.tank} ${p.ready ? '<b class="ok">✓准备</b>' : '<b class="no">未准备</b>'}</div>`
    ).join('');
    const meReady = (players.find(p => p.id === myId) || {}).ready;
    $('btnReady').textContent = meReady ? '取消准备' : '准备';
    $('btnReady').style.display = isHost ? 'none' : 'inline-block';
    $('hostPanel').style.display = isHost ? 'block' : 'none';
    $('joinBox').style.display = roomCode ? 'none' : 'flex';
    $('btnCreate').style.display = roomCode ? 'none' : 'inline-block';
  }

  async function redeem() {
    const k = $('keyInput').value.trim();
    if (!k) { $('lobbyTip').textContent = '请输入管理员发的钥匙 (例如 AB3D9FKX)'; return; }
    if (!(await ensureConn())) return;
    $('lobbyTip').textContent = '兑换中…';
    const r = await SF.Net.redeemKey(k);
    if (r.ok) {
      renderTokenState();
      $('keyInput').value = '';
      $('lobbyTip').textContent = '✓ 通行证已保存到本浏览器 (30 天有效), 现在可以建房了';
    } else {
      $('lobbyTip').textContent = `兑换失败: ${r.error || '钥匙无效'}`;
    }
  }

  function bind() {
    // PvE 版 (GitHub Pages) 不提供联机入口
    if (window.SF_EDITION === 'pve') { const b = $('btnMp'); if (b) b.style.display = 'none'; return; }
    $('btnMp').addEventListener('click', open);
    $('btnCreate').addEventListener('click', async () => {
      if (!(await ensureConn())) return;
      const name = myName(); localStorage.setItem('sf_name', name);
      SF.Net.createRoom(name, myTank(), $('roomPassInput').value.trim());
    });
    $('btnJoin').addEventListener('click', async () => {
      if (!(await ensureConn())) return;
      const room = $('roomInput').value.trim();
      if (!/^\d{4}$/.test(room)) { $('lobbyTip').textContent = '请输入 4 位房间号'; return; }
      const name = myName(); localStorage.setItem('sf_name', name);
      SF.Net.joinRoom(room, $('joinPassInput').value, name, myTank());
    });
    $('btnRedeem').addEventListener('click', redeem);
    $('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnRedeem').click(); });
    $('srvInput').addEventListener('change', () => { connected = false; });
    $('roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
    $('btnReady').addEventListener('click', () => {
      const me = players.find(p => p.id === myId) || {};
      SF.Net.setReady(!me.ready, myTank());
    });
    $('btnMpStart').addEventListener('click', () => {
      const unready = players.filter(p => !p.ready);
      if (unready.length) { $('lobbyTip').textContent = `还有 ${unready.length} 人未准备`; return; }
      if (players.length < 2) { $('lobbyTip').textContent = '至少需要 2 名玩家'; return; }
      SF.Net.startMatch(($('mpMap') && $('mpMap').value) || 'l01', ($('mpMode') && $('mpMode').value) || 'dm');
    });
    $('btnMpBack').addEventListener('click', () => location.reload());
  }

  return { bind };
})();
