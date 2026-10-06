// client/js/srv-sim.js (SF.SrvSim) 直译: 服务器权威房实例。
// 逐函数对照: coverCol 复用 simcore(同款)/circleCollide/mulberry32(房间独立流)/seededShuffle/
// makeTank/makeJudge/create(setInput/tick/snapshot/scoreRows/forceEnd/testFire/finish)。
// 上游已知缺陷按 SPEC §6 原样同构(直译走样才是不忠):
//   ①makeJudge 按值捕获基础事件出口(:178) —— dm/coop 的 shell/ram 击杀不加分不重生;
//   ②coop 波间维修 tick(:507)与 checkWaveCoop(:370)双扣 repairT —— 实际窗=duration/2;
//   ③coop 分支 timeLimit=9999(:573)写隐式全局 —— 局部 timeLeft 保持 create 默认(本链快照 st 不受影响)。

///|
/// 出生池/掩体推挤: circleCollide (srv-sim.js:48-74; models.js CoverField.collide 同款)
pub fn circle_collide(
  list : Array[@simcore.Cover],
  x : Double,
  z : Double,
  radius : Double,
) -> (Double, Double) {
  let mut nx = x
  let mut nz = z
  for c in list {
    if not(c.blocks_move) {
      continue
    }
    if c.shape == "box" {
      let cs = v8_cos(c.yaw)
      let sn = v8_sin(c.yaw)
      let px = nx - c.x
      let pz = nz - c.z
      let mut lx = cs * px - sn * pz
      let mut lz = sn * px + cs * pz
      let qx = lx.min(c.hx).max(-c.hx)
      let qz = lz.min(c.hz).max(-c.hz)
      let ddx = lx - qx
      let ddz = lz - qz
      let d2 = ddx * ddx + ddz * ddz
      if d2 > radius * radius {
        continue
      }
      if d2 < 1.0e-6 {
        // 圆心陷入: 沿更近的轴向退出
        if c.hx - lx.abs() < c.hz - lz.abs() {
          lx = if lx >= 0.0 { c.hx + radius } else { -c.hx - radius }
        } else {
          lz = if lz >= 0.0 { c.hz + radius } else { -c.hz - radius }
        }
      } else {
        let d = d2.sqrt()
        lx = qx + ddx / d * radius
        lz = qz + ddz / d * radius
      }
      nx = c.x + cs * lx + sn * lz
      nz = c.z - sn * lx + cs * lz
    } else {
      let dx = nx - c.x
      let dz = nz - c.z
      let d = @math.hypot(dx, dz)
      let min = c.r + radius
      if d < min && d > 0.001 {
        nx = c.x + dx / d * min
        nz = c.z + dz / d * min
      }
    }
  }
  (nx, nz)
}

///|
/// seededShuffle (srv-sim.js:85-89): 种子半侧洗牌(房间独立 mulberry32 流)
pub fn seeded_shuffle(
  arr : Array[(Double, Double)],
  rng : @simcore.Mulberry32,
) -> Array[(Double, Double)] {
  let a : Array[(Double, Double)] = []
  for e in arr {
    a.push(e)
  }
  let mut i = a.length() - 1
  while i > 0 {
    let j = (rng.next() * (i + 1).to_double()).to_int()
    let tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
    i -= 1
  }
  a
}

///|
/// toFixed 的数值还原(JS `+v.toFixed(n)` 的精确语义: 就 x 的十进制展开取最近整数
/// n/10^f, 平手取较大 n)。x·10^f 以 Int64 精确计算(x = m·2^e, 本链 |x|<1e6, f≤3,
/// m·10^f ≤ 2^53·10^3 < 2^63), 规避 x·p 的 FP 舍入在 .5 边界上与 JS 分歧。
pub fn to_fixed(x : Double, f : Int) -> Double {
  if x == 0.0 {
    return 0.0
  }
  let p : Double = match f {
    0 => 1.0
    1 => 10.0
    2 => 100.0
    3 => 1000.0
    _ => return x // 本链只用 0..3
  }
  let bits = x.reinterpret_as_uint64()
  let neg = bits >> 63 == 1UL
  let exp_bits = ((bits >> 52) & 0x7FFUL).to_int()
  let frac = bits & 4503599627370495UL // 2^52-1
  let m0 : UInt64 = if exp_bits == 0 {
    frac
  } else {
    frac | 4503599627370496UL // 隐含位 2^52
  }
  let e : Int = if exp_bits == 0 { -1074 } else { exp_bits - 1075 }
  let mut num : Int64 = m0.to_int64()
  if neg {
    num = -num
  }
  let mul10 : Int64 = match f {
    0 => 1L
    1 => 10L
    2 => 100L
    _ => 1000L
  }
  let mut num = num * mul10
  let mut n : Int64 = 0L
  if e >= 0 {
    n = num << e // x·10^f 为精确整数(Int64 移位量 = Int)
  } else {
    let k = -e
    // 消去 2 的公因子(10^f 至少带 f 个 2), 保证 2·den < 2^63
    let tz = tz_i64(num)
    let s2 = if tz < k { tz } else { k }
    num = num >> s2
    let kk = k - s2
    if kk <= 62 {
      let den : Int64 = 1L << kk
      let q = idiv_floor(num, den)
      let r = num - q * den
      let half = if 2L * r >= den { 1L } else { 0L }
      n = q + half
    } else {
      // |x·10^f| < 1(den 超出 Int64): 结果只能为 0(或恰为 ±0.5 的 tie→较大 n=1)。
      // num·2 ≥ 2^kk ⟺ bitlen(num) ≥ kk+1
      n = if bitlen_i64(num) >= kk + 1 { 1L } else { 0L }
    }
  }
  n.to_double() / p
}

///|
/// Int64 位长(本链 num ≠ 0)
fn bitlen_i64(v0 : Int64) -> Int {
  let mut v = if v0 < 0L { -v0 } else { v0 }
  let mut c = 0
  while v > 0L {
    v = v / 2L
    c += 1
  }
  c
}

///|
/// Int64 尾零计数(本链 num ≠ 0)
fn tz_i64(v0 : Int64) -> Int {
  let mut v = if v0 < 0L { -v0 } else { v0 }
  let mut c = 0
  while v % 2L == 0L {
    v = v / 2L
    c += 1
  }
  c
}

///|
/// floor 除法(Int64 / 向 -∞ 截断)
fn idiv_floor(a : Int64, b : Int64) -> Int64 {
  let q = a / b
  if a % b != 0L && (a < 0L) != (b < 0L) {
    q - 1L
  } else {
    q
  }
}

///|
/// netId 键控有序坦克表(JS Map 插入序语义: [...tanks.values()] 顺序敏感)
pub(all) struct TankMap {
  entries : Array[(Int, Tank)]
  idx : Map[Int, Int]
}

///|
pub fn TankMap::new() -> TankMap {
  { entries: [], idx: Map::new(), }
}

///|
pub fn TankMap::get(self : TankMap, id : Int) -> Tank? {
  match self.idx.get(id) {
    Some(i) => Some(self.entries[i].1)
    None => None
  }
}

///|
pub fn TankMap::set(self : TankMap, id : Int, t : Tank) -> Unit {
  match self.idx.get(id) {
    Some(_) => ()
    None => {
      self.idx[id] = self.entries.length()
      self.entries.push((id, t))
    }
  }
}

///|
pub fn TankMap::values(self : TankMap) -> Array[Tank] {
  let out : Array[Tank] = []
  for e in self.entries {
    out.push(e.1)
  }
  out
}

///|
/// 权威房 create 参数(srv-sim.js:171-173 opts)
pub(all) struct RoomOpts {
  heights : FixedArray[Float]
  terrain_size : Double
  terrain_res : Int
  covers_raw : Array[@simcore.CoverRaw]
  seed : Int
  time_limit : Double // timeLimit(缺省 180 由调用方给足)
  players : Array[PlayerDef]
  coop : Bool // mode === 'coop'
  waves : Array[WaveDef]
  repair_duration : Double // opts.repairWaves.duration
  repair_hp_ratio : Double // opts.repairWaves.hpRatio
  on_event : (String, Ev) -> Unit // opts.onEvent(k, d)
  on_end : (Array[(Int, String, Int)]) -> Unit // opts.onEnd(scoreRows)
}

///|
/// 波次定义(map.json waves; 夹具 meta.coop.waves 原样)
pub(all) struct WaveDef {
  name : String
  enemies : Array[WaveEnemy]
}

///|
pub(all) struct WaveEnemy {
  typ : String // type
  pos : (Double, Double)
  yaw : Double? // 缺省 π
  personality : String?
  hold : Bool
  patrol : Array[(Double, Double)]
}

///|
/// 补给空投场上场目(pkList 条目)
pub(all) struct Pickup {
  id : Int
  typ : String
  mut x : Double
  mut z : Double
  mut landed : Bool
  mut fall_y : Double // fallY
  mut life : Double
}

///|
/// 重生队列条目
pub(all) struct RespawnQ {
  mut t : Double
  tk : Tank
}

///|
/// 权威房实例(SF.SrvSim.create 闭包变量逐一对映; api.* 方法为伴随函数)
pub(all) struct Room {
  terrain : @simcore.Terrain // T
  covers_list : Array[@simcore.Cover] // coversList
  rng : @simcore.Mulberry32 // 房间独立流(srv-sim.js:176)
  pool : Array[(Double, Double)] // 出生池 24 点
  pool_side : (Array[(Double, Double)], Array[(Double, Double)])
  half : Int // pool.length >> 1
  tanks : TankMap
  seq0 : Ref[Int] // seq[0]
  seq1 : Ref[Int] // seq[1]
  shells : Shells
  env_t_tanks : Array[Tank] // envT.tanks(create 时 [...tanks.values()] 同一数组)
  respawn : Array[RespawnQ]
  time : Ref[Double] // let time = 0(与 World.time_ref 共享)
  mut time_left : Double // let timeLeft
  mut finished : Bool
  mut win : Bool // api.__win
  scores : Array[(Int, Int)] // scores Map(插入序)
  coop : Bool // opts.mode === 'coop'
  mut humans : Array[Tank] // [...tanks.values()](coop 段)
  waves : Array[WaveDef]
  mut wave_idx : Int
  mut repair_t : Double
  mut repair_done : Bool
  mut repair_duration_x : Double // opts.repairWaves.duration(create 显式传值)
  mut repair_ratio_x : Double // opts.repairWaves.hpRatio
  mut lose_t : Double // 初值 -1
  mut enemy_seq : Int // 初值 100
  mut total_spawned : Int // totalStats.spawned
  mut world_ref : World?
  mut wave_started : Bool
  mut pk_spawn_t : Double // PK_CFG.firstDelay
  mut pk_seq : Int // 1000
  pk_list : Array[Pickup]
  on_event : (String, Ev) -> Unit
  on_end : (Array[(Int, String, Int)]) -> Unit
  judge : Judge // makeJudge 产物(含被按值捕获的基础出口)
  mut dispatch : (Ev) -> Unit // 全功能出口(:278 起挂在外层变量)
}

///|
/// PK_IDX(srv-sim.js:380)
pub fn pk_idx_of(typ : String) -> Int {
  let idx = ["repair", "speed", "aim", "mobility", "load"]
  for i, s in idx {
    if s == typ {
      return i
    }
  }
  -1
}

///|
/// 裁判(srv-sim.js:115-168 makeJudge)。base_dispatch 是 create 里 :178 的基础出口,
/// makeJudge 按值捕获它 —— 之后 :278 换上的全功能版对裁判不可见(SPEC §6 已知缺陷①)。
pub(all) struct Judge {
  base_dispatch : (Ev) -> Unit
}

///|
/// makeJudge.probeTank (srv-sim.js:118-126)。JS 的 G.__j 调试计数分支不改判定, 略。
pub fn Judge::probe_tank(
  self : Judge,
  sh : Shell,
  tk : Tank,
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  seg_len : Double,
) -> HitRec? {
  let _ = self
  probe_tank_obb(tk, ox, oy, oz, dx, dy, dz, seg_len)
}

///|
/// makeJudge.onHitTank (srv-sim.js:128-158): takeHit 数值结算(OBB 部位命中 → 穿深/跳弹/毁伤)
pub fn Judge::on_hit_tank(
  self : Judge,
  sh : Shell,
  tk : Tank,
  hit : HitRec,
  seg_dir : Vec3,
) -> Unit {
  if not(tk.alive) {
    return
  }
  let a = armor_cfg
  let incidence = @math.acos(
    1.0.min(
      (-1.0).max(
        -(hit.normal.x * seg_dir.x +
        hit.normal.y * seg_dir.y +
        hit.normal.z * seg_dir.z),
      ),
    ),
  )
  let armor = hit.armor
  let cal = sh.cal
  let over3 = armor > 0.0 && cal > armor * 3.0
  let mut norm = 5.0 * @math.PI / 180.0
  if armor > 0.0 && cal > armor * 2.0 {
    norm *= 2.0
  }
  let eff = armor / v8_cos(0.0.max(incidence - norm)).max(0.05)
  let pen = sh.pen * (1.0 + (random() * 2.0 - 1.0) * a.pen_variance) // 掷: 穿深浮动
  let rico = armor > 0.0 && not(over3) && incidence > a.ricochet_angle
  let mut kind = "nopen"
  let mut module_ = ""
  let mut dmg = 0.0
  sh.owner.hits += 1
  if hit.zone == "gun" {
    tk.mod_gun = inf() // 炮管吸收: 火炮损(永久)
    kind = "gun"
    module_ = "gun"
  } else if hit.zone == "tracks" {
    tk.mod_track = a.track_duration
    module_ = "track"
    if rico {
      kind = "bounce"
    } else if pen >= eff {
      kind = "pen"
      dmg = js_round(sh.dmg * (1.0 + (random() * 2.0 - 1.0) * a.dmg_variance)) // 掷: 伤害浮动
    } else {
      kind = "absorb"
    }
  } else if rico {
    kind = "bounce"
  } else if pen >= eff {
    kind = "pen"
    let mut d2 = sh.dmg * (1.0 + (random() * 2.0 - 1.0) * a.dmg_variance) // 掷: 伤害浮动
    if random() < a.ammo_chance {
      // 掷: 弹药架
      d2 *= a.ammo_dmg_mult
      module_ = "ammo"
      tk.mod_ammo = inf()
    } else if hit.zone == "hullRear" && random() < a.engine_rear_chance {
      // 掷: 发动机(车尾)
      module_ = "engine"
      tk.mod_engine = inf()
    }
    dmg = js_round(d2)
  }
  if kind == "pen" {
    tk.hp -= dmg
    sh.owner.pens += 1
    sh.owner.dmg_dealt += dmg.to_int()
  }
  if tk.hp <= 0.0 && tk.alive {
    tk.hp = 0.0
    tk.alive = false
    (self.base_dispatch)(
      Kill(tk.net_id, sh.owner.net_id, tk.x, tk.y + 1.0, tk.z),
    )
  }
  (self.base_dispatch)(
    HitJudge(
      sh.owner.net_id,
      tk.net_id,
      kind,
      dmg,
      module_,
      hit.point.x,
      hit.point.y,
      hit.point.z,
    ),
  )
}

///|
/// makeJudge.takeRam (srv-sim.js:161-166): 撞击承伤(基础出口, 同已知缺陷①)
pub fn Judge::take_ram(
  self : Judge,
  target : Tank,
  shooter : Tank,
  dmg : Double,
) -> Unit {
  if not(target.alive) || dmg <= 0.0 {
    return
  }
  target.hp -= dmg
  if target.hp <= 0.0 && target.alive {
    target.hp = 0.0
    target.alive = false
    (self.base_dispatch)(
      Kill(target.net_id, shooter.net_id, target.x, target.y + 1.0, target.z),
    )
  }
  (self.base_dispatch)(
    HitJudge(
      shooter.net_id,
      target.net_id,
      "ram",
      dmg,
      "",
      target.x,
      target.y + 1.0,
      target.z,
    ),
  )
}

///|
/// 空投类型挑选权重表快照(pkPickType 的 W 复制; 插入序 = PK_CFG.weights)
fn pk_weights_copy() -> Array[(String, Double)] {
  let out : Array[(String, Double)] = []
  for kv in pickups_cfg.weights {
    out.push((kv.0, kv.1))
  }
  out
}

///|
/// srv-sim.js:571 waveStarted 语义 + create 主体。Room 构造即 JS create() 执行体。
pub fn Room::create(opts : RoomOpts) -> Room raise {
  let t_terrain = @simcore.make_terrain(
    opts.heights,
    opts.terrain_size,
    opts.terrain_res,
  )
  let covers_list : Array[@simcore.Cover] = []
  for c in opts.covers_raw {
    covers_list.push(@simcore.cover_col(c))
  }
  // mulberry32((opts.seed >>> 0) || 1)(房间独立流, 与全局流并行)
  let rng = @simcore.Mulberry32::new(opts.seed)
  // dispatch: 先指基础出口(:178), 尾部换成全功能版(:278)
  let on_event = opts.on_event
  fn base_dispatch(ev : Ev) -> Unit {
    on_event(ev.kind(), ev)
  }
  // 出生池: main.js 死斗池的服务器侧重建
  let spawn_g = v8_tan_max_slope * 0.96
  fn spawn_pt_ok(x : Double, z : Double) -> Bool {
    if t_terrain.grad_at(x, z) > spawn_g {
      return false
    }
    let h_c = t_terrain.height_at(x, z) // 反壕沟: 四向 14m 高差夹谷
    for k in 0..<4 {
      let a = k.to_double() * @math.PI / 4.0
      let dx = v8_sin(a) * 14.0
      let dz = v8_cos(a) * 14.0
      if t_terrain.height_at(x + dx, z + dz) > h_c + 3.0 &&
        t_terrain.height_at(x - dx, z - dz) > h_c + 3.0 {
        return false
      }
    }
    true
  }
  fn spawn_disk_ok(x : Double, z : Double) -> Bool {
    let mut dz = -11
    while dz <= 11 {
      let mut dx = -11
      while dx <= 11 {
        if dx * dx + dz * dz <= 121 &&
          not(spawn_pt_ok(x + dx.to_double(), z + dz.to_double())) {
          return false
        }
        dx += 5
      }
      dz += 5
    }
    true
  }
  fn find_spawn_spot(x : Double, z : Double) -> (Double, Double)? {
    if spawn_disk_ok(x, z) {
      return Some((x, z))
    }
    let mut r = 12
    while r <= 108 {
      for k in 0..<8 {
        let a = k.to_double() / 8.0 * @math.PI * 2.0 +
          r.to_double() / 12.0 * 0.3
        let cx = clamp(
          x + v8_cos(a) * r.to_double(),
          -t_terrain.half + 20.0,
          t_terrain.half - 20.0,
        )
        let cz = clamp(
          z + v8_sin(a) * r.to_double(),
          -t_terrain.half + 20.0,
          t_terrain.half - 20.0,
        )
        if spawn_disk_ok(cx, cz) {
          return Some((cx, cz))
        }
      }
      r += 12
    }
    None
  }
  let pool : Array[(Double, Double)] = []
  for i in 0..<24 {
    let a = i.to_double() / 24.0 * @math.PI * 2.0
    let sx0 = v8_cos(a) * 310.0
    let sz0 = v8_sin(a) * 310.0
    let pushed = circle_collide(covers_list, sx0, sz0, 3.0)
    let mut sx = pushed.0
    let mut sz = pushed.1
    match find_spawn_spot(sx, sz) {
      Some(spot) => {
        let pushed2 = circle_collide(covers_list, spot.0, spot.1, 3.0)
        sx = pushed2.0
        sz = pushed2.1
      }
      None => ()
    }
    pool.push((sx, sz))
  }
  let half = pool.length() >> 1
  let side0 = seeded_shuffle(array_slice(pool, 0, half), rng)
  let side1 = seeded_shuffle(array_slice(pool, half, pool.length()), rng)
  // 坦克与输入 clamp
  let tanks : TankMap = TankMap::new()
  let seq0 : Ref[Int] = { val: 0, }
  let seq1 : Ref[Int] = { val: 0, }
  for pl in opts.players {
    let team = if pl.team == 1 { 1 } else { 0 }
    let side = if team == 0 { side0 } else { side1 }
    let seq = if team == 0 { seq0 } else { seq1 }
    let sp = side[seq.val % half]
    seq.val += 1
    tanks.set(pl.id, make_tank(pl, sp.0, sp.1, v8_atan2(-sp.0, -sp.1)))
  }
  let env_t_tanks = tanks.values()
  // 弹场与裁判(炮口位姿为确定性脚本值)
  let judge : Judge = { base_dispatch, }
  // makeShells(Object.assign({空 hooks}, judge))
  let hooks : ShellHooks = {
    probe_tank: fn(sh, tk, ox, oy, oz, dx, dy, dz, seg_len) {
      judge.probe_tank(sh, tk, ox, oy, oz, dx, dy, dz, seg_len)
    },
    on_hit_tank: fn(sh, tk, hit, seg_dir) {
      judge.on_hit_tank(sh, tk, hit, seg_dir)
    },
    on_impact: fn(_kind, _p) { () },
    on_player_miss: fn(_p) { () },
    on_near_miss: fn(_s) { () },
    on_flight: fn(_s) { () },
    on_kill: fn(_s) { () },
    on_explode: fn(_s, _p, _tk, _armor) { () },
    on_create: fn(_s) { () },
    take_ram: fn(target, shooter, dmg) { judge.take_ram(target, shooter, dmg) },
  }
  let shells = make_shells(hooks)
  let time_ref : Ref[Double] = { val: 0.0, }
  let room : Room = {
    terrain: t_terrain,
    covers_list,
    rng,
    pool,
    pool_side: (side0, side1),
    half,
    tanks,
    seq0,
    seq1,
    shells,
    env_t_tanks,
    respawn: [],
    time: time_ref,
    time_left: opts.time_limit, // opts.timeLimit || 180
    finished: false,
    win: false,
    scores: [],
    coop: opts.coop,
    humans: [],
    waves: opts.waves,
    wave_idx: 0,
    repair_t: 0.0,
    repair_done: false,
    repair_duration_x: opts.repair_duration,
    repair_ratio_x: opts.repair_hp_ratio,
    lose_t: -1.0,
    enemy_seq: 100,
    total_spawned: 0,
    world_ref: None,
    wave_started: false,
    pk_spawn_t: pickups_cfg.first_delay,
    pk_seq: 1000,
    pk_list: [],
    on_event,
    on_end: opts.on_end,
    judge,
    dispatch: base_dispatch, // (先指基础出口; create 尾部换全功能版)
  }
  for pl in opts.players {
    room.scores.push((pl.id, 0))
  }
  room.humans = tanks.values()
  // ---------- 阶段4: coop 权威段(波次/AI/维修/补给) ----------
  // (coop 分支 timeLimit=9999 写隐式全局的已知缺陷③: 本直译的 time_left 即 JS 局部
  //  timeLeft —— 同样保持 create 传入值, coop 不倒扣)
  if opts.coop {
    // AI 的 world 视图: 生产 coop host 语义
    let world : World = {
      time_ref,
      over: false,
      terrain: t_terrain,
      covers_list,
      enemies: [],
      player: room.humans.first_opt(),
      mp_targets: room.humans,
      tanks: env_t_tanks,
      intel: { x: 0.0, z: 0.0, t: -99.0, level: 0, },
      focus: None,
      focus_prev: None,
      team_memo: None,
      team_ids: None,
      team_ids_n: 0,
      hill_plan: None,
      nav_cache: None,
    }
    room.world_ref = Some(world)
    // (生产环境由 server.js 注入 SF.Game 指向本世界; golden-trace2.js 的夹具环境 boot()
    //  重建了 SF 且从未设 SF.Game —— ai.js nowT()/world2time() 恒 0, onHurt 的 intel 上报
    //  不发生。直译保持夹具口径: 不注入, g_game_world 恒 None。)
  }
  // 全功能事件出口: kill → 计分 + 重生队列(:278; judge/shells 闭包按值持有的基础出口不可见)
  fn full_dispatch(ev : Ev) -> Unit {
    on_event(ev.kind(), ev)
    match ev {
      Kill(id, by, _, _, _) => {
        for i, kv in room.scores {
          if kv.0 == by {
            room.scores[i] = (kv.0, kv.1 + 1)
            break
          }
        }
        match room.tanks.get(id) {
          Some(tk) => room.respawn.push({ t: 5.0, tk, })
          None => ()
        }
      }
      _ => ()
    }
  }
  room.dispatch = full_dispatch
  room
}

///|
/// 数组切片(pool.slice(a, b))
fn array_slice(
  arr : Array[(Double, Double)],
  a : Int,
  b : Int,
) -> Array[(Double, Double)] {
  let out : Array[(Double, Double)] = []
  for i in a..<b {
    out.push(arr[i])
  }
  out
}

///|
/// Humans 辅助(humans[0] 可选化)
fn Array::first_opt(self : Array[Tank]) -> Tank? {
  if self.length() > 0 {
    Some(self[0])
  } else {
    None
  }
}
