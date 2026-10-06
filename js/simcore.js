// simcore.js — 主线程/Worker 共用的纯模拟核心(零 THREE 依赖, window 与 DedicatedWorker 都能跑)
// 提取自 terrain.js / models.js CoverField: 地形高程采样、通视、掩体遮挡/寻掩。
// 单一实现两处引用: 主线程的 SF.Terrain/CoverField 是薄封装, worker(ai-worker.js)直接用它
// 构建与真实 world 同接口的"复制品世界", SF.AI 类不区分两边。
window.SF = window.SF || {};
SF.Sim = (() => {

  /* ---------- 地形: 双线性高程 + 通视 + 坡度(与 SF.Terrain 同源) ---------- */
  function makeTerrain(heights, terrainCfg) {
    const res = terrainCfg.resolution, size = terrainCfg.size, half = size / 2;
    const cell = size / (res - 1);
    function heightAt(x, z) {
      const U = SF.Util;
      const fi = U.clamp((x + half) / size, 0, 1) * (res - 1);
      const fj = U.clamp((z + half) / size, 0, 1) * (res - 1);
      const i = Math.min(res - 2, Math.floor(fi)), j = Math.min(res - 2, Math.floor(fj));
      const tx = fi - i, tz = fj - j;
      const a = heights[j * res + i], b = heights[j * res + i + 1];
      const c = heights[(j + 1) * res + i], d = heights[(j + 1) * res + i + 1];
      return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
    }
    // 地形通视: 两点(含眼高)之间地形是否遮挡; 4m 细步进 —— "车体头顶露一丝"也能点亮(6m 步进会跳过露头缝隙)
    // margin: 视线语义传 0.2(点亮用——1.6 的弹道余量会把只探出炮塔 0.3~0.5m 的目标判成被挡,
    // '非要出一个车身才点亮'即此), 默认 1.6 不动兼容其他调用方; 步进 2m 兜山脊窄缝漏采
    function losBlocked(ax, az, ay, bx, bz, by, margin) {
      const m2 = margin === undefined ? 1.6 : margin;
      const d = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(2, Math.ceil(d / 2));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const hTerrain = heightAt(ax + (bx - ax) * t, az + (bz - az) * t) + m2;
        const hLine = ay + (by - ay) * t;
        if (hTerrain > hLine) return true;
      }
      return false;
    }
    // 沿朝向的坡度(正=上坡), AI 爬坡回避用
    function slopeAhead(x, z, yaw, dist) {
      const s = Math.sin(yaw), c = Math.cos(yaw);
      const h0 = heightAt(x, z), h1 = heightAt(x + s * dist, z + c * dist);
      return Math.atan2(h1 - h0, dist);
    }
    // 梯度模(最陡方向的坡度正切): 不可攀判定用 —— 方向坡度可被斜向迂回(之字爬坡)绕过,
    // 站在过陡地面上无论朝向都上不去, 陡壁=墙
    function gradAt(x, z) {
      const e = 2.5;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      return Math.hypot(gx, gz);
    }
    return { h: heights, res, size, half, cell, heightAt, losBlocked, slopeAhead, gradAt };
  }

  /* ---------- 掩体遮挡: 包围圆粗剔除 + OBB/圆精确 + 高度比较; 返回沿射线最近命中(-1 无) ----------
     list = CoverField 的碰撞列表(col 对象), heightAt = 地形高程采样(注入, 不读全局) */
  function coversBlocked(list, heightAt, ox, oz, oy, dx, dz, len, dy, spot) {
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!(c.blocksShells || (spot && c.blocksSpot))) continue;
      const t0 = SF.Util.rayCircle(ox, oz, dx, dz, len, c.x, c.z, c.r);
      if (t0 < 0) continue;
      const t = c.shape === 'box' ? SF.Util.rayObb(ox, oz, dx, dz, len, c) : t0;
      if (t < 0 || (best >= 0 && t >= best)) continue;
      // WoT: 观察者身边 50m 内的软质草本(草丛/树篱/草垛)对视线透明 —— 视野里看得见就点得亮
      if (spot && c.blocksSpot && !c.blocksShells && t < 50) continue;
      // WoT 15m 规: 目标开炮后 4s 内, 它 15m 内的草本不再遮蔽它(贴草蹲射必暴露);
      // 离草 ≥15m 开炮(草后狙击)照常隐蔽
      if (spot && spot.fired && c.blocksSpot && !c.blocksShells
        && Math.hypot(c.x - spot.tx, c.z - spot.tz) < 15) continue;
      let ch = c.h;
      if (spot && c.blocksSpot && !c.blocksShells && spot.concealed
        && Math.hypot(ox + dx * t - spot.tx, oz + dz * t - spot.tz) < 6)
        ch += 1.8;                                    // 草丛把蹲入的整车连炮塔一起藏住
      const h = oy + dy * t;
      if (h < heightAt(ox + dx * t, oz + dz * t) + ch) best = t;  // 命中掩体高度内
    }
    return best;
  }

  // 找 a→b 方向最近的掩体(AI 撤退寻掩用): 硬掩体(挡弹)或视觉掩体(挡视线)都算
  function nearestCoverBetween(list, ax, az, bx, bz) {
    let best = null, bestT = 1e9;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1) return null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.blocksShells && !c.blocksSpot) continue;
      const t = SF.Util.rayCircle(ax, az, dx / len, dz / len, len, c.x, c.z, c.r);
      if (t >= 0 && t < bestT) { bestT = t; best = c; }
    }
    return best;
  }

  /* ---------- 隐蔽/点亮(从 ai.js 参数化): world → (coversList数组, time) ---------- */
  // 隐蔽物状态(WoT): 草丛/树篱/草垛/残骸 = 挡视线的软质物; 身处其半径内 = inBush; 开炮后 4s "失效"
  // bushes 缓存在 list 数组自身(战斗期间不变)
  function bushState(list, t, time) {
    const bushes = list.bushes || (list.bushes = list.filter(b => b.blocksSpot && !b.blocksShells));
    let inBush = false;
    for (const b of bushes)
      if (Math.hypot(b.x - t.x, b.z - t.z) < b.r + 3.5) { inBush = true; break; }
    const fired = time - (t.lastFireT || -99) < 4;   // 开炮后 4s 隐蔽失效窗口(近 15m 草丛也失效, 见 coversBlocked)
    return { inBush, fired, concealed: inBush && !fired };
  }
  // 隐蔽值(WoT camo): 移动减半; 蹲草 +0.25; 开炮后 4s 近乎清零
  function camoOf(list, t, time) {
    const c0 = (t.spec && t.spec.camo !== undefined) ? t.spec.camo : 0.12;
    let c = c0;
    if (Math.abs(t.speed) > 1.2 || Math.abs(t.lastYawRate || 0) > 0.08) c *= 0.5;
    if (bushState(list, t, time).inBush) c += 0.25;
    if (time - (t.lastFireT || -99) < 4) c = Math.min(c, c0 * 0.1);
    return Math.min(c, 0.8);
  }

  return { makeTerrain, coversBlocked, nearestCoverBetween, bushState, camoOf };
})();
