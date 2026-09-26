// vehicle.js — 车辆控制器: 惯性行驶/车体炮塔回转/地形贴合/缩圈扩圈/模块损伤
// 玩家键鼠与 AI 喂同一个 input 接口: {throttle, steer, aimYaw, aimPitch, fire}
window.SF = window.SF || {};

// 瞄准换算临时对象(世界方向 → 车体局部系)
const AIM_DIR = new THREE.Vector3(), AIM_LOCAL = new THREE.Vector3();
const HULL_E = new THREE.Euler(), HULL_Q = new THREE.Quaternion();

SF.Tank = class {
  constructor(type, opts) {
    const U = SF.Util;
    this.type = type;
    this.spec = SF.CFG.vehicles[type];
    this.parts = SF.Models.makeTank(type);
    this.group = this.parts.root;
    this.isPlayer = !!opts.isPlayer;
    this.netId = opts.netId || 0;
    this.team = (opts.team !== undefined) ? opts.team : (this.isPlayer ? 0 : 1);

    this.x = opts.x; this.z = opts.z; this.yaw = opts.yaw || 0;
    this.speed = 0;
    // 车体碰撞半径(外接圆×0.72): 撞掩体/撞车的推离与掉速判定用
    this.cr = Math.hypot(this.spec.sample.l, this.spec.sample.w) * 0.72;
    this.turretYaw = this.yaw; this.gunPitch = 0;
    this.aimYaw = this.yaw; this.aimPitch = 0;
    this.pitch = 0; this.roll = 0; this.y = 0;

    this.hp = this.spec.hp; this.alive = true;
    this.velX = 0; this.velZ = 0;   // 供 AI 预判提前量
    this.trackOffset = 0;           // 履带纹理滚动相位
    this.reloadT = 0.5;
    this.reloadTotal = 0.5;                              // 当前装填阶段总时长(读条分母)
    const _al = this.spec.gun.autoloader;
    this.clipLeft = _al ? _al.clip : 0;                  // 弹夹余弹(0=非弹夹炮)
    this.clipPhase = _al ? 'intra' : 'single';           // intra=夹内短装填 long=整夹长装填
    this.disp = this.spec.dispersion.max;   // 起始满圈
    this.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
    this.lastYawRate = 0; this.lastTurretRate = 0;
    this.stats = { shots: 0, hits: 0, pens: 0, dmgDealt: 0 };
    this.smokeT = 0;
  }

  get pos3() { return new THREE.Vector3(this.x, this.y + 1.5, this.z); }

  effectiveMaxSpeed() {
    let m = this.spec.maxSpeed;
    if (this.modules.engine > 0) m *= SF.CFG.armor.modules.engine.slow;
    return m;
  }

  update(input, dt, world) {
    const U = SF.Util, S = this.spec, T = world.terrain;
    if (!this.alive) { this._deathFx(dt); this._syncNode(); return; }
    const yaw0 = this.yaw;   // 车体本帧转前朝向(右键锁定时炮塔随车体走, 见瞄准段)

    for (const k in this.modules) this.modules[k] = Math.max(0, this.modules[k] - dt);

    /* --- 行驶(惯性/迟滞/滑行) --- */
    const trackBroken = this.modules.track > 0;
    const maxF = this.effectiveMaxSpeed(), maxR = maxF * S.reverseRatio;
    const slope = T.slopeAhead(this.x, this.z, this.yaw, 4);
    // slopeAhead 是弧度角: 用 sin 换算重力分量做动力惩罚(角度比混用曾导致 17° 坡就损失 42% 动力)
    const slopeK = U.clamp(1 - Math.sin(Math.abs(slope)) * 0.85, 0.35, 1);
    const uphill = (input.throttle > 0 && this.speed >= 0) || (input.throttle < 0 && this.speed <= 0);

    if (trackBroken) {
      this.speed = U.moveToward(this.speed, 0, 6 * dt);             // 断带: 瘫痪
    } else if (Math.abs(slope) > SF.CFG.sim.maxSlope && uphill) {
      this.speed = U.moveToward(this.speed, 0, 8 * dt);             // 陡坡爬不上去
    } else if (input.throttle > 0) {
      if (this.speed < -0.3) this.speed = U.moveToward(this.speed, 0, S.brake * dt); // 前进档踩刹车
      else {
        const target = maxF * input.throttle;
        const a = S.accel * (uphill ? slopeK : 1) * U.clamp(1.15 - Math.abs(this.speed) / (maxF + 0.01) * 0.5, 0.4, 1);
        this.speed = Math.min(target, this.speed + a * dt);
      }
    } else if (input.throttle < 0) {
      if (this.speed > 0.3) this.speed = U.moveToward(this.speed, 0, S.brake * dt); // 倒车档先刹车(滑行感)
      else this.speed = Math.max(maxR * input.throttle, this.speed - S.accel * dt);
    } else {
      this.speed = U.moveToward(this.speed, 0, S.coastDrag * dt);   // 松手滑行
    }

    /* --- 车体回转(可原地转向; 断带严重削弱) --- */
    const steerAuth = trackBroken ? 0.25 : 1;
    const yawRate = S.hullTraverse * input.steer * steerAuth * U.clamp(1 - Math.abs(this.speed) / (maxF * 2), 0.55, 1);
    this.yaw += yawRate * dt;
    this.lastYawRate = yawRate;
    // 转向掉速(WoT): 急转履带侧滑损耗动量, 持续满舵明显掉速; 原地转向速度≈0不受影响
    if (Math.abs(this.speed) > 0.5) this.speed -= this.speed * Math.abs(input.steer) * 0.4 * dt;

    /* --- 位移与碰撞 --- */
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
    this.x = U.clamp(this.x, -T.half + 16, T.half - 16);
    this.z = U.clamp(this.z, -T.half + 16, T.half - 16);
    // 掩体碰撞: 车体 OBB(真实长宽) vs 掩体 SAT 推出; 真正迎面顶撞才掉速(斜擦/狗斗贴靠不受罚)
    const cx0 = this.x, cz0 = this.z;
    [this.x, this.z] = world.covers.collideTank(this);
    if (this.x !== cx0 || this.z !== cz0) {
      const px2 = this.x - cx0, pz2 = this.z - cz0, pl = Math.hypot(px2, pz2) || 1;
      const cosv = (Math.sin(this.yaw) * px2 + Math.cos(this.yaw) * pz2) / pl;   // 车头 vs 推出方向(纯方向, 不含速度)
      if (cosv < -0.5 && Math.abs(this.speed) > 1) this.speed *= 0.3;            // 迎面 60° 锥内才算顶撞
    }
    // 车车碰撞: 含残骸(击毁的车也是实体); 车体 OBB 互推, 顶撞掉速
    // 快速剔除用真外接半径(hypot(半宽,半长)), 用小了会漏检头尾相触
    const me = { x: this.x, z: this.z, yaw: this.yaw, hx: S.sample.w, hz: S.sample.l };
    const myCirc = Math.hypot(S.sample.w, S.sample.l);
    for (const o of world.tanks) {
      if (o === this) continue;
      const dx0 = this.x - o.x, dz0 = this.z - o.z;
      const rr = myCirc + Math.hypot(o.spec.sample.w, o.spec.sample.l);
      if (dx0 * dx0 + dz0 * dz0 > rr * rr) continue;
      const push = SF.Util.obbPushOut(me, { x: o.x, z: o.z, yaw: o.yaw, hx: o.spec.sample.w, hz: o.spec.sample.l });
      if (push) {
        me.x += push[0]; me.z += push[1];
        const plen = Math.hypot(push[0], push[1]) || 1;
        // 撞击逼近速度要先于顶撞掉速取值(掉速会把冲量砍到阈值下, 高速对撞变轻碰)
        const nvx = Math.sin(this.yaw) * this.speed, nvz = Math.cos(this.yaw) * this.speed;
        const ovx = Math.sin(o.yaw) * o.speed, ovz = Math.cos(o.yaw) * o.speed;
        const closing = -((nvx - ovx) * push[0] / plen + (nvz - ovz) * push[1] / plen);
        const cosv = (Math.sin(this.yaw) * push[0] + Math.cos(this.yaw) * push[1]) / plen;
        if (cosv < -0.5 && Math.abs(this.speed) > 1) this.speed *= 0.4;
        // 撞击伤害(WoT): 高速互撞双方掉血, 逼近速度平方×质量占比, 重车占便宜(残骸不伤人)
        if (o.team !== this.team && o.alive && closing > 4 && world.time - (this._ramT || -9) > 0.5) {
          this._ramT = o._ramT = world.time;   // 双方共冷却, 一次接触只结算一回
          const m1 = this._mass(), m2 = o._mass(), e = closing * closing * 0.55;
          this.takeRam(o, Math.round(e * m2 / (m1 + m2)));
          o.takeRam(this, Math.round(e * m1 / (m1 + m2)));
        }
      }
    }
    this.x = me.x; this.z = me.z;

    /* --- 地形贴合(履带四角采样 → 俯仰/侧倾/高度; 全部平滑防颠簸) ---
       车体局部系: 前进+Z, 左舷+X(经 yaw 旋转后: 左舷方向 = (cos yaw, -sin yaw)) */
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const SL = S.sample.l, SW = S.sample.w;
    const hF = T.heightAt(this.x + s * SL, this.z + c * SL), hB = T.heightAt(this.x - s * SL, this.z - c * SL);
    const hL = T.heightAt(this.x + c * SW, this.z - s * SW), hR = T.heightAt(this.x - c * SW, this.z + s * SW);
    const hC = T.heightAt(this.x, this.z);
    const targetY = Math.max(hC, (hF + hB + hL + hR) / 4);   // 凹: 骑在四角上; 凸: 撑在中心上
    const tPitch = Math.atan2(hF - hB, 2 * SL), tRoll = Math.atan2(hL - hR, 2 * SW);
    if (!this._yInit) { this._yInit = true; this.y = targetY; this.pitch = tPitch; this.roll = tRoll; }  // 出生直接贴地, 不从地里升起
    const sm = 1 - Math.exp(-12 * dt);
    this.y = U.lerp(this.y, targetY, sm);
    this.pitch = U.lerp(this.pitch, tPitch, sm); this.roll = U.lerp(this.roll, tRoll, sm);

    this.animateTracks(dt);

    /* --- 炮塔/火炮瞄准(WoT 式完整版): 世界瞄准方向 → 车体局部系(含俯仰+横滚) ---
       俯仰与回转限制都相对车体: 上坡压缩/下坡扩大世界俯角, 侧坡横滚时侧向瞄准自动补偿 */
    const cp = Math.cos(input.aimPitch || 0), sp2 = Math.sin(input.aimPitch || 0);
    AIM_DIR.set(Math.sin(input.aimYaw) * cp, sp2, Math.cos(input.aimYaw) * cp);
    HULL_E.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    HULL_Q.setFromEuler(HULL_E).invert();
    AIM_LOCAL.copy(AIM_DIR).applyQuaternion(HULL_Q);
    const localYaw = Math.atan2(AIM_LOCAL.x, AIM_LOCAL.z);
    const localElev = Math.atan2(AIM_LOCAL.y, Math.hypot(AIM_LOCAL.x, AIM_LOCAL.z));
    if (input.holdTurret) {
      // 右键锁定: 炮塔转角相对车体保持不变(车体转动炮塔跟着走, 世界朝向一起变), 俯仰同样锁住
      this.turretYaw += this.yaw - yaw0;
      this.lastTurretRate = 0;
    } else if (this.parts.noTurret) {
      // 固定战斗室(WoT 式): 火炮在 ±gunArc 射界内横向伺服; 超界由引擎/玩家自动转车体对准
      const arc = (S.gunArc !== undefined) ? S.gunArc : 10 * Math.PI / 180;
      const layYaw = U.clamp(localYaw, -arc, arc);
      // 当前炮向先钳回车体±射界: 车体快速回转时伺服滞后, 炮管会被甩到车体后方(开炮也朝后打)
      this.turretYaw = this.yaw + U.clamp(U.angDiff(this.yaw, this.turretYaw), -arc, arc);
      const before = this.turretYaw;
      this.turretYaw = U.angMoveToward(this.turretYaw, this.yaw + layYaw, Math.max(S.turretTraverse, 0.4) * dt);
      this.lastTurretRate = U.angDiff(before, this.turretYaw) / dt;
    } else {
      const before = this.turretYaw;
      // 车体转向时炮塔纯刚体随动: 相对角锁死, 炮塔转速恒等于车体(不会比车体快), 整车形态稳定;
      // 松开转向后炮塔再以炮塔回转速度伺服回瞄准方向
      // (绕圈狗斗时瞄准方位随车体同速旋转, 炮塔随车体走正咬住目标)
      if (Math.abs(input.steer) > 0.15 && Math.abs(this.lastYawRate) > 0.05) {
        this.turretYaw += this.yaw - yaw0;
      } else {
        this.turretYaw = U.angMoveToward(this.turretYaw, this.yaw + localYaw, S.turretTraverse * dt);
      }
      this.lastTurretRate = U.angDiff(before, this.turretYaw) / dt;
    }
    if (!input.holdTurret)
      this.gunPitch = U.moveToward(this.gunPitch, U.clamp(localElev, S.gunDepression, S.gunElevation), 1.2 * dt);

    /* --- 缩圈/扩圈 --- */
    const D = S.dispersion;
    const moveK = Math.abs(this.speed) / S.maxSpeed * D.move;
    const turnK = Math.min(1, Math.abs(this.lastYawRate) / S.hullTraverse) * D.hullTurn;
    const turK = Math.min(1, Math.abs(this.lastTurretRate) / Math.max(S.turretTraverse, 0.01)) * D.turretTurn;
    const target = U.clamp(D.base * (1 + moveK + turnK + turK), D.base, D.max);
    this.disp += (target - this.disp) * (1 - Math.exp(-dt * 2.2 / D.aimTime));

    /* --- 装填 --- */
    const wasLoading = this.reloadT > 0;
    this.reloadT = Math.max(0, this.reloadT - dt);
    if (wasLoading && this.reloadT === 0) SF.Bus.emit('reloaded', { tank: this });

    if (input.fire) this.fire(world);

    this._syncNode();
  }

  _syncNode() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    if (this.parts.turret) this.parts.turret.rotation.y = SF.Util.angDiff(this.yaw, this.turretYaw);
    if (this.parts.gun) {
      if (this.parts.noTurret) this.parts.gun.rotation.y = SF.Util.angDiff(this.yaw, this.turretYaw);   // 歼击车: 炮管在射界内横摆
      this.parts.gun.rotation.x = -this.gunPitch;  // gunPitch 已是车体相对角
    }
  }

  /* 履带滚动: 负重轮旋转 + 履带纹理滚动(本地模拟与联机幽灵共用) */
  animateTracks(dt) {
    if (this.parts.wheels) for (const w of this.parts.wheels) w.node.rotation.x += (this.speed * dt) / w.r;
    if (this.parts.trackTex) {
      this.trackOffset = (this.trackOffset - this.speed * dt / 4.0) % 1;
      this.parts.trackTex.offset.x = this.trackOffset;
    }
  }

  /* 联机客户端: 由主机快照插值直接驱动姿态(不跑本地物理) */
  ghostPose(pose, dt) {
    if (!pose.alive && this.alive) { this.alive = false; }
    if (pose.alive && !this.alive) {   // 主机已让该坦克重生 → 客户端换新模型归队
      if (SF.Game && SF.Game.scene) {
        SF.Game.scene.remove(this.group);
        this.rebuild();
        SF.Game.scene.add(this.group);
      } else this.alive = true;
    }
    if (!this.alive) { this._deathFx(dt); return; }
    this.x = pose.x; this.z = pose.z; this.y = pose.y;
    this.yaw = pose.yaw; this.turretYaw = pose.tur; this.gunPitch = pose.pitch;
    this.speed = pose.speed; this.hp = pose.hp;
    this.animateTracks(dt);
    this._syncNode();
  }

  /* 死斗重生: 换新模型(清除残骸状态), 由调用方重新加入场景 */
  rebuild() {
    const keep = { x: this.x, z: this.z, yaw: this.yaw, netId: this.netId, isPlayer: this.isPlayer, team: this.team, type: this.type };
    this.parts = SF.Models.makeTank(this.type);
    this.group = this.parts.root;
    this.x = keep.x; this.z = keep.z; this.yaw = keep.yaw; this.netId = keep.netId; this.isPlayer = keep.isPlayer; this.team = keep.team;
    this.speed = 0; this.turretYaw = this.yaw; this.gunPitch = 0;
    this.pitch = 0; this.roll = 0; this.y = 0; this._yInit = false;
    this.hp = this.spec.hp; this.alive = true; this.reloadT = 1; this.reloadTotal = 1;
    if (this.spec.gun.autoloader) { this.clipLeft = this.spec.gun.autoloader.clip; this.clipPhase = 'intra'; }
    this.disp = this.spec.dispersion.max;
    this.modules = { track: 0, engine: 0, gun: 0, ammo: 0 };
    this._wreck = null; this._deadTinted = false;
    this.velX = 0; this.velZ = 0; this.trackOffset = 0;
  }

  muzzleWorld() {
    this.group.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    this.parts.muzzle.getWorldPosition(p);
    return p;
  }

  gunDir() {
    this.group.updateMatrixWorld(true);
    const q = new THREE.Quaternion();
    this.parts.gun.getWorldQuaternion(q);
    return new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  }

  /* --- 开炮: 弹速有限 + 散布锥 --- */
  fire(world) {
    if (!this.alive || this.reloadT > 0) return false;
    const S = this.spec;
    const al = S.gun.autoloader;
    const rack = this.modules.ammo > 0 ? (SF.CFG.armor.modules.ammo.reloadMult || 1) : 1;   // 弹药架受损: 装填永久变慢
    if (al) {
      if (this.clipLeft > 1) { this.clipLeft--; this.reloadT = al.intra * rack; this.clipPhase = 'intra'; }
      else { this.clipLeft = al.clip; this.reloadT = al.long * rack; this.clipPhase = 'long'; }   // 打完最后一发 → 整夹长装填
    } else this.reloadT = S.gun.reload * rack;
    this.reloadTotal = this.reloadT;
    this.stats.shots++;
    let disp = this.disp;
    if (this.modules.gun > 0) disp *= SF.CFG.armor.modules.gun.dispPenalty;
    this.disp = Math.min(S.dispersion.max, S.dispersion.base + S.dispersion.fire); // 开炮瞬间扩圈
    const pos = this.muzzleWorld(), dir = this.gunDir();
    world.shells.spawn(this, pos, dir, disp);
    SF.Bus.emit('fire', { tank: this, pos: pos.clone(), dir: dir.clone() });
    return true;
  }

  /* --- 承弹: 部位查表装甲判定(WoT 对齐) ---
     过穿: 口径>3倍装甲永不跳弹; >2倍归一化(5°)翻倍
     部位化模块: 打中履带必断(未击穿=履带吸收0伤), 炮管吸收弹丸(0伤+火炮损),
     打发动机舱(尾甲)/动力甲板伤发动机, 弹药架掷点=殉爆加伤+装填永久变慢
     hitInfo: {zone, armor, point, normal(世界法线), dir(炮弹方向)} */
  takeHit(shooter, shellSpec, hitInfo) {
    const A = SF.CFG.armor;
    const result = { target: this, shooter, point: hitInfo.point, zone: hitInfo.zone, dmg: 0, kind: 'nopen', module: null };
    const incidence = Math.acos(Math.min(1, Math.max(-1, -U_cos(hitInfo.dir, hitInfo.normal)))); // 与法线夹角
    const armor = hitInfo.armor || 0, cal = shellSpec.cal || 75;
    const setMod = (k, permanent) => { this.modules[k] = permanent ? Infinity : A.modules[k].duration; };

    const over3 = armor > 0 && cal > armor * 3;                    // 3 倍口径: 永不跳弹
    let inc = Math.abs(incidence);
    let norm = 5 * Math.PI / 180;                                  // AP 归一化 5°
    if (armor > 0 && cal > armor * 2) norm *= 2;                   // 2 倍口径: 归一化翻倍
    const eff = armor / Math.max(Math.cos(Math.max(0, inc - norm)), 0.05);   // 等效装甲
    const pen = shellSpec.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
    const rico = armor > 0 && !over3 && inc > A.ricochetAngle;
    const rollDmg = () => Math.round(shellSpec.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance));

    if (hitInfo.zone === 'gun') {
      // WoT: 炮管吸收弹丸 — 火炮受损(永久), 不掉血
      setMod('gun', true); result.kind = 'gun'; result.module = 'gun';
    } else if (hitInfo.zone === 'tracks') {
      // WoT 履带: 打中即断; 击穿照常掉血, 未击穿=履带吸收(断带但 0 伤)
      setMod('track'); result.module = 'track';
      if (rico) result.kind = 'bounce';
      else if (pen >= eff) { result.kind = 'pen'; result.dmg = rollDmg(); this.hp -= result.dmg; }
      else result.kind = 'absorb';
    } else if (rico) {
      result.kind = 'bounce'; result.dmg = 0;                        // 跳弹
    } else if (pen >= eff) {
      result.kind = 'pen';                                          // 击穿
      let dmg = shellSpec.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance);
      if (Math.random() < A.modules.ammo.chance) {                  // 弹药架: 殉爆加伤 + 装填永久变慢
        dmg *= A.modules.ammo.dmgMult; result.module = 'ammo'; setMod('ammo', true);
      } else if ((hitInfo.zone === 'hullRear' && Math.random() < A.modules.engine.rearChance) ||
                 (hitInfo.zone === 'hullTop' && Math.random() < A.modules.engine.deckChance)) {
        result.module = 'engine'; setMod('engine', true);           // 打发动机舱/动力甲板: 永久减速
      }
      result.dmg = Math.round(dmg);
      this.hp -= dmg;
    } else { result.kind = 'nopen'; result.dmg = 0; }

    if (this.hp <= 0 && this.alive) {
      this.hp = 0; this.alive = false;
      SF.Bus.emit('destroyed', { tank: this, shooter });
    }
    if (this.ai && this.alive && shooter && shooter.team !== this.team) this.ai.onHurt(shooter);   // 被打感知: 中弹即知道大致来向
    SF.Bus.emit('hit', result);
    return result;
  }

  /* --- 溅射承伤(自行火炮 HE): 无穿深判定, 按距离衰减的固定伤害 --- */
  takeSplash(shooter, dmg, point) {
    if (!this.alive) return;
    dmg = Math.max(0, Math.round(dmg));
    if (dmg <= 0) {   // 厚甲完全吸收(WoT: 击中未穿透)
      SF.Bus.emit('hit', { target: this, shooter, point, zone: 'splash', dmg: 0, kind: 'splash', module: null });
      return;
    }
    this.hp -= dmg;
    if (this.hp <= 0 && this.alive) {
      this.hp = 0; this.alive = false;
      SF.Bus.emit('destroyed', { tank: this, shooter });
    }
    if (this.ai && this.alive && shooter && shooter.team !== this.team) this.ai.onHurt(shooter);
    SF.Bus.emit('hit', { target: this, shooter, point, zone: 'splash', dmg, kind: 'splash', module: null });
  }

  /* --- 撞击承伤: 无装甲判定, 直接掉血(高速重车碾压) --- */
  takeRam(shooter, dmg) {
    if (!this.alive || dmg <= 0) return;
    this.hp -= dmg;
    if (this.hp <= 0 && this.alive) {
      this.hp = 0; this.alive = false;
      SF.Bus.emit('destroyed', { tank: this, shooter });
    }
    if (this.ai && this.alive && shooter && shooter.team !== this.team) this.ai.onHurt(shooter);
    SF.Bus.emit('hit', { target: this, shooter, point: new THREE.Vector3(this.x, this.y + 1, this.z), zone: 'ram', dmg, kind: 'ram', module: null });
  }

  // 撞击质量估算(吨): 车型密度 × 车体投影面积(谢尔曼规格=1)
  _mass() {
    const DENS = { LT: 14, MT: 32, HT: 48, TD: 34, SPG: 24 };
    return (DENS[this.spec.cls] || 32) * (this.spec.sample.l * this.spec.sample.w) / (3.05 * 1.45);
  }

  // 被击毁 → 残骸形态: 沉降侧倾(悬挂塌) + 炮塔歪斜卡死 + 炮管下垂 + 烧漆斑驳 + 烟与余烬
  _deathFx(dt) {
    if (!this._wreck) {
      this._wreck = {
        t: 0, y0: this.y,
        roll0: this.roll, rollT: this.roll + (Math.random() < 0.5 ? -1 : 1) * (0.07 + Math.random() * 0.09),
        tur0: this.parts.turret ? this.parts.turret.rotation.y : 0,
        turT: this.parts.turret ? (Math.random() - 0.5) * 1.2 : 0,
        gun0: this.parts.gun ? this.parts.gun.rotation.x : 0,
        gunT: this.parts.gun ? this.parts.gun.rotation.x + 0.05 + Math.random() * 0.06 : 0,
        tinted: false
      };
    }
    const w = this._wreck;
    w.t += dt;
    const e = 1 - Math.pow(1 - Math.min(1, w.t / 1.2), 3);   // 缓出沉降
    this.y = w.y0 - 0.22 * e;
    this.roll = w.roll0 + (w.rollT - w.roll0) * e;
    if (this.parts.turret) this.parts.turret.rotation.y = w.tur0 + (w.turT - w.tur0) * e;
    if (this.parts.gun) this.parts.gun.rotation.x = w.gun0 + (w.gunT - w.gun0) * e;
    if (!w.tinted && w.t > 0.6) {
      w.tinted = true;
      this.group.traverse(o => {           // 烧黑斑驳: 每件网格随机深浅
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.color.multiplyScalar(0.24 + Math.random() * 0.14);
        }
      });
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0 && SF.Game && SF.Game.fx) {
      SF.Game.fx.smoke(this.x, this.y + 2, this.z, 1.5);
      if (w.t < 12) SF.Game.fx.burst(new THREE.Vector3(this.x + (Math.random() - 0.5), this.y + 1.6, this.z + (Math.random() - 0.5)), [1, 0.5, 0.12], 3, 2.5, 1.2);  // 余烬火星
      this.smokeT = w.t < 12 ? 0.55 : 1.1;
    }
  }
};

function U_cos(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
