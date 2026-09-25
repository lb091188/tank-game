// audio.js — WebAudio 播放器: 音效文件播放 + 位置声像 + 引擎变调循环
// 音源全部来自 assets/audio/*.wav (可在加载后同名替换)
window.SF = window.SF || {};

SF.Audio = (() => {
  let ctx, master, engineSrc, engineGain, engineRate = 1;
  let listener = { x: 0, z: 0, yaw: 0 };
  let voices = 0;

  function init() {
    ctx = SF.Assets._audioCtx;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    resume();
  }
  function resume() { if (ctx.state === 'suspended') ctx.resume(); }

  // 简易空间化: 距离衰减 + 相对朝向声像
  function spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - listener.x, dz = pos.z - listener.z;
    const d = Math.hypot(dx, dz);
    const gain = SF.Util.clamp(1 / (1 + d / 55), 0.06, 1);
    const worldAng = Math.atan2(dx, dz);
    const rel = SF.Util.angDiff(listener.yaw, worldAng);
    return { gain, pan: SF.Util.clamp(Math.sin(rel), -0.9, 0.9) };
  }

  function play(name, pos, opts = {}) {
    const buf = SF.Assets.sounds[name];
    if (!buf || !ctx) return;
    if (voices > 14) return;                       // 声音上限
    const { gain, pan } = spatial(pos);
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

  // 玩家引擎: 真实引擎循环(开源音源), playbackRate 随车速变调(怠速0.88 → 高速1.62)
  function startEngine() {
    const buf = SF.Assets.sounds['engine-loop'];
    if (!buf || engineSrc) return;
    engineSrc = ctx.createBufferSource();
    engineSrc.buffer = buf; engineSrc.loop = true;
    engineSrc.playbackRate.value = 0.88;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.18;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    engineSrc.connect(lp); lp.connect(engineGain); engineGain.connect(master);
    engineSrc.start();
  }
  function setEngine(speedRatio, throttle) {
    if (!engineSrc) return;
    const target = 0.88 + SF.Util.clamp(speedRatio, 0, 1) * 0.74;
    engineRate += (target - engineRate) * 0.08;
    engineSrc.playbackRate.value = engineRate;
    engineGain.gain.value = 0.15 + SF.Util.clamp(Math.abs(throttle), 0, 1) * 0.12 + SF.Util.clamp(speedRatio, 0, 1) * 0.08;
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

  return { init, play, startEngine, setEngine, startAmbient, setListener, resume };
})();
