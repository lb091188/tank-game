// models.js — GLB 坦克装配(炮塔/火炮枢轴驱动) + 掩体程序化建模与碰撞注册表
window.SF = window.SF || {};

SF.Models = (() => {
  const lambert = (rgb) => new THREE.MeshLambertMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) });

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
     碰撞: blocksMove 挡车体 / blocksShells 挡弹与视线 / r 圆形碰撞半径 / h 有效高度 */
  const geoCache = {};
  function buildCover(c, terrain) {
    const y = terrain.heightAt(c.x, c.z);
    const g = new THREE.Group();
    g.position.set(c.x, y, c.z);
    g.rotation.y = c.yaw || 0;
    let col = { blocksMove: true, blocksShells: true, x: c.x, z: c.z, r: 2, h: 3 };

    if (c.type === 'house') {
      const s = (c.scale || 1);
      const body = new THREE.Mesh(new THREE.BoxGeometry(7 * s, 3.4, 5.5 * s), lambert([0.80, 0.76, 0.66]));
      body.position.y = 1.7;
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(7.6 * s, 0.25, 3.6 * s), lambert([0.55, 0.26, 0.2]));
      roof1.position.set(0, 4.0, 1.45 * s); roof1.rotation.x = 0.62;
      const roof2 = roof1.clone(); roof2.position.z = -1.45 * s; roof2.rotation.x = -0.62;
      g.add(body, roof1, roof2);
      col = { ...col, r: 4.8 * s, h: 5 };
    } else if (c.type === 'hedge') {
      const s = (c.scale || 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(6 * s, 2.4, 2.2), lambert([0.15, 0.30, 0.13]));
      m.position.y = 1.2;
      g.add(m);
      col = { ...col, r: 3.0 * s, h: 2.6 };
    } else if (c.type === 'rock') {
      const s = (c.scale || 1);
      const geo = geoCache.rock || (geoCache.rock = new THREE.IcosahedronGeometry(1, 0));
      const m = new THREE.Mesh(geo, lambert([0.42, 0.41, 0.39]));
      m.scale.set(2.1 * s, 1.5 * s, 1.8 * s);
      m.position.y = 0.8 * s;
      m.rotation.set(0.3, c.yaw, 0.2);
      g.add(m);
      col = { ...col, r: 2.5 * s, h: 3.0 * s };   // 坦克比例的巨石: 藏得住整车
    } else if (c.type === 'trap') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.22), lambert([0.25, 0.26, 0.28]));
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
      const body = new THREE.Mesh(new THREE.BoxGeometry(11 * s, 5, 7.5 * s), lambert([0.62, 0.42, 0.3]));
      body.position.y = 2.5;
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(11.8 * s, 0.3, 4.6 * s), lambert([0.35, 0.22, 0.16]));
      roof1.position.set(0, 6.0, 1.9 * s); roof1.rotation.x = 0.6;
      const roof2 = roof1.clone(); roof2.position.z = -1.9 * s; roof2.rotation.x = -0.6;
      g.add(body, roof1, roof2);
      col = { ...col, r: 6.6 * s, h: 7 };
    } else if (c.type === 'ruin') {
      const s = (c.scale || 1);
      const brick = lambert([0.55, 0.44, 0.38]), dark = lambert([0.42, 0.34, 0.3]);
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(6 * s, 3.2, 0.5), brick); w1.position.set(0, 1.6, 0);
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 4 * s), brick); w2.position.set(-3 * s, 1.1, 2 * s);
      const w3 = new THREE.Mesh(new THREE.BoxGeometry(2.2 * s, 1.3, 0.45), dark); w3.position.set(1.8 * s, 0.65, -0.8);
      const rub = new THREE.Mesh(new THREE.BoxGeometry(4.5 * s, 0.5, 2.6), dark); rub.position.set(0.6, 0.25, 0.6);
      g.add(w1, w2, w3, rub);
      col = { ...col, r: 3.8 * s, h: 3.4 };
    } else if (c.type === 'wall') {
      const s = (c.scale || 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(7 * s, 1.7, 0.7), lambert([0.46, 0.44, 0.4]));
      m.position.y = 0.85;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(7.2 * s, 0.16, 0.9), lambert([0.38, 0.37, 0.34]));
      cap.position.y = 1.75;
      g.add(m, cap);
      col = { ...col, r: 3.0 * s, h: 1.9 };   // 石墙加高到 1.7m: 藏得住车体, 卖头打
    } else if (c.type === 'haystack') {
      const s = (c.scale || 1);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.7 * s, 2.0 * s, 2.7 * s, 10), lambert([0.62, 0.5, 0.27]));
      m.position.y = 1.35 * s;
      const cap2 = new THREE.Mesh(new THREE.ConeGeometry(1.75 * s, 1.1 * s, 10), lambert([0.55, 0.43, 0.22]));
      cap2.position.y = 3.1 * s;
      g.add(m, cap2);
      col = { ...col, r: 2.6 * s, h: 3.6 };
    } else if (c.type === 'wreck') {
      const s = (c.scale || 1);
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.1, 6.2), lambert([0.13, 0.13, 0.12]));
      body.position.y = 0.75; body.rotation.z = 0.06;
      const tur = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 2.4), lambert([0.11, 0.11, 0.1]));
      tur.position.set(0.35, 1.7, 0.4); tur.rotation.y = 0.9;
      const gunB = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.8, 6), lambert([0.1, 0.1, 0.09]));
      gunB.rotation.set(Math.PI / 2, 0, 0.5); gunB.position.set(0.9, 1.4, 1.5);
      const track1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 6.3), lambert([0.09, 0.09, 0.08]));
      track1.position.set(-1.55, 0.35, 0);
      const track2 = track1.clone(); track2.position.x = 1.55;
      g.add(body, tur, gunB, track1, track2);
      g.rotation.z = 0.03;
      col = { ...col, r: 3.0, h: 2.4 };
    } else if (c.type === 'bush') {
      const s = (c.scale || 1);
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.15 * s, 7, 5), lambert([0.16, 0.3, 0.14]));
      m.scale.y = 0.75; m.position.y = 0.7 * s;
      g.add(m);
      col = { ...col, blocksMove: false, blocksShells: false, r: 1.0, h: 1.4 }; // 纯视觉
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
    // 车体碰撞: 推出圆形
    collide(x, z, radius) {
      let nx = x, nz = z;
      for (const c of this.list) {
        if (!c.blocksMove) continue;
        const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), min = c.r + radius;
        if (d < min && d > 0.001) { nx = c.x + dx / d * min; nz = c.z + dz / d * min; }
      }
      return [nx, nz];
    }
    // 弹道/视线遮挡: 2D 段-圆 + 高度比较
    blocked(ox, oz, oy, dx, dz, len, dy) {
      for (const c of this.list) {
        if (!c.blocksShells) continue;
        const t = SF.Util.rayCircle(ox, oz, dx, dz, len, c.x, c.z, c.r);
        if (t >= 0) {
          const h = oy + dy * t;
          if (h < SF.Game.world.terrain.heightAt(ox + dx * t, oz + dz * t) + c.h) return t;  // 命中掩体高度内
        }
      }
      return -1;
    }
    // 找 a→b 方向最近的掩体(供 AI 找掩体用)
    nearestCoverBetween(ax, az, bx, bz) {
      let best = null, bestT = 1e9;
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1) return null;
      for (const c of this.list) {
        if (!c.blocksShells) continue;
        const t = SF.Util.rayCircle(ax, az, dx / len, dz / len, len, c.x, c.z, c.r);
        if (t >= 0 && t < bestT) { bestT = t; best = c; }
      }
      return best;
    }
  }

  return { makeTank, CoverField };
})();
