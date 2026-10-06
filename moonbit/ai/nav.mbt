// ai.js 模块级导航/点亮/目标选择/全队协同 直译:
// losClear / losGrid / losClearAny / bushState / camoOf / playerSpotMargin (ai.js:8-86),
// navGroove/navGrid/navLineClear/navFindPath (ai.js:96-160), nearestPlain/nearestTarget
// (ai.js:164-218), keyOf (ai.js:227-234), teamMemo (ai.js:242-484)。
// 每个函数注释标注原 JS 函数名与行号; 消费次序逐句对应。

///|
/// 点阵常量(ai.js:28-31)
let grid_lat : Array[Double] = [0.0, -0.95, 0.95, -0.5, 0.5]

///|
let grid_lon : Array[Double] = [0.0, -0.85, 0.85, -0.45, 0.45]

///|
let grid_obs : Array[Double] = [0.0, -0.55, 0.55]

///|
pub const GRID_OBS_H : Double = 3.0

///|
pub const GRID_TGT_H : Double = 3.3

///|
/// SIDE_ARC (ai.js:95): 侧向射界夹角
pub const SIDE_ARC : Double = 60.0 * @math.PI / 180.0

///|
/// NAV_G (ai.js:92): Math.tan(CFG.sim.maxSlope) * 0.96(模块加载期求值 ↔ 每调重算, 纯函数同值)
pub fn nav_g(ctx : Ctx) -> Double {
  @math.tan(ctx.cfg.sim.max_slope) * 0.96
}

///|
/// NAV_SUB (ai.js:93)
let nav_sub : Array[(Double, Double)] = [
  (0.0, 0.0),
  (5.0, 5.0),
  (5.0, -5.0),
  (-5.0, 5.0),
  (-5.0, -5.0),
]

///|
/// navGrid 缓存项(T._navG = {N, lo, st, pass}; Uint8Array ↔ Int 0/1)
pub(all) struct NavGrid {
  n : Int
  lo : Double
  st : Double
  pass : FixedArray[Int]
}

///|
/// SF.losClear (ai.js:8-15): 地形 + 掩体通视, 眼高 2m
pub fn los_clear(
  world : World,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> Bool {
  let ay = world.terrain.height_at(ax, az) + 2.0
  let by = world.terrain.height_at(bx, bz) + 2.0
  if world.terrain.los_blocked(ax, az, ay, bx, bz, by) {
    return false
  }
  let dx = bx - ax
  let dz = bz - az
  let len = @math.hypot(dx, dz)
  if len < 1.0 {
    return true
  }
  w_covers_blocked(world, ax, az, ay, dx / len, dz / len, len, (by - ay) / len) <
  0.0
}

///|
/// SF.losGrid (ai.js:36-60): 点阵通视(25 柱 × 3 视点); tst=coversBlocked 的 spot 上下文
/// (null=纯几何 ↔ None), margin 缺省=地形遮挡旧口径 1.6。
pub fn los_grid(
  world : World,
  ax : Double,
  az : Double,
  aw : Double,
  bx : Double,
  bz : Double,
  byaw : Double,
  bw : Double,
  bl : Double,
  tst : @simcore.Spot?,
  margin? : Double,
) -> Bool {
  let t = world.terrain
  let len0 = @math.hypot(bx - ax, bz - az)
  if len0 < 1.0 {
    return true
  }
  let px_ = -(bz - az) / len0
  let pz_ = (bx - ax) / len0
  let fx_ = @math.sin(byaw)
  let fz_ = @math.cos(byaw)
  let rx_ = @math.cos(byaw)
  let rz_ = -@math.sin(byaw)
  for o_off in grid_obs {
    let ox = ax + px_ * (o_off * aw)
    let oz = az + pz_ * (o_off * aw)
    let oy = t.height_at(ox, oz) + GRID_OBS_H
    for lon in grid_lon {
      let fx = bx + fx_ * (lon * bl)
      let fz = bz + fz_ * (lon * bl)
      for lat in grid_lat {
        let px = fx + rx_ * (lat * bw)
        let pz = fz + rz_ * (lat * bw)
        let py = t.height_at(px, pz) + GRID_TGT_H
        let blocked = match margin {
          Some(m) => t.los_blocked(ox, oz, oy, px, pz, py, margin=m)
          None => t.los_blocked(ox, oz, oy, px, pz, py)
        }
        if blocked {
          continue
        }
        let dx = px - ox
        let dz = pz - oz
        let len = @math.hypot(dx, dz)
        if len < 1.0 {
          return true
        }
        if w_covers_blocked(
            world,
            ox,
            oz,
            oy,
            dx / len,
            dz / len,
            len,
            (py - oy) / len,
            spot?=tst,
          ) <
          0.0 {
          return true
        }
      }
    }
  }
  false
}

///|
/// tank → simcore CamoTarget(bushState/camoOf 的目标桩; spec.camo 缺失 ↔ None)
fn camo_target_of(t : Tank) -> @simcore.CamoTarget {
  {
    x: t.x,
    z: t.z,
    speed: t.speed,
    last_yaw_rate: t.last_yaw_rate,
    last_fire_t: t.last_fire_t,
    camo: t.spec.camo,
  }
}

///|
/// SF.bushState (ai.js:74-76): 委托 simcore(world.covers.list + world.time)
pub fn bush_state_of(t : Tank, world : World) -> @simcore.BushState {
  world.covers.bush_state(camo_target_of(t), world.time)
}

///|
/// SF.camoOf (ai.js:84-86)
pub fn camo_of_tank(t : Tank, world : World) -> Double {
  world.covers.camo_of(camo_target_of(t), world.time)
}

///|
/// SF.playerSpotMargin (ai.js:80-83): 玩家侧点亮的地形视线余量
/// (JS: sp && sp.playerMargin !== undefined ? sp.playerMargin : 0.2 —— cfg 恒有 0.2)
pub fn player_spot_margin(ctx : Ctx) -> Double {
  ctx.cfg.ai.spot_player_margin
}

///|
/// SF.losClearAny (ai.js:65-71): 点亮策略壳。tst: None=按草丛上下文 bushState(tgt) /
/// Some(None)=纯几何 / Some(Some(spot))=显式上下文; margin 缺省 1.6。
/// (JS 侧 spec 可缺席的 worker 幽灵兜底 {w:1.5,l:3.05} 在本包 Spec 中恒有 sample。)
pub fn los_clear_any(
  world : World,
  src : Tank,
  tgt : Tank,
  tst : @simcore.Spot??,
  margin? : Double,
) -> Bool {
  let spot : @simcore.Spot? = match tst {
    None => {
      let bs = bush_state_of(tgt, world)
      Some({ tx: tgt.x, tz: tgt.z, fired: bs.fired, concealed: bs.concealed, })
    }
    Some(s) => s
  }
  los_grid(
    world,
    src.x,
    src.z,
    src.spec.sample.w,
    tgt.x,
    tgt.z,
    tgt.yaw,
    tgt.spec.sample.w,
    tgt.spec.sample.l,
    spot,
    margin?,
  )
}

// ---------- 地形导航: 绕行不可攀地形(ai.js:88-160) ----------

///|
/// navGroove (ai.js:96-103): 凹槽判定(4 向成对高差)
fn nav_groove(world : World, x : Double, z : Double) -> Bool {
  let h_c = world.terrain.height_at(x, z)
  for k in 0..<4 {
    let a = k.to_double() * @math.PI / 4.0
    let dx = @math.sin(a) * 14.0
    let dz = @math.cos(a) * 14.0
    if world.terrain.height_at(x + dx, z + dz) > h_c + 3.0 &&
      world.terrain.height_at(x - dx, z - dz) > h_c + 3.0 {
      return true
    }
  }
  false
}

///|
/// navBlockedPt (ai.js:104)
fn nav_blocked_pt(ctx : Ctx, world : World, x : Double, z : Double) -> Bool {
  world.terrain.grad_at(x, z) > nav_g(ctx) || nav_groove(world, x, z)
}

///|
/// navGrid (ai.js:105-119): 64×64 可行格网; T._navG 懒缓存 ↔ ctx 缓存(terrain_uid 换图重建)
pub fn nav_grid_of(ctx : Ctx, world : World) -> NavGrid {
  match ctx.nav_grid {
    Some(g) if ctx.nav_uid == world.terrain_uid => g
    _ => {
      let n = 64
      let lo = -(world.terrain.half - 20.0)
      let st = (world.terrain.half * 2.0 - 40.0) / (n - 1).to_double()
      let pass : FixedArray[Int] = FixedArray::make(n * n, 0)
      for j in 0..<n {
        for i in 0..<n {
          let x = lo + i.to_double() * st
          let z = lo + j.to_double() * st
          let mut ok = 1
          for sub in nav_sub {
            if nav_blocked_pt(ctx, world, x + sub.0, z + sub.1) {
              ok = 0
              break
            }
          }
          pass[j * n + i] = ok
        }
      }
      let g : NavGrid = { n, lo, st, pass, }
      ctx.nav_grid = Some(g)
      ctx.nav_uid = world.terrain_uid
      g
    }
  }
}

///|
/// navLineClear (ai.js:121-127): 每 8m 采样过同一套判定
pub fn nav_line_clear(
  ctx : Ctx,
  world : World,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> Bool {
  let dx = bx - ax
  let dz = bz - az
  let d = @math.hypot(dx, dz)
  let n = (d / 8.0).ceil().to_int().max(2)
  for s in 1..<n {
    if nav_blocked_pt(
        ctx,
        world,
        ax + dx * s.to_double() / n.to_double(),
        az + dz * s.to_double() / n.to_double(),
      ) {
      return false
    }
  }
  true
}

///|
/// navFindPath (ai.js:129-160): 4 邻域 BFS + 贪心拉直(前瞻≤8格); 末点=真实目标。
/// 返回 None(无解/起终点不可用)或路径点数组(Array[(x,z)])。
pub fn nav_find_path(
  ctx : Ctx,
  world : World,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> Array[(Double, Double)]? {
  let g = nav_grid_of(ctx, world)
  let n = g.n
  let ci = fn(v : Double) {
    js_round((v - g.lo) / g.st).to_int().max(0).min(n - 1)
  }
  let si = ci(ax)
  let sj = ci(az)
  let gi = ci(bx)
  let gj = ci(bz)
  if g.pass[sj * n + si] == 0 || g.pass[gj * n + gi] == 0 {
    return None
  }
  let prev : FixedArray[Int] = FixedArray::make(n * n, -1)
  let q : Array[Int] = [sj * n + si]
  prev[sj * n + si] = sj * n + si
  let mut h = 0
  while h < q.length() && prev[gj * n + gi] == -1 {
    let c = q[h]
    let cx = c % n
    // JS: for (const d of [1, -1, N, -N])
    let neighbors = [1, -1, n, -n]
    for d in neighbors {
      if (d == 1 && cx == n - 1) || (d == -1 && cx == 0) {
        continue
      }
      let n2 = c + d
      if n2 < 0 || n2 >= n * n || g.pass[n2] == 0 || prev[n2] != -1 {
        continue
      }
      prev[n2] = c
      q.push(n2)
    }
    h += 1
  }
  if prev[gj * n + gi] == -1 {
    return None
  }
  let cells : Array[Int] = []
  let mut c = gj * n + gi
  while true {
    cells.push(c)
    if c == prev[c] {
      break
    }
    c = prev[c]
  }
  let pts : Array[(Double, Double)] = []
  let mut ri = cells.length() - 1
  while ri >= 0 {
    let cc = cells[ri]
    pts.push(
      (g.lo + (cc % n).to_double() * g.st, g.lo + (cc / n).to_double() * g.st),
    )
    ri -= 1
  }
  let last = pts.length() - 1
  pts[last] = (bx, bz)
  let out : Array[(Double, Double)] = []
  let mut i0 = 0
  while i0 < pts.length() - 1 {
    let mut j2 = (pts.length() - 1).min(i0 + 8)
    while j2 > i0 + 1 &&
          !nav_line_clear(
            ctx,
            world,
            pts[i0].0,
            pts[i0].1,
            pts[j2].0,
            pts[j2].1,
          ) {
      j2 -= 1
    }
    out.push(pts[j2])
    i0 = j2
  }
  Some(out)
}

///|
/// Math.round(半数向上; MoonBit .round 负半数行为不同)

///|

///|
/// 导航参考目标(update 的 ref; JS 是 tank 对象或 lastSeen 点的多态 —— Seen 无 alive/yaw 字段)
pub enum RefT {
  RT(Tank)
  RS(Seen)
}

///|
pub fn RefT::x(self : RefT) -> Double {
  match self {
    RT(t) => t.x
    RS(s) => s.x
  }
}

///|
pub fn RefT::z(self : RefT) -> Double {
  match self {
    RT(t) => t.z
    RS(s) => s.z
  }
}

///|
/// ref.alive(Tank 有; Seen 无此字段 = undefined 假值)
pub fn RefT::alive(self : RefT) -> Bool {
  match self {
    RT(t) => t.alive
    RS(_) => false
  }
}

///|
/// ref.yaw(Seen 无 ↔ None)
pub fn RefT::yaw(self : RefT) -> Double? {
  match self {
    RT(t) => Some(t.yaw)
    RS(_) => None
  }
}

///|
/// nearestPlain (ai.js:164-172): 纯最近兜底(驾驶参考用; mpTargets 优先, 退回 world.player)
pub fn nearest_plain(world : World, from : Tank) -> Tank? {
  if world.mp_targets.length() > 0 {
    let mut best : Tank? = None
    let mut bd = 1.0e9
    for t in world.mp_targets {
      if t.alive {
        let d = dist2d(from.x, from.z, t.x, t.z)
        if d < bd {
          bd = d
          best = Some(t)
        }
      }
    }
    if best is Some(_) {
      return best
    }
  }
  world.player
}

///|
/// keyOf (ai.js:227-234): 复制品唯一 id 优先; 缺 id 时 JS 用 world._teamIds 对象注册表
/// (引用→递增号, 懒建)。MoonBit 无对象身份比较, 以创建序 uid 承载该兜底路径(分配次序与
/// 注册表的首触序可能不同; 本夹具双车恒带 id=11/12, 兜底分支不触 —— 差异见交付 notes)。
pub fn key_of(t : Tank, _world : World) -> Int {
  match t.id {
    Some(id) => id
    None => t.uid
  }
}

///|
/// nearestTarget (ai.js:178-218): AI 目标选择(炮口) —— 集火槽/分流/最近兜底
pub fn nearest_target(world : World, ctx : Ctx, from : Tank) -> Tank? {
  let cfg = ctx.cfg
  let f = world.focus
  // hot: 焦点新鲜 && mpTargets 中有存活焦点目标
  let mut hot = cfg.ai.focus_on != 0
  match f {
    Some(fv) =>
      if world.time - fv.t > cfg.ai.focus_memory_s {
        hot = false
      } else {
        let mut found = false
        for e in world.mp_targets {
          if e.alive && e.net_id == fv.net_id {
            found = true
            break
          }
        }
        if !found {
          hot = false
        }
      }
    None => hot = false
  }
  // sl = hot && from.ai && from.ai._memo ? focusSlots : null
  let mut sl : Map[Int, Double]? = None
  if hot {
    match from.ai {
      Some(a) =>
        match a.memo {
          Some(m) => sl = Some(m.focus_slots)
          None => ()
        }
      None => ()
    }
  }
  let team_called = match sl {
    Some(m) => m.length() > 0
    None => false
  }
  let in_slot = match sl {
    Some(m) => m.get(key_of(from, world)) is Some(_)
    None => false
  }
  if hot && in_slot {
    // 槽内: 锁焦点(带超程门 dF<vr 与 dF<=dN*1.15)
    let mut ft : Tank? = None
    for e in world.mp_targets {
      if e.alive && e.net_id == f.unwrap().net_id {
        ft = Some(e)
        break
      }
    }
    if ft is Some(ftk) {
      let d_f = dist2d(from.x, from.z, ftk.x, ftk.z)
      let vr = js_or(from.spec.view, cfg.ai.view_range) * 1.3
      let np = nearest_plain(world, from)
      let d_n = match np {
        Some(n) =>
          if n.alive {
            dist2d(from.x, from.z, n.x, n.z)
          } else {
            1.0e9
          }
        None => 1.0e9
      }
      if d_f < vr && d_f <= d_n * 1.15 {
        return Some(ftk)
      }
    }
  }
  // 槽外分流: 焦点热 && 存活敌≥2 && 自车 2s 内见过目标
  if team_called && !in_slot {
    let mut alive_n = 0
    for e in world.mp_targets {
      if e.alive {
        alive_n += 1
      }
    }
    let seen_recent = match from.ai {
      Some(a) => world.time - a.seen_any_t < 2.0
      None => false
    }
    if alive_n >= 2 && seen_recent {
      let mut best : Tank? = None
      let mut bd = 1.0e9
      for e in world.mp_targets {
        if !e.alive || e.net_id == f.unwrap().net_id {
          continue
        }
        let d = dist2d(from.x, from.z, e.x, e.z)
        if d < bd {
          bd = d
          best = Some(e)
        }
      }
      // 分流的带合身门: [lo*0.75, hi*1.15]
      let band = match from.ai {
        Some(a) => Some(a.band_for())
        None => None
      }
      if best is Some(b) &&
        band is Some((blo, bhi)) &&
        bd >= blo * 0.75 &&
        bd <= bhi * 1.15 {
        return Some(b)
      }
    }
  }
  nearest_plain(world, from)
}

///|
/// teamMemo (ai.js:242-484): 全队协同备忘(挂 world._teamMemo, 节流重算)
pub fn team_memo(world : World, ctx : Ctx) -> Memo {
  let cfg = ctx.cfg
  let now = world.time
  let list : Array[Tank] = []
  for e in world.enemies {
    if e.alive && e.ai is Some(_) {
      list.push(e)
    }
  }
  // sig = 存活 keyOf 升序列 join(',')
  let key_list : Array[Int] = []
  for e in list {
    key_list.push(key_of(e, world))
  }
  key_list.sort()
  let mut sig = ""
  for i, k in key_list {
    if i > 0 {
      sig = sig + ","
    }
    sig = sig + k.to_string()
  }
  match world.team_memo {
    Some(m) =>
      if m.sig == sig && now - m.t < cfg.ai.role_recompute_s {
        return m
      }
    None => ()
  }
  // 威胁参考点: 最新情报(全队 intel / 各车 lastSeen)
  let mut tx : Double? = if world.intel.level > 0 {
    Some(world.intel.x)
  } else {
    None
  }
  let mut tz = 0.0
  let mut tt = -99.0
  if tx is Some(_) {
    tz = world.intel.z
    tt = world.intel.t
  }
  for e in list {
    match e.ai {
      Some(a) =>
        match a.last_seen {
          Some(ls) =>
            if ls.t > tt {
              tt = ls.t
              tx = Some(ls.x)
              tz = ls.z
            }
          None => ()
        }
      None => ()
    }
  }
  // 威胁参考闩锁: 上一任威胁 60m 内且有更新情报时沿用旧向
  match world.team_memo {
    Some(m) =>
      match m.threat {
        Some(th) =>
          if tx is Some(txv) {
            if dist2d(txv, tz, th.x, th.z) < 60.0 && tt > th.t {
              let ang0 = @math.atan2(txv - th.x, tz - th.z)
              let ang1 = @math.atan2(th.x - txv, th.z - tz)
              if ang_diff(ang0, ang1).abs() < 0.7 {
                tx = Some(th.x)
                tz = th.z
              }
            }
          }
        None => ()
      }
    None => ()
  }
  let n = list.length()
  let roles : Map[Int, String] = Map([])
  let by_k : Map[Int, Tank] = Map([])
  for e in list {
    by_k[key_of(e, world)] = e
  }
  let keys = sorted_keys(by_k)
  // slotMemo 跨重算持久(按引用携带)
  let slot_memo : Map[Int, Double] = match world.team_memo {
    Some(m) => m.slot_memo
    None => Map([])
  }
  let line_keys : Array[Int] = []
  let flank_keys : Array[Int] = []
  let second_keys : Array[Int] = []
  let mut n_td = 0
  for e in list {
    if e.spec.cls == "TD" {
      n_td += 1
    }
  }
  for e in list {
    let k = key_of(e, world)
    let cls = e.spec.cls
    if cls == "TD" && n > 1 && n_td > 0 {
      roles[k] = "second"
      second_keys.push(k)
    } else if cls == "TD" {
      roles[k] = "line"
      line_keys.push(k)
    } else if cls == "HT" {
      roles[k] = "line"
      line_keys.push(k)
    } else if cls == "SPG" {
      roles[k] = "second"
      second_keys.push(k)
    } else {
      roles[k] = "flank"
      flank_keys.push(k)
    }
  }
  // 小队全顶线(role.squadLineN)
  let front_n = line_keys.length() + flank_keys.length()
  let line_want = if front_n > 0 && front_n <= cfg.ai.role_squad_line_n {
    front_n
  } else {
    js_round(n.to_double() * cfg.ai.role_line_min_frac).to_int().max(1)
  }
  // 顶线不足 → 从 flank 按 hp% 提拔(排序键稳定)
  if line_keys.length() < line_want && flank_keys.length() > 0 {
    stable_sort_by(flank_keys, fn(a, b) {
      let ta = by_k[a]
      let tb = by_k[b]
      tb.hp / tb.spec.hp - ta.hp / ta.spec.hp
    })
    while line_keys.length() < line_want && flank_keys.length() > 0 {
      let k = flank_keys[0]
      let _ = flank_keys.remove(0)
      roles[k] = "line"
      line_keys.push(k)
    }
  }
  // 顶线残血让位 → 最近 flank 补位
  let plug_for : Map[Int, Int] = Map([])
  let line_snapshot = line_keys.copy()
  for k in line_snapshot {
    let e = by_k[k]
    if roles[k] == "line" && e.hp / e.spec.hp < cfg.ai.role_yield_hp_pct {
      roles[k] = "fallback"
      let mut best_f : Int? = None
      let mut bd = 1.0e9
      for fk in flank_keys {
        if roles[fk] != "flank" {
          continue
        }
        let d = dist2d(e.x, e.z, by_k[fk].x, by_k[fk].z)
        if d < bd {
          bd = d
          best_f = Some(fk)
        }
      }
      if best_f is Some(bf) {
        roles[bf] = "line"
        plug_for[bf] = k
      }
    }
  }
  // 站位(威胁参考缺失时全空)
  let team_cx : Double = {
    let mut s = 0.0
    for e in list {
      s += e.x
    }
    s / (1).max(n).to_double()
  }

  let team_cz : Double = {
    let mut s = 0.0
    for e in list {
      s += e.z
    }
    s / (1).max(n).to_double()
  }
  let mut lead_e : Tank? = None
  let mut ld = 1.0e9
  if tx is Some(txv) {
    for e in list {
      let k0 = key_of(e, world)
      if roles[k0] != "line" {
        continue
      }
      let d = dist2d(e.x, e.z, txv, tz)
      if d < ld {
        ld = d
        lead_e = Some(e)
      }
    }
  }
  if tx is Some(txv) && lead_e is None {
    for e in list {
      let d = dist2d(e.x, e.z, txv, tz)
      if d < ld {
        ld = d
        lead_e = Some(e)
      }
    }
  }
  let stations : Map[Int, St?] = Map([])
  // hash (ai.js:328): keyOf→[0,1) 稳定哈希
  fn hash(k : Int) -> Double {
    let s = @math.sin(k.to_double() * 12.9898) * 43758.5453
    s - s.floor()
  }

  // covNear (ai.js:333-337)
  fn cov_near(x : Double, z : Double) -> Bool {
    for c in world.covers.items {
      if c.blocks_shells && dist2d(x, z, c.x, c.z) < c.r + 12.0 {
        return true
      }
    }
    false
  }

  // losFix (ai.js:340-345)
  fn los_fix(ptx : Double, ptz : Double, txv : Double, tzv : Double) -> St? {
    if los_clear(world, ptx, ptz, txv, tzv) {
      return Some({ x: ptx, z: ptz, side: None, d: None, deg: None, sc: None, })
    }
    let a = @math.atan2(txv - ptx, tzv - ptz)
    let p2x = ptx + @math.sin(a) * 15.0
    let p2z = ptz + @math.cos(a) * 15.0
    if los_clear(world, p2x, p2z, txv, tzv) {
      Some({ x: p2x, z: p2z, side: None, d: None, deg: None, sc: None, })
    } else {
      None
    }
  }

  let cf_on = cfg.ai.cf_on
  // sideUse (ai.js:347): 本拍同舷已占方位角
  let side_use : Map[Int, Array[Double]] = Map([])
  if cf_on != 0 {
    side_use[1] = []
    side_use[-1] = []
  }
  for k in keys {
    let e = by_k[k]
    let r = roles[k]
    if tx is None || lead_e is None || n < 2 {
      stations[k] = None
      continue
    }
    let txv = tx.unwrap()
    let tzv = tz
    let lead = lead_e.unwrap()
    let cb = class_band_of(ctx, e.spec.cls)
    let mid = (cb.0 + cb.1) * 0.5
    if r == "flank" {
      let side : Int = if k % 2 == 0 { 1 } else { -1 }
      let base = @math.atan2(team_cx - txv, team_cz - tz)
      let deg0 = 55.0 + 20.0 * hash(k) + (hash(k * 7 + 1) - 0.5) * 30.0
      let rad = clamp(dist2d(e.x, e.z, txv, tz), cb.0, (cb.0 + cb.1) * 0.5)
      // mk(sd, deg) (ai.js:362-366)
      fn mk(sd : Int, deg : Double) -> St? {
        let ang = base + sd.to_double() * deg * @math.PI / 180.0
        let px = txv + @math.sin(ang) * rad
        let pz = tzv + @math.cos(ang) * rad
        if los_clear(world, px, pz, txv, tzv) {
          Some({
            x: px,
            z: pz,
            side: Some(sd),
            d: Some(dist2d(px, pz, e.x, e.z)),
            deg: None,
            sc: None,
          })
        } else {
          None
        }
      }

      let mut st : St? = None
      let mut d = -30.0
      while d <= 60.0 {
        let deg = clamp(deg0 + d, 40.0, 130.0)
        // for (const c0 of [mk(side, deg), mk(-side, deg)])
        let cands = [mk(side, deg), mk(-side, deg)]
        for c0 in cands {
          if c0 is None {
            continue
          }
          let mut c = c0.unwrap()
          if c0.unwrap().side.unwrap() == side {
            // 只对本舷候选查同舷间隔
            let mut deg2 = deg
            match side_use.get(side) {
              Some(used_list) =>
                for used in used_list {
                  if (used - deg).abs() < cfg.ai.cf_min_angle_sep {
                    deg2 = deg + cfg.ai.cf_push_out_deg
                    break
                  }
                }
              None => ()
            }
            if deg2.abs() > 130.0 {
              continue
            }
            if deg2 != deg {
              match mk(side, deg2) {
                Some(c2) => {
                  c = c2
                  c.deg = Some(deg2)
                }
                None => continue
              }
            } else {
              c.deg = Some(deg)
            }
          } else {
            c.deg = Some(deg)
          }
          // 掩体旁站点优先(折算 35m 路程)
          c.sc = Some(
            c.d.unwrap() - (if cov_near(c.x, c.z) { 35.0 } else { 0.0 }),
          )
          if st is None || c.sc.unwrap() < st.unwrap().sc.unwrap() {
            st = Some(c)
          }
        }
        d += 10.0
      }
      // 弧上还到不了=弃站
      if st is Some(s) && s.d.unwrap() > 90.0 {
        st = None
      }
      if st is Some(s) {
        if s.deg is Some(dg) {
          // JS: sideUse[st.side].push(st.deg)(CF.on=0 时 sideUse 为 null 会 TypeError; 夹具恒 on)
          match side_use.get(s.side.unwrap()) {
            Some(arr) => arr.push(dg)
            None => ()
          }
        }
      }
      stations[k] = st
    } else if r == "second" || r == "fallback" {
      let spg_mul = if e.spec.cls == "SPG" { 1.3 } else { 1.0 }
      let depth = clamp(
          mid * 0.9,
          cfg.ai.role_td_depth_lo,
          cfg.ai.role_td_depth_hi,
        ) *
        spg_mul
      let back = @math.atan2(team_cx - txv, team_cz - tz)
      let mut dd = depth
      let mut ptx = lead.x + @math.sin(back) * dd
      let mut ptz = lead.z + @math.cos(back) * dd
      if !los_clear(world, ptx, ptz, txv, tzv) {
        dd = (cfg.ai.role_td_depth_lo * 0.6).max(dd - 20.0)
        ptx = lead.x + @math.sin(back) * dd
        ptz = lead.z + @math.cos(back) * dd
      }
      if !cov_near(ptx, ptz) {
        // 侧偏 ±14°(0.25rad) 再各试一个
        for da in [0.25, -0.25] {
          let p2x = lead.x + @math.sin(back + da) * dd
          let p2z = lead.z + @math.cos(back + da) * dd
          if los_clear(world, p2x, p2z, txv, tzv) && cov_near(p2x, p2z) {
            ptx = p2x
            ptz = p2z
            break
          }
        }
      }
      stations[k] = Some({
        x: ptx,
        z: ptz,
        side: None,
        d: None,
        deg: None,
        sc: None,
      })
    } else {
      let a0 = @math.atan2(e.x - txv, e.z - tzv) + (hash(k) - 0.5) * 0.4
      let rr = (cb.0 + mid) * 0.5
      let mut st = los_fix(
        txv + @math.sin(a0) * rr,
        tzv + @math.cos(a0) * rr,
        txv,
        tzv,
      )
      let mut dd = 10.0
      while dd <= 30.0 && st is None {
        if los_fix(
            txv + @math.sin(a0 + dd) * rr,
            tzv + @math.cos(a0 + dd) * rr,
            txv,
            tzv,
          )
          is Some(s) {
          st = Some(s)
        } else if los_fix(
            txv + @math.sin(a0 - dd) * rr,
            tzv + @math.cos(a0 - dd) * rr,
            txv,
            tzv,
          )
          is Some(s2) {
          st = Some(s2)
        }
        dd += 10.0
      }
      stations[k] = st
    }
  }
  // 集火槽(G4, ai.js:427-449)
  let f_slots : Map[Int, Double] = match world.team_memo {
    Some(m) => m.focus_slots
    None => Map([])
  }
  let f_obj = world.focus
  let mut f_tgt : Tank? = None
  match f_obj {
    Some(fo) =>
      for e in world.mp_targets {
        if e.alive && e.net_id == fo.net_id {
          f_tgt = Some(e)
          break
        }
      }
    None => ()
  }
  if cfg.ai.focus_on != 0 &&
    f_obj is Some(fo) &&
    f_tgt is Some(_) &&
    now - fo.t <= cfg.ai.focus_memory_s &&
    list.length() >= 4 {
    let ft = f_tgt.unwrap()
    let cap = (list.length().to_double() * 0.6)
      .ceil()
      .to_int()
      .min(cfg.ai.focus_max_per_target)
      .max(2)
    let ranked = list.copy()
    stable_sort_by(ranked, fn(a, b) {
      dist2d(a.x, a.z, ft.x, ft.z) - dist2d(b.x, b.z, ft.x, ft.z)
    })
    // desired Set
    let desired : Map[Int, Bool] = Map([])
    for i in 0..<cap {
      if i < ranked.length() {
        desired[key_of(ranked[i], world)] = true
      }
    }
    // 淘汰: 死车/掉出且滞回期满
    for k in sorted_keys(f_slots) {
      let keep = match by_k.get(k) {
        Some(tk) => {
          let drop = desired.get(k) is None &&
            now - f_slots.get(k).unwrap_or(0.0) > cfg.ai.focus_slot_hyst_s
          tk.alive && !drop
        }
        None => false
      }
      if !keep {
        f_slots.remove(k)
      }
    }
    // 递补: 空位按距焦点近者
    for e in ranked {
      if f_slots.length() >= cap {
        break
      }
      let k = key_of(e, world)
      if f_slots.get(k) is None {
        f_slots[k] = now
      }
    }
    // 在位者心跳
    for k in sorted_keys(f_slots) {
      if desired.get(k) is Some(_) {
        f_slots[k] = now
      }
    }
  } else {
    // 无有效焦点: 清槽
    for k in sorted_keys(f_slots) {
      f_slots.remove(k)
    }
  }
  // 顶位补防(G6②, ai.js:455-479)
  let plug_pinned : Map[Int, Plug] = match world.team_memo {
    Some(m) => m.plug_pinned
    None => Map([])
  }
  if cf_on != 0 {
    // 清理: 被钉的 line 车阵亡/补位车阵亡/超窗
    for k in sorted_keys(plug_pinned) {
      let p = plug_pinned[k]
      let dead = match by_k.get(k) {
        Some(tk) =>
          !tk.alive ||
          (match by_k.get(p.by) {
            Some(tby) => !tby.alive
            None => true
          }) ||
          now > p.until
        None => true
      }
      if dead {
        plug_pinned.remove(k)
      }
    }
    for k in sorted_keys(roles) {
      if roles[k] != "line" {
        continue
      }
      let e = by_k[k]
      if !e.alive {
        continue
      }
      let retreat = match e.ai {
        Some(a) => a.state == "retreat"
        None => false
      }
      let low = e.hp / e.spec.hp < cfg.ai.role_yield_hp_pct
      if !retreat && !low {
        continue
      }
      match plug_pinned.get(k) {
        Some(p) => if now < p.until { continue }
        None => ()
      }
      let mut best : Int? = None
      let mut bh = -1.0
      for fk in sorted_keys(roles) {
        if roles[fk] != "flank" {
          continue
        }
        match by_k.get(fk) {
          Some(tfk) => if !tfk.alive { continue }
          None => continue
        }
        if stations.get(fk) is None {
          continue
        }
        let tfk = by_k[fk]
        let h = tfk.hp / tfk.spec.hp
        if h > bh {
          bh = h
          best = Some(fk)
        }
      }
      if best is Some(b) {
        let sx = match stations.get(k) {
          Some(Some(stn)) => stn.x
          _ => e.x
        }
        let sz = match stations.get(k) {
          Some(Some(stn)) => stn.z
          _ => e.z
        }
        plug_pinned[k] = {
          by: b,
          x: sx,
          z: sz,
          until: now + cfg.ai.cf_plug_window_s,
        }
      }
    }
    for k in sorted_keys(plug_pinned) {
      let p = plug_pinned[k]
      if roles.get(p.by) is Some(v) && v == "flank" {
        stations[p.by] = Some({
          x: p.x,
          z: p.z,
          side: None,
          d: None,
          deg: None,
          sc: None,
        })
      }
    }
  }
  let threat : Seen? = match tx {
    Some(txv) => Some({ x: txv, z: tz, vx: 0.0, vz: 0.0, t: tt, })
    None => None
  }
  let memo : Memo = {
    sig,
    t: now,
    list,
    by_k,
    roles,
    stations,
    plug_for,
    focus_slots: f_slots,
    slot_memo,
    plug_pinned,
    threat,
    lead: lead_e,
  }
  world.team_memo = Some(memo)
  memo
}

///|
/// classBand[cls] 查表(ai.js:351 `SF.CFG.ai.classBand[e.spec.cls || 'MT'] || [70, 190]`)
pub fn class_band_of(ctx : Ctx, cls : String) -> (Double, Double) {
  let a = ctx.cfg.ai
  match cls {
    "LT" => a.band_lt
    "MT" => a.band_mt
    "HT" => a.band_ht
    "TD" => a.band_td
    "SPG" => a.band_spg
    _ => (70.0, 190.0)
  }
}

///|
/// hideFracCls[cls] || 0.6(ai.js:1192)
pub fn hide_frac_cls(ctx : Ctx, cls : String) -> Double {
  match cls {
    "HT" => ctx.cfg.ai.cover_hide_frac_ht
    "MT" => ctx.cfg.ai.cover_hide_frac_mt
    "TD" => ctx.cfg.ai.cover_hide_frac_td
    _ => 0.6
  }
}
