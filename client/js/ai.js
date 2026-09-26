// ai.js — 敌方 AI: FSM(巡逻/警戒/交战/撤退) + 三种车型性格 + 感知(视距/遮挡/反应延迟/听觉/记忆)
// 关键设计: AI 与玩家走同一 Tank.update 接口, 同样受缩圈/回转/装填规则约束
window.SF = window.SF || {};

// 通用通视检查(玩家 spotting 与 AI 共用): 地形 + 掩体遮挡, 眼高 2m
SF.losClear = function (world, ax, az, bx, bz) {
  const ay = world.terrain.heightAt(ax, az) + 2.0, by = world.terrain.heightAt(bx, bz) + 2.0;
  if (world.terrain.losBlocked(ax, az, ay, bx, bz, by)) return false;
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1) return true;
  return world.covers.blocked(ax, az, ay, dx / len, dz / len, len, (by - ay) / len) < 0;
};

// 多点通视(点亮用): 目标车体 1.2m / 塔心 2.0m / 炮塔顶 2.8m 任一点通视即算可见
// ——卖头(只露炮塔)或半坡露体的坦克不能再"明明看得见却不点亮"
SF.losClearAny = function (world, ax, az, bx, bz) {
  const by0 = world.terrain.heightAt(bx, bz);
  for (const h of [1.2, 2.0, 2.8]) {
    const ay = world.terrain.heightAt(ax, az) + 2.0, by = by0 + h;
    if (world.terrain.losBlocked(ax, az, ay, bx, bz, by)) continue;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1) return true;
    if (world.covers.blocked(ax, az, ay, dx / len, dz / len, len, (by - ay) / len) < 0) return true;
  }
  return false;
};

// 隐蔽值(WoT camo): 基础值按车型; 移动减半, 开炮后 3s 近乎清零, 蹲灌木 +0.2
// 实际点亮距离 = 视距 × (1 - 隐蔽值)
SF.camoOf = function (t, world) {
  const c0 = (t.spec && t.spec.camo !== undefined) ? t.spec.camo : 0.12;
  let c = c0;
  if (Math.abs(t.speed) > 1.2 || Math.abs(t.lastYawRate || 0) > 0.08) c *= 0.5;
  if (world.time - (t.lastFireT || -99) < 3) c = Math.min(c, c0 * 0.1);
  const bushes = world.covers.bushes || (world.covers.bushes = world.covers.list.filter(b => b.type === 'bush'));
  for (const b of bushes)
    if (Math.hypot(b.x - t.x, b.z - t.z) < b.r + 2.6) { c += 0.2; break; }
  return Math.min(c, 0.75);
};

// AI 目标选择: 合作模式多名玩家 → 锁定最近存活者; 单机 → world.player
function nearestTarget(world, from) {
  if (world.mpTargets && world.mpTargets.length) {
    let best = null, bd = 1e9;
    for (const t of world.mpTargets)
      if (t.alive) { const d = SF.Util.dist2d(from.x, from.z, t.x, t.z); if (d < bd) { bd = d; best = t; } }
    if (best) return best;
  }
  return world.player;
}

// 模拟时钟(类方法内取世界时间用)
function nowT() { return SF.Game && SF.Game.world ? SF.Game.world.time : 0; }

SF.AI = class {
  constructor(tank, def) {
    const U = SF.Util;
    this.tank = tank;
    this.p = SF.CFG.ai.personalities[def.personality] || SF.CFG.ai.personalities.flanker;
    this.patrol = (def.patrol || []).map(w => ({ x: w[0], z: w[1] }));
    this.hold = !!def.hold;
    this.home = { x: tank.x, z: tank.z };

    this.state = 'patrol';
    this.wp = 0;
    this._lastRadio = -99;
    this._alertT = 0;
    this._searchT = 0; this._searchPt = null;
    this.flankSlot = Math.random() * Math.PI * 2;   // 合围扇区(spawnWave 会按波次均匀重排)

    // 无线电: 友军发现/听见玩家 → 全队广播坐标(不限距离), 收到即前往支援
    SF.Bus.on('aiRadio', (e) => {
      if (!this.tank.alive || e.from === this.tank || this.state === 'combat') return;
      this.heard = { x: e.x + (Math.random() - 0.5) * 24, z: e.z + (Math.random() - 0.5) * 24, t: world2time() };
      if (this.state !== 'alert') { this.state = 'alert'; this._alertT = world2time(); }
    });
    function world2time() { return SF.Game && SF.Game.world ? SF.Game.world.time : 0; }
    this.input = { throttle: 0, steer: 0, aimYaw: tank.yaw, aimPitch: 0, fire: false };
    this.seen = false; this.reactT = 0;
    this.lastSeen = null; this.lastSeenT = -99;
    this.heard = null;
    this.perceptT = Math.random() * SF.CFG.ai.perceptionInterval;
    this.repositionT = 3 + Math.random() * 4;
    this.retreatT = 0; this.unstuckT = 0; this.stuckT = 0;
    this.navYawJitter = 0;

    // 听觉: 玩家开炮 → 炮声全图可闻, 记下大致方位(误差随距离增大: 远处只知个大概)
    SF.Bus.on('fire', (e) => {
      if (this.tank.alive && (e.tank.isPlayer || e.tank.team === 0)) {   // 合作: 任何玩家开炮都会被听见
        const d = SF.Util.dist2d(this.tank.x, this.tank.z, e.tank.x, e.tank.z);
        if (d < SF.CFG.ai.shotHearing) {
          const err = 14 + d * 0.06;
          this.heard = { x: e.tank.x + (Math.random() - 0.5) * 2 * err, z: e.tank.z + (Math.random() - 0.5) * 2 * err, t: world2time() };
        }
      }
    });
  }

  /* ---------- 被击中感知: 中弹 = 确切知道自己挨了打, 冲击方向大致可判 ----------
     立即上报全队(等级2情报: 有目标准接触), 自己转入警觉/追击, 炮口转向来袭方向 */
  onHurt(shooter) {
    if (!this.tank.alive || !shooter || shooter.team === this.tank.team) return;
    const err = 20 + Math.random() * 14;
    const hx = shooter.x + (Math.random() - 0.5) * 2 * err, hz = shooter.z + (Math.random() - 0.5) * 2 * err;
    this.heard = { x: hx, z: hz, t: nowT() };
    this._hurtT = nowT();
    const w = SF.Game.world;
    if (w) w.intel = { x: hx, z: hz, t: nowT(), level: 2 };   // 中弹=确认接触, 全队共享
    if (!this.seenNow) this.lastSeen = { x: hx, z: hz, vx: 0, vz: 0, t: nowT() };
    SF.Bus.emit('aiRadio', { from: this.tank, x: hx, z: hz });   // 呼叫支援(不限距离)
    if (this.state === 'patrol') { this.state = 'alert'; this._alertT = nowT(); }
  }

  /* ---------- 感知 ---------- */
  perceive(world) {
    const player = nearestTarget(world, this.tank);
    const wasSeen = this.seen;
    this.seen = false;
    if (player && player.alive) {
      const d = SF.Util.dist2d(this.tank.x, this.tank.z, player.x, player.z);
      // 点亮(WoT): 50m 内无视遮挡强制点亮; 否则 视距×(1-目标隐蔽) + 多点通视
      const vr = this.tank.spec.view || SF.CFG.ai.viewRange;
      if (d < 50 || (d < vr * (1 - SF.camoOf(player, world)) && SF.losClearAny(world, this.tank.x, this.tank.z, player.x, player.z))) {
        this.seen = true;
        this.lastSeen = { x: player.x, z: player.z, vx: player.velX || 0, vz: player.velZ || 0, t: world.time };
        this.lastTargetId = player.netId || 0;
        // 目视确认 → 上报全队情报(任何一辆看见, 全队都知道玩家在哪)
        world.intel = { x: player.x, z: player.z, t: world.time, level: 2 };
        if (!wasSeen && this.state !== 'combat')
          this.reactT = SF.CFG.ai.reactionTime * (1 + (1 - this.p.aimPatience));  // 反应延迟
        // 无线电呼叫支援(冷却)
        if (world.time - this._lastRadio > SF.CFG.ai.radio.cooldown) {
          this._lastRadio = world.time;
          SF.Bus.emit('aiRadio', { from: this.tank, x: player.x, z: player.z });
        }
      }
    }
    this.seenNow = this.seen;
  }

  /* ---------- 导航: 朝目标点输出油门/转向, 含避障/避陡坡/防卡死 ---------- */
  navigate(px, pz, dt, world, faceYaw = null) {
    const U = SF.Util, t = this.tank, T = world.terrain;
    // 卡死检测
    if (this.input.throttle > 0.4 && Math.abs(t.speed) < 0.25) { this.stuckT += dt; } else this.stuckT = 0;
    if (this.stuckT > 2) { this.unstuckT = 1.5; this.stuckT = 0; }
    if (this.unstuckT > 0) {   // 倒车脱困
      this.unstuckT -= dt;
      this.input.throttle = -1; this.input.steer = this.navYawJitter > 0 ? 1 : -1;
      return;
    }

    const dx = px - t.x, dz = pz - t.z, dist = Math.hypot(dx, dz);
    let desiredYaw = (faceYaw !== null && this.p.holdGround) ? faceYaw : Math.atan2(dx, dz);

    // 前方陡坡回避: 试探 ±50° 找缓坡
    if (Math.abs(T.slopeAhead(t.x, t.z, t.yaw, 6)) > SF.CFG.sim.maxSlope * 0.85) {
      const sL = Math.abs(T.slopeAhead(t.x, t.z, t.yaw - 0.9, 6)), sR = Math.abs(T.slopeAhead(t.x, t.z, t.yaw + 0.9, 6));
      desiredYaw = t.yaw + (sL < sR ? -0.9 : 0.9);
    }
    // 前方掩体回避
    const fx = t.x + Math.sin(t.yaw) * 7, fz = t.z + Math.cos(t.yaw) * 7;
    for (const c of world.covers.list) {
      if (!c.blocksMove || c.blocksShells === false && c.r < 1) continue;
      const d = Math.hypot(fx - c.x, fz - c.z);
      if (d < c.r + 3) { desiredYaw = t.yaw + Math.sign(SF.Util.angDiff(t.yaw, Math.atan2(t.x - c.x, t.z - c.z) + Math.PI / 2)) * 0.8; break; }
    }

    const dYaw = SF.Util.angDiff(t.yaw, desiredYaw);
    this.input.steer = SF.Util.clamp(dYaw * 2.5, -1, 1);
    const arrived = dist < 4;
    this.input.throttle = arrived ? 0 : (Math.abs(dYaw) > 1.3 ? 0.12 : 1);
    if (arrived) this.input.steer = faceYaw !== null ? SF.Util.clamp(SF.Util.angDiff(t.yaw, faceYaw) * 2.5, -1, 1) : 0;
  }

  /* ---------- 主逻辑 ---------- */
  update(dt, world) {
    const U = SF.Util, t = this.tank, player = nearestTarget(world, this.tank), P = this.p;
    if (!t.alive) return;
    this.input.fire = false;

    this.perceptT -= dt;
    if (this.perceptT <= 0) { this.perceptT = SF.CFG.ai.perceptionInterval; this.perceive(world); }
    if (this.reactT > 0) this.reactT -= dt;

    // 导航参考点: 看得见用真实位置, 看不见用最后已知位置(不偷读玩家坐标)
    const ref = (this.seenNow && player && player.alive) ? player : (this.lastSeen || player);
    const distP = ref ? SF.Util.dist2d(t.x, t.z, ref.x, ref.z) : 1e9;
    const toPlayerYaw = ref ? Math.atan2(ref.x - t.x, ref.z - t.z) : t.yaw;

    /* --- 状态转移 --- */
    if (this.seenNow && this.state !== 'retreat') {
      this.state = 'combat'; this._alertT = 0;
      if (t.hp / t.spec.hp < P.retreatHp && this.retreatT <= 0) { this.state = 'retreat'; this.retreatT = 8; }
    } else if (this.state === 'combat' && !this.seenNow) {
      if (!this.lastSeen || world.time - this.lastSeen.t > SF.CFG.ai.memoryTime) this.state = 'alert';
    } else if (this.state === 'patrol' && this.heard) {
      this.state = 'alert';
    }
    if (this.state === 'retreat') {
      this.retreatT -= dt;
      if (this.retreatT <= 0) this.state = 'combat';
    }

    /* --- 各状态行为 --- */
    let aimAt = null, faceYaw = null;
    if (this.state === 'patrol') {
      if (this.patrol.length) {
        const w = this.patrol[this.wp];
        this.navigate(w.x, w.z, dt, world);
        if (SF.Util.dist2d(t.x, t.z, w.x, w.z) < 5) this.wp = (this.wp + 1) % this.patrol.length;
      } else { this.input.throttle = 0; this.input.steer = 0; }
      // 巡逻时炮塔警戒朝向前方
      this.input.aimYaw = t.yaw; this.input.aimPitch = 0.02;
    }
    else if (this.state === 'alert') {
      if (!this._alertT) this._alertT = world.time;
      // 情报源: 取最新更新的(目视 lastSeen / 听见 heard / 全队 intel)
      const cands = [this.lastSeen, this.heard, world.intel.level > 0 ? world.intel : null].filter(Boolean);
      cands.sort((a, b) => b.t - a.t);
      const tgt = cands[0] || this.home;
      const intel = world.intel;
      const intelFresh = intel.level > 0 && world.time - intel.t < SF.CFG.ai.searchTime;
      const intelFresh2 = intel.level === 2 && world.time - intel.t < 8;   // 确认接触且情报新鲜
      const hurtRecent = this._hurtT && world.time - this._hurtT < 12;   // 刚挨打: 反应升级
      // 守位单位(蹲点歼击/守线重坦): 敌情未确认只原地警戒炮口指向;
      // 自己挨了打 / 全队确认接触且警戒数秒无果 → 离位加入围剿
      const holdHold = this.hold && !hurtRecent && !(intelFresh2 && world.time - this._alertT > 4);
      if (holdHold) {
        this.input.throttle = 0; this.input.steer = 0;
        this.input.aimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);
        this.input.aimPitch = 0.02;
      } else if (intelFresh2 && !this.hold) {
        /* --- 协同突入: 确认接触且情报新鲜 → 最近的先压上去掏人, 其余架枪支援后错峰跟进 ---
           不再傻等"看见"才动: 你躲进反斜面/掩体, 他们直接压到脸上把你掀出来 */
        let rank = 0, myD = SF.Util.dist2d(t.x, t.z, tgt.x, tgt.z);
        for (const o of world.enemies) {
          if (o === t || !o.alive || !o.ai || o.ai.state === 'combat') continue;
          const od = SF.Util.dist2d(o.x, o.z, tgt.x, tgt.z);
          if (od < myD || (od === myD && o.ai.flankSlot < this.flankSlot)) rank++;
        }
        if (this._intelT === undefined || intel.t > this._intelT + 0.5) {   // 情报刷新 → 重新排突入次序
          this._intelT = intel.t;
          this._pushAt = world.time + rank * 2.5;
        }
        if (world.time >= (this._pushAt || 0) || hurtRecent) {
          this.navigate(tgt.x, tgt.z, dt, world);                          // 直插情报点
          this.input.aimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);        // 边压边瞄
          this.input.aimPitch = 0.02;
        } else {
          // 等待突入次序: 压到自己的环位, 炮口始终瞄准情报点(支援架枪)
          const ringR = (P.band[0] + P.band[1]) * 0.5;
          const bx = tgt.x + Math.sin(this.flankSlot) * ringR, bz = tgt.z + Math.cos(this.flankSlot) * ringR;
          if (SF.Util.dist2d(t.x, t.z, bx, bz) > 10) this.navigate(bx, bz, dt, world);
          else { this.input.throttle = 0; this.input.steer = 0; }
          this.input.aimYaw = Math.atan2(tgt.x - t.x, tgt.z - t.z);
          this.input.aimPitch = 0.02;
        }
      } else {
        // 有方法的围攻: 各车从自己的合围扇区接近; 刚挨打的车压得更近(报复性追击)
        const ringR = hurtRecent ? P.band[0] * 0.7 : (P.band[0] + P.band[1]) * 0.5;
        const bx = tgt.x + Math.sin(this.flankSlot) * ringR, bz = tgt.z + Math.cos(this.flankSlot) * ringR;
        if (SF.Util.dist2d(t.x, t.z, bx, bz) > 12) {
          this.navigate(bx, bz, dt, world);
        } else {
          // 包围圈就位仍未接触: 围绕情报点游走搜索(偏向内圈, 更敢掏)
          this._searchT -= dt;
          if (this._searchT <= 0 || !this._searchPt) {
            this._searchT = 3.5 + Math.random() * 3.5;
            const rr = Math.random() < 0.5 ? ringR * 0.55 : ringR;
            this._searchPt = { x: U.clamp(tgt.x + (Math.random() - .5) * 2 * rr, -430, 430),
                               z: U.clamp(tgt.z + (Math.random() - .5) * 2 * rr, -430, 430) };
          }
          this.navigate(this._searchPt.x, this._searchPt.z, dt, world);
        }
        // 刚挨打: 炮口压向来袭方向而不是车头方向(边追边瞄)
        this.input.aimYaw = hurtRecent ? Math.atan2(tgt.x - t.x, tgt.z - t.z) : t.yaw;
        this.input.aimPitch = 0.02;
      }
      // 搜剿超时仍无果 → 回归巡逻(玩家一直开炮/命中则情报持续刷新, 搜剿不结束)
      if (!this.seenNow && !intelFresh && world.time - this._alertT > SF.CFG.ai.searchTime) {
        this._alertT = 0; this._searchT = 0; this._searchPt = null; this.heard = null; this._pushAt = null; this.state = 'patrol';
      }
    }
    else if (this.state === 'combat') {
      aimAt = this.lastSeen || { x: ref.x, z: ref.z, vx: 0, vz: 0 };
      const [lo, hi] = P.band;
      this.repositionT -= dt;

      let navX = t.x, navZ = t.z;
      if (distP > hi && !this.hold) {                       // 太远: 前压(失去视野时压向最后已知位置)
        const k = (distP - hi * 0.85) / distP;
        navX = t.x + (ref.x - t.x) * k; navZ = t.z + (ref.z - t.z) * k;
      } else if (distP < lo) {                              // 太近: 拉开
        const k = (lo * 1.15 - distP) / Math.max(distP, 1);
        navX = t.x - (ref.x - t.x) * k; navZ = t.z - (ref.z - t.z) * k;
      } else if (this.repositionT <= 0) {                   // 距离合适: 时不时换位/绕侧
        this.repositionT = 5 + Math.random() * 6;
        if (Math.random() < P.flankChance) {
          // 绕侧方向按合围扇区定: 一半顺时针一半逆时针, 多车围攻时形成对转包夹
          const side = this.flankSlot > Math.PI ? 1 : -1;
          const px = -(ref.z - t.z), pz = (ref.x - t.x), pl = Math.hypot(px, pz);
          navX = t.x + px / pl * 35 * side; navZ = t.z + pz / pl * 35 * side;
        } else {
          navX = t.x + (Math.random() - 0.5) * 24; navZ = t.z + (Math.random() - 0.5) * 24;
        }
      }
      // hold 单位(蹲点歼击车/守线重坦): 只在小范围内机动, 炮口始终对敌
      if (this.hold && SF.Util.dist2d(navX, navZ, this.home.x, this.home.z) > 30) {
        const k = 30 / SF.Util.dist2d(navX, navZ, this.home.x, this.home.z);
        navX = this.home.x + (navX - this.home.x) * k; navZ = this.home.z + (navZ - this.home.z) * k;
      }
      faceYaw = t.parts.noTurret ? toPlayerYaw : null;       // 歼击车需车体对准才能瞄准
      this.navigate(navX, navZ, dt, world, faceYaw);
    }
    else if (this.state === 'retreat') {
      aimAt = this.lastSeen || { x: player.x, z: player.z, vx: 0, vz: 0 };
      const cov = world.covers.nearestCoverBetween(player.x, player.z, t.x, t.z);
      const away = cov ? { x: cov.x + (t.x - cov.x) * 0.4, z: cov.z + (t.z - cov.z) * 0.4 }
        : { x: t.x + (t.x - player.x) * 0.4, z: t.z + (t.z - player.z) * 0.4 };
      this.navigate(away.x, away.z, dt, world);
    }

    /* --- 瞄准与开火(交战/撤退中均还击) --- */
    if (aimAt && player && player.alive) {
      const flightT = distP / t.spec.gun.speed;
      const lead = P.leadSkill;                              // 预判能力(性格差异)
      const predX = aimAt.x + (aimAt.vx || 0) * flightT * lead;
      const predZ = aimAt.z + (aimAt.vz || 0) * flightT * lead;
      // 高纪律 AI 打弱点(首下), 其余瞄车体中心
      const ty = world.terrain.heightAt(player.x, player.z) + (P.aimPatience >= 0.85 ? 0.7 : 1.2);
      const dy = ty - (t.y + 2.0), dh = Math.hypot(predX - t.x, predZ - t.z);
      this.input.aimYaw = Math.atan2(predX - t.x, predZ - t.z);
      this.input.aimPitch = SF.Util.clamp(Math.atan2(dy, Math.max(dh, 1)), t.spec.gunDepression, t.spec.gunElevation);

      // 开火纪律: 需 reaction 过后 + 炮口对准 + 缩圈达标(耐心差 → 圈大也开火 → 天然打不准)
      // 近战豁免: 贴脸/狗斗(distP < 常驻距离下沿×1.2)时大幅放宽缩圈要求——绕圈也要敢开炮, 对枪靠走位弥补精度
      // 阈值下限 1.08×base: disp 收敛于 base 只能从上方逼近, 恰等于 base 会导致永远不敢开火;
      // 火炮受损(永久扩圈)按同样倍数放宽, 损炮不是哑炮
      const aimed = Math.abs(SF.Util.angDiff(t.turretYaw, this.input.aimYaw)) < 0.05;
      const D = t.spec.dispersion;
      const gunBad = t.modules.gun > 0 ? SF.CFG.armor.modules.gun.dispPenalty : 1;
      const brawl = distP < P.band[0] * 1.2;
      let fireThreshold = D.base + (D.max - D.base) * (brawl ? 0.5 : (1 - P.aimPatience) * 0.8);
      fireThreshold = Math.min(D.max, Math.max(D.base * 1.08, fireThreshold) * gunBad);
      this.input.fire = this.seenNow && this.reactT <= 0 && aimed && t.reloadT <= 0 && t.disp < fireThreshold;
    }
    return this.input;
  }
};
