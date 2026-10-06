// traceengine part 2: golden-trace2.js runSimengine 场景(tools/golden-trace2.js:265-453)
// 的直译重放 + SPEC §5 逐 snapshot 逐字段/全量事件流水比对。逐段注释标工具行号;
// 全过打印 "TRACE OK simengine N/N" 退出 0(c_exit), 任一字段超差打印 mismatch 退出 1。

///|
// DT = CFG.sim.dt = 1/60(golden-trace2.js:37; meta.dt 逐位同值)
let dt60 : Double = 1.0 / 60.0

///|
// mkTank 对象同一性(o === t)的发号器(updateTank 的 o===t 分支以 tag 判等)
let tag_seq : Ref[Int] = Ref::new(0)

///|
/// mkTank (golden-trace2.js:151-173): 车辆状态桩(字段集 = engine 读写清单, 与 SF.Tank 同形)。
/// JS velX/velZ(表现层预判字段)与 input/id/cr(引擎不读写)不承载。
fn mk_tank(
  typ : String,
  x : Double,
  z : Double,
  yaw : Double,
  team : Int,
  net_id : Int,
) -> @simengine.Tank raise {
  let spec = match @simengine.vehicle_spec(typ) {
    Some(s) => s
    None => fail("mkTank: 未知车型 \{typ}(vehicle_spec 未覆盖)")
  }
  tag_seq.val += 1
  {
    tag: tag_seq.val,
    typ,
    spec,
    x,
    z,
    y: 0.0,
    yaw,
    speed: 0.0,
    last_yaw_rate: 0.0,
    last_turret_rate: 0.0,
    turret_yaw: yaw,
    gun_pitch: 0.0,
    pitch: 0.0,
    roll: 0.0,
    track_offset: 0.0,
    gear: "D1",
    shift_t: 0.0,
    flip_t: 0.0,
    y_init: false,
    fall_v: 0.0,
    ram_t: -9.0,
    hp: spec.hp,
    alive: true,
    reload_t: 1.0,
    reload_total: 1.0,
    clip_left: match spec.gun_autoloader {
      Some(al) => al.clip
      None => 0
    },
    clip_phase: match spec.gun_autoloader {
      Some(_) => "intra"
      None => "single"
    },
    disp: spec.disp_max,
    mod_track: 0.0,
    mod_engine: 0.0,
    mod_gun: 0.0,
    mod_ammo: 0.0,
    no_turret: spec.gun_arc is Some(_), // JS parts.noTurret = spec.gunArc !== undefined
    obb_fallback: false,
    team,
    net_id,
    is_player: false,
    st_shots: 0,
    st_hits: 0,
    st_pens: 0,
    st_dmg_dealt: 0.0,
    last_fire_t: -99.0,
  }
}

///|
/// muzzleOf (golden-trace2.js:175): 无头炮口位姿(srv-sim.js:254-258 同式)
fn muzzle_of(t : @simengine.Tank) -> @simengine.Vec3 {
  {
    x: t.x + @math.sin(t.yaw) * 2.0,
    y: t.y + 2.1,
    z: t.z + @math.cos(t.yaw) * 2.0,
  }
}

///|
/// aimDirOf (golden-trace2.js:176-179)
fn aim_dir_of(t : @simengine.Tank) -> @simengine.Vec3 {
  let cp = @math.cos(t.gun_pitch)
  {
    x: @math.sin(t.turret_yaw) * cp,
    y: @math.sin(t.gun_pitch),
    z: @math.cos(t.turret_yaw) * cp,
  }
}

///|
/// mainInput (golden-trace2.js:323-339)
fn main_input(
  k : Int,
  main : @simengine.Tank,
  partner : @simengine.Tank,
) -> @simengine.Input {
  let i : @simengine.Input = {
    throttle: 0.0,
    steer: 0.0,
    aim_yaw: 0.35,
    aim_pitch: 0.0,
    fire: false,
    hold_turret: false,
  }
  if k < 300 {
    i.throttle = 1.0 // 直线升挡 D1→D3
  } else if k < 600 {
    i.throttle = 1.0
    i.steer = 0.6 // 转向掉速
  } else if k < 900 {
    i.throttle = -1.0 // 倒车换向(flip 全扭矩窗口)
  } else if k >= 1200 && k < 1260 {
    // 坠落段: 油门 0, 原地自由落体
  } else {
    // 追击/交战(朝 partner)
    let want = @math.atan2(partner.x - main.x, partner.z - main.z)
    i.aim_yaw = want
    i.steer = @simcore.clamp(
      @simengine.ang_diff(main.yaw, want) * 2.5,
      -1.0,
      1.0,
    )
    i.throttle = if k < 1200 { 1.0 } else { 0.4 } // 900-1200 追击(互推/撞伤), 之后游走交战
    i.fire = if k < 1200 { k % 150 == 100 } else { k % 75 == 25 }
    return i
  }
  i.fire = false
  i
}

///|
/// partnerInput (golden-trace2.js:340-344)。
/// 注意: meta.input_script 里的文案(k%600<300?0.3:-0.2)是旧值, 以工具代码为准(k%400<200?0.2:0)。
fn partner_input(
  k : Int,
  main : @simengine.Tank,
  partner : @simengine.Tank,
) -> @simengine.Input {
  {
    throttle: if k % 400 < 200 {
      0.2
    } else {
      0.0
    }, // 半程溜车半程停(停车窗被追击撞上)
    steer: -0.4,
    aim_yaw: @math.atan2(main.x - partner.x, main.z - partner.z),
    aim_pitch: 0.02,
    fire: k % 120 == 60,
    hold_turret: false,
  }
}

///|
/// counts 累计器(golden-trace2.js:273-274; snapshot 的 ev 字段集)
struct Counts {
  mut fire : Int
  mut reloaded : Int
  mut hit : Int
  mut destroyed : Int
  mut ram : Int
  mut shell_spawn : Int
  mut shell_ground : Int
  mut shell_cover : Int
  mut shell_hit_tank : Int
  mut shell_expire : Int
}

///|
/// emit (golden-trace2.js:276-286): 事件累计 + 流水记录(数值当场 q6, 与生成器同式)
fn make_emit(
  counts : Counts,
  log : Array[Json],
  wt : Ref[Double],
) -> (String, @simengine.EventData) -> Unit {
  fn(ev, d) {
    match (ev, d) {
      ("fire", @simengine.Fire(f)) => {
        counts.fire += 1
        log.push(
          Json::array([
            Json::string("fire"),
            Json::number(q6(wt.val)),
            Json::number(f.tank.net_id.to_double()),
            Json::number(q6(f.pos.x)),
            Json::number(q6(f.pos.y)),
            Json::number(q6(f.pos.z)),
            Json::number(q6(f.dir.x)),
            Json::number(q6(f.dir.y)),
            Json::number(q6(f.dir.z)),
          ]),
        )
      }
      ("reloaded", @simengine.Reloaded(r)) => {
        counts.reloaded += 1
        log.push(
          Json::array([
            Json::string("reloaded"),
            Json::number(q6(wt.val)),
            Json::number(r.tank.net_id.to_double()),
          ]),
        )
      }
      ("ram", @simengine.Ram(r)) => {
        counts.ram += 1
        counts.hit += 1
        log.push(
          Json::array([
            Json::string("ram"),
            Json::number(q6(wt.val)),
            Json::number(r.shooter.net_id.to_double()),
            Json::number(r.target.net_id.to_double()),
            Json::number(r.dmg.to_double()),
          ]),
        )
      }
      ("destroyed", @simengine.Destroyed(dd)) => {
        counts.destroyed += 1
        let sid = match dd.shooter {
          Some(s) => s.net_id.to_double()
          None => -1.0 // JS d.shooter ? d.shooter.netId : -1
        }
        log.push(
          Json::array([
            Json::string("destroyed"),
            Json::number(q6(wt.val)),
            Json::number(dd.tank.net_id.to_double()),
            Json::number(sid),
          ]),
        )
      }
      ("hit", @simengine.Hit(h)) => {
        counts.hit += 1
        let sid = match h.shooter {
          Some(s) => s.net_id.to_double()
          None => -1.0
        }
        let mdl = match h.module_ {
          Some(m) => m
          None => "" // JS d.module || ''
        }
        log.push(
          Json::array([
            Json::string("hit"),
            Json::number(q6(wt.val)),
            Json::number(sid),
            Json::number(h.target.net_id.to_double()),
            Json::string(h.kind),
            Json::string(h.zone),
            Json::number(h.dmg.to_double()),
            Json::string(mdl),
            Json::number(q6(h.point.x)),
            Json::number(q6(h.point.y)),
            Json::number(q6(h.point.z)),
          ]),
        )
      }
      _ => ()
    }
  }
}

///|
/// settleHit (golden-trace2.js:421-453 直译; srv-sim.js makeJudge.onHitTank 同式;
/// 事件改走 emit 记录)。CFG.armor 常量内联(config.js:1136-1153)。
/// JS 形参里的 world/CFG 本函数未消费(world 仅透传), 省略。
fn settle_hit(
  counts : Counts,
  sh : @simengine.Shell,
  tk : @simengine.Tank,
  hit : @simengine.ObbHit,
  seg_dir : @simengine.Vec3,
  emit : (String, @simengine.EventData) -> Unit,
) -> Unit {
  if !tk.alive {
    return
  }
  counts.shell_hit_tank += 1
  let ricochet_angle = 70.0 * @math.PI / 180.0 // A.ricochetAngle
  let pen_variance = 0.25 // A.penVariance
  let dmg_variance = 0.25 // A.dmgVariance
  let track_duration = 6.0 // A.modules.track.duration
  let ammo_chance = 0.08 // A.modules.ammo.chance
  let ammo_dmg_mult = 1.6 // A.modules.ammo.dmgMult
  let engine_rear_chance = 0.55 // A.modules.engine.rearChance
  let dot = hit.normal.x * seg_dir.x +
    hit.normal.y * seg_dir.y +
    hit.normal.z * seg_dir.z
  let incidence = @math.acos((-dot).max(-1.0).min(1.0))
  let armor = hit.armor // JS hit.armor || 0(0 值同结果)
  let cal = sh.cal
  let over3 = armor > 0.0 && cal > armor * 3.0
  let mut norm = 5.0 * @math.PI / 180.0
  if armor > 0.0 && cal > armor * 2.0 {
    norm = norm * 2.0
  }
  let eff = armor / @math.cos((incidence - norm).max(0.0)).max(0.05)
  let pen = sh.pen * (1.0 + (@simengine.rand() * 2.0 - 1.0) * pen_variance)
  let rico = armor > 0.0 && !over3 && incidence > ricochet_angle
  let mut kind = "nopen"
  let mut module_ : String? = None
  let mut dmg = 0
  sh.owner.st_hits += 1
  if hit.zone == "gun" {
    tk.mod_gun = @double.infinity
    kind = "gun"
    module_ = Some("gun")
  } else if hit.zone == "tracks" {
    tk.mod_track = track_duration
    module_ = Some("track")
    if rico {
      kind = "bounce"
    } else if pen >= eff {
      kind = "pen"
      dmg = js_round(
        sh.dmg * (1.0 + (@simengine.rand() * 2.0 - 1.0) * dmg_variance),
      )
    } else {
      kind = "absorb"
    }
  } else if rico {
    kind = "bounce"
  } else if pen >= eff {
    kind = "pen"
    let mut dm = sh.dmg * (1.0 + (@simengine.rand() * 2.0 - 1.0) * dmg_variance)
    if @simengine.rand() < ammo_chance {
      dm = dm * ammo_dmg_mult
      module_ = Some("ammo")
      tk.mod_ammo = @double.infinity
    } else if hit.zone == "hullRear" && @simengine.rand() < engine_rear_chance {
      module_ = Some("engine")
      tk.mod_engine = @double.infinity
    }
    dmg = js_round(dm)
  }
  if kind == "pen" {
    tk.hp -= dmg.to_double()
    sh.owner.st_pens += 1
    sh.owner.st_dmg_dealt += dmg.to_double()
  }
  if tk.hp <= 0.0 && tk.alive {
    tk.hp = 0.0
    tk.alive = false
    emit(
      "destroyed",
      @simengine.Destroyed({ tank: tk, shooter: Some(sh.owner), }),
    )
  }
  emit(
    "hit",
    @simengine.Hit({
      target: tk,
      shooter: Some(sh.owner),
      point: hit.point,
      zone: hit.zone,
      dmg,
      kind,
      module_,
    }),
  )
}

///|
/// snapshot 比对(golden-trace2.js:348-360 snapTank 字段集 + :388 装配; SPEC §5.1-5.3)
fn check_snapshot(
  fixture : String,
  idx : Int,
  snap : Json,
  k : Int,
  time : Double,
  counts : Counts,
  main : @simengine.Tank,
  partner : @simengine.Tank,
) -> Unit raise {
  check_int(fixture, idx, k, "k", get_int(snap, "k"), k)
  check_num(fixture, idx, k, "time", get_num(snap, "time"), q6(time))
  let ev = get(snap, "ev")
  check_int(fixture, idx, k, "ev.fire", get_int(ev, "fire"), counts.fire)
  check_int(
    fixture,
    idx,
    k,
    "ev.reloaded",
    get_int(ev, "reloaded"),
    counts.reloaded,
  )
  check_int(fixture, idx, k, "ev.hit", get_int(ev, "hit"), counts.hit)
  check_int(
    fixture,
    idx,
    k,
    "ev.destroyed",
    get_int(ev, "destroyed"),
    counts.destroyed,
  )
  check_int(fixture, idx, k, "ev.ram", get_int(ev, "ram"), counts.ram)
  check_int(
    fixture,
    idx,
    k,
    "ev.shellSpawn",
    get_int(ev, "shellSpawn"),
    counts.shell_spawn,
  )
  check_int(
    fixture,
    idx,
    k,
    "ev.shellGround",
    get_int(ev, "shellGround"),
    counts.shell_ground,
  )
  check_int(
    fixture,
    idx,
    k,
    "ev.shellCover",
    get_int(ev, "shellCover"),
    counts.shell_cover,
  )
  check_int(
    fixture,
    idx,
    k,
    "ev.shellHitTank",
    get_int(ev, "shellHitTank"),
    counts.shell_hit_tank,
  )
  check_int(
    fixture,
    idx,
    k,
    "ev.shellExpire",
    get_int(ev, "shellExpire"),
    counts.shell_expire,
  )
  let gt = get_array(snap, "tanks")
  if gt.length() != 2 {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tanks 条数 \{gt.length()} != 2",
    )
  }
  check_tank(fixture, idx, k, "tanks[0]", gt[0], main)
  check_tank(fixture, idx, k, "tanks[1]", gt[1], partner)
}

///|
/// 单坦克字段比对(snapTank 的一比一; mod.* 走 Infinity 哨兵还原)
fn check_tank(
  fixture : String,
  idx : Int,
  k : Int,
  path : String,
  g : Json,
  t : @simengine.Tank,
) -> Unit raise {
  check_int(fixture, idx, k, path + ".id", get_int(g, "id"), t.net_id)
  check_str(fixture, idx, k, path + ".type", get_str(g, "type"), t.typ)
  check_num(fixture, idx, k, path + ".x", get_num(g, "x"), q6(t.x))
  check_num(fixture, idx, k, path + ".y", get_num(g, "y"), q6(t.y))
  check_num(fixture, idx, k, path + ".z", get_num(g, "z"), q6(t.z))
  check_num(fixture, idx, k, path + ".yaw", get_num(g, "yaw"), q6(t.yaw))
  check_num(fixture, idx, k, path + ".pitch", get_num(g, "pitch"), q6(t.pitch))
  check_num(fixture, idx, k, path + ".roll", get_num(g, "roll"), q6(t.roll))
  check_num(fixture, idx, k, path + ".speed", get_num(g, "speed"), q6(t.speed))
  check_str(fixture, idx, k, path + ".gear", get_str(g, "gear"), t.gear)
  check_num(
    fixture,
    idx,
    k,
    path + ".shiftT",
    get_num(g, "shiftT"),
    q6(t.shift_t),
  )
  check_num(fixture, idx, k, path + ".flipT", get_num(g, "flipT"), q6(t.flip_t))
  check_num(
    fixture,
    idx,
    k,
    path + ".turretYaw",
    get_num(g, "turretYaw"),
    q6(t.turret_yaw),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".gunPitch",
    get_num(g, "gunPitch"),
    q6(t.gun_pitch),
  )
  check_num(fixture, idx, k, path + ".disp", get_num(g, "disp"), q6(t.disp))
  check_num(
    fixture,
    idx,
    k,
    path + ".reloadT",
    get_num(g, "reloadT"),
    q6(t.reload_t),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".reloadTotal",
    get_num(g, "reloadTotal"),
    q6(t.reload_total),
  )
  check_int(
    fixture,
    idx,
    k,
    path + ".clipLeft",
    get_int(g, "clipLeft"),
    t.clip_left,
  )
  check_str(
    fixture,
    idx,
    k,
    path + ".clipPhase",
    get_str(g, "clipPhase"),
    t.clip_phase,
  )
  check_num(fixture, idx, k, path + ".hp", get_num(g, "hp"), q6(t.hp))
  // alive: 布尔 → 0/1(golden-trace2.js b01)
  let ga = get_int(g, "alive")
  let ma = if t.alive { 1 } else { 0 }
  if ma != ga {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{path}.alive expected=\{ga} actual=\{ma}",
    )
  }
  check_num(
    fixture,
    idx,
    k,
    path + ".lastYawRate",
    get_num(g, "lastYawRate"),
    q6(t.last_yaw_rate),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".lastTurretRate",
    get_num(g, "lastTurretRate"),
    q6(t.last_turret_rate),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".trackOffset",
    get_num(g, "trackOffset"),
    q6(t.track_offset),
  )
  check_num(fixture, idx, k, path + ".fallV", get_num(g, "fallV"), q6(t.fall_v))
  let gm = get(g, "mod")
  check_num(
    fixture,
    idx,
    k,
    path + ".mod.track",
    get_num(gm, "track"),
    q6_mod(t.mod_track),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".mod.engine",
    get_num(gm, "engine"),
    q6_mod(t.mod_engine),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".mod.gun",
    get_num(gm, "gun"),
    q6_mod(t.mod_gun),
  )
  check_num(
    fixture,
    idx,
    k,
    path + ".mod.ammo",
    get_num(gm, "ammo"),
    q6_mod(t.mod_ammo),
  )
  check_int(fixture, idx, k, path + ".shots", get_int(g, "shots"), t.st_shots)
  check_int(fixture, idx, k, path + ".hits", get_int(g, "hits"), t.st_hits)
  check_int(fixture, idx, k, path + ".pens", get_int(g, "pens"), t.st_pens)
  check_num(
    fixture,
    idx,
    k,
    path + ".dmgDealt",
    get_num(g, "dmgDealt"),
    q6(t.st_dmg_dealt),
  )
}

///|
/// events 流水比对(SPEC §5.4): 条数 + 逐条逐元素(字符串全等/数值 1e-6, 双方均已 q6)
fn compare_events(
  fixture : String,
  golden : Array[Json],
  mine : Array[Json],
) -> Unit {
  if golden.length() != mine.length() {
    die(
      "TRACE MISMATCH \{fixture} events 条数不符: golden=\{golden.length()} 实际=\{mine.length()}",
    )
  }
  for idx, ge in golden {
    let me = mine[idx]
    match (ge, me) {
      (Array(ga), Array(ma)) => {
        if ga.length() != ma.length() {
          die(
            "TRACE MISMATCH \{fixture} event[\{idx}] 元素数不符: golden=\{ga.length()} 实际=\{ma.length()}",
          )
        }
        for j in 0..<ga.length() {
          match (ga[j], ma[j]) {
            (String(gs), String(ms)) =>
              if gs != ms {
                die(
                  "TRACE MISMATCH \{fixture} event[\{idx}][\{j}] expected=\{gs} actual=\{ms}",
                )
              }
            (Number(gv, ..), Number(mv, ..)) => {
              let diff = (mv - gv).abs()
              if diff > 1.0e-6 {
                die(
                  "TRACE MISMATCH \{fixture} event[\{idx}][\{j}] expected=\{gv} actual=\{mv} diff=\{diff}",
                )
              }
            }
            _ =>
              die(
                "TRACE MISMATCH \{fixture} event[\{idx}][\{j}] 元素类型不符",
              )
          }
        }
      }
      _ => die("TRACE MISMATCH \{fixture} event[\{idx}] 期望数组")
    }
  }
}

///|
/// 重放并比对; 全过打印 "TRACE OK simengine N/N" 并退出 0
async fn run(fixture : String, path : String) -> Unit {
  let s = read_file_string(path)
  let root = @json.parse(s)
  let meta = get(root, "meta")
  let inputs = get(meta, "inputs")
  let tcfg = get(inputs, "terrain_cfg")
  let size = get_num(tcfg, "size")
  let res = get_int(tcfg, "resolution")
  let seed = get_int(meta, "seed")
  // SPEC §4 注入时机: 构造任何内核对象之前初始化全局 RNG
  // (JS boot() 在装载内核脚本前 Math.random = mulberry32(seed), golden-trace2.js:142-148)
  @simengine.set_rng(seed)
  let heights = build_heights(inputs, res)
  let t = @simcore.make_terrain(heights, size, res)
  let covers = build_covers(inputs)
  let partboxes = build_partboxes()
  let ticks = get_int(meta, "ticks")
  let snaps = get_array(root, "snapshots")
  // 声明式元数据对账: meta.snapshots 与 snapshots 数组一致(SPEC §5.1)
  let meta_n = get_int(meta, "snapshots")
  if snaps.length() != meta_n {
    die(
      "TRACE MISMATCH \{fixture} snapshot 条数不符: meta.snapshots=\{meta_n} 实际数组=\{snaps.length()}",
    )
  }
  // 出生点: 最近硬掩体反方向 25m(golden-trace2.js:288-291; reduce 逐元素含首元素)
  let hard = covers.items.filter(fn(c) { c.blocks_move && c.blocks_shells })
  let mut h0 = hard[0]
  for b in hard {
    let db = @math.hypot(b.x + 100.0, b.z - 60.0)
    let da = @math.hypot(h0.x + 156.0, h0.z - 40.0)
    if db < da {
      h0 = b
    }
  }
  let sx = h0.x - @math.sin(0.35) * 25.0
  let sz = h0.z - @math.cos(0.35) * 25.0
  let main = mk_tank("pz4", sx, sz, 0.35, 0, 1)
  let partner = mk_tank("stug3", sx + 18.0, sz - 14.0, @math.PI + 0.35, 1, 2)
  let tanks : Array[@simengine.Tank] = [main, partner]
  // world(golden-trace2.js:294): { time, terrain, tanks }; time 为可变宿主(emit 闭包活读)
  let wt : Ref[Double] = Ref::new(0.0)
  let counts : Counts = {
    fire: 0,
    reloaded: 0,
    hit: 0,
    destroyed: 0,
    ram: 0,
    shell_spawn: 0,
    shell_ground: 0,
    shell_cover: 0,
    shell_hit_tank: 0,
    shell_expire: 0,
  }
  let log : Array[Json] = []
  let emit = make_emit(counts, log, wt)
  // 弹场 hooks(golden-trace2.js:296-306)
  let hooks = @simengine.Hooks::make(
    on_create=fn(_sh) { counts.shell_spawn += 1 },
    on_impact=fn(kind, p) {
      if kind == "ground" {
        counts.shell_ground += 1
      } else {
        counts.shell_cover += 1
      }
      log.push(
        Json::array([
          Json::string("impact"),
          Json::number(q6(wt.val)),
          Json::string(kind),
          Json::number(q6(p.x)),
          Json::number(q6(p.y)),
          Json::number(q6(p.z)),
        ]),
      )
    },
    on_player_miss=fn(_p) { () },
    on_near_miss=fn(_sh) { () },
    on_flight=fn(_sh) { () },
    on_explode=fn(_sh, _p, _tk, _armor) { () },
    on_kill=fn(_sh) { counts.shell_expire += 1 },
    probe_tank=fn(_sh, tk, ox, oy, oz, dx, dy, dz, seg_len) {
      @simengine.probe_tank_obb(
        Some(partboxes),
        tk,
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        seg_len,
      )
    },
    on_hit_tank=fn(sh, tk, hit, seg_dir) {
      settle_hit(counts, sh, tk, hit, seg_dir, emit)
    },
  )
  let shells = @simengine.Shells::make(hooks)
  // wf = { shells: { field: shells } }(golden-trace2.js:321)
  let world : @simengine.World = { shells_field: shells, }
  // takeRam(golden-trace2.js:308-313)
  let take_ram = fn(
    target : @simengine.Tank,
    shooter : @simengine.Tank,
    dmg : Int,
  ) -> Unit {
    if !target.alive || dmg <= 0 {
      return
    }
    target.hp -= dmg.to_double()
    emit("ram", @simengine.Ram({ shooter, target, dmg, }))
    if target.hp <= 0.0 && target.alive {
      target.hp = 0.0
      target.alive = false
      emit(
        "destroyed",
        @simengine.Destroyed({ tank: target, shooter: Some(shooter), }),
      )
    }
  }
  // env()(golden-trace2.js:314-315): 每 tick 新建; onMoved 推进履带相位(% 1 = fmod)
  let make_env = fn() -> @simengine.Env {
    {
      terrain: t,
      covers_list: covers,
      tanks,
      time: wt.val,
      emit,
      on_moved: Some(fn(tk : @simengine.Tank, d : Double) {
        tk.track_offset = js_mod_1(tk.track_offset - tk.speed * d / 4.0)
      }),
      take_ram: Some(take_ram),
    }
  }
  // envT(golden-trace2.js:316-320): 弹场环境(coversBlocked 走 SF.Sim 同一实现)
  let hf = fn(x : Double, z : Double) { t.height_at(x, z) }
  let env_t : @simengine.ShellEnv = {
    height_at: hf,
    covers_blocked: fn(ox, oz, oy, dx, dz, len, dy) {
      @simcore.covers_blocked(covers, hf, ox, oz, oy, dx, dz, len, dy)
    },
    tanks,
    player_pos: Some(main),
    player_team: 0,
  }
  // 主循环(golden-trace2.js:361-389)
  let mut snap_idx = 0
  for k in 0..<ticks {
    // 坠落段 k∈[1200,1260) 全局 dt=0.1(golden-trace2.js:364)
    let dt = if k >= 1200 && k < 1260 { 0.1 } else { dt60 }
    wt.val += dt
    if k == 1200 {
      // 坠落试验注入(:366-376): 原地悬空 targetY(四角同式)+12.5m(姿态/速度归零)。
      // dt=0.1 窗下第 11 步落地: v≈21.6, dmg=(21.6-9)²·4≈631, 另掷断带
      let s2 = @math.sin(main.yaw)
      let c2 = @math.cos(main.yaw)
      let sl = main.spec.sample_l
      let sw = main.spec.sample_w
      let hf2 = t.height_at(main.x + s2 * sl, main.z + c2 * sl)
      let hb2 = t.height_at(main.x - s2 * sl, main.z - c2 * sl)
      let hl2 = t.height_at(main.x + c2 * sw, main.z - s2 * sw)
      let hr2 = t.height_at(main.x - c2 * sw, main.z + s2 * sw)
      let ty2 = t.height_at(main.x, main.z).max((hf2 + hb2 + hl2 + hr2) / 4.0)
      main.y = ty2 + 12.5
      main.fall_v = 0.0
      main.speed = 0.0
      main.gear = "D1"
      main.shift_t = 0.0
      main.flip_t = 0.0
    }
    if k == 1350 {
      main.mod_track = main.mod_track.max(6.0) // 断带瘫痪
    }
    if k == 1500 {
      main.mod_engine = @double.infinity // 极速×slow
    }
    if k == 1650 {
      main.mod_ammo = @double.infinity // 装填×reloadMult
    }
    let mi = main_input(k, main, partner)
    @simengine.update_tank(main, mi, dt, make_env())
    // 开火由薄壳在 update 返回后按同位序调用(vehicle.js 薄壳同款)
    if mi.fire {
      ignore(
        @simengine.fire(main, world, muzzle_of(main), aim_dir_of(main), emit),
      )
    }
    let pi = partner_input(k, main, partner)
    @simengine.update_tank(partner, pi, dt, make_env())
    if pi.fire {
      ignore(
        @simengine.fire(
          partner,
          world,
          muzzle_of(partner),
          aim_dir_of(partner),
          emit,
        ),
      )
    }
    shells.update(dt, env_t)
    if k % 20 == 0 {
      if snap_idx >= snaps.length() {
        die(
          "TRACE MISMATCH \{fixture}: 实际 snapshot 超出 golden(\{snaps.length()})",
        )
      }
      check_snapshot(
        fixture,
        snap_idx,
        snaps[snap_idx],
        k,
        wt.val,
        counts,
        main,
        partner,
      )
      snap_idx += 1
    }
  }
  if snap_idx != snaps.length() {
    die(
      "TRACE MISMATCH \{fixture} snapshot 条数不符: golden=\{snaps.length()} 实际=\{snap_idx}",
    )
  }
  // 全量事件流水比对(SPEC §5.4)
  compare_events(fixture, get_array(root, "events"), log)
  println("TRACE OK \{fixture} \{snap_idx}/\{snap_idx}")
  c_exit(0)
}

///|
async fn main {
  let fixture = "simengine"
  // runCmd 约定在 moonbit/ 模块根执行; 兜底仓根相对路径
  let candidates = [
    "fixtures/golden/simengine.json", "moonbit/fixtures/golden/simengine.json",
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
