#!/usr/bin/env node
// build-audio.js — 程序合成 WAV 音效(备用音源, 输出到 synth/ 子目录)
// 用法: node tools/build-audio.js   → client/assets/audio/synth/*.wav
// 主音效已换用开源音源(见 CREDITS.md); 本脚本仅作为无网络时的备用生成器,
// 输出到 synth/ 子目录, 不会覆盖 assets/audio/ 下的开源文件。
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'client', 'assets', 'audio', 'synth');
const SR = 44100;

/* ---------- WAV(PCM16 单声道) 写入 ---------- */
function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`✓ ${name}  ${(n / SR).toFixed(2)}s`);
}

/* ---------- 合成工具 ---------- */
const rnd = (() => { let s = 88675123; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; }; })();
const env = (t, attack, decay) => t < attack ? t / attack : Math.exp(-(t - attack) / decay);
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);
// 一阶低通/高通(状态保持)
function lowpass(samples, cutoff) {
  const a = 1 - Math.exp(-2 * Math.PI * cutoff / SR); let y = 0;
  return samples.map(x => (y += a * (x - y)));
}
function highpass(samples, cutoff) {
  const a = 1 - Math.exp(-2 * Math.PI * cutoff / SR); let x0 = 0, y = 0;
  return samples.map(x => { y += a * ((x - x0) - y); x0 = x; return x - y; });
}
const normalize = (s, peak = 0.88) => { let m = 1e-9; for (const v of s) m = Math.max(m, Math.abs(v)); return s.map(v => v / m * peak); };
const tanh = x => Math.tanh(x * 2.2);

function silence(sec) { return new Float64Array(Math.round(sec * SR)); }
function add(dst, src, atSec, gain = 1) {
  const off = Math.round(atSec * SR);
  for (let i = 0; i < src.length && off + i < dst.length; i++) dst[off + i] += src[i] * gain;
}

/* ---------- 各音效 ---------- */

// 开炮: 低频冲击 + 噪声爆 + 回声, 有"闷雷"感
function makeCannon() {
  const d = silence(1.5);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    d[i] = 1.15 * sine(44, t) * env(t, 0.002, 0.28) + 0.3 * sine(88, t) * env(t, 0.002, 0.12);
  }
  const burst = new Float64Array(Math.round(0.7 * SR));
  for (let i = 0; i < burst.length; i++) burst[i] = rnd() * env(i / SR, 0.001, 0.09);
  const lp = lowpass(Array.from(burst), 900);
  add(d, lp.map(tanh), 0, 1.2);
  const slap = lowpass(Array.from(burst), 400).map((v, i) => v * env(i / SR + 0.2, 0.001, 0.07));
  add(d, slap, 0.21, 0.4); // 远处回响
  return normalize(d.map(tanh));
}

// 击穿: 金属穿透脆响
function makePen() {
  const d = silence(0.5);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    d[i] = 0.6 * sine(620, t) * env(t, 0.001, 0.09) + 0.5 * sine(1560, t) * env(t, 0.001, 0.05) + 0.35 * sine(2440, t) * env(t, 0.001, 0.035);
  }
  const nz = new Float64Array(Math.round(0.1 * SR));
  for (let i = 0; i < nz.length; i++) nz[i] = rnd() * env(i / SR, 0.001, 0.02);
  add(d, highpass(Array.from(nz), 1500), 0, 0.5);
  return normalize(d);
}

// 跳弹: 高频下滑"叮——"
function makeBounce() {
  const d = silence(0.45);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR, f = 2600 * Math.exp(-t * 2.2) + 500;
    d[i] = 0.8 * sine(f, t) * env(t, 0.001, 0.1) + 0.25 * sine(f * 2.7, t) * env(t, 0.001, 0.05);
  }
  const spark = new Float64Array(Math.round(0.12 * SR));
  for (let i = 0; i < spark.length; i++) spark[i] = rnd() * env(i / SR, 0.001, 0.015);
  add(d, highpass(Array.from(spark), 3000), 0, 0.45);
  return normalize(d);
}

// 未击穿: 闷响
function makeNopen() {
  const d = silence(0.35);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    d[i] = sine(175, t) * env(t, 0.001, 0.07) + 0.4 * sine(95, t) * env(t, 0.001, 0.1);
  }
  const nz = new Float64Array(Math.round(0.15 * SR));
  for (let i = 0; i < nz.length; i++) nz[i] = rnd() * env(i / SR, 0.001, 0.03);
  add(d, lowpass(Array.from(nz), 380), 0, 0.7);
  return normalize(d);
}

// 履带断裂: 三连金属撞击
function makeTrack() {
  const d = silence(0.75);
  [0, 0.13, 0.29].forEach((at, k) => {
    const g = 1 - k * 0.3;
    const seg = silence(0.2);
    for (let i = 0; i < seg.length; i++) {
      const t = i / SR;
      seg[i] = sine(880 + k * 120, t) * env(t, 0.001, 0.045) * 0.7 + sine(1380, t) * env(t, 0.001, 0.03) * 0.5;
    }
    const nz = new Float64Array(Math.round(0.05 * SR));
    for (let i = 0; i < nz.length; i++) nz[i] = rnd() * env(i / SR, 0.001, 0.012);
    add(seg, lowpass(Array.from(nz), 1200), 0, 0.6);
    add(d, Array.from(seg), at, g);
  });
  return normalize(d);
}

// 装填完成: 咔-哒
function makeReload() {
  const d = silence(0.32);
  [[0, 1250, 0.9], [0.15, 780, 1.0]].forEach(([at, f, g]) => {
    const seg = silence(0.1);
    for (let i = 0; i < seg.length; i++) seg[i] = sine(f, i / SR) * env(i / SR, 0.001, 0.02);
    add(d, Array.from(seg), at, g);
  });
  return normalize(d);
}

// 殉爆/坦克摧毁: 大爆炸
function makeExplode() {
  const d = silence(2.3);
  let brown = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    brown = brown * 0.985 + rnd() * 0.15;             // 布朗噪声
    const lp = lowpassVal(brown, 900 * Math.exp(-t * 1.1) + 70);
    d[i] = lp * env(t, 0.004, 0.55) + 0.5 * sine(34, t) * env(t, 0.004, 0.8);
    if (rnd() > 0.9995) d[i] += rnd() * env(rnd() * 0.001, 0.0005, 0.04) * 0.5; // 碎裂噼啪
  }
  return normalize(d.map(tanh));
}
let _lpY = 0;
function lowpassVal(x, cutoff) { const a = 1 - Math.exp(-2 * Math.PI * cutoff / SR); _lpY += a * (x - _lpY); return _lpY; }

// 环境风声(循环): 低通噪声 + 整周期慢起伏, 首尾交叉淡化保无缝
function makeWind() {
  const sec = 6, d = silence(sec);
  const nz = new Float64Array(d.length);
  for (let i = 0; i < nz.length; i++) nz[i] = rnd();
  const lp = lowpass(Array.from(nz), 420);
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    const lfo = 0.6 + 0.4 * Math.sin(2 * Math.PI * (t / sec) * 2); // 6s 内整 2 周期
    d[i] = lp[i] * lfo;
  }
  const fadeN = Math.round(0.25 * SR); // 首尾交叉淡化
  for (let i = 0; i < fadeN; i++) {
    const w = i / fadeN;
    const a = d[i], b = d[d.length - fadeN + i];
    d[i] = a * w + b * (1 - w) * 0; d[d.length - fadeN + i] = b * (1 - w * 0) * (1 - w) + a * 0; // 简化: 只淡化尾部接入头部
  }
  for (let i = 0; i < fadeN; i++) d[d.length - fadeN + i] = d[d.length - fadeN + i] * (i / fadeN); // 尾部淡入补偿
  return normalize(d, 0.3);
}

// 引擎循环: 锯齿基频 55Hz + 谐波 + 机械噪声, 所有频率整周期(2s 内)保证无缝循环
// 引擎用 playbackRate 随车速变调(0.75 怠速 ~ 1.8 高速)
function makeEngine() {
  const sec = 2, d = silence(sec);
  const N = d.length;
  const noiseLp = lowpass(Array.from({ length: N }, () => rnd()), 250);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const saw = 2 * ((55 * t) % 1) - 1;
    const rough = 0.85 + 0.15 * sine(27.5, t);  // 半频点火起伏(55 半周期=整)
    d[i] = rough * (0.5 * saw + 0.25 * sine(110, t) + 0.18 * sine(165, t) + 0.1 * sine(220, t)) + 0.22 * noiseLp[i];
  }
  return normalize(d.map(v => tanh(v * 0.8)), 0.6);
}

/* ---------- 输出 ---------- */
fs.mkdirSync(OUT, { recursive: true });
writeWav('cannon.wav', makeCannon());
writeWav('pen.wav', makePen());
writeWav('bounce.wav', makeBounce());
writeWav('nopen.wav', makeNopen());
writeWav('track.wav', makeTrack());
writeWav('reload.wav', makeReload());
writeWav('explode.wav', makeExplode());
writeWav('wind.wav', makeWind());
writeWav('engine-loop.wav', makeEngine());
console.log(`\n完成: 9 个音效 → ${OUT}`);
