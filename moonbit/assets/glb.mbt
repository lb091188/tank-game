// glb.mbt — GLB 坦克模型的清单式装载(client/js/assets.js loadGLB/getModel 的 MoonBit 侧)。
// 惰性语义: 按类型名经清单反查文件名, 现读现解析, 不预载(assets.js 的 modelJobs
// 并发去重对单线程 native 侧无意义, 缓存由 ModelStore 承担)。
// GLB 解析直接用 three-native loaders::load_glb(依赖走 moon.work 本地路径, 已验证);
// 已知卡点见 load_tank_glb 注释(7 个 dataURI 内嵌贴图车型会 panic)。

///|
/// GLB 容器头(纯字节探测, 不依赖 three-native, 清单完整性校验用)。
/// 布局见 glTF 2.0 规范: magic(4) version(4) length(4) | chunk0: length(4) type(4)。
pub(all) struct GlbHeader {
  version : UInt // 期望 2
  total_length : Int // 声明的总字节数
  json_length : Int // JSON chunk 长度
}

///|
const GLB_MAGIC : UInt = 0x46546C67U // 'glTF' 小端

///|
const CHUNK_JSON : UInt = 0x4E4F534AU // 'JSON' 小端

///|
/// 读 GLB 容器头并校验 magic/版本/长度/首 chunk 类型, 非法则 raise。
pub fn read_glb_header(raw : Bytes) -> GlbHeader raise {
  if raw.length() < 20 {
    raise Failure("GLB 过短: \{raw.length()} 字节")
  }
  let u32le = fn(p : Int) -> UInt {
    raw[p].to_int().reinterpret_as_uint() |
    (raw[p + 1].to_int().reinterpret_as_uint() << 8) |
    (raw[p + 2].to_int().reinterpret_as_uint() << 16) |
    (raw[p + 3].to_int().reinterpret_as_uint() << 24)
  }
  let magic = u32le(0)
  if magic != GLB_MAGIC {
    raise Failure("GLB magic 不符: \{magic} 期望 \{GLB_MAGIC}")
  }
  let version = u32le(4)
  // 长度走 Int 口径(GLB 总长 < 2^31, reinterpret_as_int 与数值一致)
  let total = u32le(8).reinterpret_as_int()
  let json_len = u32le(12).reinterpret_as_int()
  if u32le(16) != CHUNK_JSON {
    raise Failure("GLB 首 chunk 非 JSON")
  }
  if total > raw.length() {
    raise Failure("GLB 声明长度 \{total} 超出实际 \{raw.length()}")
  }
  if json_len <= 0 || 20 + json_len > raw.length() {
    raise Failure("GLB JSON chunk 长度非法: \{json_len}")
  }
  { version, total_length: total, json_length: json_len, }
}

///|
/// 模型字节缓存: 惰性装载 + 按类型名去重(对齐 assets.js "已载即回, 进行中去重"的意图;
/// native 侧单线程, 一个 Map 即可)。
pub(all) struct ModelStore {
  mut bytes_cache : Map[String, Bytes]
}

///|
pub fn ModelStore::new() -> ModelStore {
  { bytes_cache: Map([], capacity=129), }
}

///|
/// 按类型名读 GLB 原始字节(缓存命中直接回; assets.js:115-124 getModel 的字节层)。
pub async fn ModelStore::get_bytes(self : ModelStore, typ : String) -> Bytes {
  match self.bytes_cache.get(typ) {
    Some(b) => b
    None => {
      let raw = read_model_bytes(typ)
      self.bytes_cache[typ] = raw
      raw
    }
  }
}

///|
/// 按类型名读 GLB 并经 three-native 解析为场景根 Object3D
/// (assets.js loadGLB→gltf.scene 对应物; 装配层再走 find_node_by_name 找 turret/gun/muzzle,
/// 见 three-native loaders/gltf.mbt:493 与 client/js/models.js:54-56 同名约定)。
///
/// 已知卡点(2026-10-06 实测): 7 个车型的内嵌贴图是 dataURI(enemy-medium / enemy-td /
/// enemy-heavy / m4-sherman / m4a3e8 / m4a3e2-jumbo / stug3), three-native
/// load_embedded_texture(loaders/gltf.mbt:174-175)只认 images[i].bufferView,
/// 对 dataURI 直接 unwrap(None) → PanicError 不可捕获, 解析这 7 型会中止进程。其余 122 型(无贴图)解析正常,
/// 已在单测以 pz4/t34 验证。dataURI 支持需改 three-native(副本仓外, 不在本次范围)。
pub async fn load_tank_glb(store : ModelStore, typ : String) -> @core.Object3D {
  @loaders.load_glb(store.get_bytes(typ))
}

///|
/// 清单校验: 类型名是否在 model_files(assets.js A.hasModel)。
pub fn has_model(typ : String) -> Bool {
  file_of_type(typ) is Some(_)
}

///|
/// 按类型名读模型字节(不走缓存; 未知类型 raise, 对齐 assets.js:119 的拒绝语义)。
pub async fn read_model_bytes(typ : String) -> Bytes {
  match file_of_type(typ) {
    Some(f) => read_client_file("assets/models/\{f}.glb")
    None => raise Failure("未知坦克类型: \{typ}")
  }
}

///|
/// 读 client/ 资产文件字节(resolve_client 定位 + @fs 全量读)。
pub async fn read_client_file(url : String) -> Bytes {
  let path = resolve_client(url)
  let size = @fs.file_size(path)
  let f = @fs.open(path, mode=ReadOnly)
  let raw = f.read_exactly_at(size.to_int(), position=0)
  f.close()
  raw
}
