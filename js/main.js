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
  // 阴影按需更新状态(见 updateCamera 尾部)
  let shadowCell = null, shadowNeed = true, shadowLastT = -99;
  const shadowTankPos = new Map();
  const ARTY_H = [40, 70, 110, 160, 220];   // 鹰眼高度档位(视场范围)
  let artyH = ARTY_H[2], artyHIdx = 2;
  let sniperFov = SF.CFG.camera.sniperFovMax;   // 当前狙镜视场(滚轮镜内变焦)
  let cruise = 0;              // 巡航控制: 1 前进 / -1 倒车 / 0 关
  let autoTarget = null;       // 自动瞄准目标(WoT E 键)
  const keys = {};
  let acc = 0, lastT = 0, running = false, lastRaf = 0, timerId = null;
  let selTank = 'sherman', selMap = 'l01';   // 出击前选择
  // PVE 修改器(仅单机): localStorage 持久化, 联机战斗一律不读取
  let PVE = (() => {
    try { return { ...SF.CFG.pve, ...JSON.parse(localStorage.getItem('sf_pve') || '{}') }; }
    catch (e) { return { ...SF.CFG.pve }; }
  })();
  let lastSpottedT = -99, wasDetected = false;   // 点亮机制(2s 宽限)
  const bushUi = { inBush: false, concealed: false };   // 草丛隐蔽状态(HUD 指示)
  let deathMark = null;                          // 上次阵亡位置(小地图 ✕ 标记)

  /* ---------- 出生点地形校验(参数与 tools/check-spawns.js 保持同步!) ----------
     死斗出生池/重生抖动/敌军出生抖动共用: 梯度过陡(>tan(maxSlope)×0.96, 低于爬坡角与滑落阈留余量)
     或落在凹槽(任一轴两侧 ±14m 均高出中心 3m+ —— 反坦克壕/深坑; 壕底沿轴是平的, 纯坡度查不出)即不可用。 */
  const SPAWN_G = Math.tan(SF.CFG.sim.maxSlope) * 0.96;
  function spawnGroove(x, z) {
    const T = world.terrain, hC = T.heightAt(x, z);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 4, dx = Math.sin(a) * 14, dz = Math.cos(a) * 14;
      if (T.heightAt(x + dx, z + dz) > hC + 3 && T.heightAt(x - dx, z - dz) > hC + 3) return true;
    }
    return false;
  }
  const spawnPtOk = (x, z) => world.terrain.gradAt(x, z) <= SPAWN_G && !spawnGroove(x, z);
  function spawnDiskOk(x, z) {   // 重生 ±10m 抖动圆盘(r=11 留边) 5m 网格全过
    for (let dz = -11; dz <= 11; dz += 5)
      for (let dx = -11; dx <= 11; dx += 5)
        if (dx * dx + dz * dz <= 121 && !spawnPtOk(x + dx, z + dz)) return false;
    return true;
  }
  function findSpawnSpot(x, z) {   // 螺旋找平地(确定性): 12→108m 步进 12, 8 方位, 逐环旋转 0.3rad
    if (spawnDiskOk(x, z)) return [x, z];
    for (let r = 12; r <= 108; r += 12)
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + (r / 12) * 0.3;
        const cx = U.clamp(x + Math.cos(a) * r, -world.terrain.half + 20, world.terrain.half - 20);
        const cz = U.clamp(z + Math.sin(a) * r, -world.terrain.half + 20, world.terrain.half - 20);
        if (spawnDiskOk(cx, cz)) return [cx, cz];
      }
    return null;
  }

  /* ---------- AI Worker: 感知/决策在独立线程按真实时钟运行 ----------
     主线程再卡(渲染/GC/掉帧), worker 照常每 33ms 思考 —— AI 不会因为掉帧变傻。
     失败降级: Worker 构造/运行出错 → 回退主线程逐帧 ai.update(与旧版一致)。 */
  const AIW = { worker: null, on: false, failed: false, snapT: 0, nextId: 100, byId: new Map() };
  window.SF_AIW = AIW;   // 诊断句柄(控制台可查 worker 状态/消息)
  async function initAIWorker() {
    if (AIW.failed) return;
    if (AIW.worker) { AIW.on = true; return; }   // 重开战斗复用
    try {
      const base = new URL('js/', location.href).href;
      const src = await (await fetch('js/ai-worker.js?v=' + (window.SF_BUILD || Date.now()))).text();
      AIW.worker = new Worker(URL.createObjectURL(new Blob(['self.BASE_URL=' + JSON.stringify(base) + ';\n' + src], { type: 'text/javascript' })));
      AIW.worker.onerror = (e) => {
        console.warn('AI worker 异常, 退回主线程:', e.message || e);
        AIW.on = false; AIW.failed = true;
      };
      AIW.worker.onmessage = (e) => {
        const m = e.data;
        if (m.t !== 'in') return;
        for (const a of m.list) {
          const tk = AIW.byId.get(a[0]);
          if (!tk) continue;
          tk._aiIn = { throttle: a[1], steer: a[2], aimYaw: a[3], aimPitch: a[4], fire: !!a[5] };
          tk._aiSeen = !!a[6]; tk._aiTarget = a[7] || 0;
        }
      };
      AIW.on = true;
    } catch (err) {
      console.warn('AI worker 不可用, 主线程运行:', err);
      AIW.failed = true;
    }
  }
  // 战斗世界注入 worker(地形高程/掩体碰撞表; 每场一次, 高程表约 330KB 克隆)
  function syncAIWorld(terrain, mapJson, covers) {
    if (!AIW.on) return;
    AIW.worker.postMessage({ t: 'init', heights: terrain.h, terrainCfg: mapJson.terrain, covers: covers.list });
  }
  // 10Hz 状态快照: 位置/战斗状态喂给 worker 的复制品世界(行布局见 ai-worker.js)
  function sendAISnap() {
    if (!AIW.on || !world) return;
    const R = (v, n = 2) => +Number(v || 0).toFixed(n);   // 远端坦克个别字段可能未初始化, 兜 0
    const enemies = world.enemies.map(e => [e._aiId, R(e.x), R(e.z), R(e.y), R(e.yaw, 3), R(e.speed),
      R(e.velX), R(e.velZ), Math.round(e.hp), R(e.disp, 4), R(e.reloadT), R(e.turretYaw, 3), e.lastFireT || -99, e.alive ? 1 : 0, R(e.lastYawRate || 0, 3)]);
    const players = (MP.mode === 'host' && MP.gameMode === 'coop')
      ? [...MP.tanks.values()].filter(t => t.netId < 100 && t.alive !== undefined)
        .map(t => [t.netId, R(t.x), R(t.z), R(t.y), R(t.yaw, 3), R(t.speed), R(t.velX), R(t.velZ), Math.round(t.hp), t.lastFireT || -99, t.alive ? 1 : 0])
      : [[0, R(world.player.x), R(world.player.z), R(world.player.y), R(world.player.yaw, 3), R(world.player.speed),
          R(world.player.velX), R(world.player.velZ), Math.round(world.player.hp), world.player.lastFireT || -99, world.player.alive ? 1 : 0]];
    AIW.worker.postMessage({ t: 'snap', time: world.time, intel: world.intel, enemies, players });
  }
  // AI 输入/感知读取: worker 模式取回传结果, 降级模式走主线程 ai 实例
  // worker 中途挂掉时, 现场为代理桩补建主线程 AI(携带出生时的定义), 游戏不中断
  function aiStep(e, dt, w) {
    if (AIW.on) { const inp = e._aiIn; return inp || IDLE_INPUT(e); }
    if (e._aiId !== undefined && (!e.ai || !e.ai.update)) {
      e.ai = new SF.AI(e, e._aiDef || {});
      e.ai.flankSlot = e._aiFlank || 0;
      delete e._aiId;
    }
    return e.ai.update(dt, w);
  }
  function aiSeen(e) { return AIW.on ? !!e._aiSeen : !!(e.ai && e.ai.seenNow); }
  function aiTargetId(e) { return AIW.on ? (e._aiTarget || 0) : ((e.ai && e.ai.lastTargetId) || 0); }

  /* ---------- 画质分档: 高(默认, 与旧版一致)/中/低; 分辨率与阴影可实时切换, MSAA 需重开战斗 ---------- */
  const GFX = (() => {
    const PRESETS = {
      high: { dpr: 2, msaa: true, shadowRes: 2048, shadowHz: 30 },
      mid: { dpr: 1.5, msaa: true, shadowRes: 1024, shadowHz: 24 },
      low: { dpr: 1.25, msaa: false, shadowRes: 1024, shadowHz: 15 }
    };
    let preset = 'high';
    try { const s = JSON.parse(localStorage.getItem('sf_gfx') || '{}'); if (PRESETS[s.preset]) preset = s.preset; } catch (e) { }
    function apply() {   // 实时生效: 分辨率 + 阴影贴图(MSAA 在 buildScene 创建渲染器时读取)
      if (!renderer) return;
      renderer.setPixelRatio(Math.min(devicePixelRatio, PRESETS[preset].dpr));
      const sun = sunLight && sunLight.light;
      if (sun && sun.shadow.mapSize.x !== PRESETS[preset].shadowRes) {
        sun.shadow.mapSize.set(PRESETS[preset].shadowRes, PRESETS[preset].shadowRes);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // 触发重建
      }
      shadowCell = null;   // 强制下帧重绘阴影
    }
    return {
      get preset() { return preset; },
      set(v) { if (!PRESETS[v]) return; preset = v; try { localStorage.setItem('sf_gfx', JSON.stringify({ preset: v })); } catch (e) { } apply(); },
      cfg() { return PRESETS[preset]; }
    };
  })();
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
  let waveIdx = 0, waveEnemies = [], repairT = 0, repairMsgText = '', repairMsgOn = false, repairDone = false, gameOver = false, loseT = -1;
  let stats = { kills: 0, total: 0, shots: 0, hits: 0, pens: 0, dmg: 0, time: 0 };
  let aimPoint = null, gunAim = null;

  /* ---------- 场景 ---------- */
  function buildScene() {
    const map = SF.Assets.maps[selMap].json, L = map.lighting, G = GFX.cfg();
    renderer = new THREE.WebGLRenderer({ antialias: G.msaa, powerPreference: 'high-performance', stencil: false });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, G.dpr));
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
    sun.shadow.mapSize.set(G.shadowRes, G.shadowRes);
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
    syncAIWorld(terrain, map, covers);   // worker 模式: 先注入世界, 后面 spawnWave 才能下发 AI

    // 玩家(PVE 修改器: 克隆 spec 应用配件倍率, 不污染全局配置; 联机不生效)
    const [sx, sz, syaw] = map.player.spawn;
    let playerSpec = null;
    if (MP.mode === 'sp') {
      const b = SF.CFG.vehicles[selTank], M = PVE;
      playerSpec = { ...b, gun: { ...b.gun }, dispersion: { ...b.dispersion } };
      if (b.gun.autoloader) playerSpec.gun.autoloader = { ...b.gun.autoloader };
      playerSpec.hp = Math.round(b.hp * M.hpMul);
      playerSpec.maxSpeed = b.maxSpeed * M.mobilityMul;
      playerSpec.accel = b.accel * M.mobilityMul;
      // 输弹机/炮控为速度倍率: 时间÷倍率(2× = 装填快一倍)
      playerSpec.gun.reload = b.gun.reload / M.reloadMul;
      if (playerSpec.gun.autoloader) { playerSpec.gun.autoloader.intra /= M.reloadMul; playerSpec.gun.autoloader.long /= M.reloadMul; }
      playerSpec.dispersion.aimTime = b.dispersion.aimTime / M.aimMul;
      playerSpec.view = Math.round((b.view || SF.CFG.player.viewRange) * M.viewMul);
    }
    const player = new SF.Tank(selTank, { x: sx, z: sz, yaw: syaw, isPlayer: true, spec: playerSpec });
    scene.add(player.group);

    // intel = 全敌共享的玩家情报: {x,z 最后已知位置, t 时刻, level 0无/1听见炮声/2目视确认}
    // 任何敌人目视 → 坐标全队广播; 玩家开炮被听见 → 方位上报(带误差)
    world = { terrain, covers, player, enemies: [], tanks: [player], time: 0, map,
              intel: { x: sx, z: sz, t: -99, level: 0 } };
    fx = new SF.FX(scene);
    shells = new SF.Shells(scene, fx);
    world.shells = shells;
    // 补给空投(PVE): 世界与场景注入; 单机玩家挂增益基线(联机玩家在 startMultiplayer 里挂)
    SF.Pickups.init(world, scene, fx);
    if (MP.mode === 'sp') SF.Pickups.attachTank(player);
    buildTrajLine();

    SF.Game = { scene, camera, renderer, world, fx, get uiState() { return {
      aimPoint, gunAim, sniper, spotted, lastKnown, keys, camYaw, detected: wasDetected, deathMark, autoTarget, cruise, trajT: trajFlightT, trajLand, bush: bushUi,
      // 鹰眼俯视视野足迹(小地图绿框): 中心=artyX/Z, w/h=当前 fov 与高度下的地面可视范围
      arty: (() => {
        if (!(sniper && world && world.player && world.player.spec.cls === 'SPG')) return null;
        const v = 2 * artyH * Math.tan(camera.fov * Math.PI / 360);
        return { x: artyX, z: artyZ, w: v * camera.aspect, h: v };
      })(),
      mission: (() => {
        if (!world.map) return null;
        if (SF.Game_mp.mode === 'sp') return { idx: waveIdx, total: world.map.waves.length, name: (world.map.waves[waveIdx] || {}).name || '', kills: stats.kills, totalEnemies: stats.total };
        if (SF.Game_mp.gameMode === 'coop') {
          if (SF.Game_mp.mode === 'host') return { idx: waveIdx, total: world.map.waves.length, name: (world.map.waves[waveIdx] || {}).name || '', kills: stats.kills, totalEnemies: stats.total };
          return SF.Game_mp.waveInfo;
        }
        return null;
      })(),
      pickups: SF.Pickups.uiList(),                      // 场上补给空投(小地图)
      buffs: SF.Pickups.playerBuffs(world.player)        // 本地玩家增益(倒计时条)
    }; } };
  
  // 测试钩子: 无 rAF 环境下手动推进模拟与渲染(自动化测试用)
    SF.Game.test = {
      step(n = 1) { for (let i = 0; i < n; i++) step(SF.CFG.sim.dt); },
      frame() { frame(SF.CFG.sim.dt); }
    };
    spawnWave(0);
  }

  /* ---------- 波次 ---------- */
  function aiSpec(s) {   // AI 需要的 spec 子集(纯数据, 发给 worker)
    return { view: s.view, camo: s.camo, cls: s.cls, hp: s.hp, name: s.name,
             gun: { speed: s.gun.speed }, dispersion: { base: s.dispersion.base, max: s.dispersion.max },
             gunDepression: s.gunDepression, gunElevation: s.gunElevation };
  }
  function spawnWave(i) {
    const wave = world.map.waves[i];
    if (!wave) return;
    const aiSpawned = [];
    const aiSpawnDefs = [];
    let pt = TIER_NUM[(SF.CFG.vehicles[selTank] || {}).tier] || 5;
    if (MP.mode !== 'sp')
      for (const pl of MP.players) pt = Math.max(pt, TIER_NUM[(SF.CFG.vehicles[pl.tank] || {}).tier] || 5);
    const waveBand = i === 0 ? [pt - 1, pt] : [pt, pt + 1];
    // 敌军规模: 单机=PVE 倍率(1~10); 联机=按玩家数量(带随机浮动)
    const nP = MP.mode === 'sp' ? 1 : Math.max(1, MP.players.length);
    const target = MP.mode === 'sp'
      ? Math.max(1, Math.min(60, Math.round(wave.enemies.length * PVE.enemyMul)))
      : Math.max(1, Math.min(9, Math.round(
        wave.enemies.length + (nP - 1) * 1.6 + (Math.random() - 0.5) * 1.5 + (nP === 1 ? -1 : 0))));
    const defs = wave.enemies.slice();
    while (defs.length > target) defs.splice((Math.random() * defs.length) | 0, 1);   // 随机裁减
    while (defs.length < target) {                    // 增援: 优先复制机动单位, 出生位大幅偏移(人越多散得越开)
      const src = defs.find(d => !d.hold) || defs[0] || wave.enemies[0];
      const jr2 = 90 + target * 4;
      defs.push({ ...src, pos: [src.pos[0] + (Math.random() - 0.5) * 2 * jr2, src.pos[1] + (Math.random() - 0.5) * 2 * jr2] });
    }
    const n = defs.length;
    waveEnemies = defs.map((def, wi) => {
      // 出生随机化(每局布局不同): 守位单位 ±18m, 机动单位 ±65m, 巡逻点独立再随机 ±25m;
      // 落点过地形关(防刷进壕沟/崖脚/滑坡面), 最多重试 8 次仍败则用最后一个(生成器布点本身已避开极端地形)
      const jr = def.hold ? 18 : 65;
      let ex = U.clamp(def.pos[0] + (Math.random() - 0.5) * 2 * jr, -430, 430);
      let ez = U.clamp(def.pos[1] + (Math.random() - 0.5) * 2 * jr, -430, 430);
      for (let k = 0; k < 8 && !spawnPtOk(ex, ez); k++) {
        ex = U.clamp(def.pos[0] + (Math.random() - 0.5) * 2 * jr, -430, 430);
        ez = U.clamp(def.pos[1] + (Math.random() - 0.5) * 2 * jr, -430, 430);
      }
      [ex, ez] = world.covers.collide(ex, ez, 2.6);
      const CLS_OF_LEGACY = { medium: 'MT', td: 'TD', heavy: 'HT' };
      const cls = CLS_OF_LEGACY[def.type] || (SF.CFG.vehicles[def.type] || {}).cls || 'MT';
      const type = pickTierTank(cls, waveBand);
      const t = new SF.Tank(type, { x: ex, z: ez, yaw: (def.yaw !== undefined ? def.yaw : Math.PI) + (Math.random() - 0.5) * 0.4 });
      const def2 = { ...def, patrol: (def.patrol || []).map(w => [
        U.clamp(w[0] + (ex - def.pos[0]) + (Math.random() - 0.5) * 50, -430, 430),
        U.clamp(w[1] + (ez - def.pos[1]) + (Math.random() - 0.5) * 50, -430, 430)]) };
      // 合围扇区: 全波均匀分布(+抖动), 围攻时各车从自己的方向接近, 形成合围而非排队送
      const flankSlot = wi / n * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      if (AIW.on) {
        // worker 模式: 主线程只留 onHurt 转发桩, 决策在 worker 的复制品世界按真实时钟跑
        t._aiId = AIW.nextId++;
        AIW.byId.set(t._aiId, t);
        t._aiDef = def2; t._aiFlank = flankSlot;   // worker 挂掉时 aiStep 现场重建用
        t.ai = { onHurt(shooter) { AIW.worker.postMessage({ t: 'hurt', id: t._aiId, x: shooter.x, z: shooter.z }); } };
        aiSpawnDefs.push({ id: t._aiId, x: t.x, z: t.z, yaw: t.yaw, netId: t.netId || 0, noTurret: !!t.parts.noTurret,
                           flankSlot, spec: aiSpec(t.spec), def: { personality: def2.personality, patrol: def2.patrol, hold: def2.hold } });
      } else {
        t.ai = new SF.AI(t, def2);
        t.ai.flankSlot = flankSlot;
      }
      scene.add(t.group);
      world.tanks.push(t);
      if (MP.mode !== 'sp') { t.netId = MP.aiId++; t.team = 1; t._isAI = true; MP.tanks.set(t.netId, t); aiSpawned.push({ id: t.netId, type }); }
      return t;
    });
    world.enemies = waveEnemies;
    if (AIW.on) AIW.worker.postMessage({ t: 'spawn', list: aiSpawnDefs });
    if (MP.mode !== 'sp') SF.Net.send({ t: 'ev', k: 'aiWave', d: { list: aiSpawned } });
    stats.total += waveEnemies.length;
    SF.HUD.showMsg(`第 ${i + 1} 波 · ${wave.name}` + (MP.mode === 'sp' && PVE.enemyMul > 1 ? ` · 敌军 ×${waveEnemies.length}` : ''), 3);
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
        repairMsgText = world.map.repairBetweenWaves.text + ` (+${heal} HP)`;
        SF.HUD.showMsg(`${repairMsgText} ${Math.ceil(repairT)}s`, 0);   // dur=0 常驻, 倒计时由主循环逐帧刷新
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
    // 曳光高度上限: 仅火炮鹰眼俯视时限制(相机在弧顶之下, 拖尾穿相机平面会被透视放大成扫屏巨线)
    SF.Game.trailClampY = (sniper && p.spec.cls === 'SPG') ? camera.position.y - 4 : Infinity;
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
    // 阴影按需更新: 太阳方向静止, 阴影盒锚定玩家(2m 量化, 消除亚米级游移);
    // 只有跨格或有坦克移出 0.8m(按画质档限频)才重绘阴影图 —— 静止场景阴影开销归零
    const cellX = Math.round(world.player.x / 2), cellZ = Math.round(world.player.z / 2);
    if (!shadowCell || cellX !== shadowCell[0] || cellZ !== shadowCell[1]) {
      shadowCell = [cellX, cellZ];
      shadowNeed = true;
    }
    const qx = cellX * 2, qz = cellZ * 2;   // 量化后的光位(跨格才跳, 稳定不闪)
    sunLight.light.position.set(qx + sunLight.dir.x * 300, sunLight.dir.y * 300, qz + sunLight.dir.z * 300);
    sunLight.light.target.position.set(qx, 0, qz);
    const sm = renderer.shadowMap;
    sm.autoUpdate = false;
    if (!shadowNeed && world.time - shadowLastT >= 1 / GFX.cfg().shadowHz) {
      for (const t of world.tanks) {
        const prev = shadowTankPos.get(t);
        if (!prev || Math.abs(prev[0] - t.x) + Math.abs(prev[1] - t.z) > 0.8) { shadowNeed = true; break; }
      }
    }
    if (shadowNeed) {
      shadowNeed = false; shadowLastT = world.time;
      for (const t of world.tanks) shadowTankPos.set(t, [t.x, t.z]);
      sm.needsUpdate = true;
    }
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
    // 挡弹掩体: 解析遮挡(与炮弹判定同源, OBB/圆本来就是弹道的权威形状; 软质物直接穿过 → 准星与弹道预览一致)
    // 掩体已合批成少量大网格, 逐三角形 raycast 又慢又不再必要
    const coverT = world.covers.blocked(origin.x, origin.z, origin.y, dir.x, dir.z, Math.min(bestT, maxDist), dir.y);
    if (coverT >= 0 && coverT < bestT) {
      bestT = coverT;
      best = new THREE.Vector3(origin.x + dir.x * coverT, origin.y + dir.y * coverT, origin.z + dir.z * coverT);
    }
    // 敌坦克部位网格(含残骸: 挡弹即挡瞄, 不出幽灵准星)
    const objs = [];
    for (const e of world.enemies) objs.push(...e.parts.zones);
    _ray.set(origin, dir); _ray.far = bestT;
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
  // 瞄准轮廓(WoT 红色剪影): 准星压在敌坦克上时勾出整车轮廓
  let aimOutline = null;
  function setAimOutline(t) {
    if (t === aimOutline) return;
    if (aimOutline && aimOutline.parts.outline) aimOutline.parts.outline.set(false);
    if (t && t.parts.outline) t.parts.outline.set(true);
    aimOutline = t;
  }
  function computeAim() {
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    aimPoint = findRayHit(camera.position.clone(), camDir);
    const hitTank = aimPoint && aimPoint.hit && aimPoint.hit.tank;
    setAimOutline(hitTank && hitTank.alive ? hitTank : null);

    const p = world.player;
    if (p.alive) {
      p.group.updateMatrixWorld(true);
      const mz = p.muzzleWorld(), gd = p.gunDir();
      const hit = findRayHit(mz, gd);
      gunAim = hit || { pos: mz.clone().addScaledVector(gd, 400), dist: 400 };   // 打天时取炮向 400m 虚拟点, 保证圈始终存在
      updateTraj();
    } else { gunAim = null; if (trajLine) trajLine.visible = false; trajLand = null; setAimOutline(null); }
  }

  /* ---------- 鹰眼弹道预览线: 从炮口按真实弹道积分, 被地形/建筑遮挡则截断变红 ---------- */
  let trajLine = null, groundLine = null, trajFlightT = 0, trajLand = null;   // trajFlightT: 炮弹到落点的飞行时间(秒); trajLand: 弹道积分真实落点(散布椭圆圆心)
  const TRAJ_N = 140, TRAJ_DT = 0.02;     // 飞行 ~1.3-1.8s; 步长要细(粗了落点判定会漂进 20m 警戒区)
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
    if (!trajLine) return;
    const show = sniper && p.alive && p.spec.cls === 'SPG' && !gameOver;
    // 3D 弧线(trajLine)恒不画: 高抛弧顶(300-400m)远超俯视相机高度, 穿过相机平面的线段会被
    // 透视放大成横扫屏幕的巨线 —— WoT 鹰眼同样只看地面引导线
    trajLine.visible = false;
    if (groundLine) groundLine.visible = show;
    // 弹道仿真常跑(不开鹰眼也要): 真实落点是散布椭圆圆心/飞行时间的唯一权威来源
    trajLand = null;
    if (!p.alive || p.spec.cls !== 'SPG' || gameOver) return;
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
    // 落点(含触地斜率): 平射=近圆散布, 曲射=纵长椭圆
    trajLand = { x: pos.x, y: pos.y, z: pos.z, slope: Math.abs(vel.y) / (Math.hypot(vel.x, vel.z) || 1) };
    // 地面引导线着色: 中途撞掩体/撞山(落点远离瞄准点) → 红色警告; 正常 → 金色
    const endErr = endType === 'ground' && aimPoint ? Math.hypot(pos.x - aimPoint.pos.x, pos.z - aimPoint.pos.z) : 0;
    const warn = endType === 'cover' || (endType === 'ground' && endErr > 20);
    if (groundLine && show) {
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

  // 开镜/鹰眼切换(键盘 Shift 与移动端开镜按钮共用)
  // WoT 式狙击镜去遮挡: 开镜时草丛变半透明且不再投影(WoT 移除 foliage); 退镜恢复
  // (合批后草丛的材质透明与网格投影都由 SF.Models.setBushSeeThrough 统一处理)
  function setBushSeeThrough(on) {
    SF.Models.setBushSeeThrough(on);
  }
  function toggleSniper() {
    sniper = !sniper;
    if (sniper) sniperFov = SF.CFG.camera.sniperFovMax;   // 开镜从最广视场开始
    setBushSeeThrough(sniper);
    if (typeof window.updateZoomUI === 'function') window.updateZoomUI();   // 触屏倍率滑杆同步
    // 火炮开鹰眼: 视野中心定位到当前瞄准点(太近则车前方 220m)
    if (sniper && world.player && world.player.spec.cls === 'SPG') {
      const apd = aimPoint ? Math.hypot(aimPoint.pos.x - world.player.x, aimPoint.pos.z - world.player.z) : 0;
      if (aimPoint && apd > 60) { artyX = aimPoint.pos.x; artyZ = aimPoint.pos.z; }
      else { artyX = world.player.x + Math.sin(camYaw) * 220; artyZ = world.player.z + Math.cos(camYaw) * 220; }
      SF.HUD.showMsg('鹰眼 · 拖动瞄准 · 按钮切换视场', 3);
    }
  }

  /* ---------- 移动端触屏操控(WoT 手游式): 左摇杆开车 / 右半屏拖动瞄准 / 开炮·开镜按钮 ----------
     检测: pointer:coarse 或有触点; localStorage.sf_touch=1 强制开启(调试/ hybrid 设备) */
  const NATIVE_TOUCH = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0
    || ('ontouchstart' in window) || /Android|iPhone|iPad|HarmonyOS|HuaweiBrowser|ArkWeb/i.test(navigator.userAgent);
  const TOUCH = (() => {
    try { if (localStorage.getItem('sf_touch') === '1') return true; } catch (e) { }
    return NATIVE_TOUCH;
  })();
  // 移动端第一次触摸即尝试全屏+锁横屏(浏览器要求用户手势, touchstart 合法;
  // iOS Safari 不支持元素全屏则静默, 由竖屏遮罩兜底提示; 仅尝试一次, 被拒不再骚扰)
  if (NATIVE_TOUCH) {
    addEventListener('touchstart', () => {
      const el = document.documentElement;
      (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : Promise.reject())
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
        .catch(() => { });
    }, { capture: true, once: true, passive: true });
  }
  if (TOUCH) document.body.classList.add('touch');   // 竖屏旋转遮罩等触屏专属样式钩子

  // 触屏环境自检 (?debug=touch): 顶部面板显示检测链各环节 + 一键强制触屏 UI 并刷新
  // 排查特定设备(如鸿蒙平板)触控不可用时, 打开 页面地址+?debug=touch 看哪一环断了
  if (/[?&]debug=touch/.test(location.search)) {
    const yn = (b) => `<b style="color:${b ? '#9fe08a' : '#a05a4e'}">${b ? '✔' : '✘'}</b>`;
    const row = (label, html) =>
      `<div style="display:flex;gap:10px;align-items:baseline"><span style="color:#8b9080;flex:none;width:3em;text-align:justify;text-align-last:justify">${label}</span><span style="word-break:break-all">${html}</span></div>`;
    const box = document.createElement('div');
    box.className = 'panel';
    box.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999;padding:0 0 10px;min-width:360px;max-width:92vw;color:#b9c4a4;font:12px/2 monospace;background:rgba(14,16,11,.88)';
    box.innerHTML = `
      <div id="tdHead" style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid rgba(200,178,106,.2)">
        <span style="color:#e8dcae;font-size:13px;letter-spacing:2px">🔍 触屏环境自检</span>
        <span id="tdFold" style="cursor:pointer;color:#8b9080;font:13px/1 monospace;padding:2px 6px" title="收起/展开">▾</span>
      </div>
      <div id="tdBody" style="padding:6px 12px 0"></div>
      <div id="tdAct" style="padding:8px 12px 0"><button class="mbtn gold" style="width:100%;padding:7px 10px;font-size:13px">强制开启触屏 UI 并刷新</button></div>`;
    const body = box.querySelector('#tdBody');
    const renderBar = () => {
      body.innerHTML =
        row('触控', `coarse ${yn(matchMedia('(pointer:coarse)').matches)} · points ${navigator.maxTouchPoints} · ontouch ${yn('ontouchstart' in window)}`) +
        row('生效', `TOUCH ${yn(TOUCH)} · body.touch ${yn(document.body.classList.contains('touch'))} · 全屏 ${yn(!!document.fullscreenElement)}`) +
        row('视口', `screen ${screen.width}×${screen.height} · dpr ${devicePixelRatio}<br>inner ${innerWidth}×${innerHeight} · ${matchMedia('(orientation: portrait)').matches ? '竖屏' : '横屏'}`) +
        row('vp', ((document.getElementById('metaVp') || {}).content || '无'));
    };
    renderBar();
    addEventListener('resize', renderBar);
    addEventListener('orientationchange', () => setTimeout(renderBar, 300));
    box.querySelector('#tdFold').onclick = () => {
      const fold = body.style.display === 'none';
      body.style.display = fold ? '' : 'none';
      box.querySelector('#tdAct').style.display = fold ? '' : 'none';
      box.querySelector('#tdFold').textContent = fold ? '▾' : '▸';
    };
    box.querySelector('button.mbtn').onclick = () => { try { localStorage.setItem('sf_touch', '1'); } catch (e) { } location.reload(); };
    document.body.appendChild(box);
  }

  // 忽略系统 dip 缩放(等效 DPR=2): 系统显示缩放大的手机横屏 CSS 高度仅 ~360px, 车库/战斗按 device-width 布局放不下;
  // 视口宽固定为 物理宽÷2 → 等比缩放零变形、与屏幕纵横比一致、各机型物理字号统一, 触屏按钮物理仍有 ~9mm
  // 判据用 screen 尺寸×DPR(不随 meta viewport 改变, 避免来回切换死循环); 竖屏仍走旋转遮罩, 桌面不受影响
  if (NATIVE_TOUCH) {
    const metaVp = document.getElementById('metaVp');
    const setVp = () => {
      const longCSS = Math.max(screen.width, screen.height), shortCSS = Math.min(screen.width, screen.height);
      const physLong = longCSS * devicePixelRatio, physShort = shortCSS * devicePixelRatio;
      metaVp.content = (physShort / 2 < 480)   // 等效 DPR=2 后 CSS 短边仍 <480(极小屏) → 退回系统行为
        ? 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
        : 'width=' + Math.round(physLong / 2) + ', user-scalable=no, viewport-fit=cover';
    };
    setVp();
    addEventListener('orientationchange', setVp);
    addEventListener('resize', setVp);
  }

  // 全屏切换(首触自动尝试 + 车库/战斗手动按钮兜底; 浏览器全屏退出冷却期会拒绝自动请求, 手动点按钮可重试)
  function toggleFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
    (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : Promise.reject())
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => alert('此浏览器不支持网页全屏(iPhone Safari 无此 API)。\n可用 Safari 菜单「添加到主屏幕」, 从主屏幕打开即是全屏。'));
  }
  const touchCtl = { stick: { id: null, ox: 0, oy: 0, dx: 0, dy: 0 }, aimId: null, aimX: 0, aimY: 0,
    pinchId: null, pinch: { d0: 0, fov0: 0, dist0: 0 }, ui: null };

  function ensureTouchUI() {
    if (!TOUCH || touchCtl.ui) return;
    const root = document.createElement('div');
    root.id = 'touchUI';
    root.innerHTML = `
      <div id="tStickBase"><div id="tStickNub"></div></div>
      <div id="tAimZone"></div>
      <div id="tStickZone"></div>
      <button id="tFull" title="全屏">⛶</button>
      <div id="tZoomBox"><input type="range" id="tZoom" min="${SF.CFG.camera.sniperFovMin}" max="${SF.CFG.camera.sniperFovMax}" step="0.25"><div id="tZoomVal">倍率 ×2.0</div></div>
      <div id="tBtns">
        <button id="tScope">开镜</button>
        <button id="tFire">开炮</button>
      </div>
      <button id="tFireL">开炮</button>`;
    document.getElementById('hud').appendChild(root);
    touchCtl.ui = root;
    // 倍率滑杆: 开镜时出现, 拉动调 fov(右=视野广=倍率低); 捏合调倍率时同步回滑杆
    const zoomBox = root.querySelector('#tZoomBox'), zoomInput = root.querySelector('#tZoom');
    zoomInput.value = SF.CFG.camera.sniperFovMax;
    zoomInput.addEventListener('input', () => {
      if (!sniper) return;
      sniperFov = parseFloat(zoomInput.value);
      updateZoomUI();
    });
    window.updateZoomUI = () => {
      const z = root.querySelector('#tZoom'), v = root.querySelector('#tZoomVal');
      if (!z) return;
      z.value = sniperFov;
      v.textContent = '倍率 ×' + (SF.CFG.camera.sniperFovMax / sniperFov).toFixed(1);
      zoomBox.style.display = sniper && world.player && world.player.spec.cls !== 'SPG' ? 'block' : 'none';
    };
    const stickBase = root.querySelector('#tStickBase'), nub = root.querySelector('#tStickNub');
    const stickZone = root.querySelector('#tStickZone'), aimZone = root.querySelector('#tAimZone');
    const R = 46;   // 摇杆最大行程(px)

    stickZone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (touchCtl.stick.id !== null) return;
      const t = e.changedTouches[0];
      touchCtl.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
      stickBase.style.display = 'block';
      stickBase.style.left = (t.clientX - 55) + 'px'; stickBase.style.top = (t.clientY - 55) + 'px';
      nub.style.transform = 'translate(0px,0px)';
    }, { passive: false });
    stickZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== touchCtl.stick.id) continue;
        let dx = t.clientX - touchCtl.stick.ox, dy = t.clientY - touchCtl.stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }         // 行程 clamp, 方向保留
        touchCtl.stick.dx = dx / R; touchCtl.stick.dy = dy / R;
        nub.style.transform = `translate(${dx}px,${dy}px)`;
      }
    }, { passive: false });
    const stickEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchCtl.stick.id) continue;
        touchCtl.stick = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
        stickBase.style.display = 'none';
      }
    };
    stickZone.addEventListener('touchend', stickEnd);
    stickZone.addEventListener('touchcancel', stickEnd);

    // 右半屏: 第一指=瞄准(鹰眼=平移视野); 已有瞄准指再落指=双指捏合变焦(第三人称调距离/镜内调倍率)
    // 注意: 不能用 e.touches.length(全页触点数)判断捏合——左摇杆按住时右区一落指就会被误判
    // HUD 可点元素(退出按钮/小地图/大地图)在 zone 之上, 触点落上时放行给其自身的处理器
    const hudTappable = (t) => {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.id === 'btnExit' || n.id === 'minimapBox' || n.id === 'bigMap' || n.id === 'tZoomBox') return false;
      }
      return true;
    };
    aimZone.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (!hudTappable(t)) continue;   // 点在 HUD 元素上: 不当瞄准, 让 click/元素自身逻辑处理
        if (touchCtl.aimId === null) { touchCtl.aimId = t.identifier; touchCtl.aimX = t.clientX; touchCtl.aimY = t.clientY; }
        else if (touchCtl.pinchId === null) {   // 第二指: 与瞄准指构成捏合
          touchCtl.pinchId = t.identifier;
          touchCtl.pinch = { d0: Math.hypot(t.clientX - touchCtl.aimX, t.clientY - touchCtl.aimY), fov0: sniperFov, dist0: camDist };
        }
      }
    }, { passive: false });
    aimZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === touchCtl.aimId) {
          if (touchCtl.pinchId !== null) continue;   // 捏合中冻结瞄准, 防跳动
          const dx = t.clientX - touchCtl.aimX, dy = t.clientY - touchCtl.aimY;
          touchCtl.aimX = t.clientX; touchCtl.aimY = t.clientY;
          if (sniper && world.player && world.player.spec.cls === 'SPG') {   // 鹰眼: 拖动平移视野中心
            const wpp = artyH * 0.573 / innerHeight * 4;
            artyX = U.clamp(artyX + dx * wpp, -470, 470);
            artyZ = U.clamp(artyZ + dy * wpp, -470, 470);
            vcx = t.clientX; vcy = t.clientY;
            continue;
          }
          // 触屏专用灵敏度(手指行程短, 需比鼠标高约 4 倍); 镜内随倍率细化
          const s = SF.CFG.camera.touchSens * (sniper ? SF.CFG.camera.sniperSens * (sniperFov / 15) : 1);
          camYaw -= dx * s;
          camPitch = U.clamp(camPitch + dy * s, -0.12, 1.1);
        } else if (t.identifier === touchCtl.pinchId) {
          const d = Math.hypot(t.clientX - touchCtl.aimX, t.clientY - touchCtl.aimY);
          if (d > 4 && touchCtl.pinch.d0 > 4) {
            if (sniper) sniperFov = U.clamp(touchCtl.pinch.fov0 * touchCtl.pinch.d0 / d, SF.CFG.camera.sniperFovMin, SF.CFG.camera.sniperFovMax);   // 张开放大
            else camDist = U.clamp(touchCtl.pinch.dist0 * touchCtl.pinch.d0 / d, SF.CFG.camera.minDist, SF.CFG.camera.maxDist);
            updateZoomUI();
          }
        }
      }
    }, { passive: false });
    const aimEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === touchCtl.aimId) touchCtl.aimId = null;
        if (t.identifier === touchCtl.pinchId) touchCtl.pinchId = null;
      }
    };
    aimZone.addEventListener('touchend', aimEnd);
    aimZone.addEventListener('touchcancel', aimEnd);

    // 按钮: 开炮(按住连发由装填节奏控制; 右下主炮 + 左侧副炮两枚) / 开镜
    for (const id of ['#tFire', '#tFireL']) {
      const fireBtn = root.querySelector(id);
      fireBtn.addEventListener('touchstart', e => { e.preventDefault(); mouseDown = true; fireBtn.classList.add('on'); }, { passive: false });
      const fireEnd = e => { e.preventDefault(); mouseDown = false; fireBtn.classList.remove('on'); };
      fireBtn.addEventListener('touchend', fireEnd);
      fireBtn.addEventListener('touchcancel', fireEnd);
    }
    root.querySelector('#tScope').addEventListener('touchstart', e => { e.preventDefault(); toggleSniper(); }, { passive: false });
    root.querySelector('#tFull').addEventListener('touchstart', e => { e.preventDefault(); toggleFullscreen(); }, { passive: false });

    // HUD 按钮/地图触屏直呼(默认层序在 aimZone 之下, 合成 click 会被 preventDefault 吞掉):
    // 退出/小地图跳转/大地图开关
    document.getElementById('btnExit').addEventListener('touchstart', e => {
      e.preventDefault(); e.stopPropagation();
      exitToTitle();
    }, { passive: false });
    const mapTap = (elId, big) => {
      const el = document.getElementById(elId);
      el.addEventListener('touchstart', e => {
        e.preventDefault(); e.stopPropagation();
        const t = e.changedTouches[0];
        const r = el.getBoundingClientRect();
        if (big) SF.HUD.toggleBigMap();
        else jumpViewTo(t.clientX, t.clientY, el);
      }, { passive: false });
    };
    mapTap('minimap');
    mapTap('bigMap', true);
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
        if (typeof window.updateZoomUI === 'function') window.updateZoomUI();
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
      if (e.code === 'F3') { e.preventDefault(); if (!e.repeat) toggleFpsMeter(); return; }   // 帧率/绘制角标
      const k = keyOf(e);
      if (!k) return;
      keySeen = true;
      if (k === 'Shift') {
        if (!e.repeat) toggleSniper();
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
        if (!spotted.has(e)) continue;                 // 只能锁定已点亮目标(未点亮模型已隐藏)
        const to = e.pos3.clone().sub(camera.position);
      const ang = to.normalize().angleTo(dir);
      if (ang < bestAng && SF.losClear(world, camera.position.x, camera.position.z, e.x, e.z)) { bestAng = ang; best = e; }
    }
    if (best) { autoTarget = best; SF.HUD.showMsg('自动瞄准：' + best.spec.name, 1.5); }
    else SF.HUD.showMsg('准星方向无目标', 1.2);
  }

  // 敌军等级匹配: 按参战玩家最高等级, 同类别选邻近等级敌车(开 VIII 级不再割草 III 级)
  const TIER_NUM = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11 };
  function pickTierTank(cls, band) {
    for (let w = 0; w < 4; w++) {
      const lo = Math.max(1, band[0] - w), hi = Math.min(11, band[1] + w);
      const pool = [];
      for (const k in SF.CFG.vehicles) {
        const v = SF.CFG.vehicles[k];
        if (v.tier && v.cls === cls && TIER_NUM[v.tier] >= lo && TIER_NUM[v.tier] <= hi && SF.Assets.hasModel(k)) pool.push(k);
      }
      if (pool.length) return pool[(Math.random() * pool.length) | 0];
    }
    return 'pz4';
  }
  // 等级带内所有车型(含降档扩池), 开战预载用 —— 是 pickTierTank 可能选中的全集
  function enemyTypesFor(band) {
    for (let w = 0; w < 4; w++) {
      const lo = Math.max(1, band[0] - w), hi = Math.min(11, band[1] + w);
      const pool = [];
      for (const k in SF.CFG.vehicles) {
        const v = SF.CFG.vehicles[k];
        if (v.tier && TIER_NUM[v.tier] >= lo && TIER_NUM[v.tier] <= hi && SF.Assets.hasModel(k)) pool.push(k);
      }
      if (pool.length) return pool;
    }
    return ['pz4'];
  }

  // 按需补载(懒加载): 资源已缓存时瞬间完成不闪加载条; 有缺项才显示进度
  async function withLoading(label, prepare) {
    const loading = document.getElementById('loading'), bar = document.getElementById('loadBar'), tip = document.getElementById('loadTip');
    const p = prepare((done, total) => {
      bar.style.width = (total ? done / total * 100 : 100) + '%';
      tip.textContent = `${label} ${done}/${total}`;
    });
    const settled = await Promise.race([p.then(() => true, () => true), new Promise(r => setTimeout(() => r(false), 90))]);
    if (!settled) loading.style.display = 'flex';
    try { await p; } finally { loading.style.display = 'none'; }
  }

  // 横向卡行(战场/坦克): 鼠标滚轮 → 横向滚动
  function bindHScroll() {
    for (const el of document.querySelectorAll('.hscroll'))
      el.addEventListener('wheel', e => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }, { passive: false });
  }

  function playerInput() {
    const p = world.player;
    let thr = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0);
    let str = (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0);
    // 触屏摇杆优先于键盘: 模拟量直接驱动(带死区)
    if (touchCtl.stick.id !== null) {
      const dz = v => Math.abs(v) < 0.16 ? 0 : v;
      thr = -dz(touchCtl.stick.dy);   // 上推=前进
      str = -dz(touchCtl.stick.dx);   // 右推=右转(steer 负=右, 同 D 键)
    }
    const input = {
      throttle: thr || cruise,
      // 注意: yaw 增大 = 向左转(俯视逆时针), 所以 A=+1 / D=-1
      steer: str,
      fire: mouseDown
    };
    // 有效瞄准目标: 自动瞄准锁定目标 > 相机准星点
    const tg = (autoTarget && autoTarget.alive) ? { x: autoTarget.x, y: autoTarget.y + 1.1, z: autoTarget.z }
      : (aimPoint ? aimPoint.pos : null);
    if (tg) {
      const dx = tg.x - p.x, dz = tg.z - p.z, d = Math.max(Math.hypot(dx, dz), 1);
      input.aimYaw = Math.atan2(dx, dz);
      input.aimPitch = Math.atan2(tg.y - (p.y + 2.2), d);
      // 自行火炮弹道解算(WoT): 远距取高抛根曲射; 近距高抛根超仰角上限时自动切低弹道平射
      // —— 炮管压得平, 炮弹靠自然下坠砸中准星(不是"必须抛物线"), 自动瞄准同样走弹道解算;
      // 两根都够不着(超最大射程)才压最大仰角打最远
      if (p.spec.cls === 'SPG') {
        const v = p.spec.gun.speed, g = p.spec.gun.grav || SF.CFG.sim.shellGravity;
        const h = (p.y + 2.2) - tg.y;                        // 炮口高于落点
        const A = g * d * d / (2 * v * v);
        const disc = d * d - 4 * A * (A - h);
        const uMax = Math.tan(p.spec.gunElevation), uMin = Math.tan(p.spec.gunDepression);
        let u = uMax;
        if (disc >= 0) {
          const s = Math.sqrt(disc), uHi = (d + s) / (2 * A), uLo = (d - s) / (2 * A);
          u = uHi <= uMax ? uHi : uLo;                       // 高抛根优先, 超上限 → 低弹道平射
        }
        input.aimPitch = Math.atan(U.clamp(u, uMin, uMax));
      }
    } else { input.aimYaw = camYaw; input.aimPitch = 0; }
    // WoT 式右键自由视角: 按住右键时炮塔转角/炮管俯仰相对车体锁定(车体转动炮塔跟着走),
    // 相机自由查看四周; 松开后炮塔伺服重新追赶相机瞄准
    // (鹰眼模式例外: 落点恒为视野中心, 右键不解锁弹道解算)
    if (freeLook && !(sniper && p.spec.cls === 'SPG')) input.holdTurret = true;
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
  const HIT_TEXT = { pen: '击穿', bounce: '跳弹', nopen: '未击穿', gun: '火炮损伤', splash: '命中', absorb: '履带吸收', ram: '撞击', fall: '坠落摔伤' };
  const HIT_COLOR = { pen: '#ffb35c', bounce: '#f2f2f2', nopen: '#9aa0a6', gun: '#ffd97a', splash: '#ffb35c', absorb: '#9fd0ff', ram: '#ffb35c', fall: '#e8c977' };
  const MODULE_TAG = { track: '·履带', engine: '·发动机', ammo: '·弹药架', gun: '' };

  function bindBus() {
    SF.Bus.on('fire', (e) => {
      e.tank.lastFireT = world.time;
      if (AIW.on && (e.tank.isPlayer || e.tank.team === world.player.team))   // worker 模式: 炮声转发给 AI
        AIW.worker.postMessage({ t: 'fire', x: e.tank.x, z: e.tank.z, player: !!e.tank.isPlayer });
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
      const text = { pen: `-${r.dmg}`, bounce: '跳弹', nopen: '未击穿', gun: '火炮受损', absorb: '履带吸收', ram: `-${r.dmg}`, fall: `摔伤 -${r.dmg}`,
                     splash: r.dmg > 0 ? `-${r.dmg}` : '未击穿' }[r.kind] || '';
      SF.HUD.dmgNumber(r.point, text, HIT_COLOR[r.kind] || '#fff');
      const snd = r.kind === 'pen' ? 'pen' : r.kind === 'bounce' ? 'bounce' : 'nopen';
      // 音量: 自己挨打最响; 自己打中的反馈音用慢衰减(atten 大)保证清晰
      if (r.kind !== 'splash' && r.kind !== 'fall')   // HE 溅射在弹着点已播爆炸声; 坠落播撞击闷响
        SF.Audio.play(snd, target.isPlayer ? null : r.point, { gain: target.isPlayer ? 1.7 : 1.0, atten: 140 });
      if (r.kind === 'fall' && target.isPlayer) SF.Audio.play('track', null, { gain: 1.5 });
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
        else if (r.kind === 'fall') { SF.HUD.alarm(`坠落摔伤 -${r.dmg}` + (r.module === 'track' ? ' · 履带受损' : '')); }
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
  // F3 帧率角标: 实测性能用(fps / draw calls / 三角形)
  let fpsShow = false, fpsN = 0, fpsT = 0;
  function toggleFpsMeter() {
    fpsShow = !fpsShow;
    const el = document.getElementById('fpsMeter');
    if (el) el.style.display = fpsShow ? 'block' : 'none';
  }
  function updateFpsMeter(dtReal) {
    if (!fpsShow) return;
    fpsN++; fpsT += dtReal;
    if (fpsT >= 0.5) {
      const r = renderer.info.render;
      const el = document.getElementById('fpsMeter');
      if (el) el.textContent = `${Math.round(fpsN / fpsT)} fps · ${r.calls} calls · ${(r.triangles / 1000 | 0)}k tris`;
      fpsN = 0; fpsT = 0;
    }
  }

  // 敌车是否应显示模型(单一权威判定): 点亮残留期内, 或 5s 内开过炮(炮口焰暴露, 与小地图/名牌同款)
  // 之前模型只认 spotted, 而红点/名牌还认开炮暴露 → 出现"小地图有红点、屏幕上却没车"的分裂
  function spotDisplay(e) {
    return spotted.has(e) || world.time - (e.lastFireT || -99) < 5;
  }

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
      // 重生队列(死斗: 己方半侧出生点重生)
      for (const r of MP.respawn) {
        r.t -= dt;
        if (r.t <= 0) {
          const tk = MP.tanks.get(r.id);
          const half = MP.spawnPool.length >> 1;
          const base = MP.gameMode === 'coop' ? 0 : (tk.team === 1 ? half : 0);
          const span = MP.gameMode === 'coop' ? MP.spawnPool.length : half;
          const sp = MP.spawnPool[base + ((Math.random() * span) | 0)];
          scene.remove(tk.group);
          tk.rebuild();
          // 抖动落点须过地形关(池点圆盘已验证, 此处点级复核, 全败回退池点本点) + 补掩体推挤; 朝向朝地图中心
          let jx = sp[0], jz = sp[1];
          for (let k = 0; k < 10; k++) {
            const tx = sp[0] + (Math.random() - 0.5) * 20, tz = sp[1] + (Math.random() - 0.5) * 20;
            if (spawnPtOk(tx, tz)) { jx = tx; jz = tz; break; }
          }
          [jx, jz] = world.covers.collide(jx, jz, 3);
          tk.x = jx; tk.z = jz; tk.yaw = Math.atan2(-jx, -jz);
          scene.add(tk.group);
          tk._yInit = false;
        }
      }
      MP.respawn = MP.respawn.filter(r => r.t > 0);
      if (MP.gameMode === 'coop') for (const e of world.enemies) e.update(gameOver ? IDLE_INPUT(e) : aiStep(e, dt, world), dt, world);
      MP.timeLeft -= dt;
      if (MP.timeLeft <= 0 && !gameOver) endMatch();
    } else {
      // 结算后敌人熄火滑停(不再绕圈搜索/扫炮), 在飞炮弹与特效照常结算
      for (const e of world.enemies) {
        const inp = gameOver ? IDLE_INPUT(e) : aiStep(e, dt, world);
        e.update(inp, dt, world);   // 死亡车辆也要更新(残骸沉降/冒烟), update 内部分支处理
      }
    }

    shells.update(dt, world);

    if (MP.mode === 'sp' || (MP.mode === 'host' && MP.gameMode === 'coop')) {
      if (repairT > 0) {
        repairT -= dt;
        if (repairT > 0) SF.HUD.showMsg(`${repairMsgText} ${Math.ceil(repairT)}s`, 0);   // 逐帧刷新倒计时
      }
      checkWave();
      // 补给空投(权威端): 随机生成 + 拾取判定 + 增益计时(coop 拾取事件由主机广播, 场上空投走快照)
      SF.Pickups.update(dt, {
        authority: true, gameOver,
        humans: MP.mode === 'sp' ? [world.player] : [...MP.tanks.values()].filter(t => t.netId < 100),
        send: MP.mode === 'host' ? (m) => SF.Net.send(m) : null
      });
    }

    // 玩家对敌发现: 视距×(1-目标隐蔽) + 多点通视 + 50m 强制点亮 + 5~10s 残留
    // 目标集: 单机/合作主机=AI 敌军(world.enemies); 死斗主机=敌方玩家(同阵营队友不点亮不隐藏) —— 同一套点亮规则
    // (此前死斗主机走下方第二块, 与本块共用 spottedTimer 双重递减, 0.25 为 dt 整倍数时第二块
    //  永远轮不到执行 → 房主点不亮任何人; 现统一为一块一个计时器)
    const spotTargets = (MP.mode === 'host' && MP.gameMode === 'dm')
      ? [...MP.tanks.values()].filter(t => t.netId !== MP.myId && t.team !== p.team)
      : world.enemies;
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
        return d < 50 || (d < vr * (1 - SF.camoOf(e, world)) && SF.losClearAny(world, p.x, p.z, e.x, e.z, SF.bushState(e, world)));
      };
      for (const e of spotTargets) {
        if (!e.alive) { spottedLast.delete(e); spotStreak.delete(e); spotLinger.delete(e); continue; }
        markSpot(e, lit(e));
      }
      spotted.clear();
      for (const [e, t0] of spottedLast)
        if (world.time - t0 < (spotLinger.get(e) || 5)) spotted.add(e);
        else { spottedLast.delete(e); spotLinger.delete(e); }
      for (const e of spotted) lastKnown.set(e, { x: e.x, z: e.z });   // 点亮=实时刷新最后已知位置
      for (const [e] of lastKnown) if (!e.alive) lastKnown.delete(e);
      // WoT 式: 未点亮的敌军模型隐藏(看得见≠点亮; 阵亡残骸保留) —— 主/客同一规则
      // 显示判定与 HUD 名牌/小地图红点同一条规则: 点亮残留期内, 或 5s 内开过炮(炮口焰暴露)
      for (const e of spotTargets) e.group.visible = !e.alive || spotDisplay(e);
    }
    let enemySeesMe = false;
    if (MP.mode === 'host') {
      if (MP.gameMode === 'coop') {
        for (const e of world.enemies) if (e.alive && e.ai && aiSeen(e) && aiTargetId(e) === p.netId) { enemySeesMe = true; break; }
      } else {
        for (const [id, t] of MP.tanks) {
          if (id === MP.myId || !t.alive || t.team === p.team) continue;   // 队友的注视不算被发现
          const d = U.dist2d(p.x, p.z, t.x, t.z);
          const vr = t.spec.view || SF.CFG.player.viewRange;   // 对方的视距 × 我的隐蔽
          if (d < 50 || (d < vr * (1 - SF.camoOf(p, world)) && SF.losClearAny(world, t.x, t.z, p.x, p.z, SF.bushState(p, world)))) { enemySeesMe = true; break; }
        }
      }
    } else {
      for (const e of world.enemies) if (e.alive && e.ai && aiSeen(e)) { enemySeesMe = true; break; }
    }
    // 草丛隐蔽状态刷新(HUD 指示): 蹲入且 4s 未开炮 = 隐蔽生效
    const bs = SF.bushState(p, world);
    bushUi.inBush = bs.inBush; bushUi.concealed = bs.concealed;
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
    SF.Models.setFoliageFocus(world.player.x, world.player.z);   // 近距草本透明跟随玩家
    SF.Audio.setEngine(Math.abs(world.player.speed) / world.player.spec.maxSpeed, keys.KeyW || keys.KeyS ? 1 : 0, dtReal);
    SF.HUD.update(dtReal, world, SF.Game.uiState);
    if (AIW.on) {
      AIW.snapT -= dtReal;
      if (AIW.snapT <= 0) { AIW.snapT = 0.1; sendAISnap(); }
      if (gameOver && !AIW.overSent) { AIW.overSent = true; AIW.worker.postMessage({ t: 'over' }); }
    }
    updateFpsMeter(dtReal);
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

  async function start() {
    const bar = document.getElementById('loadBar'), tip = document.getElementById('loadTip');
    // 先恢复上次选择 —— 启动只载所选坦克(懒加载, 其余后台预取)
    selTank = localStorage.getItem('sf_mp_tank') || selTank;
    selMap = localStorage.getItem('sf_map') || selMap;
    if (!SF.CFG.vehicles[selTank]) selTank = 'sherman';
    if (!SF.CFG.maps.find(m => m.id === selMap)) selMap = 'l01';
    showTip('tipOnLoad');
    try {
      await SF.Assets.load(selTank, (done, total) => {
        bar.style.width = (done / total * 100) + '%';
        tip.textContent = `加载资源 ${done}/${total}`;
      });
    } catch (err) {
      tip.innerHTML = `<span style="color:#e06c5a">${err.message}</span><br>请通过 HTTP 访问(运行 node server/dev-static.js 8341 后浏览器打开 http://127.0.0.1:8341)`;
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
    buildGaragePreview();
    buildPicker();
    buildPve();
    buildGfxPanel();
    bindHScroll();          // 地图/坦克卡行: 滚轮横向滚动
    // 触屏: 车库全屏按钮(首触自动全屏失败/被冷却拒绝时的手动兜底)
    if (NATIVE_TOUCH) {
      const b = document.createElement('button');
      b.id = 'btnFs'; b.textContent = '⛶ 全屏';
      document.getElementById('titleBrand').appendChild(b);
      b.onclick = toggleFullscreen;
    }
    SF.Assets.prefetch();   // 后台预取其余资源(音效/语音/模型), 不阻塞车库

    document.getElementById('btnStart').addEventListener('click', () => {
      disposeGarage();
      startBattle();
    });
    document.getElementById('btnExit').addEventListener('click', exitToTitle);
    document.getElementById('btnRetry').addEventListener('click', () => (MP.mode === 'sp' ? startBattle() : backToLobby()));
    // 联机结算: 走"返回房间"保留房间再战; 单机回车库
    document.getElementById('btnToGarage').addEventListener('click', () => (MP.mode !== 'sp' ? backToLobby() : exitToTitle()));
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
      el.onclick = () => {
        selTank = t.type; localStorage.setItem('sf_mp_tank', t.type);
        [...g.children].forEach(c => c.classList.remove('sel')); el.classList.add('sel'); setGarageTank(t.type);
        document.dispatchEvent(new CustomEvent('sf-mp-tank', { detail: t.type }));   // 联机在房: 大厅监听上报换车
      };
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

  /* ---------- PVE 修改器面板: 敌军规模 + 配件倍率(仅单机, localStorage 持久化) ---------- */
  function buildPve() {
    const el = document.getElementById('pvePanel');
    // 语义统一"越高越强": 装填/瞄准为速度倍率(时间÷倍率)
    const DEFS = [
      ['enemyMul', '敌军规模', '敌军', [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10]],
      ['reloadMul', '输弹机 · 装填速度', '装填', [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5]],
      ['aimMul', '炮控 · 瞄准速度', '缩圈', [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5]],
      ['mobilityMul', '涡轮 · 机动', '机动', [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5]],
      ['hpMul', '装甲 · 血量', '血量', [0.5, 1, 2, 3, 5, 8, 10]],
      ['viewMul', '观瞄 · 视野', '视野', [0.5, 1, 1.5, 2, 2.5, 3, 4, 5]],
    ];
    // 折叠态摘要: 非默认项拼进标题(如 "敌军3× · 装填0.7×"), 全默认则不显示
    const sum = () => DEFS.filter(([k]) => PVE[k] != 1).map(t => t[2] + PVE[t[0]] + '×').join(' ');
    const refresh = () => {
      const em = el.querySelector('.pveSum');
      em.textContent = sum();
      el.querySelector('.pveTitle').classList.toggle('mod', !!sum());
    };
    let html = '<div class="pveTitle"><b>⚙ PVE 修改器</b><em class="pveSum"></em><span>仅单机 · 点击展开</span></div>';
    html += '<div class="pveBody">';
    for (const [k, name, ab, opts] of DEFS)
      html += `<div class="pveRow"><label>${name}</label><select data-k="${k}">` +
        opts.map(v => `<option value="${v}"${PVE[k] == v ? ' selected' : ''}>${v == 1 ? '1×(默认)' : v + '×'}</option>`).join('') +
        '</select></div>';
    html += '</div>';
    el.innerHTML = html;
    // 标题点击折叠/展开(窄屏/矮屏默认折叠, 给车库预览让位; 左栏竖排后矮屏也容易顶出屏)
    const title = el.querySelector('.pveTitle');
    title.onclick = () => el.classList.toggle('collapsed');
    if (innerWidth < 960 || innerHeight < 620) el.classList.add('collapsed');
    for (const sel of el.querySelectorAll('select'))
      sel.onchange = () => {
        PVE[sel.dataset.k] = parseFloat(sel.value);
        localStorage.setItem('sf_pve', JSON.stringify(PVE));
        refresh();
      };
    refresh();
  }

  // 画质选择(车库): 高/中/低 三档; 分辨率与阴影实时生效, MSAA 需重开战斗(下次出击读取)
  function buildGfxPanel() {
    const el = document.getElementById('gfxPanel');
    const sel = document.getElementById('gfxSel');
    const note = document.getElementById('gfxNote');
    const NOTES = {
      high: '渲染分辨率 100% · MSAA 抗锯齿 · 2K 阴影',
      mid: '渲染分辨率 75% · MSAA 抗锯齿 · 1K 阴影',
      low: '渲染分辨率 62% · 关抗锯齿 · 1K 阴影低频更新'
    };
    sel.value = GFX.preset;
    note.textContent = NOTES[GFX.preset] + (GFX.preset !== 'high' ? ' · 抗锯齿变更下次出击生效' : '');
    sel.onchange = () => { GFX.set(sel.value); note.textContent = NOTES[GFX.preset] + (GFX.preset !== 'high' ? ' · 抗锯齿变更下次出击生效' : ''); };
    const title = el.querySelector('.pveTitle');
    title.onclick = () => el.classList.toggle('collapsed');
    if (innerWidth < 960 || innerHeight < 620) el.classList.add('collapsed');
  }

  /* ---------- 战斗生命周期: 开战 / 退出回车库 / 再战 ---------- */
  let battleBound = false;   // 输入与事件总线只绑一次(重开战斗不重复绑定)
  function resetBattleVars() {
    gameOver = false; loseT = -1; waveIdx = 0; repairT = 0; repairMsgText = ''; repairMsgOn = false; repairDone = false; spottedTimer = 0;
    deathMark = null; autoTarget = null; sniper = false; freeLook = false; mouseDown = false; cruise = 0; shakeT = 0;
    SF.Models.setBushSeeThrough(false);   // models 侧的开镜草丛状态不随战斗变量重置, 显式归位
    SF.Models.setFoliageFocus(null, null);   // 近距草透明焦点也归位(车库预览无玩家)
    AIW.overSent = false; AIW.byId.clear();
    vcx = innerWidth / 2; vcy = innerHeight / 2;
    spottedLast.clear(); spotStreak.clear(); spotLinger.clear(); lastKnown.clear(); lampT = 0;
    stats = { kills: 0, total: 0, shots: 0, hits: 0, pens: 0, dmg: 0, time: 0 };
  }
  function leaveBattle(keepNet) {
    running = false;                              // 停主循环(看门狗检测 running 也会停)
    if (AIW.on) AIW.worker.postMessage({ t: 'clear' });   // worker 停算上一场的 AI(线程保留复用)
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
    SF.Pickups.reset();   // 清空场上空投与增益状态(下一场 init 重建)
    SF.Net.stopInputLoop();
    // keepNet: 赛后回大厅保留连接与联机身份(MP.mode 不复位), 房间可再战
    if (!keepNet && MP.mode !== 'sp') SF.Net.close();
    if (!keepNet) MP.mode = 'sp';
    MP.tanks.clear(); MP.inputs.clear(); MP.respawn = [];
    SF.Audio.stopBattle();
    document.getElementById('hud').style.display = 'none';
    const ovEl = document.getElementById('overlay');
    ovEl.classList.remove('on', 'settled'); ovEl.style.display = 'none';
  }
  function exitToTitle() {
    leaveBattle(false);
    document.getElementById('btnToGarage').textContent = '返 回 车 库';
    document.getElementById('titleScreen').style.display = 'flex';
    buildGaragePreview();       // 重建车库场景(出击时已销毁)
    setGarageTank(selTank);
  }
  // 联机赛后回车库: 房间与服务端都保留, 换车/重新准备即可再战(替代旧行为"一把后各自重载页面房间解散")
  function backToLobby() {
    leaveBattle(true);
    document.getElementById('btnToGarage').textContent = '返 回 车 库';
    document.getElementById('titleScreen').style.display = 'flex';
    buildGaragePreview();       // 重建车库场景(战斗时已销毁)
    setGarageTank(selTank);
    SF.Lobby.reenter();
  }
  async function startBattle() {
    // 按需补载(懒加载): 地图 + 玩家 + 本等级带敌军车型池
    const pt = TIER_NUM[(SF.CFG.vehicles[selTank] || {}).tier] || 5;
    try {
      await withLoading('部署战场', async (onP) => {
        await SF.Assets.ensureMap(selMap);
        await SF.Assets.ensureTanks([selTank, ...enemyTypesFor([Math.max(1, pt - 1), Math.min(11, pt + 1)])], onP);
      });
    } catch (err) {
      console.error(err);
      alert('资源加载失败: ' + err.message);
      exitToTitle();
      return;
    }
    leaveBattle();
    resetBattleVars();
    await initAIWorker();   // worker 模式决策在独立线程; 失败自动降级主线程
    document.getElementById('titleScreen').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    SF.Audio.init();
    SF.Audio.startEngine();
    SF.Audio.startAmbient();
    buildScene();
    SF.HUD.init(world);
    if (!battleBound) { battleBound = true; bindInput(); bindBus(); }
    // 触屏: 摇杆/按钮 UI 就位(仅 TOUCH 设备实际创建); 桌面继续走指针锁定
    if (TOUCH) {
      ensureTouchUI();
      // 真机尝试全屏 + 锁横屏(Android 支持; iOS Safari 不支持则静默, 由竖屏遮罩兜底提示)
      // 仅自然触屏设备: 桌面 sf_touch=1 只是调试触屏 UI, 不抢全屏; 首触已全屏则跳过
      if (NATIVE_TOUCH && !document.fullscreenElement) {
        const el2 = document.documentElement;
        (el2.requestFullscreen ? el2.requestFullscreen() : Promise.reject())
          .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
          .catch(() => { });
      }
    } else {
      // 出击即锁定鼠标(点击是用户手势); 失败(如浏览器冷却期)不阻断, 点画面可补锁
      try {
        const pr = renderer.domElement.requestPointerLock();
        if (pr && pr.catch) pr.catch(() => { });
      } catch (e) { }
    }
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
    // 尾部 [reloadT, reloadTotal, clipLeft]: 客户端幽灵不跑模拟, 装填读条/弹夹余弹全靠快照对账
    // 量化(x/z/y 0.1m, 角度 0.01rad): 20 人房快照 ~1.1KB@20Hz, 4 房满载出向 ≈ 14Mbps < 40Mbps
    for (const [id, t] of MP.tanks)
      tn[id] = [+t.x.toFixed(1), +t.z.toFixed(1), +t.y.toFixed(1), +t.yaw.toFixed(2), +t.turretYaw.toFixed(2), +t.gunPitch.toFixed(2), +t.speed.toFixed(1), Math.round(t.hp), t.alive ? 1 : 0,
        +t.reloadT.toFixed(1), +(t.reloadTotal || 0).toFixed(1), t.clipLeft | 0];
    const sc = {};
    for (const [id, k] of MP.scores) sc[id] = k;
    const msg = { t: 'snap', st: Math.max(0, Math.round(MP.timeLeft)), tn, sc };
    if (MP.gameMode === 'coop') {
      msg.wv = [waveIdx, world.map.waves.length, (world.map.waves[waveIdx] || {}).name || '',
        [...MP.scores.entries()].filter(([id]) => id < 100).reduce((s2, [, k]) => s2 + k, 0), stats.total];
      const dtMap = {};
      for (const [id] of MP.tanks) if (id < 100)
        for (const e of world.enemies) if (e.alive && e.ai && aiSeen(e) && aiTargetId(e) === id) { dtMap[id] = 1; break; }
      msg.dt = dtMap;
      if (repairT > 0) msg.rp = Math.ceil(repairT);   // 波间维修倒计时: 客户端同样有提示
      msg.pk = SF.Pickups.netList();                  // 场上补给空投(≤3 箱, 客户端对账)
    }
    SF.Net.send(msg);
  }

  /* ---------- 联机: 客户端帧(幽灵插值 + 死亡表现) ---------- */
  function clientFrame(dt) {
    const snap = SF.Net.interpolate(120);
    if (!snap) return;
    const p = world.player;   // 下方幽灵插值/装填对账/点亮共用
    for (const [id, t] of MP.tanks) {
      const pose = snap.poses[id];
      if (pose) {
        t.ghostPose(pose, dt);
        if (t._awaitPose) { t._awaitPose = false; t.group.visible = true; }
      }
    }
    // 本机装填读条: 幽灵不跑模拟, 以主机快照对账(50ms 步进), 帧间本地衰减补匀
    const myPose = snap.poses[MP.myId];
    if (myPose) {
      const wasLoading = p.reloadT > 0;
      const al = p.spec.gun.autoloader;
      p.reloadT = myPose.reloadT;
      p.reloadTotal = myPose.reloadTotal || p.spec.gun.reload;
      p.clipLeft = myPose.clipLeft || 0;
      p.clipPhase = !al ? 'single' : (p.clipLeft >= al.clip ? 'long' : 'intra');   // 名字面义: 快照时刻处于哪段装填
      p.reloadT = Math.max(0, p.reloadT - dt);   // 下一帧快照到来前本地走秒
      if (wasLoading && p.reloadT === 0 && myPose.reloadT <= 0.1)
        SF.Bus.emit('reloaded', { tank: p });    // 装填完成的音效/语音(bindBus 按弹夹阶段过滤, 与主机同规则)
    }
    MP.timeLeft = snap.timeLeft;
    if (snap.scores) for (const id in snap.scores) MP.scores.set(+id, snap.scores[id]);
    if (snap.wv) MP.waveInfo = { idx: snap.wv[0], total: snap.wv[1], name: snap.wv[2], kills: snap.wv[3], totalEnemies: snap.wv[4] };
    if (MP.gameMode === 'coop') {
      // 补给空投(客户端): 快照对账场上空投 + 本地玩家增益计时(数值以主机为准, 本地只管表现)
      SF.Pickups.update(dt, { authority: false, gameOver, humans: [world.player] });
      if (snap.pk) SF.Pickups.onSnapshot(snap.pk);
    }
    // 波间维修(主机快照下发): 常驻倒计时; 结束瞬间收尾提示(客户端收不到主机的"第 N 波"消息, 需自己收尾)
    if (snap.rp) { SF.HUD.showMsg(`${world.map.repairBetweenWaves.text} ${snap.rp}s`, 0); repairMsgOn = true; }
    else if (repairMsgOn) { repairMsgOn = false; SF.HUD.showMsg('维修完成', 1.5); }
    // 点亮: 主机裁决(dt 表)分发; 小地图红点用本地 视距×(1-隐蔽)+通视+50m 强制
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
    // 与主机同一套模型显示判定(点亮 或 炮口焰暴露): 之前客户端从不隐藏未点亮敌军, 主/客表现不一致
    for (const e of world.enemies) e.group.visible = !e.alive || spotDisplay(e);
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
    // 阵营死斗: 红蓝总分 + 我的击杀(20 人房不再逐人列名)
    let r = 0, b = 0;
    for (const [id, k] of MP.scores) {
      const pl = MP.players.find(q => q.id === id);
      if (!pl) continue;
      if (pl.team === 1) b += k; else r += k;
    }
    el.textContent = `⏱ ${mm}:${ss}　红军 ${r} : ${b} 蓝军　我的击杀 ${MP.scores.get(MP.myId) || 0}`;
    el.style.display = 'block';
  }

  /* ---------- 联机事件中继: 主机转发 Bus 事件, 客户端还原成本地事件 ---------- */
  function proxyTank(id) {
    if (!id) return null;   // 无射手事件(坠落摔伤等)
    const t = MP.tanks.get(id);
    const fake = { isPlayer: id === MP.myId, x: t ? t.x : 0, z: t ? t.z : 0, pos3: t ? t.pos3 : new THREE.Vector3(), spec: { name: t ? t.spec.name : '?' } };
    return fake;
  }
  function bindMpRelay() {
    // 主机: 本地事件 → 序列化广播
    SF.Bus.on('fire', (e) => { if (MP.mode !== 'host') return; SF.Net.send({ t: 'ev', k: 'fire', d: { id: e.tank.netId, p: [e.pos.x, e.pos.y, e.pos.z] } }); });
    SF.Bus.on('hit', (r) => {
      if (MP.mode !== 'host') return;
        SF.Net.send({ t: 'ev', k: 'hit', d: { s: r.shooter ? r.shooter.netId : 0, g: r.target.netId, kind: r.kind, dmg: r.dmg, module: r.module || 0, p: [r.point.x, r.point.y, r.point.z] } });
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
        if (tk) tk.lastFireT = world.time;   // 炮口焰暴露: 客户端也要记录, 模型显示/红点/名牌才与主机一致
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
      } else if (m.k === 'pkGet') {
        const pl = MP.players.find(q => q.id === d.by);
        SF.Pickups.onCollect(d, d.by === MP.myId, pl ? pl.name : '队友');
      }
    });
    SF.Net.on('end', (m) => {
      gameOver = true;
      const rows = m.scores.map(([id, name, k]) => `<div style="color:${id === MP.myId ? '#ffd97a' : '#b9bfa8'}">${id === MP.myId ? '★ ' : ''}${name} — ${k} 击杀</div>`).join('');
      SF.HUD.showOverlay();
      document.getElementById('endTitle').textContent = m.win ? '✓ 任务完成' : '对战结束';
      document.getElementById('endTitle').style.color = m.win ? '#8fd98f' : '#d8c887';
      document.getElementById('endStats').innerHTML = `<div style="font-size:20px;line-height:2.2">${rows}</div>`;
      document.getElementById('btnRetry').style.display = 'none';   // 联机结算: 单一再战按钮, 走返回房间
      document.getElementById('btnToGarage').textContent = '返 回 车 库';
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
    document.getElementById('btnRetry').style.display = 'none';   // 联机结算: 单一再战按钮, 走返回房间
    document.getElementById('btnToGarage').textContent = '返 回 车 库';
    SF.Net.stopInputLoop();
  }

  /* ---------- 联机开局: 房主/加入者共用 ---------- */
  async function startMultiplayer(role, init) {
    resetBattleVars();   // 赛后房间再战: 清上一局点亮残留/六感灯/统计(world.time 归零后旧时间戳永不过期)
    MP.mode = role;
    MP.myId = init.you;
    MP.players = init.players;
    MP.mapId = init.map || 'l01';
    MP.gameMode = init.mode === 'coop' ? 'coop' : 'dm';
    MP.waveInfo = null; MP.aiId = 100;
    MP.tanks.clear(); MP.inputs.clear(); MP.respawn = []; MP.scores.clear();   // 赛后房间再战: 清上一场残留
    for (const pl of MP.players) MP.scores.set(pl.id, 0);
    selTank = (init.players.find(pl => pl.id === init.you) || {}).tank || 'sherman';
    // 按需补载(懒加载): 地图 + 参战玩家坦克(+ 合作主机的敌军车型池)
    try {
      const pt0 = Math.max(0, ...MP.players.map(pl => TIER_NUM[(SF.CFG.vehicles[pl.tank] || {}).tier] || 5));
      await withLoading('加入战斗', async (onP) => {
        await SF.Assets.ensureMap(MP.mapId);
        const tanks = MP.players.map(pl => pl.tank);
        if (MP.gameMode === 'coop' && role === 'host')
          tanks.push(...enemyTypesFor([Math.max(1, pt0 - 1), Math.min(11, pt0 + 1)]));
        await SF.Assets.ensureTanks(tanks, onP);
      });
    } catch (err) {
      console.error(err);
      alert('资源加载失败: ' + err.message);
      location.reload();
      return;
    }
    disposeGarage();
    document.getElementById('titleScreen').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    SF.Audio.init(); SF.Audio.startEngine(); SF.Audio.startAmbient();

    const mapSel = SF.CFG.maps.find(m => m.id === MP.mapId) || SF.CFG.maps[0];
    selMap = mapSel.id;
    selTank = (init.players.find(pl => pl.id === init.you) || {}).tank || 'sherman';

    // 场景: coop 主机保留波次流程(主机跑 AI), 其余关闭单机流程
    if (!(MP.gameMode === 'coop' && role === 'host')) { spawnWave = () => { }; checkWave = () => { }; }
    await initAIWorker();   // coop 主机的 AI 决策也走 worker(失败降级主线程)
    buildScene();

    // 死斗出生池: 地图中心外围 24 点环形(红蓝各占半侧, 同队同侧出发), 掩体推挤 + 地形校验
    MP.spawnPool = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      let sx = Math.cos(a) * 310, sz = Math.sin(a) * 310;
      [sx, sz] = world.covers.collide(sx, sz, 3);
      const spot = findSpawnSpot(sx, sz);
      if (spot) [sx, sz] = world.covers.collide(spot[0], spot[1], 3);
      MP.spawnPool.push([sx, sz]);
    }

    // 移除 buildScene 创建的单机默认玩家
    scene.remove(world.player.group);

    // 建坦克: 主机=真实模拟; 客户端=幽灵(不 update); 死斗按服务器阵营红/蓝分侧出生
    const half = MP.spawnPool.length >> 1;
    const seq = [0, 0];
    for (const pl of MP.players) {
      const team = MP.gameMode === 'coop' ? 0 : (pl.team === 1 ? 1 : 0);
      const sp = MP.gameMode === 'coop'
        ? MP.spawnPool[(seq[0]++) % MP.spawnPool.length]
        : MP.spawnPool[team * half + (seq[team]++) % half];   // 己方半侧顺序取点, 20 人内不重叠
      const isMe = pl.id === MP.myId;
      const t = new SF.Tank(pl.tank, {
        x: sp[0], z: sp[1], yaw: Math.atan2(-sp[0], -sp[1]),   // 朝地图中心(修北半场池点恒朝北背对全场的不对等)
        netId: pl.id, team,
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
    if (MP.gameMode === 'coop') for (const [id, t] of MP.tanks) if (id < 100) SF.Pickups.attachTank(t);   // 补给增益基线
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
      // DM 客户端: 准星可吸附"敌方"坦克(同阵营是队友, 不进敌列表不被点亮隐藏)
      if (role === 'client') {
        const myTeam = world.player.team;
        for (const [id, t] of MP.tanks) if (id !== MP.myId && t.team !== myTeam) world.enemies.push(t);
      }
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
