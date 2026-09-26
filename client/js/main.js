// main.js — 场景搭建/相机/输入/主循环/第一关流程(波次·维修·胜负)
window.SF = window.SF || {};

SF.Main = (() => {
  const U = SF.Util;
  let renderer, scene, camera, sunLight;
  let canvas;                                 // 当前战斗画布(=renderer.domElement, 重开战斗会换新)
  let world, fx, shells;
  let camYaw = Math.PI, camPitch = 0.30, camDist = SF.CFG.camera.dist;
  let sniper = false, mouseDown = false, shakeT = 0, freeLook = false;   // 右键按住: 自由视角(炮塔锁定)
  let altHeld = false;   // 按住 Alt: 显示虚拟光标操作界面(准星冻结, WoT 式)
  // 鹰眼模式虚拟光标: 指针锁定时浏览器光标被隐藏, 累积 movementX/Y 自绘;
  // 未锁定时跟随系统光标(供边缘平移), 见 mousemove / updateCamera
  let vcx = innerWidth / 2, vcy = innerHeight / 2;
  function eagle() { return sniper && world && world.player && world.player.spec.cls === 'SPG'; }
  // HUD 交互区命中测试(鹰眼虚拟光标用): 小地图/大地图/退出按钮
  function uiHitTest(x, y) {
    for (const id of ['minimap', 'bigMap', 'btnExit']) {
      const el = document.getElementById(id);
      if (!el || el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id, el };
    }
    return null;
  }
  // 鹰眼模式: 视野中心跳转到地图上某点(小地图/大地图共用)
  function jumpViewTo(cx, cy, el) {
    if (!eagle()) return;
    const r = el.getBoundingClientRect();
    const T = world.terrain;
    artyX = U.clamp((cx - r.left) / r.width * T.size - T.half, -470, 470);
    artyZ = U.clamp((cy - r.top) / r.height * T.size - T.half, -470, 470);
  }
  let artyX = 0, artyZ = 0;   // 火炮鹰眼: 俯视视野中心(世界坐标)
  const ARTY_H = [40, 70, 110, 160, 220];   // 鹰眼高度档位(视场范围)
  let artyH = ARTY_H[2], artyHIdx = 2;
  let sniperFov = SF.CFG.camera.sniperFovMax;   // 当前狙镜视场(滚轮镜内变焦)
  let cruise = 0;              // 巡航控制: 1 前进 / -1 倒车 / 0 关
  let autoTarget = null;       // 自动瞄准目标(WoT E 键)
  const keys = {};
  let acc = 0, lastT = 0, running = false, lastRaf = 0, timerId = null;
  let selTank = 'sherman', selMap = 'l01';   // 出击前选择
  let lastSpottedT = -99, wasDetected = false;   // 点亮机制(2s 宽限)
  let deathMark = null;                          // 上次阵亡位置(小地图 ✕ 标记)
  // 联机死斗(主机权威): mode=host 房主跑模拟; client 幽灵插值; sp 单机
  const MP = SF.Game_mp = {
    mode: 'sp', gameMode: 'dm', myId: 0, mapId: 'l01', players: [],   // [{id,name,tank,host}]
    tanks: new Map(),                                         // id → Tank(主机真实模拟 / 客户端幽灵 / coop AI)
    inputs: new Map(),                                        // 主机: 远端玩家输入
    scores: new Map(), respawn: [], timeLeft: 180, snapT: 0,
    waveInfo: null, aiId: 100                                 // coop: AI 实体 id 从 100 起
  };
  let keySeen = false, hintShown = false;   // 键盘诊断: 是否收到过按键
  let spottedTimer = 0;
  const spotted = new Set();
  const spottedLast = new Map();   // 敌 → 最后点亮时刻
  const lastKnown = new Map();     // 敌 → 最后已知位置(小地图丢亮点后原地保留, WoT 式)
  const spotStreak = new Map();    // 敌 → 本次持续点亮起始时刻(决定残留时长 5→10s)
  const spotLinger = new Map();    // 敌 → 丢失视野后的残留秒数(WoT: 最短 5s, 持续暴露可延至 10s)
  let lampT = 0;                   // 被敌人持续注视的时长(六感灯 3s 延迟, WoT)
  let waveIdx = 0, waveEnemies = [], repairT = 0, repairDone = false, gameOver = false, loseT = -1;
  let stats = { kills: 0, total: 0, shots: 0, hits: 0, pens: 0, dmg: 0, time: 0 };
  let aimPoint = null, gunAim = null;

  /* ---------- 场景 ---------- */
  function buildScene() {
    const map = SF.Assets.maps[selMap].json, L = map.lighting;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);
    canvas = renderer.domElement;
    canvas.tabIndex = -1;
    canvas.addEventListener('click', () => {   // 点画面补锁(每场新画布各挂一份, 旧画布随战斗销毁)
      canvas.focus();
      if (!gameOver) canvas.requestPointerLock();
      SF.Audio.resume();
    });

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(...L.fogColor), L.fogDensity);

    camera = new THREE.PerspectiveCamera(SF.CFG.camera.fov, innerWidth / innerHeight, 0.3, 2200);

    // 天空穹顶(渐变)
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 16, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(...L.skyTop) }, bottom: { value: new THREE.Color(...L.skyBottom) } },
        vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(h*1.6+0.08,0.0,1.0)), 1.0); }'
      })
    );
    scene.add(sky);

    // 光照
    const sun = new THREE.DirectionalLight(new THREE.Color(...L.sunColor), L.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -95;
    sun.shadow.camera.right = sun.shadow.camera.top = 95;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0006;
    const sd = new THREE.Vector3(...L.sunDir).normalize();
    scene.add(sun, sun.target);
    sunLight = { light: sun, dir: sd };
    scene.add(new THREE.HemisphereLight(new THREE.Color(...L.ambientColor), 0x39412e, L.ambient));

    // 地形与掩体
    const terrain = new SF.Terrain(SF.Assets.maps[selMap].heights, map.terrain);
    scene.add(terrain.buildMesh(map.theme || 'grass'));
    const covers = new SF.Models.CoverField(map, terrain, scene);

    // 玩家
    const [sx, sz, syaw] = map.player.spawn;
    const player = new SF.Tank(selTank, { x: sx, z: sz, yaw: syaw, isPlayer: true });
    scene.add(player.group);

    // intel = 全敌共享的玩家情报: {x,z 最后已知位置, t 时刻, level 0无/1听见炮声/2目视确认}
    // 任何敌人目视 → 坐标全队广播; 玩家开炮被听见 → 方位上报(带误差)
    world = { terrain, covers, player, enemies: [], tanks: [player], time: 0, map,
              intel: { x: sx, z: sz, t: -99, level: 0 } };
    fx = new SF.FX(scene);
    shells = new SF.Shells(scene, fx);
    world.shells = shells;
    buildTrajLine();

    SF.Game = { scene, camera, renderer, world, fx, get uiState() { return {
      aimPoint, gunAim, sniper, spotted, lastKnown, keys, detected: wasDetected, deathMark, autoTarget, cruise, trajT: trajFlightT,
      mission: (() => {
        if (!world.map) return null;
        if (SF.Game_mp.mode === 'sp') return { idx: waveIdx, total: world.map.waves.length, name: (world.map.waves[waveIdx] || {}).name || '', kills: stats.kills, totalEnemies: stats.total };
        if (SF.Game_mp.gameMode === 'coop') {
          if (SF.Game_mp.mode === 'host') return { idx: waveIdx, total: world.map.waves.length, name: (world.map.waves[waveIdx] || {}).name || '', kills: stats.kills, totalEnemies: stats.total };
          return SF.Game_mp.waveInfo;
        }
        return null;
      })()
    }; } };
  
  // 测试钩子: 无 rAF 环境下手动推进模拟与渲染(自动化测试用)
    SF.Game.test = {
      step(n = 1) { for (let i = 0; i < n; i++) step(SF.CFG.sim.dt); },
      frame() { frame(SF.CFG.sim.dt); }
    };
    spawnWave(0);
  }

  /* ---------- 波次 ---------- */
  function spawnWave(i) {
    const wave = world.map.waves[i];
    if (!wave) return;
    const aiSpawned = [];
    let pt = TIER_NUM[(SF.CFG.vehicles[selTank] || {}).tier] || 5;
    if (MP.mode !== 'sp')
      for (const pl of MP.players) pt = Math.max(pt, TIER_NUM[(SF.CFG.vehicles[pl.tank] || {}).tier] || 5);
    const waveBand = i === 0 ? [pt - 1, pt] : [pt, pt + 1];
    // 按玩家数量定敌军规模(带随机浮动): 单人少打一两个, 每多一名玩家约 +1.6 辆
    const nP = MP.mode === 'sp' ? 1 : Math.max(1, MP.players.length);
    const target = Math.max(1, Math.min(9, Math.round(
      wave.enemies.length + (nP - 1) * 1.6 + (Math.random() - 0.5) * 1.5 + (nP === 1 ? -1 : 0))));
    const defs = wave.enemies.slice();
    while (defs.length > target) defs.splice((Math.random() * defs.length) | 0, 1);   // 随机裁减
    while (defs.length < target) {                    // 增援: 优先复制机动单位, 出生位大幅偏移
      const src = defs.find(d => !d.hold) || defs[0] || wave.enemies[0];
      defs.push({ ...src, pos: [src.pos[0] + (Math.random() - 0.5) * 180, src.pos[1] + (Math.random() - 0.5) * 180] });
    }
    const n = defs.length;
    waveEnemies = defs.map((def, wi) => {
      // 出生随机化(每局布局不同): 守位单位 ±18m, 机动单位 ±65m, 巡逻点独立再随机 ±25m
      const jr = def.hold ? 18 : 65;
      const dx = (Math.random() - 0.5) * 2 * jr, dz = (Math.random() - 0.5) * 2 * jr;
      let ex = U.clamp(def.pos[0] + dx, -430, 430), ez = U.clamp(def.pos[1] + dz, -430, 430);
      [ex, ez] = world.covers.collide(ex, ez, 2.6);
      const CLS_OF_LEGACY = { medium: 'MT', td: 'TD', heavy: 'HT' };
      const cls = CLS_OF_LEGACY[def.type] || (SF.CFG.vehicles[def.type] || {}).cls || 'MT';
      const type = pickTierTank(cls, waveBand);
      const t = new SF.Tank(type, { x: ex, z: ez, yaw: (def.yaw !== undefined ? def.yaw : Math.PI) + (Math.random() - 0.5) * 0.4 });
      const def2 = { ...def, patrol: (def.patrol || []).map(w => [
        U.clamp(w[0] + (ex - def.pos[0]) + (Math.random() - 0.5) * 50, -430, 430),
        U.clamp(w[1] + (ez - def.pos[1]) + (Math.random() - 0.5) * 50, -430, 430)]) };
      t.ai = new SF.AI(t, def2);
      // 合围扇区: 全波均匀分布(+抖动), 围攻时各车从自己的方向接近, 形成合围而非排队送
      t.ai.flankSlot = wi / n * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      scene.add(t.group);
      world.tanks.push(t);
      if (MP.mode !== 'sp') { t.netId = MP.aiId++; t.team = 1; t._isAI = true; MP.tanks.set(t.netId, t); aiSpawned.push({ id: t.netId, type }); }
      return t;
    });
    world.enemies = waveEnemies;
    if (MP.mode !== 'sp') SF.Net.send({ t: 'ev', k: 'aiWave', d: { list: aiSpawned } });
    stats.total += waveEnemies.length;
    SF.HUD.showMsg(`第 ${i + 1} 波 · ${wave.name}`, 3);
    SF.HUD.log(`遭遇：${wave.name}`, '#e8c977');
  }

  function checkWave() {
    if (gameOver) return;
    if (world.enemies.some(e => e.alive)) return;
    if (waveIdx + 1 < world.map.waves.length) {
      if (!repairDone) {
        repairDone = true; repairT = world.map.repairBetweenWaves.duration;
        const heal = Math.round(world.player.spec.hp * world.map.repairBetweenWaves.hpRatio);
        // 波间维修同时修复受损模块(WoT 没有波间; 有维修包——这里波间即"整备")
        const fix = (t) => { t.hp = Math.min(t.spec.hp, t.hp + heal); t.modules = { track: 0, engine: 0, gun: 0, ammo: 0 }; };
        if (MP.mode === 'sp') fix(world.player);
        else for (const [id, t] of MP.tanks) if (id < 100 && t.alive) fix(t);
        SF.HUD.showMsg(world.map.repairBetweenWaves.text + ` (+${heal} HP)`, repairT);
      }
      if (repairT > 0) return;
      waveIdx++; repairDone = false;
      spawnWave(waveIdx);
    } else if (!gameOver) {
      gameOver = true;
      if (MP.mode === 'host') {
        const scores = MP.players.map(pl => [pl.id, pl.name, MP.scores.get(pl.id) || 0]);
        SF.Net.send({ t: 'end', scores, win: true });
      }
      SF.HUD.endGame(true, stats);
    }
  }

  /* ---------- 相机与瞄准 ---------- */
  function updateCamera(dt) {
    const p = world.player;
    let vcHit = null;
    if (sniper && p.spec.cls === 'SPG') {
      // 火炮鹰眼: 高空俯视炮击视野, 准星即炮弹落点
      p.group.visible = true;
      camera.fov = U.lerp(camera.fov, 32, 1 - Math.exp(-12 * dt));
      artyX = U.clamp(artyX, -470, 470); artyZ = U.clamp(artyZ, -470, 470);
      vcHit = uiHitTest(vcx, vcy);   // 悬停 HUD 交互区时光标变金(平移已在 mousemove 暂停)
      const gy = world.terrain.heightAt(artyX, artyZ);
      camera.position.set(artyX, gy + artyH, artyZ + 10);   // 高度档位生效(滚轮变焦)
      camera.lookAt(artyX, gy, artyZ);
    } else if (sniper) {
      p.group.visible = false;   // 狙击镜视角隐藏自己(WoT 式, 也避免相机被炮塔内壁糊住)
      camera.fov = U.lerp(camera.fov, sniperFov, 1 - Math.exp(-12 * dt));
      const tp = new THREE.Vector3(p.x, p.y + 2.85, p.z);
      const dir = new THREE.Vector3(
        Math.sin(camYaw) * Math.cos(camPitch), Math.sin(-camPitch) + 0.04, Math.cos(camYaw) * Math.cos(camPitch)).normalize();
      camera.position.copy(tp).addScaledVector(dir, 0.5);
      camera.lookAt(tp.clone().addScaledVector(dir, 100));
    } else {
      p.group.visible = true;
      camera.fov = U.lerp(camera.fov, SF.CFG.camera.fov, 1 - Math.exp(-12 * dt));
      const pivot = new THREE.Vector3(p.x, p.y + SF.CFG.camera.height, p.z);
      const off = new THREE.Vector3(
        -Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.cos(camYaw) * Math.cos(camPitch));
      camera.position.copy(pivot).addScaledVector(off, camDist);
      const minY = world.terrain.heightAt(camera.position.x, camera.position.z) + 0.6;
      if (camera.position.y < minY) camera.position.y = minY;
      camera.lookAt(pivot.clone().add(new THREE.Vector3(
        Math.sin(camYaw) * 8, Math.sin(-camPitch) * 8, Math.cos(camYaw) * 8)));
    }
    // 鹰眼虚拟光标: 按住 Alt 才显示(WoT 式), 悬停 HUD 交互区变金色; 平时指针锁定下无光标
    const vc = document.getElementById('vcursor');
    const vcShow = eagle() && document.pointerLockElement === canvas && altHeld;
    if (vcShow) {
      vc.style.transform = `translate(${vcx.toFixed(1)}px,${vcy.toFixed(1)}px)`;
      vc.classList.toggle('act', !!vcHit);
    }
    vc.style.display = vcShow ? 'block' : 'none';
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt * 2.2);
      const s = shakeT * 0.35;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }
    camera.updateProjectionMatrix();
    // 阴影跟随
    sunLight.light.position.set(world.player.x + sunLight.dir.x * 300, sunLight.dir.y * 300, world.player.z + sunLight.dir.z * 300);
    sunLight.light.target.position.set(world.player.x, 0, world.player.z);
    SF.Audio.setListener(camera.position.x, camera.position.z, camYaw);
  }

  // 沿相机中心视线求瞄准点: 地形解析步进 + 掩体/坦克 raycast
  const _ray = new THREE.Raycaster();
  function findRayHit(origin, dir, maxDist = 900) {
    let best = null, bestT = maxDist;
    // 地形(步进采样 + 二分细化)
    let t = 2;
    for (; t < bestT; t += 2) {
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      if (py <= world.terrain.heightAt(px, pz)) {
        let lo = t - 2, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          (origin.y + dir.y * mid <= world.terrain.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid)) ? hi = mid : lo = mid;
        }
        bestT = hi; best = new THREE.Vector3(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
        break;
      }
      if (t > 500 && py > 160 && dir.y > 0) break;
    }
    // 掩体与敌坦克(含残骸: 挡弹即挡瞄, 不出幽灵准星)
    const objs = [world.covers.group];
    for (const e of world.enemies) objs.push(...e.parts.zones);
    _ray.set(origin, dir); _ray.far = Math.min(bestT, maxDist);
    const hits = _ray.intersectObjects(objs, true);
    let hitInfo = null;
    if (hits.length && hits[0].distance < bestT) {
      bestT = hits[0].distance; best = hits[0].point;
      const obj = hits[0].object;
      if (obj.userData && obj.userData.zone)
        hitInfo = { zone: obj.userData.zone, armor: obj.userData.armor || 0,
                    normal: hits[0].face ? hits[0].face.normal.clone().transformDirection(obj.matrixWorld).normalize() : null,
                    tank: world.enemies.find(e => e.parts.zones.includes(obj)) || null };
    }
    return best ? { pos: best, dist: bestT, hit: hitInfo } : null;
  }

  // 相机瞄准点(鼠标中心) + 炮管实际指向点(双准星: 散布圈跟炮走, 追赶后与中心合拢)
  function computeAim() {
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    aimPoint = findRayHit(camera.position.clone(), camDir);

    const p = world.player;
    if (p.alive) {
      p.group.updateMatrixWorld(true);
      const mz = p.muzzleWorld(), gd = p.gunDir();
      const hit = findRayHit(mz, gd);
      gunAim = hit || { pos: mz.clone().addScaledVector(gd, 400), dist: 400 };   // 打天时取炮向 400m 虚拟点, 保证圈始终存在
      updateTraj();
    } else { gunAim = null; if (trajLine) trajLine.visible = false; }
  }

  /* ---------- 鹰眼弹道预览线: 从炮口按真实弹道积分, 被地形/建筑遮挡则截断变红 ---------- */
  let trajLine = null, groundLine = null, trajFlightT = 0;   // trajFlightT: 炮弹到落点的飞行时间(秒)
  const TRAJ_N = 140, TRAJ_DT = 0.06;     // 高抛弹道全程可达 ~8s, 积分长度要罩得住
  function buildTrajLine() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAJ_N * 3), 3));
    geo.setDrawRange(0, 0);
    trajLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.95, depthTest: false }));
    trajLine.frustumCulled = false;
    trajLine.renderOrder = 5;
    scene.add(trajLine);
    // 地面引导线(虚线): 车体 → 瞄准落点, 贴地形起伏(WoT 火炮鹰眼)
    const G = 32;
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(G * 3), 3));
    groundLine = new THREE.Line(g2, new THREE.LineDashedMaterial({ color: 0xc8b26a, dashSize: 3, gapSize: 2.5, transparent: true, opacity: 0.75, depthTest: false }));
    groundLine.frustumCulled = false;
    groundLine.renderOrder = 5;
    scene.add(groundLine);
  }
  function updateTraj() {
    const p = world.player;
    const show = sniper && p.alive && p.spec.cls === 'SPG' && !gameOver;
    if (!trajLine) return;
    // 弹道仿真照跑(飞行时间/遮挡判定用), 但 3D 弧线在鹰眼里不画:
    // 高抛弧顶(300-400m)远超俯视相机高度, 穿过相机平面的线段会被透视放大成
    // 横扫屏幕的巨线("炮线从别的角飞出来") —— WoT 鹰眼同样只看地面引导线
    trajLine.visible = false;
    if (groundLine) groundLine.visible = show;
    if (!show) return;
    const pos = p.muzzleWorld();
    const vel = p.gunDir().multiplyScalar(p.spec.gun.speed);
    const g = p.spec.gun.grav || SF.CFG.sim.shellGravity;
    const T = world.terrain;
    let endType = 'air', n = 0;   // ground=正常落点 / cover=被掩体遮挡 / air=超时
    for (; n < TRAJ_N; n++) {
      const nx = pos.x + vel.x * TRAJ_DT, ny = pos.y + vel.y * TRAJ_DT, nz = pos.z + vel.z * TRAJ_DT;
      const seg = Math.hypot(nx - pos.x, ny - pos.y, nz - pos.z) || 0.001;
      const bt = world.covers.blocked(pos.x, pos.z, pos.y, (nx - pos.x) / seg, (nz - pos.z) / seg, seg, (ny - pos.y) / seg);
      if (bt >= 0) { endType = 'cover'; break; }                                // 撞掩体: 被遮挡
      pos.x = nx; pos.y = ny; pos.z = nz; vel.y -= g * TRAJ_DT;
      if (pos.y <= T.heightAt(pos.x, pos.z)) { endType = 'ground'; break; }     // 触地
    }
    trajFlightT = (n + 1) * TRAJ_DT;
    // 地面引导线着色: 中途撞掩体/撞山(落点远离瞄准点) → 红色警告; 正常 → 金色
    const endErr = endType === 'ground' && aimPoint ? Math.hypot(pos.x - aimPoint.pos.x, pos.z - aimPoint.pos.z) : 0;
    const warn = endType === 'cover' || (endType === 'ground' && endErr > 20);
    if (groundLine) {
      const arr = groundLine.geometry.attributes.position.array, G = 32;
      for (let i = 0; i < G; i++) {
        const k = i / (G - 1);
        const x = p.x + (artyX - p.x) * k, z = p.z + (artyZ - p.z) * k;
        arr[i * 3] = x; arr[i * 3 + 1] = T.heightAt(x, z) + 0.4; arr[i * 3 + 2] = z;
      }
      groundLine.geometry.attributes.position.needsUpdate = true;
      groundLine.computeLineDistances();
      groundLine.material.color.setHex(warn ? 0xe06c5a : 0xc8b26a);
    }
  }

  /* ---------- 输入 ---------- */
  // 键名归一: 优先 e.code, 缺失时回退 e.key(部分内嵌浏览器/输入法环境 code 为空)
  const KEY_ALIAS = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', r: 'KeyR', e: 'KeyE', f: 'KeyF', m: 'KeyM', arrowup: 'ArrowUp', arrowleft: 'ArrowLeft', arrowdown: 'ArrowDown', arrowright: 'ArrowRight', shift: 'Shift', tab: 'Tab' };
  function keyOf(e) {
    if (e.code) {
      if (/^Key[WASD]$/.test(e.code) || /^Arrow(Up|Down|Left|Right)$/.test(e.code)) return e.code;
      if (/^Key[ERFM]$/.test(e.code)) return e.code;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'Shift';
      if (e.code === 'Tab') return 'Tab';
    }
    const k = (e.key || '').toLowerCase();
    return KEY_ALIAS[k] || null;
  }

  function bindInput() {
    document.addEventListener('pointerlockchange', () => { });
    document.addEventListener('mousemove', (e) => {
      const locked = document.pointerLockElement === canvas;
      // 火炮鹰眼: 鼠标驱动虚拟光标(锁定=累积位移 / 未锁定=跟随系统光标);
      // 视野平移改由光标压屏幕边缘触发(RTS 式, 见 updateCamera), 不再按位移量直接拖动
      if (eagle()) {
        if (locked) {
          if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;   // 锁定偶发大跳变丢弃
          vcx = U.clamp(vcx + e.movementX, 0, innerWidth); vcy = U.clamp(vcy + e.movementY, 0, innerHeight);
          if (altHeld) return;   // Alt=光标操作界面: 只动光标, 准星冻结(WoT)
          // 直接拖动平移(WoT 鹰眼): 位移×每像素世界米数(随视场档位缩放)
          const wpp = artyH * 0.573 / innerHeight * 4;
          artyX = U.clamp(artyX + e.movementX * wpp, -470, 470);
          artyZ = U.clamp(artyZ + e.movementY * wpp, -470, 470);
        } else { vcx = U.clamp(e.clientX, 0, innerWidth); vcy = U.clamp(e.clientY, 0, innerHeight); }
        return;
      }
      if (!locked) return;
      // 指针锁定偶发的大跳变(>300px)丢弃, 防画面猛甩
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      // 灵敏度随镜内倍率缩放(放大越多越细腻; 26→8 连续变化)
      const s = SF.CFG.camera.sens * (sniper ? SF.CFG.camera.sniperSens * (sniperFov / 15) : 1);
      camYaw -= e.movementX * s;
      camPitch = U.clamp(camPitch + e.movementY * s, -0.12, 1.1);
    });
    // HUD 交互区命中测试见模块层 uiHitTest()
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // 鹰眼+指针锁定+按住 Alt(光标可见): 虚拟光标落在 HUD 交互区 → 消费为地图跳转/退出, 不当作开炮
        // (未按 Alt 时左键就是开炮; 未锁定时浏览器光标直接点这些元素)
        if (eagle() && document.pointerLockElement === canvas && altHeld) {
          const h = uiHitTest(vcx, vcy);
          if (h) {
            if (h.id === 'btnExit') exitToTitle();
            else jumpViewTo(vcx, vcy, h.el);
            return;
          }
        }
        mouseDown = true;
      }
      if (e.button === 2) freeLook = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; if (e.button === 2) freeLook = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // 滚轮(WoT 式连续变焦): 第三人称上滚拉近相机, 最近后开镜(从最广镜开始);
    // 镜内上滚继续放大 / 下滚降低倍率, 最广时下滚才退镜(上滚忽略防闪烁)
    document.addEventListener('wheel', (e) => {
      const down = e.deltaY > 0;
      if (sniper) {
        // 火炮鹰眼: 滚轮切换视场档位(左键仍是开炮, Shift 退出)
        if (world && world.player && world.player.spec.cls === 'SPG') {
          artyHIdx = U.clamp(artyHIdx + (down ? 1 : -1), 0, ARTY_H.length - 1);
          artyH = ARTY_H[artyHIdx];
          SF.HUD.showMsg(`鹰眼视场 ≈ ${Math.round(artyH * 0.573)}m`, 1);
          return;
        }
        if (!down) sniperFov = Math.max(SF.CFG.camera.sniperFovMin, sniperFov * 0.87);
        else if (sniperFov >= SF.CFG.camera.sniperFovMax - 0.01) { sniper = false; camDist = SF.CFG.camera.minDist; }
        else sniperFov = Math.min(SF.CFG.camera.sniperFovMax, sniperFov * 1.15);
        return;
      }
      if (!down) {
        if (camDist <= SF.CFG.camera.minDist + 0.01) { sniper = true; sniperFov = SF.CFG.camera.sniperFovMax; }
        else camDist = U.clamp(camDist - 2.4, SF.CFG.camera.minDist, SF.CFG.camera.maxDist);
      } else {
        camDist = U.clamp(camDist + 2.4, SF.CFG.camera.minDist, SF.CFG.camera.maxDist);
      }
    });
    // 视野跳转见模块层 jumpViewTo(); 未锁定时由各地图元素的 DOM 监听调用
    document.getElementById('minimap').addEventListener('mousedown', (e) => { e.stopPropagation(); jumpViewTo(e.clientX, e.clientY, e.currentTarget); });
    document.getElementById('bigMap').addEventListener('mousedown', (e) => { e.stopPropagation(); jumpViewTo(e.clientX, e.clientY, e.currentTarget); });
    // 键盘: window 捕获阶段监听(最先收到, 不被其他处理器截断)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'AltLeft' || e.code === 'AltRight') { e.preventDefault(); altHeld = true; return; }
      const k = keyOf(e);
      if (!k) return;
      keySeen = true;
      if (k === 'Shift') {
        if (!e.repeat) {
          sniper = !sniper;
          if (sniper) sniperFov = SF.CFG.camera.sniperFovMax;   // 开镜从最广视场开始
          // 火炮开鹰眼: 视野中心定位到当前瞄准点(太近则车前方 220m)
          if (sniper && world.player && world.player.spec.cls === 'SPG') {
            const apd = aimPoint ? Math.hypot(aimPoint.pos.x - world.player.x, aimPoint.pos.z - world.player.z) : 0;
            if (aimPoint && apd > 60) { artyX = aimPoint.pos.x; artyZ = aimPoint.pos.z; }
            else { artyX = world.player.x + Math.sin(camYaw) * 220; artyZ = world.player.z + Math.cos(camYaw) * 220; }
            SF.HUD.showMsg('鹰眼 · 鼠标拖动瞄准 · 滚轮变焦 · 按住 Alt 操作地图', 3);
          }
        }
        keys.Shift = true; return;
      }
      if (k === 'Tab') { e.preventDefault(); if (!e.repeat) SF.HUD.toggleMissionDetail(); return; }
      if (k === 'KeyR') {
        if (!e.repeat) {
          const p = world && world.player;
          const al = p && p.alive && p.spec.gun.autoloader;
          if (al) {
            // 弹夹车: R = 丢弃剩余弹, 立即开始整夹长装填(弹夹已满且就绪时无效)
            if (p.clipPhase !== 'long' && (p.clipLeft < al.clip || p.reloadT > 0)) {
              const dump = p.clipLeft;
              const rack = p.modules.ammo > 0 ? (SF.CFG.armor.modules.ammo.reloadMult || 1) : 1;
              p.reloadT = p.reloadTotal = al.long * rack; p.clipPhase = 'long'; p.clipLeft = al.clip;
              SF.HUD.showMsg(`重置弹夹 · 丢弃 ${dump} 发 · 长装填 ${al.long.toFixed(1)}s`, 1.8);
            } else SF.HUD.showMsg(p.reloadT > 0 ? '整夹长装填中…' : '弹夹已满', 1.2);
          } else { cruise = 1; SF.HUD.showMsg('巡航 · 前进', 1.2); }
        }
        return;
      }
      if (k === 'KeyF') { if (!e.repeat) { cruise = -1; SF.HUD.showMsg('巡航 · 倒车', 1.2); } return; }
      if (k === 'KeyE') { if (!e.repeat) toggleAutoAim(); return; }
      if (k === 'KeyM') { if (!e.repeat) SF.HUD.toggleBigMap(); return; }
      if (k === 'KeyW' || k === 'KeyS') cruise = 0;   // 手动油门取消巡航
      keys[k] = true;
      if (/^Arrow/.test(k) || k === 'Space') e.preventDefault();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'AltLeft' || e.code === 'AltRight') { e.preventDefault(); altHeld = false; return; }
      const k = keyOf(e); if (k) keys[k] = false;
    }, true);
    // 失焦清键, 防卡键
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; altHeld = false; });
    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
  }

  const IDLE_INPUT = (t) => ({ throttle: 0, steer: 0, aimYaw: t.turretYaw, aimPitch: t.gunPitch, fire: false, holdTurret: true });

  // 自动瞄准(WoT E): 锁定准星方向最近的可见敌人, 炮塔持续跟踪
  function playerEnemies() {
    if (MP.mode === 'sp') return world.enemies.filter(e => e.alive);
    return [...MP.tanks.values()].filter(t => t.netId !== MP.myId && t.alive && t.team !== world.player.team);
  }
  function toggleAutoAim() {
    if (autoTarget) { autoTarget = null; SF.HUD.showMsg('自动瞄准解除', 1); return; }
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    let best = null, bestAng = 16 * Math.PI / 180;   // WoT 式宽容锥角(容纳相机俯仰)
    for (const e of playerEnemies()) {
      const to = e.pos3.clone().sub(camera.position);
      const ang = to.normalize().angleTo(dir);
      if (ang < bestAng && SF.losClear(world, camera.position.x, camera.position.z, e.x, e.z)) { bestAng = ang; best = e; }
    }
    if (best) { autoTarget = best; SF.HUD.showMsg('自动瞄准：' + best.spec.name, 1.5); }
    else SF.HUD.showMsg('准星方向无目标', 1.2);
  }

  // 敌军等级匹配: 按参战玩家最高等级, 同类别选邻近等级敌车(开 VIII 级不再割草 III 级)
  const TIER_NUM = { III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  function pickTierTank(cls, band) {
    for (let w = 0; w < 4; w++) {
      const lo = Math.max(3, band[0] - w), hi = Math.min(8, band[1] + w);
      const pool = [];
      for (const k in SF.CFG.vehicles) {
        const v = SF.CFG.vehicles[k];
        if (v.tier && v.cls === cls && TIER_NUM[v.tier] >= lo && TIER_NUM[v.tier] <= hi) pool.push(k);
      }
      if (pool.length) return pool[(Math.random() * pool.length) | 0];
    }
    return 'pz4';
  }

  function playerInput() {
    const p = world.player;
    const manual = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0);
    const input = {
      throttle: manual || cruise,
      // 注意: yaw 增大 = 向左转(俯视逆时针), 所以 A=+1 / D=-1
      steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0),
      fire: mouseDown
    };
    if (aimPoint) {
      const dx = aimPoint.pos.x - p.x, dz = aimPoint.pos.z - p.z;
      input.aimYaw = Math.atan2(dx, dz);
      input.aimPitch = Math.atan2(aimPoint.pos.y - (p.y + 2.2), Math.hypot(dx, dz));
      // 自行火炮: 抛物线弹道解算仰角(WoT 高抛优先: 隔掩体吊射; 高抛仰角够不到的近距离退低伸直射)
      if (p.spec.cls === 'SPG') {
        const v = p.spec.gun.speed, g = p.spec.gun.grav || SF.CFG.sim.shellGravity;
        const d = Math.hypot(dx, dz);
        const h = (p.y + 2.2) - aimPoint.pos.y;              // 炮口高于落点
        const A = g * d * d / (2 * v * v);
        const disc = d * d - 4 * A * (A - h);
        const uMax = Math.tan(p.spec.gunElevation);
        let u = uMax;
        if (d > 2 && disc >= 0) {
          const uHi = (d + Math.sqrt(disc)) / (2 * A);       // 高抛解
          u = uHi <= uMax ? uHi : (d - Math.sqrt(disc)) / (2 * A);   // 低伸解(直射自保)
        }
        input.aimPitch = Math.atan(Math.min(u, uMax));       // 超出射程: 压最大仰角
      }
    } else { input.aimYaw = camYaw; input.aimPitch = 0; }
    // WoT 式右键自由视角: 按住右键时炮塔转角/炮管俯仰相对车体锁定(车体转动炮塔跟着走),
    // 相机自由查看四周; 松开后炮塔伺服重新追赶相机瞄准
    // (鹰眼模式例外: 落点恒为视野中心, 右键不解锁弹道解算)
    if (freeLook && !(sniper && p.spec.cls === 'SPG')) input.holdTurret = true;
    // 自动瞄准: 炮塔持续跟踪锁定目标(优先于自由视角)
    if (autoTarget && autoTarget.alive) {
      const dx = autoTarget.x - p.x, dz = autoTarget.z - p.z;
      input.aimYaw = Math.atan2(dx, dz);
      input.aimPitch = Math.atan2(autoTarget.y + 1.1 - (p.y + 2.2), Math.max(Math.hypot(dx, dz), 1));
    }
    // 固定战斗室(WoT 式): 准星超出炮管射界 → 车体自动转向, 转到对准准星(±1.5°)才停;
    // 玩家按键转向优先(打断自动转向); 右键自由视角时不自动转
    if (input.steer) p._autoTurn = false;
    if (p.parts.noTurret && aimPoint && !input.steer && !freeLook) {
      const arc = (p.spec.gunArc !== undefined) ? p.spec.gunArc : 10 * Math.PI / 180;
      const off = SF.Util.angDiff(p.yaw, input.aimYaw);
      if (Math.abs(off) > arc) p._autoTurn = true;                                   // 超出射界 → 触发
      else if (Math.abs(off) < 1.5 * Math.PI / 180) p._autoTurn = false;             // 对准 → 停
      if (p._autoTurn) input.steer = SF.Util.clamp(off * 2.5, -1, 1);
    }
    return input;
  }

  /* ---------- 事件接线(模拟 → 表现) ---------- */
  const HIT_TEXT = { pen: '击穿', bounce: '跳弹', nopen: '未击穿', gun: '火炮损伤', splash: '命中', absorb: '履带吸收', ram: '撞击' };
  const HIT_COLOR = { pen: '#ffb35c', bounce: '#f2f2f2', nopen: '#9aa0a6', gun: '#ffd97a', splash: '#ffb35c', absorb: '#9fd0ff', ram: '#ffb35c' };
  const MODULE_TAG = { track: '·履带', engine: '·发动机', ammo: '·弹药架', gun: '' };

  function bindBus() {
    SF.Bus.on('fire', (e) => {
      e.tank.lastFireT = world.time;
      if (e.tank.isPlayer) stats.shots++;
      if (e.tank.team !== world.player.team) { SF.HUD.shotFrom(e.pos, false); lastKnown.set(e.tank, { x: e.tank.x, z: e.tank.z }); }   // 敌方炮口小地图标记
      // 玩家(或友军)开炮: 炮声全图可闻 → 上报全队情报(误差随距离增大, 远处只知个大概)
      if (e.tank.isPlayer || e.tank.team === world.player.team) {
        let minD = 1e9;
        for (const en of world.enemies)
          if (en.alive) minD = Math.min(minD, SF.Util.dist2d(en.x, en.z, e.tank.x, e.tank.z));
        if (minD < SF.CFG.ai.shotHearing) {
          const err = 16 + minD * 0.07;
          const old = world.intel;
          world.intel = { x: e.tank.x + (Math.random() - .5) * 2 * err, z: e.tank.z + (Math.random() - .5) * 2 * err,
            t: world.time, level: (old.level === 2 && world.time - old.t < SF.CFG.ai.memoryTime) ? 2 : 1 };
        }
      }
      fx.flash(e.pos, e.tank.isPlayer ? 2.6 : 2.0);
      SF.Audio.play('cannon', e.pos, { gain: e.tank.isPlayer ? 1.8 : 1.2 });
      if (e.tank.isPlayer) shakeT = 1;
    });
    SF.Bus.on('hit', (r) => {
      const shooter = r.shooter, target = r.target;
      if (shooter && shooter.isPlayer) {
        stats.hits++; if (r.kind === 'pen') stats.pens++;
        stats.dmg += r.dmg;
      }
      const text = { pen: `-${r.dmg}`, bounce: '跳弹', nopen: '未击穿', gun: '火炮受损', absorb: '履带吸收', ram: `-${r.dmg}`,
                     splash: r.dmg > 0 ? `-${r.dmg}` : '未击穿' }[r.kind] || '';
      SF.HUD.dmgNumber(r.point, text, HIT_COLOR[r.kind] || '#fff');
      const snd = r.kind === 'pen' ? 'pen' : r.kind === 'bounce' ? 'bounce' : 'nopen';
      // 音量: 自己挨打最响; 自己打中的反馈音用慢衰减(atten 大)保证清晰
      if (r.kind !== 'splash')   // HE 溅射的爆炸声已在弹着点播过
        SF.Audio.play(snd, target.isPlayer ? null : r.point, { gain: target.isPlayer ? 1.7 : 1.0, atten: 140 });
      // 归属分明的提示: 我打出去的 → 准星下方; 我挨打的 → 顶部红色警报 (文字+语音, 语音多变体随机)
      if (shooter && shooter.isPlayer) {
        SF.HUD.hitFeedback(HIT_TEXT[r.kind] + (r.module && r.kind !== 'absorb' ? MODULE_TAG[r.module] : ''), HIT_COLOR[r.kind]);
        if (r.module) SF.HUD.log(`敌方${MODULE_TAG[r.module] || ''}损伤`, '#a8d0a8');
        SF.Audio.playVoice({ pen: 'v_pen', bounce: 'v_bounce', nopen: 'v_nopen', gun: 'v_gunout', absorb: 'v_absorb', ram: 'v_ram' }[r.kind]);
      } else if (target.isPlayer) {
        if (r.kind === 'pen') {
          SF.HUD.alarm(`被击穿 -${r.dmg}` + (r.module ? ` · ${SF.CFG.armor.modules[r.module].text}` : ''));
          SF.Audio.playVoice('v_hitpen', true);
          if (r.module) SF.Audio.playVoice({ track: 'v_track', engine: 'v_engine', ammo: 'v_ammo', gun: 'v_gun' }[r.module], true);
        }
        else if (r.kind === 'absorb') { SF.HUD.alarm('履带被打断 · 伤害被吸收'); SF.Audio.playVoice('v_track', true); }
        else if (r.kind === 'ram') { SF.HUD.alarm(`被撞击 -${r.dmg}`); SF.Audio.playVoice('v_rammed', true); }
        else if (r.kind === 'bounce') SF.HUD.hitFeedback('跳弹', '#9fd0ff');
        else if (r.kind === 'splash') { SF.HUD.alarm(r.dmg > 0 ? `被炮击 -${r.dmg}` : '炮击被装甲吸收'); SF.Audio.playVoice('v_splash', true); }
      }
      // 受击方向: 指弹着点方位(来弹方向), 而非敌人当前站位(移速快的会偏)
      if (target.isPlayer && shooter) SF.HUD.hitFrom(r.point || shooter);
      if (target.isPlayer) shakeT = Math.max(shakeT, 0.7);
      if (r.module === 'track') SF.Audio.play('track', target.isPlayer ? null : r.point, { gain: 1.2 });
    });
    SF.Bus.on('reloaded', (e) => {
      // 弹夹炮夹内短装填不播"装填完成"(连发会刷屏); 慢炮(≥6s)用语音播报, 快炮只有音效
      if (e.tank.isPlayer && (!e.tank.spec.gun.autoloader || e.tank.clipPhase !== 'intra')) {
        if (e.tank.reloadTotal >= 6) SF.Audio.playVoice('v_reload');
        else SF.Audio.play('reload', null, { gain: 1.5 });
      }
    });
    SF.Bus.on('shellFrom', (d) => SF.HUD.shotFrom(d, true));   // 近弹: 屏幕箭头 + 标记
    // 未命中不再弹提示(打偏自己看弹着点就知道, 反复"未命中"很烦)
    SF.Bus.on('destroyed', (e) => {
      const t = e.tank;
      if (t.isPlayer) deathMark = { x: t.x, z: t.z };   // 记录阵亡点(小地图 ✕)
      fx.explosion(t.pos3);
      SF.Audio.play('explosion', t.pos3, { gain: 1.3 });
      if (SF.Game_mp.mode !== 'sp') {
        // 死斗: 无失败流程, 主机为阵亡者(含自己)排队重生
        if (SF.Game_mp.mode === 'host' && t.netId && !t._isAI) SF.Game_mp.respawn.push({ id: t.netId, t: 5 });
        if (t.isPlayer) SF.HUD.showMsg('被击毁 · 5 秒后重生', 3);
        else { SF.HUD.hitFeedback('击毁', '#8fd98f'); SF.Audio.playVoice('v_kill', true); }
        return;
      }
      if (t.isPlayer) { loseT = 2.5; SF.HUD.showMsg('坦克被击毁…', 3); }
      else {
        stats.kills++;
        // 最后一波的最后一辆 → 全歼播报(按实际情况换词)
        const isWipe = !world.enemies.some(e => e.alive) && world.map.waves && waveIdx >= world.map.waves.length - 1;
        SF.HUD.hitFeedback('击毁', '#8fd98f');
        SF.Audio.playVoice(isWipe ? 'v_wipe' : 'v_kill', true);
        SF.HUD.log(`击毁：${t.spec.name}`, '#8fd98f');
      }
    });
  }

  /* ---------- 主循环 ---------- */
  function step(dt) {
    const p = world.player;
    const prevX = p.x, prevZ = p.z;
    world.time += dt;
    stats.time += dt;

    if (MP.mode === 'client') {
      // 客户端: 不跑本地模拟(主机权威), 只推进时钟与本地表现
      world.time += dt;
      return;
    }

    const isMP = MP.mode === 'host';
    const myInput = p.alive && !gameOver ? playerInput() : IDLE_INPUT(p);
    p.update(myInput, dt, world);
    p.velX = (p.x - prevX) / dt; p.velZ = (p.z - prevZ) / dt;

    if (isMP) {
      // 主机: 用远端玩家网络输入推进他们的坦克(同一车辆接口)
      for (const [id, t] of MP.tanks) {
        if (id === MP.myId || !t._isRemote) continue;
        const ri = MP.inputs.get(id) || IDLE_INPUT(t);
        t.update(ri, dt, world);
      }
      // 重生队列
      for (const r of MP.respawn) {
        r.t -= dt;
        if (r.t <= 0) {
          const sp = MP.spawnPool[(Math.random() * MP.spawnPool.length) | 0];
          const tk = MP.tanks.get(r.id);
          scene.remove(tk.group);
          tk.rebuild();
          tk.x = sp[0] + (Math.random() - 0.5) * 20; tk.z = sp[1] + (Math.random() - 0.5) * 20; tk.yaw = Math.PI;
          scene.add(tk.group);
          tk._yInit = false;
        }
      }
      MP.respawn = MP.respawn.filter(r => r.t > 0);
      if (MP.gameMode === 'coop') for (const e of world.enemies) e.update(gameOver ? IDLE_INPUT(e) : e.ai.update(dt, world), dt, world);
      MP.timeLeft -= dt;
      if (MP.timeLeft <= 0 && !gameOver) endMatch();
    } else {
      // 结算后敌人熄火滑停(不再绕圈搜索/扫炮), 在飞炮弹与特效照常结算
      for (const e of world.enemies) {
        const inp = gameOver ? IDLE_INPUT(e) : e.ai.update(dt, world);
        e.update(inp, dt, world);   // 死亡车辆也要更新(残骸沉降/冒烟), update 内部分支处理
      }
    }

    shells.update(dt, world);

    if (MP.mode === 'sp' || (MP.mode === 'host' && MP.gameMode === 'coop')) {
      if (repairT > 0) repairT -= dt;
      checkWave();
    }

    // 玩家对敌发现: 视距×(1-目标隐蔽) + 多点通视 + 50m 强制点亮 + 5~10s 残留
    spottedTimer -= dt;
    if (spottedTimer <= 0) {
      spottedTimer = 0.25;
      const vr = p.spec.view || SF.CFG.player.viewRange;
      const markSpot = (e, visible) => {
        if (visible) {
          if (!spotStreak.has(e)) spotStreak.set(e, world.time);
          spottedLast.set(e, world.time);
        } else if (spotStreak.has(e)) {
          spotLinger.set(e, U.clamp(5 + (world.time - spotStreak.get(e)) * 0.5, 5, 10));
          spotStreak.delete(e);
        }
      };
      const lit = (e) => {
        const d = U.dist2d(p.x, p.z, e.x, e.z);
        return d < 50 || (d < vr * (1 - SF.camoOf(e, world)) && SF.losClearAny(world, p.x, p.z, e.x, e.z));
      };
      for (const e of world.enemies) {
        if (!e.alive) { spottedLast.delete(e); spotStreak.delete(e); spotLinger.delete(e); continue; }
        markSpot(e, lit(e));
      }
      spotted.clear();
      for (const [e, t0] of spottedLast)
        if (world.time - t0 < (spotLinger.get(e) || 5)) spotted.add(e);
        else { spottedLast.delete(e); spotLinger.delete(e); }
      for (const e of spotted) lastKnown.set(e, { x: e.x, z: e.z });   // 点亮=实时刷新最后已知位置
      for (const [e] of lastKnown) if (!e.alive) lastKnown.delete(e);
    }
    if (MP.mode === 'host') {   // 死斗小地图红点: 其他玩家(同套隐蔽/通视/强制点亮)
      spottedTimer -= dt;
      if (spottedTimer <= 0) {
        spottedTimer = 0.25;
        const vr = p.spec.view || SF.CFG.player.viewRange;
        for (const [id, t] of MP.tanks) {
          if (id === MP.myId) continue;
          if (!t.alive) { spottedLast.delete(t); spotStreak.delete(t); spotLinger.delete(t); continue; }
          const d = U.dist2d(p.x, p.z, t.x, t.z);
          const vis = d < 50 || (d < vr * (1 - SF.camoOf(t, world)) && SF.losClearAny(world, p.x, p.z, t.x, t.z));
          if (vis) { if (!spotStreak.has(t)) spotStreak.set(t, world.time); spottedLast.set(t, world.time); }
          else if (spotStreak.has(t)) { spotLinger.set(t, U.clamp(5 + (world.time - spotStreak.get(t)) * 0.5, 5, 10)); spotStreak.delete(t); }
        }
        spotted.clear();
        for (const [t, t0] of spottedLast)
          if (world.time - t0 < (spotLinger.get(t) || 5)) spotted.add(t);
          else { spottedLast.delete(t); spotLinger.delete(t); }
        for (const t of spotted) lastKnown.set(t, { x: t.x, z: t.z });
        for (const [t] of lastKnown) if (!t.alive) lastKnown.delete(t);
      }
    }
    let enemySeesMe = false;
    if (MP.mode === 'host') {
      if (MP.gameMode === 'coop') {
        for (const e of world.enemies) if (e.alive && e.ai && e.ai.seenNow && e.ai.lastTargetId === p.netId) { enemySeesMe = true; break; }
      } else {
        for (const [id, t] of MP.tanks) {
          if (id === MP.myId || !t.alive) continue;
          const d = U.dist2d(p.x, p.z, t.x, t.z);
          const vr = t.spec.view || SF.CFG.player.viewRange;   // 对方的视距 × 我的隐蔽
          if (d < 50 || (d < vr * (1 - SF.camoOf(p, world)) && SF.losClearAny(world, t.x, t.z, p.x, p.z))) { enemySeesMe = true; break; }
        }
      }
    } else {
      for (const e of world.enemies) if (e.alive && e.ai && e.ai.seenNow) { enemySeesMe = true; break; }
    }
    // 六感灯(WoT): 被持续注视 3 秒后才亮起; 不再被盯后余亮 2 秒
    if (enemySeesMe) { lampT += dt; lastSpottedT = world.time; }
    else lampT = 0;
    const detected = p.alive && lampT >= 3 && (world.time - lastSpottedT < 2.0);
    if (detected && !wasDetected) SF.Audio.play('beep', null, { gain: 1.1 });
    wasDetected = detected;

    if (autoTarget && !autoTarget.alive) { autoTarget = null; SF.HUD.showMsg('目标已击毁 · 自动瞄准解除', 1.5); }
    if (loseT > 0) { loseT -= dt; if (loseT <= 0 && !gameOver) { gameOver = true; SF.HUD.endGame(false, stats); } }
  }

  function frame(dtReal) {
    if (MP.mode === 'client') clientFrame(dtReal);
    updateCamera(dtReal);
    computeAim();
    fx.update(dtReal);
    SF.Audio.setEngine(Math.abs(world.player.speed) / world.player.spec.maxSpeed, keys.KeyW || keys.KeyS ? 1 : 0);
    SF.HUD.update(dtReal, world, SF.Game.uiState);
    if (MP.mode === 'host') {
      hostSnapshot(dtReal);
      updateMpHud();
    }
    if (MP.mode === 'client') updateMpHud();
    // 键盘诊断: 8 秒内没收到任何按键 → 提示点击画面获取焦点
    if (!keySeen && !hintShown && world.time > 8) {
      hintShown = true;
      SF.HUD.showMsg('未检测到键盘输入——请点击一下游戏画面', 6);
    }
    renderer.render(scene, camera);
  }

  function tick(t) {
    const dtReal = Math.min(0.1, (t - lastT) / 1000 || 0.016);
    lastT = t;
    acc += dtReal;
    const dt = SF.CFG.sim.dt;
    while (acc >= dt) { step(dt); acc -= dt; }
    frame(dtReal);
  }

  function loop(t) {
    if (!running) return;
    requestAnimationFrame(loop);
    lastRaf = t;
    tick(t);
  }

  // 渲染看门狗: 页面被判定遮挡时 rAF 会停摆(可见却冻结), 自动降级为定时器驱动
  setInterval(() => {
    if (!running) return;
    const rafAlive = performance.now() - lastRaf < 600;
    if (!rafAlive && !timerId) timerId = setInterval(() => tick(performance.now()), 16);
    else if (rafAlive && timerId) { clearInterval(timerId); timerId = null; }
  }, 300);

  /* ---------- 启动 ---------- */
  // 小 tip: 每条最多显示 2 次(跨会话记忆), 加载屏与首页各一条
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

  async function start() {
    const bar = document.getElementById('loadBar'), tip = document.getElementById('loadTip');
    showTip('tipOnLoad');
    try {
      await SF.Assets.load((done, total) => {
        bar.style.width = (done / total * 100) + '%';
        tip.textContent = `加载资源 ${done}/${total}`;
      });
    } catch (err) {
      tip.innerHTML = `<span style="color:#e06c5a">${err.message}</span><br>请通过 HTTP 访问(运行项目根目录的 启动游戏.sh / .bat)`;
      return;
    }
    document.getElementById('loading').style.display = 'none';
    document.getElementById('titleScreen').style.display = 'flex';
    showTip('tipOnTitle');
    // 版本号: CI 部署时写入提交时刻(精确到秒); 本地无此文件则静默隐藏
    fetch('version.txt?v=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(t => {
        const d = new Date(t.trim());
        if (isNaN(d)) return;
        const p2 = n => String(n).padStart(2, '0');
        document.getElementById('verStamp').textContent =
          `v${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
      }).catch(() => { });
    // 恢复上次选择的坦克与地图
    selTank = localStorage.getItem('sf_mp_tank') || selTank;
    selMap = localStorage.getItem('sf_map') || selMap;
    if (!SF.CFG.vehicles[selTank]) selTank = 'sherman';
    if (!SF.CFG.maps.find(m => m.id === selMap)) selMap = 'l01';
    buildGaragePreview();
    buildPicker();

    document.getElementById('btnStart').addEventListener('click', () => {
      disposeGarage();
      startBattle();
    });
    document.getElementById('btnExit').addEventListener('click', exitToTitle);
    document.getElementById('btnRetry').addEventListener('click', () => (MP.mode === 'sp' ? startBattle() : exitToTitle()));
    document.getElementById('btnToGarage').addEventListener('click', exitToTitle);
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
    setGarageTheme(selMap);

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
    if (garagePV.tankGroup) garagePV.scene.remove(garagePV.tankGroup);
    const parts = SF.Models.makeTank(type);
    parts.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    garagePV.scene.add(parts.root);
    garagePV.tankGroup = parts.root;
    garagePV.turret = parts.turret;
    garagePV.gun = parts.gun;
    const v = SF.CFG.vehicles[type];
    const al = v.gun.autoloader;
    document.getElementById('garageStats').innerHTML =
      `<b>${v.name}</b><span>HP ${v.hp} · 穿深 ${v.gun.pen} · 单发 ${v.gun.dmg} · ${al ? `弹夹 ${al.clip} 发(间隔 ${al.intra}s/整夹 ${al.long}s)` : `装填 ${v.gun.reload}s`}${v.gun.splash ? ` · 溅射 ${v.gun.splash}m` : ''} · 极速 ${Math.round(v.maxSpeed * 3.6)} km/h</span>`;
    garagePV.renderer.render(garagePV.scene, garagePV.cam);
  }

  // 出击前车库: 选坦克 + 选地图
  function buildPicker() {
    const g = document.getElementById('garageRow'), m = document.getElementById('mapRow');
    g.innerHTML = ''; m.innerHTML = '';
    for (const t of SF.CFG.garage) {
      const v = SF.CFG.vehicles[t.type];
      const el = document.createElement('div');
      el.className = 'card' + (t.type === selTank ? ' sel' : '');
      el.innerHTML = `<b>${v.name}</b><i>${SF.ClsIcon(t.cls)} ${t.tag}</i><span>${t.desc}</span><em>HP ${v.hp} · 穿深 ${v.gun.pen} · 单发 ${v.gun.dmg} · 极速 ${Math.round(v.maxSpeed * 3.6)}</em>`;
      el.onclick = () => { selTank = t.type; localStorage.setItem('sf_mp_tank', t.type); [...g.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); setGarageTank(t.type); };
      g.appendChild(el);
    }
    for (const mp of SF.CFG.maps) {
      const el = document.createElement('div');
      el.className = 'card' + (mp.id === selMap ? ' sel' : '');
      el.innerHTML = `<b>${mp.name}</b><span>${mp.desc}</span>`;
      el.onclick = () => { selMap = mp.id; localStorage.setItem('sf_map', mp.id); [...m.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); setGarageTheme(mp.id); };
      m.appendChild(el);
    }
    setGarageTank(selTank);   // 初始渲染上次选择的坦克
  }

  /* ---------- 战斗生命周期: 开战 / 退出回车库 / 再战 ---------- */
  let battleBound = false;   // 输入与事件总线只绑一次(重开战斗不重复绑定)
  function resetBattleVars() {
    gameOver = false; loseT = -1; waveIdx = 0; repairT = 0; repairDone = false; spottedTimer = 0;
    deathMark = null; autoTarget = null; sniper = false; freeLook = false; mouseDown = false; cruise = 0; shakeT = 0;
    vcx = innerWidth / 2; vcy = innerHeight / 2;
    spottedLast.clear(); spotStreak.clear(); spotLinger.clear(); lastKnown.clear(); lampT = 0;
    stats = { kills: 0, total: 0, shots: 0, hits: 0, pens: 0, dmg: 0, time: 0 };
  }
  function leaveBattle() {
    running = false;                              // 停主循环(看门狗检测 running 也会停)
    if (timerId) { clearInterval(timerId); timerId = null; }   // 降级定时器一并停, 否则退出后仍在空跑旧战场
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { }
    // 释放上一场战斗的画布与 GL 上下文: 残留 canvas 会把新画布顶出屏幕(重开后画面像冻结), 上下文累积也会耗尽 WebGL 配额
    trajLine = null; groundLine = null;
    if (renderer) {
      try { renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) { }
      renderer.domElement.remove();
      renderer = null;
    }
    scene = null; world = null; fx = null; shells = null;
    if (MP.mode !== 'sp') { SF.Net.stopInputLoop(); SF.Net.close(); MP.mode = 'sp'; MP.tanks.clear(); }
    SF.Audio.stopBattle();
    document.getElementById('hud').style.display = 'none';
    const ovEl = document.getElementById('overlay');
    ovEl.classList.remove('on', 'settled'); ovEl.style.display = 'none';
  }
  function exitToTitle() {
    leaveBattle();
    document.getElementById('titleScreen').style.display = 'flex';
    buildGaragePreview();       // 重建车库场景(出击时已销毁)
    setGarageTank(selTank);
  }
  function startBattle() {
    leaveBattle();
    resetBattleVars();
    document.getElementById('titleScreen').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    SF.Audio.init();
    SF.Audio.startEngine();
    SF.Audio.startAmbient();
    buildScene();
    SF.HUD.init(world);
    if (!battleBound) { battleBound = true; bindInput(); bindBus(); }
    // 出击即锁定鼠标(点击是用户手势); 失败(如浏览器冷却期)不阻断, 点画面可补锁
    try {
      const pr = renderer.domElement.requestPointerLock();
      if (pr && pr.catch) pr.catch(() => { });
    } catch (e) { }
    SF.HUD.showMsg(world.map.briefing, 5);
    running = true; lastT = performance.now();
    requestAnimationFrame(loop);
  }

  /* ---------- 联机: 主机快照广播(20Hz) ---------- */
  function hostSnapshot(dt) {
    MP.snapT -= dt;
    if (MP.snapT > 0) return;
    MP.snapT = 0.05;
    const tn = {};
    for (const [id, t] of MP.tanks)
      tn[id] = [+t.x.toFixed(2), +t.z.toFixed(2), +t.y.toFixed(2), 0, +t.yaw.toFixed(3), +t.turretYaw.toFixed(3), +t.gunPitch.toFixed(3), +t.speed.toFixed(2), Math.round(t.hp), t.alive ? 1 : 0];
    const sc = {};
    for (const [id, k] of MP.scores) sc[id] = k;
    const msg = { t: 'snap', st: Math.max(0, Math.round(MP.timeLeft)), tn, sc };
    if (MP.gameMode === 'coop') {
      msg.wv = [waveIdx, world.map.waves.length, (world.map.waves[waveIdx] || {}).name || '',
        [...MP.scores.entries()].filter(([id]) => id < 100).reduce((s2, [, k]) => s2 + k, 0), stats.total];
      const dtMap = {};
      for (const [id] of MP.tanks) if (id < 100)
        for (const e of world.enemies) if (e.alive && e.ai && e.ai.seenNow && e.ai.lastTargetId === id) { dtMap[id] = 1; break; }
      msg.dt = dtMap;
    }
    SF.Net.send(msg);
  }

  /* ---------- 联机: 客户端帧(幽灵插值 + 死亡表现) ---------- */
  function clientFrame(dt) {
    const snap = SF.Net.interpolate(120);
    if (!snap) return;
    for (const [id, t] of MP.tanks) {
      const pose = snap.poses[id];
      if (pose) {
        t.ghostPose(pose, dt);
        if (t._awaitPose) { t._awaitPose = false; t.group.visible = true; }
      }
    }
    MP.timeLeft = snap.timeLeft;
    if (snap.scores) for (const id in snap.scores) MP.scores.set(+id, snap.scores[id]);
    if (snap.wv) MP.waveInfo = { idx: snap.wv[0], total: snap.wv[1], name: snap.wv[2], kills: snap.wv[3], totalEnemies: snap.wv[4] };
    // 点亮: 主机裁决(dt 表)分发; 小地图红点用本地 视距×(1-隐蔽)+通视+50m 强制
    const p = world.player;
    spottedTimer -= dt;
    if (spottedTimer <= 0) {
      spottedTimer = 0.25;
      const vr = p.spec.view || SF.CFG.player.viewRange;
      for (const [id, t] of MP.tanks) {
        if (id === MP.myId) continue;
        if (!t.alive) { spottedLast.delete(t); spotStreak.delete(t); spotLinger.delete(t); continue; }
        const d = U.dist2d(p.x, p.z, t.x, t.z);
        const vis = d < 50 || (d < vr * (1 - SF.camoOf(t, world)) && SF.losClearAny(world, p.x, p.z, t.x, t.z));
        if (vis) { if (!spotStreak.has(t)) spotStreak.set(t, world.time); spottedLast.set(t, world.time); }
        else if (spotStreak.has(t)) { spotLinger.set(t, U.clamp(5 + (world.time - spotStreak.get(t)) * 0.5, 5, 10)); spotStreak.delete(t); }
      }
      spotted.clear();
      for (const [t, t0] of spottedLast)
        if (world.time - t0 < (spotLinger.get(t) || 5)) spotted.add(t);
        else { spottedLast.delete(t); spotLinger.delete(t); }
      for (const t of spotted) lastKnown.set(t, { x: t.x, z: t.z });
      for (const [t] of lastKnown) if (!t.alive) lastKnown.delete(t);
    }
    const seenByHost = MP.gameMode === 'coop' ? (p.alive && !!(snap.dt && snap.dt[MP.myId])) : (p.alive && spotted.size > 0);
    if (seenByHost) { lampT += dt; lastSpottedT = world.time; }
    else lampT = 0;
    const dNow = p.alive && lampT >= 3 && (world.time - lastSpottedT < 2.0);   // 六感灯 3s 延迟
    if (dNow && !wasDetected) SF.Audio.play('beep', null, { gain: 1.1 });
    wasDetected = dNow;
    world.time += 0;   // 时钟由 step 推进
  }

  function updateMpHud() {
    const el = document.getElementById('mpBar');
    if (!el || MP.mode === 'sp') return;
    if (MP.gameMode === 'coop') {
      el.textContent = `🤝 合作闯关 · 我的击杀 ${MP.scores.get(MP.myId) || 0}`;
      el.style.display = 'block';
      return;
    }
    const mm = Math.floor(MP.timeLeft / 60), ss = String(Math.floor(MP.timeLeft % 60)).padStart(2, '0');
    const rows = MP.players.map(pl => `${pl.id === MP.myId ? '★' : ''}${pl.name} ${MP.scores.get(pl.id) || 0}`).join(' · ');
    el.textContent = `⏱ ${mm}:${ss}   ${rows}`;
    el.style.display = 'block';
  }

  /* ---------- 联机事件中继: 主机转发 Bus 事件, 客户端还原成本地事件 ---------- */
  function proxyTank(id) {
    const t = MP.tanks.get(id);
    const fake = { isPlayer: id === MP.myId, x: t ? t.x : 0, z: t ? t.z : 0, pos3: t ? t.pos3 : new THREE.Vector3(), spec: { name: t ? t.spec.name : '?' } };
    return fake;
  }
  function bindMpRelay() {
    // 主机: 本地事件 → 序列化广播
    SF.Bus.on('fire', (e) => { if (MP.mode !== 'host') return; SF.Net.send({ t: 'ev', k: 'fire', d: { id: e.tank.netId, p: [e.pos.x, e.pos.y, e.pos.z] } }); });
    SF.Bus.on('hit', (r) => {
      if (MP.mode !== 'host') return;
      SF.Net.send({ t: 'ev', k: 'hit', d: { s: r.shooter.netId, g: r.target.netId, kind: r.kind, dmg: r.dmg, module: r.module || 0, p: [r.point.x, r.point.y, r.point.z] } });
    });
    SF.Bus.on('destroyed', (e) => {
      if (MP.mode !== 'host') return;
      SF.Net.send({ t: 'ev', k: 'kill', d: { id: e.tank.netId, by: (e.shooter && e.shooter.netId) || 0, p: [e.tank.x, e.tank.y + 1, e.tank.z] } });
      if (e.shooter && e.shooter.netId) MP.scores.set(e.shooter.netId, (MP.scores.get(e.shooter.netId) || 0) + 1);
    });
    // 客户端: 收到事件 → 还原成本地 Bus 事件(表现层无差别)
    SF.Net.on('ev', (m) => {
      if (MP.mode !== 'client') return;
      const d = m.d;
      if (m.k === 'fire') {
        SF.Bus.emit('fire', { tank: proxyTank(d.id), pos: new THREE.Vector3(...d.p), dir: new THREE.Vector3(0, 0, 1) });
        const tk = MP.tanks.get(d.id);
        if (tk && tk.team !== MP.tanks.get(MP.myId).team) SF.HUD.shotFrom({ x: d.p[0], z: d.p[2] }, false);
      }
      else if (m.k === 'hit') {
        SF.Bus.emit('hit', { shooter: proxyTank(d.s), target: proxyTank(d.g), kind: d.kind, dmg: d.dmg, module: d.module || null, point: new THREE.Vector3(...d.p) });
      } else if (m.k === 'aiWave') {
        for (const it of d.list) {
          const g = new SF.Tank(it.type, { x: 0, z: 0, netId: it.id, team: 1 });
          g.group.visible = false; g._awaitPose = true;
          scene.add(g.group);
          MP.tanks.set(it.id, g);
          world.enemies.push(g);
        }
        SF.HUD.log(`敌军出现：${d.list.length} 辆`, '#e8c977');
      } else if (m.k === 'kill') {
        const t = MP.tanks.get(d.id);
        if (t && t.alive) { t.alive = false; }
        SF.Bus.emit('destroyed', { tank: proxyTank(d.id), shooter: proxyTank(d.by) });
        if (d.by) MP.scores.set(d.by, (MP.scores.get(d.by) || 0) + 1);
      }
    });
    SF.Net.on('end', (m) => {
      gameOver = true;
      const rows = m.scores.map(([id, name, k]) => `<div style="color:${id === MP.myId ? '#ffd97a' : '#b9bfa8'}">${id === MP.myId ? '★ ' : ''}${name} — ${k} 击杀</div>`).join('');
      SF.HUD.showOverlay();
      document.getElementById('endTitle').textContent = m.win ? '✓ 任务完成' : '对战结束';
      document.getElementById('endTitle').style.color = m.win ? '#8fd98f' : '#d8c887';
      document.getElementById('endStats').innerHTML = `<div style="font-size:20px;line-height:2.2">${rows}</div>`;
      document.getElementById('btnRetry').style.display = 'none';   // 联机结算: 只能回车库
      SF.Net.stopInputLoop();
    });
    SF.Net.on('err', (m) => { alert(m.msg || '服务器错误'); location.reload(); });
  }

  function endMatch() {
    gameOver = true;
    const scores = MP.players.map(pl => [pl.id, pl.name, MP.scores.get(pl.id) || 0]).sort((a, b) => b[2] - a[2]);
    SF.Net.send({ t: 'end', scores });
    const rows = scores.map(([id, name, k]) => `<div style="color:${id === MP.myId ? '#ffd97a' : '#b9bfa8'}">${id === MP.myId ? '★ ' : ''}${name} — ${k} 击杀</div>`).join('');
    SF.HUD.showOverlay();
    document.getElementById('endTitle').textContent = '对战结束';
    document.getElementById('endTitle').style.color = '#d8c887';
    document.getElementById('endStats').innerHTML = `<div style="font-size:20px;line-height:2.2">${rows}</div>`;
    document.getElementById('btnRetry').style.display = 'none';   // 联机结算: 只能回车库
    SF.Net.stopInputLoop();
  }

  /* ---------- 联机开局: 房主/加入者共用 ---------- */
  function startMultiplayer(role, init) {
    MP.mode = role;
    MP.myId = init.you;
    MP.players = init.players;
    MP.mapId = init.map || 'l01';
    MP.gameMode = init.mode === 'coop' ? 'coop' : 'dm';
    MP.waveInfo = null; MP.aiId = 100;
    for (const pl of MP.players) MP.scores.set(pl.id, 0);
    disposeGarage();
    document.getElementById('titleScreen').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    SF.Audio.init(); SF.Audio.startEngine(); SF.Audio.startAmbient();

    const mapSel = SF.CFG.maps.find(m => m.id === MP.mapId) || SF.CFG.maps[0];
    selMap = mapSel.id;
    selTank = (init.players.find(pl => pl.id === init.you) || {}).tank || 'sherman';

    // 场景: coop 主机保留波次流程(主机跑 AI), 其余关闭单机流程
    if (!(MP.gameMode === 'coop' && role === 'host')) { spawnWave = () => { }; checkWave = () => { }; }
    buildScene();

    // 死斗出生池: 地图中心外围 8 点
    MP.spawnPool = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      let sx = Math.cos(a) * 310, sz = Math.sin(a) * 310;
      [sx, sz] = world.covers.collide(sx, sz, 3);
      MP.spawnPool.push([sx, sz]);
    }

    // 移除 buildScene 创建的单机默认玩家
    scene.remove(world.player.group);

    // 建坦克: 主机=真实模拟; 客户端=幽灵(不 update)
    for (const pl of MP.players) {
      const sp = MP.spawnPool[(pl.id * 3) % 8];
      const isMe = pl.id === MP.myId;
      const t = new SF.Tank(pl.tank, {
        x: sp[0], z: sp[1], yaw: Math.PI,
        netId: pl.id, team: MP.gameMode === 'coop' ? 0 : 100 + pl.id,   // 死斗人人一队; 合作同一阵营
        isPlayer: isMe
      });
      t._isRemote = !isMe;
      scene.add(t.group);
      MP.tanks.set(pl.id, t);
      if (isMe) { world.player = t; world.tanks = [t]; world.enemies = []; }
      else if (role === 'host') world.tanks.push(t);
    }
    world.enemies = [];
    world.player._yInit = false;
    if (MP.gameMode === 'coop') {
      MP.timeLeft = 9999;
      if (role === 'host') {
        world.mpTargets = [];
        for (const [id, t] of MP.tanks) if (id < 100) world.mpTargets.push(t);
        // 恢复被上面 world.tanks=[t] 重置掉的 AI(buildScene 的 spawnWave 已生成并广播)
        world.enemies = [...MP.tanks.entries()].filter(([id]) => id >= 100).map(([, t]) => t);
        world.tanks.push(...world.enemies);
      }
    } else {
      MP.timeLeft = 180;
      if (role === 'client') for (const [id, t] of MP.tanks) if (id !== MP.myId) world.enemies.push(t);   // DM 客户端: 准星可吸附敌坦克
    }

    SF.HUD.init(world);
    bindInput();
    bindBus();
    bindMpRelay();
    SF.Net.resetSnaps();

    // 输入: 客户端上行 30Hz; 主机远端输入接收
    if (role === 'client') SF.Net.startInputLoop(() => {
      const p = world.player;
      const inp = playerInput();
      return inp;
    });
    SF.Net.on('input', (m) => { MP.inputs.set(m.id, { throttle: m.i[0], steer: m.i[1], aimYaw: m.i[2], aimPitch: m.i[3], fire: !!m.i[4] }); });

    SF.HUD.showMsg('死斗 · 3 分钟 · 击杀计分', 4);
    running = true; lastT = performance.now();
    requestAnimationFrame(loop);
  }
  window.SF_StartMP = startMultiplayer;   // lobby 调用

  return { start };
})();

window.addEventListener('DOMContentLoaded', () => SF.Main.start());
