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
  let selTank = 'sherman', selMap = 'l01';   // 出击前选择
  let lastSpottedT = -99, wasDetected = false;   // 点亮机制(2s 宽限)
  // 联机死斗(主机权威): mode=host 房主跑模拟; client 幽灵插值; sp 单机
  const MP = SF.Game_mp = {
    mode: 'sp', myId: 0, mapId: 'l01', players: [],          // [{id,name,tank,host}]
    tanks: new Map(),                                         // id → Tank(主机真实模拟 / 客户端幽灵)
    inputs: new Map(),                                        // 主机: 远端玩家输入
    scores: new Map(), respawn: [], timeLeft: 180, snapT: 0
  };
  let keySeen = false, hintShown = false;   // 键盘诊断: 是否收到过按键
  let spottedTimer = 0;
  const spotted = new Set();
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
    scene.add(terrain.buildMesh());
    const covers = new SF.Models.CoverField(map, terrain, scene);

    // 玩家
    const [sx, sz, syaw] = map.player.spawn;
    const player = new SF.Tank(selTank, { x: sx, z: sz, yaw: syaw, isPlayer: true });
    scene.add(player.group);

    world = { terrain, covers, player, enemies: [], tanks: [player], time: 0, map };
    fx = new SF.FX(scene);
    shells = new SF.Shells(scene, fx);
    world.shells = shells;

    SF.Game = { scene, camera, renderer, world, fx, get uiState() { return { aimPoint, gunAim, sniper, spotted, keys, detected: wasDetected }; } };
  
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
      // 出生点随机化: 范围内随机平移(守位单位 ±12m, 机动单位 ±30m), 巡逻点随之平移, 避开掩体
      const jr = def.hold ? 12 : 30;
      const dx = (Math.random() - 0.5) * 2 * jr, dz = (Math.random() - 0.5) * 2 * jr;
      let ex = U.clamp(def.pos[0] + dx, -330, 330), ez = U.clamp(def.pos[1] + dz, -330, 330);
      [ex, ez] = world.covers.collide(ex, ez, 2.6);
      const t = new SF.Tank(def.type, { x: ex, z: ez, yaw: (def.yaw !== undefined ? def.yaw : Math.PI) + (Math.random() - 0.5) * 0.4 });
      const def2 = { ...def, patrol: (def.patrol || []).map(w => [w[0] + (ex - def.pos[0]), w[1] + (ez - def.pos[1])]) };
      t.ai = new SF.AI(t, def2);
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
    // 掩体与敌坦克
    const objs = [world.covers.group];
    for (const e of world.enemies) if (e.alive) objs.push(...e.parts.zones);
    _ray.set(origin, dir); _ray.far = Math.min(bestT, maxDist);
    const hits = _ray.intersectObjects(objs, true);
    if (hits.length && hits[0].distance < bestT) { bestT = hits[0].distance; best = hits[0].point; }
    return best ? { pos: best, dist: bestT } : null;
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
    } else gunAim = null;
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

  const IDLE_INPUT = (t) => ({ throttle: 0, steer: 0, aimYaw: t.turretYaw, aimPitch: t.gunPitch, fire: false });

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
  const HIT_TEXT = { pen: '击穿', bounce: '跳弹', nopen: '未击穿', gun: '火炮损伤' };
  const HIT_COLOR = { pen: '#ffb35c', bounce: '#f2f2f2', nopen: '#9aa0a6', gun: '#ffd97a' };
  const MODULE_TAG = { track: '·履带', engine: '·发动机', ammo: '·弹药架', gun: '' };

  function bindBus() {
    SF.Bus.on('fire', (e) => {
      e.tank.lastFireT = world.time;
      if (e.tank.isPlayer) stats.shots++;
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
      const text = { pen: `-${r.dmg}`, bounce: '跳弹', nopen: '未击穿', gun: '火炮受损' }[r.kind] || '';
      SF.HUD.dmgNumber(r.point, text, HIT_COLOR[r.kind] || '#fff');
      const snd = r.kind === 'pen' ? 'pen' : r.kind === 'bounce' ? 'bounce' : 'nopen';
      // 音量: 自己挨打最响; 自己打中的反馈音用慢衰减(atten 大)保证清晰
      SF.Audio.play(snd, target.isPlayer ? null : r.point, { gain: target.isPlayer ? 1.7 : 1.0, atten: 140 });
      // 归属分明的提示: 我打出去的 → 准星下方; 我挨打的 → 顶部红色警报 (文字+语音)
      if (shooter && shooter.isPlayer) {
        SF.HUD.hitFeedback(HIT_TEXT[r.kind] + (r.module ? MODULE_TAG[r.module] : ''), HIT_COLOR[r.kind]);
        if (r.module) SF.HUD.log(`敌方${MODULE_TAG[r.module] || ''}损伤`, '#a8d0a8');
        SF.Audio.playVoice({ pen: 'v_pen', bounce: 'v_bounce', nopen: 'v_nopen', gun: 'v_nopen' }[r.kind]);
      } else if (target.isPlayer) {
        if (r.kind === 'pen') {
          SF.HUD.alarm(`被击穿 -${r.dmg}` + (r.module ? ` · ${SF.CFG.armor.modules[r.module].text}` : ''));
          SF.Audio.playVoice('v_hitpen', true);
          if (r.module) SF.Audio.playVoice({ track: 'v_track', engine: 'v_engine', ammo: 'v_ammo', gun: 'v_gun' }[r.module], true);
        }
        else if (r.kind === 'bounce') SF.HUD.hitFeedback('跳弹', '#9fd0ff');
      }
      if (target.isPlayer && shooter) SF.HUD.hitFrom(shooter);
      if (target.isPlayer) shakeT = Math.max(shakeT, 0.7);
      if (r.module === 'track') SF.Audio.play('track', target.isPlayer ? null : r.point, { gain: 1.2 });
    });
    SF.Bus.on('reloaded', (e) => { if (e.tank.isPlayer) SF.Audio.play('reload', null, { gain: 1.5 }); });
    let missLast = -9;   // 未命中提示节流(基于模拟时间)
    SF.Bus.on('playerMiss', () => {
      if (world.time - missLast > 0.6) { SF.HUD.hitFeedback('未命中', '#8a8f94'); SF.Audio.playVoice('v_miss'); missLast = world.time; }
    });
    SF.Bus.on('destroyed', (e) => {
      const t = e.tank;
      fx.explosion(t.pos3);
      SF.Audio.play('explosion', t.pos3, { gain: 1.3 });
      if (SF.Game_mp.mode !== 'sp') {
        // 死斗: 无失败流程, 主机为阵亡者(含自己)排队重生
        if (SF.Game_mp.mode === 'host' && t.netId) SF.Game_mp.respawn.push({ id: t.netId, t: 5 });
        if (t.isPlayer) SF.HUD.showMsg('被击毁 · 5 秒后重生', 3);
        else { SF.HUD.hitFeedback('击毁', '#8fd98f'); SF.Audio.playVoice('v_kill', true); }
        return;
      }
      if (t.isPlayer) { loseT = 2.5; SF.HUD.showMsg('坦克被击毁…', 3); }
      else {
        stats.kills++;
        SF.HUD.hitFeedback('击毁', '#8fd98f');
        SF.Audio.playVoice('v_kill', true);
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
      MP.timeLeft -= dt;
      if (MP.timeLeft <= 0 && !gameOver) endMatch();
    } else {
      for (const e of world.enemies)
        e.update(e.ai.update(dt, world), dt, world);   // 死亡车辆也要更新(残骸沉降/冒烟), update 内部分支处理
    }

    shells.update(dt, world);

    if (MP.mode === 'sp') {
      if (repairT > 0) repairT -= dt;
      checkWave();
    }

    // 玩家对敌发现(小地图/血条显示用) + 点亮机制(被敌人看见 → 灯泡+滴滴)
    spottedTimer -= dt;
    if (spottedTimer <= 0) {
      spottedTimer = 0.25;
      spotted.clear();
      for (const e of world.enemies)
        if (e.alive && U.dist2d(p.x, p.z, e.x, e.z) < SF.CFG.player.viewRange && SF.losClear(world, p.x, p.z, e.x, e.z))
          spotted.add(e);
    }
    if (MP.mode === 'host') {   // 死斗小地图红点: 其他玩家
      spottedTimer -= dt;
      if (spottedTimer <= 0) {
        spottedTimer = 0.25;
        spotted.clear();
        for (const [id, t] of MP.tanks)
          if (id !== MP.myId && t.alive && U.dist2d(p.x, p.z, t.x, t.z) < SF.CFG.player.viewRange && SF.losClear(world, p.x, p.z, t.x, t.z))
            spotted.add(t);
      }
    }
    let enemySeesMe = false;
    if (MP.mode === 'host') {
      for (const [id, t] of MP.tanks)
        if (id !== MP.myId && t.alive && U.dist2d(p.x, p.z, t.x, t.z) < SF.CFG.player.viewRange && SF.losClear(world, p.x, p.z, t.x, t.z)) { enemySeesMe = true; break; }
    } else {
      for (const e of world.enemies) if (e.alive && e.ai && e.ai.seenNow) { enemySeesMe = true; break; }
    }
    if (enemySeesMe) lastSpottedT = world.time;
    const detected = p.alive && (world.time - lastSpottedT < 2.0);
    if (detected && !wasDetected) SF.Audio.play('beep', null, { gain: 1.1 });
    wasDetected = detected;

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
    buildPicker();
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

  // 出击前车库: 选坦克 + 选地图
  function buildPicker() {
    const g = document.getElementById('garageRow'), m = document.getElementById('mapRow');
    g.innerHTML = ''; m.innerHTML = '';
    for (const t of SF.CFG.garage) {
      const v = SF.CFG.vehicles[t.type];
      const el = document.createElement('div');
      el.className = 'card' + (t.type === selTank ? ' sel' : '');
      el.innerHTML = `<b>${v.name}</b><i>${t.tag}</i><span>${t.desc}</span><em>HP ${v.hp} · 穿深 ${v.gun.pen} · 单发 ${v.gun.dmg} · 极速 ${Math.round(v.maxSpeed * 3.6)}</em>`;
      el.onclick = () => { selTank = t.type; localStorage.setItem('sf_mp_tank', t.type); [...g.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); };
      g.appendChild(el);
    }
    for (const mp of SF.CFG.maps) {
      const el = document.createElement('div');
      el.className = 'card' + (mp.id === selMap ? ' sel' : '');
      el.innerHTML = `<b>${mp.name}</b><span>${mp.desc}</span>`;
      el.onclick = () => { selMap = mp.id; [...m.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); };
      m.appendChild(el);
    }
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
    SF.Net.send({ t: 'snap', st: Math.max(0, Math.round(MP.timeLeft)), tn, sc });
  }

  /* ---------- 联机: 客户端帧(幽灵插值 + 死亡表现) ---------- */
  function clientFrame(dt) {
    const snap = SF.Net.interpolate(120);
    if (!snap) return;
    for (const [id, t] of MP.tanks) {
      const pose = snap.poses[id];
      if (pose) t.ghostPose(pose, dt);
    }
    MP.timeLeft = snap.timeLeft;
    if (snap.scores) for (const id in snap.scores) MP.scores.set(+id, snap.scores[id]);
    // 本地点亮判定(对幽灵位置做 LOS)
    const p = world.player;
    spottedTimer -= dt;
    if (spottedTimer <= 0) {
      spottedTimer = 0.25;
      spotted.clear();
      for (const [id, t] of MP.tanks)
        if (id !== MP.myId && t.alive && U.dist2d(p.x, p.z, t.x, t.z) < SF.CFG.player.viewRange && SF.losClear(world, p.x, p.z, t.x, t.z))
          spotted.add(t);
    }
    if (spotted.size > 0) lastSpottedT = world.time;
    const detected = p.alive && (world.time - lastSpottedT < 2.0);
    if (detected && !wasDetected) SF.Audio.play('beep', null, { gain: 1.1 });
    wasDetected = detected;
    world.time += 0;   // 时钟由 step 推进
  }

  function updateMpHud() {
    const el = document.getElementById('mpBar');
    if (!el || MP.mode === 'sp') return;
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
      if (m.k === 'fire') SF.Bus.emit('fire', { tank: proxyTank(d.id), pos: new THREE.Vector3(...d.p), dir: new THREE.Vector3(0, 0, 1) });
      else if (m.k === 'hit') {
        SF.Bus.emit('hit', { shooter: proxyTank(d.s), target: proxyTank(d.g), kind: d.kind, dmg: d.dmg, module: d.module || null, point: new THREE.Vector3(...d.p) });
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
      document.getElementById('overlay').style.display = 'flex';
      document.getElementById('endTitle').textContent = '对战结束';
      document.getElementById('endTitle').style.color = '#d8c887';
      document.getElementById('endStats').innerHTML = `<div style="font-size:20px;line-height:2.2">${rows}</div>`;
      SF.Net.stopInputLoop();
    });
    SF.Net.on('err', (m) => { alert(m.msg || '服务器错误'); location.reload(); });
  }

  function endMatch() {
    gameOver = true;
    const scores = MP.players.map(pl => [pl.id, pl.name, MP.scores.get(pl.id) || 0]).sort((a, b) => b[2] - a[2]);
    SF.Net.send({ t: 'end', scores });
    const rows = scores.map(([id, name, k]) => `<div style="color:${id === MP.myId ? '#ffd97a' : '#b9bfa8'}">${id === MP.myId ? '★ ' : ''}${name} — ${k} 击杀</div>`).join('');
    document.getElementById('overlay').style.display = 'flex';
    document.getElementById('endTitle').textContent = '对战结束';
    document.getElementById('endTitle').style.color = '#d8c887';
    document.getElementById('endStats').innerHTML = `<div style="font-size:20px;line-height:2.2">${rows}</div>`;
    SF.Net.stopInputLoop();
  }

  /* ---------- 联机开局: 房主/加入者共用 ---------- */
  function startMultiplayer(role, init) {
    MP.mode = role;
    MP.myId = init.you;
    MP.players = init.players;
    MP.mapId = init.map || 'l01';
    for (const pl of MP.players) MP.scores.set(pl.id, 0);
    document.getElementById('titleScreen').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    SF.Audio.init(); SF.Audio.startEngine(); SF.Audio.startAmbient();

    const mapSel = SF.CFG.maps.find(m => m.id === MP.mapId) || SF.CFG.maps[0];
    selMap = mapSel.id;
    selTank = (init.players.find(pl => pl.id === init.you) || {}).tank || 'sherman';

    // 场景(无 AI 波次)
    spawnWave = () => { };
    checkWave = () => { };
    buildScene();

    // 死斗出生池: 地图中心外围 8 点
    MP.spawnPool = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      let sx = Math.cos(a) * 240, sz = Math.sin(a) * 240;
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
        netId: pl.id, team: 100 + pl.id,          // 死斗: 人人一队(可互相伤害)
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
