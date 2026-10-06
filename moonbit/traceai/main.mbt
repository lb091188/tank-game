// traceai main: tools/golden-trace2.js runAi 场景 harness 的直译(读夹具重放, 比对输出同 tracecheck)。
// 判定: snapshot 条数一致 + ev 计数/车辆字段/AI 决策字段逐项比对(|mine-golden|<=1.0e-6 或全等)
// + events 全量流水一致; 任一超差 → 打印首个 mismatch 退出 1。

///|
extern "C" fn c_exit(code : Int) -> Unit = "exit"

///|
fn die(msg : String) -> Unit {
  println(msg)
  c_exit(1)
}

///|
async fn read_file_string(path : String) -> String {
  let size = @fs.file_size(path)
  let f = @fs.open(path, mode=ReadOnly)
  let raw = f.read_exactly_at(size.to_int(), position=0)
  f.close()
  @utf8.decode(raw)
}

///|
fn get(j : Json, key : String) -> Json raise {
  match j {
    Object(m) =>
      match m.get(key) {
        Some(v) => v
        None => fail("fixture 缺字段: \{key}")
      }
    _ => fail("fixture 期望 object")
  }
}

///|
fn get_num(j : Json, key : String) -> Double raise {
  match get(j, key) {
    Number(d, ..) => d
    _ => fail("字段 \{key} 期望数值")
  }
}

///|
fn get_int(j : Json, key : String) -> Int raise {
  get_num(j, key).to_int()
}

///|
fn get_str(j : Json, key : String) -> String raise {
  match get(j, key) {
    String(s) => s
    _ => fail("字段 \{key} 期望字符串")
  }
}

///|
fn get_array(j : Json, key : String) -> Array[Json] raise {
  match get(j, key) {
    Array(a) => a
    _ => fail("字段 \{key} 期望数组")
  }
}

///|
fn cover_opt_num(c : Json, key : String) -> Double? raise {
  match c {
    Object(m) =>
      match m.get(key) {
        Some(Number(d, ..)) => Some(d)
        Some(_) => fail("covers[].\{key} 期望数值")
        None => None
      }
    _ => fail("covers 条目期望 object")
  }
}

///|
fn build_heights(inputs : Json, res : Int) -> FixedArray[Float] raise {
  let b64 = get_str(inputs, "heights_u16_le_b64")
  let raw = @base64.decode(b64) catch {
    _ => fail("base64 解码失败: Malformed")
  }
  let n = res * res
  if raw.length() < n * 2 {
    die("heights 字节数 \{raw.length()} < 2*res*res=\{n * 2}")
  }
  let u16 : FixedArray[UInt] = FixedArray::make(n, 0U)
  for i in 0..<n {
    u16[i] = (raw[2 * i].to_int() + raw[2 * i + 1].to_int() * 256).reinterpret_as_uint()
  }
  let max_height = get_num(get(inputs, "terrain_cfg"), "maxHeight")
  @simcore.heights_from_u16(u16, max_height)
}

///|
fn build_covers(inputs : Json) -> @simcore.CoverList raise {
  let raws = get_array(inputs, "covers_raw")
  let items : Array[@simcore.Cover] = []
  for c in raws {
    items.push(
      @simcore.cover_col({
        typ: get_str(c, "type"),
        x: get_num(c, "x"),
        z: get_num(c, "z"),
        yaw: cover_opt_num(c, "yaw"),
        scale: cover_opt_num(c, "scale"),
      }),
    )
  }
  { items, bushes: None, }
}

// --- 事件流水(emit 的 Harness 收集侧; golden-trace2.js runAi emit 直译) ---

///|
/// 事件条目(与夹具 events 数组逐字段对应)
priv enum Ev {
  EvFire(Double, Int, Double, Double, Double, Double, Double, Double) // [t, netId, px,py,pz, dx,dy,dz]
  EvRam(Double, Int, Int, Int) // [t, shooter, target, dmg]
  EvDestroyed(Double, Int, Int) // [t, netId, shooter(-1 无)]
  EvHit(Double, Int, Int, String, String, Int, String, Double, Double, Double) // [t, shooter, target, kind, zone, dmg, module, px,py,pz]
}

///|
/// 场景计数与事件流水(ev 累计对象 + log)
struct Harness {
  ctx : @ai.Ctx
  mut fire : Int
  mut hit : Int
  mut destroyed : Int
  mut ram : Int
  mut shell_spawn : Int
  mut shell_hit_tank : Int
  log : Array[Ev]
}

///|
/// 场景 emit(golden-trace2.js runAi emit 直译; 'reloaded' 该 emit 不消费, 静默)
fn harness_emit(h : Harness, ev : String, data : @ai.EvtData) -> Unit {
  match ev {
    "fire" =>
      match data {
        @ai.FireEv(tank, pos, dir) => {
          h.fire += 1
          h.log.push(
            EvFire(
              h.ctx.game_time,
              tank.net_id,
              pos.x,
              pos.y,
              pos.z,
              dir.x,
              dir.y,
              dir.z,
            ),
          )
        }
        _ => ()
      }
    "ram" =>
      match data {
        @ai.RamEv(shooter, target, dmg) => {
          h.ram += 1
          h.hit += 1
          h.log.push(EvRam(h.ctx.game_time, shooter.net_id, target.net_id, dmg))
        }
        _ => ()
      }
    "destroyed" =>
      match data {
        @ai.DestroyedEv(tank, shooter) => {
          h.destroyed += 1
          let sid = match shooter {
            Some(s) => s.net_id
            None => -1
          }
          h.log.push(EvDestroyed(h.ctx.game_time, tank.net_id, sid))
        }
        _ => ()
      }
    "hit" =>
      match data {
        @ai.HitEv(shooter, target, kind, zone, dmg, mod_s, point) => {
          h.hit += 1
          let sid = match shooter {
            Some(s) => s.net_id
            None => -1
          }
          let m = match mod_s {
            Some(s) => s
            None => ""
          }
          h.log.push(
            EvHit(
              h.ctx.game_time,
              sid,
              target.net_id,
              kind,
              zone,
              dmg,
              m,
              point.x,
              point.y,
              point.z,
            ),
          )
        }
        _ => ()
      }
    _ => ()
  }
}

///|
/// settleHit(golden-trace2.js:421-453; srv-sim.js makeJudge.onHitTank 同款, 掷骰次序:
/// pen → [tracks: dmg] / [dmg → ammo → hullRear-engine])
fn settle_hit(
  h : Harness,
  sh : @ai.Shell,
  tk : @ai.Tank,
  hit : @ai.Hit,
  seg_dir : @ai.Dir,
) -> Unit {
  let ctx = h.ctx
  if !tk.alive {
    return
  }

  h.shell_hit_tank += 1
  let armor_cfg = ctx.cfg.armor
  let incidence = @math.acos(
    1.0.min(
      (-1.0).max(
        -(hit.normal.x * seg_dir.x +
        hit.normal.y * seg_dir.y +
        hit.normal.z * seg_dir.z),
      ),
    ),
  )
  let armor = js_orv(hit.armor, 0.0)
  let cal = sh.cal
  let over3 = armor > 0.0 && cal > armor * 3.0
  let mut norm = 5.0 * @math.PI / 180.0
  if armor > 0.0 && cal > armor * 2.0 {
    norm *= 2.0
  }
  let eff = armor / @math.cos(0.0.max(incidence - norm)).max(0.05)
  let pen = sh.pen * (1.0 + (ctx.rand() * 2.0 - 1.0) * armor_cfg.pen_variance)
  let rico = armor > 0.0 && !over3 && incidence > armor_cfg.ricochet_angle
  let mut kind = "nopen"
  let mut mod_s : String? = None
  let mut dmg = 0
  sh.owner.stats_hits += 1
  if hit.zone == "gun" {
    tk.mod_gun = @ai.INF
    kind = "gun"
    mod_s = Some("gun")
  } else if hit.zone == "tracks" {
    tk.mod_track = armor_cfg.track_duration
    mod_s = Some("track")
    if rico {
      kind = "bounce"
    } else if pen >= eff {
      kind = "pen"
      dmg = js_round(
        sh.dmg * (1.0 + (ctx.rand() * 2.0 - 1.0) * armor_cfg.dmg_variance),
      ).to_int()
    } else {
      kind = "absorb"
    }
  } else if rico {
    kind = "bounce"
  } else if pen >= eff {
    kind = "pen"
    let mut dmg_d = sh.dmg *
      (1.0 + (ctx.rand() * 2.0 - 1.0) * armor_cfg.dmg_variance)
    if ctx.rand() < armor_cfg.ammo_chance {
      dmg_d *= armor_cfg.ammo_dmg_mult
      mod_s = Some("ammo")
      tk.mod_ammo = @ai.INF
    } else if hit.zone == "hullRear" &&
      ctx.rand() < armor_cfg.engine_rear_chance {
      mod_s = Some("engine")
      tk.mod_engine = @ai.INF
    }
    dmg = js_round(dmg_d).to_int()
  }
  if kind == "pen" {
    tk.hp -= dmg.to_double()
    sh.owner.stats_pens += 1
    sh.owner.stats_dmg_dealt += dmg
  }
  if tk.hp <= 0.0 && tk.alive {
    tk.hp = 0.0
    tk.alive = false
    harness_emit(h, "destroyed", @ai.DestroyedEv(tk, Some(sh.owner)))
  }
  harness_emit(
    h,
    "hit",
    @ai.HitEv(Some(sh.owner), tk, kind, hit.zone, dmg, mod_s, {
      x: hit.point.x,
      y: hit.point.y,
      z: hit.point.z,
    }),
  )
}

///|
/// js_round(traceai 本地; Math.round = floor(x+0.5))
fn js_round(v : Double) -> Double {
  (v + 0.5).floor()
}

///|
fn js_orv(v : Double, default : Double) -> Double {
  if v == 0.0 || v.is_nan() {
    default
  } else {
    v
  }
}

///|
/// 比对助手(同 tracecheck 口径)
fn check_num(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Double,
  actual : Double,
) -> Unit {
  let diff = (actual - expected).abs()
  if diff > 1.0e-6 {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual} diff=\{diff}",
    )
  }
}

///|
fn check_b01(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Int,
  actual : Bool,
) -> Unit {
  let a = if actual { 1 } else { 0 }
  if a != expected {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{a}",
    )
  }
}

///|
fn check_int(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Int,
  actual : Int,
) -> Unit {
  if expected != actual {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual}",
    )
  }
}

///|
fn check_str(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : String,
  actual : String,
) -> Unit {
  if expected != actual {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual}",
    )
  }
}

///|
/// mod 字段比对: 夹具 -1 = Infinity 毁伤哨兵(SPEC §2)
fn check_mod(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Double,
  actual : Double,
) -> Unit {
  if expected == -1.0 {
    if !actual.is_inf() {
      die(
        "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=Infinity(-1 哨兵) actual=\{actual}",
      )
    }
  } else {
    check_num(fixture, idx, k, field, expected, actual)
  }
}

///|
/// lastSeenAge: 夹具 -1 = lastSeen 为 null; 否则 W.time - lastSeen.t
fn check_age(
  fixture : String,
  idx : Int,
  k : Int,
  expected : Double,
  actual : Double?,
) -> Unit {
  if expected == -1.0 {
    if actual is Some(_) {
      die(
        "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=ai.lastSeenAge expected=-1(null) actual=\{actual.unwrap()}",
      )
    }
  } else {
    match actual {
      None =>
        die(
          "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=ai.lastSeenAge expected=\{expected} actual=-1(null)",
        )
      Some(a) => check_num(fixture, idx, k, "ai.lastSeenAge", expected, a)
    }
  }
}

///|
/// 无头炮口位姿(golden-trace2.js:175-179)
fn muzzle_of(t : @ai.Tank) -> @ai.Pos {
  {
    x: t.x + @math.sin(t.yaw) * 2.0,
    y: t.y + 2.1,
    z: t.z + @math.cos(t.yaw) * 2.0,
  }
}

///|
fn aim_dir_of(t : @ai.Tank) -> @ai.Dir {
  let cp = @math.cos(t.gun_pitch)
  {
    x: @math.sin(t.turret_yaw) * cp,
    y: @math.sin(t.gun_pitch),
    z: @math.cos(t.turret_yaw) * cp,
  }
}

///|
/// 重放并比对; 全过打印 "TRACE OK ai N/N" 并退出 0
async fn run(fixture : String, path : String) -> Unit {
  let s = read_file_string(path)
  let root = @json.parse(s)
  let meta = get(root, "meta")
  let inputs = get(meta, "inputs")
  let tcfg = get(inputs, "terrain_cfg")
  let size = get_num(tcfg, "size")
  let res = get_int(tcfg, "resolution")
  let seed = get_int(meta, "seed")
  let ticks_total = get_int(meta, "ticks")
  let every = get_int(meta, "sampleEvery")
  let ctx = @ai.Ctx::new(seed)
  let heights = build_heights(inputs, res)
  let terrain = @simcore.make_terrain(heights, size, res)
  let covers = build_covers(inputs)
  let h : Harness = {
    ctx,
    fire: 0,
    hit: 0,
    destroyed: 0,
    ram: 0,
    shell_spawn: 0,
    shell_hit_tank: 0,
    log: [],
  }
  // SPEC §4: 构造任何内核对象之前初始化 RNG(Ctx::new 已按 seed 建) —— 消费流从
  // AI 构造函数第一颗骰起算(与 boot() 装载后第一次掷骰一致)。
  // 双 pz4 对抗(A=sniper netId=1 id=11, B=flanker netId=2 id=12)
  let spec = @ai.spec_pz4()
  let a = @ai.mk_tank(
    ctx,
    spec,
    "pz4",
    x=-380.0,
    z=-380.0,
    yaw=0.0,
    team=0,
    net_id=1,
    id=11,
  )
  let b = @ai.mk_tank(
    ctx,
    spec,
    "pz4",
    x=-330.0,
    z=-380.0,
    yaw=@math.PI,
    team=1,
    net_id=2,
    id=12,
  )
  let ai_a = @ai.Ai::new(ctx, a, "sniper", [(-380.0, -380.0)])
  let ai_b = @ai.Ai::new(ctx, b, "flanker", [(-330.0, -380.0)])
  a.ai = Some(ai_a)
  b.ai = Some(ai_b)
  // 主世界 W 与两个对抗视图 WA/WB(JS Object.assign 口径: terrain/covers 引用共享,
  // intel 初始为各视图独立对象 {x:0,z:0,t:-99,level:0}, perceive 时按视图整体替换)
  let w : @ai.World = {
    time: 0.0,
    terrain,
    terrain_uid: 0,
    covers,
    intel: { x: 0.0, z: 0.0, t: -99.0, level: 0, },
    enemies: [],
    player: None,
    mp_targets: [],
    focus: None,
    focus_prev: None,
    team_memo: None,
    hill_plan: None,
  }
  let wa : @ai.World = {
    time: 0.0,
    terrain,
    terrain_uid: 0,
    covers,
    intel: { x: 0.0, z: 0.0, t: -99.0, level: 0, },
    enemies: [a],
    player: Some(b),
    mp_targets: [b],
    focus: None,
    focus_prev: None,
    team_memo: None,
    hill_plan: None,
  }
  let wb : @ai.World = {
    time: 0.0,
    terrain,
    terrain_uid: 0,
    covers,
    intel: { x: 0.0, z: 0.0, t: -99.0, level: 0, },
    enemies: [b],
    player: Some(a),
    mp_targets: [a],
    focus: None,
    focus_prev: None,
    team_memo: None,
    hill_plan: None,
  }
  ctx.game_world = Some(w)
  // 弹场 hooks(与工具同构: probeTankOBB + settleHit + onHurt 被打感知)
  let pz4_boxes = @ai.part_boxes_pz4()
  let shells = @ai.make_shells({
    on_create: fn(_sh) { h.shell_spawn += 1 },
    on_flight: fn(_sh) { () },
    on_impact: fn(_kind, _p) { () },
    on_player_miss: fn(_p) { () },
    on_near_miss: fn(_sh) { () },
    on_kill: fn(_sh) { () },
    probe_tank: fn(_sh, tk, ox, oy, oz, dx, dy, dz, seg_len) {
      @ai.probe_tank_obb(tk, Some(pz4_boxes), ox, oy, oz, dx, dy, dz, seg_len)
    },
    on_hit_tank: fn(sh, tk, hit, seg_dir) {
      settle_hit(h, sh, tk, hit, seg_dir)
      // 被打感知(ai.js:605)
      match tk.ai {
        Some(tka) =>
          if tk.alive && sh.owner.team != tk.team {
            tka.on_hurt(sh.owner)
          }
        None => ()
      }
    },
    on_explode: fn(_sh, _p, _tk, _armor) { () },
  })
  // 死斗重生队列(SF.Bus.on('destroyed'); 本场景 emit 不走 Bus, 队列恒空 —— 夹具同构)
  let respawn : Array[@ai.RespawnItem] = []
  ctx.bus.on("destroyed", fn(e) {
    match e {
      @ai.Destroyed(tank) => respawn.push({ t: 5.0, tk: tank, })
      _ => ()
    }
  })
  // env: updateTank 注入(golden-trace2.js envOf 直译)
  let tanks : Array[@ai.Tank] = [a, b]
  fn env_of(_tt : @ai.Tank) -> @ai.Env {
    {
      terrain,
      covers_list: covers,
      tanks,
      time: w.time,
      emit: fn(ev, data) { harness_emit(h, ev, data) },
      on_moved: fn(tk, d) {
        tk.track_offset = (tk.track_offset - tk.speed * d / 4.0) % 1.0
      },
      take_ram: fn(target, shooter, dmg) {
        if !target.alive || dmg <= 0 {
          return
        }
        target.hp -= dmg.to_double()
        harness_emit(h, "ram", @ai.RamEv(shooter, target, dmg))
        if target.hp <= 0.0 && target.alive {
          target.hp = 0.0
          target.alive = false
          harness_emit(h, "destroyed", @ai.DestroyedEv(target, Some(shooter)))
        }
        match target.ai {
          Some(ta) =>
            if target.alive && shooter.team != target.team {
              ta.on_hurt(shooter)
            }
          None => ()
        }
        harness_emit(
          h,
          "hit",
          @ai.HitEv(Some(shooter), target, "ram", "ram", dmg, None, {
            x: target.x,
            y: target.y + 1.0,
            z: target.z,
          }),
        )
      },
    }
  }

  let env_t : @ai.ShEnv = {
    height_at: fn(x, z) { terrain.height_at(x, z) },
    covers_blocked: fn(ox, oz, oy, dx, dz, len, dy) {
      @ai.w_covers_blocked(w, ox, oz, oy, dx, dz, len, dy)
    },
    tanks,
    player_pos: Some(a),
    player_team: 0,
  }
  let snaps = get_array(root, "snapshots")
  let n = snaps.length()
  let meta_n = get_int(meta, "snapshots")
  if n != meta_n {
    die(
      "TRACE MISMATCH \{fixture} snapshot 条数不符: meta.snapshots=\{meta_n} 实际数组=\{n}",
    )
  }
  let dt = 1.0 / 60.0
  let mut snap_idx = 0
  for k in 0..<ticks_total {
    w.time += dt
    wa.time = w.time
    wb.time = w.time
    h.ctx.game_time = w.time
    for t in tanks {
      if !t.alive {
        continue
      }
      let view = if t.net_id == 1 { wa } else { wb }
      let inp = t.ai.unwrap().update(dt, view)
      @ai.update_tank(ctx, t, inp, dt, env_of(t))
      if inp.fire {
        let _ = @ai.fire(ctx, t, shells, muzzle_of(t), aim_dir_of(t), fn(
          ev,
          data,
        ) {
          harness_emit(h, ev, data)
        })
      }
      // golden-trace2.js:563: lastFireT 断带记账
      if t.stats_shots > 0 && t.reload_t >= t.reload_total - dt {
        t.last_fire_t = w.time
      }
    }
    shells.update(dt, env_t)
    for r in respawn {
      r.t -= dt
    }
    for r in respawn {
      if r.t <= 0.0 && !r.tk.alive {
        // rebuild(golden-trace2.js:513-521; 本场景 destroy 不经 Bus, 恒不触)
        let home_x = if r.tk.team == 0 { -380.0 } else { -330.0 }
        let home_z = -380.0
        let home_yaw = if r.tk.team == 0 { 0.0 } else { @math.PI }
        r.tk.x = home_x
        r.tk.z = home_z
        r.tk.yaw = home_yaw
        r.tk.turret_yaw = home_yaw
        r.tk.gun_pitch = 0.0
        r.tk.speed = 0.0
        r.tk.gear = "D1"
        r.tk.shift_t = 0.0
        r.tk.flip_t = 0.0
        r.tk.pitch = 0.0
        r.tk.roll = 0.0
        r.tk.y = 0.0
        r.tk.y_init = false
        r.tk.fall_v = 0.0
        r.tk.hp = r.tk.spec.hp
        r.tk.alive = true
        r.tk.reload_t = 1.0
        r.tk.reload_total = 1.0
        r.tk.disp = r.tk.spec.dispersion.max
        r.tk.mod_track = 0.0
        r.tk.mod_engine = 0.0
        r.tk.mod_gun = 0.0
        r.tk.mod_ammo = 0.0
      }
    }
    let mut i = respawn.length() - 1
    while i >= 0 {
      if respawn[i].t <= 0.0 {
        let _ = respawn.remove(i)
      }
      i -= 1
    }
    if k % every == 0 {
      // 采样并与夹具 snapshot 逐字段比对
      if snap_idx >= n {
        die("TRACE MISMATCH \{fixture}: 我方快照数超出夹具(\{n})")
      }
      let snap = snaps[snap_idx]
      compare_snapshot(fixture, snap_idx, snap, w.time, h, a, b)
      snap_idx += 1
    }
  }
  if snap_idx != n {
    die(
      "TRACE MISMATCH \{fixture}: 快照条数不符 我方=\{snap_idx} 夹具=\{n}",
    )
  }
  compare_events(fixture, get_array(root, "events"), h.log)
  println("TRACE OK \{fixture} \{n}/\{n}")
  c_exit(0)
}

///|
/// 逐字段比对一条 snapshot(golden-trace2.js snapOne 字段集)
fn compare_snapshot(
  fixture : String,
  idx : Int,
  snap : Json,
  time : Double,
  h : Harness,
  a : @ai.Tank,
  b : @ai.Tank,
) -> Unit raise {
  let k = get_int(snap, "k")
  check_num(fixture, idx, k, "time", get_num(snap, "time"), time)
  // ev 累计计数
  let ev = get(snap, "ev")
  check_int(fixture, idx, k, "ev.fire", get_int(ev, "fire"), h.fire)
  check_int(fixture, idx, k, "ev.hit", get_int(ev, "hit"), h.hit)
  check_int(
    fixture,
    idx,
    k,
    "ev.destroyed",
    get_int(ev, "destroyed"),
    h.destroyed,
  )
  check_int(fixture, idx, k, "ev.ram", get_int(ev, "ram"), h.ram)
  check_int(
    fixture,
    idx,
    k,
    "ev.shellSpawn",
    get_int(ev, "shellSpawn"),
    h.shell_spawn,
  )
  check_int(
    fixture,
    idx,
    k,
    "ev.shellHitTank",
    get_int(ev, "shellHitTank"),
    h.shell_hit_tank,
  )
  let gtanks = get_array(snap, "tanks")
  if gtanks.length() != 2 {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tanks 条数 \{gtanks.length()}",
    )
  }
  compare_tank(fixture, idx, k, gtanks[0], a, h)
  compare_tank(fixture, idx, k, gtanks[1], b, h)
}

///|
fn compare_tank(
  fixture : String,
  idx : Int,
  k : Int,
  jt : Json,
  t : @ai.Tank,
  h : Harness,
) -> Unit raise {
  let tag = "tanks[id=\{t.net_id}]."
  check_int(fixture, idx, k, tag + "id", get_int(jt, "id"), t.net_id)
  check_str(fixture, idx, k, tag + "type", get_str(jt, "type"), t.typ)
  check_b01(fixture, idx, k, tag + "alive", get_int(jt, "alive"), t.alive)
  check_num(fixture, idx, k, tag + "x", get_num(jt, "x"), t.x)
  check_num(fixture, idx, k, tag + "y", get_num(jt, "y"), t.y)
  check_num(fixture, idx, k, tag + "z", get_num(jt, "z"), t.z)
  check_num(fixture, idx, k, tag + "yaw", get_num(jt, "yaw"), t.yaw)
  check_num(fixture, idx, k, tag + "pitch", get_num(jt, "pitch"), t.pitch)
  check_num(fixture, idx, k, tag + "roll", get_num(jt, "roll"), t.roll)
  check_num(fixture, idx, k, tag + "speed", get_num(jt, "speed"), t.speed)
  check_str(fixture, idx, k, tag + "gear", get_str(jt, "gear"), t.gear)
  check_num(
    fixture,
    idx,
    k,
    tag + "turretYaw",
    get_num(jt, "turretYaw"),
    t.turret_yaw,
  )
  check_num(
    fixture,
    idx,
    k,
    tag + "gunPitch",
    get_num(jt, "gunPitch"),
    t.gun_pitch,
  )
  check_num(fixture, idx, k, tag + "hp", get_num(jt, "hp"), t.hp)
  check_num(fixture, idx, k, tag + "disp", get_num(jt, "disp"), t.disp)
  check_num(
    fixture,
    idx,
    k,
    tag + "reloadT",
    get_num(jt, "reloadT"),
    t.reload_t,
  )
  let modj = get(jt, "mod")
  check_mod(
    fixture,
    idx,
    k,
    tag + "mod.track",
    get_num(modj, "track"),
    t.mod_track,
  )
  check_mod(
    fixture,
    idx,
    k,
    tag + "mod.engine",
    get_num(modj, "engine"),
    t.mod_engine,
  )
  check_mod(fixture, idx, k, tag + "mod.gun", get_num(modj, "gun"), t.mod_gun)
  check_mod(
    fixture,
    idx,
    k,
    tag + "mod.ammo",
    get_num(modj, "ammo"),
    t.mod_ammo,
  )
  check_int(fixture, idx, k, tag + "shots", get_int(jt, "shots"), t.stats_shots)
  check_int(fixture, idx, k, tag + "hits", get_int(jt, "hits"), t.stats_hits)
  check_int(fixture, idx, k, tag + "pens", get_int(jt, "pens"), t.stats_pens)
  check_int(
    fixture,
    idx,
    k,
    tag + "dmgDealt",
    get_int(jt, "dmgDealt"),
    t.stats_dmg_dealt,
  )
  let jai = get(jt, "ai")
  check_str(
    fixture,
    idx,
    k,
    tag + "ai.state",
    get_str(jai, "state"),
    t.ai.unwrap().state,
  )
  check_b01(
    fixture,
    idx,
    k,
    tag + "ai.seen",
    get_int(jai, "seen"),
    t.ai.unwrap().seen_now,
  )
  check_num(
    fixture,
    idx,
    k,
    tag + "ai.reactT",
    get_num(jai, "reactT"),
    t.ai.unwrap().react_t,
  )
  // lastSeenAge = 快照时刻(W.time) - lastSeen.t; -1 = lastSeen 为 null
  let age : Double? = match t.ai.unwrap().last_seen {
    Some(ls) => Some(h.ctx.game_time - ls.t)
    None => None
  }
  check_age(fixture, idx, k, get_num(jai, "lastSeenAge"), age)
  let jinp = get(jt, "inp")
  // golden-trace2.js snapOne 读的是 t.ai.input(AI 自持输入对象, 即喂给 updateTank 的同一份)
  let ainp = t.ai.unwrap().input
  check_num(
    fixture,
    idx,
    k,
    tag + "inp.throttle",
    get_num(jinp, "throttle"),
    ainp.throttle,
  )
  check_num(
    fixture,
    idx,
    k,
    tag + "inp.steer",
    get_num(jinp, "steer"),
    ainp.steer,
  )
  check_num(
    fixture,
    idx,
    k,
    tag + "inp.aimYaw",
    get_num(jinp, "aimYaw"),
    ainp.aim_yaw,
  )
  check_num(
    fixture,
    idx,
    k,
    tag + "inp.aimPitch",
    get_num(jinp, "aimPitch"),
    ainp.aim_pitch,
  )
  check_b01(fixture, idx, k, tag + "inp.fire", get_int(jinp, "fire"), ainp.fire)
}

///|
/// events 全量流水比对(条数 + 逐条逐字段)
fn compare_events(
  fixture : String,
  golden : Array[Json],
  mine : Array[Ev],
) -> Unit raise {
  if golden.length() != mine.length() {
    die(
      "TRACE MISMATCH \{fixture} events 条数不符: 夹具=\{golden.length()} 我方=\{mine.length()}",
    )
  }
  for i in 0..<golden.length() {
    let g = golden[i]
    let arr = match g {
      Array(a) => a
      _ => fail("TRACE MISMATCH \{fixture} events[\{i}] 期望数组")
    }
    let m = mine[i]
    let kind_g = match arr[0] {
      String(s) => s
      _ => fail("TRACE MISMATCH \{fixture} events[\{i}][0] 期望字符串")
    }
    let kind_m = match m {
      EvFire(_, _, _, _, _, _, _, _) => "fire"
      EvRam(_, _, _, _) => "ram"
      EvDestroyed(_, _, _) => "destroyed"
      EvHit(_, _, _, _, _, _, _, _, _, _) => "hit"
    }
    if kind_g != kind_m {
      die(
        "TRACE MISMATCH \{fixture} events[\{i}] kind 夹具=\{kind_g} 我方=\{kind_m}",
      )
    }
    match (arr, m) {
      (ga, EvFire(t, nid, px, py, pz, dx, dy, dz)) => {
        ev_num(fixture, i, ga, 1, t)
        ev_int(fixture, i, ga, 2, nid)
        ev_num(fixture, i, ga, 3, px)
        ev_num(fixture, i, ga, 4, py)
        ev_num(fixture, i, ga, 5, pz)
        ev_num(fixture, i, ga, 6, dx)
        ev_num(fixture, i, ga, 7, dy)
        ev_num(fixture, i, ga, 8, dz)
      }
      (ga, EvRam(t, sh, tg, dmg)) => {
        ev_num(fixture, i, ga, 1, t)
        ev_int(fixture, i, ga, 2, sh)
        ev_int(fixture, i, ga, 3, tg)
        ev_num(fixture, i, ga, 4, dmg.to_double())
      }
      (ga, EvDestroyed(t, nid, sid)) => {
        ev_num(fixture, i, ga, 1, t)
        ev_int(fixture, i, ga, 2, nid)
        ev_int(fixture, i, ga, 3, sid)
      }
      (ga, EvHit(t, sh, tg, kind, zone, dmg, mod_s, px, py, pz)) => {
        ev_num(fixture, i, ga, 1, t)
        ev_int(fixture, i, ga, 2, sh)
        ev_int(fixture, i, ga, 3, tg)
        ev_str(fixture, i, ga, 4, kind)
        ev_str(fixture, i, ga, 5, zone)
        ev_num(fixture, i, ga, 6, dmg.to_double())
        ev_str(fixture, i, ga, 7, mod_s)
        ev_num(fixture, i, ga, 8, px)
        ev_num(fixture, i, ga, 9, py)
        ev_num(fixture, i, ga, 10, pz)
      }
      _ => die("TRACE MISMATCH \{fixture} events[\{i}] 形状不符")
    }
  }
}

///|
fn ev_num(
  fixture : String,
  i : Int,
  arr : Array[Json],
  j : Int,
  actual : Double,
) -> Unit raise {
  match arr[j] {
    Number(d, ..) =>
      if (d - actual).abs() > 1.0e-6 {
        die(
          "TRACE MISMATCH \{fixture} events[\{i}][\{j}] expected=\{d} actual=\{actual} diff=\{(d - actual).abs()}",
        )
      }
    _ => die("TRACE MISMATCH \{fixture} events[\{i}][\{j}] 期望数值")
  }
}

///|
fn ev_int(
  fixture : String,
  i : Int,
  arr : Array[Json],
  j : Int,
  actual : Int,
) -> Unit raise {
  match arr[j] {
    Number(d, ..) =>
      if d.to_int() != actual {
        die(
          "TRACE MISMATCH \{fixture} events[\{i}][\{j}] expected=\{d} actual=\{actual}",
        )
      }
    _ => die("TRACE MISMATCH \{fixture} events[\{i}][\{j}] 期望数值")
  }
}

///|
fn ev_str(
  fixture : String,
  i : Int,
  arr : Array[Json],
  j : Int,
  actual : String,
) -> Unit raise {
  match arr[j] {
    String(s) =>
      if s != actual {
        die(
          "TRACE MISMATCH \{fixture} events[\{i}][\{j}] expected=\{s} actual=\{actual}",
        )
      }
    _ => die("TRACE MISMATCH \{fixture} events[\{i}][\{j}] 期望字符串")
  }
}

///|
async fn main {
  let fixture = "ai"
  let candidates = [
    "fixtures/golden/ai.json", "moonbit/fixtures/golden/ai.json",
  ]
  for path in candidates {
    if @fs.exists(path) {
      run(fixture, path)
      return
    }
  }
  die(
    "TRACE FAIL \{fixture}: 找不到夹具 \{candidates[0]} 或 \{candidates[1]}",
  )
}
