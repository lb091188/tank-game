// map.mbt — 地图装载: assets/maps/<dir>/map.json + heightmap.png → 结构化地图数据。
// 对齐 client/js/assets.js ensureMap(140-153): json + 高程两件套;
// 高程语义与 client 侧逐位一致:
//   解码  assets.js:52  v16 = R*256+G(大端 16 位)——three-native loaders::decode_png16_gray
//         与 server.js:97-116 手解/v9_image 实验同源(非交错 16 位灰度);
//   缩放  assets.js:53  h = v16/65535*maxHeight, 载体是 Float32Array —— 这里每个元素
//         过一次 f32 圆整(Float::from_double(...).to_double()), 与 server.js:111 的
//         Float32Array 同口径;
//   采样  simcore.js:12-23 makeTerrain.heightAt 的双线性公式逐句直译。
// map.json 顶层字段口径见各文件头"_说明": player.spawn 单点兜底, player.spawns 多点池。

///|
/// map.json terrain 段(尺寸米 / 网格分辨率 / 最大高程米)。
pub(all) struct TerrainCfg {
  size : Double
  resolution : Int
  max_height : Double
}

///|
/// 出生点: player.spawn=[x, z, yaw](世界坐标米 + 朝向弧度)。
pub(all) struct SpawnPoint {
  x : Double
  z : Double
  yaw : Double
}

///|
/// 掩体条目: map.json covers 的 type/x/z + 可选 yaw/scale
/// (models.js buildCover:133/136 的 `c.yaw || 0`、`c.scale || 1` 缺省在此落定)。
pub(all) struct MapCover {
  typ : String
  x : Double
  z : Double
  yaw : Double
  scale : Double
}

///|
/// 结构化地图数据(ensureMap 产物 { json, heights } 的强类型版)。
/// lighting/waves/objectives 等渲染/关卡侧字段原样留在 raw, 组装阶段自行取用。
pub(all) struct MapData {
  id : String // map.json 顶层 id(如 "l01-l01-encounter", 注意与 CFG.maps 的短 id 不同)
  dir : String // 目录名(CFG.maps.dir)
  name : String
  terrain : TerrainCfg
  heights : FixedArray[Double] // resolution² 行主序, f32 圆整后的高程(米)
  spawn : SpawnPoint // 单点兜底
  spawns : Array[SpawnPoint] // 多点池(≥8; map.json 缺省时回退为 [spawn])
  covers : Array[MapCover]
  wave_count : Int
  raw : Json
}

///|
/// 双线性高程采样(simcore.js:12-23 逐句直译; heights 行主序 resolution²)。
pub fn heightmap_height_at(
  heights : FixedArray[Double],
  res : Int,
  size : Double,
  x : Double,
  z : Double,
) -> Double {
  let half = size / 2.0
  let clamp = fn(v : Double, a : Double, b : Double) -> Double {
    if v < a {
      a
    } else if v > b {
      b
    } else {
      v
    }
  }
  let fi = clamp((x + half) / size, 0.0, 1.0) * (res - 1).to_double()
  let fj = clamp((z + half) / size, 0.0, 1.0) * (res - 1).to_double()
  // fi/fj ≥ 0, to_int 截断即 floor; i/j 钳到 res-2 保四邻存在(simcore.js:17-18)
  let i = if fi.to_int() < res - 2 { fi.to_int() } else { res - 2 }
  let j = if fj.to_int() < res - 2 { fj.to_int() } else { res - 2 }
  let tx = fi - i.to_double()
  let tz = fj - j.to_double()
  let a = heights[j * res + i]
  let b = heights[j * res + i + 1]
  let c = heights[(j + 1) * res + i]
  let d = heights[(j + 1) * res + i + 1]
  a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz
}

///|
/// 采样本图高程(Terrain.heightAt 的对应物)。
pub fn MapData::height_at(self : MapData, x : Double, z : Double) -> Double {
  heightmap_height_at(
    self.heights,
    self.terrain.resolution,
    self.terrain.size,
    x,
    z,
  )
}

///|
/// 网格坐标(像素列 i/行 j) → 世界坐标(px*cell - half; cell=size/(res-1))。
pub fn grid_to_world(
  i : Int,
  j : Int,
  res : Int,
  size : Double,
) -> (Double, Double) {
  let cell = size / (res - 1).to_double()
  let half = size / 2.0
  (i.to_double() * cell - half, j.to_double() * cell - half)
}

///|
/// JSON 取数值字段(缺键/类型不符都 raise, 资产损坏尽早暴露)
fn jnum(obj : Map[String, Json], key : String) -> Double raise {
  match obj.get(key) {
    Some(Json::Number(v, ..)) => v
    _ => raise Failure("map.json 缺数值字段: \{key}")
  }
}

///|
fn jstr(obj : Map[String, Json], key : String) -> String raise {
  match obj.get(key) {
    Some(Json::String(s)) => s
    _ => raise Failure("map.json 缺字符串字段: \{key}")
  }
}

///|
/// [x, z] / [x, z, yaw] → SpawnPoint(yaw 缺省 0; map.json 出生点实发三元组)
fn parse_spawn(v : Json) -> SpawnPoint raise {
  let arr = match v {
    Json::Array(a) => a
    _ => raise Failure("spawn 不是数组")
  }
  if arr.length() < 2 {
    raise Failure("spawn 至少要 [x, z]: 长度 \{arr.length()}")
  }
  let num = fn(k : Int) -> Double raise {
    match arr[k] {
      Json::Number(d, ..) => d
      _ => raise Failure("spawn[\{k}] 不是数值")
    }
  }
  let yaw = if arr.length() > 2 {
    match arr[2] {
      Json::Number(d, ..) => d
      _ => raise Failure("spawn[2] 不是数值")
    }
  } else {
    0.0
  }
  { x: num(0), z: num(1), yaw, }
}

///|
/// covers 条目: { type, x, z, yaw?, scale? }
fn parse_cover(v : Json) -> MapCover raise {
  let obj = match v {
    Json::Object(m) => m
    _ => raise Failure("cover 不是 object")
  }
  let yaw = match obj.get("yaw") {
    Some(Json::Number(d, ..)) => d
    _ => 0.0
  }
  let scale = match obj.get("scale") {
    Some(Json::Number(d, ..)) => d
    _ => 1.0
  }
  { typ: jstr(obj, "type"), x: jnum(obj, "x"), z: jnum(obj, "z"), yaw, scale, }
}

///|
/// 短 id → 清单条目(CFG.maps.find(x=>x.id===id) 口径)。
fn map_entry_of(id : String) -> MapEntry raise {
  for m in maps_manifest {
    if m.id == id {
      return m
    }
  }
  raise Failure("未知地图 id: \{id}")
}

///|
/// 从已解析的 map.json 根构建 MapData(高程数组由调用方按 terrain 解码后传入)。
pub fn map_from_json(
  root : Json,
  dir : String,
  heights : FixedArray[Double],
) -> MapData raise {
  let obj = match root {
    Json::Object(m) => m
    _ => raise Failure("map.json 顶层不是 object")
  }
  // terrain { size, resolution, maxHeight }
  let terrain = match obj.get("terrain") {
    Some(Json::Object(t)) =>
      {
        size: jnum(t, "size"),
        resolution: jnum(t, "resolution").to_int(),
        max_height: jnum(t, "maxHeight"),
      }
    _ => raise Failure("map.json 缺 terrain 段")
  }
  let res = terrain.resolution
  if heights.length() != res * res {
    raise Failure(
      "高程数组长度 \{heights.length()} ≠ resolution² \{res * res}",
    )
  }
  // player { spawn: [x,z,yaw], spawns?: [[x,z,yaw]...] } —— 多点池缺省回退单点
  let player = match obj.get("player") {
    Some(Json::Object(p)) => p
    _ => raise Failure("map.json 缺 player 段")
  }
  let spawn_v = match player.get("spawn") {
    Some(v) => v
    None => raise Failure("map.json 缺 player.spawn")
  }
  let spawn = parse_spawn(spawn_v)
  let spawns : Array[SpawnPoint] = match player.get("spawns") {
    Some(Json::Array(a)) => {
      let out : Array[SpawnPoint] = []
      for v in a {
        out.push(parse_spawn(v))
      }
      out
    }
    _ => []
  }
  if spawns.is_empty() {
    spawns.push(spawn)
  }
  // covers / waves
  let covers : Array[MapCover] = match obj.get("covers") {
    Some(Json::Array(a)) => {
      let out : Array[MapCover] = []
      for v in a {
        out.push(parse_cover(v))
      }
      out
    }
    _ => []
  }
  let wave_count = match obj.get("waves") {
    Some(Json::Array(a)) => a.length()
    _ => 0
  }
  {
    id: jstr(obj, "id"),
    dir,
    name: jstr(obj, "name"),
    terrain,
    heights,
    spawn,
    spawns,
    covers,
    wave_count,
    raw: root,
  }
}

///|
/// 解析 map.json 文本为结构化 MapData(高程另行解码, 见 load_heightmap)。
pub fn parse_map_json(
  text : String,
  dir : String,
  heights : FixedArray[Double],
) -> MapData raise {
  map_from_json(@json.parse(text), dir, heights)
}

///|
/// 解码 16 位灰度高程 PNG → f32 圆整高程(米), 行主序 w*h。
/// 宽高必须与 terrain.resolution 一致(assets.js:50 隐含此约束, 这里显式把关)。
pub fn load_heightmap(
  png : Bytes,
  res : Int,
  max_height : Double,
) -> FixedArray[Double] raise {
  let (w, h, px) = @loaders.decode_png16_gray(png)
  if w != res || h != res {
    raise Failure(
      "高程图尺寸 \{w}×\{h} ≠ terrain.resolution \{res}×\{res}",
    )
  }
  // assets.js:53 h[i]=(v16/65535)*maxHeight, 载体 Float32Array → 逐元素 f32 圆整
  FixedArray::makei(res * res, fn(i) -> Double {
    Float::from_double(px[i].to_double() / 65535.0 * max_height).to_double()
  })
}

///|
/// 按短 id 装载地图(CFG.maps id 口径): map.json + heightmap.png 两件套,
/// 顺序与 assets.js:145-146 同(json 在前, 高程需要 terrain.resolution/maxHeight 缩放)。
pub async fn load_map(id : String) -> MapData {
  let entry = map_entry_of(id)
  let json_bytes = read_client_file("assets/maps/\{entry.dir}/map.json")
  let text = @utf8.decode(json_bytes)
  let root : Json = @json.parse(text)
  let terrain_obj = match root {
    Json::Object(m) =>
      match m.get("terrain") {
        Some(Json::Object(t)) => t
        _ => raise Failure("map.json 缺 terrain 段")
      }
    _ => raise Failure("map.json 顶层不是 object")
  }
  let res = jnum(terrain_obj, "resolution").to_int()
  let max_height = jnum(terrain_obj, "maxHeight")
  let png = read_client_file("assets/maps/\{entry.dir}/heightmap.png")
  let heights = load_heightmap(png, res, max_height)
  map_from_json(root, entry.dir, heights)
}
