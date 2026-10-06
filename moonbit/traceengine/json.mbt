// traceengine part 1: 基础设施(退出/读文件/JSON 取值/夹具输入构建/量化与比对原语)。
// get/get_num/get_int/get_str/get_array/build_heights/build_covers 与 tracecheck main 同源
// (夹具装载路径与 SPEC §3 高程重建一致), 按 simengine 夹具所需裁剪。

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
// partboxes.json → CFG.partBoxes 表(sim-engine.js SF.CFG.partBoxes 的注入源;
// 全 129 型原样解析, probe 按 t.type 查)
async fn build_partboxes() -> Map[String, @simengine.PartBoxEntry] {
  let candidates = ["partboxes.json", "moonbit/partboxes.json"]
  let mut buf : String? = None
  for path in candidates {
    if @fs.exists(path) {
      buf = Some(read_file_string(path))
      break
    }
  }
  let s = match buf {
    Some(s) => s
    None =>
      fail(
        "traceengine: 找不到 partboxes.json(\{candidates[0]} 或 \{candidates[1]})",
      )
  }
  let root = @json.parse(s)
  let map : Map[String, @simengine.PartBoxEntry] = Map::new()
  match root {
    Object(m) =>
      for key, v in m {
        map[key] = parse_partbox_entry(v)
      }
    _ => fail("partboxes.json 期望顶层 object")
  }
  map
}

///|
fn as_num(j : Json) -> Double raise {
  match j {
    Number(d, ..) => d
    _ => fail("partboxes 期望数值")
  }
}

///|
fn as_str(j : Json) -> String raise {
  match j {
    String(s) => s
    _ => fail("partboxes 期望字符串")
  }
}

///|
fn jv3(j : Json) -> (Double, Double, Double) raise {
  match j {
    Array(a) => (as_num(a[0]), as_num(a[1]), as_num(a[2]))
    _ => fail("partboxes 期望 3 元数组")
  }
}

///|
fn jv4(j : Json) -> (Double, Double, Double, Double) raise {
  match j {
    Array(a) => (as_num(a[0]), as_num(a[1]), as_num(a[2]), as_num(a[3]))
    _ => fail("partboxes 期望 4 元数组")
  }
}

///|
// turretPivot 可为 null(stug3)或缺(JS `(tb && tb.turretPivot) || [0,1.5,0]` 兜底)
fn opt_v3(j : Json) -> (Double, Double, Double)? raise {
  match j {
    Null => None
    Array(_) => Some(jv3(j))
    _ => fail("partboxes 期望 null 或 3 元数组")
  }
}

///|
fn parse_zone(j : Json) -> @simengine.ZoneBox raise {
  match j {
    Object(m) => {
      let q : (Double, Double, Double, Double)? = match m.get("q") {
        Some(qj) =>
          match qj {
            Null => None
            _ => Some(jv4(qj))
          }
        None => None
      }
      let p : String = match m.get("p") {
        Some(pj) => as_str(pj)
        None => "root"
      }
      {
        z: as_str(get(j, "z")),
        armor: as_num(get(j, "armor")),
        c: jv3(get(j, "c")),
        h: jv3(get(j, "h")),
        p,
        q,
      }
    }
    _ => fail("partboxes zone 期望 object")
  }
}

///|
fn parse_partbox_entry(j : Json) -> @simengine.PartBoxEntry raise {
  match j {
    Object(m) => {
      let zones : Array[@simengine.ZoneBox]? = match m.get("zones") {
        Some(Array(a)) => {
          let zs : Array[@simengine.ZoneBox] = []
          for z in a {
            zs.push(parse_zone(z))
          }
          Some(zs)
        }
        _ => None
      }
      let turret_pivot : (Double, Double, Double)? = match
        m.get("turretPivot") {
        Some(v) => opt_v3(v)
        None => None
      }
      let gun_pivot : (Double, Double, Double)? = match m.get("gunPivot") {
        Some(v) => opt_v3(v)
        None => None
      }
      let gun_parent : String? = match m.get("gunParent") {
        Some(String(s)) => Some(s)
        _ => None
      }
      { turret_pivot, gun_pivot, gun_parent, zones, }
    }
    _ => fail("partboxes entry 期望 object")
  }
}

///|
// q6(golden-trace2.js:51-57): Math.round(v*1e6)/1e6(ECMA round = floor(x+0.5), V8 按规范实现)
fn q6(v : Double) -> Double {
  (v * 1000000.0 + 0.5).floor() / 1000000.0
}

///|
// 模块毁伤字段的哨兵(SPEC §量化): ±Infinity → -1(golden-trace2.js q6 的非有限分支)
fn q6_mod(v : Double) -> Double {
  if v.is_inf() {
    -1.0
  } else {
    q6(v)
  }
}

///|
// JS Math.round → 整数(settleHit/ram 伤害)
fn js_round(v : Double) -> Int {
  (v + 0.5).floor().to_int()
}

///|
// JS `% 1`(fmod)—— trackOffset 的 onMoved 钩子(golden-trace2.js:315 同式);
// MoonBit Double 无 % 运算符, 走 extern fmod(与 JS 逐位一致)
extern "C" fn c_fmod(x : Double, y : Double) -> Double = "fmod"

///|
fn js_mod_1(x : Double) -> Double {
  c_fmod(x, 1.0)
}

///|
// 数值字段比对: |diff|<=1e-6(双方均经 q6 量化; SPEC §5.2); 首个超差即报告并退出 1
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
// 整型字段全等比对(SPEC §5.3)
fn check_int(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : Int,
  actual : Int,
) -> Unit {
  if actual != expected {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual}",
    )
  }
}

///|
// 字符串字段全等比对(gear/clipPhase/type; SPEC §5.3)
fn check_str(
  fixture : String,
  idx : Int,
  k : Int,
  field : String,
  expected : String,
  actual : String,
) -> Unit {
  if actual != expected {
    die(
      "TRACE MISMATCH \{fixture} snapshot[\{idx}] tick=\{k} field=\{field} expected=\{expected} actual=\{actual}",
    )
  }
}
