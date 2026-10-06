// client/js/simcore.js (SF.Sim) 直译: 地形双线性高程/通视/坡度/梯度、掩体遮挡/寻掩、隐蔽/点亮。
// 每个函数注释标注原 JS 函数名; 运算次序与 JS 逐句对应, 全程 Double。

///|
/// coverCol 产物(models.js buildCover 纯数据子集; tools/golden-trace2.js coverCol /
/// client/js/srv-sim.js:23-45 同款)。JS 中 circle 形的 hx/hz 与未命中类型的 blocksSpot
/// 均为 undefined(假值), 这里以 0.0 / false 承载(仅在 shape='box' / blocksSpot=true 时被读)。
pub(all) struct Cover {
  typ : String // JS c.type
  blocks_move : Bool
  blocks_shells : Bool
  blocks_spot : Bool
  x : Double
  z : Double
  r : Double
  h : Double
  shape : String // 'circle' | 'box'
  yaw : Double
  hx : Double
  hz : Double
}

///|
/// coversBlocked/bushState 的 list 参数(simcore.js:57/98)。JS 里 bushes 缓存直接挂在
/// list 数组自身(list.bushes, simcore.js:99), 这里以可变字段承载同一语义。
pub(all) struct CoverList {
  items : Array[Cover]
  mut bushes : Array[Cover]? // list.bushes 缓存(bushState 首调时填充)
}

///|
/// coversBlocked 的 spot 上下文(simcore.js:56 第 10 参; 生成侧 golden-trace2.js:205 构造)
pub(all) struct Spot {
  tx : Double
  tz : Double
  fired : Bool
  concealed : Bool
}

///|
/// bushState/camoOf 的目标桩(夹具 in.a 携带的字段集; JS 侧为坦克对象上被读到的子集)
pub(all) struct CamoTarget {
  x : Double
  z : Double
  speed : Double
  last_yaw_rate : Double // JS t.lastYawRate(缺失时 || 0, 调用侧归一)
  last_fire_t : Double // JS t.lastFireT(缺失时 || -99, 调用侧归一)
  camo : Double? // JS t.spec.camo(缺失 → 0.12)
}

///|
/// bushState 返回值(simcore.js:104): { inBush, fired, concealed }
pub(all) struct BushState {
  in_bush : Bool
  fired : Bool
  concealed : Bool
}

///|
/// makeTerrain 返回的地形对象(client/js/simcore.js:9-52 makeTerrain)
pub(all) struct Terrain {
  h : FixedArray[Float] // heights(Float32Array → f32 高程)
  res : Int // terrainCfg.resolution
  size : Double // terrainCfg.size
  half : Double // size / 2
  cell : Double // size / (res - 1)
}

///|
/// makeTerrain (simcore.js:9-52)。heights 即 f32 高程数组(重建式见 heights_from_u16)。
pub fn make_terrain(
  heights : FixedArray[Float],
  terrain_cfg_size : Double,
  terrain_cfg_resolution : Int,
) -> Terrain {
  let res = terrain_cfg_resolution
  let size = terrain_cfg_size
  let half = size / 2.0
  let cell = size / (res - 1).to_double()
  { h: heights, res, size, half, cell, }
}

///|
/// makeTerrain.heightAt (simcore.js:12-21): 双线性高程。采样源是 f32(读出转 Double),
/// 算术全程 Double —— 与 JS Float32Array 元素参与 double 运算逐位一致。
pub fn Terrain::height_at(self : Terrain, x : Double, z : Double) -> Double {
  let res = self.res
  let size = self.size
  let half = self.half
  let fi = clamp((x + half) / size, 0.0, 1.0) * (res - 1).to_double()
  let fj = clamp((z + half) / size, 0.0, 1.0) * (res - 1).to_double()
  // JS: Math.min(res - 2, Math.floor(fi))(先 floor 再与 res-2 取小, 结果作数组下标)
  let i = fi.floor().to_int().min(res - 2)
  let j = fj.floor().to_int().min(res - 2)
  let tx = fi - i.to_double()
  let tz = fj - j.to_double()
  let a = self.h[j * res + i].to_double()
  let b = self.h[j * res + i + 1].to_double()
  let c = self.h[(j + 1) * res + i].to_double()
  let d = self.h[(j + 1) * res + i + 1].to_double()
  a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz
}

///|
/// makeTerrain.losBlocked (simcore.js:25-36): 两点(含眼高)间地形通视; margin 缺省 1.6
/// (JS `margin === undefined ? 1.6 : margin`), 4m→2m 细步进。
pub fn Terrain::los_blocked(
  self : Terrain,
  ax : Double,
  az : Double,
  ay : Double,
  bx : Double,
  bz : Double,
  by : Double,
  margin? : Double,
) -> Bool {
  let m2 = margin.unwrap_or(1.6)
  let d = @math.hypot(bx - ax, bz - az)
  // JS: Math.max(2, Math.ceil(d / 2))
  let steps = (d / 2.0).ceil().to_int().max(2)
  for i in 1..<steps {
    let t = i.to_double() / steps.to_double()
    let h_terrain = self.height_at(ax + (bx - ax) * t, az + (bz - az) * t) + m2
    let h_line = ay + (by - ay) * t
    if h_terrain > h_line {
      return true
    }
  }
  false
}

///|
/// makeTerrain.slopeAhead (simcore.js:38-42): 沿朝向的坡度(正=上坡)。
pub fn Terrain::slope_ahead(
  self : Terrain,
  x : Double,
  z : Double,
  yaw : Double,
  dist : Double,
) -> Double {
  let s = @math.sin(yaw)
  let c = @math.cos(yaw)
  let h0 = self.height_at(x, z)
  let h1 = self.height_at(x + s * dist, z + c * dist)
  @math.atan2(h1 - h0, dist)
}

///|
/// makeTerrain.gradAt (simcore.js:45-50): 梯度模(最陡方向坡度正切), 不可攀判定用。
pub fn Terrain::grad_at(self : Terrain, x : Double, z : Double) -> Double {
  let e = 2.5
  let gx = (self.height_at(x + e, z) - self.height_at(x - e, z)) / (2.0 * e)
  let gz = (self.height_at(x, z + e) - self.height_at(x, z - e)) / (2.0 * e)
  @math.hypot(gx, gz)
}

///|
/// coversBlocked (simcore.js:56-79): 掩体遮挡, 包围圆粗剔除 + OBB/圆精确 + 高度比较;
/// 返回沿射线最近命中 t(-1 无)。spot 为点亮语义上下文(JS undefined ↔ None)。
pub fn covers_blocked(
  list : CoverList,
  height_at : (Double, Double) -> Double,
  ox : Double,
  oz : Double,
  oy : Double,
  dx : Double,
  dz : Double,
  len : Double,
  dy : Double,
  spot? : Spot,
) -> Double {
  let sp : Spot? = spot
  let has_spot = sp is Some(_)
  let sp = sp.unwrap_or({ tx: 0.0, tz: 0.0, fired: false, concealed: false, })
  let mut best = -1.0
  for i in 0..<list.items.length() {
    let c = list.items[i]
    // JS: if (!(c.blocksShells || (spot && c.blocksSpot))) continue;
    if !(c.blocks_shells || (has_spot && c.blocks_spot)) {
      continue
    }
    let t0 = ray_circle(ox, oz, dx, dz, len, c.x, c.z, c.r)
    if t0 < 0.0 {
      continue
    }
    // JS: c.shape === 'box' ? rayObb(...) : t0
    let t = if c.shape == "box" { ray_obb(ox, oz, dx, dz, len, c) } else { t0 }
    if t < 0.0 || (best >= 0.0 && t >= best) {
      continue
    }
    // WoT: 观察者身边 50m 内的软质草本对视线透明(simcore.js:66)
    if has_spot && c.blocks_spot && !c.blocks_shells && t < 50.0 {
      continue
    }
    // WoT 15m 规: 目标开炮后 4s 内它 15m 内的草本不再遮蔽它(simcore.js:69-70)
    if has_spot &&
      sp.fired &&
      c.blocks_spot &&
      !c.blocks_shells &&
      @math.hypot(c.x - sp.tx, c.z - sp.tz) < 15.0 {
      continue
    }
    let mut ch = c.h
    // 草丛把蹲入的整车连炮塔一起藏住(simcore.js:72-74)
    if has_spot &&
      c.blocks_spot &&
      !c.blocks_shells &&
      sp.concealed &&
      @math.hypot(ox + dx * t - sp.tx, oz + dz * t - sp.tz) < 6.0 {
      ch = ch + 1.8
    }
    let h = oy + dy * t
    // 命中掩体高度内(simcore.js:76)
    if h < height_at(ox + dx * t, oz + dz * t) + ch {
      best = t
    }
  }
  best
}

///|
/// nearestCoverBetween (simcore.js:82-93): 找 a→b 方向最近的掩体(AI 撤退寻掩用)。
pub fn nearest_cover_between(
  list : CoverList,
  ax : Double,
  az : Double,
  bx : Double,
  bz : Double,
) -> Cover? {
  let mut best : Cover? = None
  let mut best_t = 1.0e9
  let dx = bx - ax
  let dz = bz - az
  let len = @math.hypot(dx, dz)
  if len < 1.0 {
    return None
  }
  for i in 0..<list.items.length() {
    let c = list.items[i]
    // JS: if (!c.blocksShells && !c.blocksSpot) continue;
    if !(c.blocks_shells || c.blocks_spot) {
      continue
    }
    let t = ray_circle(ax, az, dx / len, dz / len, len, c.x, c.z, c.r)
    if t >= 0.0 && t < best_t {
      best_t = t
      best = Some(c)
    }
  }
  best
}

///|
/// bushState (simcore.js:98-105): 草丛/树篱/草垛/残骸等软质物的目标状态。
/// bushes 缓存在 list 自身(首次调用时 filter 填充, 战斗期间不变)。
pub fn CoverList::bush_state(
  self : CoverList,
  t : CamoTarget,
  time : Double,
) -> BushState {
  let bushes = match self.bushes {
    Some(b) => b
    None => {
      // JS: list.bushes || (list.bushes = list.filter(b => b.blocksSpot && !b.blocksShells))
      let b = self.items.filter(fn(c) { c.blocks_spot && !c.blocks_shells })
      self.bushes = Some(b)
      b
    }
  }
  let mut in_bush = false
  for b in bushes {
    if @math.hypot(b.x - t.x, b.z - t.z) < b.r + 3.5 {
      in_bush = true
      break
    }
  }
  // JS: time - (t.lastFireT || -99) < 4(`||` 的 JS 假值语义: 0/-0/NaN → -99)
  let fired = time - js_or_neg99(t.last_fire_t) < 4.0
  { in_bush, fired, concealed: in_bush && !fired, }
}

///|
/// JS 假值语义的 `x || -99`: 0/-0/NaN 取 -99, 其余原样
fn js_or_neg99(x : Double) -> Double {
  if x == 0.0 || x.is_nan() {
    -99.0
  } else {
    x
  }
}

///|
/// camoOf (simcore.js:107-114): 隐蔽值(WoT camo)—— 移动减半; 蹲草 +0.25; 开炮后 4s 近乎清零。
pub fn CoverList::camo_of(
  self : CoverList,
  t : CamoTarget,
  time : Double,
) -> Double {
  // JS: (t.spec && t.spec.camo !== undefined) ? t.spec.camo : 0.12
  let c0 = t.camo.unwrap_or(0.12)
  let mut c = c0
  if t.speed.abs() > 1.2 || t.last_yaw_rate.abs() > 0.08 {
    c = c * 0.5
  }
  if self.bush_state(t, time).in_bush {
    c = c + 0.25
  }
  if time - js_or_neg99(t.last_fire_t) < 4.0 {
    c = c.min(c0 * 0.1)
  }
  c.min(0.8)
}
