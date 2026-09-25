// main.js — 场景搭建/相机/输入/主循环/第一关流程(波次·维修·胜负)
window.SF = window.SF || {};

SF.Main = (() => {
  const U = SF.Util;
  let renderer, scene, camera, sunLight;
  let world, fx, shells;
  let camYaw = Math.PI, camPitch = 0.30, camDist = SF.CFG.camera.dist;
  let sniper = false, mouseDown = false, shakeT = 0;
  const keys = {};
  let acc = 0, lastT = 0, running = false, lastRaf = 0, timerId = null;
  let keySeen = false, hintShown = false;   // 键盘诊断: 是否收到过按键
  let spottedTimer = 0;
  const spotted = new Set();
  let waveIdx = 0, waveEnemies = [], repairT = 0, repairDone = false, gameOver = false, loseT = -1;
  let stats = { kills: 0, total: 0, shots: 0, hits: 0, pens: 0, dmg: 0, time: 0 };
  let aimPoint = null;

  /* ---------- 场景 ---------- */
  function buildScene() {
    const map = SF.Assets.map, L = map.lighting;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);

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
    const terrain = new SF.Terrain(SF.Assets.heights, map.terrain);
    scene.add(terrain.buildMesh());
    const covers = new SF.Models.CoverField(map, terrain, scene);

    // 玩家
    const [sx, sz, syaw] = map.player.spawn;
    const player = new SF.Tank(map.player.model, { x: sx, z: sz, yaw: syaw, isPlayer: true });
    scene.add(player.group);

    world = { terrain, covers, player, enemies: [], tanks: [player], time: 0, map };
    fx = new SF.FX(scene);
    shells = new SF.Shells(scene, fx);
    world.shells = shells;

    SF.Game = { scene, camera, renderer, world, fx, get uiState() { return { aimPoint, sniper, spotted, keys }; } };
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
    waveEnemies = wave.enemies.map(def => {
      const t = new SF.Tank(def.type, { x: def.pos[0], z: def.pos[1], yaw: def.yaw || 0 });
      t.ai = new SF.AI(t, def);
      scene.add(t.group);
      world.tanks.push(t);
      return t;
    });
    world.enemies = waveEnemies;
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
        world.player.hp = Math.min(world.player.spec.hp, world.player.hp + heal);
        SF.HUD.showMsg(world.map.repairBetweenWaves.text + ` (+${heal} HP)`, repairT);
      }
      if (repairT > 0) return;
      waveIdx++; repairDone = false;
      spawnWave(waveIdx);
    } else if (!gameOver) {
      gameOver = true;
      SF.HUD.endGame(true, stats);
    }
  }

  /* ---------- 相机与瞄准 ---------- */
  function updateCamera(dt) {
    const p = world.player;
    if (sniper) {
      p.group.visible = false;   // 狙击镜视角隐藏自己(WoT 式, 也避免相机被炮塔内壁糊住)
      camera.fov = U.lerp(camera.fov, SF.CFG.camera.sniperFov, 1 - Math.exp(-12 * dt));
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
  function computeAim() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const origin = camera.position.clone();
    let best = null, bestT = 1e9;

    // 地形
    let t = 2, prevY = 1e9;
    for (; t < 900; t += 2) {
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const h = world.terrain.heightAt(px, pz);
      if (py <= h) {  // 二分细化
        let lo = t - 2, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          (origin.y + dir.y * mid <= world.terrain.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid)) ? hi = mid : lo = mid;
        }
        bestT = hi; best = new THREE.Vector3(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
        break;
      }
      prevY = py;
      if (t > 500 && py > 160 && dir.y > 0) break;
    }
    // 掩体与敌坦克
    const objs = [world.covers.group];
    for (const e of world.enemies) if (e.alive) objs.push(...e.parts.zones);
    _ray.set(origin, dir); _ray.far = Math.min(bestT, 900);
    const hits = _ray.intersectObjects(objs, true);
    if (hits.length && hits[0].distance < bestT) { bestT = hits[0].distance; best = hits[0].point; }

    aimPoint = best ? { pos: best, dist: bestT } : null;
  }

  /* ---------- 输入 ---------- */
  // 键名归一: 优先 e.code, 缺失时回退 e.key(部分内嵌浏览器/输入法环境 code 为空)
  const KEY_ALIAS = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', arrowup: 'ArrowUp', arrowleft: 'ArrowLeft', arrowdown: 'ArrowDown', arrowright: 'ArrowRight', shift: 'Shift' };
  function keyOf(e) {
    if (e.code) {
      if (/^Key[WASD]$/.test(e.code) || /^Arrow(Up|Down|Left|Right)$/.test(e.code)) return e.code;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'Shift';
    }
    const k = (e.key || '').toLowerCase();
    return KEY_ALIAS[k] || null;
  }

  function bindInput() {
    const canvas = renderer.domElement;
    canvas.tabIndex = -1;
    canvas.addEventListener('click', () => {
      canvas.focus();
      if (!gameOver) canvas.requestPointerLock();
      SF.Audio.resume();
    });
    document.addEventListener('pointerlockchange', () => { });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      // 指针锁定偶发的大跳变(>300px)丢弃, 防画面猛甩
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      const s = SF.CFG.camera.sens * (sniper ? SF.CFG.camera.sniperSens : 1);
      camYaw -= e.movementX * s;
      camPitch = U.clamp(camPitch + e.movementY * s, -0.12, 1.1);
    });
    document.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
    document.addEventListener('wheel', (e) => {
      camDist = U.clamp(camDist + Math.sign(e.deltaY) * 1.6, SF.CFG.camera.minDist, SF.CFG.camera.maxDist);
    });
    // 键盘: window 捕获阶段监听(最先收到, 不被其他处理器截断)
    window.addEventListener('keydown', (e) => {
      const k = keyOf(e);
      if (!k) return;
      keySeen = true;
      if (k === 'Shift') { if (!e.repeat) sniper = !sniper; keys.Shift = true; return; }
      keys[k] = true;
      if (/^Arrow/.test(k) || k === 'Space') e.preventDefault();
    }, true);
    window.addEventListener('keyup', (e) => { const k = keyOf(e); if (k) keys[k] = false; }, true);
    // 失焦清键, 防卡键
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
  }

  function playerInput() {
    const p = world.player;
    const input = {
      throttle: (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0),
      // 注意: yaw 增大 = 向左转(俯视逆时针), 所以 A=+1 / D=-1
      steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0),
      fire: mouseDown
    };
    if (aimPoint) {
      const dx = aimPoint.pos.x - p.x, dz = aimPoint.pos.z - p.z;
      input.aimYaw = Math.atan2(dx, dz);
      input.aimPitch = Math.atan2(aimPoint.pos.y - (p.y + 2.2), Math.hypot(dx, dz));
    } else { input.aimYaw = camYaw; input.aimPitch = 0; }
    return input;
  }

  /* ---------- 事件接线(模拟 → 表现) ---------- */
  function bindBus() {
    const COLORS = { pen: '#ffb35c', bounce: '#f2f2f2', nopen: '#9aa0a6', gun: '#ffd97a' };
    SF.Bus.on('fire', (e) => {
      e.tank.lastFireT = world.time;
      if (e.tank.isPlayer) stats.shots++;
      fx.flash(e.pos, e.tank.isPlayer ? 2.6 : 2.0);
      SF.Audio.play('cannon', e.pos, { gain: e.tank.isPlayer ? 1 : 0.8 });
      if (e.tank.isPlayer) shakeT = 1;
    });
    SF.Bus.on('hit', (r) => {
      const shooter = r.shooter, target = r.target;
      if (shooter && shooter.isPlayer) {
        stats.hits++; if (r.kind === 'pen') stats.pens++;
        stats.dmg += r.dmg;
      }
      const text = { pen: `-${r.dmg}`, bounce: '跳弹', nopen: '未击穿', gun: '火炮受损' }[r.kind] || '';
      SF.HUD.dmgNumber(r.point, text, COLORS[r.kind] || '#fff');
      const snd = r.kind === 'pen' ? 'pen' : r.kind === 'bounce' ? 'bounce' : 'nopen';
      SF.Audio.play(snd, target.isPlayer ? null : r.point, { gain: target.isPlayer ? 1 : 0.75 });
      if (target.isPlayer && shooter) SF.HUD.hitFrom(shooter);
      if (target.isPlayer) shakeT = Math.max(shakeT, 0.7);
      if (r.module === 'track') SF.Audio.play('track', target.isPlayer ? null : r.point, { gain: 0.9 });
      if (r.module) SF.HUD.log(SF.CFG.armor.modules[r.module].text, r.target.isPlayer ? '#e8a2a2' : '#a8d0a8');
    });
    SF.Bus.on('reloaded', (e) => { if (e.tank.isPlayer) SF.Audio.play('reload', null, { gain: 0.5 }); });
    SF.Bus.on('destroyed', (e) => {
      const t = e.tank;
      fx.explosion(t.pos3);
      SF.Audio.play('explosion', t.pos3, { gain: 1 });
      if (t.isPlayer) { loseT = 2.5; SF.HUD.showMsg('坦克被击毁…', 3); }
      else {
        stats.kills++;
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

    p.update(p.alive && !gameOver ? playerInput() : { throttle: 0, steer: 0, aimYaw: p.turretYaw, aimPitch: p.gunPitch, fire: false }, dt, world);
    p.velX = (p.x - prevX) / dt; p.velZ = (p.z - prevZ) / dt;

    for (const e of world.enemies)
      if (e.alive) e.update(e.ai.update(dt, world), dt, world);

    shells.update(dt, world);

    if (repairT > 0) repairT -= dt;
    checkWave();

    // 玩家对敌发现(小地图/血条显示用)
    spottedTimer -= dt;
    if (spottedTimer <= 0) {
      spottedTimer = 0.25;
      spotted.clear();
      for (const e of world.enemies)
        if (e.alive && U.dist2d(p.x, p.z, e.x, e.z) < SF.CFG.player.viewRange && SF.losClear(world, p.x, p.z, e.x, e.z))
          spotted.add(e);
    }

    if (loseT > 0) { loseT -= dt; if (loseT <= 0 && !gameOver) { gameOver = true; SF.HUD.endGame(false, stats); } }
  }

  function frame(dtReal) {
    updateCamera(dtReal);
    computeAim();
    fx.update(dtReal);
    SF.Audio.setEngine(Math.abs(world.player.speed) / world.player.spec.maxSpeed, keys.KeyW || keys.KeyS ? 1 : 0);
    SF.HUD.update(dtReal, world, SF.Game.uiState);
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
  async function start() {
    const bar = document.getElementById('loadBar'), tip = document.getElementById('loadTip');
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

    document.getElementById('btnStart').addEventListener('click', () => {
      document.getElementById('titleScreen').style.display = 'none';
      document.getElementById('hud').style.display = 'block';
      SF.Audio.init();
      SF.Audio.startEngine();
      SF.Audio.startAmbient();
      buildScene();
      SF.HUD.init(world);
      bindInput();
      bindBus();
      // 出击即锁定鼠标(点击是用户手势); 失败(如浏览器冷却期)不阻断, 点画面可补锁
      try {
        const p = renderer.domElement.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { }
      const b = world.map.briefing;
      SF.HUD.showMsg(b, 5);
      running = true; lastT = performance.now();
      requestAnimationFrame(loop);
    });
  }

  return { start };
})();

window.addEventListener('DOMContentLoaded', () => SF.Main.start());
