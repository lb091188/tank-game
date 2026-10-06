// SF.Util 直译(client/js/config.js:1459-1523 本链被读子集)+ 全局随机源。
// SPEC §4: 生成器在装载内核前以 mulberry32(seed) 替换全局 Math.random; 直译侧以可注入的
// 全局 RNG 状态等价 —— 所有内核掷骰(sim-engine 散布/判伤、srv-sim 重生/波次/空投、AI 感知
// 相位/导航)一律走 random(), 注入时机 = 构造任何内核对象之前(见 tracesrv 驱动)。

///|
/// 全局 Math.random 的直译宿主(boot 时置种子)
let g_rng : Ref[@simcore.Mulberry32] = { val: @simcore.Mulberry32::new(0), }

///|
/// boot(files, seed) 的 Math.random 替换点(golden-trace2.js:145)
pub fn rng_boot(seed : Int) -> Unit {
  g_rng.val = @simcore.Mulberry32::new(seed)
}

///|
/// Math.random()(各内核掷骰调用点的统一直译)
pub fn random() -> Double {
  g_rng.val.next()
}

///|
/// SF.Util.clamp (config.js:1460) —— 复用 simcore 同式实现
pub fn clamp(v : Double, a : Double, b : Double) -> Double {
  @simcore.clamp(v, a, b)
}

///|
/// SF.Util.lerp (config.js:1461)
pub fn lerp(a : Double, b : Double, t : Double) -> Double {
  a + (b - a) * t
}

///|
/// SF.Util.angDiff (config.js:1463): 角度差 ∈ [-π,π]
pub fn ang_diff(a : Double, b : Double) -> Double {
  let mut d = (b - a) % (2.0 * @math.PI)
  if d > @math.PI {
    d -= 2.0 * @math.PI
  }
  if d < -@math.PI {
    d += 2.0 * @math.PI
  }
  d
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
/// SF.Util.dist2d (config.js:1467)
pub fn dist2d(ax : Double, az : Double, bx : Double, bz : Double) -> Double {
  @math.hypot(bx - ax, bz - az)
}

///|
/// SF.Util.obbPushOut (config.js:1499-1516): 两 OBB 的 SAT 最小平移推出。
/// obb = {x, z, yaw, hx, hz}; 相交返回把 a 推离 b 的向量, 不相交 None。
pub fn obb_push_out(
  ax : Double,
  az : Double,
  ayaw : Double,
  ahx : Double,
  ahz : Double,
  bx : Double,
  bz : Double,
  byaw : Double,
  bhx : Double,
  bhz : Double,
) -> (Double, Double)? {
  let a_x = (v8_cos(ayaw), -v8_sin(ayaw))
  let a_z = (v8_sin(ayaw), v8_cos(ayaw))
  let b_x = (v8_cos(byaw), -v8_sin(byaw))
  let b_z = (v8_sin(byaw), v8_cos(byaw))
  let dx = ax - bx
  let dz = az - bz
  let mut best = 1.0e9
  let mut mx = 0.0
  let mut mz = 0.0
  let axes = [a_x, a_z, b_x, b_z]
  for i in 0..<axes.length() {
    let v = axes[i]
    let ra = ahx * (v.0 * a_x.0 + v.1 * a_x.1).abs() +
      ahz * (v.0 * a_z.0 + v.1 * a_z.1).abs()
    let rb = bhx * (v.0 * b_x.0 + v.1 * b_x.1).abs() +
      bhz * (v.0 * b_z.0 + v.1 * b_z.1).abs()
    let dist = v.0 * dx + v.1 * dz
    let ov = ra + rb - dist.abs()
    if ov <= 0.0 {
      return None
    }
    if ov < best {
      best = ov
      let s = if dist >= 0.0 { 1.0 } else { -1.0 }
      mx = v.0 * s * best
      mz = v.1 * s * best
    }
  }
  Some((mx, mz))
}

///|
/// JS `x | 0`(int32 截断; 随机索引取整用, 值域 < 2^31 时等价于向零截断)
pub fn js_trunc(x : Double) -> Int {
  x.to_int()
}

///|
/// Int max/min(数字字面量上不可用 .max 方法链, 恒等 helper)
pub fn imax(a : Int, b : Int) -> Int {
  if a > b {
    a
  } else {
    b
  }
}

///|
pub fn imin(a : Int, b : Int) -> Int {
  if a < b {
    a
  } else {
    b
  }
}
