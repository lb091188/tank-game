#!/usr/bin/env node
// 构建 Pages 静态版产物: client/ → dist-pages/ (零依赖, 本地 / GitHub Actions / Cloudflare Pages 通用)
//   ① 写 edition.js: PvE 版标记, 隐藏联机入口 (client/js/lobby.js 读 window.SF_EDITION)
//   ② version.txt 写入最近一次提交时间 (客户端 assets.js no-store 拉它当全局资源戳)
//   ③ index.html 的 <script src="js/..."> 追加 ?v=<版本> 破 CDN 缓存
// 逻辑与 .github/workflows/deploy.yml 一致; Cloudflare Pages 构建命令 = `node tools/build-pages-dist.js`, 输出目录 = dist-pages
// 注意: 部署的永远是"已提交"内容 —— 本地未提交的改动不会进 dist-pages 的版本戳语义

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'client');
const out = path.join(root, 'dist-pages');

// 版本 = HEAD 提交时间 (无 git 环境退回构建时刻)
let version = new Date().toISOString();
try {
    version = execSync('git log -1 --format=%cI', { cwd: root, encoding: 'utf8' }).trim() || version;
} catch {}
const v = version.replace(/:/g, '_');   // URL 参数里避免 ':'

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
fs.writeFileSync(path.join(out, 'edition.js'), "window.SF_EDITION='pve';\n");
fs.writeFileSync(path.join(out, 'version.txt'), version + '\n');

const htmlPath = path.join(out, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/src="(js\/[^"?]*)"/g, `src="$1?v=${v}"`);
fs.writeFileSync(htmlPath, html);

let files = 0;
(function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files++;
    }
})(out);
console.log(`dist-pages 构建完成: ${files} 个文件, version=${version}, 脚本戳 ?v=${v}`);
