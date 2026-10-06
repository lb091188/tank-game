// simcore 直译的对照单测: 参考值全部由 node(V8)对本仓 JS 源逐式计算得出(golden-trace2.js /
// config.js / simcore.js 同式), 覆盖 mulberry32(SPEC §4)、SF.Util(clamp/rayCircle/rayObb)、
// coverCol、高程两级 f32 重建、makeTerrain 四查询、coversBlocked/nearestCoverBetween/bushState/camoOf。

///|
// ---- mulberry32: node 端 mulberry32(20261006) 前 8 掷 / mulberry32(777) 前 3 掷 ----
test "mulberry32 matches JS reference sequence" {
  let r = @simcore.Mulberry32::new(20261006)
  assert_eq(r.next(), 0.82675916678272188)
  assert_eq(r.next(), 0.08045424590818584)
  assert_eq(r.next(), 0.55579714220948517)
  assert_eq(r.next(), 0.08094781776890159)
  assert_eq(r.next(), 0.73973244125954807)
  assert_eq(r.next(), 0.95374593511223793)
  assert_eq(r.next(), 0.95998174767009914)
  assert_eq(r.next(), 0.17876049317419529)
  let r2 = @simcore.Mulberry32::new(777)
  assert_eq(r2.next(), 0.68637871788814664)
  assert_eq(r2.next(), 0.03445141832344234)
  assert_eq(r2.next(), 0.19238732964731753)
}

///|
// ---- SF.Util.clamp / rayCircle / rayObb: node 端 config.js 同式参考值 ----
test "util clamp / rayCircle / rayObb match JS reference" {
  assert_eq(@simcore.clamp(5.3, -1.0, 2.0), 2.0)
  assert_eq(@simcore.clamp(-9.0, -1.0, 2.0), -1.0)
  assert_eq(
    @simcore.ray_circle(0.0, 0.0, 1.0, 0.0, 100.0, 50.0, 0.0, 10.0),
    40.0,
  )
  assert_eq(
    @simcore.ray_circle(
      0.0, 0.0, 0.7071067811865476, 0.7071067811865476, 100.0, 60.0, 60.0, 10.0,
    ),
    74.85281374238566,
  )
  assert_eq(
    @simcore.ray_circle(0.0, 0.0, 1.0, 0.0, 100.0, 50.0, 50.0, 10.0),
    -1.0,
  )
  let obb : @simcore.Cover = {
    typ: "wall",
    blocks_move: true,
    blocks_shells: true,
    blocks_spot: false,
    x: 50.0,
    z: 0.0,
    r: 5.830951894845301,
    h: 3.1,
    shape: "box",
    yaw: 0.3,
    hx: 3.0,
    hz: 5.0,
  }
  // node: U.rayObb(0,0,1,0,100,{x:50,z:0,yaw:0.3,hx:3,hz:5})
  assert_true(
    (@simcore.ray_obb(0.0, 0.0, 1.0, 0.0, 100.0, obb) - 46.85974519538574).abs() <
    1.0e-12,
  )
  let obb2 = { ..obb, yaw: 0.0, x: 50.0, z: 0.0, }
  assert_eq(@simcore.ray_obb(50.0, 0.0, 1.0, 0.0, 100.0, obb2), 0.0)
  assert_eq(@simcore.ray_obb(0.0, 10.0, 1.0, 0.0, 100.0, obb2), -1.0)
}

///|
// ---- coverCol: node 端 golden-trace2.js coverCol 同式参考值 ----
test "cover_col matches JS reference per type" {
  let house = @simcore.cover_col({
    typ: "house",
    x: 10.0,
    z: 20.0,
    yaw: Some(0.3),
    scale: Some(1.1),
  })
  assert_eq(house.shape, "box")
  assert_true((house.r - 4.896235799060336).abs() < 1.0e-12)
  assert_true((house.h - 5.38).abs() < 1.0e-12)
  assert_true((house.hx - 3.8500000000000005).abs() < 1.0e-12)
  assert_true((house.hz - 3.0250000000000004).abs() < 1.0e-12)
  assert_true(house.blocks_shells && house.blocks_move && !house.blocks_spot)
  let hedge = @simcore.cover_col({
    typ: "hedge",
    x: 0.0,
    z: 0.0,
    yaw: Some(0.5),
    scale: None,
  })
  assert_eq(hedge.shape, "box")
  assert_true((hedge.r - 3.1953090617340916).abs() < 1.0e-12)
  assert_eq(hedge.h, 3.2)
  assert_true(hedge.blocks_spot && !hedge.blocks_shells && !hedge.blocks_move)
  let bush = @simcore.cover_col({
    typ: "bush",
    x: 5.0,
    z: 5.0,
    yaw: None,
    scale: Some(1.2),
  })
  assert_eq(bush.shape, "circle")
  assert_eq(bush.r, 1.92)
  assert_eq(bush.h, 1.9)
  assert_true(bush.blocks_spot && !bush.blocks_shells)
  let tree = @simcore.cover_col({
    typ: "tree",
    x: 1.0,
    z: 2.0,
    yaw: None,
    scale: None,
  })
  assert_eq(tree.r, 0.9)
  assert_eq(tree.h, 1.6)
  assert_true(!tree.blocks_shells && tree.blocks_move && !tree.blocks_spot)
  let rock = @simcore.cover_col({
    typ: "rock",
    x: 0.0,
    z: 0.0,
    yaw: None,
    scale: Some(2.0),
  })
  assert_eq(rock.r, 5.0)
  assert_eq(rock.h, 6.6)
  let wreck = @simcore.cover_col({
    typ: "wreck",
    x: 3.0,
    z: 4.0,
    yaw: Some(1.0),
    scale: None,
  })
  assert_true((wreck.r - 3.559845502265513).abs() < 1.0e-12)
  assert_eq(wreck.h, 2.4)
  assert_eq(wreck.hx, 1.75)
  assert_eq(wreck.hz, 3.1)
  assert_true(wreck.blocks_spot && !wreck.blocks_shells)
  // 未知类型走 JS switch 默认: 初值原样
  let unk = @simcore.cover_col({
    typ: "bunker",
    x: 7.0,
    z: 8.0,
    yaw: None,
    scale: None,
  })
  assert_eq(unk.r, 2.0)
  assert_eq(unk.h, 3.0)
  assert_eq(unk.shape, "circle")
  assert_true(unk.blocks_shells && unk.blocks_move && !unk.blocks_spot)
}

///|
// ---- 4x4 迷你地形(SPEC §3 两级 f32 重建) + makeTerrain 四查询 ----
// u16 源与参考值均由 node 端 fround(fround(v/65535)*70) + simcore.js 同式计算。
fn mini_terrain() -> @simcore.Terrain {
  let u16 : FixedArray[UInt] = FixedArray::from_array([
    65535U, 49152U, 32768U, 16384U, 57344U, 40960U, 24576U, 8192U, 40960U, 32768U,
    16384U, 0U, 65535U, 0U, 65535U, 32768U,
  ])
  @simcore.make_terrain(@simcore.heights_from_u16(u16, 70.0), 300.0, 4)
}

///|
test "heights two-level f32 rounding matches JS" {
  let t = mini_terrain()
  // node: [70, 52.50080108642578, 35.00053405761719, 17.500267028808594, ...]
  assert_eq(t.h[0].to_double(), 70.0)
  assert_eq(t.h[1].to_double(), 52.50080108642578)
  assert_eq(t.h[2].to_double(), 35.00053405761719)
  assert_eq(t.h[3].to_double(), 17.500267028808594)
  assert_eq(t.h[4].to_double(), 61.25093460083008)
  assert_eq(t.h[11].to_double(), 0.0)
}

///|
test "heightAt matches JS reference" {
  let t = mini_terrain()
  // node: heightAt(10,20)=27.12541389465332 等(纯四则, 应逐位一致)
  assert_eq(t.height_at(10.0, 20.0), 27.12541389465332)
  assert_eq(t.height_at(150.0, 150.0), 35.00053405761719)
  assert_eq(t.height_at(-200.0, 50.0), 43.750667572021484)
}

///|
test "losBlocked / slopeAhead / gradAt match JS reference" {
  let t = mini_terrain()
  // node: losBlocked(-100,-100,5,100,100,5)=true(低眼高被脊挡)
  assert_true(t.los_blocked(-100.0, -100.0, 5.0, 100.0, 100.0, 5.0))
  // node: losBlocked(-100,-100,90,100,100,90)=false(高眼高全通)
  assert_true(!t.los_blocked(-100.0, -100.0, 90.0, 100.0, 100.0, 90.0))
  // node: margin=0.2 → true
  assert_true(t.los_blocked(-100.0, -100.0, 5.0, 100.0, 100.0, 5.0, margin=0.2))
  // node: slopeAhead(0,0,0.5,6) = -0.15932835195690767(atan2/sin/cos 留 ulp 余量)
  assert_true(
    (t.slope_ahead(0.0, 0.0, 0.5, 6.0) + 0.15932835195690767).abs() < 1.0e-12,
  )
  // node: gradAt(0,0)=0.19565893350407146, gradAt(140,10)=0.19565893350407063
  assert_true((t.grad_at(0.0, 0.0) - 0.19565893350407146).abs() < 1.0e-12)
  assert_true((t.grad_at(140.0, 10.0) - 0.19565893350407063).abs() < 1.0e-12)
}

///|
// ---- coversBlocked / nearestCoverBetween / bushState / camoOf 迷你场景 ----
// 参考值由 node 端 simcore.js 同式函数对同一 cover 表计算(见交付说明)。
fn mini_list() -> @simcore.CoverList {
  let items = [
    @simcore.cover_col({
      typ: "rock",
      x: 40.0,
      z: 0.0,
      yaw: None,
      scale: Some(1.5),
    }),
    @simcore.cover_col({
      typ: "house",
      x: 80.0,
      z: 30.0,
      yaw: Some(0.4),
      scale: None,
    }),
    @simcore.cover_col({
      typ: "bush",
      x: 20.0,
      z: 10.0,
      yaw: None,
      scale: Some(1.3),
    }),
    @simcore.cover_col({
      typ: "wreck",
      x: 60.0,
      z: -40.0,
      yaw: Some(0.9),
      scale: None,
    }),
  ]
  { items, bushes: None, }
}

///|
test "coversBlocked plain/spot matches JS reference" {
  let t = mini_terrain()
  let list = mini_list()
  let hf = fn(x : Double, z : Double) { t.height_at(x, z) }
  // node: 平射 rock(挡弹圆) → 36.25(纯圆+四则, 应逐位一致)
  assert_eq(
    @simcore.covers_blocked(list, hf, 0.0, 0.0, 3.0, 1.0, 0.0, 90.0, 0.0),
    36.25,
  )
  // node: (0,0)→(60,30) 穿 bush(20,10): 无 spot 上下文 → -1; spot 且 t<50 草本透明 → -1
  assert_eq(
    @simcore.covers_blocked(
      list, hf, 0.0, 0.0, 2.0, 0.894427190999916, 0.447213595499958, 67.0820393249937,
      0.0,
    ),
    -1.0,
  )
  assert_eq(
    @simcore.covers_blocked(
      list,
      hf,
      0.0,
      0.0,
      2.0,
      0.894427190999916,
      0.447213595499958,
      67.0820393249937,
      0.0,
      spot={ tx: 200.0, tz: 100.0, fired: false, concealed: false, },
    ),
    -1.0,
  )
  // node: 平射 house(box) (0,0)→(120,45) → 81.44311791430236(含 cos/sin, 留 ulp 余量)
  assert_true(
    (@simcore.covers_blocked(
      list, hf, 0.0, 0.0, 2.0, 0.9363291775690445, 0.3511234415883917, 128.16005617976296,
      0.0,
    ) -
    81.44311791430236).abs() <
    1.0e-9,
  )
  // node: wreck 仅 spot 可见((0,0)→(90,-60) 72.8m>50m 不透明) → 70.27225393422951
  assert_true(
    (@simcore.covers_blocked(
      list,
      hf,
      0.0,
      0.0,
      1.0,
      0.8320502943378437,
      -0.5547001962252291,
      108.16653826391967,
      0.0,
      spot={ tx: 200.0, tz: 100.0, fired: false, concealed: false, },
    ) -
    70.27225393422951).abs() <
    1.0e-9,
  )
  // node: spot.fired 且目标 15m 内有草(tx=66,tz=-44 距 wreck 7.2m) → -1
  assert_eq(
    @simcore.covers_blocked(
      list,
      hf,
      0.0,
      0.0,
      1.0,
      0.8320502943378437,
      -0.5547001962252291,
      108.16653826391967,
      0.0,
      spot={ tx: 66.0, tz: -44.0, fired: true, concealed: false, },
    ),
    -1.0,
  )
  // node: concealed 但命中点距 spot.tx 远(>6m) → 与不加 1.8 相同
  assert_true(
    (@simcore.covers_blocked(
      list,
      hf,
      0.0,
      0.0,
      1.0,
      0.8320502943378437,
      -0.5547001962252291,
      108.16653826391967,
      0.0,
      spot={ tx: 200.0, tz: 100.0, fired: false, concealed: true, },
    ) -
    70.27225393422951).abs() <
    1.0e-9,
  )
}

///|
test "nearestCoverBetween matches JS reference" {
  let list = mini_list()
  // node: (0,0)→(90,0) 最近硬掩体 = rock, rayCircle t=36.25
  let nc = @simcore.nearest_cover_between(list, 0.0, 0.0, 90.0, 0.0)
  let c = match nc {
    Some(c) => c
    None => abort("nearestCoverBetween 应命中 rock")
  }
  assert_eq(c.typ, "rock")
  assert_eq(@simcore.ray_circle(0.0, 0.0, 1.0, 0.0, 90.0, c.x, c.z, c.r), 36.25)
  // len<1 → null(JS 同)
  assert_true(@simcore.nearest_cover_between(list, 0.0, 0.0, 0.5, 0.0) is None)
}

///|
test "bushState / camoOf match JS reference" {
  let list = mini_list()
  // node: bushState(list,{x:0,z:0,lastFireT:-1.5},1) = 0/1/0
  let a : @simcore.CamoTarget = {
    x: 0.0,
    z: 0.0,
    speed: 5.0,
    last_yaw_rate: 0.1,
    last_fire_t: -1.5,
    camo: Some(0.32),
  }
  let bs = list.bush_state(a, 1.0)
  assert_true(!bs.in_bush && bs.fired && !bs.concealed)
  // node: camoOf = min(0.32*0.5(移动), 0.32*0.1(开炮)) = 0.032
  assert_eq(list.camo_of(a, 1.0), 0.032)
  // node: 蹲草静止不开炮(t 在 bush 20,10 内) → 0/0/1, camo=0.32+0.25=0.57
  let t2 : @simcore.CamoTarget = {
    x: 20.0,
    z: 10.0,
    speed: 0.0,
    last_yaw_rate: 0.0,
    last_fire_t: -99.0,
    camo: Some(0.32),
  }
  let bs2 = list.bush_state(t2, 10.0)
  assert_true(bs2.in_bush && !bs2.fired && bs2.concealed)
  assert_true((list.camo_of(t2, 10.0) - 0.57).abs() < 1.0e-12)
  // lastYawRate 大时先移动减半(0.32→0.16)再加蹲草 0.25 → 0.41(JS 运算次序如此)
  let t3 = { ..t2, last_yaw_rate: 0.5, }
  assert_true((list.camo_of(t3, 10.0) - 0.41).abs() < 1.0e-12)
}
