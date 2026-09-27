#!/usr/bin/env node
// dev-static.js — 零依赖静态文件服务器(开发用): 与 server.js 同缓存策略, 支持 MIME
// 缓存: index.html/version.txt 永远最新(no-store); 带 ?v= 的资源长缓存 immutable; 其余 no-cache
// 用法: node server/dev-static.js [端口] [目录=client]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8341', 10);
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'client'));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  const hasV = /[?&]v=/.test(req.url);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404: ' + urlPath); return; }
    const cache = (urlPath === '/index.html' || urlPath === '/version.txt') ? 'no-store'
      : hasV ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache, 'Content-Length': data.length
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`静态服务: http://127.0.0.1:${PORT}  ← ${ROOT}`);
});
