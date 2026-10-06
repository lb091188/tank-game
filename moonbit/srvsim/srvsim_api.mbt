// srv-sim.js 直译 · 房实例 api 方法: setInput/tick/snapshot/scoreRows/forceEnd/testFire/finish,
// coop 波次(spawnWaveCoop/checkWaveCoop/pickTierTank), 补给空投(tickPickups/pkApply/pkPickType/
// pkDropPoint/pkAttach/pkRecompute), 死斗重生(rebuild)。逐函数对照, 注释标原函数名/行号。

///|
/// 原始输入行(JS 侧为任意数组; None = JS undefined → num() 归 0 / !! 归 false)
pub(all) struct RawInput {
  throttle : Double?
  steer : Double?
  aim_yaw : Double?
  aim_pitch : Double?
  fire : Bool?
}

///|
/// clampInput (srv-sim.js:228-238): 油门/舵机 ∈[-1,1], 瞄准角归一 [-π,π], 俯仰钳到 spec 射界
pub fn clamp_input(t : Tank, i : RawInput) -> Input {
  // JS num(x) = typeof x === 'number' && Number.isFinite(x) ? x : 0
  fn num(x : Double?) -> Double {
    match x {
      Some(v) => if v.is_nan() || v.is_inf() { 0.0 } else { v }
      None => 0.0
    }
  }
  {
    throttle: clamp(num(i.throttle), -1.0, 1.0),
    steer: clamp(num(i.steer), -1.0, 1.0),
    aim_yaw: v8_atan2(v8_sin(num(i.aim_yaw)), v8_cos(num(i.aim_yaw))),
    aim_pitch: clamp(
      num(i.aim_pitch),
      t.spec.gun_depression,
      t.spec.gun_elevation,
    ),
    fire: match i.fire {
      Some(b) => b
      None => false
    },
    hold_turret: false,
  }
}

///|
/// muzzleOf (srv-sim.js:254): 确定性脚本炮口位姿
pub fn muzzle_of(t : Tank) -> Vec3 {
  { x: t.x + v8_sin(t.yaw) * 2.0, y: t.y + 2.1, z: t.z + v8_cos(t.yaw) * 2.0, }
}

///|
/// aimDirOf (srv-sim.js:255-258)
pub fn aim_dir_of(t : Tank) -> Vec3 {
  let cp = v8_cos(t.gun_pitch)
  {
    x: v8_sin(t.turret_yaw) * cp,
    y: v8_sin(t.gun_pitch),
    z: v8_cos(t.turret_yaw) * cp,
  }
}

///|
/// rebuild (srv-sim.js:267-276): 重生取点(服务端权威; 消费房间流 1 骰)
fn Room::rebuild(self : Room, tk : Tank) -> Unit {
  let half2 = self.pool.length() >> 1
  let side = if tk.team == 1 { self.pool_side.1 } else { self.pool_side.0 }
  let sp = side[(random() * half2.to_double()).to_int()] // 全局流(重生取点)
  tk.x = sp.0
  tk.z = sp.1
  tk.yaw = v8_atan2(-sp.0, -sp.1)
  tk.turret_yaw = tk.yaw
  tk.gun_pitch = 0.0
  tk.speed = 0.0
  tk.gear = "D1"
  tk.shift_t = 0.0
  tk.flip_t = 0.0
  tk.pitch = 0.0
  tk.roll = 0.0
  tk.y = 0.0
  tk.y_init = false
  tk.fall_v = 0.0
  tk.hp = tk.spec.hp
  tk.alive = true
  tk.reload_t = 1.0
  tk.reload_total = 1.0
  tk.disp = tk.spec.dispersion.max
  tk.mod_track = 0.0
  tk.mod_engine = 0.0
  tk.mod_gun = 0.0
  tk.mod_ammo = 0.0
}

///|
/// TIER_NUM (srv-sim.js:292): ROMAN 表已预析为 VSpec.tier_num
fn tier_num(v : VSpec) -> Int {
  v.tier_num
}

///|
/// pickTierTank (srv-sim.js:300-311): main.js pickTierTank 移植(hasModel 注入, 夹具恒 true)。
/// for..in CFG.vehicles 消费次序 = 源码插入序(SPEC §4)。
fn Room::pick_tier_tank(self : Room, cls : String, band : (Int, Int)) -> String {
  let _ = self
  for w in 0..<4 {
    let lo = imax(1, band.0 - w)
    let hi = imin(11, band.1 + w)
    let pool : Array[String] = []
    for v in vehicles_data {
      if v.tier != "" && v.cls == cls && tier_num(v) >= lo && tier_num(v) <= hi {
        pool.push(v.typ) // hasModel 恒真
      }
    }
    if pool.length() > 0 {
      return pool[(random() * pool.length().to_double()).to_int()]
    }
  }
  "pz4"
}

///|
/// spawnWaveCoop (srv-sim.js:312-355): coop 波次生成(Math.random 消费密集, 次序即规范)
fn Room::spawn_wave_coop(self : Room, i : Int) -> Unit {
  if i >= self.waves.length() {
    return
  }
  let wave = self.waves[i]
  let n_p = imax(1, self.humans.length())
  let mut pt = 1
  for h in self.humans {
    pt = imax(pt, if h.spec.tier_num != 0 { h.spec.tier_num } else { 5 })
  }
  let band : (Int, Int) = if i == 0 { (pt - 1, pt) } else { (pt, pt + 1) }
  let target = imax(
    1,
    imin(
      9,
      js_round(
        wave.enemies.length().to_double() +
        (n_p - 1).to_double() * 1.6 +
        (random() - 0.5) * 1.5 +
        (if n_p == 1 { -1.0 } else { 0.0 }),
      ).to_int(),
    ),
  )
  let defs : Array[WaveEnemy] = []
  for e in wave.enemies {
    defs.push(e)
  }
  while defs.length() > target {
    ignore(defs.remove((random() * defs.length().to_double()).to_int()))
  }
  while defs.length() < target {
    // src = defs.find(d => !d.hold) || defs[0] || wave.enemies[0]
    let mut src : WaveEnemy = if defs.length() > 0 {
      defs[0]
    } else {
      wave.enemies[0]
    }
    for d in defs {
      if not(d.hold) {
        src = d
        break
      }
    }
    let jr2 = 90.0 + target.to_double() * 4.0
    defs.push({
      typ: src.typ,
      pos: (
        src.pos.0 + (random() - 0.5) * 2.0 * jr2,
        src.pos.1 + (random() - 0.5) * 2.0 * jr2,
      ),
      yaw: src.yaw,
      personality: src.personality,
      hold: src.hold,
      patrol: src.patrol,
    })
  }
  let n = defs.length()
  let spawned : Array[(Int, String)] = []
  for wi, def in defs {
    let jr = if def.hold { 18.0 } else { 65.0 }
    let mut ex = clamp(def.pos.0 + (random() - 0.5) * 2.0 * jr, -430.0, 430.0)
    let mut ez = clamp(def.pos.1 + (random() - 0.5) * 2.0 * jr, -430.0, 430.0)
    let mut k = 0
    while k < 8 && not(self.spawn_pt_ok(ex, ez)) {
      ex = clamp(def.pos.0 + (random() - 0.5) * 2.0 * jr, -430.0, 430.0)
      ez = clamp(def.pos.1 + (random() - 0.5) * 2.0 * jr, -430.0, 430.0)
      k += 1
    }
    let pushed = circle_collide(self.covers_list, ex, ez, 2.6)
    ex = pushed.0
    ez = pushed.1
    // CLS_OF_LEGACY = { medium: 'MT', td: 'TD', heavy: 'HT' }; def.type 恒为车型键(走 CFG.cls)
    let cls = match def.typ {
      "medium" => "MT"
      "td" => "TD"
      "heavy" => "HT"
      _ =>
        match vehicle_get(def.typ) {
          Some(v) => v.cls
          None => "MT"
        }
    }
    let typ = self.pick_tier_tank(cls, band)
    let flank_slot = wi.to_double() / n.to_double() * @math.PI * 2.0 +
      (random() - 0.5) * 0.8
    let yaw_base = match def.yaw {
      Some(y) => y
      None => @math.PI
    }
    let enemy : PlayerDef = {
      id: self.enemy_seq,
      name: typ,
      tank: typ,
      team: 1,
    }
    self.enemy_seq += 1
    let t = make_tank(enemy, ex, ez, yaw_base + (random() - 0.5) * 0.4)
    // patrol = (def.patrol || []).map(w => [clamp(w[0] + (ex - def.pos[0]) + (rand-0.5)*50, ...), ...])
    let patrol : Array[(Double, Double)] = []
    for w in def.patrol {
      patrol.push(
        (
          clamp(w.0 + (ex - def.pos.0) + (random() - 0.5) * 50.0, -430.0, 430.0),
          clamp(w.1 + (ez - def.pos.1) + (random() - 0.5) * 50.0, -430.0, 430.0),
        ),
      )
    }
    let personality = match def.personality {
      Some(ps) => ps
      None => ""
    }
    let ai = ai_new(t, personality, patrol, def.hold)
    let _ = ai
    t.ai.unwrap().flank_slot = flank_slot
    self.tanks.set(t.net_id, t)
    self.env_t_tanks.push(t)
    spawned.push((t.net_id, typ))
    self.total_spawned += 1
  }
  (self.dispatch)(AiWave(spawned))
  match self.world_ref {
    Some(w) => {
      let enemies : Array[Tank] = []
      for t in self.tanks.values() {
        if t.net_id >= 100 {
          enemies.push(t)
        }
      }
      w.enemies = enemies
    }
    None => ()
  }
}

///|
/// spawnPtOk 的房内绑定版(create 闭包; spawnWaveCoop 用)
fn Room::spawn_pt_ok(self : Room, x : Double, z : Double) -> Bool {
  let spawn_g = v8_tan_max_slope * 0.96
  let t_terrain = self.terrain
  if t_terrain.grad_at(x, z) > spawn_g {
    return false
  }
  let h_c = t_terrain.height_at(x, z)
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

///|
/// repairWaves 参数读取(opts.repairWaves || 缺省 {duration:12, hpRatio:0.35};
/// 本链 create 恒显式传值, 缺省分支为 JS 字面直译保留)
fn Room::repair_dur(self : Room) -> Double {
  if self.coop && self.repair_duration_x >= 0.0 {
    self.repair_duration_x
  } else {
    12.0
  }
}

///|
fn Room::repair_rat(self : Room) -> Double {
  if self.coop && self.repair_ratio_x >= 0.0 {
    self.repair_ratio_x
  } else {
    0.35
  }
}

///|
/// checkWaveCoop (srv-sim.js:356-376): 波间维修倒计→下一波 / 全清 → finish(true)。
/// 已知缺陷②: tick() 与本函数各扣一次 repairT(实际窗=duration/2)。
fn Room::check_wave_coop(self : Room, dt : Double) -> Unit {
  if self.finished {
    return
  }
  let mut any_alive = false
  for t in self.tanks.values() {
    if t.net_id >= 100 && t.alive {
      any_alive = true
      break
    }
  }
  if any_alive {
    return
  }
  if self.wave_idx + 1 < self.waves.length() {
    if not(self.repair_done) {
      self.repair_done = true
      self.repair_t = self.repair_dur()
      let ratio = self.repair_rat()
      for h in self.humans {
        if h.alive {
          let heal = js_round(h.spec.hp * ratio)
          h.hp = h.spec.hp.min(h.hp + heal)
          h.mod_track = 0.0
          h.mod_engine = 0.0
          h.mod_gun = 0.0
          h.mod_ammo = 0.0
        }
      }
    }
    if self.repair_t > 0.0 {
      self.repair_t = 0.0.max(self.repair_t - dt)
      return
    }
    self.wave_idx += 1
    self.repair_done = false
    self.spawn_wave_coop(self.wave_idx)
  } else {
    self.finish(true)
  }
}

///|
/// pkAttach (srv-sim.js:383-386): spec 深拷贝(_pkBase)与增益表(_buffs)懒建
fn pk_attach(t : Tank) -> Unit {
  match t.pk_base {
    None => t.pk_base = Some(spec_deep_copy(t.spec))
    Some(_) => ()
  }
  match t.buffs {
    None => t.buffs = Some({ val: [], })
    Some(_) => ()
  }
}

///|
/// pkRecompute (srv-sim.js:387-402): 从 _pkBase 重算 spec 增益(JS 原地改写共享 spec)
fn pk_recompute(t : Tank) -> Unit {
  let b = match t.pk_base {
    Some(b) => b
    None => return
  }
  let e = pickups_cfg
  fn lv(k : String) -> Int {
    match t.buffs {
      None => 0
      Some(arr) => {
        let mut found = 0
        for kv in arr.val {
          if kv.0 == k {
            found = kv.1.lv
            break
          }
        }
        found
      }
    }
  }
  t.spec.max_speed = b.max_speed * v8_pow(e.eff_speed_max_speed, lv("speed"))
  t.spec.accel = b.accel * v8_pow(e.eff_speed_accel, lv("speed"))
  t.spec.hull_traverse = b.hull_traverse *
    v8_pow(e.eff_mobility_traverse, lv("mobility"))
  t.spec.turret_traverse = b.turret_traverse *
    v8_pow(e.eff_mobility_traverse, lv("mobility"))
  t.spec.dispersion.aim_time = b.dispersion.aim_time *
    v8_pow(e.eff_aim_aim_time, lv("aim"))
  t.spec.dispersion.base = b.dispersion.base * v8_pow(e.eff_aim_base, lv("aim"))
  t.spec.gun.reload = b.gun.reload * v8_pow(e.eff_load_reload, lv("load"))
  match (b.gun.autoloader, t.spec.gun.autoloader) {
    (Some(bal), Some(sal)) => {
      sal.intra = bal.intra * v8_pow(e.eff_load_reload, lv("load"))
      sal.long = bal.long * v8_pow(e.eff_load_reload, lv("load"))
    }
    _ => ()
  }
}

///|
/// pkApply (srv-sim.js:403-415): 拾取增益/维修
fn pk_apply(t : Tank, typ : String) -> Unit {
  if typ == "repair" {
    let heal = js_round(t.spec.hp * pickups_cfg.repair_heal)
    t.hp = t.spec.hp.min(t.hp + heal)
    t.mod_track = 0.0
    t.mod_engine = 0.0
    t.mod_gun = 0.0
    t.mod_ammo = 0.0
  } else {
    pk_attach(t)
    let arr = t.buffs.unwrap()
    // b = t._buffs[type] || (t._buffs[type] = { lv: 0, t: 0 })
    let mut slot : Buff? = None
    for kv in arr.val {
      if kv.0 == typ {
        slot = Some(kv.1)
        break
      }
    }
    let b = match slot {
      Some(b) => b
      None => {
        let nb : Buff = { lv: 0, t: 0.0, }
        arr.val.push((typ, nb))
        nb
      }
    }
    b.lv = pickups_cfg.max_stack.min(b.lv + 1)
    b.t = pickups_cfg.buff_dur
    pk_recompute(t)
  }
}

///|
/// pkPickType (srv-sim.js:416-425): 需求感知权重抽取(1 骰)
fn pk_pick_type(t : Tank) -> String {
  let w = pk_weights_copy()
  let hurt = t.hp < t.spec.hp * 0.5 ||
    t.mod_engine > 0.0 ||
    t.mod_gun > 0.0 ||
    t.mod_ammo > 0.0
  if hurt {
    w_mul(w, "repair", pickups_cfg.need_repair_mul)
  } else if t.hp >= t.spec.hp - 0.5 && t.mod_track == 0.0 {
    w_mul(w, "repair", pickups_cfg.full_hp_mul)
  }
  let mut sum = 0.0
  for kv in w {
    sum += kv.1
  }
  let mut r = random() * sum
  for kv in w {
    r -= kv.1
    if r <= 0.0 {
      return kv.0
    }
  }
  "speed"
}

///|
fn w_mul(w : Array[(String, Double)], k : String, m : Double) -> Unit {
  for i, kv in w {
    if kv.0 == k {
      w[i] = (kv.0, kv.1 * m)
      return
    }
  }
}

///|
/// pkDropPoint (srv-sim.js:426-439): 落点环绕玩家距离环(24 试, 每试 2 骰)
fn Room::pk_drop_point(self : Room, tank : Tank) -> (Double, Double)? {
  let r0 = pickups_cfg.spawn_ring_lo
  let r1 = pickups_cfg.spawn_ring_hi
  let lim = v8_tan_max_slope * 0.96
  for k in 0..<24 {
    let a = random() * @math.PI * 2.0
    let r = r0 + random() * (r1 - r0)
    let mut x = clamp(
      tank.x + v8_sin(a) * r,
      -self.terrain.half + 20.0,
      self.terrain.half - 20.0,
    )
    let mut z = clamp(
      tank.z + v8_cos(a) * r,
      -self.terrain.half + 20.0,
      self.terrain.half - 20.0,
    )
    if self.terrain.grad_at(x, z) > lim {
      continue
    }
    let pushed = circle_collide(self.covers_list, x, z, 2.4)
    x = pushed.0
    z = pushed.1
    if self.terrain.grad_at(x, z) > lim {
      continue
    }
    return Some((x, z))
  }
  None
}

///|
/// tickPickups (srv-sim.js:440-469): 空投投放节奏/下落/存活/拾取
fn Room::tick_pickups(self : Room, dt : Double) -> Unit {
  let alive_humans : Array[Tank] = []
  for t in self.humans {
    if t.alive {
      alive_humans.push(t)
    }
  }
  self.pk_spawn_t -= dt
  if self.pk_spawn_t <= 0.0 {
    if self.pk_list.length() < pickups_cfg.max_on_field &&
      alive_humans.length() > 0 {
      let tank = alive_humans[(random() * alive_humans.length().to_double()).to_int()]
      match self.pk_drop_point(tank) {
        Some(pt) => {
          self.pk_list.push({
            id: self.pk_seq,
            typ: pk_pick_type(tank),
            x: pt.0,
            z: pt.1,
            landed: false,
            fall_y: pickups_cfg.drop_dist,
            life: pickups_cfg.lifetime,
          })
          self.pk_seq += 1
        }
        None => ()
      }
    }
    self.pk_spawn_t = pickups_cfg.interval_lo +
      random() * (pickups_cfg.interval_hi - pickups_cfg.interval_lo)
  }
  let mut i = self.pk_list.length() - 1
  while i >= 0 {
    let p = self.pk_list[i]
    if not(p.landed) {
      p.fall_y -= pickups_cfg.fall_speed * dt
      if p.fall_y <= 0.0 {
        p.landed = true
        p.fall_y = 0.0
      }
      i -= 1
      continue
    }
    p.life -= dt
    if p.life <= 0.0 {
      ignore(self.pk_list.remove(i))
      i -= 1
      continue
    }
    let mut taken = false
    for t in alive_humans {
      // (t.cr || 1.5): srv-sim makeTank 不设 cr → 恒 1.5
      if @math.hypot(t.x - p.x, t.z - p.z) <
        pickups_cfg.radius + t.cr.unwrap_or(1.5) {
        pk_apply(t, p.typ)
        (self.dispatch)(PkGet(p.id, t.net_id, p.typ))
        ignore(self.pk_list.remove(i))
        taken = true
        break
      }
    }
    let _ = taken
    i -= 1
  }
}

///|
/// finish (srv-sim.js:565-570)
fn Room::finish(self : Room, win : Bool) -> Unit {
  if self.finished {
    return
  }
  self.finished = true
  self.win = win
  (self.on_end)(self.score_rows())
}

///|
/// scoreRows (srv-sim.js:541-545): 插入序构建 + 击杀降序稳定排序
pub fn Room::score_rows(self : Room) -> Array[(Int, String, Int)] {
  let rows : Array[(Int, String, Int)] = []
  for kv in self.scores {
    let name = match self.tanks.get(kv.0) {
      Some(t) => t.name
      None => "?" + kv.0.to_string()
    }
    rows.push((kv.0, name, kv.1))
  }
  // .sort((a, b) => b[2] - a[2])(V8 稳定; 插入排序保稳)
  let mut i = 1
  while i < rows.length() {
    let key = rows[i]
    let mut j = i - 1
    while j >= 0 && rows[j].2 < key.2 {
      rows[j + 1] = rows[j]
      j -= 1
    }
    rows[j + 1] = key
    i += 1
  }
  rows
}

///|
/// 快照(srv-sim.js:517-540 snapshot)
pub(all) struct Snap {
  st : Int
  tn : Map[Int, Array[Double]] // 14 字段行
  sc : Map[Int, Int]
  mut wv : (Int, Int, String, Int, Int)? // coop: [waveIdx, 波总数, 波名, 人类击杀, 累计刷出]
  dt_map : Map[Int, Int] // coop: 被锁定表
  mut rp : Int? // coop: Math.ceil(repairT)(无则缺省)
  pk : Array[(Int, Int, Double, Double)] // coop: [id, typeIdx, x, z]
}

///|
/// Room::snapshot (srv-sim.js:517-540)
pub fn Room::snapshot(self : Room) -> Snap {
  let tn : Map[Int, Array[Double]] = Map::new()
  for e in self.tanks.entries {
    let t = e.1
    // 14 字段行(路尾追加 bodyPitch/bodyRoll, 前 12 与 main.js hostSnapshot 同构)
    let row : Array[Double] = [
      to_fixed(t.x, 1),
      to_fixed(t.z, 1),
      to_fixed(t.y, 1),
      to_fixed(t.yaw, 2),
      to_fixed(t.turret_yaw, 2),
      to_fixed(t.gun_pitch, 2),
      to_fixed(t.speed, 1),
      js_round(t.hp),
      if t.alive {
        1.0
      } else {
        0.0
      },
      to_fixed(t.reload_t, 1),
      to_fixed(t.reload_total, 1),
      t.clip_left.to_double(), // clipLeft | 0
      to_fixed(t.pitch, 3),
      to_fixed(t.roll, 3),
    ]
    tn[e.0] = row
  }
  let sc : Map[Int, Int] = Map::new()
  for kv in self.scores {
    sc[kv.0] = kv.1
  }
  let snap : Snap = {
    st: 0.0.max(js_round(self.time_left)).to_int(),
    tn,
    sc,
    wv: None,
    dt_map: Map::new(),
    rp: None,
    pk: [],
  }
  if self.coop {
    // coop 四字段(main.js hostSnapshot 同构)
    let mut wave_name = ""
    if self.wave_idx < self.waves.length() {
      wave_name = self.waves[self.wave_idx].name
    }
    let mut human_kills = 0
    for kv in self.scores {
      if kv.0 < 100 {
        human_kills += kv.1
      }
    }
    snap.wv = Some(
      (
        self.wave_idx,
        self.waves.length(),
        wave_name,
        human_kills,
        self.total_spawned,
      ),
    )
    for t in self.tanks.values() {
      if t.net_id >= 100 && t.alive {
        match t.ai {
          Some(ai) =>
            if ai.seen_now {
              let tid = ai.last_target_id
              if tid != 0 {
                for h in self.humans {
                  if h.net_id == tid {
                    snap.dt_map[tid] = 1
                    break
                  }
                }
              }
            }
          None => ()
        }
      }
    }
    if self.repair_t > 0.0 {
      snap.rp = Some(self.repair_t.ceil().to_int())
    }
    for p in self.pk_list {
      if p.landed {
        snap.pk.push(
          (p.id, pk_idx_of(p.typ), to_fixed(p.x, 1), to_fixed(p.z, 1)),
        )
      }
    }
  }
  snap
}

///|
/// setInput (srv-sim.js:477-481): 首条 input = coop 客户端就绪信号(触发第 0 波)
pub fn Room::set_input(self : Room, id : Int, i : RawInput) -> Unit {
  match self.tanks.get(id) {
    Some(t) => t.input = clamp_input(t, i)
    None => ()
  }
  if self.coop && not(self.wave_started) {
    self.wave_started = true
    if self.waves.length() > 0 {
      self.spawn_wave_coop(0)
    }
  }
}

///|
/// tick (srv-sim.js:482-516): 60Hz 权威步
pub fn Room::tick(self : Room, dt : Double) -> Unit {
  if self.finished {
    return
  }
  self.time.val += dt
  if not(self.coop) {
    self.time_left = 0.0.max(self.time_left - dt) // coop 时限不走(缺陷③: JS 同款保持)
  }
  for t in self.tanks.values() {
    if not(t.alive) {
      continue
    }
    // coop AI 直读本实例世界
    let inp : Input = if self.coop && t.net_id >= 100 && t.ai is Some(_) {
      t.ai.unwrap().update(dt, self.world_ref.unwrap())
    } else {
      t.input
    }
    let env : TankEnv = {
      terrain: self.terrain,
      covers_list: self.covers_list,
      tanks: self.env_t_tanks,
      time: self.time.val,
      emit: self.dispatch,
      take_ram: fn(target, shooter, dmg) {
        self.judge.take_ram(target, shooter, dmg)
      },
    }
    update_tank(t, inp, dt, env)
    if inp.fire {
      let _ = fire(t, self.shells, muzzle_of(t), aim_dir_of(t), self.dispatch)
    }
  }
  self.shells.update(
    dt,
    fn(x : Double, z : Double) { self.terrain.height_at(x, z) },
    self.covers_list,
    self.env_t_tanks,
    None, // envT.playerPos = null
    -9, // envT.playerTeam = -9
  )
  if not(self.coop) {
    // 死斗重生队列(main.js:1287 同参 5s)
    for r in self.respawn {
      r.t -= dt
    }
    for r in self.respawn {
      if r.t <= 0.0 && not(r.tk.alive) {
        self.rebuild(r.tk)
      }
    }
    let mut i = self.respawn.length() - 1
    while i >= 0 {
      if self.respawn[i].t <= 0.0 {
        ignore(self.respawn.remove(i))
      }
      i -= 1
    }
    if self.time_left <= 0.0 {
      self.finish(false)
    }
  } else {
    // coop: 波间维修倒计→下一波; 全员阵亡宽限 2.5s → 失败结算(main.js loseT 同参)
    if not(self.wave_started) {
      if self.time.val > 8.0 {
        self.wave_started = true
        if self.waves.length() > 0 {
          self.spawn_wave_coop(0)
        }
      }
    } else {
      // 已知缺陷②: 本块与 checkWaveCoop 各扣一次 repairT(实际窗=duration/2)
      if self.repair_done && self.repair_t > 0.0 {
        self.repair_t = 0.0.max(self.repair_t - dt)
        if self.repair_t == 0.0 {
          self.repair_done = false
          self.wave_idx += 1
          self.spawn_wave_coop(self.wave_idx)
        }
      }
      self.check_wave_coop(dt)
    }
    self.tick_pickups(dt)
    // 增益到期(JS for..in 逐键: t -= dt, ≤0 删除并重算)
    for h in self.humans {
      match h.buffs {
        Some(arr) => {
          let keys : Array[String] = []
          for kv in arr.val {
            keys.push(kv.0)
          }
          for k in keys {
            let mut removed = false
            for idx, kv in arr.val {
              if kv.0 == k {
                kv.1.t -= dt
                if kv.1.t <= 0.0 {
                  ignore(arr.val.remove(idx))
                  removed = true
                }
                break
              }
            }
            if removed {
              pk_recompute(h)
            }
          }
        }
        None => ()
      }
    }
    if self.lose_t > 0.0 {
      self.lose_t -= dt
      if self.lose_t <= 0.0 {
        self.finish(false)
      }
    } else {
      let mut any_alive = false
      for h in self.humans {
        if h.alive {
          any_alive = true
          break
        }
      }
      if not(any_alive) {
        self.lose_t = 2.5
      } else {
        self.lose_t = -1.0
      }
    }
  }
}

///|
/// forceEnd (srv-sim.js:546): finish()(win 缺省 → !!undefined = false)
pub fn Room::force_end(self : Room) -> Unit {
  self.finish(false)
}

///|
/// testFire (srv-sim.js:549-563): 测试钩子 —— 命令 fromId 坦克向 atId 开一炮(走真实引擎开炮)
pub fn Room::test_fire(self : Room, from_id : Int, at_id : Int) -> Bool {
  let from = self.tanks.get(from_id)
  let at = self.tanks.get(at_id)
  let ok = match (from, at) {
    (Some(f), Some(_)) => f.alive
    _ => false
  }
  if not(ok) {
    return false // JS 返回 'no-tank'(真值), 驱动只判 === true
  }
  let f = from.unwrap()
  let a = at.unwrap()
  f.reload_t = 0.0 // 调试钩子: 忽略 AI 装填周期
  // 移至目标 25m 处点射(确定性)
  let d_x0 = f.x - a.x
  let d_z0 = f.z - a.z
  let d_l = 1.0.max(@math.hypot(d_x0, d_z0))
  f.x = a.x + d_x0 / d_l * 25.0
  f.z = a.z + d_z0 / d_l * 25.0
  f.y = self.terrain.height_at(f.x, f.z)
  let d_x = a.x - f.x
  let d_y = a.y + 1.2 - (f.y + 2.1)
  let d_z = a.z - f.z
  // JS Math.hypot 三参(小值域, sqrt 同式)
  let dist = 1.0.max((d_x * d_x + d_y * d_y + d_z * d_z).sqrt())
  let pitch = v8_asin((d_y / dist).min(1.0).max(-1.0))
  f.turret_yaw = v8_atan2(d_x, d_z)
  f.gun_pitch = pitch
  fire(f, self.shells, muzzle_of(f), aim_dir_of(f), self.dispatch)
}
