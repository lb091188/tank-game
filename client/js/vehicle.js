// vehicle.js — 车辆表现壳: 数值模拟委托 sim-engine(阶段1 提取), 本文件保留模型/网格/受击结算
// 玩家键鼠与 AI 喂同一个 input 接口: {throttle, steer, aimYaw, aimPitch, fire}
window.SF = window.SF || {};

// 模拟→总线的事件适配器: 引擎发纯数值点位, 浏览器侧包装成 THREE 向量
// (HUD.dmgNumber 对 point 调 .clone(), fx/audio 只读分量 —— 与旧版事件形状保持一致)
function emitBus(ev, d) {
  if (d && d.point && !d.point.isVector3) d.point = new THREE.Vector3(d.point.x, d.point.y, d.point.z);
  SF.Bus.emit(ev, d);
}
// 引擎钩子(静态, 不逐帧新建): 履带表现 + 撞击承伤 + 事件包装
const SIM_HOOKS = {
  onMoved: (t, dt) => t.animateTracks(dt),
  takeRam: (target, shooter, dmg) => target.takeRam(shooter, dmg),
  emit: emitBus
};

SF.Tank = class {
  constructor(type, opts) {
    const U = SF.Util;
    this.type = type;
    this.spec = opts.spec || SF.CFG.vehicles[type];   // opts.spec: PVE 修改器克隆 spec(不动全局配置)
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
    this.gear = 'D1'; this.shiftT = 0; this.flipT = 0;   // 自动变速箱: D1-D3 前进三挡 / R1-R2 倒车两挡; 换向切最高挡+1s 最大扭矩窗口
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
    if (!this.alive) { this._deathFx(dt); this._syncNode(); return; }
    // 数值模拟(行驶/自动挡/转向/车车碰撞/掩体碰撞/地形贴合/坠落摔伤/瞄准/装填)在 sim-engine,
    // 本壳只喂世界环境 + 在同位序接表现钩子(履带滚动) —— sp 路径行为零变化(golden-trace 对账)
    SF.SimEngine.updateTank(this, input, dt, {
      terrain: world.terrain, coversList: world.covers.list, tanks: world.tanks, time: world.time,
      onMoved: SIM_HOOKS.onMoved, takeRam: SIM_HOOKS.takeRam, emit: SIM_HOOKS.emit
    });
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
    this.gear = 'D1'; this.shiftT = 0;
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

  /* --- 开炮: 弹速有限 + 散布锥(数值段在 sim-engine.fire; 炮口世界位姿属表现侧, 留在本壳) --- */
  fire(world) {
    if (!this.alive || this.reloadT > 0) return false;
    const pos = this.muzzleWorld(), dir = this.gunDir();
    return SF.SimEngine.fire(this, world, pos, dir, emitBus);
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

  // 撞击质量估算(吨): 单一实现移入 sim-engine.massOf(引擎车车撞击段同源)
  _mass() { return SF.SimEngine.massOf(this.spec); }

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
