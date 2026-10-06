// assets_test.mbt — 资产装载管线单测: 清单完整性 / GLB 按名读字节与解析 /
// 地图字段 / 高程采样。期望值来源(独立实现, 2026-10-06):
//   高程: server.js:97-116 同算法的 Python 参考解解码 l01-encounter/heightmap.png,
//         逐元素 f32 圆整后按 simcore.js:12-23 双线性公式复算; 网格点像素 u16
//         另与 v9_image 基线(PIL 对照)一致 —— (0,0)=60129 (143,143)=6706
//         (287,287)=60243 (100,50)=23949;
//   其余: map.json / partboxes.json / assets.js / config.js 原文读档核验。

///|
/// 清单完整性: 129 型、类型↔文件双射、与磁盘 assets/models 目录逐项对齐。
async test "manifest: GLB 清单与磁盘目录一致" {
  assert_eq(@assets.model_files.length(), 129)
  // 类型 → 文件反查逐一命中(assets.js fileOf 反查表)
  for f, t in @assets.model_files {
    assert_eq(@assets.file_of_type(t), Some(f))
  }
  // 磁盘目录 readdir 与清单集合全等(双向都不缺)
  let dir = match
    @assets.resolve_rel(
      @assets.client_prefixes.map(fn(p) { p + "assets/models" }),
    ) {
    Some(d) => d
    None => fail("assets/models 目录定位失败")
  }
  let disk = @fs.readdir(dir, sort=true)
  let files : Array[String] = []
  for name in disk {
    if name.has_suffix(".glb") {
      files.push(name)
    }
  }
  files.sort()
  let listed : Array[String] = []
  for f, _ in @assets.model_files {
    listed.push(f + ".glb")
  }
  listed.sort()
  assert_eq(files.length(), listed.length())
  for i, f in listed {
    assert_eq(files[i], f)
  }
}

///|
/// 地图清单: 6 张图, 每张的 map.json + heightmap.png 都能在磁盘定位
/// (resolve_client 定位失败会 raise, 测试自然失败)。
async test "manifest: 6 图清单与两件套可定位" {
  assert_eq(@assets.maps_manifest.length(), 6)
  for m in @assets.maps_manifest {
    let _json = @assets.resolve_client("assets/maps/\{m.dir}/map.json")
    let _png = @assets.resolve_client("assets/maps/\{m.dir}/heightmap.png")
  }
}

///|
/// GLB: 按类型名读字节 + 容器头校验 + 未知类型拒绝 + ModelStore 缓存幂等。
async test "glb: 按名读字节与容器头" {
  let raw = @assets.read_model_bytes("pz4")
  let head = @assets.read_glb_header(raw)
  assert_eq(head.version, 2U)
  assert_eq(head.total_length, raw.length())
  assert_true(head.json_length > 0)
  // 缓存: 两次取同型内容一致
  let store = @assets.ModelStore::new()
  let b1 = store.get_bytes("pz4")
  let b2 = store.get_bytes("pz4")
  assert_eq(b1.length(), b2.length())
  assert_true(b1 == b2)
  // 未知类型拒绝(assets.js:119 同语义)
  try @assets.read_model_bytes("no-such-tank") catch {
    Failure(_) => ()
    e => fail("意外错误类型: \{e}")
  } noraise {
    _ => fail("未知类型应 raise")
  }
}

///|
/// GLB: three-native load_glb 解析无贴图车型(122/129), turret/gun/muzzle 节点
/// 可寻址(models.js:54-56 装配消费的同名约定); 7 个 dataURI 贴图车型的
/// load_glb 卡点见 @assets.load_tank_glb 注释。
async test "glb: load_glb 解析与装配节点" {
  let store = @assets.ModelStore::new()
  for typ in ["pz4", "t34"] {
    let root = @assets.load_tank_glb(store, typ)
    assert_true(root.children.length() >= 1)
    for part in ["turret", "gun", "muzzle"] {
      assert_true(@loaders.find_node_by_name(root, part) is Some(_))
    }
  }
}

///|
/// 地图 l01: 结构化字段(terrain / spawn / spawns / covers / waves)。
/// 期望值取自 client/assets/maps/l01-encounter/map.json 原文(2026-10-06 读档核验)。
async test "map l01: 字段与规模" {
  let m = @assets.load_map("l01")
  assert_eq(m.id, "l01-l01-encounter")
  assert_eq(m.dir, "l01-encounter")
  assert_eq(m.terrain.size, 1000.0)
  assert_eq(m.terrain.resolution, 288)
  assert_eq(m.terrain.max_height, 70.0)
  assert_eq(m.heights.length(), 288 * 288)
  // 出生: 单点 [0, 418.75, π], 多点池 12 组(首组 [-300, 305, π])
  assert_eq(m.spawn.x, 0.0)
  assert_eq(m.spawn.z, 418.75)
  assert_eq(m.spawn.yaw, 3.141592653589793)
  assert_eq(m.spawns.length(), 12)
  assert_eq(m.spawns[0].x, -300.0)
  assert_eq(m.spawns[0].z, 305.0)
  assert_eq(m.spawns[0].yaw, 3.141592653589793)
  // 掩体 411 个, 首条 { barn, -75, 32.5, yaw 0.15, scale 缺省 1 }
  assert_eq(m.covers.length(), 411)
  assert_eq(m.covers[0].typ, "barn")
  assert_eq(m.covers[0].x, -75.0)
  assert_eq(m.covers[0].z, 32.5)
  assert_eq(m.covers[0].yaw, 0.15)
  assert_eq(m.covers[0].scale, 1.0)
  assert_eq(m.wave_count, 2)
}

///|
/// 高程采样: 4 个已知像素网格点, 期望高度 = f32(u16/65535*70), 逐位相等。
async test "map l01: 高程采样命中已知像素" {
  let m = @assets.load_map("l01")
  let samples : Array[(Int, Int, Double)] = [
    // (像素列 i, 像素行 j, 期望高程米; u16 见上注释)
    (0, 0, 64.22567749023438),
    (143, 143, 7.1628899574279785),
    (287, 287, 64.34745025634766),
    (100, 50, 25.58068275451661),
  ]
  for s in samples {
    let (i, j, want) = s
    let (x, z) = @assets.grid_to_world(
      i,
      j,
      m.terrain.resolution,
      m.terrain.size,
    )
    assert_eq(m.height_at(x, z), want)
  }
}

///|
/// 高程采样: 离网点双线性 + 出界角点钳位(Python 参考解逐位复算值)。
async test "map l01: 离网双线性与边界钳位" {
  let m = @assets.load_map("l01")
  assert_eq(m.height_at(-123.4, 77.7), 9.93559556699146)
  assert_eq(m.height_at(250.5, -88.25), 23.45909710386205)
  assert_eq(m.height_at(0.0, 0.0), 7.236858129501343)
  assert_eq(m.height_at(499.9, 500.0), 64.34708239746094)
  assert_eq(m.height_at(-1000000.0, 1000000.0), 63.73220443725586)
}

///|
/// 全 6 图装载: terrain 常量一致(size 1000 / res 288 / maxHeight 70, 逐图核验),
/// spawns 池 12 组, 高程长度一致, 掩体非空。
async test "maps: 全 6 图装载一致" {
  for e in @assets.maps_manifest {
    let m = @assets.load_map(e.id)
    assert_eq(m.dir, e.dir)
    assert_eq(m.terrain.size, 1000.0)
    assert_eq(m.terrain.resolution, 288)
    assert_eq(m.terrain.max_height, 70.0)
    assert_eq(m.heights.length(), 288 * 288)
    assert_eq(m.spawns.length(), 12)
    assert_true(m.covers.length() > 0)
  }
}

///|
/// partBoxes: 129 车型; sherman 表形状与 sim-engine 消费字段逐值核验;
/// 全表不变量(部位盒总数/父级枚举/q 有无分布/枪父级分布)。
async test "partboxes: 表规模与 sherman 逐值" {
  let pb = @assets.load_partboxes()
  assert_eq(pb.length(), 129)
  let sh = pb["sherman"]
  assert_eq(sh.turret_pivot.x, 0.0)
  assert_eq(sh.turret_pivot.y, 1.86)
  assert_eq(sh.turret_pivot.z, 0.45)
  assert_eq(sh.gun_pivot.x, 0.0)
  assert_eq(sh.gun_pivot.y, 0.4)
  assert_eq(sh.gun_pivot.z, 1.1)
  assert_eq(sh.gun_parent, "turret")
  assert_eq(sh.zones.length(), 63)
  // zones[3]: 履带端罩(带 q 旋转), 数值取自 config.js SF.CFG.partBoxes 原文
  let z3 = sh.zones[3]
  assert_eq(z3.zone, "tracks")
  assert_eq(z3.armor, 20)
  assert_eq(z3.parent, "root")
  assert_eq(z3.c.x, -1.06)
  assert_eq(z3.c.y, 1.0)
  assert_eq(z3.c.z, -1.5375)
  assert_eq(z3.h.x, 0.10999999940395355)
  assert_eq(z3.h.y, 0.15000000596046448)
  assert_eq(z3.h.z, 0.10999999940395355)
  match z3.q {
    Some(q) => {
      assert_eq(q.x, 0.0)
      assert_eq(q.y, 0.0)
      assert_eq(q.z, 0.7071067811865475)
      assert_eq(q.w, 0.7071067811865476)
    }
    None => fail("zones[3] 应带 q")
  }
  // 全表不变量(2026-10-06 对 partboxes.json 全量统计核验):
  // 部位盒总数 10145(带 q 8723), gunParent="root" 的车型 22 个
  let mut total = 0
  let mut with_q = 0
  let mut gun_on_root = 0
  let mut null_turret_pivot = 0
  for _, t in pb {
    assert_true(t.zones.length() > 0)
    if t.gun_parent == "root" {
      gun_on_root += 1
    } else {
      assert_eq(t.gun_parent, "turret")
    }
    // 无炮塔车型 turretPivot:null → 默认 [0,1.5,0](表内无真实 [0,1.5,0] 值, 计数即 null 数)
    if t.turret_pivot.x == 0.0 &&
      t.turret_pivot.y == 1.5 &&
      t.turret_pivot.z == 0.0 {
      null_turret_pivot += 1
    }
    for b in t.zones {
      assert_true(
        b.parent == "root" || b.parent == "turret" || b.parent == "gun",
      )
      assert_true(b.armor >= 0)
      total += 1
      if b.q is Some(_) {
        with_q += 1
      }
    }
  }
  assert_eq(total, 10145)
  assert_eq(with_q, 8723)
  assert_eq(gun_on_root, 22)
  // 无炮塔车 22 型(td/stug3/jagdpanther/su85/... 全部歼击车/自行火炮), 炮挂车体
  assert_eq(null_turret_pivot, 22)
  let td = pb["td"]
  assert_eq(td.turret_pivot.x, 0.0)
  assert_eq(td.turret_pivot.y, 1.5)
  assert_eq(td.turret_pivot.z, 0.0)
  assert_eq(td.gun_parent, "root")
  assert_eq(td.gun_pivot.y, 2.27)
}
