// hud.js — 战斗界面: 动态准星圈/血量装填/伤害数字/受击方向/小地图/战报/结算
window.SF = window.SF || {};

SF.HUD = (() => {
  const $ = (id) => document.getElementById(id);
  let dmgFloats = [];       // 伤害数字 {el, pos, life}
  let hitDirT = 0;
  let minimapBase = null;   // 预渲染地形

  function init(world) {
    // 小地图地形预渲染(90×90 采样)
    const cv = $('minimap');
    const off = document.createElement('canvas'); off.width = off.height = 180;
    const octx = off.getContext('2d');
    const T = world.terrain, N = 90;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -T.half + (i / N) * T.size, z = -T.half + (j / N) * T.size;
      const h = T.heightAt(x, z);
      const k = SF.Util.clamp((h - 5) / 45, 0, 1);
      octx.fillStyle = `rgb(${Math.round(38 + k * 60)},${Math.round(62 + k * 55)},${Math.round(34 + k * 40)})`;
      octx.fillRect(i / N * 180, j / N * 180, 180 / N + 1, 180 / N + 1);
    }
    minimapBase = off;
  }

  function project(pos) {
    const v = pos.clone().project(SF.Game.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // 双准星(WoT 式): 中心点=鼠标/相机瞄准; 散布圈=炮管实际指向(炮塔回转时滞后追赶) + 最小像素保证不开镜也可见
  function updateAimCircle(player, uiState) {
    const circle = $('aimCircle');
    if (!player.alive || !uiState.gunAim) { circle.style.display = 'none'; return; }
    const center = project(uiState.gunAim.pos);
    if (!center) { circle.style.display = 'none'; return; }
    circle.style.display = 'block';
    // 散布半径(米)@炮管指向距离 → 屏幕像素
    const cam = SF.Game.camera;
    const toAim = uiState.gunAim.pos.clone().sub(cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(toAim, cam.up).normalize();
    const radiusM = Math.max(0.4, player.disp / 100 * uiState.gunAim.dist);
    const b = project(uiState.gunAim.pos.clone().addScaledVector(right, radiusM));
    let rPx = b ? Math.hypot(b.x - center.x, b.y - center.y) : 30;
    rPx = Math.max(24, rPx);                      // 最小可见半径
    circle.style.width = circle.style.height = (rPx * 2) + 'px';
    circle.style.left = (center.x - rPx) + 'px';
    circle.style.top = (center.y - rPx) + 'px';
    circle.classList.toggle('aimed', player.disp < player.spec.dispersion.base * 1.35);
  }

  function dmgNumber(pos, text, color) {
    const el = document.createElement('div');
    el.className = 'dmg';
    el.textContent = text;
    el.style.color = color;
    $('dmgLayer').appendChild(el);
    dmgFloats.push({ el, pos: pos.clone(), life: 1.2 });
  }

  function hitFrom(source) {
    const player = SF.Game.world.player;
    const ang = SF.Util.angDiff(player.yaw, Math.atan2(source.x - player.x, source.z - player.z));
    $('hitDir').style.transform = `translate(-50%,-50%) rotate(${(-ang * 180 / Math.PI)}deg)`;
    $('hitDir').style.opacity = 1;
    hitDirT = 1.0;
  }

  // WoT 式命中判定提示: 准星下方显示"我打出去的结果"(击穿/跳弹/未击穿…)
  let hitFbT = 0;
  function hitFeedback(text, color) {
    const el = $('hitFeedback');
    el.textContent = text;
    el.style.color = color || '#fff';
    el.style.opacity = 1;
    el.style.fontSize = text.length > 6 ? '20px' : '26px';
    hitFbT = 1.4;
  }

  // 我方警报(与"打出去的结果"区分): 被击穿 / 我方模块损伤, 顶部红色横幅
  let alarmT = 0;
  function alarm(text) {
    const el = $('alarm');
    el.textContent = '⚠ ' + text;
    el.style.opacity = 1;
    alarmT = 2.6;
  }

  function log(text, color) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.color = color || '#cfd3d6';
    const box = $('log');
    box.prepend(el);
    while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => el.remove(), 6000);
  }

  function showMsg(text, dur = 2.5) {
    const el = $('msg');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(el._t);
    if (dur > 0) el._t = setTimeout(() => el.style.opacity = 0, dur * 1000);
  }

  function worldToMap(x, z, T) {
    return [(x + T.half) / T.size * 180, (z + T.half) / T.size * 180];
  }

  function update(dt, world, uiState) {
    const player = world.player, T = world.terrain;
    const U = SF.Util;

    // 状态条
    $('hpFill').style.width = (player.hp / player.spec.hp * 100) + '%';
    $('hpText').textContent = `${Math.ceil(player.hp)} / ${player.spec.hp}`;
    const rl = player.reloadT > 0 ? player.reloadT / player.spec.gun.reload : 0;
    $('reloadFill').style.width = ((1 - rl) * 100) + '%';
    $('reloadFill').classList.toggle('loading', rl > 0);
    $('speedText').textContent = Math.abs(Math.round(player.speed * 3.6)) + ' km/h';
    $('moduleTags').innerHTML = ['track', 'engine', 'gun']
      .filter(k => player.modules[k] > 0)
      .map(k => `<span class="mod">${SF.CFG.armor.modules[k].text}</span>`).join('');

    updateAimCircle(player, uiState);

    // 伤害数字上浮
    for (const d of dmgFloats) {
      d.life -= dt; d.pos.y += dt * 1.6;
      const p = project(d.pos);
      if (p) { d.el.style.left = p.x + 'px'; d.el.style.top = p.y + 'px'; }
      d.el.style.opacity = Math.max(0, d.life);
      if (d.life <= 0) { d.el.remove(); }
    }
    dmgFloats = dmgFloats.filter(d => d.life > 0);

    // 受击方向淡出
    if (hitDirT > 0) { hitDirT -= dt; $('hitDir').style.opacity = Math.max(0, hitDirT); }
    // 命中提示淡出(前 0.9s 常显, 后 0.5s 渐隐)
    if (hitFbT > 0) { hitFbT -= dt; $('hitFeedback').style.opacity = hitFbT > 0.5 ? 1 : hitFbT * 2; }
    // 警报淡出
    if (alarmT > 0) { alarmT -= dt; $('alarm').style.opacity = Math.min(1, alarmT); }

    // 装填环形读条(跟随准心) + 倒计时秒数
    const ring = $('reloadRing'), rctx = ring.getContext('2d');
    const rl2 = player.reloadT > 0 ? player.reloadT / player.spec.gun.reload : 0;
    rctx.clearRect(0, 0, 76, 76);
    const rt = $('reloadText');
    if (rl2 > 0) {
      ring.style.display = rt.style.display = 'block';
      rctx.lineWidth = 5;
      rctx.strokeStyle = 'rgba(10,12,8,.55)';
      rctx.beginPath(); rctx.arc(38, 38, 33, 0, Math.PI * 2); rctx.stroke();
      rctx.strokeStyle = '#c8b26a';
      rctx.beginPath(); rctx.arc(38, 38, 33, -Math.PI / 2, -Math.PI / 2 + (1 - rl2) * Math.PI * 2); rctx.stroke();
      rt.textContent = player.reloadT.toFixed(1);
    } else { ring.style.display = rt.style.display = 'none'; }

    // 小地图
    const cv = $('minimap'), ctx = cv.getContext('2d');
    ctx.drawImage(minimapBase, 0, 0);
    // 掩体点
    ctx.fillStyle = 'rgba(20,24,18,0.75)';
    for (const c of world.covers.list) {
      if (!c.blocksShells) continue;
      const [mx, my] = worldToMap(c.x, c.z, T);
      ctx.fillRect(mx - 1, my - 1, 2.5, 2.5);
    }
    // 被发现/最近开火的敌人
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const spotted = uiState.spotted.has(e) || world.time - (e.lastFireT || -99) < 5;
      if (!spotted) continue;
      const [mx, my] = worldToMap(e.x, e.z, T);
      ctx.fillStyle = '#e33';
      ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, 7); ctx.fill();
    }
    // 玩家箭头
    const [px, py] = worldToMap(player.x, player.z, T);
    ctx.save();
    ctx.translate(px, py); ctx.rotate(-player.yaw);   // 画布顺时针为正, 与世界 yaw 相反
    ctx.fillStyle = '#7fd67f';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 5); ctx.lineTo(-4.2, 5); ctx.closePath(); ctx.fill();
    ctx.restore();

    // 敌人名牌: 型号/PVE=坦克型号, 联机=玩家名 + 血条(可见时)
    const marks = $('markers'); marks.innerHTML = '';
    const mp = window.SF && SF.Game_mp && SF.Game_mp.mode !== 'sp' ? SF.Game_mp : null;
    const targets = mp ? [...mp.tanks.values()].filter(t => t.netId !== mp.myId) : world.enemies;
    for (const e of targets) {
      if (!e.alive) continue;
      const spotted = uiState.spotted.has(e) || world.time - (e.lastFireT || -99) < 5;
      if (!spotted) continue;
      const p = project(new THREE.Vector3(e.x, e.y + 5.0, e.z));
      if (!p || p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight) continue;
      const d = document.createElement('div');
      d.className = 'emark';
      d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
      let name = e.spec.name;
      if (mp && e.netId) { const pl = mp.players.find(q => q.id === e.netId); if (pl) name = pl.name; }
      const hpPct = SF.Util.clamp(e.hp / e.spec.hp, 0, 1) * 100;
      d.innerHTML = `<b>${name}</b><i><em style="width:${hpPct}%"></em></i>`;
      marks.appendChild(d);
    }

    // 任务进程(单机 PVE): 简略条 + Tab 详细面板
    if (uiState.mission) {
      const SYM = { LT: '◇', MT: '◈', TD: '△', HT: '●' };
      const DEF_CLS = { medium: 'MT', td: 'TD', heavy: 'HT', sherman: 'MT', sherman76: 'MT', jumbo: 'HT', hellcat: 'TD' };
      const clsOf = (e) => (e.spec && e.spec.cls) || DEF_CLS[e.type] || 'MT';
      const groups = {};
      for (const e of world.enemies) if (e.alive) { const c = clsOf(e); groups[c] = (groups[c] || 0) + 1; }
      const m = uiState.mission;
      const symLine = Object.entries(groups).map(([t, n]) => `<span class="sym">${SYM[t] || '◆'}×${n}</span>`).join('') || '<span class="sym" style="color:#8fd98f">已肃清</span>';
      $('missionBar').style.display = 'block';
      $('missionBar').innerHTML = `任务 ${m.idx + 1}/${m.total}　残敌 ${symLine}`;
      const detail = $('missionDetail');
      if (detail.style.display === 'block') {
        const rows = Object.entries(groups).map(([c, n]) =>
          `<div class="row"><span>${SYM[c] || '◆'} ${c === 'MT' ? '中型坦克' : c === 'HT' ? '重型坦克' : c === 'TD' ? '歼击车' : '轻型坦克'}</span><span>×${n}</span></div>`).join('');
        detail.innerHTML = `<h4>${m.name}</h4>${rows || '<div style="color:#8fd98f">本波已肃清</div>'}<div class="k">已击毁 ${m.kills} / ${m.totalEnemies}　·　Tab 收起</div>`;
      }
    }

    // 狙击镜
    $('sniperOverlay').style.display = uiState.sniper ? 'block' : 'none';

    // 点亮指示(被敌人发现): 灯泡
    $('detectLamp').style.opacity = uiState.detected ? 1 : 0;

    // 按键指示器(诊断用: 按下应点亮)
    document.querySelectorAll('#keypad span').forEach(s =>
      s.classList.toggle('on', !!(uiState.keys && uiState.keys[s.dataset.k])));
  }

  function endGame(win, stats) {
    if (document.exitPointerLock) document.exitPointerLock();   // 结算界面需要鼠标操作, 释放锁定
    $('overlay').style.display = 'flex';
    $('endTitle').textContent = win ? '✓ 任务完成' : '✗ 任务失败';
    $('endTitle').style.color = win ? '#8fd98f' : '#e06c5a';
    $('endStats').innerHTML =
      `击毁 <b>${stats.kills}</b> / ${stats.total}　用时 <b>${Math.floor(stats.time / 60)}:${String(Math.floor(stats.time % 60)).padStart(2, '0')}</b><br>` +
      `命中率 <b>${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}%</b>　` +
      `击穿率 <b>${stats.hits ? Math.round(stats.pens / stats.hits * 100) : 0}%</b>　` +
      `造成伤害 <b>${Math.round(stats.dmg)}</b>`;
  }

  function toggleMissionDetail() {
    const d = $('missionDetail');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
  }

  return { init, update, dmgNumber, hitFrom, hitFeedback, alarm, log, showMsg, endGame, project, toggleMissionDetail };
})();
