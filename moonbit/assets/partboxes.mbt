// partboxes.mbt — partBoxes.json(129 车型 OBB 部位盒表, 1.7MB)→ 内存结构。
// 数据文件在模块根 moonbit/partboxes.json(与 client/js/config.js:1535 内联的
// SF.CFG.partBoxes 逐字节同源, 已核验等值), 消费口径对齐 client/js/sim-engine.js:
//   tankOBBFrames(556-571): turretPivot / gunPivot / gunParent(缺省 "turret");
//   probeTankOBB(572-597):  zones[].z/.armor/.p/.c/.h/.q, q 缺省 = 盒不额外旋转。
// 运行时解析而非硬编码进源码的决策依据见 moonbit/json_bench(1.7MB 解析 < 1s)。

///|
/// 三维向量(部位盒中心 c / 半尺寸 h / 枢轴 turretPivot·gunPivot)。
pub(all) struct Vec3 {
  x : Double
  y : Double
  z : Double
}

///|
/// 四元数(盒附加旋转 q, x/y/z/w 同 glTF/JS 序)。
pub(all) struct Vec4 {
  x : Double
  y : Double
  z : Double
  w : Double
}

///|
/// 单个部位盒: sim-engine.js:573 的 zone 条目。
pub(all) struct PartBox {
  zone : String // z: "tracks"|"hullSide"|"turretFront"|... 命中部位名
  armor : Int // 装甲厚度(表内全为整数)
  parent : String // p: 盒所在坐标系 "root"|"turret"|"gun"
  c : Vec3 // 盒中心(parent 系局部坐标)
  h : Vec3 // 半尺寸
  q : Vec4? // 附加旋转; None = 不旋转(sim-engine.js:580 `z.q ? mulAxes(...) : sp.R`)
}

///|
/// 单车型部位盒表: sim-engine.js:560-563 的 tb。
pub(all) struct PartBoxTable {
  // 枢轴: 表内显式 null(22 型无炮塔车)按 sim-engine.js:561-562 落定默认
  // turretPivot→[0,1.5,0] / gunPivot→[0,0.4,1]
  turret_pivot : Vec3 // turretPivot
  gun_pivot : Vec3 // gunPivot
  gun_parent : String // gunParent: "turret"|"root"(火炮挂在炮塔还是车体)
  zones : Array[PartBox]
}

///|
/// 单车型表解析(表内 q/枪父级等可选字段按 sim-engine 的取用缺省)。
fn parse_partbox_table(typ : String, v : Json) -> PartBoxTable raise {
  let obj = match v {
    Json::Object(m) => m
    _ => raise Failure("partBoxes[\{typ}] 不是 object")
  }
  let vec3_of = fn(key : String) -> Vec3 raise {
    match obj.get(key) {
      Some(Json::Array(a)) => {
        if a.length() != 3 {
          raise Failure("partBoxes[\{typ}].\{key} 长度 \{a.length()} ≠ 3")
        }
        let num = fn(k : Int) -> Double raise {
          match a[k] {
            Json::Number(d, ..) => d
            _ => raise Failure("partBoxes[\{typ}].\{key}[\{k}] 不是数值")
          }
        }
        { x: num(0), y: num(1), z: num(2), }
      }
      _ => raise Failure("partBoxes[\{typ}] 缺 \{key}")
    }
  }
  // 枢轴可空: 22 型无炮塔车(歼击车/自行火炮)在表里显式 "turretPivot": null,
  // sim-engine.js:561-562 `(tb && tb.xxx) || [默认]` 的 || 默认在解析侧落定。
  let pivot_of = fn(key : String, default : Vec3) -> Vec3 raise {
    match obj.get(key) {
      None => default
      Some(Json::Null) => default
      Some(Json::Array(_)) => vec3_of(key)
      _ =>
        raise Failure("partBoxes[\{typ}].\{key} 既非 null 也非三元数组")
    }
  }
  let gun_parent = match obj.get("gunParent") {
    Some(Json::String(s)) => s
    // sim-engine.js:563 `(tb && tb.gunParent) || 'turret'`
    _ => "turret"
  }
  let zones : Array[PartBox] = match obj.get("zones") {
    Some(Json::Array(a)) => {
      let out : Array[PartBox] = []
      for zv in a {
        let zo = match zv {
          Json::Object(m) => m
          _ => raise Failure("partBoxes[\{typ}] zones 元素不是 object")
        }
        let fld_num = fn(key : String, k : Int) -> Double raise {
          match zo.get(key) {
            Some(Json::Array(a2)) =>
              match a2[k] {
                Json::Number(d, ..) => d
                _ =>
                  raise Failure(
                    "partBoxes[\{typ}] zone.\{key}[\{k}] 不是数值",
                  )
              }
            _ => raise Failure("partBoxes[\{typ}] zone 缺 \{key}")
          }
        }
        let c = { x: fld_num("c", 0), y: fld_num("c", 1), z: fld_num("c", 2), }
        let h = { x: fld_num("h", 0), y: fld_num("h", 1), z: fld_num("h", 2), }
        let q : Vec4? = match zo.get("q") {
          Some(Json::Array(a2)) => {
            let x = match a2[0] {
              Json::Number(d, ..) => d
              _ => raise Failure("partBoxes[\{typ}] zone.q[0] 不是数值")
            }
            let y = match a2[1] {
              Json::Number(d, ..) => d
              _ => raise Failure("partBoxes[\{typ}] zone.q[1] 不是数值")
            }
            let z = match a2[2] {
              Json::Number(d, ..) => d
              _ => raise Failure("partBoxes[\{typ}] zone.q[2] 不是数值")
            }
            let w = match a2[3] {
              Json::Number(d, ..) => d
              _ => raise Failure("partBoxes[\{typ}] zone.q[3] 不是数值")
            }
            Some({ x, y, z, w, })
          }
          _ => None
        }
        let armor = match zo.get("armor") {
          // 饱和转换按数值走; 表内全为非负整数, to_int 精确
          Some(Json::Number(d, ..)) => d.to_int()
          _ => raise Failure("partBoxes[\{typ}] zone 缺 armor")
        }
        let zone = match zo.get("z") {
          Some(Json::String(s)) => s
          _ => raise Failure("partBoxes[\{typ}] zone 缺 z")
        }
        let parent = match zo.get("p") {
          Some(Json::String(s)) => s
          _ => raise Failure("partBoxes[\{typ}] zone 缺 p")
        }
        out.push({ zone, armor, parent, c, h, q, })
      }
      out
    }
    _ => raise Failure("partBoxes[\{typ}] 缺 zones")
  }
  {
    turret_pivot: pivot_of("turretPivot", { x: 0.0, y: 1.5, z: 0.0, }),
    gun_pivot: pivot_of("gunPivot", { x: 0.0, y: 0.4, z: 1.0, }),
    gun_parent,
    zones,
  }
}

///|
/// 解析 partBoxes.json 文本 → 车型名 → 部位盒表。
pub fn parse_partboxes(text : String) -> Map[String, PartBoxTable] raise {
  let root : Json = @json.parse(text)
  let obj = match root {
    Json::Object(m) => m
    _ => raise Failure("partBoxes 顶层不是 object")
  }
  let out : Map[String, PartBoxTable] = Map([], capacity=129)
  for k, v in obj {
    out[k] = parse_partbox_table(k, v)
  }
  out
}

///|
/// 从模块根装载 partBoxes.json(路径候选见 manifest.mbt partboxes_candidates)。
pub async fn load_partboxes() -> Map[String, PartBoxTable] {
  let path = match resolve_rel(partboxes_candidates) {
    Some(p) => p
    None =>
      raise Failure(
        "partboxes.json 找不到(候选 partboxes.json ../partboxes.json ../../partboxes.json moonbit/partboxes.json 均未命中)",
      )
  }
  let size = @fs.file_size(path)
  let f = @fs.open(path, mode=ReadOnly)
  let raw = f.read_exactly_at(size.to_int(), position=0)
  f.close()
  parse_partboxes(@utf8.decode(raw))
}
