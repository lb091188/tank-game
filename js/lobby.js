// lobby.js — 联机大厅: 创建/加入房间, 玩家列表, 准备, 房主开局(选地图)
window.SF = window.SF || {};

SF.Lobby = (() => {
  let connected = false, myId = 0, roomCode = '', players = [], isHost = false;
  let started = false;

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
      $('lobbyTip').innerHTML = `<span style="color:#e06c5a">连接失败: ${e.message}</span> — 请确认房主已运行 server.js 且地址正确`;
      return false;
    }
  }

  async function open() {
    document.getElementById('titleScreen').style.display = 'none';
    $('lobbyScreen').style.display = 'flex';
    fillMaps();
    if (!$('srvInput').value) $('srvInput').value = localStorage.getItem('sf_server') || (location.protocol.startsWith('http') ? location.host : '');
    if (!$('mpName').value) $('mpName').value = localStorage.getItem('sf_name') || '';
    if (location.protocol === 'https:') $('srvTip').textContent = '提示: https 页面连内网 ws 可能被浏览器拦截, 建议用房主打印的地址直接打开';
    if (!connected) await ensureConn();
  }

  function bindMsgs() {
    SF.Net.on('joined', (m) => { myId = m.you; roomCode = m.room; players = m.players; isHost = !!m.players.find(p => p.id === myId).host; render(); });
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

  function bind() {
    $('btnMp').addEventListener('click', open);
    $('btnCreate').addEventListener('click', async () => {
      if (!(await ensureConn())) return;
      const name = myName(); localStorage.setItem('sf_name', name);
      SF.Net.createRoom(name, myTank());
    });
    $('btnJoin').addEventListener('click', async () => {
      if (!(await ensureConn())) return;
      const name = myName(); localStorage.setItem('sf_name', name);
      SF.Net.joinRoom($('roomInput').value, name, myTank());
    });
    $('srvInput').addEventListener('change', () => { connected = false; });   // 换地址重连
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
