// terrain.js — 地形: 由高程图构建渲染网格 + 物理采样(渲染与物理同源)
window.SF = window.SF || {};

SF.Terrain = class {
  constructor(heights, terrainCfg) {
    this.h = heights;
    this.res = terrainCfg.resolution;
    this.size = terrainCfg.size;
    this.maxHeight = terrainCfg.maxHeight;
    this.half = this.size / 2;
    this.cell = this.size / (this.res - 1);
  }

  // 双线性采样高程
  heightAt(x, z) {
    const U = SF.Util;
    const fi = U.clamp((x + this.half) / this.size, 0, 1) * (this.res - 1);
    const fj = U.clamp((z + this.half) / this.size, 0, 1) * (this.res - 1);
    const i = Math.min(this.res - 2, Math.floor(fi)), j = Math.min(this.res - 2, Math.floor(fj));
    const tx = fi - i, tz = fj - j;
    const a = this.h[j * this.res + i], b = this.h[j * this.res + i + 1];
    const c = this.h[(j + 1) * this.res + i], d = this.h[(j + 1) * this.res + i + 1];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
  }

  // 沿朝向的坡度(正=上坡), 用于爬坡阻力
  slopeAhead(x, z, yaw, dist) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const h0 = this.heightAt(x, z), h1 = this.heightAt(x + s * dist, z + c * dist);
    return Math.atan2(h1 - h0, dist);
  }

  // 地形通视: 两点(含眼高)之间地形是否遮挡
  losBlocked(ax, az, ay, bx, bz, by) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(d / 6));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const hTerrain = this.heightAt(ax + (bx - ax) * t, az + (bz - az) * t) + 1.6; // 地形 + 弹道高
      const hLine = ay + (by - ay) * t;
      if (hTerrain > hLine) return true;
    }
    return false;
  }

  // 构建渲染网格: 顶点色按高度/坡度(草/土/岩), 低多边形平面着色
  buildMesh() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res - 1, this.res - 1);
    geo.rotateX(-Math.PI / 2);  // XY 平面 → XZ 地面
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grass = [0.32, 0.42, 0.20], grass2 = [0.38, 0.47, 0.24], dirt = [0.45, 0.38, 0.26], rock = [0.44, 0.43, 0.41], road = [0.42, 0.40, 0.34];
    for (let j = 0; j < this.res; j++)
      for (let i = 0; i < this.res; i++) {
        const vi = j * this.res + i;
        pos.setY(vi, this.h[j * this.res + i]);
        const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
        // 坡度(中心差分)
        const hx = this.heightAt(x + this.cell, z) - this.heightAt(x - this.cell, z);
        const hz = this.heightAt(x, z + this.cell) - this.heightAt(x, z - this.cell);
        const slope = Math.hypot(hx, hz) / (this.cell * 2);
        const hh = this.h[j * this.res + i];
        let col = hh < 9 ? (j % 2 ^ i % 2 ? grass : grass2) : grass2;
        const k = SF.Util.clamp((slope - 0.25) * 2.2, 0, 1);       // 陡 → 土/岩
        col = col.map((v, c) => SF.Util.lerp(v, (hh > 30 ? rock : dirt)[c], k));
        const roadK = (Math.abs(x) < 6.5 && hh < 10 && z > -200) ? 0.55 : 0;  // 谷地土路
        col = col.map(v => SF.Util.lerp(v, road[0] * (v / 0.4), roadK)); // 近似调暗
        colors[vi * 3] = col[0]; colors[vi * 3 + 1] = col[1]; colors[vi * 3 + 2] = col[2];
      }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
};
