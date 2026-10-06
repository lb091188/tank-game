// glbfix.mbt — dataURI → bufferView 的 GLB 容器重写(纯字节操作, 不依赖 three-native)。
// 容器布局(glTF 2.0): header 12B(magic/version/length) + chunk 8B 头(len/type)+数据。

///|
const GLB_MAGIC : UInt = 0x46546C67U // 'glTF' 小端

///|
const CHUNK_JSON : UInt = 0x4E4F534AU // 'JSON' 小端

///|
const CHUNK_BIN : UInt = 0x004E4942U // 'BIN\0' 小端

///|
const URI_PFX_PNG : String = "data:image/png;base64,"

///|
const URI_PFX_JPG : String = "data:image/jpeg;base64,"

///|
/// u32 小端读
fn u32le(raw : Bytes, p : Int) -> UInt {
  raw[p].to_int().reinterpret_as_uint() |
  (raw[p + 1].to_int().reinterpret_as_uint() << 8) |
  (raw[p + 2].to_int().reinterpret_as_uint() << 16) |
  (raw[p + 3].to_int().reinterpret_as_uint() << 24)
}

///|
/// u32 小端写
fn u32b(v : UInt) -> Bytes {
  Bytes::makei(4, i => ((v >> (i * 8)) & 0xFFU).to_byte())
}

///|
/// 拼接字节串
fn cat(parts : Array[Bytes]) -> Bytes {
  let n = parts.fold(init=0, fn(a, p) { a + p.length() })
  let out : FixedArray[Byte] = FixedArray::make(n, b'\x00')
  let mut off = 0
  for p in parts {
    for i in 0..<p.length() {
      out.set(off + i, p[i])
    }
    off += p.length()
  }
  Bytes::from_array(out[:])
}

///|
/// 字节区间拷贝
fn slice(raw : Bytes, off : Int, len : Int) -> Bytes {
  Bytes::makei(len, i => raw[off + i])
}

///|
/// 识别 dataURI 图: 返回 (mimeType, base64 载荷); 非法图返 None
fn datauri_of(uri : String) -> (String, String)? {
  if uri.length() > URI_PFX_PNG.length() &&
    uri.substring(end=URI_PFX_PNG.length()) == URI_PFX_PNG {
    return Some(("image/png", uri.substring(start=URI_PFX_PNG.length())))
  }
  if uri.length() > URI_PFX_JPG.length() &&
    uri.substring(end=URI_PFX_JPG.length()) == URI_PFX_JPG {
    return Some(("image/jpeg", uri.substring(start=URI_PFX_JPG.length())))
  }
  None
}

///|
/// 把 GLB 里 images[i].uri 的 dataURI 内嵌贴图重写为 bufferView 引用:
/// 解码后的图数据追加到 BIN chunk 末尾(4 字节对齐), buffers[0].byteLength 同步;
/// 无 images / 无 dataURI 图时原字节返回(early-out, 不动容器)。
pub fn patch_glb_datauri(raw : Bytes) -> Bytes raise {
  if raw.length() < 20 {
    raise Failure("GLB 过短: \{raw.length()} 字节")
  }
  if u32le(raw, 0) != GLB_MAGIC {
    raise Failure("GLB magic 不符: \{u32le(raw, 0)}")
  }
  let json_len = u32le(raw, 12).reinterpret_as_int()
  if json_len <= 0 || 20 + json_len > raw.length() {
    raise Failure("GLB JSON chunk 长度非法: \{json_len}")
  }
  // 定位 BIN chunk(GLB 可无 BIN)
  let mut bin_off = -1
  let mut bin_len = 0
  let mut off = 20 + json_len
  while off + 8 <= raw.length() {
    let cl = u32le(raw, off).reinterpret_as_int()
    if cl < 0 || off + 8 + cl > raw.length() {
      raise Failure("GLB chunk 长度非法: \{cl} @\{off}")
    }
    if u32le(raw, off + 4) == CHUNK_BIN {
      bin_off = off + 8
      bin_len = cl
      break
    }
    off += 8 + cl
  }
  let root : Json = @json.parse(@utf8.decode(slice(raw, 20, json_len)))
  let obj = match root {
    Json::Object(m) => m
    _ => raise Failure("GLB JSON 顶层不是 object")
  }
  let images : Array[Json] = match obj.get("images") {
    Some(Json::Array(a)) => a
    _ => return raw // 无 images 段: 无可改, 原样返回
  }
  // 收集 dataURI 图 → (mime, 解码字节); 一个都没有则原样返回
  let decoded : Array[(String, Bytes)] = []
  for img in images {
    match img {
      Json::Object(im) =>
        match im.get("uri") {
          Some(Json::String(u)) =>
            match datauri_of(u) {
              Some((mime, payload)) => {
                let data = @base64.decode(payload) catch {
                  _ => @base64.decode_lossy(payload)
                }
                decoded.push((mime, data))
              }
              None => ()
            }
          _ => ()
        }
      _ => ()
    }
  }
  if decoded.is_empty() {
    return raw
  }
  // BIN 重排: 旧 BIN(补齐 4 对齐) + 每张图(补齐 4 对齐), 记下各图 byteOffset
  let bin_parts : Array[Bytes] = []
  if bin_off >= 0 {
    bin_parts.push(slice(raw, bin_off, bin_len))
  }
  let pad0 = (4 - bin_len % 4) % 4
  if pad0 > 0 {
    bin_parts.push(Bytes::makei(pad0, _ => b'\x00'))
  }
  let mut cursor = bin_len + pad0
  let offsets : Array[Int] = []
  for _, entry in decoded {
    let (_, data) = entry
    offsets.push(cursor)
    bin_parts.push(data)
    let pad = (4 - data.length() % 4) % 4
    if pad > 0 {
      bin_parts.push(Bytes::makei(pad, _ => b'\x00'))
    }
    cursor += data.length() + pad
  }
  // 改写 images[i] 与 bufferViews
  let bvs : Array[Json] = match obj.get("bufferViews") {
    Some(Json::Array(a)) => a
    _ => []
  }
  let base_bv = bvs.length()
  for k, entry in decoded {
    let (mime, data) = entry
    let im : Map[String, Json] = match images[k] {
      Json::Object(m) => m
      _ => raise Failure("images[\{k}] 不是 object")
    }
    im.remove("uri")
    im["mimeType"] = Json::string(mime)
    im["bufferView"] = Json::number(Double::from_int(base_bv + k))
    let bv : Map[String, Json] = Map::from_array([
      ("buffer", Json::number(0.0)),
      ("byteOffset", Json::number(Double::from_int(offsets[k]))),
      ("byteLength", Json::number(Double::from_int(data.length()))),
    ])
    bvs.push(Json::object(bv))
  }
  obj["bufferViews"] = Json::array(bvs)
  // buffers[0].byteLength 同步为新 BIN 总长
  match obj.get("buffers") {
    Some(Json::Array(bs)) =>
      if bs.length() > 0 {
        match bs[0] {
          Json::Object(bm) =>
            bm["byteLength"] = Json::number(Double::from_int(cursor))
          _ => raise Failure("buffers[0] 不是 object")
        }
      } else {
        raise Failure("GLB buffers 为空, 无法挂新增贴图")
      }
    _ => raise Failure("GLB 无 buffers 段, 无法挂新增贴图")
  }
  obj["images"] = Json::array(images)
  // 重排容器: JSON chunk 空格补齐 / BIN chunk 零补齐(各 4 字节倍数)
  let json_raw = @utf8.encode(root.stringify())
  let jpad = (4 - json_raw.length() % 4) % 4
  let json_chunk = cat([json_raw, Bytes::makei(jpad, _ => b' ')])
  let bin_chunk = cat(bin_parts)
  let total = 12 + 8 + json_chunk.length() + 8 + bin_chunk.length()
  cat([
    u32b(GLB_MAGIC) + u32b(2U) + u32b(total.reinterpret_as_uint()),
    u32b(json_chunk.length().reinterpret_as_uint()) + u32b(CHUNK_JSON),
    json_chunk,
    u32b(bin_chunk.length().reinterpret_as_uint()) + u32b(CHUNK_BIN),
    bin_chunk,
  ])
}
