// audio.js — WebAudio 播放器: 音效文件播放 + 位置声像 + 引擎变调循环
// 音源全部来自 assets/audio/*.wav (可在加载后同名替换)
window.SF = window.SF || {};

SF.Audio = (() => {
  let ctx, master, engineSrc, engineGain, engineLP, engineRate = 1;
  let listener = { x: 0, z: 0, yaw: 0 };
  let voices = 0;

  function init() {
    ctx = SF.Assets._audioCtx;
    master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(ctx.destination);
    resume();
  }
  function resume() { if (ctx.state === 'suspended') ctx.resume(); }

  // 简易空间化: 距离衰减(atten 越大衰减越慢) + 相对朝向声像
  function spatial(pos, atten) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - listener.x, dz = pos.z - listener.z;
    const d = Math.hypot(dx, dz);
    const gain = SF.Util.clamp(1 / (1 + d / (atten || 55)), 0.08, 1);
    const worldAng = Math.atan2(dx, dz);
    const rel = SF.Util.angDiff(listener.yaw, worldAng);
    return { gain, pan: SF.Util.clamp(Math.sin(rel), -0.9, 0.9) };
  }

  function play(name, pos, opts = {}) {
    const buf = SF.Assets.sounds[name];
    if (!buf || !ctx) return;
    if (voices > 14) return;                       // 声音上限
    const { gain, pan } = spatial(pos, opts.atten);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    const g = ctx.createGain();
    g.gain.value = (opts.gain ?? 1) * gain;
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(g); out.connect(master);
    voices++; src.onended = () => { voices--; };
    src.start();
  }

  // 玩家引擎: 真实引擎循环(开源音源); 怠速近乎无声, 音量/音调/低通随油门与车速渐强
  function startEngine() {
    if (!SF.CFG.audio.engine) return;
    const buf = SF.Assets.sounds['engine-loop'];
    if (!buf || engineSrc) return;
    engineSrc = ctx.createBufferSource();
    engineSrc.buffer = buf; engineSrc.loop = true;
    engineSrc.playbackRate.value = SF.CFG.audio.idleRate;
    engineGain = ctx.createGain();
    engineGain.gain.value = SF.CFG.audio.idleGain;
    engineLP = ctx.createBiquadFilter();
    engineLP.type = 'lowpass'; engineLP.frequency.value = SF.CFG.audio.idleLP;
    engineSrc.connect(engineLP); engineLP.connect(engineGain); engineGain.connect(master);
    engineSrc.start();
  }
  function setEngine(speedRatio, throttle) {
    if (!engineSrc) return;
    if (!SF.CFG.audio.engine) { engineGain.gain.value = 0; return; }
    const A = SF.CFG.audio;
    const drive = Math.max(Math.min(Math.abs(throttle), 1), 0) * 0.65 + SF.Util.clamp(speedRatio, 0, 1) * 0.35; // 驾驶强度
    const k = 1 - Math.exp(-0.25);   // 平滑系数(每帧)
    engineRate += (A.idleRate + SF.Util.clamp(speedRatio, 0, 1) * (A.topRate - A.idleRate) - engineRate) * k;
    engineSrc.playbackRate.value = engineRate;
    const gTarget = A.idleGain + drive * (A.maxGain - A.idleGain);
    engineGain.gain.value += (gTarget - engineGain.gain.value) * 0.06;
    engineLP.frequency.value += (A.idleLP + drive * (A.topLP - A.idleLP) - engineLP.frequency.value) * 0.05;
  }
  function startAmbient() {
    const buf = SF.Assets.sounds['wind'];
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(g); g.connect(master);
    src.start();
  }
  function setListener(x, z, yaw) { listener = { x, z, yaw }; }
  function state() { return engineGain ? { rate: +engineRate.toFixed(2), gain: +engineGain.gain.value.toFixed(3), lp: Math.round(engineLP.frequency.value) } : null; }

  // 中文战斗语音: 浏览器系统 TTS 实时合成(零下载/零版权, 用玩家自己系统的中文语音)
  // 说明: speechSynthesis 输出无法被页面静默录制(安全模型), 即时合成本身无延迟, 无需缓存
  const VOICE_TEXT = {
    v_pen: '击穿', v_nopen: '未能击穿', v_bounce: '跳弹', v_miss: '未命中',
    v_kill: '目标击毁', v_hitpen: '警告，装甲被击穿',
    v_track: '履带断裂', v_ammo: '弹药架受损', v_engine: '发动机受损', v_gun: '火炮受损', v_reload: '装填完毕'
  };
  let zhVoice = null, voicesReady = false;
  function pickVoice() {
    if (typeof speechSynthesis === 'undefined') return;
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return;
    voicesReady = true;
    zhVoice = vs.find(v => /yunjian|kangkang|huihui/i.test(v.name) && /zh/i.test(v.lang))   // 优先男声/常见中文语音
      || vs.find(v => /^zh([-_]CN)?/i.test(v.lang))
      || null;
  }
  if (typeof speechSynthesis !== 'undefined') {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function playVoice(name, important = false) {
    if (!SF.CFG.audio || SF.CFG.audio.voice === false) return;
    if (typeof speechSynthesis === 'undefined') return;
    const text = VOICE_TEXT[name];
    if (!text) return;
    try {
      if (!voicesReady) pickVoice();
      if (voicesReady && !zhVoice) return;         // 系统无中文语音 → 静默跳过(文字提示仍在)
      if (!important && speechSynthesis.speaking) return;  // 常规播报不排队堆积
      if (important) speechSynthesis.cancel();     // 重要播报打断当前
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (zhVoice) u.voice = zhVoice;
      u.rate = 1.08; u.pitch = 0.92;
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  return { init, play, playVoice, startEngine, setEngine, startAmbient, setListener, resume, state };
})();
