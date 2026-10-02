// 一次性对账脚本: 已提交 JS 引用的 DOM id vs 已提交 index.html
const fs = require('fs');
const cp = require('child_process');
const html = cp.execSync('git show HEAD:client/index.html', { encoding: 'utf8' });
for (const f of ['hud', 'main', 'pickups', 'lobby', 'net']) {
  let s;
  try { s = cp.execSync('git show HEAD:client/js/' + f + '.js', { encoding: 'utf8' }); } catch { continue; }
  const ids = [...new Set([...s.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1])
    .concat([...s.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1])))];
  const miss = ids.filter(i => !html.includes('id="' + i + '"'));
  if (ids.length) console.log(f + '.js 引用 ' + ids.length + ' 个 id | index.html 缺失: ' + (miss.join(', ') || '无'));
}
