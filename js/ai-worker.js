// ai-worker.js — AI 专用 Worker: 感知/决策在独立线程按"真实时钟"运行
// 主线程再卡(渲染/GC/掉帧), 这里照常每 33ms 思考一次 —— AI 不会因为掉帧变傻。
// 架构: 用 simcore 构建"复制品世界"(与真实 world 同接口: time/terrain/covers/enemies/player),
// SF.AI 类原封不动跑在复制品上; 主线程 10Hz 推快照, 本线程把输入 30Hz 发回。
'use strict';
self.window = self;    // 脚本族都按 window.SF 挂载, worker 里先补齐别名
// Blob worker 的相对路径解析到 blob:// 无效 → 主线程注入 BASE_URL(页面 js/ 目录绝对地址)
const BASE = (typeof BASE_URL === 'string') ? BASE_URL : '';
importScripts(BASE + 'simcore.js', BASE + 'config.js', BASE + 'ai.js');

let W = null;          // 复制品世界
let tickTimer = null;
let lastTick = 0;

function buildWorld(init) {
  const terrain = SF.Sim.makeTerrain(init.heights, init.terrainCfg);
  const covers = {
    list: init.covers,                    // 碰撞列表(纯数据, 与主线程 CoverField.list 同构)
    heightAt: terrain.heightAt,
    blocked(ox, oz, oy, dx, dz, len, dy, spot) {
      return SF.Sim.coversBlocked(this.list, this.heightAt, ox, oz, oy, dx, dz, len, dy, spot);
    },
    nearestCoverBetween(ax, az, bx, bz) {
      return SF.Sim.nearestCoverBetween(this.list, ax, az, bx, bz);
    }
  };
  W = { time: 0, over: false, terrain, covers, enemies: [], player: null, mpTargets: [],
        intel: { x: 0, z: 0, t: -99, level: 0 }, ais: new Map() };
  self.SF.Game = { get world() { return W; } };   // ai.js 的 nowT()/world2time() 走这里
}

// 快照行布局(主线程 sendAISnap 同一约定):
// 敌车   [id, x, z, y, yaw, speed, velX, velZ, hp, disp, reloadT, turretYaw, lastFireT, alive, lastYawRate]
// 玩家侧 [netId, x, z, y, yaw, speed, velX, velZ, hp, lastFireT, alive, cls]
function applyEnemy(r, d, drift) {
  r.x = d[1]; r.z = d[2]; r.y = d[3]; r.yaw = d[4];
  r.speed = d[5]; r.velX = d[6]; r.velZ = d[7];
  r.hp = d[8]; r.disp = d[9]; r.reloadT = d[10];
  r.turretYaw = d[11]; r.lastFireT = d[12] + drift; r.alive = !!d[13];
  r.lastYawRate = d[14];
}
function applyPlayer(r, d, drift) {
  r.x = d[1]; r.z = d[2]; r.y = d[3]; r.yaw = d[4];
  r.speed = d[5]; r.velX = d[6]; r.velZ = d[7];
  r.hp = d[8]; r.lastFireT = d[9] + drift; r.alive = !!d[10];
  r.cls = d[11] || 'MT';   // 穿深门用车类等效甲; 兜 'MT' 防旧快照(远端幽灵本有全量 spec, 此处只认快照列)
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    buildWorld(m);
    if (!tickTimer) { lastTick = performance.now(); tickTimer = setInterval(tick, 33); }
  } else if (m.t === 'spawn') {          // 新波次: 重建 AI 集(复制品坦克由快照持续更新)
    W.enemies = []; W.ais.clear(); W.over = false;
    for (const d of m.list) {
      const r = { id: d.id, x: d.x, z: d.z, y: 0, yaw: d.yaw, speed: 0, velX: 0, velZ: 0,
                  hp: d.spec.hp, disp: d.spec.dispersion.base, reloadT: 0, turretYaw: d.yaw,
                  lastFireT: -99, alive: true, lastYawRate: 0, team: 1, netId: d.netId || 0,
                  isPlayer: false, spec: d.spec, parts: { noTurret: !!d.noTurret }, modules: { gun: 0 } };
      const ai = new SF.AI(r, d.def);
      ai.flankSlot = d.flankSlot;
      r.ai = ai;
      W.enemies.push(r);
      W.ais.set(d.id, ai);
    }
  } else if (m.t === 'snap') {           // 主线程状态同步(10Hz): 时间锚定 + 全量位置/战斗状态
    if (!W) return;
    const drift = W.time - m.time;       // 快照携带主线程模拟时钟, 换算到本线程时钟
    W.time = m.time;
    if (m.intel && m.intel.t > W.intel.t) W.intel = m.intel;
    for (const d of m.enemies) {
      const tk = W.enemies.find(x => x.id === d[0]);
      if (tk) applyEnemy(tk, d, drift);
    }
    if (m.players) {
      W.mpTargets = [];
      for (const d of m.players) {
        let tk = W.player && W.player.netId === d[0] ? W.player
               : (W.mpTargets.find(x => x.netId === d[0]) || null);
        if (!tk) {
          tk = { netId: d[0], isPlayer: true, team: 0, spec: {}, parts: { noTurret: false }, modules: { gun: 0 } };
          if (!W.player) W.player = tk;
        }
        applyPlayer(tk, d, drift);
        W.mpTargets.push(tk);
      }
    }
  } else if (m.t === 'fire') {           // 玩家/玩家侧开炮 → AI 听声(AI 构造时挂在 SF.Bus)
    if (W) SF.Bus.emit('fire', { tank: { x: m.x, z: m.z, isPlayer: !!m.player, team: m.player ? 0 : 1, alive: true } });
  } else if (m.t === 'hurt') {           // 某辆 AI 挨打 → 确切知道挨打方位
    const ai = W && W.ais.get(m.id);
    if (ai) ai.onHurt({ x: m.x, z: m.z, team: 0 });
  } else if (m.t === 'over') { if (W) W.over = true; }
  else if (m.t === 'clear') { if (W) { W.ais.clear(); W.enemies = []; W.over = false; } }
};

/* ---------- 真实时钟主循环: 无论主线程多卡, 这里照常运转 ---------- */
function tick() {
  if (!W || !W.ais.size) { lastTick = performance.now(); return; }
  const now = performance.now();
  const dt = Math.min(0.2, Math.max(0.03, (now - lastTick) / 1000));
  lastTick = now;
  W.time += dt;                          // 快照到达时会被主线程时钟重新锚定
  if (W.over) {                          // 结算: 敌军熄火
    postMessage({ t: 'in', list: [...W.ais.keys()].map(id => [id, 0, 0, W.ais.get(id).tank.yaw, 0, 0, 0, 0]) });
    return;
  }
  const list = [];
  for (const [id, ai] of W.ais) {
    if (!ai.tank.alive) continue;
    const inp = ai.update(dt, W);
    list.push([id, +inp.throttle.toFixed(2), +inp.steer.toFixed(2), +inp.aimYaw.toFixed(3), +inp.aimPitch.toFixed(3),
               inp.fire ? 1 : 0, ai.seenNow ? 1 : 0, ai.lastTargetId || 0]);
  }
  postMessage({ t: 'in', list });
}
