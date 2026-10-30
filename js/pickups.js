// pickups.js — PVE 补给空投(仅单机战役 sp / 合作闯关 coop; 死斗不出)
// 随机定时空投奖励包(维修/引擎/炮控/机动/输弹), 开车碾过木箱即拾取。
// 生成与拾取判定只在权威端跑(单机=本机, 合作=主机); 客户端由 20Hz 快照对账还原场上空投 + 拾取事件触发本地增益。
// 增益实现: 战斗开始克隆 baseSpec, buff 增减时从 base 重算 spec —— vehicle.js 每帧读 spec, 核心车辆代码零改动。
window.SF = window.SF || {};

SF.Pickups = (() => {
  const U = SF.Util;
  const C = () => SF.CFG.pickups;

  // 奖励类型: 3D 色环/光柱/图标、HUD 芯片与小地图同色
  const TYPES = {
    repair:   { name: '战地维修', col: 0x7fe08a, css: '#7fe08a' },
    speed:    { name: '引擎过载', col: 0xffd35e, css: '#ffd35e' },
    aim:      { name: '炮控校准', col: 0x6fd6ff, css: '#6fd6ff' },
    mobility: { name: '履带润滑', col: 0xb39aff, css: '#b39aff' },
    load:     { name: '输弹强化', col: 0xff9a5e, css: '#ff9a5e' }
  };
  const TYPE_IDX = ['repair', 'speed', 'aim', 'mobility', 'load'];   // 网络传输用下标
  const colV = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];

  let world = null, scene = null, fx = null;
  let list = [];               // 场上空投 [{id,type,x,z,gy,fallY,life,landed,group,chute,spr}]
  let nextId = 1;
  let spawnT = 0, battleT = 0, announced = false;

  /* ---------- 图标(64×64 canvas 白色描稿; 3D 贴图与 HUD <img> 同源, 材质/样式上色) ---------- */
  const iconTex = {}, iconURL = {};
  function iconOf(type) {
    if (iconTex[type]) return iconTex[type];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.strokeStyle = c.fillStyle = '#fff'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
    c.translate(32, 32);
    if (type === 'repair') {                     // 十字
      c.fillRect(-7, -21, 14, 42); c.fillRect(-21, -7, 42, 14);
    } else if (type === 'speed') {               // 闪电
      c.beginPath(); c.moveTo(8, -24); c.lineTo(-8, 4); c.lineTo(-1, 4); c.lineTo(-7, 24); c.lineTo(10, -2); c.lineTo(2, -2); c.closePath(); c.fill();
    } else if (type === 'aim') {                 // 准星
      c.beginPath(); c.arc(0, 0, 15, 0, 7); c.stroke();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; c.beginPath(); c.moveTo(Math.sin(a) * 20, -Math.cos(a) * 20); c.lineTo(Math.sin(a) * 27, -Math.cos(a) * 27); c.stroke(); }
      c.beginPath(); c.arc(0, 0, 3.4, 0, 7); c.fill();
    } else if (type === 'mobility') {            // 回转箭头
      const a1 = 1.05 * Math.PI;
      c.beginPath(); c.arc(0, 0, 16, -0.35 * Math.PI, a1); c.stroke();
      const ex = Math.cos(a1) * 16, ey = Math.sin(a1) * 16, ta = a1 + Math.PI / 2;
      c.beginPath();
      c.moveTo(ex + Math.cos(ta) * 10, ey + Math.sin(ta) * 10);
      c.lineTo(ex - Math.cos(ta) * 10, ey - Math.sin(ta) * 10);
      c.lineTo(ex - Math.cos(a1) * 14, ey - Math.sin(a1) * 14);
      c.closePath(); c.fill();
    } else {                                     // 炮弹
      c.beginPath(); c.moveTo(-8, 26); c.lineTo(-8, -4); c.arc(0, -4, 8, Math.PI, 0); c.lineTo(8, 26); c.closePath(); c.fill();
    }
    iconTex[type] = new THREE.CanvasTexture(cv);
    iconURL[type] = cv.toDataURL();
    return iconTex[type];
  }

  /* ---------- 场景模型: 木箱 + 类型色环带 + 地面圈 + 落点光柱 + 浮动图标 + 降落伞 ---------- */
  function buildModel(type) {
    const T = TYPES[type];
    const g = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x6b5a38, roughness: 0.9 }));
    crate.position.y = 0.62; crate.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.34, 1.84),
      new THREE.MeshBasicMaterial({ color: T.col }));
    band.position.y = 0.62;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.3, 26),
      new THREE.MeshBasicMaterial({ color: T.col, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.95, 26, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: T.col, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 13.4;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconOf(type), color: T.col, transparent: true, depthWrite: false, depthTest: false }));
    spr.scale.set(2.6, 2.6, 1); spr.position.y = 4.4; spr.renderOrder = 5;
    const chute = new THREE.Mesh(new THREE.SphereGeometry(2.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xcfc7a8, side: THREE.DoubleSide }));
    chute.position.y = 4.0;
    g.add(crate, band, ring, beam, spr, chute);
    return { group: g, chute, spr };
  }

  function create(id, type, x, z) {
    const m = buildModel(type);
    const gy = world.terrain.heightAt(x, z);
    m.group.position.set(x, gy, z);
    if (scene) scene.add(m.group);
    const p = { id, type, x, z, gy, fallY: C().dropDist, life: C().lifetime, landed: false, ...m };
    list.push(p);
    return p;
  }
  function remove(p) {
    if (scene) scene.remove(p.group);
    const i = list.indexOf(p);
    if (i >= 0) list.splice(i, 1);
  }

  /* ---------- 权威端: 落点(玩家周围环形随机; 坡度与出生校验同阈值 —— 车要开得过去) ---------- */
  function dropPoint(tank) {
    const T = world.terrain, [r0, r1] = C().spawnRing;
    const lim = Math.tan(SF.CFG.sim.maxSlope) * 0.96;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      let x = U.clamp(tank.x + Math.sin(a) * r, -T.half + 20, T.half - 20);
      let z = U.clamp(tank.z + Math.cos(a) * r, -T.half + 20, T.half - 20);
      if (T.gradAt(x, z) > lim) continue;
      [x, z] = world.covers.collide(x, z, 2.4);          // 推出掩体/房子
      if (T.gradAt(x, z) > lim) continue;                // 推挤后复核
      return [x, z];
    }
    return null;   // 玩家周围实在没平地(山腰/壕区): 本轮放弃, 计时器照常走
  }

  // 类型抽取: 权重 + 需求感知 —— 缺血/带永久损伤时维修包更容易出, 状态好时几乎不浪费
  function pickType(tank) {
    const W = { ...C().weights };
    const hurt = tank.hp < tank.spec.hp * 0.5 || tank.modules.engine > 0 || tank.modules.gun > 0 || tank.modules.ammo > 0;
    if (hurt) W.repair *= C().needRepairMul;
    else if (tank.hp >= tank.spec.hp - 0.5 && !tank.modules.track) W.repair *= C().fullHpMul;
    let sum = 0; for (const k in W) sum += W[k];
    let r = Math.random() * sum;
    for (const k in W) { r -= W[k]; if (r <= 0) return k; }
    return 'speed';
  }

  /* ---------- 增益: 挂基线 + 从 baseSpec 重算(与 PVE 修改器倍率乘法叠加) ---------- */
  function attachTank(t) {
    if (!t._pkBase) t._pkBase = JSON.parse(JSON.stringify(t.spec));
    if (!t._buffs) t._buffs = {};
  }
  function recompute(t) {
    const b = t._pkBase, s = t.spec, E = C().effects;
    if (!b) return;
    const lv = (k) => (t._buffs && t._buffs[k]) ? t._buffs[k].lv : 0;
    s.maxSpeed = b.maxSpeed * Math.pow(E.speed.maxSpeed, lv('speed'));
    s.accel = b.accel * Math.pow(E.speed.accel, lv('speed'));
    s.hullTraverse = b.hullTraverse * Math.pow(E.mobility.traverse, lv('mobility'));
    s.turretTraverse = b.turretTraverse * Math.pow(E.mobility.traverse, lv('mobility'));
    s.dispersion.aimTime = b.dispersion.aimTime * Math.pow(E.aim.aimTime, lv('aim'));
    s.dispersion.base = b.dispersion.base * Math.pow(E.aim.base, lv('aim'));
    s.gun.reload = b.gun.reload * Math.pow(E.load.reload, lv('load'));
    if (b.gun.autoloader && s.gun.autoloader) {
      s.gun.autoloader.intra = b.gun.autoloader.intra * Math.pow(E.load.reload, lv('load'));
      s.gun.autoloader.long = b.gun.autoloader.long * Math.pow(E.load.reload, lv('load'));
    }
  }

  // 拾取生效: 权威端与被拾取者本地各跑一次, 数值一致; 表现(消息/音效/特效)只给本地玩家
  function applyTo(tank, type) {
    const T = TYPES[type];
    if (type === 'repair') {
      const heal = Math.round(tank.spec.hp * C().repairHeal);
      const got = Math.max(0, Math.round(Math.min(tank.spec.hp, tank.hp + heal) - tank.hp));
      tank.hp = Math.min(tank.spec.hp, tank.hp + heal);
      tank.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
      if (tank.isPlayer) {
        SF.HUD.showMsg(`${T.name} +${got} HP · 模块全修复`, 2.5);
        SF.HUD.dmgNumber(new THREE.Vector3(tank.x, tank.y + 2.6, tank.z), `+${got}`, T.css);
      }
    } else {
      attachTank(tank);
      const b = tank._buffs[type] || (tank._buffs[type] = { lv: 0, t: 0 });
      b.lv = Math.min(C().maxStack, b.lv + 1);
      b.t = C().buffDur;
      recompute(tank);
      if (tank.isPlayer) SF.HUD.showMsg(`${T.name} ×${b.lv} · ${b.t}秒`, 2.5);
    }
    if (tank.isPlayer) {
      SF.HUD.log(`拾取补给：${T.name}`, T.css);
      SF.Audio.play('beep', null, { gain: 1.2, rate: 1.55 });
      SF.Audio.playVoice('v_supply');
      if (fx) {
        const at = new THREE.Vector3(tank.x, tank.y + 1.4, tank.z);
        fx.flash(at, 3, T.col);
        fx.burst(at, colV(T.col), 10, 4, 0.9);
      }
    }
  }

  /* ---------- 主更新: 动画/寿命(两端共用) + 生成/拾取/buff 计时(权威端) ---------- */
  function update(dt, opts) {
    battleT += dt;
    const cfg = C();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (!p.landed) {                       // 空降: 落伞摆动 → 触地扬尘
        p.fallY -= cfg.fallSpeed * dt;
        p.chute.rotation.z = Math.sin(battleT * 2.2 + p.id) * 0.13;
        if (p.fallY <= 0) {
          p.landed = true; p.fallY = 0;
          p.chute.visible = false;
          if (fx) {
            fx.burst(new THREE.Vector3(p.x, p.gy + 0.8, p.z), [0.5, 0.45, 0.38], 14, 5, 0.7);
            fx.flash(new THREE.Vector3(p.x, p.gy + 1.2, p.z), 2.6, TYPES[p.type].col);
          }
          SF.Audio.play('explosion', { x: p.x, y: p.gy, z: p.z }, { gain: 0.16, rate: 1.7, atten: 70 });
        }
        p.group.position.y = p.gy + p.fallY;
      } else {
        p.life -= dt;
        if (p.life <= 0) { remove(p); continue; }
        p.spr.position.y = 4.4 + Math.sin(battleT * 2 + p.id) * 0.35;   // 图标浮动
      }
      p.group.visible = p.landed && p.life < 8 ? (battleT * 5 % 1) < 0.62 : true;   // 将消失闪烁
    }
    if (!opts) return;
    if (opts.authority && !opts.gameOver && world) {
      const humans = (opts.humans || []).filter(t => t && t.alive);
      spawnT -= dt;
      if (spawnT <= 0) {
        if (list.length < cfg.maxOnField && humans.length) {
          const tank = humans[(Math.random() * humans.length) | 0];
          const pt = dropPoint(tank);
          if (pt) {
            create(nextId++, pickType(tank), pt[0], pt[1]);
            if (!announced) {
              announced = true;
              SF.HUD.showMsg('📦 补给空投！开过去碾过木箱即可拾取', 4);
              SF.HUD.log('指挥部空投补给，注意小地图标记', '#ffd97a');
              SF.Audio.playVoice('v_supply');
            }
          }
        }
        spawnT = cfg.interval[0] + Math.random() * (cfg.interval[1] - cfg.interval[0]);
      }
      for (let i = list.length - 1; i >= 0; i--) {       // 拾取判定: 落地后, 车身接触
        const p = list[i];
        if (!p.landed) continue;
        for (const t of humans) {
          if (U.dist2d(t.x, t.z, p.x, p.z) < cfg.radius + t.cr) {
            applyTo(t, p.type);
            if (opts.send) opts.send({ t: 'ev', k: 'pkGet', d: { id: p.id, by: t.netId || 0, type: p.type } });
            remove(p);
            break;
          }
        }
      }
    }
    // buff 计时: 权威端=全部人类坦克(参与模拟), 客户端=本地玩家(只管 HUD 倒计时), 各自走时误差<1s 无感
    for (const t of (opts.humans || [])) {
      if (!t || !t._buffs) continue;
      let dirty = false;
      for (const k in t._buffs) {
        const b = t._buffs[k];
        b.t -= dt;
        if (b.t <= 0) { delete t._buffs[k]; dirty = true; }
      }
      if (dirty) recompute(t);
    }
  }

  /* ---------- 客户端(coop): 快照对账 + 拾取事件 ---------- */
  function onSnapshot(pk) {
    if (!Array.isArray(pk) || !world) return;
    const have = new Map(list.map(p => [p.id, p]));
    const ids = new Set();
    for (const it of pk) {
      const id = it[0], ti = TYPE_IDX[it[1]] || 'speed';
      ids.add(id);
      if (!have.has(id)) create(id, ti, it[2], it[3]);
    }
    for (const p of [...list]) if (!ids.has(p.id)) remove(p);
  }
  function onCollect(d, mine, byName) {
    const p = list.find(q => q.id === d.id);
    if (p) remove(p);
    if (mine && world) applyTo(world.player, d.type);
    else SF.HUD.log(`${byName || '队友'} 拾取了 ${TYPES[d.type].name}`, TYPES[d.type].css);
  }

  /* ---------- 状态出口 ---------- */
  function netList() { return list.map(p => [p.id, TYPE_IDX.indexOf(p.type), +p.x.toFixed(1), +p.z.toFixed(1)]); }
  function uiList() { return list.map(p => ({ x: p.x, z: p.z, css: TYPES[p.type].css })); }
  function playerBuffs(t) {
    if (!t || !t._buffs) return [];
    return Object.entries(t._buffs).map(([k, b]) => {
      iconOf(k);
      return { type: k, name: TYPES[k].name, css: TYPES[k].css, lv: b.lv, t: Math.ceil(b.t), icon: iconURL[k] };
    });
  }

  function init(w, s, f) {
    world = w; scene = s; fx = f;
    list = []; nextId = 1; battleT = 0; announced = false;
    spawnT = C().firstDelay;
  }
  function reset() {
    for (const p of [...list]) remove(p);
    list = []; spawnT = 0; battleT = 0; announced = false;
    world = scene = fx = null;
  }

  return {
    init, reset, attachTank, update, applyTo, onSnapshot, onCollect,
    netList, uiList, playerBuffs, TYPES,
    get list() { return list; },
    debug: { spawn(type, x, z) { return world && create(nextId++, type, x, z); } }   // 测试钩子
  };
})();
