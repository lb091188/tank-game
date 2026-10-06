// sim-engine.js:484-596 直译: 阶段2 3D 线段-OBB 求交与部位判定(零 THREE, 服务器可用)。

///|
/// dot3 (sim-engine.js:524-527; JS 版兼容数组参数, 这里以 Vec3 承载)
fn dot3(a : Vec3, b : Vec3) -> Double {
  a.x * b.x + a.y * b.y + a.z * b.z
}

///|
/// JS Math.hypot 三参版(V8 实现为近似逼近, 这里按定义式; 差异 ≪ 1e-6 比对容差)
fn hypot3(a : Double, b : Double, c : Double) -> Double {
  (a * a + b * b + c * c).sqrt()
}

///|
/// axesYXZ (sim-engine.js:488-501): 旋转基(列向量约定: local = Rᵀ·world);
/// YXZ 欧拉 = RY·RX·RZ(与表现层 rotation.set(-pitch,yaw,roll,'YXZ') 同约定)
fn axes_yxz(pitch : Double, yaw : Double, roll : Double) -> Axes {
  let cy = @math.cos(yaw)
  let sy = @math.sin(yaw)
  let cx = @math.cos(pitch)
  let sx = @math.sin(pitch)
  let cz = @math.cos(roll)
  let sz = @math.sin(roll)
  {
    ex: { x: cy * cz + sy * sx * sz, y: cx * sz, z: -sy * cz + cy * sx * sz, },
    ey: { x: -cy * sz + sy * sx * cz, y: cx * cz, z: sy * sz + cy * sx * cz, },
    ez: { x: sy * cx, y: -sx, z: cy * cx, },
  }
}

///|
/// axesRY (sim-engine.js:502-505)
fn axes_ry(a : Double) -> Axes {
  let c = @math.cos(a)
  let s = @math.sin(a)
  {
    ex: { x: c, y: 0.0, z: -s, },
    ey: { x: 0.0, y: 1.0, z: 0.0, },
    ez: { x: s, y: 0.0, z: c, },
  }
}

///|
/// axesRX (sim-engine.js:506-509)
fn axes_rx(a : Double) -> Axes {
  let c = @math.cos(a)
  let s = @math.sin(a)
  {
    ex: { x: 1.0, y: 0.0, z: 0.0, },
    ey: { x: 0.0, y: c, z: s, },
    ez: { x: 0.0, y: -s, z: c, },
  }
}

///|
/// mulAxes (sim-engine.js:510-515): R = A·B(列向量 = A·(B 的列))
fn mul_axes(a : Axes, b : Axes) -> Axes {
  fn col(v : Vec3) -> Vec3 {
    {
      x: a.ex.x * v.x + a.ey.x * v.y + a.ez.x * v.z,
      y: a.ex.y * v.x + a.ey.y * v.y + a.ez.y * v.z,
      z: a.ex.z * v.x + a.ey.z * v.y + a.ez.z * v.z,
    }
  }

  { ex: col(b.ex), ey: col(b.ey), ez: col(b.ez), }
}

///|
/// axesQuat (sim-engine.js:516-523): 四元数 [x,y,z,w] → 局部轴基(与 THREE.Quaternion 同约定)
fn axes_quat(q : (Double, Double, Double, Double)) -> Axes {
  let (x, y, z, w) = q
  {
    ex: {
      x: 1.0 - 2.0 * (y * y + z * z),
      y: 2.0 * (x * y + z * w),
      z: 2.0 * (x * z - y * w),
    },
    ey: {
      x: 2.0 * (x * y - z * w),
      y: 1.0 - 2.0 * (x * x + z * z),
      z: 2.0 * (y * z + x * w),
    },
    ez: {
      x: 2.0 * (x * z + y * w),
      y: 2.0 * (y * z - x * w),
      z: 1.0 - 2.0 * (x * x + y * y),
    },
  }
}

///|
/// rayOBB3D (sim-engine.js:531-550): 3D 线段 vs OBB(slab 法): o+线段dir·t ∈ [0,len],
/// 返回 {t, point, normal} 或 None。normal=命中面法线(世界系, 朝外来弹)。
pub fn ray_obb_3d(
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  len : Double,
  c : Vec3,
  r : Axes,
  h : (Double, Double, Double),
) -> RayHit? {
  let px = ox - c.x
  let py = oy - c.y
  let pz = oz - c.z
  let lo = [
    dot3({ x: px, y: py, z: pz, }, r.ex),
    dot3({ x: px, y: py, z: pz, }, r.ey),
    dot3({ x: px, y: py, z: pz, }, r.ez),
  ]
  let ld = [
    dot3({ x: dx, y: dy, z: dz, }, r.ex),
    dot3({ x: dx, y: dy, z: dz, }, r.ey),
    dot3({ x: dx, y: dy, z: dz, }, r.ez),
  ]
  let ha = [h.0, h.1, h.2]
  let mut tmin = @double.neg_infinity
  let mut tmax = @double.infinity
  let mut ax_min = 0
  let mut sg_min = 1.0
  for a in 0..<3 {
    if ld[a].abs() < 1.0e-9 {
      if lo[a] < -ha[a] || lo[a] > ha[a] {
        return None
      }
      continue
    }
    let inv = 1.0 / ld[a]
    let mut t1 = (-ha[a] - lo[a]) * inv
    let mut t2 = (ha[a] - lo[a]) * inv
    let mut sg = -1.0
    if t1 > t2 {
      let q = t1
      t1 = t2
      t2 = q
      sg = 1.0
    }
    if t1 > tmin {
      tmin = t1
      ax_min = a
      sg_min = sg
    }
    if t2 < tmax {
      tmax = t2
    }
    if tmin > tmax {
      return None
    }
  }
  if tmax < 0.0 || tmin > len {
    return None
  }
  let tt = 0.0.max(tmin) // 起点在盒内(几乎不发生): 钳到段首
  let axis = match ax_min {
    0 => r.ex
    1 => r.ey
    _ => r.ez
  }
  let n = sg_min * (if tmin < 0.0 { -1.0 } else { 1.0 })
  Some({
    t: tt,
    point: { x: ox + dx * tt, y: oy + dy * tt, z: oz + dz * tt, },
    normal: { x: axis.x * n, y: axis.y * n, z: axis.z * n, },
  })
}

///|
/// tankOBBFrames (sim-engine.js:555-569): 组合 车体(YXZ: -pitch/yaw/roll) → 炮塔(+turretYaw)
/// → 火炮(+gunPitch) 三级变换。JS 读全局 SF.CFG.partBoxes 取枢轴, 这里以参数注入(表项可缺)。
pub fn tank_obb_frames(tb : PartBoxEntry?, t : Tank) -> ObbFrames {
  let hull = axes_yxz(t.pitch, t.yaw, t.roll)
  let base : Vec3 = { x: t.x, y: t.y, z: t.z, }
  fn at(r : Axes, off : (Double, Double, Double)) -> Vec3 {
    let ov : Vec3 = { x: off.0, y: off.1, z: off.2, }
    {
      x: base.x + dot3(r.ex, ov),
      y: base.y + dot3(r.ey, ov),
      z: base.z + dot3(r.ez, ov),
    }
  }

  let tb0 = match tb {
    Some(e) => e
    None =>
      // JS: tb && tb.turretPivot —— 表整体缺失时枢轴全走兜底
      { turret_pivot: None, gun_pivot: None, gun_parent: None, zones: None, }
  }
  // JS: (tb && tb.turretPivot) || [0, 1.5, 0]
  let tp = match tb0.turret_pivot {
    Some(p) => p
    None => (0.0, 1.5, 0.0)
  }
  let turret : Frame = {
    base: at(hull, tp),
    r: mul_axes(hull, axes_ry(ang_diff(t.yaw, t.turret_yaw))),
  }
  // JS: (tb && tb.gunPivot) || [0, 0.4, 1]; gunParent || 'turret'
  let gp = match tb0.gun_pivot {
    Some(p) => p
    None => (0.0, 0.4, 1.0)
  }
  let gp_parent = match tb0.gun_parent {
    Some(p) => p
    None => "turret"
  }
  let gp_base = if gp_parent == "turret" { turret } else { { base, r: hull, } }
  let gpv : Vec3 = { x: gp.0, y: gp.1, z: gp.2, }
  let gun : Frame = {
    base: {
      x: gp_base.base.x + dot3(gp_base.r.ex, gpv),
      y: gp_base.base.y + dot3(gp_base.r.ey, gpv),
      z: gp_base.base.z + dot3(gp_base.r.ez, gpv),
    },
    r: mul_axes(gp_base.r, axes_rx(-t.gun_pitch)),
  }
  { hull: { base, r: hull, }, turret, gun, }
}

///|
/// 兜底三盒(sim-engine.js:574-577): spec.sample 包络 tracks/hullSide/turretFront
/// (表覆盖全部 129 型, 此路径仅防御未知/半成品车; JS 同时写 t._obbFallback 标记)
fn fallback_boxes(t : Tank) -> Array[ZoneBox] {
  t.obb_fallback = true
  let sw = t.spec.sample_w
  let sl = t.spec.sample_l
  [
    {
      z: "tracks",
      armor: 20.0,
      c: (0.0, 0.45, 0.0),
      h: (sw, 0.5, sl),
      p: "root",
      q: None,
    },
    {
      z: "hullSide",
      armor: 30.0,
      c: (0.0, 1.0, 0.0),
      h: (sw, 0.55, sl),
      p: "root",
      q: None,
    },
    {
      z: "turretFront",
      armor: 40.0,
      c: (0.0, 1.7, 0.0),
      h: (sw, 0.35, sl),
      p: "turret",
      q: None,
    },
  ]
}

///|
/// probeTankOBB (sim-engine.js:571-596): 坦克部位 OBB 探针, 对 partBoxes 表逐盒求交取最近。
/// 返回 {distance, point, normal, zone, armor} | None。
pub fn probe_tank_obb(
  part_boxes : Map[String, PartBoxEntry]?,
  t : Tank,
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  seg_len : Double,
) -> ObbHit? {
  let tb = match part_boxes {
    Some(m) => m.get(t.typ)
    None => None
  }
  let boxes : Array[ZoneBox] = match tb {
    Some(e) =>
      match e.zones {
        Some(zs) => zs
        None => fallback_boxes(t)
      }
    None => fallback_boxes(t)
  }
  let f = tank_obb_frames(tb, t)
  let mut best : ObbHit? = None
  // 逐盒粗距早退(阶段5 性能): 盒中心到炮线起点距离 > 盒外接半径 + 线长 + 2m 安全余量 →
  // 精测必空, 跳过(该早退不改变命中结果)
  for z in boxes {
    let sp = match z.p {
      "root" => f.hull
      "turret" => f.turret
      "gun" => f.gun
      _ => f.hull // JS spaces[z.p] || f.hull
    }
    let zv : Vec3 = { x: z.c.0, y: z.c.1, z: z.c.2, }
    let c : Vec3 = {
      x: sp.base.x + dot3(sp.r.ex, zv),
      y: sp.base.y + dot3(sp.r.ey, zv),
      z: sp.base.z + dot3(sp.r.ez, zv),
    }
    let rr = hypot3(z.h.0, z.h.1, z.h.2)
    let cd = hypot3(c.x - ox, c.y - oy, c.z - oz)
    if cd - rr > seg_len + 2.0 {
      continue
    }
    let r = match z.q {
      Some(q) => mul_axes(sp.r, axes_quat(q))
      None => sp.r
    }
    let hit = ray_obb_3d(ox, oy, oz, dx, dy, dz, seg_len, c, r, z.h)
    match hit {
      Some(h) => {
        // JS: if (hit && (!best || hit.t < best.t)) —— 但 best 存的是 {distance: hit.t, ...},
        // 没有 t 字段, best.t === undefined → hit.t < undefined 恒 false —— 上游缺陷
        // (本意应比 best.distance): 实际语义 = 数组序首个相交盒胜出, 而非最近盒。
        // 直译同构保留该缺陷(SPEC §6: 缺陷也要复刻, "顺手修好"即对账分歧)。
        let better = match best {
          Some(_) => false // JS hit.t < best.t(undefined) 恒 false
          None => true
        }
        if better {
          best = Some({
            distance: h.t,
            point: h.point,
            normal: h.normal,
            zone: z.z,
            armor: z.armor,
          })
        }
      }
      None => ()
    }
  }
  best
}
