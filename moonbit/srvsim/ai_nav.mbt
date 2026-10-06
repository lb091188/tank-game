// ai.js 直译 · 感知几何与协同层: SF.losClear/losGrid/losClearAny/bushState/camoOf、
// 地形导航(navGrid/navLineClear/navFindPath)、目标选择(nearestPlain/nearestTarget/keyOf)、
// 全队协同备忘(teamMemo)。注释标原函数名。

///|
/// Tank → simcore CamoTarget(SF.bushState/SF.camoOf 委托 simcore 的参数适配;
/// simcore.js 侧读 t.x/t.z/t.speed/t.lastYawRate||0/t.lastFireT||-99/t.spec.camo)
fn tank_camo_target(t : Tank) -> @simcore.CamoTarget {
  {
    x: t.x,
    z: t.z,
    speed: t.speed,
    last_yaw_rate: t.last_yaw_rate,
    last_fire_t: t.last_fire_t,
    camo: Some(t.spec.camo),
  }
}

///|
/// SF.bushState (ai.js:74-76): 委托 simcore bushState
pub fn bush_state(t : Tank, world : World) -> @simcore.BushState {
  let cl : @simcore.CoverList = { items: world.covers_list, bushes: None, }
  cl.bush_state(tank_camo_target(t), world.time_ref.val)
}

///|
/// SF.camoOf (ai.js:84-86)
pub fn camo_of(t : Tank, world : World) -> Double {
  let cl : @simcore.CoverList = { items: world.covers_list, bushes: None, }
  cl.camo_of(tank_camo_target(t), world.time_ref.val)
}

///|
/// SF.losClear (ai.js:8-15): 眼高 2m 通视(地形 1.6 余量 + 掩体)
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
  world.covers_blocked(
    ax,
    az,
    ay,
    dx / len,
    dz / len,
    len,
    (by - ay) / len,
    None,
  ) <
  0.0
}

///|
/// 点阵表(ai.js:28-31)
let grid_lat : Array[Double] = [0.0, -0.95, 0.95, -0.5, 0.5]

///|
let grid_lon : Array[Double] = [0.0, -0.85, 0.85, -0.45, 0.45]

///|
let grid_obs : Array[Double] = [0.0, -0.55, 0.55]

///|
/// SF.losGrid (ai.js:36-60): 点阵通视(点亮), 25 柱 × 3 观察点; tst = 草丛上下文。
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
  let pz_ = (bx - ax) / len0 // 视线垂直方向 = 观察者横向轴
  let fx = v8_sin(byaw)
  let fz = v8_cos(byaw) // 目标纵轴(车头)
  let rx = v8_cos(byaw)
  let rz = -v8_sin(byaw) // 目标横轴(右)
  for o_off in grid_obs {
    let ox = ax + px_ * (o_off * aw)
    let oz = az + pz_ * (o_off * aw)
    let oy = t.height_at(ox, oz) + 3.0 // GRID_OBS_H
    for lon in grid_lon {
      let fx2 = bx + fx * (lon * bl)
      let fz2 = bz + fz * (lon * bl)
      for lat in grid_lat {
        let px2 = fx2 + rx * (lat * bw)
        let pz2 = fz2 + rz * (lat * bw)
        let py = t.height_at(px2, pz2) + 3.3 // GRID_TGT_H
        let blocked = match margin {
          Some(m) => t.los_blocked(ox, oz, oy, px2, pz2, py, margin=m)
          None => t.los_blocked(ox, oz, oy, px2, pz2, py)
        }
        if blocked {
          continue
        }
        let dx = px2 - ox
        let dz = pz2 - oz
        let len = @math.hypot(dx, dz)
        if len < 1.0 {
          return true
        }
        if world.covers_blocked(
            ox,
            oz,
            oy,
            dx / len,
            dz / len,
            len,
            (py - oy) / len,
            tst,
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
/// SF.losClearAny (ai.js:65-71): 点亮策略壳(tst 显式 None = 纯几何)。
/// tst : None=JS undefined(取 bushState), 传"空"语义由调用方以 has_tst=false 表示。
pub fn los_clear_any(
  world : World,
  src : Tank,
  tgt : Tank,
  has_tst : Bool,
  tst : @simcore.Spot?,
  margin? : Double,
) -> Bool {
  let st : @simcore.Spot? = if has_tst {
    tst
  } else {
    let bs = bush_state(tgt, world)
    Some({ tx: tgt.x, tz: tgt.z, fired: bs.fired, concealed: bs.concealed, })
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
    st,
    margin?,
  )
}

///|
/// ai.js:92-95 常量(模块加载期求值; NAV_G = tan(maxSlope)×0.96)
fn nav_g() -> Double {
  v8_tan_max_slope * 0.96
}

///|
let nav_sub : Array[(Double, Double)] = [
  (0.0, 0.0),
  (5.0, 5.0),
  (5.0, -5.0),
  (-5.0, 5.0),
  (-5.0, -5.0),
]

///|
/// SIDE_ARC (ai.js:95): 侧向射界夹角
fn side_arc() -> Double {
  60.0 * @math.PI / 180.0
}

///|
/// navGroove (ai.js:96-103): 反壕沟四向高差夹谷
fn nav_groove(t : @simcore.Terrain, x : Double, z : Double) -> Bool {
  let h_c = t.height_at(x, z)
  for k in 0..<4 {
    let a = k.to_double() * @math.PI / 4.0
    let dx = v8_sin(a) * 14.0
    let dz = v8_cos(a) * 14.0
    if t.height_at(x + dx, z + dz) > h_c + 3.0 &&
      t.height_at(x - dx, z - dz) > h_c + 3.0 {
      return true
    }
  }
  false
}

///|
/// navBlockedPt (ai.js:104)
fn nav_blocked_pt(t : @simcore.Terrain, x : Double, z : Double) -> Bool {
  t.grad_at(x, z) > nav_g() || nav_groove(t, x, z)
}

///|
/// navGrid (ai.js:105-119): 懒构建 64×64 网格(JS 挂 T._navG, 本链缓存挂 world)
fn nav_grid(world : World) -> NavGrid {
  match world.nav_cache {
    Some(g) => g
    None => {
      let t = world.terrain
      let n = 64
      let lo = -(t.half - 20.0)
      let st = (t.half * 2.0 - 40.0) / (n - 1).to_double()
      let pass : FixedArray[Bool] = FixedArray::make(n * n, false)
      for j in 0..<n {
        for i in 0..<n {
          let x = lo + i.to_double() * st
          let z = lo + j.to_double() * st
          let mut ok = true
          for sub in nav_sub {
            if nav_blocked_pt(t, x + sub.0, z + sub.1) {
              ok = false
              break
            }
          }
          pass[j * n + i] = ok
        }
      }
      let g : NavGrid = { n, lo, st, pass, }
      world.nav_cache = Some(g)
      g
    }
  }
}

///|
/// navLineClear (ai.js:121-127): 直线可达(每 8m 采样)
fn nav_line_clear(
  t : @simcore.Terrain,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> Bool {
  let dx = bx - ax
  let dz = bz - az
  let d = @math.hypot(dx, dz)
  let n = 2.0.max((d / 8.0).ceil()).to_int()
  for s in 1..<n {
    if nav_blocked_pt(
        t,
        ax + dx * s.to_double() / n.to_double(),
        az + dz * s.to_double() / n.to_double(),
      ) {
      return false
    }
  }
  true
}

///|
/// navFindPath (ai.js:129-160): 4 邻域 BFS + 贪心拉直(前瞻≤8格); 无解返回 None
fn nav_find_path(
  t : @simcore.Terrain,
  world : World,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> Array[(Double, Double)]? {
  let g = nav_grid(world)
  let n = g.n
  fn ci(v : Double) -> Int {
    let c = (n - 1).min(round_ge0((v - g.lo) / g.st).to_int())
    if c < 0 {
      0
    } else {
      c
    }
  }
  let si = ci(ax)
  let sj = ci(az)
  let gi = ci(bx)
  let gj = ci(bz)
  if not(g.pass[sj * n + si]) || not(g.pass[gj * n + gi]) {
    return None
  }
  let prev : FixedArray[Int] = FixedArray::make(n * n, -1)
  let q : Array[Int] = [sj * n + si]
  prev[sj * n + si] = sj * n + si
  let mut h = 0
  while h < q.length() && prev[gj * n + gi] == -1 {
    let c = q[h]
    let cx = c % n
    h += 1
    for d in [1, -1, n, -n] {
      if (d == 1 && cx == n - 1) || (d == -1 && cx == 0) {
        continue // 不跨行环绕
      }
      let n2 = c + d
      if n2 < 0 || n2 >= n * n || not(g.pass[n2]) || prev[n2] != -1 {
        continue
      }
      prev[n2] = c
      q.push(n2)
    }
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
  // (Array 无 reverse 方法, 手动倒序)
  let cells_rev : Array[Int] = []
  let mut ri = cells.length() - 1
  while ri >= 0 {
    cells_rev.push(cells[ri])
    ri -= 1
  }
  let cells = cells_rev
  let pts : Array[(Double, Double)] = []
  for c in cells {
    pts.push(
      (g.lo + (c % n).to_double() * g.st, g.lo + (c / n).to_double() * g.st),
    )
  }
  pts[pts.length() - 1] = (bx, bz)
  let out : Array[(Double, Double)] = []
  let mut i0 = 0
  while i0 < pts.length() - 1 {
    let mut j2 = (pts.length() - 1).min(i0 + 8)
    while j2 > i0 + 1 &&
          not(nav_line_clear(t, pts[i0].0, pts[i0].1, pts[j2].0, pts[j2].1)) {
      j2 -= 1
    }
    out.push(pts[j2])
    i0 = j2
  }
  Some(out)
}

///|
/// JS Math.round 的非负域形式(ci 用; 值域恒 ≥0)
fn round_ge0(x : Double) -> Double {
  (x + 0.5).floor()
}

///|
/// nearestPlain (ai.js:164-172): 纯最近兜底(驾驶参考用)
fn nearest_plain(world : World, from : Tank) -> NavRef? {
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
    match best {
      Some(b) =>
        return Some({
          x: b.x,
          z: b.z,
          vx: b.vel_x,
          vz: b.vel_z,
          t: world.time_ref.val,
          yaw: b.yaw,
          tk: Some(b),
        })
      None => ()
    }
  }
  match world.player {
    Some(p) =>
      Some({
        x: p.x,
        z: p.z,
        vx: p.vel_x,
        vz: p.vel_z,
        t: world.time_ref.val,
        yaw: p.yaw,
        tk: Some(p),
      })
    None => None
  }
}

///|
/// keyOf (ai.js:227-234): 协同稳定键(id → _aiId → 注册表递增号; 注册表挂 world)
fn key_of(tank : Tank, world : World) -> Int {
  match tank.id {
    Some(id) => return id
    None => ()
  }
  match tank.ai_id {
    Some(id) => return id
    None => ()
  }
  match world.team_ids {
    None => {
      world.team_ids = Some(Map::new())
      world.team_ids_n = 0
    }
    Some(_) => ()
  }
  let m = world.team_ids.unwrap()
  match m.get(tank.uid) {
    Some(k) => k
    None => {
      world.team_ids_n += 1
      m[tank.uid] = world.team_ids_n
      world.team_ids_n
    }
  }
}

///|
/// Map[Int, _] 键升序数组(JS Object.keys 对整数键按数值升序; teamMemo 多处消费此序)
fn[V] sorted_keys(m : Map[Int, V]) -> Array[Int] {
  let ks : Array[Int] = []
  for k, _ in m {
    ks.push(k)
  }
  ks.sort()
  ks
}

///|
/// nearestTarget (ai.js:178-218): AI 目标选择(炮口) —— 集火槽锁定/槽外分流/最近兜底
fn nearest_target(world : World, from : Tank) -> Tank? {
  let fo = ai_cfg
  let f = world.focus
  let mut some_alive_match = false
  match f {
    Some(fv) => {
      let fresh = fo.focus_on != 0 &&
        world.time_ref.val - fv.t <= fo.focus_memory_s
      let mut any = false
      for e in world.mp_targets {
        if e.alive && e.net_id == fv.net_id {
          any = true
          break
        }
      }
      some_alive_match = fresh && any
    }
    None => ()
  }
  let hot = some_alive_match
  let sl : Map[Int, Double]? = match from.ai {
    Some(ai) =>
      if hot {
        match ai.memo {
          Some(m) => Some(m.focus_slots)
          None => None
        }
      } else {
        None
      }
    None => None
  }
  // teamCalled = sl && Object.keys(sl).length > 0
  let team_called = match sl {
    Some(m) => m.size() > 0
    None => false
  }
  let in_slot = if team_called {
    match sl {
      Some(m) => m.get(key_of(from, world)) is Some(_)
      None => false
    }
  } else {
    false
  }
  if hot && in_slot {
    match f {
      Some(fv) => {
        let mut ft : Tank? = None
        for e in world.mp_targets {
          if e.alive && e.net_id == fv.net_id {
            ft = Some(e)
            break
          }
        }
        match ft {
          Some(ftk) => {
            let d_f = dist2d(from.x, from.z, ftk.x, ftk.z)
            let vr = (if from.spec.view > 0.0 {
                from.spec.view
              } else {
                ai_cfg.view_range
              }) *
              1.3
            let np = nearest_plain(world, from)
            let d_n = match np {
              Some(npv) =>
                if npv.alive() {
                  dist2d(from.x, from.z, npv.x, npv.z)
                } else {
                  1.0e9
                }
              None => 1.0e9
            }
            if d_f < vr && d_f <= d_n * 1.15 {
              return Some(ftk) // 槽内: 锁焦点
            }
          }
          None => ()
        }
      }
      None => ()
    }
  }
  // 槽外分流: 焦点热 && 存活敌≥2 && 最近熄灯 <2s
  if team_called &&
    not(in_slot) &&
    world.mp_targets.filter(fn(e) { e.alive }).length() >= 2 &&
    from.ai is Some(_) &&
    world.time_ref.val - from.ai.unwrap().seen_any_t < 2.0 {
    let fv = f.unwrap()
    let mut best : Tank? = None
    let mut bd = 1.0e9
    for e in world.mp_targets {
      if not(e.alive) || e.net_id == fv.net_id {
        continue
      }
      let d = dist2d(from.x, from.z, e.x, e.z)
      if d < bd {
        bd = d
        best = Some(e)
      }
    }
    // 分流的带合身门: [lo×0.75, hi×1.15]
    match (best, from.ai) {
      (Some(b), Some(ai)) => {
        let b0 = ai.band_for()
        if bd >= b0.0 * 0.75 && bd <= b0.1 * 1.15 {
          return Some(b)
        }
      }
      _ => ()
    }
  }
  let np = nearest_plain(world, from)
  match np {
    Some(n) => n.tk
    None => None
  }
}

///|
/// keyOf → [0,1) 稳定哈希(ai.js:328)
fn key_hash(k : Int) -> Double {
  let s = v8_sin(k.to_double() * 12.9898) * 43758.5453
  s - s.floor()
}

///|
/// teamMemo (ai.js:242-484): 全队协同备忘(G3), 挂 world 共读, 节流重算
fn team_memo(world : World) -> Memo {
  let ro = ai_cfg
  let now = world.time_ref.val
  let list : Array[Tank] = []
  for e in world.enemies {
    if e.alive && e.ai is Some(_) {
      list.push(e)
    }
  }
  // sig = keyOf 升序列 join(',')
  let sigs : Array[Int] = []
  for e in list {
    sigs.push(key_of(e, world))
  }
  sigs.sort()
  let mut sig = ""
  for i, v in sigs {
    if i > 0 {
      sig = sig + ","
    }
    sig = sig + v.to_string()
  }
  let m0 = world.team_memo
  match m0 {
    Some(m) => if m.sig == sig && now - m.t < ro.role_recompute_s { return m }
    None => ()
  }
  // 威胁参考点: 最新情报(目视 lastSeen / 全队 intel)
  let mut tx : Double? = None
  let mut tz = 0.0
  let mut tt = -99.0
  match world.intel.level > 0 {
    true => {
      tx = Some(world.intel.x)
      tz = world.intel.z
      tt = world.intel.t
    }
    false => ()
  }
  for e in list {
    match e.ai {
      Some(ai) =>
        match ai.last_seen {
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
  match m0 {
    Some(m) =>
      match m.threat {
        Some(threat) =>
          match tx {
            Some(txv) => {
              let ttv = tt
              if dist2d(txv, tz, threat.0, threat.1) < 60.0 && ttv > threat.2 {
                let ang0 = v8_atan2(txv - threat.0, tz - threat.1)
                let ang1 = v8_atan2(threat.0 - txv, threat.1 - tz)
                if ang_diff(ang0, ang1).abs() < 0.7 {
                  tx = Some(threat.0)
                  tz = threat.1
                }
              }
            }
            None => ()
          }
        None => ()
      }
    None => ()
  }
  let n = list.length()
  let roles : Map[Int, String] = Map::new()
  let byk : Map[Int, Tank] = Map::new()
  for e in list {
    byk[key_of(e, world)] = e
  }
  let keys = sorted_keys(byk)
  // slotMemo 跨重算持久(JS 侧只携带不写入, 原样保留空)
  let line_keys : Array[Int] = []
  let flank_keys : Array[Int] = []
  let second_keys : Array[Int] = []
  let mut ntd = 0
  for e in list {
    if (if e.spec.cls == "" { "MT" } else { e.spec.cls }) == "TD" {
      ntd += 1
    }
  }
  for e in list {
    let k = key_of(e, world)
    let cls = if e.spec.cls == "" { "MT" } else { e.spec.cls }
    if cls == "TD" && n > 1 && ntd > 0 {
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
  let _ = second_keys
  // 小队全顶线(role.squadLineN)
  let front_n = line_keys.length() + flank_keys.length()
  let line_want = if front_n > 0 &&
    front_n <=
    (if ro.role_squad_line_n != 0 { ro.role_squad_line_n } else { 2 }) {
    front_n
  } else {
    1.0.max(round_ge0(n.to_double() * ro.role_line_min_frac)).to_int()
  }
  // 顶线不足 → 从 flank 按 hp% 提拔(血量高的先顶; 排序键=keyOf 保稳定)
  if line_keys.length() < line_want && flank_keys.length() > 0 {
    // JS: flankKeys.sort((a,b) => ratio(b) - ratio(a))(V8 稳定排序, 平手保持原序)
    let ratio = fn(k : Int) -> Double {
      let e = byk[k]
      e.hp / e.spec.hp
    }
    let mut i = 1
    while i < flank_keys.length() {
      let key = flank_keys[i]
      let mut j = i - 1
      while j >= 0 && ratio(flank_keys[j]) < ratio(key) {
        flank_keys[j + 1] = flank_keys[j]
        j -= 1
      }
      flank_keys[j + 1] = key
      i += 1
    }
    while line_keys.length() < line_want && flank_keys.length() > 0 {
      let k = flank_keys[0]
      ignore(flank_keys.remove(0))
      roles[k] = "line"
      line_keys.push(k)
    }
  }
  // 顶线残血让位 → fallback, 最近 flank 补位(plugFor)
  let plug_for : Map[Int, Int] = Map::new()
  let line_snapshot : Array[Int] = []
  for k in line_keys {
    line_snapshot.push(k)
  }
  for k in line_snapshot {
    let e = byk[k]
    if roles.get(k) == Some("line") && e.hp / e.spec.hp < ro.role_yield_hp_pct {
      roles[k] = "fallback"
      let mut best_f : Int? = None
      let mut bd = 1.0e9
      for fk in flank_keys {
        if roles.get(fk) != Some("flank") {
          continue
        }
        let d = dist2d(e.x, e.z, byk[fk].x, byk[fk].z)
        if d < bd {
          bd = d
          best_f = Some(fk)
        }
      }
      match best_f {
        Some(bf) => {
          roles[bf] = "line"
          plug_for[bf] = k
        }
        None => ()
      }
    }
  }
  // 站位
  let mut team_cx = 0.0
  let mut team_cz = 0.0
  for e in list {
    team_cx += e.x
    team_cz += e.z
  }
  team_cx /= 1.0.max(n.to_double())
  team_cz /= 1.0.max(n.to_double())
  let mut lead_e : Tank? = None
  let mut ld = 1.0e9
  match tx {
    Some(txv) => {
      for e in list {
        let k0 = key_of(e, world)
        if roles.get(k0) != Some("line") {
          continue // 二线锚在顶线车身后
        }
        let d = dist2d(e.x, e.z, txv, tz)
        if d < ld {
          ld = d
          lead_e = Some(e)
        }
      }
      match lead_e {
        None =>
          // 没有顶线车才退回最近者
          for e in list {
            let d = dist2d(e.x, e.z, txv, tz)
            if d < ld {
              ld = d
              lead_e = Some(e)
            }
          }
        Some(_) => ()
      }
    }
    None => ()
  }
  let stations : Map[Int, (Double, Double)?] = Map::new()
  // 同舷方位角占用表(G6①): {1: [], [-1]: []}
  let side_use_pos : Array[Double] = []
  let side_use_neg : Array[Double] = []
  // covNear: 站点掩体亲和
  fn cov_near(x : Double, z : Double) -> Bool {
    for c in world.covers_list {
      if c.blocks_shells && dist2d(x, z, c.x, c.z) < c.r + 12.0 {
        return true
      }
    }
    false
  }
  fn los_fix(
    world : World,
    pt : (Double, Double),
    txv : Double,
    tzv : Double,
  ) -> (Double, Double)? {
    if los_clear(world, pt.0, pt.1, txv, tzv) {
      return Some(pt)
    }
    let a = v8_atan2(txv - pt.0, tzv - pt.1)
    let p2 = (pt.0 + v8_sin(a) * 15.0, pt.1 + v8_cos(a) * 15.0)
    if los_clear(world, p2.0, p2.1, txv, tzv) {
      Some(p2)
    } else {
      None
    }
  }
  let cf_min_sep = ai_cfg.crossfire_min_angle_sep
  let cf_push = ai_cfg.crossfire_push_out_deg
  for k in keys {
    let e = byk[k]
    let r = roles.get(k).unwrap_or("")
    let has_tx = tx is Some(_)
    if not(has_tx) || lead_e is None || n < 2 {
      stations[k] = None
      continue
    }
    let txv = tx.unwrap()
    let cb = class_band_of(e.spec.cls)
    let mid = (cb.0 + cb.1) * 0.5
    if r == "flank" {
      let side : Double = if k % 2 == 0 { 1.0 } else { -1.0 } // 奇偶分舷
      let base = v8_atan2(team_cx - txv, team_cz - tz)
      let deg0 = 55.0 + 20.0 * key_hash(k) + (key_hash(k * 7 + 1) - 0.5) * 30.0
      let rad = clamp(dist2d(e.x, e.z, txv, tz), cb.0, (cb.0 + cb.1) * 0.5)
      // mk(side, deg): 弧上候选 + losClear 验证
      fn mk(sd : Double, deg : Double) -> (Double, Double, Double, Double)? {
        // 返回 (x, z, d, ang)
        let ang = base + sd * deg * @math.PI / 180.0
        let p_x = txv + v8_sin(ang) * rad
        let p_z = tz + v8_cos(ang) * rad
        if los_clear(world, p_x, p_z, txv, tz) {
          Some((p_x, p_z, dist2d(p_x, p_z, e.x, e.z), ang))
        } else {
          None
        }
      }
      let mut st : (Double, Double, Double, Double, Double)? = None // (x, z, side, deg, sc)
      let mut st_d = 0.0
      let mut st_side = 0.0
      let mut st_deg = 0.0
      let mut d = -30
      while d <= 60 {
        let deg = clamp(deg0 + d.to_double(), 40.0, 130.0)
        // for (const c0 of [mk(side, deg), mk(-side, deg)])
        let c0s = [mk(side, deg), mk(-side, deg)]
        for ci in 0..<2 {
          match c0s[ci] {
            None => continue
            Some(c0) => {
              let this_side = if ci == 0 { side } else { -side }
              let mut c_deg = deg
              let mut cx = c0.0
              let mut cz = c0.1
              if this_side == side {
                // 只对本舷候选查同舷间隔
                let used = if side > 0.0 { side_use_pos } else { side_use_neg }
                let mut deg2 = deg
                for u in used {
                  if (u - deg).abs() < cf_min_sep {
                    deg2 = deg + cf_push
                    break
                  }
                }
                if deg2.abs() > 130.0 {
                  continue // 外推越界弃此候选
                }
                if deg2 != deg {
                  match mk(side, deg2) {
                    Some(c2) => {
                      cx = c2.0
                      cz = c2.1
                      c_deg = deg2
                    }
                    None => continue
                  }
                }
              }
              // c.sc = c.d - (covNear ? 35 : 0)
              let cd = dist2d(cx, cz, e.x, e.z)
              let sc = cd - (if cov_near(cx, cz) { 35.0 } else { 0.0 })
              let better = match st {
                None => true
                Some(s) => sc < s.4
              }
              if better {
                st = Some((cx, cz, this_side, c_deg, sc))
                st_d = cd
                st_side = this_side
                st_deg = c_deg
              }
            }
          }
        }
        d += 10
      }
      let mut final_st : (Double, Double)? = None
      match st {
        Some(s) =>
          if st_d > 90.0 {
            final_st = None // 弧上还到不了=弃站
          } else {
            final_st = Some((s.0, s.1))
            // sideUse[st.side].push(st.deg)
            if st_side > 0.0 {
              side_use_pos.push(st_deg)
            } else {
              side_use_neg.push(st_deg)
            }
          }
        None => ()
      }
      stations[k] = final_st
    } else if r == "second" || r == "fallback" {
      let depth = clamp(mid * 0.9, ro.role_td_depth_lo, ro.role_td_depth_hi) *
        (if e.spec.cls == "SPG" { 1.3 } else { 1.0 })
      let back = v8_atan2(team_cx - txv, team_cz - tz) // 背敌向
      let lead = lead_e.unwrap()
      let mut dd = depth
      let mut pt = (lead.x + v8_sin(back) * dd, lead.z + v8_cos(back) * dd)
      if not(los_clear(world, pt.0, pt.1, txv, tz)) {
        // 不通视: 退 20m 重试一次
        dd = (ro.role_td_depth_lo * 0.6).max(dd - 20.0)
        pt = (lead.x + v8_sin(back) * dd, lead.z + v8_cos(back) * dd)
      }
      if not(cov_near(pt.0, pt.1)) {
        // 侧偏 ±0.25rad 再各试一个: 深度带内挑掩体旁
        for da in [0.25, -0.25] {
          let p2 = (
            lead.x + v8_sin(back + da) * dd,
            lead.z + v8_cos(back + da) * dd,
          )
          if los_clear(world, p2.0, p2.1, txv, tz) && cov_near(p2.0, p2.1) {
            pt = p2
            break
          }
        }
      }
      stations[k] = Some(pt)
    } else {
      let a0 = v8_atan2(e.x - txv, e.z - tz) + (key_hash(k) - 0.5) * 0.4
      let rr = (cb.0 + mid) * 0.5
      let mut st = los_fix(
        world,
        (txv + v8_sin(a0) * rr, tz + v8_cos(a0) * rr),
        txv,
        tz,
      )
      let mut d = 10
      while d <= 30 && st is None {
        if st is None {
          st = los_fix(
            world,
            (
              txv + v8_sin(a0 + d.to_double()) * rr,
              tz + v8_cos(a0 + d.to_double()) * rr,
            ),
            txv,
            tz,
          )
        }
        if st is None {
          st = los_fix(
            world,
            (
              txv + v8_sin(a0 - d.to_double()) * rr,
              tz + v8_cos(a0 - d.to_double()) * rr,
            ),
            txv,
            tz,
          )
        }
        d += 10
      }
      stations[k] = st
    }
  }
  // 集火槽(G4)
  let f_slots : Map[Int, Double] = match m0 {
    Some(m) => m.focus_slots
    None => Map::new()
  }
  let f_obj = world.focus
  let mut f_tgt : Tank? = None
  match f_obj {
    Some(fo2) =>
      for e in world.mp_targets {
        if e.alive && e.net_id == fo2.net_id {
          f_tgt = Some(e)
          break
        }
      }
    None => ()
  }
  if ro.focus_on != 0 &&
    f_obj is Some(_) &&
    f_tgt is Some(_) &&
    now - f_obj.unwrap().t <= ro.focus_memory_s &&
    list.length() >= 4 {
    let ftk = f_tgt.unwrap()
    let cap = 2.0
      .max(
        ro.focus_max_per_target
        .to_double()
        .min((list.length().to_double() * 0.6).ceil()),
      )
      .to_int()
    // ranked = list 按距焦点升序(V8 稳定排序)
    let ranked : Array[Tank] = []
    for e in list {
      ranked.push(e)
    }
    let dist_ft = fn(e : Tank) -> Double { dist2d(e.x, e.z, ftk.x, ftk.z) }
    // 插入排序(稳定)
    let mut i = 1
    while i < ranked.length() {
      let key = ranked[i]
      let kd = dist_ft(key)
      let mut j = i - 1
      while j >= 0 && dist_ft(ranked[j]) > kd {
        ranked[j + 1] = ranked[j]
        j -= 1
      }
      ranked[j + 1] = key
      i += 1
    }
    let desired : Set[Int] = Set::new()
    for i in 0..<cap.min(ranked.length()) {
      desired.add(key_of(ranked[i], world))
    }
    for k in sorted_keys(f_slots) {
      // 淘汰: 死车/掉出且滞回期满
      let dead_or_out = match byk.get(k) {
        Some(tk) =>
          not(tk.alive) ||
          (not(desired.contains(k)) && now - f_slots[k] > ro.focus_slot_hyst_s)
        None => true
      }
      if dead_or_out {
        ignore(f_slots.remove(k))
      }
    }
    for e in ranked {
      if f_slots.size() >= cap {
        break
      }
      let k = key_of(e, world)
      if not(f_slots.contains(k)) {
        f_slots[k] = now
      }
    }
    for k in sorted_keys(f_slots) {
      if desired.contains(k) {
        f_slots[k] = now
      }
    }
  } else {
    for k in sorted_keys(f_slots) {
      f_slots.remove(k) // 无有效焦点: 清槽
    }
  }
  // 顶位补防(G6②): plugPinned
  let plug_pinned : Map[Int, PlugPinned] = match m0 {
    Some(m) => m.plug_pinned
    None => Map::new()
  }
  if ai_cfg.crossfire_on != 0 {
    for k in sorted_keys(plug_pinned) {
      // 清理: 被钉的 line 车阵亡/补位车阵亡/超窗
      let p = plug_pinned[k]
      let dead_k = match byk.get(k) {
        Some(tk) => not(tk.alive)
        None => true
      }
      let dead_by = match byk.get(p.by) {
        Some(tk) => not(tk.alive)
        None => true
      }
      if dead_k || dead_by || now > p.until {
        ignore(plug_pinned.remove(k))
      }
    }
    for k in sorted_keys(roles) {
      if roles.get(k) != Some("line") {
        continue
      }
      let ek = match byk.get(k) {
        Some(t2) => t2
        None => continue
      }
      if not(ek.alive) {
        continue
      }
      let retreat = match ek.ai {
        Some(ai) => ai.state == "retreat"
        None => false
      }
      let low = ek.hp / ek.spec.hp < ro.role_yield_hp_pct
      if not(retreat) && not(low) {
        continue
      }
      match plug_pinned.get(k) {
        Some(p) =>
          if now < p.until {
            continue // 已在钉住期
          }
        None => ()
      }
      let mut best : Int? = None
      let mut bh = -1.0
      for fk in sorted_keys(roles) {
        if roles.get(fk) != Some("flank") {
          continue
        }
        let ft = match byk.get(fk) {
          Some(t2) => t2
          None => continue
        }
        if not(ft.alive) {
          continue
        }
        match stations.get(fk) {
          Some(Some(_)) => ()
          _ => continue
        }
        let h = ft.hp / ft.spec.hp
        if h > bh {
          bh = h
          best = Some(fk)
        }
      }
      match best {
        Some(b) => {
          let sx = match stations.get(k) {
            Some(Some(s)) => s.0
            _ => ek.x
          }
          let sz = match stations.get(k) {
            Some(Some(s)) => s.1
            _ => ek.z
          }
          plug_pinned[k] = {
            by: b,
            x: sx,
            z: sz,
            until: now + ai_cfg.crossfire_plug_window_s,
          }
        }
        None => ()
      }
    }
    for k in sorted_keys(plug_pinned) {
      // 覆盖补位车站位(钉住期)
      let p = plug_pinned[k]
      if roles.get(p.by) == Some("flank") {
        stations[p.by] = Some((p.x, p.z))
      }
    }
  }
  let threat : (Double, Double, Double)? = match tx {
    Some(txv) => Some((txv, tz, tt))
    None => None
  }
  let memo : Memo = {
    sig,
    t: now,
    list,
    byk,
    roles,
    stations,
    plug_for,
    focus_slots: f_slots,
    plug_pinned,
    threat,
    lead: lead_e,
  }
  world.team_memo = Some(memo)
  memo
}
