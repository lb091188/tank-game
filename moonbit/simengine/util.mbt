// SF.Util 小工具子集(config.js:1458-1523, simcore 未覆盖部分)+ 全局 RNG 注入口
// (JS 全局 Math.random 替换的等价物, SPEC §4)+ JS 语义垫片(%/round/||-假值)。

///|
/// 全局 RNG 状态: JS 侧 mulberry32(seed) 替换全局 Math.random(golden-trace2.js boot,
/// 装载任何内核脚本之前), 消费次序即规范(SPEC §4)。MoonBit 以包级 Ref 承载同一语义。
let global_rng : Ref[@simcore.Mulberry32] = Ref::new(
  @simcore.Mulberry32::new(0),
)

///|
/// boot() 等价: 构造任何内核对象之前, 以场景种子重置全局 RNG
pub fn set_rng(seed : Int) -> Unit {
  global_rng.val = @simcore.Mulberry32::new(seed)
}

///|
/// Math.random() 等价(引擎内全部掷骰走这里, 次序与 JS 一一对应)
pub fn rand() -> Double {
  global_rng.val.next()
}

///|
/// SF.Util.clamp (config.js:1460) —— 与 @simcore.clamp 同式, 转发以保调用点对应
pub fn clamp(v : Double, a : Double, b : Double) -> Double {
  @simcore.clamp(v, a, b)
}

///|
/// SF.Util.lerp (config.js:1461)
pub fn lerp(a : Double, b : Double, t : Double) -> Double {
  a + (b - a) * t
}

///|
/// SF.Util.angDiff (config.js:1463) 与 sim-engine.js U_angDiff(:570) 同式:
/// 角度差(结果 ∈ [-π,π], from a to b)。JS `%` = C fmod(IEEE 精确余数), 直译走 extern fmod。
pub fn ang_diff(a : Double, b : Double) -> Double {
  let mut d = js_fmod(b - a, 2.0 * @math.PI)
  if d > @math.PI {
    d -= 2.0 * @math.PI
  }
  if d < -@math.PI {
    d += 2.0 * @math.PI
  }
  d
}

///|
/// JS `%`(ECMA: 商向零截断的 IEEE 余数, 即 C fmod)—— MoonBit Double 无 % 运算符
extern "C" fn js_fmod(x : Double, y : Double) -> Double = "fmod"

///|
/// JS Math.round 直译(ECMA 规范: floor(x + 0.5); V8 按规范实现)
pub fn js_round(v : Double) -> Int {
  (v + 0.5).floor().to_int()
}

///|
/// Math.sign(d): 1/-1/±0(JS 对 -0 返回 -0; 直接返回 d 保符号, 后续 cur + sign*step 同值)
fn js_sign(d : Double) -> Double {
  if d > 0.0 {
    1.0
  } else if d < 0.0 {
    -1.0
  } else {
    d
  }
}

///|
/// SF.Util.moveToward (config.js:1464)
pub fn move_toward(cur : Double, target : Double, max_step : Double) -> Double {
  let d = target - cur
  if d.abs() <= max_step {
    target
  } else {
    cur + js_sign(d) * max_step
  }
}

///|
/// SF.Util.angMoveToward (config.js:1465)
pub fn ang_move_toward(
  cur : Double,
  target : Double,
  max_step : Double,
) -> Double {
  let d = ang_diff(cur, target)
  if d.abs() <= max_step {
    target
  } else {
    cur + js_sign(d) * max_step
  }
}

///|
/// JS `x || 1`(falsy: 0/-0/NaN → 1)—— Math.hypot/sqrt 结果兜底(SPEC 同式出现多处)
pub fn js_or_1(v : Double) -> Double {
  if v == 0.0 || v.is_nan() {
    1.0
  } else {
    v
  }
}

///|
/// SF.Util.obbPushOut (config.js:1497-1508): 两 OBB 的 SAT 最小平移推出;
/// 相交返回把 a 推离 b 的向量, 不相交返回 None(JS null)
pub fn obb_push_out(a : Obb2d, b : Obb2d) -> (Double, Double)? {
  let a_x = (@math.cos(a.yaw), -@math.sin(a.yaw))
  let a_z = (@math.sin(a.yaw), @math.cos(a.yaw))
  let b_x = (@math.cos(b.yaw), -@math.sin(b.yaw))
  let b_z = (@math.sin(b.yaw), @math.cos(b.yaw))
  let dx = a.x - b.x
  let dz = a.z - b.z
  let mut best = 1.0e9
  let mut mx = 0.0
  let mut mz = 0.0
  for ax in [a_x, a_z, b_x, b_z] {
    let ra = a.hx * (ax.0 * a_x.0 + ax.1 * a_x.1).abs() +
      a.hz * (ax.0 * a_z.0 + ax.1 * a_z.1).abs()
    let rb = b.hx * (ax.0 * b_x.0 + ax.1 * b_x.1).abs() +
      b.hz * (ax.0 * b_z.0 + ax.1 * b_z.1).abs()
    let dist = ax.0 * dx + ax.1 * dz
    let ov = ra + rb - dist.abs()
    if ov <= 0.0 {
      return None
    }
    if ov < best {
      best = ov
      let s = if dist >= 0.0 { 1.0 } else { -1.0 }
      mx = ax.0 * s * best
      mz = ax.1 * s * best
    }
  }
  Some((mx, mz))
}
