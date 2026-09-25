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

  // 动态准星圈: 用瞄准点处半径(米)投影为屏幕像素
  function updateAimCircle(player, aimPoint) {
    const circle = $('aimCircle');
    if (!player.alive || !aimPoint) { circle.style.display = 'none'; return; }
    circle.style.display = 'block';
    const distAim = aimPoint.pos.distanceTo(SF.Game.camera.position);
    const radiusM = Math.max(0.4, player.disp / 100 * distAim);   // 散布半径(米) @ 瞄准距离
    // 取垂直于视线的横向向量做屏幕投影
    const cam = SF.Game.camera;
    const toAim = aimPoint.pos.clone().sub(cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(toAim, cam.up).normalize();
    const a = project(aimPoint.pos), b = project(aimPoint.pos.clone().addScaledVector(right, radiusM));
    if (!a || !b) { circle.style.display = 'none'; return; }
    const rPx = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y));
    circle.style.width = circle.style.height = (rPx * 2) + 'px';
    circle.style.left = (window.innerWidth / 2 - rPx) + 'px';
    circle.style.top = (window.innerHeight / 2 - rPx) + 'px';
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

    updateAimCircle(player, uiState.aimPoint);

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

    // 敌人血条(可见时)
    const marks = $('markers'); marks.innerHTML = '';
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const spotted = uiState.spotted.has(e) || world.time - (e.lastFireT || -99) < 5;
      if (!spotted) continue;
      const p = project(new THREE.Vector3(e.x, e.y + 4.4, e.z));
      if (!p || p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight) continue;
      const d = document.createElement('div');
      d.className = 'emark';
      d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
      d.innerHTML = `<i style="width:${Math.max(6, e.hp / e.spec.hp * 46)}px"></i>`;
      marks.appendChild(d);
    }

    // 狙击镜
    $('sniperOverlay').style.display = uiState.sniper ? 'block' : 'none';

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

  return { init, update, dmgNumber, hitFrom, log, showMsg, endGame, project };
})();
