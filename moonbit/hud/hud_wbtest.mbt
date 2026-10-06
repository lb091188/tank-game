// hud 测试: 屏幕坐标换算/播报寿命/血量分段色/文字几何落位/整表刷新逻辑
// (纯 CPU 路径; 渲染器不绑, invalidate 静默跳过 —— GPU 证据走 gameapp 截图)。

///|
/// C stdio 读文件(与 fontatlas 测试同源)
#borrow(path, mode)
extern "c" fn hud_fopen(path : Bytes, mode : Bytes) -> UInt64 = "fopen"

///|
#borrow(buf, f)
extern "c" fn hud_fread(
  buf : Bytes,
  size : UInt64,
  n : UInt64,
  f : UInt64,
) -> UInt64 = "fread"

///|
extern "c" fn hud_fseek(f : UInt64, off : UInt64, whence : Int) -> Int = "fseek"

///|
extern "c" fn hud_ftell(f : UInt64) -> UInt64 = "ftell"

///|
extern "c" fn hud_fclose(f : UInt64) -> Int = "fclose"

///|
fn hud_read_file(path : String) -> Bytes raise {
  let f = hud_fopen(@utf8.encode(path) + b"\x00", b"rb\x00")
  if f == 0 {
    raise Failure("打不开 \{path}")
  }
  ignore(hud_fseek(f, 0UL, 2))
  let len = hud_ftell(f).reinterpret_as_int64().to_int()
  ignore(hud_fseek(f, 0UL, 0))
  let buf = Bytes::makei(len, _ => b'\x00')
  let got = hud_fread(buf, 1UL, len.to_uint64(), f)
  ignore(hud_fclose(f))
  if got.reinterpret_as_int64().to_int() != len {
    raise Failure("读不完整 \{path}")
  }
  buf
}

///|
fn hud_test_font() -> Bytes raise {
  for
    path in ["fixtures/fonts/HudFont.ttf", "moonbit/fixtures/fonts/HudFont.ttf"] {
    try {
      return hud_read_file(path)
    } catch {
      _ => ()
    }
  }
  raise Failure("fixtures/fonts/HudFont.ttf 未找到")
}

///|
/// 烘一张 18px 图集 + 建一个 800×600@55° 的 HUD
fn hud_test_setup() -> (@core.Scene, Hud) raise {
  let atlas = @fontatlas.FontAtlas::bake(
    hud_test_font(),
    18.0,
    512,
    256,
    @fontatlas.hud_codepoints(),
  )
  let scene = @core.Scene::new()
  let hud = Hud::new(scene, atlas, 800, 600, 55.0)
  (scene, hud)
}

///|
test "HudView 换算: 中心→零向量, 视口右缘→正 x, 上缘→正 y, 层深向相机递增" {
  let v = HudView::new(800, 600, 55.0)
  let (cx, cy) = v.px_local(400.0, 300.0)
  assert_eq(cx, 0.0)
  assert_eq(cy, 0.0)
  let (rx, _) = v.px_local(800.0, 300.0)
  assert_true(rx > 0.0)
  let (_, ty) = v.px_local(400.0, 0.0)
  assert_true(ty > 0.0)
  // px2m 口径: 2·d·tan(fov/2)/vh; 视口高一半应等于 d·tan(fov/2)
  let half_h = 300.0 * v.px2m
  let want = 0.5 * @math.tan(55.0 * @math.PI / 180.0 / 2.0)
  assert_true((half_h - want).abs() < 1.0e-9)
  // 层深: 基准面 -0.5, 每层 +4mm, 不越过近平面 0.3
  assert_eq(v.layer_z(0), -0.5)
  assert_true((v.layer_z(3) + 0.488).abs() < 1.0e-12)
  assert_true(v.layer_z(60) > -0.3) // 60 层 × 4mm = 0.24, 仍在近平面前
}

///|
test "播报寿命: 3.5s 全显 → 4.5s 线性渐隐 → 剔除" {
  assert_eq(feed_opacity(10.0, 8.0), 1.0)
  assert_eq(feed_opacity(10.0, 6.6), 1.0)
  assert_true(feed_opacity(10.0, 6.0) > 0.4)
  assert_true(feed_opacity(10.0, 6.0) < 0.6)
  assert_eq(feed_opacity(10.0, 5.4), 0.0)
  assert_eq(feed_opacity(10.0, 5.0), 0.0)
}

///|
test "血量分段色: >50% 绿, >25% 琥珀, 其余红" {
  let g = hp_color(0.9)
  assert_eq(g.r, 0.36)
  let a = hp_color(0.3)
  assert_eq(a.r, 0.95)
  let r = hp_color(0.1)
  assert_eq(r.r, 0.92)
}

///|
test "文字几何: 每字形 4 顶点/6 索引, 位置在视口平面内, UV 在图集内" {
  let (_scene, hud) = hud_test_setup()
  let geo = hud_text_geometry(hud, [("HP 900/900", 16.0, 532.0)])
  let glyphs = geo.index_count() / 6
  assert_true(glyphs >= 9) // "HP 900/900" 10 个可见字形
  let vw_m = 800.0 * hud.view.px2m
  let vh_m = 600.0 * hud.view.px2m
  for i in 0..<(geo.vertex_count() * 3) {
    let v = geo.positions[i]
    if i % 3 == 0 {
      assert_true(v.abs() <= vw_m / 2.0 + 1.0e-9)
    } else if i % 3 == 1 {
      assert_true(v.abs() <= vh_m / 2.0 + 1.0e-9)
    } else {
      assert_eq(v, 0.0)
    }
  }
  for u in geo.uvs {
    assert_true(u >= 0.0 && u <= 1.0)
  }
  // 空串/全空白文本 → 空几何
  let empty = hud_text_geometry(hud, [("   ", 0.0, 0.0)])
  assert_eq(empty.index_count(), 0)
}

///|
test "整表刷新: 血条宽/面板文本/播推行随数据与时间演进" {
  let (_scene, hud) = hud_test_setup()
  // 无相机依赖的脏检查路径: 先造一个相机仅需对象存在(update 只读位姿)
  let cam = @core.PerspectiveCamera::new(55.0, 800.0 / 600.0, 0.3, 2200.0)
  cam.obj.position = @math3d.Vector3::new(1.0, 2.0, 3.0)
  // t=0: 满血装填中
  Hud::update(hud, cam, 900.0, 900.0, 2.0, 3.5, 95, "SHERMAN", 0.0)
  assert_true(hud.panel_text_s.contains("HP 900/900"))
  assert_true(hud.panel_text_s.contains("AP 95 » "))
  assert_true(hud.hp_w > 255.0) // 满血满条
  // 装填 2/3 未完: 进度 1-2/3.5≈0.43 → 条宽 ≈109.7px
  assert_true(hud.rl_w > 100.0 && hud.rl_w < 120.0)
  // 击杀播报: 玩家方击毁
  Hud::push_kill(hud, "YOU", "TIGER1", true, 0.0)
  Hud::update(hud, cam, 900.0, 900.0, 2.0, 3.5, 95, "SHERMAN", 0.0)
  assert_true(hud.feed.length() == 1)
  assert_true(hud.feed_rows[0].obj.visible)
  assert_true(hud.feed_rows[0].text == "YOU » TIGER1")
  // 根对齐相机位姿
  assert_eq(hud.root.position.x, 1.0)
  assert_eq(hud.root.position.y, 2.0)
  // 4s 后: 播报还在但开始渐隐; 5s 后剔除
  Hud::update(hud, cam, 900.0, 900.0, 2.0, 3.5, 95, "SHERMAN", 4.0)
  assert_true(hud.feed.length() == 1)
  assert_true(hud.feed_rows[0].opacity < 1.0)
  Hud::update(hud, cam, 900.0, 900.0, 2.0, 3.5, 95, "SHERMAN", 5.0)
  assert_eq(hud.feed.length(), 0)
  assert_false(hud.feed_rows[0].obj.visible)
  // 空血: 血条归零, 文本跟上
  Hud::update(hud, cam, 0.0, 900.0, 0.0, 3.5, 95, "SHERMAN", 6.0)
  assert_true(hud.hp_w.abs() < 0.5)
  assert_true(hud.panel_text_s.contains("HP 0/900"))
  assert_true(hud.panel_text_s.contains("READY"))
}
