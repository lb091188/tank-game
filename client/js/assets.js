// assets.js — 资源加载器: GLB 坦克 / 地图(PNG+JSON) / WAV 音效
// 全部来自 client/assets/, 缺文件给出明确报错
window.SF = window.SF || {};

SF.Assets = (() => {
  const A = { models: {}, map: null, sounds: {}, mapDir: 'assets/maps/l01-encounter' };

  function fetchErr(url) { throw new Error(`资源加载失败(文件缺失?): ${url}`); }

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) fetchErr(url);
    return r.json();
  }

  async function fetchArrayBuffer(url) {
    const r = await fetch(url);
    if (!r.ok) fetchErr(url);
    return r.arrayBuffer();
  }

  // 16 位灰度 PNG → Float32Array 高程(米) — 用 <img> + canvas 读像素(需 HTTP)
  function loadHeightmap(url, terrainCfg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        let data;
        try { data = ctx.getImageData(0, 0, c.width, c.height).data; }
        catch (e) { reject(new Error('高程图读取被浏览器拦截(必须通过 HTTP 访问, 不能 file:// 直开)')); return; }
        const { resolution, maxHeight } = terrainCfg;
        const h = new Float32Array(resolution * resolution);
        for (let i = 0; i < resolution * resolution; i++) {
          // 16 位灰度: R=G=B, 大端 16 位值 = data[i*4]*256 + data[i*4+1]
          const v16 = data[i * 4] * 256 + data[i * 4 + 1];
          h[i] = (v16 / 65535) * maxHeight;
        }
        resolve(h);
      };
      img.onerror = () => reject(new Error(`高程图加载失败: ${url}`));
      img.src = url;
    });
  }

  function loadGLB(url) {
    return new Promise((resolve, reject) => {
      fetch(url).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(buf => new THREE.GLTFLoader().parse(buf, '', gltf => resolve(gltf), err => reject(err)))
        .catch(() => reject(new Error(`模型加载失败: ${url}`)));
    });
  }

  async function loadSound(ctx, url) {
    const buf = await fetchArrayBuffer(url);
    return await ctx.decodeAudioData(buf);
  }

  // onProgress(done, total)
  async function load(onProgress) {
    const jobs = [];
    const track = (p) => jobs.push(p);

    // 地图数据
    const mapPromise = (async () => {
      A.map = await fetchJSON(`${A.mapDir}/map.json`);
      A.heights = await loadHeightmap(`${A.mapDir}/heightmap.png`, A.map.terrain);
    })();
    track(mapPromise);

    // 模型
    const audioCtx = A._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // 模型(文件名 → 引擎类型名)
    const MODEL_FILES = { 'm4-sherman': 'sherman', 'enemy-medium': 'medium', 'enemy-td': 'td', 'enemy-heavy': 'heavy' };
    for (const file in MODEL_FILES)
      track(loadGLB(`assets/models/${file}.glb`).then(g => { A.models[MODEL_FILES[file]] = g.scene; }));

    // 音效
    const sounds = ['cannon', 'pen', 'bounce', 'nopen', 'track', 'reload', 'explode', 'wind', 'engine-loop'];
    for (const s of sounds)
      track(loadSound(audioCtx, `assets/audio/${s}.wav`).then(b => { A.sounds[s] = b; }));

    let done = 0;
    const total = jobs.length;
    onProgress(0, total);
    await Promise.all(jobs.map(p => p.finally(() => onProgress(++done, total))));
    return A;
  }

  A.load = load;
  return A;
})();
