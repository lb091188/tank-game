// tracecheck main: fixtures/golden/simcore.json 重放比对(SPEC.md §5 硬门禁)。
// 判定: snapshot 条数一致 + 数值字段 |mine-golden|<=1.0e-6 + 整型/布尔字段全等;
// 任一字段超差 → 打印首个 mismatch(fixture/snapshot 下标/tick/字段/期望/实际)退出 1。

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
// covers 条目的可选数值字段(yaw?/scale?): JSON 缺键 → None
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
// meta.inputs.heights_u16_le_b64 → f32 高程: base64 → LE u16 → 两级 f32 舍入(SPEC §3)
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
    // Little-Endian: 低字节在前(值 ≤65535, reinterpret 同数值)
    u16[i] = (raw[2 * i].to_int() + raw[2 * i + 1].to_int() * 256).reinterpret_as_uint()
  }
  let max_height = get_num(get(inputs, "terrain_cfg"), "maxHeight")
  @simcore.heights_from_u16(u16, max_height)
}

///|
// meta.inputs.covers_raw → coverCol 碰撞表(golden-trace2.js coverCol 的直译输入)
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

///|
// 数值字段比对: |diff|<=1.0e-6; 首个超差即报告并退出 1
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
// 布尔/整型字段(0/1)全等比对
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
// 重放并比对; 全过打印 "TRACE OK simcore N/N" 并退出 0
async fn run(fixture : String, path : String) -> Unit {
  let s = read_file_string(path)
  let root = @json.parse(s)
  let meta = get(root, "meta")
  let inputs = get(meta, "inputs")
  let tcfg = get(inputs, "terrain_cfg")
  let size = get_num(tcfg, "size")
  let res = get_int(tcfg, "resolution")
  // SPEC §4 注入时机: 构造任何内核对象之前初始化 RNG(本场景无随机消费, 仅对齐注入口径)
  let rng = @simcore.Mulberry32::new(get_int(meta, "seed"))
  let heights = build_heights(inputs, res)
  let t = @simcore.make_terrain(heights, size, res)
  let list = build_covers(inputs)
  ignore(rng)
  let snaps = get_array(root, "snapshots")
  let n = snaps.length()
  // 声明式元数据对账: meta.snapshots 与 snapshots 数组一致(SPEC §5.1)
  let meta_n = get_int(meta, "snapshots")
  if n != meta_n {
    die(
      "TRACE MISMATCH \{fixture} snapshot 条数不符: meta.snapshots=\{meta_n} 实际数组=\{n}",
    )
  }
  for idx, snap in snaps {
    let k = get_int(snap, "k")
    if k != idx {
      die(
        "TRACE MISMATCH \{fixture} snapshot 顺序错位: 期望 k=\{idx} 实际 k=\{k}",
      )
    }
    // 查询输入: 按 meta.input_script 轨迹公式重算(golden-trace2.js:195-202 一一对应)。
    // 不直接喂内嵌 in.* 的原因: 那是 q6 量化值(±5.0e-7), 经归一化方向放大后在射线参 t 上
    // 可超 1.0e-6 容差(snapshot[21] nearestCoverBetween 实测 diff≈1.2e-6); 公式重算与生成器
    // 只差 V8/libm 三角函数 ≤1ulp(~1.0e-16 相对), 远小于容差。内嵌值仅用于交叉对账。
    let kd = idx.to_double()
    let time = kd * 0.05
    let ax = 350.0 * @math.sin(kd * 0.041)
    let az = 330.0 * @math.sin(kd * 0.023 + 1.3)
    let ayaw = 0.4 + 0.05 * kd
    let aspeed = 7.0 * @math.sin(kd * 0.09)
    let alyr = 0.25 * @math.sin(kd * 0.033)
    let alft = time - (if k % 50 < 12 { 1.5 } else { 99.0 })
    let acamo = 0.32
    let bx = -320.0 * @math.cos(kd * 0.017 + 0.7)
    let bz = 310.0 * @math.sin(kd * 0.031 + 2.1)
    let ay = t.height_at(ax, az)
    let by = t.height_at(bx, bz)
    // 内嵌 in.a / in.b 交叉对账(量化 ±5.0e-7 + 三角 ulp, 1.0e-6 容差)
    let a = get(get(snap, "in"), "a")
    let b = get(get(snap, "in"), "b")
    check_num(fixture, idx, k, "in.a.x", get_num(a, "x"), ax)
    check_num(fixture, idx, k, "in.a.z", get_num(a, "z"), az)
    check_num(fixture, idx, k, "in.a.y", get_num(a, "y"), ay)
    check_num(fixture, idx, k, "in.a.yaw", get_num(a, "yaw"), ayaw)
    check_num(fixture, idx, k, "in.a.speed", get_num(a, "speed"), aspeed)
    check_num(
      fixture,
      idx,
      k,
      "in.a.lastYawRate",
      get_num(a, "lastYawRate"),
      alyr,
    )
    check_num(fixture, idx, k, "in.a.lastFireT", get_num(a, "lastFireT"), alft)
    check_num(fixture, idx, k, "in.a.camo", get_num(a, "camo"), acamo)
    check_num(fixture, idx, k, "in.b.x", get_num(b, "x"), bx)
    check_num(fixture, idx, k, "in.b.z", get_num(b, "z"), bz)
    check_num(fixture, idx, k, "in.b.y", get_num(b, "y"), by)
    check_num(fixture, idx, k, "time", get_num(snap, "time"), time)
    let target : @simcore.CamoTarget = {
      x: ax,
      z: az,
      speed: aspeed,
      last_yaw_rate: alyr,
      last_fire_t: alft,
      camo: Some(acamo),
    }
    // golden-trace2.js:204-229 同式重放(调用次序一致: bushState → coversBlocked×2 → nearest → camo)
    let bs = list.bush_state(target, time)
    let spot : @simcore.Spot = {
      tx: bx,
      tz: bz,
      fired: bs.fired,
      concealed: bs.concealed,
    }
    let dx = bx - ax
    let dz = bz - az
    // JS: Math.hypot(dx, dz) || 1(0 值兜底)
    let h = @math.hypot(dx, dz)
    let len = if h > 0.0 { h } else { 1.0 }
    let hf = fn(x : Double, z : Double) { t.height_at(x, z) }
    let cov_plain = @simcore.covers_blocked(
      list,
      hf,
      ax,
      az,
      ay + 2.0,
      dx / len,
      dz / len,
      len,
      (by - ay) / len,
    )
    let cov_spot = @simcore.covers_blocked(
      list,
      hf,
      ax,
      az,
      ay + 2.0,
      dx / len,
      dz / len,
      len,
      (by - ay) / len,
      spot~,
    )
    let ncov = @simcore.nearest_cover_between(list, ax, az, bx, bz)
    let nc_t = match ncov {
      Some(c) =>
        @simcore.ray_circle(ax, az, dx / len, dz / len, len, c.x, c.z, c.r)
      None => -1.0
    }
    let los_def = t.los_blocked(ax, az, ay + 2.0, bx, bz, by + 2.0)
    let los_02 = t.los_blocked(ax, az, ay + 2.0, bx, bz, by + 2.0, margin=0.2)
    let camo = list.camo_of(target, time)
    // 逐字段比对(字段名与夹具 out.* 一一对应)
    let out = get(snap, "out")
    check_num(
      fixture,
      idx,
      k,
      "out.heightAtA",
      get_num(out, "heightAtA"),
      t.height_at(ax, az),
    )
    check_num(
      fixture,
      idx,
      k,
      "out.heightAtB",
      get_num(out, "heightAtB"),
      t.height_at(bx, bz),
    )
    check_num(
      fixture,
      idx,
      k,
      "out.slopeAhead",
      get_num(out, "slopeAhead"),
      t.slope_ahead(ax, az, ayaw, 6.0),
    )
    check_num(
      fixture,
      idx,
      k,
      "out.gradAtA",
      get_num(out, "gradAtA"),
      t.grad_at(ax, az),
    )
    check_num(
      fixture,
      idx,
      k,
      "out.gradAtB",
      get_num(out, "gradAtB"),
      t.grad_at(bx, bz),
    )
    check_b01(
      fixture,
      idx,
      k,
      "out.losBlockedDefault",
      get_int(out, "losBlockedDefault"),
      los_def,
    )
    check_b01(
      fixture,
      idx,
      k,
      "out.losBlockedMargin02",
      get_int(out, "losBlockedMargin02"),
      los_02,
    )
    check_num(
      fixture,
      idx,
      k,
      "out.coversBlockedPlain",
      get_num(out, "coversBlockedPlain"),
      cov_plain,
    )
    check_num(
      fixture,
      idx,
      k,
      "out.coversBlockedSpot",
      get_num(out, "coversBlockedSpot"),
      cov_spot,
    )
    check_num(
      fixture,
      idx,
      k,
      "out.nearestCoverBetween",
      get_num(out, "nearestCoverBetween"),
      nc_t,
    )
    check_b01(
      fixture,
      idx,
      k,
      "out.bushInBush",
      get_int(out, "bushInBush"),
      bs.in_bush,
    )
    check_b01(
      fixture,
      idx,
      k,
      "out.bushFired",
      get_int(out, "bushFired"),
      bs.fired,
    )
    check_b01(
      fixture,
      idx,
      k,
      "out.bushConcealed",
      get_int(out, "bushConcealed"),
      bs.concealed,
    )
    check_num(fixture, idx, k, "out.camoOf", get_num(out, "camoOf"), camo)
  }
  println("TRACE OK \{fixture} \{n}/\{n}")
  c_exit(0)
}

///|
async fn main {
  let fixture = "simcore"
  // runCmd 约定在 moonbit/ 模块根执行; 兜底仓根相对路径
  let candidates = [
    "fixtures/golden/simcore.json", "moonbit/fixtures/golden/simcore.json",
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
