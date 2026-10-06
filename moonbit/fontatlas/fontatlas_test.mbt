// fontatlas 测试: 用仓内字体子集 fixtures/fonts/HudFont.ttf 烘焙,
// 校验字形落位/量宽/空格跳过/UV 有序/图集有非零覆盖。

///|
/// 读仓内字体子集(与 gameapp 同一组候选前缀, cwd 兼容模块根/仓根)
fn test_font_data() -> Bytes raise {
  for
    path in [
      "fixtures/fonts/HudFont.ttf", "moonbit/fixtures/fonts/HudFont.ttf", "../moonbit/fixtures/fonts/HudFont.ttf",
    ] {
    try {
      return read_test_file(path)
    } catch {
      _ => ()
    }
  }
  raise Failure("fixtures/fonts/HudFont.ttf 未找到")
}

///|
/// 黑盒 C stdio 读文件(测试专用, 不引 gameapp 的 FFI)
#borrow(path, mode)
extern "c" fn test_fopen(path : Bytes, mode : Bytes) -> UInt64 = "fopen"

///|
#borrow(buf, f)
extern "c" fn test_fread(
  buf : Bytes,
  size : UInt64,
  n : UInt64,
  f : UInt64,
) -> UInt64 = "fread"

///|
extern "c" fn test_fseek(f : UInt64, off : UInt64, whence : Int) -> Int = "fseek"

///|
extern "c" fn test_ftell(f : UInt64) -> UInt64 = "ftell"

///|
extern "c" fn test_fclose(f : UInt64) -> Int = "fclose"

///|
fn read_test_file(path : String) -> Bytes raise {
  let zpath : Bytes = @utf8.encode(path) + b"\x00"
  let f = test_fopen(zpath, b"rb\x00")
  if f == 0 {
    raise Failure("打不开 \{path}")
  }
  ignore(test_fseek(f, 0UL, 2))
  let len = test_ftell(f).reinterpret_as_int64().to_int()
  ignore(test_fseek(f, 0UL, 0))
  let buf = Bytes::makei(len, _ => b'\x00')
  let got = test_fread(buf, 1UL, len.to_uint64(), f)
  ignore(test_fclose(f))
  if got.reinterpret_as_int64().to_int() != len {
    raise Failure("读不完整 \{path}")
  }
  buf
}

///|
/// 烘一张标准 HUD 图集(18px, 512×256)
fn bake_hud_atlas() -> @fontatlas.FontAtlas raise {
  @fontatlas.FontAtlas::bake(
    test_font_data(),
    18.0,
    512,
    256,
    @fontatlas.hud_codepoints(),
  )
}

///|
test "烘焙覆盖: ASCII 大部分字形 + 符号子集在图集里" {
  let atlas = bake_hud_atlas()
  // 可打印 ASCII 里绝大多数应有字形(缺的个别符号可容忍, 门槛 90/95)
  let mut ascii_hits = 0
  for cp in 0x21..<0x7F {
    if atlas.has(cp) {
      ascii_hits += 1
    }
  }
  assert_true(ascii_hits >= 90)
  // 符号: »(击杀播报分隔)必须有; 空格无轮廓不在图集
  assert_true(atlas.has(0xBB))
  assert_false(atlas.has(0x20))
  assert_true(atlas.glyph_count() > 90)
}

///|
test "字形落位: UV 有序且在 [0,1], 宽高为正" {
  let atlas = bake_hud_atlas()
  for _k, g in atlas.glyphs {
    assert_true(g.u0 >= 0.0 && g.u1 > g.u0 && g.u1 <= 1.0)
    assert_true(g.v0 >= 0.0 && g.v1 > g.v0 && g.v1 <= 1.0)
    assert_true(g.w > 0.0 && g.h > 0.0)
  }
}

///|
test "量宽: 非空文本宽度>0, 空串为 0, 宽文本更宽" {
  let atlas = bake_hud_atlas()
  assert_true(atlas.measure("HP 900/900") > 0.0)
  assert_eq(atlas.measure(""), 0.0)
  assert_true(atlas.measure("HP 900/900 LONGER") > atlas.measure("HP 900/900"))
}

///|
test "排版: 每个字形矩形在行框内, x 随笔位单调; 空格只推进不吐字形" {
  let atlas = bake_hud_atlas()
  let rects : Array[(Double, Double, Double, Double)] = []
  atlas.layout("TANK 5", 10.0, 100.0, fn(x, y, w, h, _u0, _v0, _u1, _v1) {
    rects.push((x, y, w, h))
  })
  // "TANK 5" 5 个可见字形(TANK=4 + 5, 空格跳过)
  assert_eq(rects.length(), 5)
  // x 随笔位单调不减; 每个字形在行框内(y 向下: 基线 100, 上下各一行高)
  for i, r in rects {
    if i > 0 {
      assert_true(r.0 >= rects[i - 1].0)
    }
    assert_true(r.1 > 100.0 - atlas.line_height())
    assert_true(r.1 + r.3 < 100.0 + atlas.line_height())
  }
}

///|
test "layout 不吐缺字形码点" {
  let atlas = bake_hud_atlas()
  let mut n = 0
  atlas.layout("a~\u{4e2d}", 0.0, 0.0, fn(_x, _y, _w, _h, _u0, _v0, _u1, _v1) {
    n += 1
  })
  // 子集无 CJK(中), ASCII 的 a 与 ~(0x7E) 若都在则 2 个
  assert_true(n == 2 || n == 1)
}

///|
test "落位回归: 'A' 基线在 y0(翻转位图的基线行 = h-y_max-2 口径)" {
  let atlas = bake_hud_atlas()
  let rects : Array[(Double, Double)] = []
  atlas.layout("A", 0.0, 0.0, fn(x, y, _w, _h, _u0, _v0, _u1, _v1) {
    rects.push((x, y))
  })
  assert_eq(rects.length(), 1)
  // 'A' 无左伸: 位图左缘≈pad, ox≈x_min-1≈-0.91
  assert_true((rects[0].0 - -0.91).abs() < 0.2)
  // 帽高 13.12 + 上下 pad: 位图顶在基线上方 ~14px(实证口径, 见 oy 公式)
  assert_true((rects[0].1 - -14.0).abs() < 1.5)
}

///|
test "rasterize 行序回归: 原始位图基线贴顶('L' 横杠在首行, blit 需翻转)" {
  let atlas = bake_hud_atlas()
  let bm = @font.rasterize_glyph(atlas.font, 0x4C, 18.0).unwrap()
  fn row_ink(j : Int) -> Int {
    let mut ink = 0
    for i in 0..<bm.width {
      let o = (j * bm.width + i) * 4
      if bm.pixels[o + 3] > 40 {
        ink += 1
      }
    }
    ink
  }

  // 原始位图: 宽横杠(基线)在顶部行, 窄竖干在底部行 → 与图像惯例相反,
  // fontatlas blit 据此做行翻转; 若上游行为变化, 在此先红
  let top = row_ink(1) + row_ink(2)
  let bottom = row_ink(bm.height - 3) + row_ink(bm.height - 2)
  assert_true(top > bottom)
}
