// assets.js — 资源加载器: GLB 坦克 / 地图(PNG+JSON) / WAV 音效
// 全部来自 client/assets/, 缺文件给出明确报错
window.SF = window.SF || {};

SF.Assets = (() => {
  const A = { models: {}, maps: {}, sounds: {} };

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

    // 地图数据(全部预载, 出击前可任选)
    for (const m of SF.CFG.maps) {
      track((async () => {
        const json = await fetchJSON(`assets/maps/${m.dir}/map.json`);
        const heights = await loadHeightmap(`assets/maps/${m.dir}/heightmap.png`, json.terrain);
        A.maps[m.id] = { json, heights };
      })());
    }

    // 模型
    const audioCtx = A._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // 模型(文件名 → 引擎类型名)
    const MODEL_FILES = { 'm4-sherman': 'sherman', 'm4a3e8': 'sherman76', 'm4a3e2-jumbo': 'jumbo', 'm18-hellcat': 'hellcat', 'enemy-medium': 'medium', 'enemy-td': 'td', 'enemy-heavy': 'heavy',
      pz3: 'pz3', pz4: 'pz4', panther: 'panther', tiger1: 'tiger1', stug3: 'stug3', jagdpanther: 'jagdpanther',
      bt7: 'bt7', t34: 't34', t3485: 't3485', kv1: 'kv1', kv2: 'kv2', is2: 'is2', su85: 'su85', su100: 'su100', isu152: 'isu152',
      m3lee: 'm3lee', m10: 'm10', m36: 'm36',
      matilda: 'matilda', cromwell: 'cromwell', firefly: 'firefly', churchill7: 'churchill7',
      b1bis: 'b1bis', somua: 'somua', chiha: 'chiha', chinu: 'chinu' };
    for (const file in MODEL_FILES)
      track(loadGLB(`assets/models/${file}.glb`).then(g => { A.models[MODEL_FILES[file]] = g.scene; }));

    // 音效(开源音源, 见 CREDITS.md; cannon 是 ogg, 其余 wav; 缺失仅警告不阻断)
    // 音效(开源音源, 见 CREDITS.md; cannon 是 ogg, 其余 wav; 缺失仅警告不阻断)
    const sounds = ['cannon.ogg', 'pen.wav', 'bounce.wav', 'nopen.wav', 'track.wav', 'reload.wav', 'explosion.wav', 'wind.wav', 'engine-loop.wav', 'beep.wav'];
    for (const s of sounds) {
      const key = s.replace(/\.(wav|ogg)$/, '');
      track(loadSound(audioCtx, `assets/audio/${s}`).then(b => { A.sounds[key] = b; })
        .catch(() => console.warn(`音效缺失(跳过): ${s}`)));
    }
    // 中文战斗语音: 打包的 edge-tts 生成文件(优先); 缺失时引擎自动退回系统 TTS
    for (const v of ['v_pen', 'v_nopen', 'v_bounce', 'v_miss', 'v_kill', 'v_hitpen', 'v_track', 'v_ammo', 'v_engine', 'v_gun', 'v_reload']) {
      track(loadSound(audioCtx, `assets/audio/voice/${v}.mp3`).then(b => { A.sounds[v] = b; })
        .catch(() => console.warn(`语音文件缺失, 将退回系统TTS: ${v}`)));
    }

    let done = 0;
    const total = jobs.length;
    onProgress(0, total);
    await Promise.all(jobs.map(p => p.finally(() => onProgress(++done, total))));
    return A;
  }

  A.load = load;
  return A;
})();
