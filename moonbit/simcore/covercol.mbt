// coverCol 直译(tools/golden-trace2.js:114-136; client/js/srv-sim.js:23-45 / ai-bench.js:216-238 同款)。
// map.json covers 原样条目 → 碰撞列表 col 对象; 纯 switch, 无随机。

///|
/// coverCol 输入(map.json covers 条目: type/x/z/yaw?/scale?)
pub(all) struct CoverRaw {
  typ : String // c.type
  x : Double
  z : Double
  yaw : Double? // JS c.yaw(缺失 → || 0)
  scale : Double? // JS c.scale(缺失 → || 1)
}

///|
/// coverCol: 逐类型赋值次序与 JS 的 Object.assign 完全一致(OBB() 先设 shape/hx/hz/yaw/r, 再覆 h)
pub fn cover_col(c : CoverRaw) -> Cover {
  let s = c.scale.unwrap_or(1.0)
  let yaw0 = c.yaw.unwrap_or(0.0)
  // JS col 初值: { type, blocksMove: true, blocksShells: true, x, z, r: 2, h: 3, shape: 'circle', yaw }
  let mut shape = "circle"
  let mut hx = 0.0
  let mut hz = 0.0
  let mut r = 2.0
  let mut h = 3.0
  let mut blocks_move = true
  let mut blocks_shells = true
  let mut blocks_spot = false
  // JS OBB(hx, hz) 内联: { shape: 'box', hx, hz, yaw, r: Math.hypot(hx, hz) }
  match c.typ {
    "house" => {
      shape = "box"
      hx = 3.5 * s
      hz = 2.75 * s
      r = @math.hypot(hx, hz)
      h = 3.4 + 1.8 * s
    }
    "barn" => {
      shape = "box"
      hx = 5.5 * s
      hz = 3.75 * s
      r = @math.hypot(hx, hz)
      h = 5.0 + 2.2 * s
    }
    "ruin" => {
      shape = "box"
      hx = 3.2 * s
      hz = 2.4 * s
      r = @math.hypot(hx, hz)
      h = 4.5
    }
    "wall" => {
      shape = "box"
      hx = 3.5 * s
      hz = 0.35 * s
      r = @math.hypot(hx, hz)
      h = 3.1
    }
    "hedge" => {
      blocks_move = false
      blocks_shells = false
      blocks_spot = true
      shape = "box"
      hx = 3.0 * s
      hz = 1.1 * s
      r = @math.hypot(hx, hz)
      h = 3.2
    }
    "haystack" => {
      blocks_move = false
      blocks_shells = false
      blocks_spot = true
      r = 2.6 * s
      h = 3.6 * s
    }
    "tree" => {
      blocks_shells = false
      r = 0.9
      h = 1.6
    }
    "trap" => {
      blocks_shells = false
      r = 1.2
      h = 1.2
    }
    "wreck" => {
      blocks_shells = false
      blocks_spot = true
      shape = "box"
      hx = 1.75
      hz = 3.1
      r = @math.hypot(hx, hz)
      h = 2.4
    }
    "bush" => {
      blocks_move = false
      blocks_shells = false
      blocks_spot = true
      r = 1.6 * s
      h = 1.9
    }
    "rock" => {
      r = 2.5 * s
      h = 3.3 * s
    }
    _ => ()
  }
  {
    typ: c.typ,
    blocks_move,
    blocks_shells,
    blocks_spot,
    x: c.x,
    z: c.z,
    r,
    h,
    shape,
    yaw: yaw0,
    hx,
    hz,
  }
}

///|
/// 高程重建(SPEC §3, tools/golden-trace2.js heightsOf / ai-bench loadPNG16+loadTerrain 两级
/// f32 舍入逐位复刻): h[i] = fround(fround(u16[i]/65535) * maxHeight)。
/// 第一级: 除法在 f64 后舍入到 f32; 第二级: f32 值转回 f64 乘 maxHeight 后再舍入到 f32。
pub fn heights_from_u16(
  u16 : FixedArray[UInt],
  max_height : Double,
) -> FixedArray[Float] {
  let h : FixedArray[Float] = FixedArray::make(u16.length(), 0.0)
  for i in 0..<u16.length() {
    let d : Float = Float::from_double(u16[i].to_double() / 65535.0)
    h[i] = Float::from_double(d.to_double() * max_height)
  }
  h
}
