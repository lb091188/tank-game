// tracesrv main: fixtures/golden/srvsim.json 重放比对(SPEC.md §5 硬门禁; 输出约定同 tracecheck)。
// 判定: dm snapshots + coopSnapshots + coopLog + result/coopResult 逐字段一致
// (数值 |mine-golden|<=1.0e-6, 整型/字符串全等); 任一字段超差 → 打印首个 mismatch 退出 1;
// 全过打印 "TRACE OK srvsim N/N" 退出 0。
// 重放算法 = tools/golden-trace2.js runSrvsim 的直译(dm 段 + coop 段, 每段 boot 前重置全局 RNG)。

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
  // 读 JSON 数值必须 Double::to_int(饱和转换), 不是 reinterpret
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
fn opt_num(j : Json, key : String) -> Double? raise {
  match j {
    Object(m) =>
      match m.get(key) {
        Some(Number(d, ..)) => Some(d)
        Some(_) => fail("\{key} 期望数值")
        None => None
      }
    _ => fail("期望 object")
  }
}

///|
fn as_num(j : Json) -> Double raise {
  match j {
    Number(d, ..) => d
    _ => fail("期望数值")
  }
}

///|
fn as_int(j : Json) -> Int raise {
  as_num(j).to_int()
}

///|
fn as_str(j : Json) -> String raise {
  match j {
    String(s) => s
    _ => fail("期望字符串")
  }
}

///|
fn as_array(j : Json) -> Array[Json] raise {
  match j {
    Array(a) => a
    _ => fail("期望数组")
  }
}

///|
// meta.inputs.heights_u16_le_b64 → f32 高程(SPEC §3 两级 f32 舍入; tracecheck 同式)
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
// meta.inputs.covers_raw → coverCol 碰撞表
fn build_covers(inputs : Json) -> Array[@simcore.CoverRaw] raise {
  let raws = get_array(inputs, "covers_raw")
  let items : Array[@simcore.CoverRaw] = []
  for c in raws {
    items.push({
      typ: get_str(c, "type"),
      x: get_num(c, "x"),
      z: get_num(c, "z"),
      yaw: opt_num(c, "yaw"),
      scale: opt_num(c, "scale"),
    })
  }
  items
}

///|
// q6(golden-trace2.js:51-56): 1e-6 网格量化; JS Math.round = half toward +∞
fn q6(v : Double) -> Double {
  (v * 1000000.0 + 0.5).floor() / 1000000.0
}

///|
// 数值字段比对: |diff|<=1.0e-6; 首个超差即报告并退出 1
fn check_num(
  seg : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Double,
  actual : Double,
) -> Unit {
  let diff = (actual - expected).abs()
  if diff > 1.0e-6 {
    die(
      "TRACE MISMATCH srvsim \{seg} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual} diff=\{diff}",
    )
  }
}

///|
fn check_int(
  seg : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Int,
  actual : Int,
) -> Unit {
  if expected != actual {
    die(
      "TRACE MISMATCH srvsim \{seg} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual}",
    )
  }
}

///|
fn check_str(
  seg : String,
  idx : Int,
  k : Int,
  field : String,
  expected : String,
  actual : String,
) -> Unit {
  if expected != actual {
    die(
      "TRACE MISMATCH srvsim \{seg} snapshot[\{idx}] tick=\{k} field=\{field} expected=\"\{expected}\" actual=\"\{actual}\"",
    )
  }
}

///|
// 环境装载(golden-trace2.js boot): Math.random = mulberry32(seed) + 全新 SF(含 Bus/SF.Game)
fn boot(seed : Int) -> Unit {
  @srvsim.rng_boot(seed)
  @srvsim.bus_reset()
  @srvsim.game_world_set(None)
}

///|
// DM 房输入参照: nearestEnemy(golden-trace2.js:626-634)
fn nearest_enemy(room : @srvsim.Room, t : @srvsim.Tank) -> @srvsim.Tank? {
  let mut best : @srvsim.Tank? = None
  let mut bd = 1.0e9
  for o in room.tanks.values() {
    if o.team == t.team || not(o.alive) {
      continue
    }
    let d = @math.hypot(o.x - t.x, o.z - t.z)
    if d < bd {
      bd = d
      best = Some(o)
    }
  }
  best
}

///|
// coop 房输入参照: nearestFoe(golden-trace2.js:703-711; netId>=100)
fn nearest_foe(room : @srvsim.Room, t : @srvsim.Tank) -> @srvsim.Tank? {
  let mut best : @srvsim.Tank? = None
  let mut bd = 1.0e9
  for o in room.tanks.values() {
    if o.team == t.team || not(o.alive) || o.net_id < 100 {
      continue
    }
    let d = @math.hypot(o.x - t.x, o.z - t.z)
    if d < bd {
      bd = d
      best = Some(o)
    }
  }
  best
}

///|
// coop 波间无敌时取最近落地空投(golden-trace2.js:712-720; 引 snapshot().pk)
fn nearest_pk(
  room : @srvsim.Room,
  t : @srvsim.Tank,
) -> (Int, Int, Double, Double)? {
  let s = room.snapshot()
  let mut best : (Int, Int, Double, Double)? = None
  let mut bd = 1.0e9
  for r in s.pk {
    let d = @math.hypot(r.2 - t.x, r.3 - t.z)
    if d < bd {
      bd = d
      best = Some(r)
    }
  }
  best
}

///|
// dmInput(golden-trace2.js:636-645): 朝最近敌推进/拉开, 瞳向敌, 上膛且 <260m 就开火
fn dm_input(room : @srvsim.Room, t : @srvsim.Tank) -> @srvsim.RawInput {
  match nearest_enemy(room, t) {
    None =>
      {
        throttle: Some(0.0),
        steer: Some(0.0),
        aim_yaw: Some(t.yaw),
        aim_pitch: Some(0.0),
        fire: Some(false),
      }
    Some(e) => {
      let want = @srvsim.v8_atan2(e.x - t.x, e.z - t.z)
      let d = @math.hypot(e.x - t.x, e.z - t.z)
      let steer = @srvsim.clamp(@srvsim.ang_diff(t.yaw, want) * 2.5, -1.0, 1.0)
      let throttle = if d > 60.0 { 1.0 } else if d < 35.0 { -0.5 } else { 0.0 }
      let fire = t.reload_t <= 0.0 && d < 260.0
      {
        throttle: Some(throttle),
        steer: Some(steer),
        aim_yaw: Some(want),
        aim_pitch: Some(0.02),
        fire: Some(fire),
      }
    }
  }
}

///|
// coopInput(golden-trace2.js:721-733): 参照=最近存活敌(netId>=100), 无敌时驶向最近落地空投
fn coop_input(room : @srvsim.Room, t : @srvsim.Tank) -> @srvsim.RawInput {
  let e = nearest_foe(room, t)
  let mut aim_x : Double = 0.0
  let mut aim_z : Double = 0.0
  let mut has_aim = false
  let mut firing = false
  match e {
    Some(en) => {
      aim_x = en.x
      aim_z = en.z
      has_aim = true
      firing = t.reload_t <= 0.0 && @math.hypot(en.x - t.x, en.z - t.z) < 260.0
    }
    None =>
      match nearest_pk(room, t) {
        Some(p) => {
          aim_x = p.2
          aim_z = p.3
          has_aim = true
        }
        None => ()
      }
  }
  if not(has_aim) {
    return {
      throttle: Some(0.0),
      steer: Some(0.0),
      aim_yaw: Some(t.yaw),
      aim_pitch: Some(0.02),
      fire: Some(false),
    }
  }
  let want = @srvsim.v8_atan2(aim_x - t.x, aim_z - t.z)
  let d = @math.hypot(aim_x - t.x, aim_z - t.z)
  let throttle = if d > 6.0 { 1.0 } else if d < 3.0 { -0.5 } else { 0.0 }
  let steer = @srvsim.clamp(@srvsim.ang_diff(t.yaw, want) * 2.5, -1.0, 1.0)
  {
    throttle: Some(throttle),
    steer: Some(steer),
    aim_yaw: Some(want),
    aim_pitch: Some(0.02),
    fire: Some(firing),
  }
}

///|
// 我方 dm 快照行(与 golden snapshot 字段一一对应)
struct DmSnap {
  k : Int
  st : Int
  time_left : Double
  finished : Int
  ev_fire : Int
  ev_hit : Int
  ev_kill : Int
  test_fires : Int
  tn_rows : Array[Array[Double]]
  sc : Array[Int]
}

///|
struct CoopSnap {
  k : Int
  st : Int
  wv : (Int, Int, String, Int, Int)
  rp : Int
  pk : Array[(Int, Int, Double, Double)]
  dt_keys : Array[Int]
  humans : Array[Array[Double]]
  enemies_alive : Int
  enemies_total : Int
  enemy_types : Array[(Int, String, Int)]
  ev_fire : Int
  ev_hit : Int
  ev_kill : Int
  ev_aiwave : Int
  ev_pkget : Int
  test_fires : Int
}

///|
struct CoopLogEv {
  kind : String // "aiWave" / "kill" / "pkGet"
  list : Array[(Int, String)] // aiWave
  id : Int // kill 目标 / pkGet 箱
  by : Int
  typ : String
}

///|
// dm 段重放(golden-trace2.js runSrvsim 主体:604-670)
async fn run_dm(meta_inputs : Json, root : Json) -> Unit {
  boot(20261009)
  let size = get_num(get(meta_inputs, "terrain_cfg"), "size")
  let res = get_int(get(meta_inputs, "terrain_cfg"), "resolution")
  let heights = build_heights(meta_inputs, res)
  let covers = build_covers(meta_inputs)
  let counts : Ref[(Int, Int, Int)] = { val: (0, 0, 0), } // fire/hit/kill
  let test_fires : Ref[Int] = { val: 0, }
  let end_rows : Ref[Array[(Int, String, Int)]?] = { val: None, }
  let on_event = fn(k : String, _ev : @srvsim.Ev) -> Unit {
    let (f, h, kl) = counts.val
    if k == "fire" {
      counts.val = (f + 1, h, kl)
    } else if k == "hit" {
      counts.val = (f, h + 1, kl)
    } else if k == "kill" {
      counts.val = (f, h, kl + 1)
    }
  }
  let players : Array[@srvsim.PlayerDef] = [
    { id: 1, name: "red-1", tank: "pz4", team: 0, },
    { id: 2, name: "red-2", tank: "sherman", team: 0, },
    { id: 3, name: "blue-1", tank: "stug3", team: 1, },
    { id: 4, name: "blue-2", tank: "tiger1", team: 1, },
  ]
  let room = @srvsim.Room::create({
    heights,
    terrain_size: size,
    terrain_res: res,
    covers_raw: covers,
    seed: 777,
    time_limit: 30.0,
    players,
    coop: false,
    waves: [],
    repair_duration: 12.0,
    repair_hp_ratio: 0.35,
    on_event,
    on_end: fn(rows) { end_rows.val = Some(rows) },
  })
  let ids = [1, 2, 3, 4]
  let dt = 1.0 / 60.0
  let snaps : Array[DmSnap] = []
  for k in 0..<1830 {
    for id in ids {
      match room.tanks.get(id) {
        Some(t) => if t.alive { room.set_input(id, dm_input(room, t)) }
        None => ()
      }
    }
    if k % 90 == 45 {
      // 调试钩子点射(确定性): 保证 OBB 判伤/击毁/计分链走到
      for id in [1, 3] {
        match room.tanks.get(id) {
          Some(from) =>
            if from.alive {
              match nearest_enemy(room, from) {
                Some(e) =>
                  if room.test_fire(id, e.net_id) {
                    test_fires.val += 1
                  }
                None => ()
              }
            }
          None => ()
        }
      }
    }
    room.tick(dt)
    if k % 20 == 0 {
      let s = room.snapshot()
      let tn_rows : Array[Array[Double]] = []
      for id in ids {
        match s.tn.get(id) {
          Some(row) => tn_rows.push(row)
          None => die("dm snapshot tn 缺行 id=\{id}")
        }
      }
      let sc : Array[Int] = []
      for id in ids {
        let mut v = 0
        for kv in room.scores {
          if kv.0 == id {
            v = kv.1
          }
        }
        sc.push(v)
      }
      let (f, h, kl) = counts.val
      snaps.push({
        k,
        st: s.st,
        time_left: q6(room.time_left),
        finished: if room.finished {
          1
        } else {
          0
        },
        ev_fire: f,
        ev_hit: h,
        ev_kill: kl,
        test_fires: test_fires.val,
        tn_rows,
        sc,
      })
    }
  }
  let result_finished = if room.finished { 1 } else { 0 }
  let result_win = if room.win { 1 } else { 0 }
  let result_rows = room.score_rows()
  let end_rows_final = match end_rows.val {
    Some(r) => r
    None => {
      die("dm onEnd 未触发")
      []
    }
  }
  ignore(root)
  compare_dm(snaps, result_finished, result_win, result_rows, end_rows_final)
}

///|
// dm 段比对(golden snapshots + result)
async fn compare_dm(
  snaps : Array[DmSnap],
  result_finished : Int,
  result_win : Int,
  result_rows : Array[(Int, String, Int)],
  end_rows : Array[(Int, String, Int)],
) -> Unit {
  let path = fixture_path()
  let s = read_file_string(path)
  let root = @json.parse(s)
  let snaps_gold = get_array(root, "snapshots")
  if snaps_gold.length() != snaps.length() {
    die(
      "TRACE MISMATCH srvsim dm snapshot 条数不符: golden=\{snaps_gold.length()} 实际=\{snaps.length()}",
    )
  }
  for idx, gold in snaps_gold {
    let mine = snaps[idx]
    let k = get_int(gold, "k")
    check_int("dm", idx, k, "k", k, mine.k)
    check_int("dm", idx, k, "st", get_int(gold, "st"), mine.st)
    check_num(
      "dm",
      idx,
      k,
      "timeLeft",
      get_num(gold, "timeLeft"),
      mine.time_left,
    )
    check_int(
      "dm",
      idx,
      k,
      "finished",
      get_int(gold, "finished"),
      mine.finished,
    )
    check_int(
      "dm",
      idx,
      k,
      "ev.fire",
      get_int(get(gold, "ev"), "fire"),
      mine.ev_fire,
    )
    check_int(
      "dm",
      idx,
      k,
      "ev.hit",
      get_int(get(gold, "ev"), "hit"),
      mine.ev_hit,
    )
    check_int(
      "dm",
      idx,
      k,
      "ev.kill",
      get_int(get(gold, "ev"), "kill"),
      mine.ev_kill,
    )
    check_int(
      "dm",
      idx,
      k,
      "testFires",
      get_int(gold, "testFires"),
      mine.test_fires,
    )
    // tnRows
    let rows_g = get_array(gold, "tnRows")
    if rows_g.length() != mine.tn_rows.length() {
      die("TRACE MISMATCH srvsim dm snapshot[\{idx}] tnRows 条数不符")
    }
    for ri, row_g in rows_g {
      let cols_g = as_array(row_g)
      let row_m = mine.tn_rows[ri]
      if cols_g.length() != row_m.length() {
        die(
          "TRACE MISMATCH srvsim dm snapshot[\{idx}] tnRows[\{ri}] 列数不符",
        )
      }
      for ci, cj in cols_g {
        check_num("dm", idx, k, "tnRows[\{ri}][\{ci}]", as_num(cj), row_m[ci])
      }
    }
    // sc
    let sc_g = get_array(gold, "sc")
    for si, sj in sc_g {
      check_int("dm", idx, k, "sc[\{si}]", as_int(sj), mine.sc[si])
    }
  }
  // result
  let res = get(root, "result")
  check_int(
    "dm",
    snaps.length(),
    -1,
    "result.finished",
    get_int(res, "finished"),
    result_finished,
  )
  check_int(
    "dm",
    snaps.length(),
    -1,
    "result.win",
    get_int(res, "win"),
    result_win,
  )
  let rows_g = get_array(res, "scoreRows")
  if rows_g.length() != result_rows.length() {
    die("TRACE MISMATCH srvsim result.scoreRows 条数不符")
  }
  for ri, row_g in rows_g {
    let cols = as_array(row_g)
    let mine = result_rows[ri]
    check_int(
      "dm",
      snaps.length(),
      -1,
      "result.scoreRows[\{ri}].id",
      as_int(cols[0]),
      mine.0,
    )
    check_str(
      "dm",
      snaps.length(),
      -1,
      "result.scoreRows[\{ri}].name",
      as_str(cols[1]),
      mine.1,
    )
    check_int(
      "dm",
      snaps.length(),
      -1,
      "result.scoreRows[\{ri}].kills",
      as_int(cols[2]),
      mine.2,
    )
  }
  // onEnd 收到的 rows 与 result.scoreRows 应同源一致(自校验)
  if end_rows.length() != result_rows.length() {
    die("TRACE MISMATCH srvsim onEnd rows 与 scoreRows 不一致")
  }
  println("TRACE OK srvsim dm \{snaps.length()}/\{snaps.length()}")
}

///|
// 夹具路径(runCmd 约定在 moonbit/ 模块根执行; 兜底仓根相对路径)
async fn fixture_path() -> String {
  let candidates = [
    "fixtures/golden/srvsim.json", "moonbit/fixtures/golden/srvsim.json",
  ]
  for path in candidates {
    if @fs.exists(path) {
      return path
    }
  }
  die("TRACE FAIL srvsim: 找不到夹具")
  ""
}

///|
async fn main {
  let path = fixture_path()
  let s = read_file_string(path)
  let root = @json.parse(s)
  let meta = get(root, "meta")
  let inputs = get(meta, "inputs")
  // partboxes 装载(SF.CFG.partBoxes; 仓内 moonbit/partboxes.json)
  let pb_candidates = [
    "partboxes.json", "moonbit/partboxes.json", "../partboxes.json",
  ]
  let mut pb_loaded = false
  for pb in pb_candidates {
    if @fs.exists(pb) {
      let pbs = read_file_string(pb)
      @srvsim.partboxes_load(@json.parse(pbs))
      pb_loaded = true
      // (直译对账探针: 装载后各车型 zone 数; 正式比对不消费)
      break
    }
  }
  if not(pb_loaded) {
    die("TRACE FAIL srvsim: 找不到 partboxes.json")
  }
  run_dm(inputs, root)
  run_coop(inputs, root)
}
