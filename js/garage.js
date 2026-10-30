// garage.js — 车库(出击前界面)模块: 坦克/地图选择卡与筛选、右栏参数面板、3D 展台预览、小贴士
// 职责收拢: 此前车库逻辑散在 main.js(TIPS/3D 预览/选车), 本次车库三项改造(类型×国家筛选/
// 参数面板右侧化/提示行移到战场卡下方)一并落位本文件; main.js 只经 SF.Garage.* 调用,
// 选择态(selTank/selMap)由本模块持有, 出击编队与联机进房同步读写同一份
window.SF = window.SF || {};

SF.Garage = (() => {
  // 选择态: 车库卡片/筛选高亮/出击懒加载/联机进房登记都用它(暴露为可读写属性)
  const api = { selTank: 'sherman', selMap: 'l01' };

  /* ---------- 小贴士: 每条最多显示 2 次(跨会话记忆), 加载屏与首页各一条 ---------- */
  const TIPS = [
    '等缩圈变绿再开炮——每一发都要让敌人付出代价！',
    '正面打不穿？瞄首下！还不行就绕侧，揍他的软肋！',
    '歼击车正面是铁板一块——绕到侧面，它就是一盒罐头！',
    '坡顶卖头只露炮塔：让敌人的炮弹替你敲锣！',
    '💡 灯泡亮起 = 你被盯上了！马上转移，别站在原地当靶子！',
    '圈没合拢别扣扳机——喂给泥土的炮弹可不会长眼！',
    '下坡俯角更狠，上坡打不着坡下——先占位的人先开火！',
    '按 Tab 点名残敌——知道谁还活着，才知道下一炮打给谁！',
    '急停对炮是基本功：松油门，稳住，一炮定乾坤！',
    '倒车伸缩掐好节奏：打一炮退半步，活活气死对面！',
    '被点亮后敌人的无线电会炸锅——转移要快，履带就是命！',
    '草丛/树篱/草垛都是软质草本，直接压过去就行：蹲进去还能隐蔽，敌人看不见你，但一开炮就失效 4 秒！软质物不挡炮弹，找石头房子躲弹。',
    '看不见的敌人=你没点亮它：视距×隐蔽与遮挡说了算——逼近、升观瞄配件，或等它开炮暴露！',
    '开炮声会出卖你的方位，敌群马上合围——打一枪，换一个地方！',
    '敌人丢了你会全队搜剿——绕到他们背后放冷炮，才是猎人的打法！',
    '联机对战：房主 npm start 后把控制台 WS 地址填进联机设置'
  ];
  function showTip(elId) {
    let shown = {};
    try { shown = JSON.parse(localStorage.getItem('sf_tips') || '{}'); } catch (e) { }
    const pool = TIPS.map((t, i) => i).filter(i => (shown[i] || 0) < 2);
    if (!pool.length) return;
    const i = pool[(Math.random() * pool.length) | 0];
    shown[i] = (shown[i] || 0) + 1;
    try { localStorage.setItem('sf_tips', JSON.stringify(shown)); } catch (e) { }
    const el = document.getElementById(elId);
    if (el) el.textContent = '💡 ' + TIPS[i];
  }

  /* ---------- 恢复上次选择(main.start 装载资源前调): 非法存档回默认 ---------- */
  function restoreSelection() {
    api.selTank = localStorage.getItem('sf_mp_tank') || api.selTank;
    api.selMap = localStorage.getItem('sf_map') || api.selMap;
    if (!SF.CFG.vehicles[api.selTank]) api.selTank = 'sherman';
    if (!SF.CFG.maps.find(m => m.id === api.selMap)) api.selMap = 'l01';
  }

  /* ---------- 车库 3D 预览: 全屏车库场景 + 展台坦克居中 + 随地图切换风格 ---------- */
  let garagePV = null;
  function disposeGarage() {
    if (!garagePV) return;
    garagePV.active = false; clearInterval(garagePV.timer);
    if (garagePV.onResize) removeEventListener('resize', garagePV.onResize);
    try { garagePV.renderer.dispose(); if (garagePV.renderer.forceContextLoss) garagePV.renderer.forceContextLoss(); } catch (e) { }
    document.getElementById('garageView').innerHTML = '';
    garagePV = null;
  }
  // 三张地图各配一套同风格车库(地面/墙面/灯光/雾色)
  const GARAGE_THEMES = {
    l01: { bg: 0x27301c, ground: 0x363e27, wall: 0x4c4030, wallDark: 0x3b3426, beam: 0x332a1e,
           lamp: 0xffd9a0, crate: 0x4d4a2e, barrel: 0x5c4028, hemi: [0xcad8a8, 0x222a18, 0.85], key: [0xffe2b0, 1.35], rim: [0x9fc4e8, 0.4] },
    l02: { bg: 0x1a1b20, ground: 0x43454c, wall: 0x37383e, wallDark: 0x2c2d33, beam: 0x27282e,
           lamp: 0xe8f0ff, crate: 0x3e4148, barrel: 0x4a4238, hemi: [0xaab6cc, 0x16171c, 0.8], key: [0xeaf0ff, 1.3], rim: [0xffa060, 0.5] },
    l03: { bg: 0x1b1916, ground: 0x4c4739, wall: 0x3d3a30, wallDark: 0x322f28, beam: 0x2b2923,
           lamp: 0xcfe2ff, crate: 0x463d2f, barrel: 0x514536, hemi: [0xa8bcc8, 0x1b1915, 0.75], key: [0xdfeaff, 1.3], rim: [0xffc080, 0.45] }
  };

  function disposeGroup(root) {
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }

  function buildGarageEnv(th) {
    const g = new THREE.Group();
    const mat = c => new THREE.MeshLambertMaterial({ color: c });
    const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    const ground = add(new THREE.Mesh(new THREE.CircleGeometry(60, 48), mat(th.ground)), 0, 0, 0);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    add(new THREE.Mesh(new THREE.BoxGeometry(46, 10, 0.8), mat(th.wall)), 0, 5, -12);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 30), mat(th.wallDark)), -14, 4, 2);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 30), mat(th.wallDark)), 14, 4, 2);
    for (const x of [-12, -4, 4, 12]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 10, 10), mat(th.beam)), x, 5, -10.4);
    for (const z of [-7, -1, 5]) add(new THREE.Mesh(new THREE.BoxGeometry(34, 0.55, 0.7), mat(th.beam)), 0, 9.4, z);
    // 后墙灯带: 深色灯罩 + 自发光灯板(工业灯风格)
    const lampMat = new THREE.MeshBasicMaterial({ color: th.lamp });
    const housMat = mat(th.beam);
    for (const x of [-10, 0, 10]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 0.3), housMat), x, 6.85, -11.45);
      add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.34, 0.18), lampMat), x, 6.5, -11.4);
    }
    // 车库杂物: 木箱堆 + 油桶(摆在两侧, 不挡展台)
    const crateMat = mat(th.crate), barrelMat = mat(th.barrel);
    for (const [x, z, s, ry] of [[-10.6, -6.4, 1.1, 0.35], [-9.3, -7.5, 0.9, -0.2], [-10.0, -6.8, 0.75, 0.1]]) {
      const c = add(new THREE.Mesh(new THREE.BoxGeometry(1.25 * s, 0.95 * s, 1.25 * s), crateMat), x, 0.48 * s, z);
      c.rotation.y = ry;
    }
    const cTop = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 1.0), crateMat), -10.2, 1.3, -6.9);
    cTop.rotation.y = 0.6;
    for (const [x, z] of [[11.4, -5.4], [12.3, -6.9], [11.9, -4.5]]) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 10), barrelMat), x, 0.575, z);
    }
    return g;
  }

  function buildGaragePreview() {
    if (garagePV) return;
    const holder = document.getElementById('garageView');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    holder.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x27301c, 20, 80);
    const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 160);
    cam.position.set(9.6, 4.6, 14.2);
    cam.lookAt(0, 1.05, 0);
    const hemi = new THREE.HemisphereLight(0xcad8a8, 0x222a18, 0.85);
    const key = new THREE.DirectionalLight(0xffe2b0, 1.35);
    key.position.set(4, 8, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -7;
    key.shadow.camera.right = key.shadow.camera.top = 7;
    scene.add(hemi, key);
    const rim = new THREE.DirectionalLight(0x9fc4e8, 0.4);
    rim.position.set(-6, 4, -5);
    scene.add(rim);
    // 展台: 深色圆盘 + 金环
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.3, 0.22, 48), new THREE.MeshLambertMaterial({ color: 0x1b1d16 }));
    disc.receiveShadow = true;
    scene.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.08, 3.32, 48), new THREE.MeshBasicMaterial({ color: 0xc8b26a, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.115;
    scene.add(ring);

    garagePV = { renderer, scene, cam, hemi, key, rim, env: null, tankGroup: null, turret: null, gun: null, active: true, lastT: 0 };
    const onResize = () => {
      renderer.setSize(innerWidth, innerHeight);
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
    };
    addEventListener('resize', onResize);
    garagePV.onResize = onResize;
    setGarageTheme(api.selMap);

    const tick = () => {
      if (!garagePV.active) return;
      const dt = Math.min(0.05, (performance.now() - garagePV.lastT) / 1000 || 0.033);
      garagePV.lastT = performance.now();
      if (garagePV.tankGroup) {
        garagePV.tankGroup.rotation.y += dt * 0.2;   // 整车一体旋转(炮塔锁定车体, 不再独立慢转)
        if (garagePV.gun) garagePV.gun.rotation.x = -0.05;
      }
      renderer.render(scene, cam);
    };
    garagePV.timer = setInterval(tick, 33);
    tick();
  }

  function setGarageTheme(id) {
    if (!garagePV || !garagePV.active) return;
    const th = GARAGE_THEMES[id] || GARAGE_THEMES.l01;
    if (garagePV.env) { garagePV.scene.remove(garagePV.env); disposeGroup(garagePV.env); }
    garagePV.env = buildGarageEnv(th);
    garagePV.scene.add(garagePV.env);
    garagePV.scene.fog.color.setHex(th.bg);
    garagePV.renderer.setClearColor(th.bg);
    garagePV.hemi.color.setHex(th.hemi[0]); garagePV.hemi.groundColor.setHex(th.hemi[1]); garagePV.hemi.intensity = th.hemi[2];
    garagePV.key.color.setHex(th.key[0]); garagePV.key.intensity = th.key[1];
    garagePV.rim.color.setHex(th.rim[0]); garagePV.rim.intensity = th.rim[1];
  }

  function setGarageTank(type) {
    if (!garagePV || !garagePV.active) return;
    garagePV.want = type;   // 竞态防护: 连点切车只渲染最终选择
    SF.Assets.getModel(type)
      .then(() => { if (garagePV && garagePV.active && garagePV.want === type) renderGarageTank(type); })
      .catch(e => console.warn('车库模型加载失败:', e));
  }
  function renderGarageTank(type) {
    if (garagePV.tankGroup) garagePV.scene.remove(garagePV.tankGroup);
    const parts = SF.Models.makeTank(type);
    parts.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    garagePV.scene.add(parts.root);
    garagePV.tankGroup = parts.root;
    garagePV.turret = parts.turret;
    garagePV.gun = parts.gun;
    const v = SF.CFG.vehicles[type];
    // 底部左侧只留身份卡(车名+级别 tag), 全部数值参数挪到右栏 #specPanel(renderSpecPanel)
    const gi = SF.CFG.garage.find(x => x.type === type);
    document.getElementById('garageStats').innerHTML =
      `<b>${v.name}</b><span>${gi ? gi.tag : (v.tier || '') + '级' + SF.CLS_CN[v.cls]}</span>`;
    renderSpecPanel(v);
    garagePV.renderer.render(garagePV.scene, garagePV.cam);
  }

  /* 车库参数面板(右栏 #specPanel): 每参数一行名左值右, 覆盖 spec 全部可展示字段 ——
     炮塔转速/射界/倒车极速/口径/弹速/俯仰/精度/视野/隐蔽此前均无展示位, 本次一并补上 */
  function renderSpecPanel(v) {
    const deg = r => r * 180 / Math.PI;
    const d1 = d => d >= 10 ? String(Math.round(d)) : (Math.round(d * 10) / 10).toFixed(1);   // 转速类: ≥10°/s 取整, <10 保留 1 位(歼击车 0.45°/s 级微转可见)
    const al = v.gun.autoloader;
    const dp = v.dispersion;
    const rows = [
      ['血量', v.hp],
      ['穿深', v.gun.pen + 'mm'],
      ['单发', v.gun.dmg],
      al ? ['弹夹', `${al.clip}发 · 间隔${al.intra}s · 整夹${al.long}s`] : ['装填', v.gun.reload + 's'],
      ['弹速', v.gun.speed + 'm/s'],
      ['口径', v.gun.cal + 'mm'],
      ['俯仰角', `${Math.round(deg(v.gunDepression))}°/+${Math.round(deg(v.gunElevation))}°`],
      ['射界', v.gunArc != null ? `±${Math.round(deg(v.gunArc))}°` : '360°'],   // 固定战斗室(TD/SPG 部分)显示实际射界, 炮塔车全向
      ['精度', `${dp.base}m@100m · 缩圈${dp.aimTime}s`],
      v.gun.splash ? ['溅射', v.gun.splash + 'm'] : null,                       // 仅火炮有溅射
      ['极速', Math.round(v.maxSpeed * 3.6) + 'km/h', 'sep'],
      ['倒车极速', Math.round(v.maxSpeed * v.reverseRatio * 3.6) + 'km/h'],
      ['车体转速', d1(deg(v.hullTraverse)) + '°/s'],
      ['炮塔转速', d1(deg(v.turretTraverse)) + '°/s'],
      ['视野', (v.view || SF.CFG.player.viewRange) + 'm', 'sep'],
      ['隐蔽(静止)', Math.round(v.camo * 100) + '%'],   // 静止隐蔽基数; 移动减半/开炮近零(运算口径见 simcore.camoOf)
    ].filter(Boolean);
    document.getElementById('specPanel').innerHTML =
      rows.map(([k, val, cls]) => `<div class="srow${cls ? ' ' + cls : ''}"><label>${k}</label><b>${val}</b></div>`).join('');
  }

  /* ---------- 车库坦克筛选: 类型×国家两组 DOM 按钮组(#clsFilter/#natFilter, 与 roomModeSel 同款) ---------- */
  // 必须 DOM 按钮而不能用原生 <select>: 内嵌浏览器 webview 不渲染 select 弹层, 真人点不开(8d49333 同款教训);
  // 点筛只重渲 #garageRow, 不动 3D 预览(renderGarageTank 不依赖卡片 DOM) —— 当前车被滤掉时仅卡片无高亮
  const tankFilter = { cls: '', nat: '' };   // '' = 全部(默认不筛, 与改造前列表全量一致)
  const NAT_CN = { US: '美国', DE: '德国', RU: '苏联', UK: '英国', FR: '法国', JP: '日本', CN: '中国', IL: '以色列', SE: '瑞典', KR: '韩国' };   // SF.NATION 国别码 → 筛选按钮名(USSR/RUS 同码 RU 合并为一键)
  function natCodeOf(type) { return SF.NATION[SF.CFG.vehicles[type].nation] || ''; }
  function buildTankFilters() {
    const mk = (box, key, btns) => {
      box.innerHTML = '';
      for (const [val, label] of btns) {
        const b = document.createElement('button');
        b.innerHTML = label;
        b.classList.toggle('on', tankFilter[key] === val);
        b.onclick = () => {
          tankFilter[key] = val;
          [...box.children].forEach(c => c.classList.remove('on'));
          b.classList.add('on');
          renderTankCards();
        };
        box.appendChild(b);
      }
    };
    // 类型: LT→SPG 固定顺序(与 CLS_CN 键序一致), 只列在售类别; 国家: 按保有量降序, 苏/德/美在前
    mk(document.getElementById('clsFilter'), 'cls', [['', '全部'],
      ...Object.keys(SF.CLS_CN).filter(c => SF.CFG.garage.some(g => g.cls === c))
        .map(c => [c, SF.ClsIcon(c, { size: 8 }) + SF.CLS_CN[c]])]);
    const natCnt = {};
    for (const g of SF.CFG.garage) { const n = natCodeOf(g.type); natCnt[n] = (natCnt[n] || 0) + 1; }
    mk(document.getElementById('natFilter'), 'nat', [['', '全部'],
      ...Object.keys(natCnt).sort((a, b) => natCnt[b] - natCnt[a]).map(n => [n, NAT_CN[n] || n])]);
  }
  function renderTankCards() {
    const g = document.getElementById('garageRow');
    g.innerHTML = '';
    for (const t of SF.CFG.garage) {
      if (tankFilter.cls && t.cls !== tankFilter.cls) continue;
      if (tankFilter.nat && natCodeOf(t.type) !== tankFilter.nat) continue;
      const v = SF.CFG.vehicles[t.type];
      const el = document.createElement('div');
      el.className = 'card' + (t.type === api.selTank ? ' sel' : '');
      el.innerHTML = `<b>${v.name}</b><i>${SF.ClsIcon(t.cls)} ${t.tag}</i><span>${t.desc}</span><em>HP ${v.hp} · 穿深 ${v.gun.pen} · 单发 ${v.gun.dmg} · 极速 ${Math.round(v.maxSpeed * 3.6)}</em>`;
      el.onclick = () => {
        api.selTank = t.type; localStorage.setItem('sf_mp_tank', t.type);
        [...g.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); setGarageTank(t.type);
        document.dispatchEvent(new CustomEvent('sf-mp-tank', { detail: t.type }));   // 联机在房: 大厅监听上报换车
      };
      g.appendChild(el);
    }
  }

  // 出击前车库: 选坦克 + 选地图
  function buildPicker() {
    buildTankFilters();
    renderTankCards();   // 筛选点击只重渲这一步(不动 3D 预览与地图卡)
    const m = document.getElementById('mapRow');
    m.innerHTML = '';
    for (const mp of SF.CFG.maps) {
      const el = document.createElement('div');
      el.className = 'card' + (mp.id === api.selMap ? ' sel' : '');
      el.innerHTML = `<b>${mp.name}</b><span>${mp.desc}</span>`;
      el.onclick = () => { api.selMap = mp.id; localStorage.setItem('sf_map', mp.id); [...m.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); setGarageTheme(mp.id); };
      m.appendChild(el);
    }
    setGarageTank(api.selTank);   // 初始渲染上次选择的坦克
  }

  return Object.assign(api, {
    showTip, restoreSelection,
    buildPicker, buildTankFilters, renderTankCards,
    buildGaragePreview, disposeGarage, setGarageTheme, setGarageTank, renderSpecPanel
  });
})();
