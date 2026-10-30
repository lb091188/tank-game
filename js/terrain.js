// terrain.js — 地形: 由高程图构建渲染网格 + 物理采样(渲染与物理同源)
// 采样逻辑在 simcore.js(主线程/Worker 共用), 此类是渲染侧封装
window.SF = window.SF || {};

SF.Terrain = class {
  constructor(heights, terrainCfg) {
    const s = SF.Sim.makeTerrain(heights, terrainCfg);
    this.h = s.h; this.res = s.res; this.size = s.size; this.half = s.half; this.cell = s.cell;
    this.heightAt = s.heightAt;
    this.losBlocked = s.losBlocked;
    this.slopeAhead = s.slopeAhead;
    this.gradAt = s.gradAt;
  }

  // 构建渲染网格: 顶点色按 theme(草原/城市/山岩) + 高度/坡度
  buildMesh(theme = 'grass') {
    const P = {
      grass: { low: [0.44, 0.46, 0.30], mid: [0.32, 0.42, 0.20], mid2: [0.38, 0.47, 0.24], high: [0.44, 0.43, 0.41], slope: [0.45, 0.38, 0.26] },
      city: { low: [0.40, 0.40, 0.41], mid: [0.46, 0.46, 0.45], mid2: [0.38, 0.38, 0.39], high: [0.34, 0.34, 0.35], slope: [0.30, 0.30, 0.31] },
      rock: { low: [0.42, 0.40, 0.34], mid: [0.36, 0.37, 0.32], mid2: [0.42, 0.41, 0.36], high: [0.48, 0.47, 0.45], slope: [0.36, 0.33, 0.29] },
      sand: { low: [0.74, 0.64, 0.46], mid: [0.70, 0.60, 0.42], mid2: [0.76, 0.67, 0.50], high: [0.58, 0.52, 0.42], slope: [0.60, 0.52, 0.38] },
      winter: { low: [0.72, 0.75, 0.80], mid: [0.84, 0.86, 0.90], mid2: [0.76, 0.79, 0.85], high: [0.90, 0.91, 0.94], slope: [0.42, 0.40, 0.37] }
    }[theme] || { low: [0.44, 0.46, 0.30], mid: [0.32, 0.42, 0.20], mid2: [0.38, 0.47, 0.24], high: [0.44, 0.43, 0.41], slope: [0.45, 0.38, 0.26] };
    const grass = P.mid, grass2 = P.mid2, rock = P.high, dirt = P.slope, lowc = P.low;
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res - 1, this.res - 1);
    geo.rotateX(-Math.PI / 2);  // XY 平面 → XZ 地面
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
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
        col = col.map((v, c) => SF.Util.lerp(v, lowc[c], SF.Util.clamp((9 - hh) / 6, 0, 1) * 0.7));   // 低地压暗
        const k = SF.Util.clamp((slope - 0.25) * 2.2, 0, 1);       // 陡 → 岩/土
        col = col.map((v, c) => SF.Util.lerp(v, (hh > 30 ? rock : dirt)[c], k));
        if (theme === 'city') {                                     // 城市街道网格(沥青深灰)
          const streetX = Math.abs(((x + 39) % 78 + 78) % 78 - 39) < 9;
          const streetZ = Math.abs(((z + 39) % 78 + 78) % 78 - 39) < 9;
          if ((streetX || streetZ) && hh < 14) col = [0.20, 0.20, 0.21];
          else if (hh < 14) col = col.map(v => v * 0.92);           // 街区地面混凝土
        }
        if (theme === 'grass') {                                    // 草原谷地土路(保留)
          const roadK = (Math.abs(x) < 8 && hh < 10 && z > -250) ? 0.55 : 0;
          col = col.map(v => SF.Util.lerp(v, 0.30, roadK));
        }
        // 不可攀断崖标识: 梯度超爬坡极限(36°≈梯度0.68)开始压黑, 断面中段(最陡处≈1.05+)近黑;
        // 登顶坡道(≤34°/梯度0.60)不受影响 —— 亮色=能上, 渐黑=上不去(滑下不摔死), 玩家一眼可辨
        const cliffK = SF.Util.clamp((slope - 0.68) / 0.37, 0, 1);
        if (cliffK > 0) col = col.map(v => v * (1 - cliffK * 0.85));
        colors[vi * 3] = col[0]; colors[vi * 3 + 1] = col[1]; colors[vi * 3 + 2] = col[2];
      }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // 主题贴图(ambientCG CC0): 顶点色相乘保留生物群系/坡面着色, 贴图补微观细节
    const TEX = { grass: ['grass', 150], city: ['asphalt', 170], rock: ['rock', 110], sand: ['rock', 130], winter: ['rock', 110] }[theme] || ['grass', 150];
    const base = SF.Assets && SF.Assets.textures[TEX[0]];
    let mat;
    if (base) {
      const tex = base.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(TEX[1], TEX[1]);
      mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
    } else mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
};
