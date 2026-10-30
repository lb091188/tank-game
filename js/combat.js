// combat.js — 炮弹系统(分段射线/下坠/命中判定) + 特效对象池(曳光/火花/烟/闪光)
window.SF = window.SF || {};

/* ---------- 特效池 ---------- */
SF.FX = class {
  constructor(scene) {
    this.scene = scene;

    // 粒子池(THREE.Points 单实例, CPU 更新)
    this.P_MAX = 500;
    this.pPos = new Float32Array(this.P_MAX * 3);
    this.pCol = new Float32Array(this.P_MAX * 3);
    this.pVel = []; this.pLife = new Float32Array(this.P_MAX); this.pMax = new Float32Array(this.P_MAX);
    for (let i = 0; i < this.P_MAX; i++) this.pVel.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pCursor = 0;

    // 光晕贴图(火花/闪光/烟共用源)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    const grad = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = grad; cx.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(cv);

    // 烟雾 sprite 池
    this.smokes = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x2a2a2a, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; scene.add(m);
      this.smokes.push({ s: m, life: 0, max: 1, vy: 1, vx: 0, vz: 0 });
    }
    // 炮弹轨迹线池(8 点渐隐拖尾, 加色混合; 己方金色/敌方橙红)
    this.trailPool = [];
    for (let i = 0; i < 30; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.visible = false; line.frustumCulled = false;
      scene.add(line);
      this.trailPool.push(line);
    }
    // 闪光 sprite 池
    this.flashes = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffcf7a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; scene.add(m);
      this.flashes.push({ s: m, life: 0 });
    }
  }

  burst(p, color, n, speed, up = 0.5) {
    for (let k = 0; k < n; k++) {
      const i = this.pCursor = (this.pCursor + 1) % this.P_MAX;
      this.pPos[i * 3] = p.x; this.pPos[i * 3 + 1] = p.y; this.pPos[i * 3 + 2] = p.z;
      this.pCol[i * 3] = color[0]; this.pCol[i * 3 + 1] = color[1]; this.pCol[i * 3 + 2] = color[2];
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1), sp = speed * (0.4 + Math.random() * 0.8);
      this.pVel[i].set(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * up + up, Math.sin(ph) * Math.sin(th) * sp);
      this.pLife[i] = this.pMax[i] = 0.35 + Math.random() * 0.4;
    }
  }

  smoke(x, y, z, big = 1) {
    const it = this.smokes.find(s => s.life <= 0);
    if (!it) return;
    it.life = it.max = 1.6 * big;
    it.vy = 1.6; it.vx = (Math.random() - 0.5) * 0.6; it.vz = (Math.random() - 0.5) * 0.6;
    it.s.position.set(x, y, z); it.s.scale.setScalar(1.5 * big); it.s.visible = true;
  }

  flash(p, size = 2.2, color = 0xffcf7a) {
    const it = this.flashes.find(f => f.life <= 0);
    if (!it) return;
    it.life = 0.08; it.s.position.copy(p); it.s.scale.setScalar(size);
    it.s.material.color.setHex(color); it.s.material.opacity = 1; it.s.visible = true;
  }

  acquireTrail(shell) {
    const line = this.trailPool.find(l => !l.visible);
    if (!line) return;
    const hostile = shell.team !== (SF.Game && SF.Game.world ? SF.Game.world.player.team : 0);
    shell.trailCol = hostile ? [1, 0.42, 0.12] : [1, 0.85, 0.45];
    shell.trailPts = [];
    shell.trailLine = line;
    const pos = line.geometry.attributes.position;
    for (let i = 0; i < 8; i++) pos.setXYZ(i, shell.pos.x, shell.pos.y, shell.pos.z);
    pos.needsUpdate = true;
    line.visible = true;
  }

  updateTrail(shell) {
    const line = shell.trailLine;
    if (!line) return;
    // 鹰眼俯视相机在弧顶之下: 高于相机平面的拖尾点会穿过视锥近平面, 被透视放大成
    // 横扫屏幕/镜像到对侧角落的巨线 —— 钳到相机平面以下(拖尾贴着视野上限沿弹道方向走)
    const clampY = (SF.Game && SF.Game.trailClampY) || Infinity;
    const last = shell.trailPts[shell.trailPts.length - 1];
    if (!last || last.distanceTo(shell.pos) > 8) {
      shell.trailPts.push(shell.pos.clone());
      if (shell.trailPts.length > 7) shell.trailPts.shift();
      if (shell.pos.y <= clampY) this.burst(shell.pos, shell.trailCol, 1, 0.5, 0.1);   // 沿途微粒子增粗观感
    }
    const pts = [...shell.trailPts, shell.pos].slice(-8);
    const pos = line.geometry.attributes.position, col = line.geometry.attributes.color;
    const off = 8 - pts.length;
    for (let i = 0; i < 8; i++) {
      const pt = pts[Math.max(0, i - off)];
      pos.setXYZ(i, pt.x, Math.min(pt.y, clampY), pt.z);
      const k = 0.12 + 0.88 * Math.max(0, (i - off + 1) / 8);   // 尾暗头亮
      col.setXYZ(i, shell.trailCol[0] * k, shell.trailCol[1] * k, shell.trailCol[2] * k);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  impact(kind, p) {
    const C = { pen: [1, 0.55, 0.1], bounce: [1, 1, 1], nopen: [0.65, 0.65, 0.6], gun: [1, 0.8, 0.3], ground: [0.55, 0.48, 0.36], cover: [0.5, 0.45, 0.3] };
    this.burst(p, C[kind] || C.ground, kind === 'pen' || kind === 'ground' ? 14 : 8, kind === 'ground' ? 4 : 7);
    if (kind === 'pen') this.flash(p, 1.6, 0xffb060);
  }

  explosion(p) {
    this.burst(p, [1, 0.6, 0.2], 26, 9, 1);
    this.burst(p, [0.3, 0.3, 0.3], 14, 5, 1.2);
    this.flash(p, 5, 0xffc070);
    this.smoke(p.x, p.y + 1, p.z, 2.2);
  }

  update(dt) {
    // 粒子
    for (let i = 0; i < this.P_MAX; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const v = this.pVel[i];
      v.y -= 9.8 * dt * 0.6;
      this.pPos[i * 3] += v.x * dt; this.pPos[i * 3 + 1] += v.y * dt; this.pPos[i * 3 + 2] += v.z * dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -100; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    // 烟
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.s.position.y += s.vy * dt; s.s.position.x += s.vx * dt; s.s.position.z += s.vz * dt;
      s.s.scale.multiplyScalar(1 + dt * 0.5);
      s.s.material.opacity = 0.45 * Math.max(0, s.life / s.max);
      if (s.life <= 0) s.s.visible = false;
    }
    // 闪光
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt; f.s.material.opacity = Math.max(0, f.life / 0.08);
      if (f.life <= 0) f.s.visible = false;
    }
  }
};

/* ---------- 炮弹系统(表现/判定壳) ----------
   弹的数值(散布偏转/分段积分/下坠/地形/掩体遮挡/近弹粗筛/部位命中)全在 sim-engine 弹场(零 THREE,
   服务端权威可复用); 本类只保留表现钩子(拖尾/火花/爆炸音)。阶段2 起 弹-车精确命中走
   SF.SimEngine.probeTankOBB(部位盒表 3D 线段-OBB 求交, 评审修改要求#3: Util.rayObb 是 2D XZ slab
   无 pitch/法线/命中点不可用) —— 浏览器与服务器同一实现, 判中后调 vehicle.takeHit 结算。 */
SF.Shells = class {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.list = [];                     // 兼容别名(指向引擎弹场, 供调试/既有引用)
    this.field = SF.SimEngine.makeShells({
      onCreate: (sh) => {               // 表现侧: pos/vel 换 THREE 向量(拖尾 clone/addScaledVector 需要)
        sh.pos = new THREE.Vector3(sh.pos.x, sh.pos.y, sh.pos.z);
        sh.vel = new THREE.Vector3(sh.vel.x, sh.vel.y, sh.vel.z);
        this.fx.acquireTrail(sh);
      },
      onFlight: (sh) => this.fx.updateTrail(sh),
      onImpact: (kind, p) => this.fx.impact(kind, p),
      onPlayerMiss: (p) => SF.Bus.emit('playerMiss', { point: p }),
      onNearMiss: (sh) => SF.Bus.emit('shellFrom', { x: sh.owner.x, z: sh.owner.z }),
      onKill: (sh) => { if (sh.trailLine) { sh.trailLine.visible = false; sh.trailLine = null; } },
      // 弹-车精确命中(注入回调): 部位 OBB 3D 求交 → {distance, point, normal(世界面法线), zone, armor} | null
      probeTank: (sh, tk, ox, oy, oz, dx, dy, dz, segLen) =>
        SF.SimEngine.probeTankOBB(tk, ox, oy, oz, dx, dy, dz, segLen),
      // takeHit 的 hitInfo.point/normal 会进 Bus 事件(HUD.dmgNumber 对 point 调 .clone()), 保持 THREE 向量契约
      onHitTank: (sh, tk, hit, segDir) => tk.takeHit(sh.owner, { pen: sh.pen, dmg: sh.dmg, cal: sh.cal },
        { zone: hit.zone, armor: hit.armor,
          point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z),
          normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
          dir: new THREE.Vector3(segDir.x, segDir.y, segDir.z) }),
      onExplode: (sh, p, directTank, directArmor) =>
        this._explodeHE(sh, new THREE.Vector3(p.x, p.y, p.z), this._world, directTank, directArmor)
    });
  }

  // 兼容入口(旧调用方 vehicle.fire → 已改走引擎; 保留防外部直调)
  spawn(owner, pos, dir, dispM) { return this.field.spawn(owner, pos, dir, dispM); }

  update(dt, world) {
    this._world = world;                // HE 溅射结算需要 world(取坦克表)
    this.field.update(dt, {
      heightAt: world.terrain.heightAt,
      coversBlocked: (ox, oz, oy, dx, dz, len, dy) => world.covers.blocked(ox, oz, oy, dx, dz, len, dy),
      tanks: world.tanks,
      playerPos: world.player,
      playerTeam: world.player ? world.player.team : 0
    });
    this.list = this.field.list;
  }

  /* --- 火炮 HE 溅射: 爆炸特效 + 范围伤害(直接命中过装甲判定, 周围按距离衰减) --- */
  _explodeHE(sh, p, world, directTank, directArmor = 0) {
    this.fx.explosion(p);
    SF.Audio.play('explosion', p, { gain: directTank ? 1.3 : 1.0 });
    const A = SF.CFG.armor;
    const alpha = sh.dmg * (1 + (Math.random() * 2 - 1) * A.dmgVariance);   // 单发 ±25%(WoT)
    for (const tk of world.tanks) {
      if (!tk.alive || tk.team === sh.team) continue;
      const d = Math.hypot(tk.x - p.x, (tk.y + 1.2) - p.y, tk.z - p.z);
      if (d > sh.splash) continue;
      if (tk === directTank) {
        // WoT HE 直击: 掷穿深 — 穿透全额; 穿不透按装甲衰减, 厚甲可完全吸收
        const pen = sh.pen * (1 + (Math.random() * 2 - 1) * A.penVariance);
        if (pen >= directArmor) tk.takeSplash(sh.owner, alpha, p);
        else tk.takeSplash(sh.owner, alpha * 0.5 * Math.max(0, 1 - directArmor / (1.1 * Math.max(pen, 1))), p);
        continue;
      }
      tk.takeSplash(sh.owner, alpha * (1 - 0.65 * d / sh.splash), p);
    }
  }
};

function U_dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function U_cl(v, a, b) { return Math.max(a, Math.min(b, v)); }
