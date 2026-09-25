#!/usr/bin/env node
// dev-static.js — 零依赖静态文件服务器(开发用): no-cache, 支持 MIME
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
  '.wav': 'audio/wav', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404: ' + urlPath); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'Content-Length': data.length
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`静态服务: http://127.0.0.1:${PORT}  ← ${ROOT} (no-cache)`);
});
