// srv-sim.js — 服务器权威死斗仿真房实例(阶段3; 零 THREE/零 DOM, Node vm 与浏览器双栖)
//
// 服务端权威的核心: 每间 dm 房一个实例, 60Hz 定步长跑车辆数值模拟(sim-engine)+部位 OBB 判伤
// (阶段2), 20Hz 出同构快照(tn 14 字段行 + sc + st, 与 main.js hostSnapshot 逐字段一致,
// 路尾两字段 bodyPitch/bodyRoll = 车体俯仰/侧滚: 联机早期快照不透传这俩, 客户端幽灵
// this.pitch/roll 恒 0 导致远程坦克永远水平不贴地形; net.js interpolate 补 lerp)。
// 玩家只上行 30Hz 输入(net.js 30Hz 5 元组原样, 这里 clamp:
// 油门/舵机 ∈[-1,1], 瞄准角归一 [-π,π], 俯仰钳到车 spec 射界 —— 设计 §3.4)。
// 死斗重生队列/时限/计分/结算条件都在实例内; 房主掉线不再影响对局(这是本次迁移的目的)。
// 阶段4: coop 全权威段 —— 波次生成(main.js spawnWave/checkWave 权威子集)/波间维修 repairT/
// 补给空投(pickups.js 权威子集: 投放节奏/落点/类型权重/拾取/增益)/AI 直读本实例 engine 状态
// (SF.AI 在房间 vm 上下文内实例化, world 为本实例世界, 无 10Hz 快照副本)——
// coop 快照追加 wv/dt/rp/pk 四字段(main.js hostSnapshot 同构), 客户端 coop 分支零改动。
//
// 地图数据(评审修改要求#1, 阶段1 交付): 高程 Float32Array + map.json 由 server.js 读文件注入,
// 本模块只做 纯数据 → 模拟世界(makeTerrain/coverCol/circleCollide) 的组装。
// 出生池(评审修改要求#5): main.js 死斗出生池的服务器侧重建 —— 24 点环(半径310) + 圆碰撞推挤 +
// spawnDiskOk/spawnPtOk/findSpawnSpot 螺旋找平地 + 种子半侧洗牌, 语义与 main.js:1978-1994 一致。
window.SF = window.SF || {};
SF.SrvSim = (() => {

  /* ---------- 掩体碰撞表(models.js buildCover 纯数据子集, 与 tools/ai-bench.js coverCol 同款) ---------- */
  function coverCol(c) {
    const s = c.scale || 1;
    const OBB = (hx, hz) => ({ shape: 'box', hx, hz, yaw: c.yaw || 0, r: Math.hypot(hx, hz) });
    let col = { type: c.type, blocksMove: true, blocksShells: true, x: c.x, z: c.z, r: 2, h: 3, shape: 'circle', yaw: c.yaw || 0 };
    switch (c.type) {
      case 'house': Object.assign(col, OBB(3.5 * s, 2.75 * s), { h: 3.4 + 1.8 * s }); break;
      case 'barn': Object.assign(col, OBB(5.5 * s, 3.75 * s), { h: 5 + 2.2 * s }); break;
      case 'ruin': Object.assign(col, OBB(3.2 * s, 2.4 * s), { h: 4.5 }); break;
      case 'wall': Object.assign(col, OBB(3.5 * s, 0.35 * s), { h: 3.1 }); break;
      case 'hedge': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
        Object.assign(col, OBB(3.0 * s, 1.1 * s), { h: 3.2 }); break;
      case 'haystack': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
        col.r = 2.6 * s; col.h = 3.6 * s; break;
      case 'tree': col.blocksShells = false; col.r = 0.9; col.h = 1.6; break;
      case 'trap': col.blocksShells = false; col.r = 1.2; col.h = 1.2; break;
      case 'wreck': col.blocksShells = false; col.blocksSpot = true;
        Object.assign(col, OBB(1.75, 3.1), { h: 2.4 }); break;
      case 'bush': col.blocksMove = col.blocksShells = false; col.blocksSpot = true;
        col.r = 1.6 * s; col.h = 1.9; break;
      case 'rock': col.r = 2.5 * s; col.h = 3.3 * s; break;
    }
    return col;
  }

  /* 圆 vs 掩体推出(models.js CoverField.collide 逐行移植; 出生点推挤用) */
  function circleCollide(list, x, z, radius) {
    let nx = x, nz = z;
    for (const c of list) {
      if (!c.blocksMove) continue;
      if (c.shape === 'box') {
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const px = nx - c.x, pz = nz - c.z;
        let lx = cs * px - sn * pz, lz = sn * px + cs * pz;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ddx = lx - qx, ddz = lz - qz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > radius * radius) continue;
        if (d2 < 1e-6) {
          if (c.hx - Math.abs(lx) < c.hz - Math.abs(lz)) lx = (lx >= 0 ? c.hx + radius : -c.hx - radius);
          else lz = (lz >= 0 ? c.hz + radius : -c.hz - radius);
        } else {
          const d = Math.sqrt(d2);
          lx = qx + ddx / d * radius; lz = qz + ddz / d * radius;
        }
        nx = c.x + cs * lx + sn * lz; nz = c.z - sn * lx + cs * lz;
      } else {
        const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), min = c.r + radius;
        if (d < min && d > 0.001) { nx = c.x + dx / d * min; nz = c.z + dz / d * min; }
      }
    }
    return [nx, nz];
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- 坦克状态桩(netId 键控, 字段集 = engine 读写清单, 与 SF.Tank 同形) ---------- */
  function makeTank(pl, opts) {
    const spec = SF.CFG.vehicles[pl.tank] || SF.CFG.vehicles.sherman;
    const _al = spec.gun.autoloader;
    return {
      type: pl.tank, spec, netId: pl.id, name: pl.name || ('#' + pl.id),
      x: opts.x, z: opts.z, y: 0, yaw: opts.yaw,
      speed: 0, velX: 0, velZ: 0, lastYawRate: 0, lastTurretRate: 0,
      turretYaw: opts.yaw, gunPitch: 0, pitch: 0, roll: 0, trackOffset: 0,
      gear: 'D1', shiftT: 0, flipT: 0, _yInit: false, _fallV: 0, _ramT: -9,
      hp: spec.hp, alive: true,
      reloadT: 1, reloadTotal: 1,
      clipLeft: _al ? _al.clip : 0, clipPhase: _al ? 'intra' : 'single',
      disp: spec.dispersion.max,
      modules: { track: 0, engine: 0, gun: 0, ammo: 0 },
      parts: { noTurret: spec.gunArc !== undefined },
      team: pl.team === 1 ? 1 : 0,
      isPlayer: false, lastFireT: -99,
      stats: { shots: 0, hits: 0, pens: 0, dmgDealt: 0 },
      input: { throttle: 0, steer: 0, aimYaw: opts.yaw, aimPitch: 0, fire: false },
    };
  }

  /* ---------- 注入裁判: OBB 部位命中(与浏览器 combat.js 同一实现) + takeHit/takeRam 数值结算 ---------- */
  function makeJudge(dispatch) {
    const G = (typeof globalThis !== 'undefined') ? globalThis : null;   // vm 上下文 = 调试计数器挂点(admin 可读)
    return {
      probeTank(sh, tk, ox, oy, oz, dx, dy, dz, segLen) {
        if (G) { G.__j = G.__j || { probes: 0, hits: 0, nulls: 0, lastNull: '' };
          G.__j.probes++;
          const r = SF.SimEngine.probeTankOBB(tk, ox, oy, oz, dx, dy, dz, segLen);
          if (r) G.__j.hits++; else { G.__j.nulls++; if (G.__j.nulls <= 3) G.__j.lastNull = `tk=${tk.type} tkY=${(tk.y || 0).toFixed(1)} shY=${oy.toFixed(1)} dist=${Math.hypot(tk.x - ox, tk.z - oz).toFixed(0)}`; }
          return r;
        }
        return SF.SimEngine.probeTankOBB(tk, ox, oy, oz, dx, dy, dz, segLen);
      },
      // vehicle.js takeHit 可计算子集(阶段2 起由引擎直出 hit/destroyed —— 评审修改要求#6 的阶段2形态)
      onHitTank(sh, tk, hit, segDir) {
        if (!tk.alive) return;
        const A = SF.CFG.armor;
        const incidence = Math.acos(Math.min(1, Math.max(-1, -(hit.normal.x * segDir.x + hit.normal.y * segDir.y + hit.normal.z * segDir.z))));
        const armor = hit.armor || 0, cal = sh.cal;
        const over3 = armor > 0 && cal > armor * 3;
        let norm = 5 * Math.PI / 180;
        if (armor > 0 && cal > armor * 2) norm *= 2;
        const eff = armor / Math.max(Math.cos(Math.max(0, incidence - norm)), 0.05);
        const pen = sh.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
        const rico = armor > 0 && !over3 && incidence > A.ricochetAngle;
        const res = { target: tk, shooter: sh.owner, point: hit.point, zone: hit.zone, dmg: 0, kind: 'nopen', module: null };
        sh.owner.stats.hits++;
        if (hit.zone === 'gun') {
          tk.modules.gun = Infinity; res.kind = 'gun'; res.module = 'gun';   // 炮管吸收: 火炮损(永久)
        } else if (hit.zone === 'tracks') {
          tk.modules.track = A.modules.track.duration; res.module = 'track';
          if (rico) res.kind = 'bounce';
          else if (pen >= eff) { res.kind = 'pen'; res.dmg = Math.round(sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance)); }
          else res.kind = 'absorb';
        } else if (rico) res.kind = 'bounce';
        else if (pen >= eff) {
          res.kind = 'pen';
          let dmg = sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance);
          if (Math.random() < A.modules.ammo.chance) { dmg *= A.modules.ammo.dmgMult; res.module = 'ammo'; tk.modules.ammo = Infinity; }
          else if (hit.zone === 'hullRear' && Math.random() < A.modules.engine.rearChance) { res.module = 'engine'; tk.modules.engine = Infinity; }
          res.dmg = Math.round(dmg);
        }
        if (res.kind === 'pen') { tk.hp -= res.dmg; sh.owner.stats.pens++; sh.owner.stats.dmgDealt += res.dmg; }
        if (tk.hp <= 0 && tk.alive) { tk.hp = 0; tk.alive = false; dispatch('kill', { id: tk.netId, by: sh.owner.netId, p: [tk.x, tk.y + 1, tk.z] }); }
        dispatch('hit', { s: sh.owner.netId, g: tk.netId, kind: res.kind, dmg: res.dmg, module: res.module || 0, p: [hit.point.x, hit.point.y, hit.point.z] });
      },
      // 撞击承伤(vehicle.js takeRam 数值子集)
      takeRam(target, shooter, dmg) {
        if (!target.alive || dmg <= 0) return;
        target.hp -= dmg;
        if (target.hp <= 0 && target.alive) { target.hp = 0; target.alive = false; dispatch('kill', { id: target.netId, by: shooter.netId, p: [target.x, target.y + 1, target.z] }); }
        dispatch('hit', { s: shooter.netId, g: target.netId, kind: 'ram', dmg, module: 0, p: [target.x, target.y + 1, target.z] });
      },
    };
  }

  /* ---------- 房实例 ---------- */
  function create(opts) {
    // opts: {heights, terrainCfg, coversRaw, seed, timeLimit=180, players:[{id,name,tank,team}],
    //        onEvent(k,d), onEnd(scoreRows)}
    const T = SF.Sim.makeTerrain(opts.heights, opts.terrainCfg);
    const coversList = (opts.coversRaw || []).map(coverCol);
    const rng = mulberry32((opts.seed >>> 0) || 1);
    // dispatch: 模拟 → 房间外的事件出口(kill 分支同时记账+排队重生; 先指基础出口, 尾部换成全功能版)
    let dispatch = (k, d) => { if (opts.onEvent) opts.onEvent(k, d); };

    /* 出生池: main.js 死斗池的服务器侧重建 */
    const SPAWN_G = Math.tan(SF.CFG.sim.maxSlope) * 0.96;
    const spawnPtOk = (x, z) => {
      if (T.gradAt(x, z) > SPAWN_G) return false;
      const hC = T.heightAt(x, z);   // 反壕沟: 四向 14m 高差夹谷(main.js spawnGroove 同语义)
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 4, dx = Math.sin(a) * 14, dz = Math.cos(a) * 14;
        if (T.heightAt(x + dx, z + dz) > hC + 3 && T.heightAt(x - dx, z - dz) > hC + 3) return false;
      }
      return true;
    };
    const spawnDiskOk = (x, z) => {
      for (let dz = -11; dz <= 11; dz += 5)
        for (let dx = -11; dx <= 11; dx += 5)
          if (dx * dx + dz * dz <= 121 && !spawnPtOk(x + dx, z + dz)) return false;
      return true;
    };
    const findSpawnSpot = (x, z) => {
      if (spawnDiskOk(x, z)) return [x, z];
      for (let r = 12; r <= 108; r += 12)
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2 + (r / 12) * 0.3;
          const cx = SF.Util.clamp(x + Math.cos(a) * r, -T.half + 20, T.half - 20);
          const cz = SF.Util.clamp(z + Math.sin(a) * r, -T.half + 20, T.half - 20);
          if (spawnDiskOk(cx, cz)) return [cx, cz];
        }
      return null;
    };
    const pool = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      let sx = Math.cos(a) * 310, sz = Math.sin(a) * 310;
      [sx, sz] = circleCollide(coversList, sx, sz, 3);
      const spot = findSpawnSpot(sx, sz);
      if (spot) [sx, sz] = circleCollide(coversList, spot[0], spot[1], 3);
      pool.push([sx, sz]);
    }
    const half = pool.length >> 1;
    const poolSide = [seededShuffle(pool.slice(0, half), rng), seededShuffle(pool.slice(half), rng)];

    /* 坦克与输入 clamp */
    const tanks = new Map();
    const seq = [0, 0];
    for (const pl of opts.players) {
      const team = pl.team === 1 ? 1 : 0;
      const sp = poolSide[team][(seq[team]++) % half];
      tanks.set(pl.id, makeTank(pl, { x: sp[0], z: sp[1], yaw: Math.atan2(-sp[0], -sp[1]) }));
    }
    const clampInput = (t, i) => {
      const v = Array.isArray(i) ? i : [];
      const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
      return {
        throttle: SF.Util.clamp(num(v[0]), -1, 1),                                      // 设计 §3.4: 油门 ∈[-1,1]
        steer: SF.Util.clamp(num(v[1]), -1, 1),
        aimYaw: Math.atan2(Math.sin(num(v[2])), Math.cos(num(v[2]))),                    // 瞄准角归一 [-π,π]
        aimPitch: SF.Util.clamp(num(v[3]), t.spec.gunDepression, t.spec.gunElevation),   // 俯仰钳到车 spec 射界
        fire: !!v[4],
      };
    };

    /* 弹场与裁判(炮口位姿为确定性脚本值, 浏览器侧是 GLB muzzleWorld/gunDir —— 仅影响 muzzle flash 位置) */
    const judge = makeJudge(dispatch);
    const shells = SF.SimEngine.makeShells(Object.assign({
      onImpact() { }, onPlayerMiss() { }, onNearMiss() { }, onFlight() { }, onKill() { }, onCreate() { },
    }, judge));
    const envT = {
      heightAt: T.heightAt,
      coversBlocked(ox, oz, oy, dx, dz, len, dy) { return SF.Sim.coversBlocked(coversList, T.heightAt, ox, oz, oy, dx, dz, len, dy); },
      tanks: [...tanks.values()], playerPos: null, playerTeam: -9,
    };
    const envOf = (t) => ({
      terrain: T, coversList, tanks: envT.tanks, time,
      emit: dispatch, onMoved() { }, takeRam: judge.takeRam,
    });
    const muzzleOf = (t) => ({ x: t.x + Math.sin(t.yaw) * 2.0, y: t.y + 2.1, z: t.z + Math.cos(t.yaw) * 2.0 });
    const aimDirOf = (t) => {
      const cp = Math.cos(t.gunPitch);
      return { x: Math.sin(t.turretYaw) * cp, y: Math.sin(t.gunPitch), z: Math.cos(t.turretYaw) * cp };
    };

    /* 重生队列(死斗 5s, main.js:1287 同参) + 计分 */
    const respawn = [];
    let time = 0;
    let timeLeft = opts.timeLimit || 180;
    let finished = false;
    const scores = new Map();
    for (const pl of opts.players) scores.set(pl.id, 0);
    const rebuild = (tk) => {
      const half2 = pool.length >> 1;
      const sp = poolSide[tk.team === 1 ? 1 : 0][(Math.random() * half2) | 0];   // 重生取点(服务端权威)
      tk.x = sp[0]; tk.z = sp[1]; tk.yaw = Math.atan2(-sp[0], -sp[1]); tk.turretYaw = tk.yaw; tk.gunPitch = 0;
      tk.speed = 0; tk.gear = 'D1'; tk.shiftT = 0; tk.flipT = 0;
      tk.pitch = 0; tk.roll = 0; tk.y = 0; tk._yInit = false; tk._fallV = 0;
      tk.hp = tk.spec.hp; tk.alive = true; tk.reloadT = 1; tk.reloadTotal = 1;
      tk.disp = tk.spec.dispersion.max;
      tk.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
    };
    // 全功能事件出口: kill → 计分 + 重生队列(挂在 dispatch 变量上, judge/shells 闭包同享)
    dispatch = (k, d) => {
      if (opts.onEvent) opts.onEvent(k, d);
      if (k === 'kill') {
        if (d.by) scores.set(d.by, (scores.get(d.by) || 0) + 1);
        const tk = tanks.get(d.id);
        if (tk) respawn.push({ t: 5, tk });
      }
    };

    /* ---------- 阶段4: coop 权威段(波次/AI/维修/补给) ----------
       仅 mode==='coop' 初始化。AI 在房间上下文内直读本实例世界(SF.Game 由 server 注入指向本世界),
       无 10Hz 快照副本; 波次/维修/空投语义逐式移植 main.js spawnWave/checkWave 与 pickups.js 权威分支。 */
    const coop = opts.mode === 'coop';
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11 };
    const TIER_NUM = (v) => ROMAN[v] || 0;
    const hasModel = opts.hasModel || (() => true);
    const humans = [...tanks.values()];
    const waves = (opts.waves || []);
    let waveIdx = 0, repairT = 0, repairDone = false, loseT = -1, enemySeq = 100;
    const totalStats = { spawned: 0 };
    let worldRef = null;   // AI 的 world 视图(coop 段填充)

    function pickTierTank(cls, band) {   // main.js pickTierTank 移植(hasModel 注入)
      for (let w = 0; w < 4; w++) {
        const lo = Math.max(1, band[0] - w), hi = Math.min(11, band[1] + w);
        const pool = [];
        for (const k in SF.CFG.vehicles) {
          const v = SF.CFG.vehicles[k];
          if (v.tier && v.cls === cls && TIER_NUM(v.tier) >= lo && TIER_NUM(v.tier) <= hi && hasModel(k)) pool.push(k);
        }
        if (pool.length) return pool[(Math.random() * pool.length) | 0];
      }
      return 'pz4';
    }
    function spawnWaveCoop(i) {
      const wave = waves[i];
      if (!wave) return;
      const nP = Math.max(1, humans.length);
      const pt = Math.max(1, ...humans.map(h => TIER_NUM(h.spec.tier) || 5));
      const band = i === 0 ? [pt - 1, pt] : [pt, pt + 1];
      const target = Math.max(1, Math.min(9, Math.round(
        wave.enemies.length + (nP - 1) * 1.6 + (Math.random() - 0.5) * 1.5 + (nP === 1 ? -1 : 0))));
      const defs = wave.enemies.slice();
      while (defs.length > target) defs.splice((Math.random() * defs.length) | 0, 1);
      while (defs.length < target) {
        const src = defs.find(d => !d.hold) || defs[0] || wave.enemies[0];
        const jr2 = 90 + target * 4;
        defs.push({ ...src, pos: [src.pos[0] + (Math.random() - 0.5) * 2 * jr2, src.pos[1] + (Math.random() - 0.5) * 2 * jr2] });
      }
      const n = defs.length;
      const spawned = [];
      defs.forEach((def, wi) => {
        const jr = def.hold ? 18 : 65;
        let ex = SF.Util.clamp(def.pos[0] + (Math.random() - 0.5) * 2 * jr, -430, 430);
        let ez = SF.Util.clamp(def.pos[1] + (Math.random() - 0.5) * 2 * jr, -430, 430);
        for (let k = 0; k < 8 && !spawnPtOk(ex, ez); k++) {
          ex = SF.Util.clamp(def.pos[0] + (Math.random() - 0.5) * 2 * jr, -430, 430);
          ez = SF.Util.clamp(def.pos[1] + (Math.random() - 0.5) * 2 * jr, -430, 430);
        }
        [ex, ez] = circleCollide(coversList, ex, ez, 2.6);
        const CLS_OF_LEGACY = { medium: 'MT', td: 'TD', heavy: 'HT' };
        const cls = CLS_OF_LEGACY[def.type] || (SF.CFG.vehicles[def.type] || {}).cls || 'MT';
        const type = pickTierTank(cls, band);
        const flankSlot = wi / n * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        const t = makeTank({ id: enemySeq++, name: type, tank: type, team: 1 }, { x: ex, z: ez, yaw: (def.yaw !== undefined ? def.yaw : Math.PI) + (Math.random() - 0.5) * 0.4 });
        const patrol = (def.patrol || []).map(w => [
          SF.Util.clamp(w[0] + (ex - def.pos[0]) + (Math.random() - 0.5) * 50, -430, 430),
          SF.Util.clamp(w[1] + (ez - def.pos[1]) + (Math.random() - 0.5) * 50, -430, 430)]);
        t.ai = new SF.AI(t, { ...def, patrol, personality: def.personality });
        t.ai.flankSlot = flankSlot;
        tanks.set(t.netId, t);
        envT.tanks.push(t);
        spawned.push({ id: t.netId, type });
        totalStats.spawned++;
      });
      dispatch('aiWave', { list: spawned });
      if (worldRef) worldRef.enemies = [...tanks.values()].filter(t => t.netId >= 100);
    }
    function checkWaveCoop(dt) {
      if (finished) return;
      const enemies = [...tanks.values()].filter(t => t.netId >= 100);
      if (enemies.some(e => e.alive)) return;
      if (waveIdx + 1 < waves.length) {
        if (!repairDone) {
          repairDone = true; repairT = (opts.repairWaves || { duration: 12, hpRatio: 0.35 }).duration;
          const ratio = (opts.repairWaves || { hpRatio: 0.35 }).hpRatio;
          for (const h of humans) if (h.alive) {
            const heal = Math.round(h.spec.hp * ratio);
            h.hp = Math.min(h.spec.hp, h.hp + heal);
            h.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
          }
        }
        if (repairT > 0) { repairT = Math.max(0, repairT - dt); return; }
        waveIdx++; repairDone = false;
        spawnWaveCoop(waveIdx);
      } else {
        finish(true);
      }
    }

    /* 补给空投权威段(pickups.js 权威分支移植: 投放节奏/落点/类型/拾取/增益) */
    const PK_CFG = SF.CFG.pickups;
    const PK_IDX = ['repair', 'speed', 'aim', 'mobility', 'load'];
    const pkList = [];
    let pkSpawnT = PK_CFG.firstDelay, pkSeq = 1000, pkAnnounced = false;
    const pkAttach = (t) => {
      if (!t._pkBase) t._pkBase = JSON.parse(JSON.stringify(t.spec));
      if (!t._buffs) t._buffs = {};
    };
    const pkRecompute = (t) => {
      const b = t._pkBase, sp = t.spec, E = PK_CFG.effects;
      if (!b) return;
      const lv = (k) => (t._buffs && t._buffs[k]) ? t._buffs[k].lv : 0;
      sp.maxSpeed = b.maxSpeed * Math.pow(E.speed.maxSpeed, lv('speed'));
      sp.accel = b.accel * Math.pow(E.speed.accel, lv('speed'));
      sp.hullTraverse = b.hullTraverse * Math.pow(E.mobility.traverse, lv('mobility'));
      sp.turretTraverse = b.turretTraverse * Math.pow(E.mobility.traverse, lv('mobility'));
      sp.dispersion.aimTime = b.dispersion.aimTime * Math.pow(E.aim.aimTime, lv('aim'));
      sp.dispersion.base = b.dispersion.base * Math.pow(E.aim.base, lv('aim'));
      sp.gun.reload = b.gun.reload * Math.pow(E.load.reload, lv('load'));
      if (b.gun.autoloader && sp.gun.autoloader) {
        sp.gun.autoloader.intra = b.gun.autoloader.intra * Math.pow(E.load.reload, lv('load'));
        sp.gun.autoloader.long = b.gun.autoloader.long * Math.pow(E.load.reload, lv('load'));
      }
    };
    const pkApply = (t, type) => {
      if (type === 'repair') {
        const heal = Math.round(t.spec.hp * PK_CFG.repairHeal);
        t.hp = Math.min(t.spec.hp, t.hp + heal);
        t.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
      } else {
        pkAttach(t);
        const b = t._buffs[type] || (t._buffs[type] = { lv: 0, t: 0 });
        b.lv = Math.min(PK_CFG.maxStack, b.lv + 1);
        b.t = PK_CFG.buffDur;
        pkRecompute(t);
      }
    };
    const pkPickType = (t) => {
      const W = { ...PK_CFG.weights };
      const hurt = t.hp < t.spec.hp * 0.5 || t.modules.engine > 0 || t.modules.gun > 0 || t.modules.ammo > 0;
      if (hurt) W.repair *= PK_CFG.needRepairMul;
      else if (t.hp >= t.spec.hp - 0.5 && !t.modules.track) W.repair *= PK_CFG.fullHpMul;
      let sum = 0; for (const k in W) sum += W[k];
      let r = Math.random() * sum;
      for (const k in W) { r -= W[k]; if (r <= 0) return k; }
      return 'speed';
    };
    const pkDropPoint = (tank) => {
      const [r0, r1] = PK_CFG.spawnRing;
      const lim = Math.tan(SF.CFG.sim.maxSlope) * 0.96;
      for (let k = 0; k < 24; k++) {
        const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
        let x = SF.Util.clamp(tank.x + Math.sin(a) * r, -T.half + 20, T.half - 20);
        let z = SF.Util.clamp(tank.z + Math.cos(a) * r, -T.half + 20, T.half - 20);
        if (T.gradAt(x, z) > lim) continue;
        [x, z] = circleCollide(coversList, x, z, 2.4);
        if (T.gradAt(x, z) > lim) continue;
        return [x, z];
      }
      return null;
    };
    function tickPickups(dt) {
      const aliveHumans = humans.filter(t => t.alive);
      pkSpawnT -= dt;
      if (pkSpawnT <= 0) {
        if (pkList.length < PK_CFG.maxOnField && aliveHumans.length) {
          const tank = aliveHumans[(Math.random() * aliveHumans.length) | 0];
          const pt = pkDropPoint(tank);
          if (pt) { pkList.push({ id: pkSeq++, type: pkPickType(tank), x: pt[0], z: pt[1], landed: false, fallY: PK_CFG.dropDist, life: PK_CFG.lifetime }); pkAnnounced = true; }
        }
        pkSpawnT = PK_CFG.interval[0] + Math.random() * (PK_CFG.interval[1] - PK_CFG.interval[0]);
      }
      for (let i = pkList.length - 1; i >= 0; i--) {
        const p = pkList[i];
        if (!p.landed) {
          p.fallY -= PK_CFG.fallSpeed * dt;
          if (p.fallY <= 0) { p.landed = true; p.fallY = 0; }
          continue;
        }
        p.life -= dt;
        if (p.life <= 0) { pkList.splice(i, 1); continue; }
        for (const t of aliveHumans) {
          if (Math.hypot(t.x - p.x, t.z - p.z) < PK_CFG.radius + (t.cr || 1.5)) {
            pkApply(t, p.type);
            dispatch('pkGet', { id: p.id, by: t.netId || 0, type: p.type });
            pkList.splice(i, 1);
            break;
          }
        }
      }
    }

    const api = {
      get world() { return worldRef; },
      get timeLeft() { return timeLeft; },
      get scores() { return scores; },
      get finished() { return finished; },
      tanks,
      setInput(id, i) {
        const t = tanks.get(id);
        if (t) t.input = clampInput(t, i);
        if (coop && !waveStarted) { waveStarted = true; if (waves.length) spawnWaveCoop(0); }   // 首条 input = 客户端就绪信号
      },
      tick(dt) {
        if (finished) return;
        time += dt;
        if (!coop) timeLeft = Math.max(0, timeLeft - dt);   // coop 时限恒 9999 不走(main.js MP.timeLeft=9999 同)
        for (const t of tanks.values()) {
          if (!t.alive) continue;
          const inp = (coop && t.netId >= 100 && t.ai) ? t.ai.update(dt, worldRef) : t.input;   // coop AI 直读本实例世界
          if (globalThis.__srvDbg) {
            globalThis.__srvDbg.ticks = (globalThis.__srvDbg.ticks || 0) + 1;
            if (inp.fire) globalThis.__srvDbg.fireReq = (globalThis.__srvDbg.fireReq || 0) + 1;
            if (t.input.fire) globalThis.__srvDbg.inFire = (globalThis.__srvDbg.inFire || 0) + 1;
          }
          SF.SimEngine.updateTank(t, inp, dt, envOf(t));
          if (inp.fire) { const okF = SF.SimEngine.fire(t, { shells: { field: shells } }, muzzleOf(t), aimDirOf(t), dispatch); if (globalThis.__srvDbg) globalThis.__srvDbg.fired = (globalThis.__srvDbg.fired || 0) + (okF ? 1 : 0); }
        }
        shells.update(dt, envT);
        if (!coop) {
          for (const r of respawn) r.t -= dt;
          for (const r of respawn) if (r.t <= 0 && !r.tk.alive) rebuild(r.tk);
          for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].t <= 0) respawn.splice(i, 1);
          if (timeLeft <= 0) finish(false);
        } else {
          // coop: 波间维修倒计→下一波(checkWaveCoop); 全员阵亡宽限 2.5s → 失败结算(main.js loseT 同参)
          if (!waveStarted) { if (time > 8) { waveStarted = true; if (waves.length) spawnWaveCoop(0); } }
          else {
            if (repairDone && repairT > 0) { repairT = Math.max(0, repairT - dt); if (repairT === 0) { repairDone = false; waveIdx++; spawnWaveCoop(waveIdx); } }
            checkWaveCoop(dt);
          }
          tickPickups(dt);
          for (const h of humans) if (h._buffs) for (const k in h._buffs) { h._buffs[k].t -= dt; if (h._buffs[k].t <= 0) { delete h._buffs[k]; pkRecompute(h); } }
          if (loseT > 0) { loseT -= dt; if (loseT <= 0) finish(false); }
          else if (!humans.some(h => h.alive)) loseT = 2.5;
          else loseT = -1;
        }
      },
      snapshot() {
        const tn = {};
        for (const [id, t] of tanks)
          tn[id] = [+t.x.toFixed(1), +t.z.toFixed(1), +t.y.toFixed(1), +t.yaw.toFixed(2), +t.turretYaw.toFixed(2), +t.gunPitch.toFixed(2), +t.speed.toFixed(1), Math.round(t.hp), t.alive ? 1 : 0,
            +t.reloadT.toFixed(1), +(t.reloadTotal || 0).toFixed(1), t.clipLeft | 0, +t.pitch.toFixed(3), +t.roll.toFixed(3)];   // 14 字段行(路尾追加 bodyPitch/bodyRoll, 前 12 与 main.js hostSnapshot 同构)
        const sc = {};
        for (const [id, k] of scores) sc[id] = k;
        const snap = { t: 'snap', st: Math.max(0, Math.round(timeLeft)), tn, sc };
        if (coop) {
          // coop 四字段(main.js hostSnapshot 同构): wv 波次/dt 被锁定表/rp 波间维修/pk 场上空投
          const wave = waves[waveIdx] || {};
          const humanKills = [...scores.entries()].filter(([id]) => id < 100).reduce((s2, [, k]) => s2 + k, 0);
          snap.wv = [waveIdx, waves.length, wave.name || '', humanKills, totalStats.spawned];
          const dtMap = {};
          for (const t of tanks.values()) if (t.netId >= 100 && t.alive && t.ai && t.ai.seenNow) {
            const tid = t.ai.lastTargetId || 0;
            if (tid && humans.some(h => h.netId === tid)) dtMap[tid] = 1;
          }
          snap.dt = dtMap;
          if (repairT > 0) snap.rp = Math.ceil(repairT);
          snap.pk = pkList.filter(p => p.landed).map(p => [p.id, PK_IDX.indexOf(p.type), +p.x.toFixed(1), +p.z.toFixed(1)]);
        }
        return snap;
      },
      scoreRows() {
        return [...scores.entries()]
          .map(([id, k]) => { const t = tanks.get(id); return [id, t ? t.name : '?' + id, k | 0]; })
          .sort((a, b) => b[2] - a[2]);
      },
      forceEnd() { finish(); },
      // 测试钩子(main.js SF.Game.test 同款先例): 命令 fromId 坦克向 atId 开一炮 —— 走真实
      // 引擎开炮(炮口/散布/弹道/OBB 判定/takeHit), 只绕过 AI 的"何时开火"决策, 供门禁确定性验证
      testFire(fromId, atId) {
        const from = tanks.get(fromId), at = tanks.get(atId);
        if (!from || !at || !from.alive) return 'no-tank';
        from.reloadT = 0;   // 调试钩子: 忽略 AI 装填周期(否则连射多数被 reload 门挡)
        // 移至目标 25m 处点射(确定性): 远距散布(±disp/100·dist)会吞掉大半命中, 门禁只考判定链
        const dX0 = from.x - at.x, dZ0 = from.z - at.z, dL = Math.max(1, Math.hypot(dX0, dZ0));
        from.x = at.x + dX0 / dL * 25; from.z = at.z + dZ0 / dL * 25;
        from.y = T.heightAt(from.x, from.z);
        const dX = at.x - from.x, dY = (at.y + 1.2) - (from.y + 2.1), dZ = at.z - from.z;
        const dist = Math.max(1, Math.hypot(dX, dY, dZ));
        const pitch = Math.asin(Math.max(-1, Math.min(1, dY / dist)));
        from.turretYaw = Math.atan2(dX, dZ);
        from.gunPitch = pitch;
        return SF.SimEngine.fire(from, { shells: { field: shells } }, muzzleOf(from), aimDirOf(from), dispatch);
      },
    };
    function finish(win) {
      if (finished) return;
      finished = true;
      api.__win = !!win;
      if (opts.onEnd) opts.onEnd(api.scoreRows());
    }
    let waveStarted = false;   // coop 首波生成门: 收到任一玩家 input(=客户端资产加载完成、bindMpRelay 已注册)才生成首波, 防开局瞬间广播的 aiWave 被加载中客户端错过; 8s 兜底
    if (coop) {
      timeLimit = 9999;                                // coop 无时限(main.js MP.timeLeft=9999 同)
      // AI 的 world 视图: 生产 coop host 语义 —— world.enemies=AI 侧(首波生成后回填), mpTargets=人类
      worldRef = {
        get time() { return time; }, over: false, terrain: T,
        covers: { list: coversList, heightAt: T.heightAt,
          blocked(ox, oz, oy, dx, dz, len, dy, spot) { return SF.Sim.coversBlocked(coversList, T.heightAt, ox, oz, oy, dx, dz, len, dy, spot); },
          nearestCoverBetween(ax, az, bx, bz) { return SF.Sim.nearestCoverBetween(coversList, ax, az, bx, bz); } },
        enemies: [], player: humans[0] || null, mpTargets: humans, tanks: envT.tanks,   // player=host 坦克(main.js coop host 同语义, ai.js 多处引用)
        intel: { x: 0, z: 0, t: -99, level: 0 },
      };
    }
    // coop 首波不在此生成: 由「首条玩家 input」触发(setInput)或 8s 兜底(tick) —— 保证 aiWave ev
    // 在客户端 bindMpRelay 注册后才广播(开局瞬间发会被资产加载中的客户端错过)
    return api;
  }

  return { create, coverCol, circleCollide };
})();
