#!/usr/bin/env node
// fix-engine-loop.js — 修复 engine-loop.wav 的循环接缝(交叉淡化), 可重复运行
// 用法: node tools/fix-engine-loop.js
// 原理: 取结尾 F 秒与开头 F 秒交叉淡化, 输出裁掉结尾 F 秒 → 循环点无缝
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'client', 'assets', 'audio', 'engine-loop.wav');
const FADE = 0.25; // 交叉淡化时长(秒)

const b = fs.readFileSync(FILE);
let off = 12, fmt = null, dataOff = 0, dataLen = 0;
const chunks = [];
while (off < b.length - 8) {
  const id = b.toString('ascii', off, off + 4), len = b.readUInt32LE(off + 4);
  chunks.push({ id, start: off, len });
  if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
  if (id === 'data') { dataOff = off + 8; dataLen = len; }
  off += 8 + len + (len % 2);
}
const { ch, sr, bits } = fmt;
const bytesPer = bits / 8;
const totalFrames = Math.floor(dataLen / bytesPer / ch);
const F = Math.floor(FADE * sr);          // 淡化帧数
const outFrames = totalFrames - F;

const read = (frame, c) => b.readInt16LE(dataOff + (frame * ch + c) * 2);
const out = Buffer.alloc(dataLen);
for (let f = 0; f < outFrames; f++)
  for (let c = 0; c < ch; c++) {
    let v;
    if (f < F) {
      const w = f / F;                    // 0→1: 结尾渐出, 开头渐入
      v = read(f, c) * w + read(totalFrames - F + f, c) * (1 - w);
    } else v = read(f, c);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), (f * ch + c) * 2);
  }

// 重写文件: 原头部 + 处理后的 data
const parts = [b.subarray(0, dataOff), out.subarray(0, outFrames * ch * bytesPer)];
const newFile = Buffer.concat(parts);
// 更新 data chunk 长度与 RIFF 长度
newFile.writeUInt32LE(outFrames * ch * bytesPer, dataOff - 4);
newFile.writeUInt32LE(newFile.length - 8, 4);
fs.writeFileSync(FILE, newFile);

// 验证: 循环点前后帧跳变(声道0)
const lastF = newFile.readInt16LE(dataOff + (outFrames - 1) * ch * 2);
const firstF = newFile.readInt16LE(dataOff);
console.log(`✓ engine-loop.wav 接缝修复: ${totalFrames}帧 → ${outFrames}帧 (${(outFrames / sr).toFixed(2)}s), 循环点跳变 ${Math.abs(lastF - firstF) / 32768}`);
