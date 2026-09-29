// models.js — GLB 坦克装配(炮塔/火炮枢轴驱动) + 掩体程序化建模与碰撞注册表
window.SF = window.SF || {};

SF.Models = (() => {
  const lambert = (rgb) => new THREE.MeshLambertMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) });
  // 带贴图的材质(ambientCG CC0): 颜色作色调乘在贴图上; 同名同 repeat 共享纹理实例; 无贴图退回纯色
  const texCache = {};
  const texMat = (rgb, texKey, rx = 1, ry = 1) => {
    const base = texKey && SF.Assets && SF.Assets.textures[texKey];
    const opts = { color: new THREE.Color(rgb[0], rgb[1], rgb[2]) };
    if (base) {
      const k = texKey + '_' + rx + 'x' + ry;
      let t = texCache[k];
      if (!t) { t = texCache[k] = base.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); }
      opts.map = t;
    }
    return new THREE.MeshLambertMaterial(opts);
  };
  // 开镜去遮挡(全局): 草丛半透明+不投影, 由 main.toggleSniper 切换, 新建的草丛直接按此状态建
  let bushSeeThrough = false;
  const bushMats = () => geoCache.bushMats || [];

  /* ---------- 坦克: 克隆 GLB, 提取枢轴与部位网格 ---------- */
  function makeTank(type) {
    const src = SF.Assets.models[type];
    if (!src) throw new Error(`未知坦克类型: ${type}`);
    const root = src.clone(true);
    const parts = { root, turret: null, gun: null, muzzle: null, zones: [], wheels: [], trackTex: null };
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        if (o.geometry.attributes.color && o.material) {   // V2 顶点色(迷彩/做旧)兼容
          o.material.vertexColors = true;
          o.material.needsUpdate = true;
        }
        const zone = o.userData && o.userData.zone;  // GLTFLoader 把节点 extras 放进 userData
        if (zone) {
          parts.zones.push(o);
          if (zone === 'tracks' && o.material) {     // 履带滚动纹理: 每车独立材质/纹理实例(offset 独立)
            o.material = o.material.clone();
            if (o.material.map) {
              o.material.map = o.material.map.clone();
              o.material.map.needsUpdate = true;
              parts.trackTex = o.material.map;
            }
          }
        }
        if (o.userData && o.userData.wheelR) parts.wheels.push({ node: o, r: o.userData.wheelR });  // 独立旋转轮
      } else if (o.name === 'turret') parts.turret = o;
      else if (o.name === 'gun') parts.gun = o;
      else if (o.name === 'muzzle') parts.muzzle = o;
    });
    parts.noTurret = !parts.turret;
    if (parts.noTurret && parts.gun) parts.gun.rotation.order = 'YXZ';   // 歼击车: 炮管需在射界内横摆(先 yaw 后 pitch)
    parts.outline = buildOutline(root);   // 瞄准轮廓(WoT 红色剪影), 默认隐藏
    return parts;
  }

  /* ---------- 瞄准轮廓(WoT 式红色剪影): 反转外壳 + 法线外扩定厚 ----------
     轮廓网格挂在原网格的同父节点并拷贝其局部变换 → 炮塔/火炮旋转自动同步;
     默认隐藏, 由 main 按准星命中开关; 不投影、不参与任何射线 */
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0xff2d1f, side: THREE.BackSide, depthWrite: false });
  outlineMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed += normal * 0.11;');
  };
  function buildOutline(root) {
    const src = [];
    root.traverse(o => { if (o.isMesh) src.push(o); });   // 先收集后挂载, 避免遍历时改树
    const meshes = src.map(o => {
      const m = new THREE.Mesh(o.geometry, outlineMat);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      m.raycast = () => {};   // 命中判定/瞄准点射线都只查 zones, 双保险
      m.visible = false;
      o.parent.add(m);
      return m;
    });
    return { meshes, set(v) { for (const m of meshes) m.visible = v; } };
  }

  /* ---------- 掩体: 按 map.json 的 type 程序化建模 ----------
     碰撞: blocksMove 挡车体 / blocksShells 挡弹 / blocksSpot 挡点亮视线
     WoT 对齐: 只有石墙/岩石/建筑真正吸弹; 草本软质物(草丛/树篱/草垛)能直接压过且挡视线当隐蔽, 炮弹直接穿过; 残骸挡车不挡弹 */
  const geoCache = {};
  // 确定性伪随机(每个掩体实例稳定变化, 不随刷新抖动)
  const srand = (seed) => { let t = seed * 9301 + 49297; return () => { t = (t * 9301 + 49297) % 233280; return t / 233280; }; };
  const hash = (x, z) => (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;

  // 拟物化: 石砌墙体(底宽顶窄+起伏+分段错缝) —— house/ruin/wall 共用
  function stoneWallMats() {
    return stoneWallMats.m || (stoneWallMats.m = [
      texMat([0.82, 0.80, 0.76], 'rock', 2.2, 1.4),
      texMat([0.72, 0.70, 0.66], 'rock', 2.2, 1.4),
      texMat([0.88, 0.86, 0.82], 'rock', 2.2, 1.4),
    ]);
  }
  // 三角山墙棱柱(精确截面, 代替易穿模的圆柱 hack): w=沿房宽, h=山墙高, d=跨房深; 内缩 inset 防戳出瓦面
  function gableGeo(w, h, d) {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, h); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);   // 挤出方向 Z → X(沿房宽)
    return g;
  }
  function buildStonewall(g, w, h, thick, seed) {
    const rng = srand(seed);
    const mats = stoneWallMats();
    const SEG = Math.max(3, Math.round(w / 1.4));          // 1.4m 一段
    const sw = w / SEG;
    for (let i = 0; i < SEG; i++) {
      const segH = h * (0.86 + rng() * 0.24);              // 每段高低起伏
      const lean = (rng() - 0.5) * 0.05;                   // 轻微倾斜
      const seg = new THREE.Mesh(new THREE.BoxGeometry(sw * (1 + rng() * 0.06), segH, thick * (0.92 + rng() * 0.16)), mats[i % 3]);
      seg.position.set(-w / 2 + sw * (i + 0.5), segH / 2, (rng() - 0.5) * thick * 0.08);
      seg.rotation.z = lean;
      g.add(seg);
    }
    // 顶部碎石压边
    for (let i = 0; i < SEG; i += 2) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(sw * 0.7, 0.16, thick * 1.05), mats[(i + 1) % 3]);
      r.position.set(-w / 2 + sw * (i + 0.5), h * (0.93 + rng() * 0.05), 0);
      r.rotation.y = (rng() - 0.5) * 0.1;
      g.add(r);
    }
  }
  function buildCover(c, terrain) {
    const y = terrain.heightAt(c.x, c.z);
    const g = new THREE.Group();
    g.position.set(c.x, y, c.z);
    g.rotation.y = c.yaw || 0;
    let col = { type: c.type, blocksMove: true, blocksShells: true, x: c.x, z: c.z, r: 2, h: 3, shape: 'circle', yaw: c.yaw || 0 };
    // 方形掩体用 OBB 一比一碰撞(hx 半宽·局部x / hz 半长·局部z), r 退化为包围圆(快速剔除用)
    const OBB = (hx, hz) => ({ shape: 'box', hx, hz, yaw: c.yaw || 0, r: Math.hypot(hx, hz) });

    if (c.type === 'house') {
      const s = (c.scale || 1);
      const W = 7 * s, D = 5.5 * s, H = 3.4;
      const wallMats = [texMat([0.92, 0.88, 0.78], 'concrete', 1.8, 1.1), texMat([0.85, 0.78, 0.66], 'brick', 1.8, 1.1)];
      const wallM = wallMats[Math.abs(hash(c.x, c.z) | 0) % 2];
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallM);
      body.position.y = H / 2;
      // 人字坡屋顶(双斜面, 出檐)
      const roofM = texMat([0.72, 0.50, 0.44], 'brick', 2.4, 0.9);
      const roofL = 1.9 * s, rH = 1.8 * s;
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5 * s, 0.22, Math.sqrt((D / 2 + roofL * 0.3) ** 2 + rH ** 2)), roofM);
      roof1.position.set(0, H + rH / 2, D / 4);
      roof1.rotation.x = Math.atan2(rH, D / 2);
      const roof2 = roof1.clone(); roof2.position.z = -D / 4; roof2.rotation.x = -roof1.rotation.x;
      // 山墙三角封板(精确棱柱, 内缩藏进瓦面下)
      const gab = new THREE.Mesh(gableGeo(W - 0.1 * s, rH - 0.18, D - 0.3), texMat([0.88, 0.84, 0.74], 'concrete', 1.5, 1));
      gab.position.y = H - 0.02;
      // 烟囱
      const chim = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 1.6 * s, 0.55 * s), texMat([0.60, 0.44, 0.38], 'brick', 1, 1.4));
      chim.position.set(W * 0.28, H + rH * 0.85, -D * 0.18);
      // 门窗(深色嵌板, 不单独碰撞)
      const trim = lambert([0.30, 0.24, 0.18]);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 2.0, 0.08), trim);
      door.position.set(-W * 0.22, 1.0, D / 2 + 0.03);
      const win1 = new THREE.Mesh(new THREE.BoxGeometry(1.05 * s, 0.9, 0.08), trim);
      win1.position.set(W * 0.2, 1.9, D / 2 + 0.03);
      const win2 = win1.clone(); win2.position.set(D / 2 + 0.03, 1.9, -W * 0.1); win2.rotation.y = Math.PI / 2; win2.scale.set(0.9, 1, 1);
      g.add(body, roof1, roof2, gab, chim, door, win1, win2);
      col = { ...col, ...OBB(W / 2, D / 2), h: H + rH };
    } else if (c.type === 'hedge') {
      const s = (c.scale || 1);
      const rng = srand(Math.abs(hash(c.x, c.z) * 6000) | 0);
      // 拟物: 沿墙线的叶团簇拥(深绿灌木球, 替代长方盒)
      const geo = geoCache.bush || (geoCache.bush = new THREE.SphereGeometry(1, 7, 5));
      const mats = [[0.30, 0.52, 0.20], [0.24, 0.44, 0.16], [0.36, 0.58, 0.24]].map(c => texMat(c, 'thatch', 3.5, 1.8));
      const N = 4;
      for (let i = 0; i < N; i++) {
        const r = (1.15 + rng() * 0.5) * s;
        const m = new THREE.Mesh(geo, mats[(rng() * 3) | 0]);
        m.scale.set(r, r * 0.78, r * (0.9 + rng() * 0.3));
        m.position.set(-3 * s + 6 * s * (i + 0.5) / N, 0.95 * s + rng() * 0.5, (rng() - 0.5) * 0.5);
        g.add(m);
      }
      col = { ...col, blocksMove: false, blocksShells: false, blocksSpot: true, ...OBB(3.0 * s, 1.1 * s), h: 3.2 };  // 树篱: 软质草本, 能直接压过; 挡视线不挡弹(WoT 隔树篱对射)
    } else if (c.type === 'rock') {
      const s = (c.scale || 1);
      const rng = srand(Math.abs(hash(c.x, c.z) * 1000) | 0);
      const rockM = texMat([0.86, 0.85, 0.83], 'rock', 1.6, 1.2);
      const rockM2 = texMat([0.72, 0.71, 0.68], 'rock', 1.6, 1.2);
      // 主石: 二十面体顶点噪声扰动(不规则棱角) + 副石叠垒
      const geo = geoCache.rock || (geoCache.rock = (() => {
        const gg = new THREE.IcosahedronGeometry(1, 1);
        const p = gg.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const k = 0.82 + (Math.sin(p.getX(i) * 5.3 + p.getY(i) * 3.1) * 0.5 + 0.5) * 0.36;   // 顶点扰动
          p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.86, p.getZ(i) * k);
        }
        gg.computeVertexNormals();
        return gg;
      })());
      const m = new THREE.Mesh(geo, rockM);
      m.scale.set(2.1 * s, 1.8 * s, 1.8 * s);
      m.position.y = 0.9 * s;
      m.rotation.set(0.3, c.yaw, 0.2);
      const m2 = new THREE.Mesh(geo, rockM2);
      const r2 = 0.9 + rng() * 0.5;
      m2.scale.set(r2 * s, r2 * 0.8 * s, r2 * s);
      m2.position.set((rng() - 0.5) * 2.4 * s, 0.35 * s, (rng() - 0.5) * 2.2 * s);
      m2.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      const m3 = new THREE.Mesh(geo, rockM);
      m3.scale.set(0.65 * s, 0.5 * s, 0.6 * s);
      m3.position.set((rng() - 0.5) * 2.8 * s, 0.25 * s, (rng() - 0.5) * 2.6 * s);
      m3.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      g.add(m, m2, m3);
      col = { ...col, r: 2.5 * s, h: 3.3 * s };   // 坦克比例的巨石: 藏得住整车
    } else if (c.type === 'trap') {
      // 拟物: 捷克刺猬(三根钢梁互交 + 中部焊接节点), 锈蚀贴图
      const rustM = texMat([0.52, 0.52, 0.55], 'rust', 1, 1.2);
      const beam = (rx, rz) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), rustM);
        b.rotation.set(rx, 0, rz);
        b.position.y = 0.95;
        return b;
      };
      const b1 = beam(0, 0.62), b2 = beam(0, -0.62), b3 = beam(0.62, 0);
      b3.rotation.set(0.62, 0.35, 0.55);
      const node = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), lambert([0.20, 0.19, 0.18]));
      node.position.y = 0.95;
      g.add(b1, b2, b3, node);
      col = { ...col, blocksShells: false, r: 1.2, h: 1.2 };
    } else if (c.type === 'tree') {
      const s = (c.scale || 1);
      const rng = srand(Math.abs(hash(c.x, c.z) * 2000) | 0);
      // 多段渐细弯曲树干(松科: 挺直; 阔叶: 微弯) + 3 层不规则树冠锥
      const trunkM = lambert([0.33, 0.24, 0.15]);
      let ty = 0, tx = 0, tz = 0;
      const segs = 3;
      const segL = 1.1 * s;
      for (let i = 0; i < segs; i++) {
        const rTop = 0.26 * s * (1 - i / segs * 0.5), rBot = 0.32 * s * (1 - i / segs * 0.4);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, segL, 6), trunkM);
        tx += (rng() - 0.5) * 0.22 * s * (i + 1) * 0.5;
        tz += (rng() - 0.5) * 0.22 * s * (i + 1) * 0.5;
        seg.position.set(tx, ty + segL / 2, tz);
        seg.rotation.z = (rng() - 0.5) * 0.08;
        g.add(seg);
        ty += segL * 0.96;
      }
      const leafM = lambert([0.13 + rng() * 0.05, 0.28 + rng() * 0.06, 0.12]);
      const tiers = 3;
      let cy = ty - 0.4 * s;
      for (let i = 0; i < tiers; i++) {
        const cr = (1.9 - i * 0.42) * s * (0.9 + rng() * 0.2);
        const ch = (2.4 - i * 0.4) * s;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(cr, ch, 7), leafM);
        cone.position.set(tx * (0.4 + i * 0.25), cy + ch / 2, tz * (0.4 + i * 0.25));
        cone.rotation.y = rng() * 3;
        g.add(cone);
        cy += ch * 0.62;
      }
      col = { ...col, blocksShells: false, r: 0.9, h: 1.6 }; // 树干挡车不挡弹
    } else if (c.type === 'barn') {
      const s = (c.scale || 1);
      const W = 11 * s, D = 7.5 * s, H = 5;
      const woodM = texMat([0.80, 0.72, 0.62], 'wood', 2.6, 1);
      const woodDark = texMat([0.52, 0.45, 0.38], 'wood', 2.6, 1);
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), woodM);
      body.position.y = H / 2;
      // 谷仓大门(深色门框+对开门板)
      const doorF = new THREE.Mesh(new THREE.BoxGeometry(3.2 * s, 3.4, 0.12), woodDark);
      doorF.position.set(0, 1.7, D / 2 + 0.05);
      const doorL = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 3.0, 0.06), texMat([0.62, 0.55, 0.47], 'wood', 1.2, 1.6));
      doorL.position.set(-0.78 * s, 1.55, D / 2 + 0.12);
      const doorR = doorL.clone(); doorR.position.x = 0.78 * s;
      // 双坡屋顶(出檐+屋脊)
      const roofM = texMat([0.50, 0.44, 0.40], 'wood', 3, 1.1);
      const rH = 2.2 * s;
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7 * s, 0.28, Math.sqrt((D / 2 + 0.35 * s) ** 2 + rH ** 2)), roofM);
      roof1.position.set(0, H + rH / 2, D / 4);
      roof1.rotation.x = Math.atan2(rH, D / 2);
      const roof2 = roof1.clone(); roof2.position.z = -D / 4; roof2.rotation.x = -roof1.rotation.x;
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7 * s, 0.22, 0.4 * s), woodDark);
      ridge.position.y = H + rH + 0.02;
      // 山墙封板(三角棱柱, 内缩)
      const gab = new THREE.Mesh(gableGeo(W - 0.1 * s, rH - 0.2, D - 0.35), woodDark);
      gab.position.y = H - 0.02;
      g.add(body, doorF, doorL, doorR, roof1, roof2, ridge, gab);
      col = { ...col, ...OBB(W / 2, D / 2), h: H + rH };
    } else if (c.type === 'ruin') {
      const s = (c.scale || 1);
      const rng = srand(Math.abs(hash(c.x, c.z) * 4000) | 0);
      const brickM = texMat([0.88, 0.83, 0.78], 'brick', 3, 2.2), dark = lambert([0.42, 0.34, 0.3]);
      // 主断墙: 分段锯齿缺口(弹毁感)
      const W = 6 * s, segs = 4, sw = W / segs;
      for (let i = 0; i < segs; i++) {
        const segH = (2.6 + rng() * 1.9) * (i === 0 ? 1.05 : 1);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(sw * (0.96 + rng() * 0.08), segH, 0.5), brickM);
        seg.position.set(-W / 2 + sw * (i + 0.5), segH / 2, 0);
        g.add(seg);
      }
      // 侧墙残段(高低不一)
      const w2h = 2.4 + rng() * 0.9;
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, w2h, 3.6 * s), brickM);
      w2.position.set(-W / 2 - 0.25, w2h / 2, 2 * s);
      g.add(w2);
      // 焦黑断梁(斜插)
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.2 * s, 0.16), lambert([0.16, 0.12, 0.09]));
      beam.position.set(W * 0.2, 1.3, 0.8);
      beam.rotation.set(0.5, rng() * 3, 0.35);
      g.add(beam);
      // 瓦砾堆: 碎砖+小石块
      for (let i = 0; i < 5; i++) {
        const rb = new THREE.Mesh(new THREE.BoxGeometry((0.4 + rng() * 0.7) * s, (0.2 + rng() * 0.3) * s, (0.3 + rng() * 0.5) * s),
          rng() < 0.5 ? brickM : dark);
        rb.position.set((rng() - 0.5) * W * 0.9, 0.15 * s, (rng() - 0.5) * 3.4 * s);
        rb.rotation.y = rng() * 3;
        g.add(rb);
      }
      const rub = new THREE.Mesh(new THREE.BoxGeometry(4.5 * s, 0.5, 2.6), dark); rub.position.set(0.6, 0.25, 0.6);
      g.add(rub);
      col = { ...col, ...OBB(3.2 * s, 2.4 * s), h: 4.5 };
    } else if (c.type === 'wall') {
      const s = (c.scale || 1);
      buildStonewall(g, 7 * s, 2.9, 0.7, Math.abs(hash(c.x, c.z) * 3000) | 0);   // 拟物: 分段错缝石墙
      const cap = new THREE.Mesh(new THREE.BoxGeometry(7.15 * s, 0.15, 0.9), lambert([0.38, 0.37, 0.34]));
      cap.position.y = 2.97;
      g.add(cap);
      col = { ...col, ...OBB(3.5 * s, 0.35 * s), h: 3.1 };   // 高石墙: 7m 长 0.7m 厚, 藏得住车体, 一比一碰撞
    } else if (c.type === 'haystack') {
      const s = (c.scale || 1);
      const thatchM = texMat([0.88, 0.82, 0.68], 'thatch', 2, 1.2);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.7 * s, 2.0 * s, 2.7 * s, 10), thatchM);
      m.position.y = 1.35 * s;
      const cap2 = new THREE.Mesh(new THREE.ConeGeometry(1.75 * s, 1.1 * s, 10), thatchM);
      cap2.position.y = 3.1 * s;
      g.add(m, cap2);
      col = { ...col, blocksMove: false, blocksShells: false, blocksSpot: true, r: 2.6 * s, h: 3.6 * s };  // 草垛: 软质草本, 能直接压过; 挡视线不挡弹
    } else if (c.type === 'wreck') {
      const s = (c.scale || 1);
      // 拟物: 真坦克 GLB 烧毁姿态(歪斜+炮塔错位+焦黑涂装); 模型未就绪时退回盒子拼装
      const types = ['pz4', 't34', 'stug3', 'sherman'].filter(t => SF.Assets.models[t]);
      if (types.length) {
        const rng = srand(Math.abs(hash(c.x, c.z) * 5000) | 0);
        const parts = makeTank(types[(rng() * types.length) | 0]);
        parts.root.traverse(o => {
          if (o.isMesh) {
            o.material = o.material.clone();          // 焦黑涂装只作用于此辆, 不污染同型活车
            o.material.color.multiplyScalar(0.22);
            o.receiveShadow = true;
          }
        });
        parts.root.position.y = -0.18;                // 半陷+歪斜
        parts.root.rotation.z = 0.05 + rng() * 0.06;
        parts.root.rotation.x = (rng() - 0.5) * 0.08;
        if (parts.turret) { parts.turret.rotation.y = 1.1 + rng() * 1.2; }   // 炮塔被打飞般错位
        if (parts.gun) parts.gun.rotation.x = -0.5 - rng() * 0.3;            // 炮管耷拉
        g.add(parts.root);
      } else {
        const rustM = texMat([0.60, 0.60, 0.60], 'rust', 1.5, 2.5);
        const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.1, 6.2), rustM);
        body.position.y = 0.75; body.rotation.z = 0.06;
        const tur = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 2.4), rustM);
        tur.position.set(0.35, 1.7, 0.4); tur.rotation.y = 0.9;
        const gunB = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.8, 6), rustM);
        gunB.rotation.set(Math.PI / 2, 0, 0.5); gunB.position.set(0.9, 1.4, 1.5);
        const track1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 6.3), rustM);
        track1.position.set(-1.55, 0.35, 0);
        const track2 = track1.clone(); track2.position.x = 1.55;
        g.add(body, tur, gunB, track1, track2);
        g.rotation.z = 0.03;
      }
      col = { ...col, blocksShells: false, blocksSpot: true, ...OBB(1.75, 3.1), h: 2.4 };  // 残骸: 挡车挡视线, 不挡弹(WoT 击毁车不吸弹)
    } else if (c.type === 'bush') {
      const s = (c.scale || 1);
      // 多团簇拥的灌木丛: 茅草照片贴图(密集草束纹理) × 亮绿色调 —— 有叶簇质感且与地面深草拉开对比
      const geo = geoCache.bush || (geoCache.bush = new THREE.SphereGeometry(1, 7, 5));
      const mats = geoCache.bushMats || (geoCache.bushMats = [[0.50, 0.82, 0.34], [0.40, 0.66, 0.26], [0.66, 0.98, 0.50]].map(c => texMat(c, 'thatch', 3.5, 1.8)));
      const blob = (dx, dz, r, yy, gi) => {
        const m = new THREE.Mesh(geo, mats[gi % 3]);
        m.scale.set(r, r * 0.72, r); m.position.set(dx, yy, dz);
        m.castShadow = !bushSeeThrough;   // 开镜去遮挡时草丛不投影
        return m;
      };
      g.add(
        blob(0, 0, 1.7 * s, 1.4 * s, 0),
        blob(1.25 * s, 0.5 * s, 1.2 * s, 1.05 * s, 1),
        blob(-1.1 * s, -0.75 * s, 1.1 * s, 0.95 * s, 2),
        blob(0.35 * s, -1.2 * s, 0.95 * s, 0.85 * s, 1),
        blob(-0.4 * s, 1.1 * s, 0.9 * s, 1.0 * s, 2)
      );
      col = { ...col, blocksMove: false, blocksShells: false, blocksSpot: true, r: 1.6 * s, h: 1.9 };  // 草丛: 不挡车不挡弹, 只挡点亮视线(蹲入隐蔽)
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { group: g, col };
  }

  // 掩体系统: 网格合批 + 碰撞列表(车体推开/挡弹/挡视线)
  // 渲染侧按"贴图×材质类型×挡弹与否×草丛"分桶, 把全部掩体网格烘焙(world 变换/UV repeat/颜色 tint)
  // 合并成十几个静态网格 —— 一张图 180~341 个掩体原本 2000+ 独立网格单独提交, 是 draw call 的绝对大头;
  // 碰撞/挡弹/通视本来就是解析计算(circle/OBB+高度), 不依赖网格, 所以合并只影响渲染。
  // 草丛单独成桶: 开镜去遮挡要整体切半透明+关投影(见 setBushSeeThrough)。
  const bushMatList = [], bushMeshList = [];
  const texKeyCache = new Map();
  function texKeyOf(map) {   // 按图源归桶: texMat 的 repeat 克隆共享 image, 同底图不同平铺可合并(UV 已烘)
    const A = (SF.Assets && SF.Assets.textures) || {};
    for (const k in A) if (A[k].image === map.image) return k;
    let k = texKeyCache.get(map.image);
    if (!k) texKeyCache.set(map.image, k = 'g' + texKeyCache.size);
    return k;
  }
  function makeMergedMat(srcMat, texKey) {
    const opts = { color: 0xffffff, vertexColors: true };   // tint 已烘进顶点色
    if (texKey[0] !== 'F') {
      const base = SF.Assets && SF.Assets.textures[texKey];
      if (base) opts.map = base;              // 直接复用底图(1×1 平铺, UV 已烘; 保留各向异性), 不动共享实例
      else {                                   // GLB 自带贴图: 克隆必须 needsUpdate, 否则纹理不上传 → 全黑
        opts.map = srcMat.map.clone();
        opts.map.repeat.set(1, 1); opts.map.offset.set(0, 0);
        opts.map.needsUpdate = true;
      }
    }
    // GLB(残骸)是 Standard 材质, 保留 roughness/metalness 观感; 程序化掩体全是 Lambert
    return srcMat.type === 'MeshStandardMaterial'
      ? new THREE.MeshStandardMaterial({ ...opts, roughness: srcMat.roughness, metalness: srcMat.metalness })
      : new THREE.MeshLambertMaterial(opts);
  }
  const _WHITE = { r: 1, g: 1, b: 1 };
  function bakeCover(group, c, col, buckets) {
    group.updateMatrixWorld(true);
    const solid = !!col.blocksShells, isBush = c.type === 'bush';
    group.traverse(o => {
      if (!o.isMesh || !o.visible) return;   // visible=false(如残骸 GLB 的瞄准轮廓)不参与合批
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      const map = mat.map;
      const uv = geo.attributes.uv;
      if (map && uv) {   // 把贴图 repeat/offset 烘进顶点 → 合并后共用一张 1×1 平铺贴图
        const rx = map.repeat.x, ry = map.repeat.y, ox = map.offset.x, oy = map.offset.y;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rx + ox, uv.getY(i) * ry + oy);
      }
      // 材质 tint ×(原有顶点色, 若有) → 顶点色; 同色/异色实例从此共用白色材质
      const posCount = geo.attributes.position.count;
      const vcol = geo.attributes.color, tint = mat.color || _WHITE;
      const colors = new Float32Array(posCount * 3);
      for (let i = 0; i < posCount; i++) {
        colors[i * 3] = tint.r * (vcol ? vcol.getX(i) : 1);
        colors[i * 3 + 1] = tint.g * (vcol ? vcol.getY(i) : 1);
        colors[i * 3 + 2] = tint.b * (vcol ? vcol.getZ(i) : 1);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(posCount * 2), 2));
      const key = (map ? 'T' + texKeyOf(map) : 'F') + '|' + mat.type + '|' + (solid ? 'S' : 'W') + (isBush ? 'B' : '');
      let b = buckets.get(key);
      if (!b) { b = { geos: [], bush: isBush, mat: makeMergedMat(mat, map ? texKeyOf(map) : 'F') }; buckets.set(key, b); }
      b.geos.push(geo);
    });
  }
  function mergeGeos(geos) {   // 统一布局(position/normal/uv/color) + 索引拼接
    const list = geos.map(g => {
      let idx = g.index;
      if (!idx) {
        const n = g.attributes.position.count;
        const arr = new Uint32Array(n);
        for (let i = 0; i < n; i++) arr[i] = i;
        idx = new THREE.BufferAttribute(arr, 1);
      }
      return { g, idx };
    });
    let vTotal = 0, iTotal = 0;
    for (const { g, idx } of list) { vTotal += g.attributes.position.count; iTotal += idx.count; }
    const pos = new Float32Array(vTotal * 3), nor = new Float32Array(vTotal * 3),
      uv = new Float32Array(vTotal * 2), col = new Float32Array(vTotal * 3);
    const indices = vTotal < 65536 ? new Uint16Array(iTotal) : new Uint32Array(iTotal);
    let vo = 0, io = 0;
    for (const { g, idx } of list) {
      const p = g.attributes.position, n2 = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
      for (let i = 0; i < p.count; i++) {
        pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
        nor[(vo + i) * 3] = n2 ? n2.getX(i) : 0; nor[(vo + i) * 3 + 1] = n2 ? n2.getY(i) : 1; nor[(vo + i) * 3 + 2] = n2 ? n2.getZ(i) : 0;
        uv[(vo + i) * 2] = u ? u.getX(i) : 0; uv[(vo + i) * 2 + 1] = u ? u.getY(i) : 0;
        col[(vo + i) * 3] = c.getX(i); col[(vo + i) * 3 + 1] = c.getY(i); col[(vo + i) * 3 + 2] = c.getZ(i);
      }
      for (let i = 0; i < idx.count; i++) indices[io + i] = idx.getX(i) + vo;
      vo += p.count; io += idx.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    return geo;
  }
  function applyBushSeeThrough() {
    for (const m of bushMatList) {
      m.opacity = bushSeeThrough ? 0.28 : 1;
      m.transparent = bushSeeThrough;
      m.depthWrite = !bushSeeThrough;          // 半透明堆叠免自遮挡
    }
    for (const mesh of bushMeshList) mesh.castShadow = !bushSeeThrough;
  }
  class CoverField {
    constructor(mapJson, terrain, scene) {
      this.list = [];
      this.heightAt = terrain.heightAt;   // 遮挡计算注入地形采样(simcore, 与 worker 同源)
      this.group = new THREE.Group();
      const buckets = new Map();
      for (const c of mapJson.covers) {
        const { group, col } = buildCover(c, terrain);
        bakeCover(group, c, col, buckets);
        this.list.push(col);
      }
      bushMatList.length = 0; bushMeshList.length = 0;
      for (const b of buckets.values()) {
        const mesh = new THREE.Mesh(mergeGeos(b.geos), b.mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        if (b.bush) { bushMeshList.push(mesh); bushMatList.push(b.mat); }
        this.group.add(mesh);
      }
      applyBushSeeThrough();   // 重开战斗时按当前开镜状态摆正草丛透明/投影
      scene.add(this.group);
    }
    // 车体碰撞(圆形请求方): 圆 vs 圆/OBB 推出 —— 出生点避让等粗判用
    collide(x, z, radius) {
      let nx = x, nz = z;
      for (const c of this.list) {
        if (!c.blocksMove) continue;
        if (c.shape === 'box') {
          const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
          const px = nx - c.x, pz = nz - c.z;
          let lx = cs * px - sn * pz, lz = sn * px + cs * pz;
          const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
          let ddx = lx - qx, ddz = lz - qz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 > radius * radius) continue;
          if (d2 < 1e-6) {   // 圆心陷入框内: 沿最浅面推出
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
    // 车体碰撞(坦克): 车体 OBB(真实长宽+朝向) vs 掩体 —— 一比一, 无幽灵墙
    collideTank(t) {
      let nx = t.x, nz = t.z;
      const S = t.spec, hw = S.sample.w, hl = S.sample.l;
      const circ = Math.hypot(hw, hl);                     // 车体外接半径(快速剔除必须用真值, 否则会漏检)
      const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
      for (const c of this.list) {
        if (!c.blocksMove) continue;
        const dx0 = nx - c.x, dz0 = nz - c.z, rr = c.r + circ;
        if (dx0 * dx0 + dz0 * dz0 > rr * rr) continue;
        if (c.shape === 'box') {
          const push = SF.Util.obbPushOut({ x: nx, z: nz, yaw: t.yaw, hx: hw, hz: hl }, c);
          if (push) { nx += push[0]; nz += push[1]; }
        } else {
          // 圆掩体 vs 车体 OBB: 掩体圆心变换到车体局部系求最近点, 按穿透深度推出
          const rx = c.x - nx, rz = c.z - nz;               // 车体→掩体圆心(世界系)
          let lx = cs * rx - sn * rz, lz = sn * rx + cs * rz;   // 掩体圆心在车体局部系
          const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hl, Math.min(hl, lz));
          let ddx = lx - qx, ddz = lz - qz;                 // 最近点→圆心(车体局部系)
          let d = Math.hypot(ddx, ddz);
          if (d < 1e-6) {   // 圆心陷入车体(几乎不发生): 沿圆心→车心方向退出一个半径
            const bx = nx - c.x, bz = nz - c.z, bl = Math.hypot(bx, bz) || 1;
            nx += bx / bl * (c.r + hl); nz += bz / bl * (c.r + hl);
            continue;
          }
          if (d < c.r) {
            const k = (c.r - d) / d;
            const px2 = -ddx * k, pz2 = -ddz * k;           // 车体沿"圆心→最近点"反方向推出
            nx += cs * px2 + sn * pz2; nz += -sn * px2 + cs * pz2;
          }
        }
      }
      return [nx, nz];
    }
    // 弹道/视线遮挡: 委托 simcore(主线程/Worker 同一实现); 返回沿射线最近命中距离(-1 无)
    blocked(ox, oz, oy, dx, dz, len, dy, spot) {
      return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot);
    }
    // 找 a→b 方向最近的掩体(供 AI 找掩体用): 硬掩体(挡弹)或视觉掩体(挡视线)都算
    nearestCoverBetween(ax, az, bx, bz) {
      return SF.Sim.nearestCoverBetween(this.list, ax, az, bx, bz);
    }
  }

  return { makeTank, CoverField, bushMats: () => bushMatList, setBushSeeThrough: (v) => { bushSeeThrough = v; applyBushSeeThrough(); } };
})();
