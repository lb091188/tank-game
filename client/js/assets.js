// assets.js — 资源加载器: GLB 坦克 / 地图(PNG+JSON) / WAV 音效 / JPG 贴图
// 懒加载: 启动只载 地图数据+所选坦克+贴图; 音效语音与其余坦克后台预取; 开战按需 ensure(并发去重)
// 缓存: 所有资源 URL 带版本戳 —— CI 给 js 盖的 ?v= 优先(保证 JS 与资产同版本);
//       本地无参则 no-store 拉 version.txt 当戳(构建工具更新它), 版本一变 URL 全变, 旧缓存自然过期
window.SF = window.SF || {};

SF.Assets = (() => {
  const A = { models: {}, maps: {}, sounds: {}, textures: {} };
  const modelJobs = new Map();   // type → Promise(并发去重)
  const mapJobs = new Map();     // id → Promise

  const mainV = (() => {
    try {
      const el = document.querySelector('script[src*="js/main.js"]');
      const q = el && el.src.split('v=')[1];
      return q ? '?v=' + encodeURIComponent(q) : '';
    } catch (e) { return ''; }
  })();
  let V = mainV;
  const ver = (url) => url + V;

  function fetchErr(url) { throw new Error(`资源加载失败(文件缺失?): ${url}`); }

  async function fetchJSON(url) {
    const r = await fetch(ver(url));
    if (!r.ok) fetchErr(url);
    return r.json();
  }

  async function fetchArrayBuffer(url) {
    const r = await fetch(ver(url));
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
      img.src = ver(url);
    });
  }

  function loadGLB(url) {
    return new Promise((resolve, reject) => {
      fetch(ver(url)).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(buf => new THREE.GLTFLoader().parse(buf, '', gltf => resolve(gltf), err => reject(err)))
        .catch(() => reject(new Error(`模型加载失败: ${url}`)));
    });
  }

  async function loadSound(ctx, url) {
    const buf = await fetchArrayBuffer(url);
    return await ctx.decodeAudioData(buf);
  }

  // 地面/掩体贴图(ambientCG CC0, 见 CREDITS.md); 缺失仅警告, 材质自动退回纯色
  const TEXTURES = ['grass', 'rock', 'asphalt', 'brick', 'wood', 'thatch', 'concrete', 'rust'];
  function loadTexture(name) {
    return new Promise(resolve => {
      new THREE.TextureLoader().load(ver(`assets/textures/${name}.jpg`),
        tex => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; A.textures[name] = tex; resolve(tex); },
        undefined, () => { console.warn(`贴图缺失(退回纯色): ${name}`); resolve(null); });
    });
  }

  // 模型(文件名 → 引擎类型名)
  const MODEL_FILES = { 'm4-sherman': 'sherman', 'm4a3e8': 'sherman76', 'm4a3e2-jumbo': 'jumbo', 'm18-hellcat': 'hellcat', 'enemy-medium': 'medium', 'enemy-td': 'td', 'enemy-heavy': 'heavy',
    pz3: 'pz3', pz4: 'pz4', panther: 'panther', tiger1: 'tiger1', stug3: 'stug3', jagdpanther: 'jagdpanther', ru251: 'ru251',
    bt7: 'bt7', t34: 't34', t3485: 't3485', kv1: 'kv1', kv2: 'kv2', is2: 'is2', su85: 'su85', su100: 'su100', isu152: 'isu152',
    m3lee: 'm3lee', m10: 'm10', m36: 'm36',
    matilda: 'matilda', cromwell: 'cromwell', firefly: 'firefly', churchill7: 'churchill7',
    b1bis: 'b1bis', somua: 'somua', chiha: 'chiha', chinu: 'chinu',
    tiger2: 'tiger2', ferdinand: 'ferdinand', is3: 'is3', t44: 't44', m26: 'm26', t26e4: 't26e4', t29: 't29', centurion: 'centurion', chiri: 'chiri',
    type62: 'type62', type59: 'type59', wz111: 'wz111',
    amx13: 'amx13', amx50100: 'amx50100', lorr40t: 'lorr40t',
    wespe: 'wespe', hummel: 'hummel', m7priest: 'm7priest', su26: 'su26' };
  const fileOf = {}; for (const f in MODEL_FILES) fileOf[MODEL_FILES[f]] = f;

  // 单坦克模型: 已载即回, 进行中去重, 失败可重试
  function getModel(type) {
    if (A.models[type]) return Promise.resolve(A.models[type]);
    if (modelJobs.has(type)) return modelJobs.get(type);
    const file = fileOf[type];
    if (!file) return Promise.reject(new Error('未知坦克类型: ' + type));
    const p = loadGLB(`assets/models/${file}.glb`).then(g => { A.models[type] = g.scene; modelJobs.delete(type); return g.scene; })
      .catch(err => { modelJobs.delete(type); throw err; });
    modelJobs.set(type, p);
    return p;
  }
  A.getModel = getModel;

  // 一组坦克模型按需补载(开战/联机前调用; 全部缓存时瞬间完成不闪加载条)
  A.ensureTanks = (types, onProgress) => {
    const list = [...new Set(types)];
    let done = 0;
    return Promise.all(list.map(t => getModel(t).finally(() => onProgress && onProgress(++done, list.length))));
  };

  // 地图(json+高程), 并发去重
  function ensureMap(id) {
    if (A.maps[id] && A.maps[id].heights) return Promise.resolve(A.maps[id]);
    if (mapJobs.has(id)) return mapJobs.get(id);
    const m = SF.CFG.maps.find(x => x.id === id);
    const p = (async () => {
      const json = await fetchJSON(`assets/maps/${m.dir}/map.json`);
      const heights = await loadHeightmap(`assets/maps/${m.dir}/heightmap.png`, json.terrain);
      A.maps[id] = { json, heights };
      mapJobs.delete(id);
      return A.maps[id];
    })().catch(err => { mapJobs.delete(id); throw err; });
    mapJobs.set(id, p);
    return p;
  }
  A.ensureMap = ensureMap;

  // 音效(开源音源, 见 CREDITS.md) + 中文战斗语音(缺失退回系统 TTS)
  const SOUNDS = ['cannon.ogg', 'pen.wav', 'bounce.wav', 'nopen.wav', 'track.wav', 'reload.wav', 'explosion.wav', 'wind.wav', 'engine-loop.wav', 'beep.wav'];
  const VOICE_VARIANTS = { v_pen: 3, v_nopen: 3, v_bounce: 3, v_absorb: 3, v_gunout: 2, v_ram: 2, v_kill: 3, v_wipe: 2,
    v_hitpen: 3, v_track: 3, v_ammo: 3, v_engine: 2, v_gun: 2, v_rammed: 2, v_splash: 2, v_reload: 3 };

  // 启动最小集: 版本戳 + 全部地图(json/高程都很小) + 所选坦克 + 贴图 → 车库秒开
  A.load = async (bootTank, onProgress) => {
    if (!V) {   // 本地无 ?v=: no-store 拉 version.txt 当戳(GH Pages 的 10 分钟缓存拦不住 no-store)
      try {
        const r = await fetch('version.txt', { cache: 'no-store' });
        if (r.ok) { const t = (await r.text()).trim(); if (t) V = '?v=' + encodeURIComponent(t); }
      } catch (e) { }
    }
    const jobs = [];
    for (const m of SF.CFG.maps) jobs.push(ensureMap(m.id));
    jobs.push(getModel(bootTank));
    for (const t of TEXTURES) jobs.push(loadTexture(t));
    let done = 0;
    const total = jobs.length;
    onProgress && onProgress(0, total);
    await Promise.all(jobs.map(p => p.finally(() => onProgress && onProgress(++done, total))));
    return A;
  };

  // 后台预取(不阻塞, 逐项排队, 失败仅警告): 音效 → 语音 → 其余坦克模型
  A.prefetch = () => {
    const audioCtx = A._audioCtx = A._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const chain = (async () => {
      for (const s of SOUNDS)
        await loadSound(audioCtx, `assets/audio/${s}`).then(b => { A.sounds[s.replace(/\.(wav|ogg)$/, '')] = b; }).catch(() => console.warn(`音效缺失(跳过): ${s}`));
      for (const ev in VOICE_VARIANTS)
        for (let i = 1; i <= VOICE_VARIANTS[ev]; i++) {
          const v = `${ev}${i}`;
          await loadSound(audioCtx, `assets/audio/voice/${v}.mp3`).then(b => { A.sounds[v] = b; }).catch(() => console.warn(`语音文件缺失, 将退回系统TTS: ${v}`));
        }
      for (const type of new Set(Object.values(MODEL_FILES)))
        await getModel(type).catch(() => console.warn('模型预取失败(跳过):', type));
    })();
    chain.catch(() => { });
    return chain;
  };

  return A;
})();
