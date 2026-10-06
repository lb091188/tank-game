// glbfix_wbtest.mbt — 重写器字节级单测(白盒: 直接用本包的 u32b/cat/slice 助手构造夹具)。

///|
test "patch_glb_datauri: 无 images 的 GLB 原样返回" {
  let json_str = "{\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],\"meshes\":[{\"primitives\":[{}]}],\"buffers\":[{\"byteLength\":0}]}"
  let jb = @utf8.encode(json_str)
  let jpad = (4 - jb.length() % 4) % 4
  let json_chunk = cat([jb, Bytes::makei(jpad, _ => b' ')])
  let glb = cat([
    u32b(GLB_MAGIC) +
    u32b(2U) +
    u32b((12 + 8 + json_chunk.length()).reinterpret_as_uint()),
    u32b(json_chunk.length().reinterpret_as_uint()) + u32b(CHUNK_JSON),
    json_chunk,
  ])
  let out = patch_glb_datauri(glb)
  assert_eq(out.length(), glb.length())
  assert_eq(out, glb)
}

///|
test "patch_glb_datauri: dataURI 图改写为 bufferView 全链路" {
  // 伪造 PNG 图字节(IHDR 魔数, 重写器不解码图像, 只搬运字节)
  let png : Bytes = cat([
    b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a", b"\x00\x00\x00\x40\x00\x00\x00\x60",
  ])
  let uri = "data:image/png;base64," + @base64.encode(png[:])
  // 旧 BIN: 6 字节(非 4 对齐, 顺带验证补齐), 1 个既有 bufferView(positions)
  let old_bin : Bytes = b"\x01\x02\x03\x04\x05\x06"
  let json_str = "{" +
    "\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}]," +
    "\"meshes\":[{\"primitives\":[{}]}]," +
    "\"images\":[{\"uri\":\"" +
    uri +
    "\"}]," +
    "\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":6}]," +
    "\"buffers\":[{\"byteLength\":6}]}"
  let jb = @utf8.encode(json_str)
  let jpad = (4 - jb.length() % 4) % 4
  let json_chunk = cat([jb, Bytes::makei(jpad, _ => b' ')])
  let bpad = (4 - old_bin.length() % 4) % 4
  let bin_chunk = cat([old_bin, Bytes::makei(bpad, _ => b'\x00')])
  let glb = cat([
    u32b(GLB_MAGIC) +
    u32b(2U) +
    u32b(
      (12 + 8 + json_chunk.length() + 8 + bin_chunk.length()).reinterpret_as_uint(),
    ),
    u32b(json_chunk.length().reinterpret_as_uint()) + u32b(CHUNK_JSON),
    json_chunk,
    u32b(bin_chunk.length().reinterpret_as_uint()) + u32b(CHUNK_BIN),
    bin_chunk,
  ])
  let out = patch_glb_datauri(glb)
  // 重排后容器结构合法
  assert_eq(u32le(out, 0), GLB_MAGIC)
  let json_len = u32le(out, 12).reinterpret_as_int()
  let root : Json = @json.parse(@utf8.decode(slice(out, 20, json_len)))
  let obj = match root {
    Json::Object(m) => m
    _ => abort("顶层不是 object")
  }
  // images[0]: uri 摘除, mimeType/bufferView 落定
  let imgs = match obj.get("images") {
    Some(Json::Array(a)) => a
    _ => abort("无 images")
  }
  assert_eq(imgs.length(), 1)
  match imgs[0] {
    Json::Object(im) => {
      assert_true(im.get("uri") is None)
      match im.get("bufferView") {
        Some(Json::Number(v, ..)) => assert_eq(v, 1.0) // 追加到既有 1 个 bufferView 之后
        _ => abort("缺 bufferView")
      }
      match im.get("mimeType") {
        Some(Json::String(s)) => assert_eq(s, "image/png")
        _ => abort("缺 mimeType")
      }
    }
    _ => abort("images[0] 不是 object")
  }
  // bufferViews[1]: 指向旧 BIN 补齐后的偏移, 长度=图字节数
  let bvs = match obj.get("bufferViews") {
    Some(Json::Array(a)) => a
    _ => abort("无 bufferViews")
  }
  assert_eq(bvs.length(), 2)
  let bv_off = match bvs[1] {
    Json::Object(bv) =>
      match bv.get("byteOffset") {
        Some(Json::Number(v, ..)) => v.to_int()
        _ => abort("缺 byteOffset")
      }
    _ => abort("bufferViews[1] 不是 object")
  }
  assert_eq(bv_off, 8) // 旧 BIN 6 字节补齐到 8
  let bv_len = match bvs[1] {
    Json::Object(bv) =>
      match bv.get("byteLength") {
        Some(Json::Number(v, ..)) => v.to_int()
        _ => abort("缺 byteLength")
      }
    _ => abort("bufferViews[1] 不是 object")
  }
  assert_eq(bv_len, png.length())
  // buffers[0].byteLength = 新 BIN 总长(旧 8 + 图 16 = 24, 图恰好 4 对齐)
  let buf_len = match obj.get("buffers") {
    Some(Json::Array(bs)) =>
      match bs[0] {
        Json::Object(bm) =>
          match bm.get("byteLength") {
            Some(Json::Number(v, ..)) => v.to_int()
            _ => abort("缺 byteLength")
          }
        _ => abort("buffers[0] 不是 object")
      }
    _ => abort("无 buffers")
  }
  assert_eq(buf_len, 8 + png.length())
  // BIN chunk 逐字节含原图
  let bin_off = 20 + json_len + 8
  let bin_total = u32le(out, 20 + json_len).reinterpret_as_int()
  assert_eq(bin_total, 8 + png.length())
  for i in 0..<png.length() {
    assert_eq(out[bin_off + bv_off + i], png[i])
  }
}
