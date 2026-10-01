// hud.js — 战斗界面: 动态准星圈/血量装填/伤害数字/受击方向/小地图/战报/结算
window.SF = window.SF || {};

SF.HUD = (() => {
  const $ = (id) => document.getElementById(id);
  let dmgFloats = [];       // 伤害数字 {el, pos, life}
  let shotDirT = 0;         // 炮口来向箭头
  let shotMarks = [];       // 炮口位置(小地图, 3s 渐隐)
  let hitDirT = 0;
  let minimapBase = null;   // 预渲染地形(含静止掩体点)
  let emarks = new Map();   // 敌车 → 名牌持久 DOM 节点
  let gearEls = null;       // 挡位灯节点(缓存)

  // 每帧 HUD 写入统一走脏检查: 值不变就不碰 DOM(此前多个 innerHTML 每帧重新赋值, 是无谓的主线程开销)
  function setTxt(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
  function setHtml(el, v) { if (el._h !== v) { el._h = v; el.innerHTML = v; } }
  function setW(el, v) { if (el._w !== v) { el._w = v; el.style.width = v; } }
  function setOp(el, v) { if (el._o !== v) { el._o = v; el.style.opacity = v; } }
  function setDisp(el, v) { if (el._d !== v) { el._d = v; el.style.display = v; } }

  function init(world) {
    // 小地图地形预渲染(90×90 采样)
    const cv = $('minimap');
    const off = document.createElement('canvas'); off.width = off.height = 180;
    const octx = off.getContext('2d');
    const T = world.terrain, N = 90;
    const PAL = world.map.theme === 'city' ? [52, 52, 54] : world.map.theme === 'rock' ? [78, 76, 68] : world.map.theme === 'sand' ? [148, 128, 92] : world.map.theme === 'winter' ? [188, 194, 204] : [38, 62, 34];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -T.half + (i / N) * T.size, z = -T.half + (j / N) * T.size;
      const h = T.heightAt(x, z);
      const k = SF.Util.clamp((h - 5) / 45, 0, 1);
      octx.fillStyle = `rgb(${Math.round(PAL[0] + k * 55)},${Math.round(PAL[1] + k * 48)},${Math.round(PAL[2] + k * 42)})`;
      octx.fillRect(i / N * 180, j / N * 180, 180 / N + 1, 180 / N + 1);
    }
    // 掩体点一并预渲染进底图(静止): 深灰=硬掩体(挡弹), 绿=隐蔽物(挡视线不挡弹, 可蹲入隐蔽)
    octx.fillStyle = 'rgba(20,24,18,0.75)';
    for (const c of world.covers.list) {
      if (!c.blocksShells) continue;
      const [mx, my] = worldToMap(c.x, c.z, T);
      octx.fillRect(mx - 1, my - 1, 2.5, 2.5);
    }
    octx.fillStyle = 'rgba(74,132,52,0.85)';
    for (const c of world.covers.list) {
      if (!c.blocksSpot || c.blocksShells) continue;
      const [mx, my] = worldToMap(c.x, c.z, T);
      octx.fillRect(mx - 1, my - 1, 2, 2);
    }
    minimapBase = off;
    // 名牌节点池换场重置: 上一场的敌车节点全部移除
    emarks.clear();
    $('markers').innerHTML = '';
  }

  function project(pos) {
    const cam = SF.Game.camera;
    // 相机身后的点投影会镜像翻转(准星圈/名牌瞬移到屏幕对侧, 自由视角转动时满屏乱跳) → 判不可见
    const v = pos.clone().applyMatrix4(cam.matrixWorldInverse);   // 视空间: 相机看向 -Z
    if (v.z > -0.3) return null;
    v.applyMatrix4(cam.projectionMatrix);                         // → NDC(applyMatrix4 自带透视除法)
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // 双准星(WoT 式): 中心点=鼠标/相机瞄准; 散布圈=炮管实际指向(炮塔回转时滞后追赶) + 最小像素保证不开镜也可见
  function updateAimCircle(player, world, uiState) {
    const circle = $('aimCircle');
    // 火炮(弹道射击): 圆心=弹道积分真实落点(见 main.updateTraj), 散布椭圆随落角拉长(平射≈圆/曲射纵长)
    const spg = player.spec.cls === 'SPG';
    let aim = spg ? uiState.aimPoint : uiState.gunAim;
    if (!player.alive || !aim) { circle.style.display = 'none'; return; }
    let pos = aim.pos, aimDist = Math.hypot(aim.pos.x - player.x, aim.pos.z - player.z);
    if (spg) {
      // 圆心=炮弹真实落点(按当前炮管姿态弹道积分, main.updateTraj 输出):
      // 转炮/压仰角时圈如实跟着落点走, 不再按"炮管方位×瞄准距离"偏到准星旁边
      const L = uiState.trajLand;
      if (L) {
        pos = new THREE.Vector3(L.x, L.y + 0.05, L.z);
        aimDist = Math.hypot(L.x - player.x, L.z - player.z);
      }
    }
    const center = project(pos);
    if (!center) { circle.style.display = 'none'; return; }
    circle.style.display = 'block';
    // 散布半径(米)@炮管指向距离 → 屏幕像素
    const cam = SF.Game.camera;
    const radiusM = Math.max(0.4, player.disp / 100 * aimDist);
    const gd = player.gunDir();
    const gh = Math.atan2(gd.x, gd.z);
    const fU = { x: Math.sin(gh), z: Math.cos(gh) }, rU = { x: Math.cos(gh), z: -Math.sin(gh) };
    const prj = (ux, uz, m) => project(new THREE.Vector3(pos.x + ux * m, pos.y + 0.05, pos.z + uz * m));
    if (spg) {
      // 抛物线弹道: 落点散布为沿射击方向拉长的椭圆; 平射低伸(落角小)≈正圆, 曲射高抛≈纵长 2.6 倍
      const elong = Math.min(1 + (uiState.trajLand ? uiState.trajLand.slope : 1.8) * 0.9, 2.6);
      const pLong = prj(fU.x, fU.z, radiusM * elong), pShort = prj(rU.x, rU.z, radiusM);
      if (!pLong || !pShort) { circle.style.display = 'none'; return; }
      const lv = { x: pLong.x - center.x, y: pLong.y - center.y };
      const sv = { x: pShort.x - center.x, y: pShort.y - center.y };
      const hl = Math.max(20, Math.hypot(lv.x, lv.y)), hs = Math.max(10, Math.hypot(sv.x, sv.y));
      circle.style.width = (hl * 2) + 'px';
      circle.style.height = (hs * 2) + 'px';
      circle.style.left = (center.x - hl) + 'px';
      circle.style.top = (center.y - hs) + 'px';
      circle.style.transform = `rotate(${Math.atan2(lv.y, lv.x)}rad)`;
    } else {
      const toAim = pos.clone().sub(cam.position).normalize();
      const right = new THREE.Vector3().crossVectors(toAim, cam.up).normalize();
      const b = prj(right.x, right.z, radiusM);
      let rPx = b ? Math.hypot(b.x - center.x, b.y - center.y) : 30;
      rPx = Math.max(24, rPx);                      // 最小可见半径
      circle.style.width = circle.style.height = (rPx * 2) + 'px';
      circle.style.left = (center.x - rPx) + 'px';
      circle.style.top = (center.y - rPx) + 'px';
      circle.style.transform = '';
    }
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

  // 炮口来向: 小地图渐隐标记; showArrow=true 时屏幕金色箭头(近弹)
  function shotFrom(pos, showArrow) {
    shotMarks.push({ x: pos.x, z: pos.z, life: 3 });
    if (shotMarks.length > 6) shotMarks.shift();
    if (showArrow) {
      const player = SF.Game.world.player;
      const ang = SF.Util.angDiff(player.yaw, Math.atan2(pos.x - player.x, pos.z - player.z));
      $('shotDir').style.transform = `translate(-50%,-50%) rotate(${(-ang * 180 / Math.PI)}deg)`;
      $('shotDir').style.opacity = 1;
      shotDirT = 0.9;
    }
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

  // 小地图敌车类标(WoT 式): 与 SF.ClsIcon 同几何 —— 菱形斜切条带(轻坦整颗/中坦一缝/重坦两缝), ▽歼击 □火炮
  function clsMark(ctx, cls, x, y, col) {
    const h = 6.6, w = h * 1.35;
    ctx.fillStyle = col || '#e33';
    if (cls === 'TD') {
      ctx.beginPath(); ctx.moveTo(x - w * 0.5, y - h * 0.5); ctx.lineTo(x + w * 0.5, y - h * 0.5); ctx.lineTo(x, y + h * 0.6); ctx.closePath(); ctx.fill(); return;
    }
    if (cls === 'SPG') { ctx.fillRect(x - h / 2, y - h / 2, h, h); return; }
    const n = cls === 'LT' ? 1 : cls === 'MT' ? 2 : cls === 'HT' ? 3 : 0;
    if (!n) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); return; }
    const ext = w * h, hyp = Math.sqrt(h * h + w * w);
    const gap = 1.2 * hyp, bw = (ext - (n - 1) * gap) / n;
    for (let k = 0; k < n; k++) {
      const c0 = -ext / 2 + k * (bw + gap), c1 = c0 + bw;
      const q = [[c0, false], [c0, true], [c1, true], [c1, false]].map(([c, upper]) => {
        const px = (upper ? (c + ext / 2) : (c - ext / 2)) / (2 * h);
        const py = (h / w) * px + (upper ? -h / 2 : h / 2);
        return [x + px, y + py];
      });
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath(); ctx.fill();
    }
  }

  // 指向仪(WoT 式): 罗盘圈上车体剪影 + 炮塔炮管, 屏幕上方=镜头方向 —— 车体回转/炮塔滞后一眼可读
  function drawDirWidget(player, uiState) {
    const cv = $('dirWidget'), ctx = cv.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);   // 192×192 物理像素 → 96×96 逻辑坐标(高清屏不糊)
    ctx.clearRect(0, 0, 96, 96);
    if (!uiState.camYaw && uiState.camYaw !== 0) return;
    const cx = 48, cy = 48, R = 40;
    const U = SF.Util;
    ctx.globalAlpha = player.alive ? 1 : 0.35;
    // 罗盘圈 + 四向刻度
    ctx.strokeStyle = 'rgba(200,178,106,.45)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * (R - 4), cy - Math.cos(a) * (R - 4));
      ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      ctx.stroke();
    }
    // 车体(先画, 灰绿): 履带×2 + 楔形首上车体, 屏幕上方=镜头前方
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-U.angDiff(uiState.camYaw, player.yaw));
    ctx.fillStyle = 'rgba(150,158,146,.8)';
    ctx.fillRect(-15, -17, 6, 34); ctx.fillRect(9, -17, 6, 34);      // 履带
    ctx.fillStyle = '#7f8a76';
    ctx.beginPath();                                                  // 车体(前端收楔)
    ctx.moveTo(-9, -8); ctx.lineTo(-5, -18); ctx.lineTo(5, -18); ctx.lineTo(9, -8);
    ctx.lineTo(9, 16); ctx.lineTo(-9, 16); ctx.closePath(); ctx.fill();
    ctx.restore();
    // 炮塔 + 炮管(后画, 金色): 炮塔回转滞后于瞄准时, 与车体的夹角直观可见
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-U.angDiff(uiState.camYaw, player.turretYaw));
    ctx.strokeStyle = '#c8b26a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, -(R - 2)); ctx.stroke();   // 炮管
    ctx.fillStyle = '#c8b26a';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    // 挡位灯: D1-D3 前进(绿) / N 空挡(黄) / R1-R2 倒车(红)
    // 联机客户端挡位不在快照里: 行驶中按速度符号+大小推断挡位(阈值与换挡滞回带一致)
    if (!gearEls) gearEls = document.querySelectorAll('#gearRow span');
    let g = player.gear || 'D1';
    const v = Math.abs(player.speed);
    if (v > 0.5) {
      const GB = SF.CFG.sim.gearbox;
      const fwd = player.speed > 0;
      const caps = fwd ? GB.fwd : GB.rev;
      const top = player.spec.maxSpeed * (fwd ? 1 : (player.spec.reverseRatio || 0.42));
      let idx = 0;
      for (let i = 0; i < caps.length; i++) if (v > top * caps[i] * 0.93) idx = i;
      g = (fwd ? 'D' : 'R') + (idx + 1);
    }
    gearEls.forEach(s => s.classList.toggle('on', s.dataset.g === g));
  }

  function update(dt, world, uiState) {
    const player = world.player, T = world.terrain;
    const U = SF.Util;

    // 状态条
    setW($('hpFill'), (player.hp / player.spec.hp * 100) + '%');
    setHtml($('hpText'), `${SF.ClsIcon(player.spec.cls)} ${player.spec.name}　${Math.ceil(player.hp)} / ${player.spec.hp}`);
    const rlTotal = player.reloadTotal || player.spec.gun.reload;
    const rl = player.reloadT > 0 ? player.reloadT / rlTotal : 0;
    setW($('reloadFill'), ((1 - rl) * 100) + '%');
    $('reloadFill').classList.toggle('loading', rl > 0);
    // 弹夹余弹(连发炮): 底部状态条显示 ◉● 圆点
    const _al = player.spec.gun.autoloader;
    setHtml($('clipInfo'), _al
      ? Array.from({ length: _al.clip }, (_, i) => `<i class="${i < player.clipLeft ? 'full' : ''}"></i>`).join('') + `<em>${player.clipLeft}/${_al.clip}</em>`
      : '');
    // 挡位 + 速度: 挡位由左下指向仪的 D/N/R 灯指示, 速度条只报速度
    setTxt($('speedText'), Math.abs(Math.round(player.speed * 3.6)) + ' km/h');
    setHtml($('moduleTags'), ['track', 'engine', 'gun', 'ammo']
      .filter(k => player.modules[k] > 0)
      .map(k => `<span class="mod">${SF.CFG.armor.modules[k].text}</span>`).join(''));

    // 增益条(补给空投): 图标 + 层数 + 剩余秒, 无增益时收起
    const bb = $('buffBar');
    if (uiState.buffs && uiState.buffs.length) {
      setHtml(bb, uiState.buffs.map(b =>
        `<span class="buff" style="border-color:${b.css};color:${b.css}"><img src="${b.icon}" alt="">${b.name}${b.lv > 1 ? ' ×' + b.lv : ''}<i>${b.t}s</i></span>`).join(''));
      setDisp(bb, 'flex');
    } else setDisp(bb, 'none');

    updateAimCircle(player, world, uiState);
    drawDirWidget(player, uiState);
    // 鹰眼(火炮俯视)无中心十字: 落点即准星(绿色散布椭圆), WoT 式
    $('crosshair').style.display = (uiState.sniper && player.spec.cls === 'SPG') ? 'none' : 'block';

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
    // 炮口来向箭头淡出 + 小地图标记衰减
    if (shotDirT > 0) { shotDirT -= dt; $('shotDir').style.opacity = Math.max(0, shotDirT); }
    for (const m of shotMarks) m.life -= dt;
    shotMarks = shotMarks.filter(m => m.life > 0);
    // 警报淡出
    if (alarmT > 0) { alarmT -= dt; $('alarm').style.opacity = Math.min(1, alarmT); }

    // 装填环形读条(跟随准心) + 倒计时秒数
    const ring = $('reloadRing'), rctx = ring.getContext('2d');
    const rl2 = player.reloadT > 0 ? player.reloadT / rlTotal : 0;
    const rt = $('reloadText');
    if (rl2 > 0) {
      rctx.clearRect(0, 0, 76, 76);
      setDisp(ring, 'block'); setDisp(rt, 'block');
      rctx.lineWidth = 5;
      rctx.strokeStyle = 'rgba(10,12,8,.55)';
      rctx.beginPath(); rctx.arc(38, 38, 33, 0, Math.PI * 2); rctx.stroke();
      rctx.strokeStyle = '#c8b26a';
      rctx.beginPath(); rctx.arc(38, 38, 33, -Math.PI / 2, -Math.PI / 2 + (1 - rl2) * Math.PI * 2); rctx.stroke();
      setTxt(rt, player.reloadT.toFixed(1));
    } else { setDisp(ring, 'none'); setDisp(rt, 'none'); }
    // 炮口至瞄准点距离(WoT 式准星距离读数); 火炮显示 炮→落点 射程 + 弹道飞行时间
    const dEl = $('distText');
    if (player.spec.cls === 'SPG' && uiState.aimPoint)
      setTxt(dEl, Math.round(Math.hypot(uiState.aimPoint.pos.x - player.x, uiState.aimPoint.pos.z - player.z)) + ' m'
        + (uiState.trajT > 0 ? ` · 飞行 ${uiState.trajT.toFixed(1)}s` : ''));
    else
      setTxt(dEl, uiState.gunAim ? Math.round(uiState.gunAim.dist) + ' m' : '');
    // 装甲等效指示(WoT 看甲): 瞄准敌人部位时显示 等效厚度/可否击穿/跳弹警告(含过穿与归一化)
    // 只对已点亮的目标显示 —— 未点亮的隐藏模型不给装甲情报(射线是几何的, 穿草/隔坡也能命中模型)
    const ai = $('armorInfo');
    const ap = uiState.gunAim;   // 用炮口指向(实际弹道将命中的部位)
    if (ap && ap.hit && ap.hit.armor > 0 && ap.hit.normal && (!ap.hit.tank || (ap.hit.tank.alive && uiState.spotted.has(ap.hit.tank)))) {
      const camDir = new THREE.Vector3();
      SF.Game.camera.getWorldDirection(camDir);
      const inc = Math.acos(SF.Util.clamp(-camDir.dot(ap.hit.normal), -1, 1));
      const armor = ap.hit.armor, cal = player.spec.gun.cal || 75;
      if (inc > SF.CFG.armor.ricochetAngle && !(cal > armor * 3)) {
        setTxt(ai, '大角度 · 会跳弹');
        if (ai._c !== '#9aa0a6') { ai._c = '#9aa0a6'; ai.style.color = '#9aa0a6'; }
      } else {
        let norm = 5 * Math.PI / 180;
        if (cal > armor * 2) norm *= 2;   // 2 倍口径: 归一化翻倍
        const eff = Math.round(armor / Math.max(Math.cos(Math.max(0, inc - norm)), 0.05));
        const pen = player.spec.gun.pen * 0.9;   // 按平均穿深(含浮动)估
        const ok = pen >= eff;
        setTxt(ai, `等效 ${eff}mm · ${ok ? '可击穿' : '难击穿'}`);
        const c2 = ok ? '#9fe08a' : '#e07a6a';
        if (ai._c !== c2) { ai._c = c2; ai.style.color = c2; }
      }
    } else setTxt(ai, '');

    // 小地图: 掩体点已预渲染进底图, 每帧只画动态要素
    const cv = $('minimap'), ctx = cv.getContext('2d');
    ctx.drawImage(minimapBase, 0, 0);
    // 玩家位置 + WoT 式双圈: 视距圈(淡绿, 圈内才可能点亮) + 50m 强制点亮圈(亮绿)
    const [px, py] = worldToMap(player.x, player.z, T);
    if (player.alive) {
      const sc = 180 / T.size, vr = player.spec.view || SF.CFG.player.viewRange;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(127,214,127,.35)';
      ctx.beginPath(); ctx.arc(px, py, vr * sc, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(127,214,127,.8)';
      ctx.beginPath(); ctx.arc(px, py, 50 * sc, 0, 7); ctx.stroke();
    }
    // 敌标(WoT 式): 点亮=实时红标; 开炮暴露=亮标; 丢亮点=停在最后已知位置的暗标
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (uiState.spotted.has(e)) {
        const [mx, my] = worldToMap(e.x, e.z, T);
        clsMark(ctx, e.spec.cls, mx, my);
      } else if (world.time - (e.lastFireT || -99) < 5) {
        const [mx, my] = worldToMap(e.x, e.z, T);
        clsMark(ctx, e.spec.cls, mx, my);
      } else {
        const lk = uiState.lastKnown && uiState.lastKnown.get(e);
        if (lk) {
          const [mx, my] = worldToMap(lk.x, lk.z, T);
          clsMark(ctx, e.spec.cls, mx, my, 'rgba(227,70,55,.45)');
        }
      }
    }
    // 玩家箭头
    ctx.save();
    ctx.translate(px, py); ctx.rotate(Math.PI - player.yaw);   // 箭头形朝上, 而 yaw=0 车头指向世界+z(画布下方): 先翻 180°, 画布顺时针为正与 yaw 相反
    ctx.fillStyle = '#7fd67f';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 5); ctx.lineTo(-4.2, 5); ctx.closePath(); ctx.fill();
    ctx.restore();

    // 补给空投(PVE): 类型色脉冲菱形(小地图与大地图共用本画布)
    for (const pk of (uiState.pickups || [])) {
      const [mx, my] = worldToMap(pk.x, pk.z, T);
      const s2 = 3 + Math.sin(world.time * 5) * 1.1;
      ctx.save();
      ctx.translate(mx, my); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = pk.css;
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1;
      ctx.fillRect(-s2, -s2, s2 * 2, s2 * 2); ctx.strokeRect(-s2, -s2, s2 * 2, s2 * 2);
      ctx.restore();
    }

    // 鹰眼视野范围(WoT 火炮): 绿框=俯视相机当前看得到的地面区域, 中心随准星移动
    if (uiState.arty) {
      const [vx, vy] = worldToMap(uiState.arty.x, uiState.arty.z, T);
      const s = 180 / T.size;
      ctx.strokeStyle = 'rgba(127,214,127,.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx - uiState.arty.w * s / 2, vy - uiState.arty.h * s / 2, uiState.arty.w * s, uiState.arty.h * s);
    }

    // 任务地点: 当前波次敌军区域中心(随任务推进自动移动), 金色脉冲圈
    if (uiState.mission && world.map && world.map.waves[uiState.mission.idx]) {
      const defs = world.map.waves[uiState.mission.idx].enemies;
      if (defs.length) {
        const cx = defs.reduce((s2, d) => s2 + d.pos[0], 0) / defs.length;
        const cz = defs.reduce((s2, d) => s2 + d.pos[1], 0) / defs.length;
        const [mx, my] = worldToMap(cx, cz, T);
        const pulse = 1 + Math.sin(world.time * 4) * 0.25;
        ctx.strokeStyle = '#e8c977'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mx, my, 6 * pulse, 0, 7); ctx.stroke();
        ctx.fillStyle = '#e8c977';
        ctx.beginPath(); ctx.arc(mx, my, 2, 0, 7); ctx.fill();
        ctx.font = '10px sans-serif';
        ctx.fillText('任务', mx + 8, my + 3);
      }
    }
    // 炮口来向: 渐隐橙点
    for (const m of shotMarks) {
      const [mx, my] = worldToMap(m.x, m.z, T);
      ctx.globalAlpha = Math.min(1, m.life / 3);
      ctx.fillStyle = '#ff8a50';
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 上次阵亡位置: 红 ✕
    if (uiState.deathMark) {
      const [mx, my] = worldToMap(uiState.deathMark.x, uiState.deathMark.z, T);
      ctx.strokeStyle = '#e05a4a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 4, my - 4); ctx.lineTo(mx + 4, my + 4);
      ctx.moveTo(mx + 4, my - 4); ctx.lineTo(mx - 4, my + 4);
      ctx.stroke();
    }

    // 敌人名牌: 持久 DOM 节点(首次点亮时创建, 换场在 init 清空) —— 每帧只局部更新:
    // 移动=改 left/top, 血量=改条宽/数字(脏检查), 不再每帧 innerHTML 重建整块(每帧几十次 DOM 创建是主线程负担)
    // 高度锚 7.2m(底边锚定): 名牌整体悬在车体上方, 不遮挡坦克本体
    const mp = window.SF && SF.Game_mp && SF.Game_mp.mode !== 'sp' ? SF.Game_mp : null;
    const targets = mp ? [...mp.tanks.values()].filter(t => t.netId !== mp.myId && t.team !== world.player.team) : world.enemies;
    for (const e of targets) {
      if (!e.alive) continue;
      if (!(uiState.spotted.has(e) || world.time - (e.lastFireT || -99) < 5)) continue;
      let rec = emarks.get(e);
      if (!rec) {
        const el = document.createElement('div');
        el.className = 'emark';
        el.innerHTML = `${SF.ClsIcon(e.spec.cls, { color: '#ff7a68' })} <b></b><i><em></em></i><u></u>`;
        $('markers').appendChild(el);
        emarks.set(e, rec = { el, name: el.querySelector('b'), fill: el.querySelector('i em'), num: el.querySelector('u'), nameTxt: '', w: -1, hp: -1, seen: false });
      }
      const p = project(new THREE.Vector3(e.x, e.y + 7.2, e.z));
      if (!p || p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight) continue;   // 出屏: 保持隐藏, 由下方 sweep 收起
      rec.seen = true;
      setDisp(rec.el, 'block');
      rec.el.style.left = p.x + 'px'; rec.el.style.top = p.y + 'px';
      let name = e.spec.name;
      if (mp && e.netId) { const pl = mp.players.find(q => q.id === e.netId); if (pl) name = pl.name; }
      if (rec.nameTxt !== name) { rec.nameTxt = name; rec.name.textContent = name; }
      const hpPct = Math.round(SF.Util.clamp(e.hp / e.spec.hp, 0, 1) * 200) / 2;   // 0.5% 粒度, 减少无谓样式写入
      if (rec.w !== hpPct) { rec.w = hpPct; rec.fill.style.width = hpPct + '%'; }   // 条=剩余血量(绿, 随损伤缩短)
      const hpC = Math.ceil(e.hp);
      if (rec.hp !== hpC) { rec.hp = hpC; rec.num.textContent = hpC; }
      rec.el.classList.toggle('locked', e === uiState.autoTarget);
    }
    for (const rec of emarks.values()) {   // 收起本帧不可见/已阵亡的名牌
      if (!rec.seen) setDisp(rec.el, 'none');
      rec.seen = false;
    }

    // 任务进程(单机 PVE): 简略条 + Tab 详细面板
    if (uiState.mission) {
      const DEF_CLS = { medium: 'MT', td: 'TD', heavy: 'HT' };
      const clsOf = (e) => (e.spec && e.spec.cls) || DEF_CLS[e.type] || 'MT';
      const groups = {};
      for (const e of world.enemies) if (e.alive) { const c = clsOf(e); groups[c] = (groups[c] || 0) + 1; }
      const m = uiState.mission;
      const symLine = Object.entries(groups).map(([t, n]) => `<span class="sym">${SF.ClsIcon(t)} ×${n}</span>`).join('') || '<span class="sym" style="color:#8fd98f">已肃清</span>';
      setDisp($('missionBar'), 'block');
      setHtml($('missionBar'), `任务 ${m.idx + 1}/${m.total}　残敌 ${symLine}`);
      const detail = $('missionDetail');
      if (detail.style.display === 'block') {
        const CLS_FULL = { MT: '中型坦克', HT: '重型坦克', TD: '歼击车', LT: '轻型坦克', SPG: '自行火炮' };
        const rows = Object.entries(groups).map(([c, n]) =>
          `<div class="row"><span>${SF.ClsIcon(c)} ${CLS_FULL[c] || '坦克'}</span><span>×${n}</span></div>`).join('');
        setHtml(detail, `<h4>${m.name}</h4>${rows || '<div style="color:#8fd98f">本波已肃清</div>'}<div class="k">已击毁 ${m.kills} / ${m.totalEnemies}　·　Tab 收起</div>`);
      }
    }

    // 狙击镜
    setDisp($('sniperOverlay'), uiState.sniper ? 'block' : 'none');

    // 点亮指示(被敌人发现): 灯泡
    setOp($('detectLamp'), uiState.detected ? 1 : 0);
    // 隐蔽指示: 蹲入隐蔽物且未开炮=隐蔽生效; 蹲着开炮=15m 内草本失效必暴露(WoT 15m 规)
    const bt = $('bushTag'), bu = uiState.bush;
    if (bu && bu.inBush) {
      setTxt(bt, bu.concealed ? '🌿 隐蔽中' : '🌿 开炮 · 近草失效');
      const c2 = bu.concealed ? '#9fe08a' : '#e07a6a';
      if (bt._c !== c2) { bt._c = c2; bt.style.color = c2; }
      setOp(bt, 1);
    } else setOp(bt, 0);

    // 大地图(M): 小地图内容放大绘制
    if ($('bigMap').style.display === 'block')
      $('bigMap').getContext('2d').drawImage($('minimap'), 0, 0, 430, 430);
  }

  // 结算屏入场: 先 display 再强制回流后挂 .on, 让渐暗+上浮动画每次都完整播放;
  // 1 秒后挂 .settled 强制内容落定可见(动画不推进的环境下 both 填充会卡在透明 from 态)
  function showOverlay() {
    const ov = $('overlay');
    ov.classList.remove('settled');
    ov.style.display = 'flex';
    void ov.offsetWidth;
    ov.classList.add('on');
    clearTimeout(showOverlay._t);
    showOverlay._t = setTimeout(() => ov.classList.add('settled'), 1000);
  }

  function endGame(win, stats) {
    if (document.exitPointerLock) document.exitPointerLock();   // 结算界面需要鼠标操作, 释放锁定
    showOverlay();
    // 再战一局仅单机可用(联机需回大厅重新匹配)
    $('btnRetry').style.display = (SF.Game_mp && SF.Game_mp.mode === 'sp') ? '' : 'none';
    $('endTitle').textContent = win ? '✓ 任务完成' : '✗ 任务失败';
    $('endTitle').style.color = win ? '#8fd98f' : '#e06c5a';
    $('endStats').innerHTML =
      `击毁 <b>${stats.kills}</b> / ${stats.total}　用时 <b>${Math.floor(stats.time / 60)}:${String(Math.floor(stats.time % 60)).padStart(2, '0')}</b><br>` +
      `命中率 <b>${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}%</b>　` +
      `击穿率 <b>${stats.hits ? Math.round(stats.pens / stats.hits * 100) : 0}%</b>　` +
      `造成伤害 <b>${Math.round(stats.dmg)}</b>`;
  }

  function toggleBigMap() {
    const el = $('bigMap');
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
  }

  function toggleMissionDetail() {
    const d = $('missionDetail');
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
  }

  return { init, update, dmgNumber, hitFrom, shotFrom, hitFeedback, alarm, log, showMsg, endGame, showOverlay, project, toggleMissionDetail, toggleBigMap };
})();
