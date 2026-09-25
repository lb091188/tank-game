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

    // 无线电: 友军发现玩家 → 范围内友军收到坐标前去支援(守位单位原地警戒转向)
    SF.Bus.on('aiRadio', (e) => {
      if (!this.tank.alive || e.from === this.tank || this.state === 'combat') return;
      if (SF.Util.dist2d(this.tank.x, this.tank.z, e.from.x, e.from.z) > SF.CFG.ai.radio.range) return;
      this.heard = { x: e.x + (Math.random() - 0.5) * 24, z: e.z + (Math.random() - 0.5) * 24 };
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

    // 听觉: 玩家在附近开炮 → 大致方位
    SF.Bus.on('fire', (e) => {
      if (this.tank.alive && (e.tank.isPlayer || e.tank.team === 0)) {   // 合作: 任何玩家开炮都会被听见
        const d = SF.Util.dist2d(this.tank.x, this.tank.z, e.tank.x, e.tank.z);
        if (d < SF.CFG.ai.hearingRange)
          this.heard = { x: e.tank.x + (Math.random() - 0.5) * 24, z: e.tank.z + (Math.random() - 0.5) * 24 };
      }
    });
  }

  /* ---------- 感知 ---------- */
  perceive(world) {
    const player = nearestTarget(world, this.tank);
    const wasSeen = this.seen;
    this.seen = false;
    if (player && player.alive) {
      const d = SF.Util.dist2d(this.tank.x, this.tank.z, player.x, player.z);
      if (d < SF.CFG.ai.viewRange && SF.losClear(world, this.tank.x, this.tank.z, player.x, player.z)) {
        this.seen = true;
        this.lastSeen = { x: player.x, z: player.z, vx: player.velX || 0, vz: player.velZ || 0, t: world.time };
        this.lastTargetId = player.netId || 0;
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

    const distP = player && player.alive ? SF.Util.dist2d(t.x, t.z, player.x, player.z) : 1e9;
    const toPlayerYaw = player ? Math.atan2(player.x - t.x, player.z - t.z) : t.yaw;

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
      const target = this.heard || this.lastSeen || this.home;
      if (this.hold) {
        // 守位单位(歼击车/重坦): 原地警戒, 炮口指向情报方向
        this.input.throttle = 0; this.input.steer = this.parts_noTurret ? 0 : 0;
        this.input.aimYaw = Math.atan2(target.x - t.x, target.z - t.z);
        this.input.aimPitch = 0.02;
      } else {
        this.navigate(target.x, target.z, dt, world);
        this.input.aimYaw = t.yaw; this.input.aimPitch = 0.02;
      }
      if (!this.seenNow && world.time - this._alertT > 7) {   // 支援无果 → 回归巡逻
        this._alertT = 0; this.heard = null; this.state = 'patrol';
      }
    }
    else if (this.state === 'combat') {
      aimAt = this.lastSeen || { x: player.x, z: player.z, vx: 0, vz: 0 };
      const [lo, hi] = P.band;
      this.repositionT -= dt;

      let navX = t.x, navZ = t.z;
      if (distP > hi && !this.hold) {                       // 太远: 前压
        const k = (distP - hi * 0.85) / distP;
        navX = t.x + (player.x - t.x) * k; navZ = t.z + (player.z - t.z) * k;
      } else if (distP < lo) {                              // 太近: 拉开
        const k = (lo * 1.15 - distP) / Math.max(distP, 1);
        navX = t.x - (player.x - t.x) * k; navZ = t.z - (player.z - t.z) * k;
      } else if (this.repositionT <= 0) {                   // 距离合适: 时不时换位/绕侧
        this.repositionT = 5 + Math.random() * 6;
        if (Math.random() < P.flankChance) {
          const side = Math.random() < 0.5 ? 1 : -1;
          const px = -(player.z - t.z), pz = (player.x - t.x), pl = Math.hypot(px, pz);
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
      const aimed = Math.abs(SF.Util.angDiff(t.turretYaw, this.input.aimYaw)) < 0.05;
      const D = t.spec.dispersion;
      const fireThreshold = D.base + (D.max - D.base) * (1 - P.aimPatience) * 0.8;
      this.input.fire = this.seenNow && this.reactT <= 0 && aimed && t.reloadT <= 0 && t.disp < fireThreshold;
    }
    return this.input;
  }
};
