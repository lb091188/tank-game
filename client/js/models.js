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
    return parts;
  }

  /* ---------- 掩体: 按 map.json 的 type 程序化建模 ----------
     碰撞: blocksMove 挡车体 / blocksShells 挡弹 / blocksSpot 挡点亮视线
     WoT 对齐: 只有石墙/岩石/建筑真正吸弹; 软质物(草丛/树篱/草垛/残骸)挡视线当隐蔽, 炮弹直接穿过 */
  const geoCache = {};
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
      const body = new THREE.Mesh(new THREE.BoxGeometry(7 * s, 3.4, 5.5 * s), texMat([0.92, 0.88, 0.80], 'concrete', 2, 1.2));
      body.position.y = 1.7;
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(7.6 * s, 0.25, 3.6 * s), texMat([0.78, 0.55, 0.48], 'brick', 3, 1));
      roof1.position.set(0, 4.0, 1.45 * s); roof1.rotation.x = 0.62;
      const roof2 = roof1.clone(); roof2.position.z = -1.45 * s; roof2.rotation.x = -0.62;
      g.add(body, roof1, roof2);
      col = { ...col, ...OBB(3.5 * s, 2.75 * s), h: 5 };
    } else if (c.type === 'hedge') {
      const s = (c.scale || 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(6 * s, 3.0, 2.2), lambert([0.15, 0.30, 0.13]));
      m.position.y = 1.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(5.2 * s, 0.8, 1.7), lambert([0.17, 0.33, 0.14]));
      top.position.y = 3.35;
      g.add(m, top);
      col = { ...col, blocksShells: false, blocksSpot: true, ...OBB(3.0 * s, 1.1 * s), h: 3.2 };  // 树篱: 挡车挡视线, 不挡弹(WoT 隔树篱对射)
    } else if (c.type === 'rock') {
      const s = (c.scale || 1);
      const geo = geoCache.rock || (geoCache.rock = new THREE.IcosahedronGeometry(1, 0));
      const m = new THREE.Mesh(geo, texMat([0.86, 0.85, 0.83], 'rock'));
      m.scale.set(2.1 * s, 1.8 * s, 1.8 * s);
      m.position.y = 0.9 * s;
      m.rotation.set(0.3, c.yaw, 0.2);
      g.add(m);
      col = { ...col, r: 2.5 * s, h: 3.3 * s };   // 坦克比例的巨石: 藏得住整车
    } else if (c.type === 'trap') {
      const rustM = texMat([0.52, 0.52, 0.55], 'rust');
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.22), rustM);
      const b2 = bar.clone(); b2.rotation.z = 0.9; b2.position.y = 0.7;
      const b3 = bar.clone(); b3.rotation.z = -0.9; b3.position.y = 0.7;
      bar.position.y = 0.7; bar.rotation.y = c.yaw;
      b2.rotation.y = b3.rotation.y = c.yaw;
      g.add(bar, b2, b3);
      col = { ...col, blocksShells: false, r: 1.2, h: 1.2 };
    } else if (c.type === 'tree') {
      const s = (c.scale || 1);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6), lambert([0.35, 0.26, 0.16]));
      trunk.position.y = 1.3;
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.9 * s, 3.2 * s, 7), lambert([0.13, 0.28, 0.12]));
      c1.position.y = 3.4 * s;
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 2.4 * s, 7), lambert([0.15, 0.33, 0.13]));
      c2.position.y = 4.9 * s;
      g.add(trunk, c1, c2);
      col = { ...col, blocksShells: false, r: 0.9, h: 1.6 }; // 树干挡车不挡弹
    } else if (c.type === 'barn') {
      const s = (c.scale || 1);
      const body = new THREE.Mesh(new THREE.BoxGeometry(11 * s, 5, 7.5 * s), texMat([0.82, 0.76, 0.68], 'wood', 3.5, 1.3));
      body.position.y = 2.5;
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(11.8 * s, 0.3, 4.6 * s), texMat([0.55, 0.50, 0.45], 'wood', 3.5, 1));
      roof1.position.set(0, 6.0, 1.9 * s); roof1.rotation.x = 0.6;
      const roof2 = roof1.clone(); roof2.position.z = -1.9 * s; roof2.rotation.x = -0.6;
      g.add(body, roof1, roof2);
      col = { ...col, ...OBB(5.5 * s, 3.75 * s), h: 7 };
    } else if (c.type === 'ruin') {
      const s = (c.scale || 1);
      const brickM = texMat([0.88, 0.83, 0.78], 'brick', 3, 2.2), dark = lambert([0.42, 0.34, 0.3]);
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(6 * s, 4.4, 0.5), brickM); w1.position.set(0, 2.2, 0);
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.0, 4 * s), brickM); w2.position.set(-3 * s, 1.5, 2 * s);
      const w3 = new THREE.Mesh(new THREE.BoxGeometry(2.2 * s, 2.0, 0.45), dark); w3.position.set(1.8 * s, 1.0, -0.8);
      const w4 = new THREE.Mesh(new THREE.BoxGeometry(1.4 * s, 3.4, 0.5), brickM); w4.position.set(2.3 * s, 1.7, 0.5);
      const rub = new THREE.Mesh(new THREE.BoxGeometry(4.5 * s, 0.5, 2.6), dark); rub.position.set(0.6, 0.25, 0.6);
      g.add(w1, w2, w3, w4, rub);
      col = { ...col, ...OBB(3.2 * s, 2.4 * s), h: 4.5 };
    } else if (c.type === 'wall') {
      const s = (c.scale || 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(7 * s, 2.9, 0.7), texMat([0.80, 0.78, 0.74], 'rock', 3.5, 1.5));
      m.position.y = 1.45;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(7.2 * s, 0.18, 0.9), lambert([0.38, 0.37, 0.34]));
      cap.position.y = 2.98;
      g.add(m, cap);
      col = { ...col, ...OBB(3.5 * s, 0.35 * s), h: 3.1 };   // 高石墙: 7m 长 0.7m 厚, 藏得住车体, 一比一碰撞
    } else if (c.type === 'haystack') {
      const s = (c.scale || 1);
      const thatchM = texMat([0.88, 0.82, 0.68], 'thatch', 2, 1.2);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.7 * s, 2.0 * s, 2.7 * s, 10), thatchM);
      m.position.y = 1.35 * s;
      const cap2 = new THREE.Mesh(new THREE.ConeGeometry(1.75 * s, 1.1 * s, 10), thatchM);
      cap2.position.y = 3.1 * s;
      g.add(m, cap2);
      col = { ...col, blocksShells: false, blocksSpot: true, r: 2.6 * s, h: 3.6 * s };  // 草垛: 软质, 挡视线不挡弹
    } else if (c.type === 'wreck') {
      const s = (c.scale || 1);
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

  // 掩体系统: 网格组 + 碰撞列表(车体推开/挡弹/挡视线)
  class CoverField {
    constructor(mapJson, terrain, scene) {
      this.list = [];
      this.group = new THREE.Group();
      for (const c of mapJson.covers) {
        const { group, col } = buildCover(c, terrain);
        this.group.add(group);
        this.list.push(col);
      }
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
    // 弹道/视线遮挡: 包围圆粗剔除 + 方形 rayObb / 圆形 rayCircle, 高度比较
    // spot(可选, 点亮专用): 额外计入草丛(不挡弹但挡视线); concealed=目标蹲草未开炮 → 目标脚下那丛加高吞掉整车
    blocked(ox, oz, oy, dx, dz, len, dy, spot) {
      for (const c of this.list) {
        if (!(c.blocksShells || (spot && c.blocksSpot))) continue;
        const t0 = SF.Util.rayCircle(ox, oz, dx, dz, len, c.x, c.z, c.r);
        if (t0 < 0) continue;
        const t = c.shape === 'box' ? SF.Util.rayObb(ox, oz, dx, dz, len, c) : t0;
        if (t >= 0) {
          let ch = c.h;
          if (spot && c.blocksSpot && !c.blocksShells && spot.concealed
            && Math.hypot(ox + dx * t - spot.tx, oz + dz * t - spot.tz) < 6)
            ch += 1.8;                                    // 草丛把蹲入的整车连炮塔一起藏住
          const h = oy + dy * t;
          if (h < SF.Game.world.terrain.heightAt(ox + dx * t, oz + dz * t) + ch) return t;  // 命中掩体高度内
        }
      }
      return -1;
    }
    // 找 a→b 方向最近的掩体(供 AI 找掩体用): 硬掩体(挡弹)或视觉掩体(挡视线)都算
    nearestCoverBetween(ax, az, bx, bz) {
      let best = null, bestT = 1e9;
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1) return null;
      for (const c of this.list) {
        if (!c.blocksShells && !c.blocksSpot) continue;
        const t = SF.Util.rayCircle(ax, az, dx / len, dz / len, len, c.x, c.z, c.r);
        if (t >= 0 && t < bestT) { bestT = t; best = c; }
      }
      return best;
    }
  }

  return { makeTank, CoverField, bushMats, setBushSeeThrough: (v) => { bushSeeThrough = v; } };
})();
