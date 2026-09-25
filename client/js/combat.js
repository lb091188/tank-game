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
    const last = shell.trailPts[shell.trailPts.length - 1];
    if (!last || last.distanceTo(shell.pos) > 8) {
      shell.trailPts.push(shell.pos.clone());
      if (shell.trailPts.length > 7) shell.trailPts.shift();
      this.burst(shell.pos, shell.trailCol, 1, 0.5, 0.1);   // 沿途微粒子增粗观感
    }
    const pts = [...shell.trailPts, shell.pos].slice(-8);
    const pos = line.geometry.attributes.position, col = line.geometry.attributes.color;
    const off = 8 - pts.length;
    for (let i = 0; i < 8; i++) {
      const pt = pts[Math.max(0, i - off)];
      pos.setXYZ(i, pt.x, pt.y, pt.z);
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

/* ---------- 炮弹系统 ---------- */
SF.Shells = class {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.list = [];
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
  }

  spawn(owner, pos, dir, dispM) {
    // 散布: 圆内随机偏转(米@100m → 弧度近似)
    const ang = (dispM / 100) * Math.sqrt(Math.random());
    const rot = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const d = dir.clone().addScaledVector(right, Math.cos(rot) * ang).addScaledVector(up, Math.sin(rot) * ang).normalize();
    const spec = owner.spec.gun;
    const shell = {
      active: true, owner, team: owner.team,
      pos: pos.clone(), vel: d.clone().multiplyScalar(spec.speed),
      pen: spec.pen, dmg: spec.dmg, life: 4, tracer: null
    };
    this.list.push(shell);
    this.fx.acquireTrail(shell);
  }

  update(dt, world) {
    const T = world.terrain;
    for (const sh of this.list) {
      if (!sh.active) continue;
      sh.life -= dt;
      if (sh.life <= 0) { this._kill(sh); continue; }

      const next = sh.pos.clone().addScaledVector(sh.vel, dt);
      sh.vel.y -= SF.CFG.sim.shellGravity * dt;
      const seg = next.clone().sub(sh.pos), segLen = seg.length();
      const segDir = seg.clone().normalize();

      // --- 收集最近命中 ---
      let hitT = Infinity, hitType = null, hitData = null;

      // 地形(沿段采样)
      const steps = Math.max(1, Math.ceil(segLen / 2));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const px = sh.pos.x + seg.x * t, py = sh.pos.y + seg.y * t, pz = sh.pos.z + seg.z * t;
        if (py <= T.heightAt(px, pz)) { if (t < hitT) { hitT = t; hitType = 'ground'; } break; }
      }

      // 掩体
      const coverT = world.covers.blocked(sh.pos.x, sh.pos.z, sh.pos.y, segDir.x, segDir.z, segLen, segDir.y);
      if (coverT >= 0 && coverT / segLen < hitT) { hitT = coverT / segLen; hitType = 'cover'; }

      // 坦克部位网格(先粗筛包围球: 线段上离圆心最近点)
      for (const tk of world.tanks) {
        if (!tk.alive || tk.team === sh.team) continue;
        const c = tk.pos3;
        const oc = new THREE.Vector3().subVectors(c, sh.pos);   // 圆心相对炮弹起点
        const proj = U_cl(U_dot(oc, segDir), 0, segLen);
        const closest = sh.pos.clone().addScaledVector(segDir, proj);
        if (closest.distanceTo(c) > 3.6) continue;
        tk.group.updateMatrixWorld(true);   // 确保部位网格世界矩阵与模拟状态一致
        this.ray.set(sh.pos, segDir); this.ray.far = segLen;
        const hits = this.ray.intersectObjects(tk.parts.zones, false);
        if (hits.length && hits[0].distance / segLen < hitT) {
          const h = hits[0];
          hitT = h.distance / segLen; hitType = 'tank'; hitData = { tank: tk, hit: h };
        }
      }

      // --- 处理命中 ---
      if (hitType) {
        const p = sh.pos.clone().addScaledVector(segDir, hitT * segLen - 0.05);
        if (hitType === 'tank') {
          const { tank, hit } = hitData;
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
          tank.takeHit(sh.owner, { pen: sh.pen, dmg: sh.dmg }, {
            zone: hit.object.userData.zone, armor: hit.object.userData.armor || 0,
            point: hit.point, normal, dir: segDir
          });
        } else {
          this.fx.impact(hitType === 'ground' ? 'ground' : 'cover', p);
          if (sh.owner.isPlayer) SF.Bus.emit('playerMiss', { point: p });   // 打飞了也要有反馈
        }
        this._kill(sh);
        continue;
      }

      // 敌方炮弹飞近 → 炮口来向指示(一次性)
      if (world.player && sh.team !== world.player.team && !sh.warned) {
        const dPlayer = Math.hypot(sh.pos.x - world.player.x, sh.pos.z - world.player.z);
        if (dPlayer < 45) { sh.warned = true; SF.Bus.emit('shellFrom', { x: sh.owner.x, z: sh.owner.z }); }
      }
      sh.pos.copy(next);
      this.fx.updateTrail(sh);
    }
    this.list = this.list.filter(s => s.active);
  }

  _kill(sh) {
    sh.active = false;
    if (sh.trailLine) { sh.trailLine.visible = false; sh.trailLine = null; }
  }
};

function U_dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function U_cl(v, a, b) { return Math.max(a, Math.min(b, v)); }
