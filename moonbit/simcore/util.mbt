// SF.Util 纯函数子集直译(client/js/config.js:1458-1523)—— simcore 及后续内核共用。

///|
/// SF.Util.clamp (config.js:1460)
pub fn clamp(v : Double, a : Double, b : Double) -> Double {
  a.max(b.min(v))
}

///|
/// SF.Util.rayObb (config.js:1471-1495): 2D 射线 vs OBB(slab 法), 返回 t(0..len) 或 -1
pub fn ray_obb(
  ox : Double,
  oz : Double,
  dx : Double,
  dz : Double,
  len : Double,
  c : Cover,
) -> Double {
  let cs = @math.cos(c.yaw)
  let sn = @math.sin(c.yaw)
  // JS: c.yaw || 0 —— Cover.yaw 恒有值(coverCol 时已归一 0)
  let px = ox - c.x
  let pz = oz - c.z
  let mut lo = -1.0e9
  let mut hi = 1.0e9
  // 左舷轴 slab
  let mut ld = cs * dx - sn * dz
  let mut lp = cs * px - sn * pz
  if ld.abs() < 1.0e-9 {
    if lp.abs() > c.hx {
      return -1.0
    }
  } else {
    let mut t1 = (-c.hx - lp) / ld
    let mut t2 = (c.hx - lp) / ld
    if t1 > t2 {
      let q = t1
      t1 = t2
      t2 = q
    }
    lo = lo.max(t1)
    hi = hi.min(t2)
    if lo > hi {
      return -1.0
    }
  }
  // 前进轴 slab
  ld = sn * dx + cs * dz
  lp = sn * px + cs * pz
  if ld.abs() < 1.0e-9 {
    if lp.abs() > c.hz {
      return -1.0
    }
  } else {
    let mut t1 = (-c.hz - lp) / ld
    let mut t2 = (c.hz - lp) / ld
    if t1 > t2 {
      let q = t1
      t1 = t2
      t2 = q
    }
    lo = lo.max(t1)
    hi = hi.min(t2)
    if lo > hi {
      return -1.0
    }
  }
  if hi < 0.0 || lo > len {
    return -1.0
  }
  lo.max(0.0)
}

///|
/// SF.Util.rayCircle (config.js:1513-1522): 2D 射线-圆相交, 返回 t(0..len) 或 -1
pub fn ray_circle(
  ox : Double,
  oz : Double,
  dx : Double,
  dz : Double,
  len : Double,
  cx : Double,
  cz : Double,
  r : Double,
) -> Double {
  let fx = ox - cx
  let fz = oz - cz
  let b = fx * dx + fz * dz
  let c = fx * fx + fz * fz - r * r
  if c > 0.0 && b > 0.0 {
    return -1.0
  }
  let disc = b * b - c
  if disc < 0.0 {
    return -1.0
  }
  let mut t = -b - disc.sqrt()
  if t < 0.0 {
    t = 0.0
  }
  if t <= len {
    t
  } else {
    -1.0
  }
}
