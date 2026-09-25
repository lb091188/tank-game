// models.js — GLB 坦克装配(炮塔/火炮枢轴驱动) + 掩体程序化建模与碰撞注册表
window.SF = window.SF || {};

SF.Models = (() => {
  const lambert = (rgb) => new THREE.MeshLambertMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) });

  /* ---------- 坦克: 克隆 GLB, 提取枢轴与部位网格 ---------- */
  function makeTank(type) {
    const src = SF.Assets.models[type];
    if (!src) throw new Error(`未知坦克类型: ${type}`);
    const root = src.clone(true);
    const parts = { root, turret: null, gun: null, muzzle: null, zones: [] };
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        const zone = o.userData && o.userData.zone;  // GLTFLoader 把节点 extras 放进 userData
        if (zone) { parts.zones.push(o); }
      } else if (o.name === 'turret') parts.turret = o;
      else if (o.name === 'gun') parts.gun = o;
      else if (o.name === 'muzzle') parts.muzzle = o;
    });
    parts.noTurret = !parts.turret;
    // 敌我识别色: 玩家橄榄已建模; 敌方在车顶加识别条(便于读局势) — 敌方模型本身是灰系
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
      const m = new THREE.Mesh(new THREE.BoxGeometry(6 * s, 1.9, 1.7), lambert([0.15, 0.30, 0.13]));
      m.position.y = 0.95;
      g.add(m);
      col = { ...col, r: 2.8 * s, h: 2.2 };
    } else if (c.type === 'rock') {
      const s = (c.scale || 1);
      const geo = geoCache.rock || (geoCache.rock = new THREE.IcosahedronGeometry(1, 0));
      const m = new THREE.Mesh(geo, lambert([0.42, 0.41, 0.39]));
      m.scale.set(1.6 * s, 1.15 * s, 1.4 * s);
      m.position.y = 0.6 * s;
      m.rotation.set(0.3, c.yaw, 0.2);
      g.add(m);
      col = { ...col, r: 1.9 * s, h: 2.4 * s };
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
