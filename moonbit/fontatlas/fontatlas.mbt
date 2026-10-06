// fontatlas — 字形图集烘焙。管线:
//   TTF 子集字节 → @font.parse_font → 逐码点 @font.rasterize_glyph(白字+alpha
//   覆盖) → shelf 装箱进一张 RGBA 图集(2px 间距防线性采样渗色) → three-native
//   Texture::from_rgba(自带 mip 链)。
// 排布信息(均经实证标定, 见 fontatlas_test 探针):
//   位图是 svg y-down 直写的翻转图(基线贴顶)→ blit 时行翻转成图像惯例;
//   ox = x_min-1(rasterize pad=1 的左缘), 翻转后位图内基线行 = h-y_max-2,
//   故 oy = y_max+2-h(位图顶相对基线, 屏幕 y 向下为负=向上)。
//   文本排版走 @font.layout_text: x_offset 是累计笔位(含 kerning),
//   x_advance 是本字形步进, 落位 = 起点 + x_offset, 不再自行累加。

///|
/// HUD 默认码点集: ASCII 可打印段 + 常用符号(度/中点/书名角/乘号/破折号/
/// 省略/箭头/约等/几何形状/星/勾)。字体缺的码点烘焙期自动跳过。
pub fn hud_codepoints() -> Array[Int] {
  let cps : Array[Int] = []
  for cp in 0x20..<0x7F {
    cps.push(cp)
  }
  for
    cp in [
      0xB0, // ° 度
       0xB7, // · 中点
       0xAB, // «
       0xBB, // » 击杀播报分隔
       0xD7, // × 乘
       0x2013, // –
       0x2014, // —
       0x2026, // …
       0x2192, // →
       0x2248, // ≈
       0x25B2, // ▲
       0x25B8, // ▸
       0x25CF, // ●
       0x25A0, // ■
       0x2605, // ★
       0x2713, // ✓
    ] {
    cps.push(cp)
  }
  cps
}

///|
/// 单字形在图集里的落位 + 相对笔位(基线原点)的偏移(排版像素, y 向下)
pub(all) struct GlyphInfo {
  cp : Int
  /// 图集内矩形(纹理 UV; v=0 对应位图首行 —— 纹理按行上传无翻转)
  u0 : Double
  v0 : Double
  u1 : Double
  v1 : Double
  /// 位图尺寸(px)
  w : Double
  h : Double
  /// 位图左上角相对笔位的偏移(px)
  ox : Double
  oy : Double
}

///|
/// 烘焙产物: 图集纹理 + 字形表 + 字体引用(排版量宽用)
pub(all) struct FontAtlas {
  texture : @core.Texture
  width : Int
  height : Int
  size_px : Double
  font : @font.TTFont
  glyphs : Map[Int, GlyphInfo]
}

///|
/// 装箱游标(shelf: 一行排满换行, 行高取行内最大)
priv struct Shelf {
  mut x : Int
  mut y : Int
  mut row_h : Int
}

///|
/// 烘焙一张字形图集。atlas_w/atlas_h 建议二次幂(512×256 足够 ASCII+符号
/// 单字号); 图集写满时剩余码点跳过(返回的 glyphs 即实际烘焙集)。
pub fn FontAtlas::bake(
  data : Bytes,
  size_px : Double,
  atlas_w : Int,
  atlas_h : Int,
  cps : Array[Int],
) -> FontAtlas raise {
  let font = match @font.parse_font(data) {
    Some(f) => f
    None => raise Failure("字体解析失败(非 TTF/OTF/WOFF?)")
  }
  let pixels : FixedArray[Byte] = FixedArray::make(
    atlas_w * atlas_h * 4,
    b'\x00',
  )
  let shelf = { x: 1, y: 1, row_h: 0, }
  let glyphs : Map[Int, GlyphInfo] = Map([], capacity=128)
  for cp in cps {
    let bm = match @font.rasterize_glyph(font, cp, size_px) {
      Some(bm) => bm
      None => continue // 空白字符(空格等无轮廓)或字体缺字形
    }
    // 换行判定(2px 间距)
    if shelf.x + bm.width + 2 > atlas_w {
      shelf.x = 1
      shelf.y = shelf.y + shelf.row_h + 2
      shelf.row_h = 0
    }
    if shelf.y + bm.height + 2 > atlas_h {
      break // 图集满
    }
    // blit 白字 + alpha 覆盖(GlyphBitmap.pixels 是 RGBA 平铺 Array[Int])。
    // 行序翻转: mizchi rasterize 的位图是 svg y-down 直写的翻转图(基线贴顶,
    // 'L' 横杠在首行实证), 此处翻成图像惯例的顶行在首
    for j in 0..<bm.height {
      let src_j = bm.height - 1 - j
      for i in 0..<bm.width {
        let o = (src_j * bm.width + i) * 4
        let a = bm.pixels[o + 3]
        if a > 0 {
          let d = ((shelf.y + j) * atlas_w + shelf.x + i) * 4
          pixels[d] = (255 : Int).to_byte()
          pixels[d + 1] = (255 : Int).to_byte()
          pixels[d + 2] = (255 : Int).to_byte()
          pixels[d + 3] = a.to_byte()
        }
      }
    }
    // 位图相对笔位(基线原点)的偏移:
    //   ox = 位图左缘在 svg 系的 x = x_min - 1(rasterize pad=1)
    //   oy = -(位图内基线行); 翻转后基线行 = h - y_max - 2(y_max=svg 系包盒
    //   上缘, rasterize ty=y_max+1 把基线放在原始第 y_max+1 行)
    let outline = font.scaled_outline(cp, size_px)
    let (x_min, _y_min, _x_max, y_max) = @font.outline_bbox(outline)
    glyphs[cp] = {
      cp,
      u0: shelf.x.to_double() / atlas_w.to_double(),
      v0: shelf.y.to_double() / atlas_h.to_double(),
      u1: (shelf.x + bm.width).to_double() / atlas_w.to_double(),
      v1: (shelf.y + bm.height).to_double() / atlas_h.to_double(),
      w: bm.width.to_double(),
      h: bm.height.to_double(),
      ox: x_min - 1.0,
      oy: y_max + 2.0 - bm.height.to_double(),
    }
    shelf.x = shelf.x + bm.width + 2
    if bm.height > shelf.row_h {
      shelf.row_h = bm.height
    }
  }
  let texture = @core.Texture::from_rgba(
    atlas_w,
    atlas_h,
    Bytes::from_array(pixels[:]),
  )
  texture.wrap_s = @core.Wrapping::ClampToEdge
  texture.wrap_t = @core.Wrapping::ClampToEdge
  texture.mag_filter = @core.TextureFilter::Linear
  texture.min_filter = @core.TextureFilter::Linear
  { texture, width: atlas_w, height: atlas_h, size_px, font, glyphs, }
}

///|
/// 已烘焙字形数(空格等无轮廓字形不在内)
pub fn FontAtlas::glyph_count(self : FontAtlas) -> Int {
  self.glyphs.length()
}

///|
/// 是否有该码点的可画字形
pub fn FontAtlas::has(self : FontAtlas, cp : Int) -> Bool {
  self.glyphs.get(cp) is Some(_)
}

///|
/// 文本宽度(px): layout_text 的 x_advance 求和(带 kerning, 同排版路径)
pub fn FontAtlas::measure(self : FontAtlas, text : String) -> Double {
  let mut w = 0.0
  for pos in self.font.layout_text(text, self.size_px) {
    w = w + pos.x_advance
  }
  w
}

///|
/// 行高(px)(字号 × 1.25, HUD 单行/等距行距口径)
pub fn FontAtlas::line_height(self : FontAtlas) -> Double {
  self.size_px * 1.25
}

///|
/// 逐字形落位: 把 text 的每个可画字形以矩形回调吐出(左上角 x,y 排版像素,
/// y 向下; u/v 为图集 UV)。缺字形码点(空格/未烘焙)只推进笔位不吐矩形。
pub fn FontAtlas::layout(
  self : FontAtlas,
  text : String,
  x0 : Double,
  y0 : Double,
  emit : (Double, Double, Double, Double, Double, Double, Double, Double) -> Unit,
) -> Unit {
  // layout_text 的 x_offset 是累计笔位(含 kerning), x_advance 是本字形步进;
  // 字形落位 = 起点 + x_offset, 不再自行累加(叠加会 ~2× 字距)
  for pos in self.font.layout_text(text, self.size_px) {
    match self.glyphs.get(pos.codepoint) {
      Some(g) =>
        emit(
          x0 + pos.x_offset + g.ox,
          y0 + g.oy,
          g.w,
          g.h,
          g.u0,
          g.v0,
          g.u1,
          g.v1,
        )
      None => ()
    }
  }
}
