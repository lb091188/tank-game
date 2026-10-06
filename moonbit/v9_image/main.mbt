// 阶段0-V9:高程图 PNG16 精确解码(自写,复用 @zlib)+ JPG 纹理解码(@image)。
// 期望值来源:docs/Windows验证清单.md V9 表(PIL 在 Linux 实测,2026-10-05)。
// 背景结论:mizchi/image 的 decode_png 不支持 16 位(png_color.mbt 兜底
// UnsupportedFeature),而高程图语义 v16 = R*256+G 必须精确 —— 与服务端
// server.js:91-117 的手解实现逐位一致,客户端/服务器高度才不分叉。
// 本实验即为迁移侧 PNG16 解码器的第一版:非交错、灰度、16 位、5 种 filter。

///|
/// 读 4 字节大端 u32
fn be32(b : Bytes, p : Int) -> Int {
  (b[p].to_int() << 24) |
  (b[p + 1].to_int() << 16) |
  (b[p + 2].to_int() << 8) |
  b[p + 3].to_int()
}

///| PNG16 灰度精确解码:返回 (width, height, 像素 u16 数组)

///|
/// 仅支持 color_type=0(灰度)、bit_depth=16、非交错 —— 高程图全是这种
fn decode_png16_gray(raw : Bytes) -> (Int, Int, FixedArray[Int]) raise Error {
  let mut width = 0
  let mut height = 0
  let idat : Array[(Int, Int)] = [] // (start, len)
  let mut pos = 8 // 跳过签名
  let mut seen_ihdr = false
  while pos + 8 <= raw.length() {
    let len = be32(raw, pos)
    let t0 = raw[pos + 4].to_int()
    let t1 = raw[pos + 5].to_int()
    let t2 = raw[pos + 6].to_int()
    let t3 = raw[pos + 7].to_int()
    let data_start = pos + 8
    if t0 == 0x49 && t1 == 0x48 && t2 == 0x44 && t3 == 0x52 { // IHDR
      width = be32(raw, data_start)
      height = be32(raw, data_start + 4)
      let bit_depth = raw[data_start + 8].to_int()
      let color_type = raw[data_start + 9].to_int()
      let interlace = raw[data_start + 12].to_int()
      if bit_depth != 16 || color_type != 0 {
        raise Failure(
          "本解码器只管 16 位灰度: 实际 depth=\{bit_depth} color=\{color_type}",
        )
      }
      if interlace != 0 {
        raise Failure("不支持交错 PNG")
      }
      seen_ihdr = true
    } else if t0 == 0x49 && t1 == 0x44 && t2 == 0x41 && t3 == 0x54 { // IDAT
      idat.push((data_start, len))
    }
    pos += 12 + len // len + type + crc
  }
  if not(seen_ihdr) {
    raise Failure("没有 IHDR")
  }
  if idat.is_empty() {
    raise Failure("没有 IDAT")
  }
  // IDAT 串接
  let mut total = 0
  for c in idat {
    total += c.1
  }
  let joined = FixedArray::make(total, b'\x00')
  let mut off = 0
  for c in idat {
    joined.blit_from_bytes(off, raw, c.0, c.1)
    off += c.1
  }
  let inflated = @zlib.zlib_decompress(Bytes::from_array(joined)) catch {
    e => raise Failure("zlib inflate 失败: \{e}")
  }
  // 反滤波:每行 = 1 filter 字节 + width*2 数据;bpp=2(16 位灰度)
  let bpp = 2
  let stride = width * 2
  if inflated.length() != height * (1 + stride) {
    raise Failure(
      "尺寸不符: 期望 \{height * (1 + stride)} 实得 \{inflated.length()}",
    )
  }
  let pixels = FixedArray::make(width * height, 0)
  let cur : FixedArray[Byte] = FixedArray::make(stride, b'\x00')
  let prev : FixedArray[Byte] = FixedArray::make(stride, b'\x00')
  for y in 0..<height {
    let base = y * (1 + stride)
    let ft = inflated[base].to_int()
    for i in 0..<stride {
      let x = inflated[base + 1 + i].to_int() & 0xFF
      let a = if i >= bpp { cur[i - bpp].to_int() & 0xFF } else { 0 }
      let b = prev[i].to_int() & 0xFF
      let v : Int = match ft {
        0 => x
        1 => (x + a) & 0xFF // Sub
        2 => (x + b) & 0xFF // Up
        3 => (x + ((a + b) >> 1)) & 0xFF // Average
        4 => { // Paeth
          let c = if i >= bpp { prev[i - bpp].to_int() & 0xFF } else { 0 }
          let p = a + b - c
          let pa = if p - a < 0 { a - p } else { p - a }
          let pb = if p - b < 0 { b - p } else { p - b }
          let pc = if p - c < 0 { c - p } else { p - c }
          let pr = if pa <= pb && pa <= pc {
            a
          } else if pb <= pc {
            b
          } else {
            c
          }
          (x + pr) & 0xFF
        }
        _ => raise Failure("未知 filter 类型 \{ft}")
      }
      cur[i] = v.to_byte()
    }
    for x in 0..<width {
      pixels[y * width + x] = ((cur[x * 2].to_int() & 0xFF) << 8) |
        (cur[x * 2 + 1].to_int() & 0xFF)
    }
    for i in 0..<stride {
      prev[i] = cur[i]
    }
  }
  (width, height, pixels)
}

///|
async fn main {
  // ---- 高程图:自写 PNG16 精确解码,对 PIL 期望值 ----
  let cases : Array[(String, Array[((Int, Int), Int)])] = [
    (
      "l01-encounter",
      [
        ((0, 0), 60129),
        ((143, 143), 6706),
        ((287, 287), 60243),
        ((100, 50), 23949),
      ],
    ),
    (
      "l06-winter",
      [
        ((0, 0), 57966),
        ((143, 143), 4946),
        ((287, 287), 57864),
        ((100, 50), 6892),
      ],
    ),
  ]
  let all_pass = Ref(true)
  for cmap in cases {
    let (map, samples) = cmap
    let path = "../client/assets/maps/\{map}/heightmap.png"
    let size = @fs.file_size(path)
    let f = @fs.open(path, mode=ReadOnly)
    let raw = f.read_exactly_at(size.to_int(), position=0)
    f.close()
    let decoded = try? decode_png16_gray(raw)
    match decoded {
      Err(e) => {
        println("[FAIL] \{map}: 解码失败 \{e}")
        all_pass.val = false
      }
      Ok((w, h, px)) => {
        println("[INFO] \{map}: \{w}×\{h}")
        for s in samples {
          let ((x, y), want) = s
          let got = px[y * w + x]
          let ok = got == want
          if not(ok) {
            all_pass.val = false
          }
          println(
            "[\{if ok { "PASS" } else { "FAIL" }}] \{map} (\{x},\{y}) = \{got} 期望 \{want}",
          )
        }
      }
    }
  }
  // ---- JPG 纹理:@image.decode_jpeg 验尺寸 ----
  let jpgs : Array[(String, Int, Int)] = [
    ("asphalt", 1024, 662),
    ("rust", 1024, 256),
  ]
  for j in jpgs {
    let (name, ew, eh) = j
    let path = "../client/assets/textures/\{name}.jpg"
    let size = @fs.file_size(path)
    let f = @fs.open(path, mode=ReadOnly)
    let raw = f.read_exactly_at(size.to_int(), position=0)
    f.close()
    let img = try? @image.decode_jpeg(raw)
    match img {
      Err(e) => {
        println("[FAIL] \{name}.jpg: 解码失败 \{e}")
        all_pass.val = false
      }
      Ok(im) => {
        let ok = im.width == ew && im.height == eh
        if not(ok) {
          all_pass.val = false
        }
        println(
          "[\{if ok { "PASS" } else { "FAIL" }}] \{name}.jpg = \{im.width}×\{im.height} 期望 \{ew}×\{eh}",
        )
      }
    }
  }
  println(
    if all_pass.val {
      "V9 结论: 全部通过 —— PNG16 自写解码器精确命中,JPG 用 mizchi/image"
    } else {
      "V9 结论: 存在失败项,见上"
    },
  )
}
