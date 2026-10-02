// 一次性核验脚本: 检查 pages.dev 线上部署是否包含全部修复点
const base = 'https://tank-game-9ms.pages.dev';
const get = async (p) => { const r = await fetch(base + p); return { code: r.status, body: await r.text() }; };

(async () => {
  const h = await get('/');
  console.log('index.html:', h.code);
  console.log('  pickups.js 引用:', h.body.includes('js/pickups.js') ? 'OK' : '缺失');
  console.log('  edition PvE 标记:', h.body.includes('edition.js') ? '有(edition.js 另行加载)' : '无');
  console.log('  main.js 版本戳:', (h.body.match(/main\.js\?v=([^"]+)/) || [])[1]);
  const ed = await get('/edition.js');
  console.log('edition.js:', ed.code, ed.body.trim());
  const m = await get('/js/main.js');
  console.log('main.js:', m.code, '| 车库销毁时机已后移:', m.body.includes('加载成功才销毁车库预览') ? 'OK' : '缺失');
  const a = await get('/js/assets.js');
  console.log('assets.js:', a.code, '| challenger2 映射:', a.body.includes("challenger2: 'challenger2'") ? 'OK' : '缺失', '| genericOf 兜底:', a.body.includes('genericOf') ? 'OK' : '缺失');
  const mo = await get('/js/models.js');
  console.log('models.js:', mo.code, '| makeTank 兜底:', mo.body.includes('退回 cls 通用车模') ? 'OK' : '缺失');
  const p = await get('/js/pickups.js');
  console.log('pickups.js:', p.code, '| SF.Pickups 定义:', p.body.includes('SF.Pickups') ? 'OK' : '缺失');
  const g = await get('/assets/models/challenger2.glb');
  console.log('challenger2.glb:', g.code);
})();
