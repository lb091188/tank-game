// client/js/sim-engine.js (SF.SimEngine) 直译: 瞄准换算/质量估算/掩体碰撞/车辆逐帧更新/
// 开炮/炮弹积分。逐函数对照, 注释标原函数名与行号; 运算次序与 JS 逐句一致。

///|
/// aimToLocal (sim-engine.js:21-41): 世界瞄准方向 → 车体局部系。
/// HULL_Q = Quaternion.setFromEuler(Euler(-pitch, yaw, roll, 'YXZ')).invert()
/// (r128 的 invert() 即 conjugate: x/y/z 取反, w 不变)
pub fn aim_to_local(
  dx : Double,
  dy : Double,
  dz : Double,
  pitch : Double,
  yaw : Double,
  roll : Double,
) -> Vec3 {
  let hx = -pitch
  let hy = yaw
  let hz = roll
  let c1 = @math.cos(hx / 2.0)
  let c2 = @math.cos(hy / 2.0)
  let c3 = @math.cos(hz / 2.0)
  let s1 = @math.sin(hx / 2.0)
  let s2 = @math.sin(hy / 2.0)
  let s3 = @math.sin(hz / 2.0)
  let qx = -(s1 * c2 * c3 + c1 * s2 * s3)
  let qy = -(c1 * s2 * c3 - s1 * c2 * s3)
  let qz = -(c1 * c2 * s3 - s1 * s2 * c3)
  let qw = c1 * c2 * c3 + s1 * s2 * s3
  // Vector3.applyQuaternion 逐式(q*v 后再乘 q 共轭, r128 min 源同式同序)
  let ix = qw * dx + qy * dz - qz * dy
  let iy = qw * dy + qz * dx - qx * dz
  let iz = qw * dz + qx * dy - qy * dx
  let iw = -qx * dx - qy * dy - qz * dz
  {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  }
}

///|
/// massOf (sim-engine.js:44-47): 撞击质量估算(吨), vehicle.js _mass 移植
/// (车型密度 × 车体投影面积, 谢尔曼=1; 未知类别 → 32)
pub fn mass_of(spec : Spec) -> Double {
  let dens = match spec.cls {
    "LT" => 14.0
    "MT" => 32.0
    "HT" => 48.0
    "TD" => 34.0
    "SPG" => 24.0
    _ => 32.0
  }
  dens * (spec.sample_l * spec.sample_w) / (3.05 * 1.45)
}

///|
/// collideTank (sim-engine.js:51-83): 车体 OBB vs 掩体圆/OBB SAT 推出
/// (models.js CoverField.collideTank 逐行移植)。返回 [nx, nz](JS 返回数组)。
pub fn collide_tank(t : Tank, list : @simcore.CoverList) -> (Double, Double) {
  let mut nx = t.x
  let mut nz = t.z
  let hw = t.spec.sample_w // S.sample.w 半宽
  let hl = t.spec.sample_l // S.sample.l 半长
  let circ = @math.hypot(hw, hl) // 车体外接半径(快速剔除必须用真值, 否则会漏检)
  let cs = @math.cos(t.yaw)
  let sn = @math.sin(t.yaw)
  for c in list.items {
    if !c.blocks_move {
      continue
    }
    let dx0 = nx - c.x
    let dz0 = nz - c.z
    let rr = c.r + circ
    if dx0 * dx0 + dz0 * dz0 > rr * rr {
      continue
    }
    if c.shape == "box" {
      // SF.Util.obbPushOut({x,z,yaw,hx:hw,hz:hl}, c)
      match
        obb_push_out({ x: nx, z: nz, yaw: t.yaw, hx: hw, hz: hl, }, {
          x: c.x,
          z: c.z,
          yaw: c.yaw,
          hx: c.hx,
          hz: c.hz,
        }) {
        Some((px, pz)) => {
          nx += px
          nz += pz
        }
        None => ()
      }
    } else {
      // 圆掩体 vs 车体 OBB: 掩体圆心变换到车体局部系求最近点, 按穿透深度推出
      let rx = c.x - nx // 车体→掩体圆心(世界系)
      let rz = c.z - nz
      let lx = cs * rx - sn * rz // 掩体圆心在车体局部系
      let lz = sn * rx + cs * rz
      let qx = (-hw).max(hw.min(lx))
      let qz = (-hl).max(hl.min(lz))
      let ddx = lx - qx // 最近点→圆心(车体局部系)
      let ddz = lz - qz
      let d = @math.hypot(ddx, ddz)
      if d < 1.0e-6 {
        // 圆心陷入车体(几乎不发生): 沿圆心→车心方向退出一个半径
        let bx = nx - c.x
        let bz = nz - c.z
        let bl = js_or_1(@math.hypot(bx, bz))
        nx += bx / bl * (c.r + hl)
        nz += bz / bl * (c.r + hl)
        continue
      }
      if d < c.r {
        let k = (c.r - d) / d
        let px2 = -ddx * k // 车体沿"圆心→最近点"反方向推出
        let pz2 = -ddz * k
        nx += cs * px2 + sn * pz2
        nz += -sn * px2 + cs * pz2
      }
    }
  }
  (nx, nz)
}

///|
/// updateTank (sim-engine.js:88-334): 车辆逐帧数值更新(vehicle.js update 的行驶/碰撞/地形/
/// 坠落/瞄准/装填段移植)。alive 检查由调用方(薄壳)负责(JS 同)。
pub fn update_tank(t : Tank, input : Input, dt : Double, env : Env) -> Unit {
  let s = t.spec // JS const S = t.spec
  let terrain = env.terrain // JS const T = env.terrain
  let emit = env.emit
  let yaw0 = t.yaw // 车体本帧转前朝向(右键锁定时炮塔随车体走, 见瞄准段)
  // for (const k in t.modules) t.modules[k] = Math.max(0, t.modules[k] - dt)  (:93)
  t.mod_track = 0.0.max(t.mod_track - dt)
  t.mod_engine = 0.0.max(t.mod_engine - dt)
  t.mod_gun = 0.0.max(t.mod_gun - dt)
  t.mod_ammo = 0.0.max(t.mod_ammo - dt)
  // --- 行驶(惯性/迟滞/滑行) ---
  let track_broken = t.mod_track > 0.0
  // 极速: 发动机损毁 ×slow(=旧 effectiveMaxSpeed 原式)
  let max_f = if t.mod_engine > 0.0 {
    s.max_speed * ARMOR_ENGINE_SLOW
  } else {
    s.max_speed
  }
  let max_r = max_f * s.reverse_ratio
  let slope = terrain.slope_ahead(t.x, t.z, t.yaw, 4.0)
  // slopeAhead 是弧度角: 用 sin 换算重力分量做动力惩罚
  let slope_k = clamp(1.0 - @math.sin(slope.abs()) * 0.85, 0.35, 1.0)
  let uphill = (input.throttle > 0.0 && t.speed >= 0.0) ||
    (input.throttle < 0.0 && t.speed <= 0.0)
  if track_broken {
    t.speed = move_toward(t.speed, 0.0, 6.0 * dt) // 断带: 瘫痪
  } else {
    // 只挡"沿行进方向往高处去"且超极限: 陡壁墙(梯度模) 或 连续陡坡(方向坡度);
    // 倒车脱离/顺坡向下永远放行 —— 否则车头抵崖会上不去也退不出(卡死)
    let mut blocked = false
    if uphill {
      let mv = if input.throttle > 0.0 { 1.0 } else { -1.0 }
      // 陡壁墙: 行进方向前方 3.5m 地面是"向高处去的不可攀陡壁"(梯度模判定, 之字迂回骗不过;
      // 只挡往高处开 —— 倒车脱离/顺坡向下永远放行, 否则车头抵崖卡死)。
      // JS: if (T.gradAt) —— Terrain 恒有 gradAt, 恒真
      let ax = t.x + @math.sin(t.yaw) * 3.5 * mv
      let az = t.z + @math.cos(t.yaw) * 3.5 * mv
      if !(terrain.height_at(ax, az) <= terrain.height_at(t.x, t.z) + 0.15) &&
        terrain.grad_at(ax, az) > @math.tan(MAX_SLOPE) * 1.25 {
        blocked = true
      }
      if slope * mv > MAX_SLOPE {
        blocked = true
      }
    }
    if blocked {
      t.speed = move_toward(t.speed, 0.0, 8.0 * dt) // 陡坡/陡壁爬不上去
    } else {
      // --- 自动变速箱(实车手感): 前进 D1/D2/D3 + 倒车 R1/R2 + 空挡 N(仅初始) ---
      // 每挡限速(D1≈42% / D2≈72% / D3=100% 极速; 倒挡 R1≈58%), 低挡扭力大;
      // 踩住油门逐级升挡(升挡 0.15s 扭矩中断的顿挫感), 减速/刹停自动回落(升/降阈值留滞回带防拉锯);
      // 前后换向: 立即切入新方向最高挡 + 1s 最大扭矩窗口(换挡全部冻结)——无逐挡顿挫、全速域授权;
      // 挡向不符时制动 + 新方向全扭矩一起反拽(WoT 式跟手), 速度过零即纯反向扭矩 —— 卖头骗炮的核心节奏
      // JS: const GB = CFG.sim.gearbox(:129)
      if t.shift_t > 0.0 {
        t.shift_t -= dt
      }
      if t.flip_t > 0.0 {
        t.flip_t -= dt
      }
      let gc = t.gear.get(0).unwrap().to_int() // JS t.gear[0] 单字符
      let g_dir = if gc == 82 { "R" } else if gc == 68 { "D" } else { "N" }
      // JS: +t.gear[1] - 1('1' 的 charcode=49 → 0 基挡序; 'N' → -1)
      let g_idx = if t.gear == "N" {
        -1
      } else {
        t.gear.get(1).unwrap().to_int() - 49
      }
      let caps = if g_dir == "R" { gb_rev } else { gb_fwd }
      let tq = if g_dir == "R" { gb_torque_r } else { gb_torque_f }
      let top = if g_dir == "R" { max_r } else { max_f }
      // 降挡: 速度掉到下一低挡上限×0.93 以下(停稳一路回落到 1 挡); 换向窗口内冻结
      if t.flip_t <= 0.0 &&
        g_idx > 0 &&
        t.speed.abs() < top * caps[g_idx - 1] * 0.93 {
        t.gear = g_dir + g_idx.to_string() // 'D'+2 → 'D2' (gIdx=2 → 第2挡)
      }
      let want = if input.throttle > 0.05 {
        "D"
      } else if input.throttle < -0.05 {
        "R"
      } else {
        g_dir
      }
      if t.gear != "N" && want != g_dir {
        // 换向直接切最高挡(GB.rev.length=2 / GB.fwd.length=3)
        t.gear = if want == "R" { "R2" } else { "D3" }
        t.shift_t = 0.0
        t.flip_t = 1.0
      }
      if t.gear == "N" {
        t.speed = move_toward(t.speed, 0.0, s.brake * dt) // 空挡带刹滑停
        if t.shift_t <= 0.0 {
          t.gear = if want == "R" { "R1" } else { "D1" }
        }
      } else if input.throttle > 0.0 {
        if g_dir != "D" || t.speed < -0.3 {
          // 换向/向后溜: 制动 + 新方向全扭矩反拽(WoT 式跟手——反向动力直接参与杀前冲动量, 减速近乎翻倍)
          let pull = s.accel *
            (if g_dir != "D" { gb_torque_r[0] } else { gb_torque_f[0] })
          t.speed = move_toward(t.speed, 0.0, (s.brake + pull) * dt)
        } else {
          let cap = top * caps[g_idx]
          if t.speed > cap * 0.985 && g_idx < caps.length() - 1 {
            t.gear = g_dir + (g_idx + 2).to_string() // 升挡顿挫
            t.shift_t = gb_pause
          }
          let a = s.accel *
            (if t.flip_t > 0.0 { tq[0] } else { tq[g_idx] }) *
            (if t.shift_t > 0.0 { 0.25 } else { 1.0 }) *
            (if uphill { slope_k } else { 1.0 }) *
            clamp(1.15 - t.speed.abs() / (top + 0.01) * 0.5, 0.4, 1.0)
          t.speed = (cap * input.throttle).min(t.speed + a * dt)
        }
      } else if input.throttle < 0.0 {
        if g_dir != "R" || t.speed > 0.3 {
          // 换向/向前冲: 同上镜像——倒挡扭矩参与杀前冲动量(骗炮回缩的核心手感)
          let pull = s.accel *
            (if g_dir != "R" { gb_torque_f[0] } else { gb_torque_r[0] })
          t.speed = move_toward(t.speed, 0.0, (s.brake + pull) * dt)
        } else {
          let cap = top * caps[g_idx]
          if t.speed < -cap * 0.985 && g_idx < caps.length() - 1 {
            t.gear = g_dir + (g_idx + 2).to_string()
            t.shift_t = gb_pause
          }
          let a = s.accel *
            (if t.flip_t > 0.0 { tq[0] } else { tq[g_idx] }) *
            (if t.shift_t > 0.0 { 0.25 } else { 1.0 })
          t.speed = (-cap).max(t.speed - a * dt)
        }
      } else {
        t.speed = move_toward(t.speed, 0.0, s.coast_drag * dt) // 松手滑行
      }
    }
  }
  // --- 车体回转(可原地转向; 断带严重削弱) ---
  let steer_auth = if track_broken { 0.25 } else { 1.0 }
  let yaw_rate = s.hull_traverse *
    input.steer *
    steer_auth *
    clamp(1.0 - t.speed.abs() / (max_f * 2.0), 0.55, 1.0)
  t.yaw += yaw_rate * dt
  t.last_yaw_rate = yaw_rate
  // 转向掉速(WoT): 急转履带侧滑损耗动量, 持续满舵明显掉速; 原地转向速度≈0不受影响
  if t.speed.abs() > 0.5 {
    t.speed -= t.speed * input.steer.abs() * 0.4 * dt
  }
  // --- 位移与碰撞 ---
  t.x += @math.sin(t.yaw) * t.speed * dt
  t.z += @math.cos(t.yaw) * t.speed * dt
  t.x = clamp(t.x, -terrain.half + 16.0, terrain.half - 16.0)
  t.z = clamp(t.z, -terrain.half + 16.0, terrain.half - 16.0)
  // 掩体碰撞: 车体 OBB(真实长宽) vs 掩体 SAT 推出; 真正迎面顶撞才掉速(斜擦/狗斗贴靠不受罚)
  let cx0 = t.x
  let cz0 = t.z
  let (nx, nz) = collide_tank(t, env.covers_list)
  t.x = nx
  t.z = nz
  if t.x != cx0 || t.z != cz0 {
    let px2 = t.x - cx0
    let pz2 = t.z - cz0
    let pl = js_or_1(@math.hypot(px2, pz2))
    let cosv = (@math.sin(t.yaw) * px2 + @math.cos(t.yaw) * pz2) / pl // 车头 vs 推出方向(纯方向, 不含速度)
    if cosv < -0.5 && t.speed.abs() > 1.0 {
      t.speed *= 0.3 // 迎面 60° 锥内才算顶撞
    }
  }
  // 车车碰撞: 含残骸(击毁的车也是实体); 车体 OBB 互推, 顶撞掉速
  // 快速剔除用真外接半径(hypot(半宽,半长)), 用小了会漏检头尾相触
  let me : Obb2d = {
    x: t.x,
    z: t.z,
    yaw: t.yaw,
    hx: s.sample_w,
    hz: s.sample_l,
  }
  let my_circ = @math.hypot(s.sample_w, s.sample_l)
  for o in env.tanks {
    if o.tag == t.tag {
      continue // JS o === t(对象同一性; 以构造处发号的 tag 承载)
    }
    let dx0 = t.x - o.x
    let dz0 = t.z - o.z
    let rr = my_circ + @math.hypot(o.spec.sample_w, o.spec.sample_l)
    if dx0 * dx0 + dz0 * dz0 > rr * rr {
      continue
    }
    let push = obb_push_out(me, {
      x: o.x,
      z: o.z,
      yaw: o.yaw,
      hx: o.spec.sample_w,
      hz: o.spec.sample_l,
    })
    match push {
      Some((push0, push1)) => {
        me.x += push0
        me.z += push1
        let plen = js_or_1(@math.hypot(push0, push1))
        // 撞击逼近速度要先于顶撞掉速取值(掉速会把冲量砍到阈值下, 高速对撞变轻碰)
        let nvx = @math.sin(t.yaw) * t.speed
        let nvz = @math.cos(t.yaw) * t.speed
        let ovx = @math.sin(o.yaw) * o.speed
        let ovz = @math.cos(o.yaw) * o.speed
        let closing = -((nvx - ovx) * push0 / plen + (nvz - ovz) * push1 / plen)
        let cosv = (@math.sin(t.yaw) * push0 + @math.cos(t.yaw) * push1) / plen
        if cosv < -0.5 && t.speed.abs() > 1.0 {
          t.speed *= 0.4
        }
        // 撞击伤害(WoT): 高速互撞双方掉血, 逼近速度平方×质量占比, 重车占便宜(残骸不伤人)
        let ram_t0 = if t.ram_t == 0.0 { -9.0 } else { t.ram_t } // JS (t._ramT || -9) 的假值语义
        if o.team != t.team && o.alive && env.time - ram_t0 > 0.5 {
          t.ram_t = env.time // JS t._ramT = o._ramT = env.time(双方共冷却, 一次接触只结算一回)
          o.ram_t = env.time
          let m1 = mass_of(s)
          let m2 = mass_of(o.spec)
          let e = closing * closing * 0.55
          match env.take_ram {
            Some(ram) => {
              ram(t, o, js_round(e * m2 / (m1 + m2)))
              ram(o, t, js_round(e * m1 / (m1 + m2)))
            }
            // JS 默认 ram=(target,shooter,dmg)=>target.takeRam(shooter,dmg) 在桩上不存在(必抛);
            // 夹具恒显式注入 takeRam, 该分支不可达, 以空实现承载
            None => ()
          }
        }
      }
      None => ()
    }
  }
  t.x = me.x
  t.z = me.z
  // --- 陡坡滑落(悬崖手感): 站在超过爬坡极限的坡面上履带抓不住 ---
  // 沿下坡方向缓慢滑移(越陡越快, 封顶 ~4.5m/s, "上不去但滑得下来"), 滑坡中动力卸载;
  // 高速冲出崖沿则进入坠落(见下段), 贴着陡壁再也不会上不去下不来
  // JS: if (T.gradAt && ...) —— 前半恒真
  if t.y - terrain.height_at(t.x, t.z) < 1.0 {
    let g_lim = @math.tan(MAX_SLOPE) * 1.02
    let g_here = terrain.grad_at(t.x, t.z)
    if g_here > g_lim {
      let e2 = 2.0
      let gx = (
          terrain.height_at(t.x + e2, t.z) - terrain.height_at(t.x - e2, t.z)
        ) /
        (2.0 * e2)
      let gz = (
          terrain.height_at(t.x, t.z + e2) - terrain.height_at(t.x, t.z - e2)
        ) /
        (2.0 * e2)
      let gl = js_or_1(@math.hypot(gx, gz))
      let slide = 4.5.min((g_here - g_lim) * 5.5) * dt
      t.x -= gx / gl * slide
      t.z -= gz / gl * slide
      t.x = clamp(t.x, -terrain.half + 16.0, terrain.half - 16.0)
      t.z = clamp(t.z, -terrain.half + 16.0, terrain.half - 16.0)
      t.speed *= 0.0.max(1.0 - dt * 2.2)
    }
  }
  // --- 地形贴合(履带四角采样 → 俯仰/侧倾/高度; 全部平滑防颠簸) ---
  // 车体局部系: 前进+Z, 左舷+X(经 yaw 旋转后: 左舷方向 = (cos yaw, -sin yaw))
  let sn = @math.sin(t.yaw)
  let cs = @math.cos(t.yaw)
  let sl = s.sample_l
  let sw = s.sample_w
  let h_f = terrain.height_at(t.x + sn * sl, t.z + cs * sl)
  let h_b = terrain.height_at(t.x - sn * sl, t.z - cs * sl)
  let h_l = terrain.height_at(t.x + cs * sw, t.z - sn * sw)
  let h_r = terrain.height_at(t.x - cs * sw, t.z + sn * sw)
  let h_c = terrain.height_at(t.x, t.z)
  let target_y = h_c.max((h_f + h_b + h_l + h_r) / 4.0) // 凹: 骑在四角上; 凸: 撑在中心上
  let t_pitch = @math.atan2(h_f - h_b, 2.0 * sl)
  let t_roll = @math.atan2(h_l - h_r, 2.0 * sw)
  if !t.y_init {
    // 出生直接贴地, 不从地里升起
    t.y_init = true
    t.y = target_y
    t.pitch = t_pitch
    t.roll = t_roll
  }
  let sm = 1.0 - @math.exp(-12.0 * dt)
  // --- 坠落(WoT 坠崖): 地面离脚 >1.2m(冲出坡沿/陡壁) → 自由落体替代贴地平滑,
  // 落地按冲击速度摔伤; 阈值 1.2m 让最快车速下最大坡的贴地滞后(~1m)不误判悬空 ---
  let gap = t.y - target_y
  if gap > 1.2 {
    t.fall_v = (if t.fall_v == 0.0 { 0.0 } else { t.fall_v }) + 9.8 * 2.0 * dt // 重力(2× 补贴: 半拍落地手感, 不做真弹跳)
    t.y -= t.fall_v * dt
    let sink = 0.5.min(t.fall_v * 0.06)
    t.pitch = lerp(t.pitch, -sink, sm) // 车头下扎
    if t.y <= target_y {
      // 落地结算
      let v = t.fall_v
      t.y = target_y
      t.fall_v = 0.0
      // JS: const F = CFG.sim.fall
      if v > FALL_SAFE_V && t.alive {
        let dmg = js_round((v - FALL_SAFE_V) * (v - FALL_SAFE_V) * FALL_K)
        // 重摔可能断带; JS 短路: 只有 v > F.trackV 才掷骰
        let brk = if FALL_TRACK_V > 0.0 &&
          v > FALL_TRACK_V &&
          rand() < FALL_TRACK_CHANCE {
          6.0
        } else {
          0.0
        }
        t.mod_track = t.mod_track.max(brk)
        t.hp -= dmg.to_double()
        if t.hp <= 0.0 {
          t.hp = 0.0
          t.alive = false
          emit("destroyed", Destroyed({ tank: t, shooter: None, }))
        }
        emit(
          "hit",
          Hit({
            target: t,
            shooter: None,
            point: { x: t.x, y: t.y + 1.0, z: t.z, },
            zone: "fall",
            dmg,
            kind: "fall",
            module_: if v > FALL_TRACK_V {
              Some("track")
            } else {
              None
            },
          }),
        )
      }
    }
  } else {
    t.fall_v = 0.0
    t.y = lerp(t.y, target_y, sm)
  }
  t.pitch = lerp(t.pitch, t_pitch, sm)
  t.roll = lerp(t.roll, t_roll, sm)
  // 履带滚动/纹理相位(表现侧钩子, 与旧 animateTracks 在 update 内的位置一致)
  match env.on_moved {
    Some(f) => f(t, dt)
    None => ()
  }
  // --- 炮塔/火炮瞄准(WoT 式完整版): 世界瞄准方向 → 车体局部系(含俯仰+横滚) ---
  // 俯仰与回转限制都相对车体: 上坡压缩/下坡扩大世界俯角, 侧坡横滚时侧向瞄准自动补偿
  // JS: input.aimPitch || 0(0 值同结果)
  let cp = @math.cos(input.aim_pitch)
  let sp2 = @math.sin(input.aim_pitch)
  let aim_local = aim_to_local(
    @math.sin(input.aim_yaw) * cp,
    sp2,
    @math.cos(input.aim_yaw) * cp,
    t.pitch,
    t.yaw,
    t.roll,
  )
  let local_yaw = @math.atan2(aim_local.x, aim_local.z)
  let local_elev = @math.atan2(
    aim_local.y,
    @math.hypot(aim_local.x, aim_local.z),
  )
  if input.hold_turret {
    // 右键锁定: 炮塔转角相对车体保持不变(车体转动炮塔跟着走, 世界朝向一起变), 俯仰同样锁住
    t.turret_yaw += t.yaw - yaw0
    t.last_turret_rate = 0.0
  } else if t.no_turret {
    // 固定战斗室(WoT 式): 火炮在 ±gunArc 射界内横向伺服; 超界由引擎/玩家自动转车体对准
    let arc = match s.gun_arc {
      Some(a) => a
      None => 10.0 * @math.PI / 180.0
    }
    let lay_yaw = clamp(local_yaw, -arc, arc)
    // 当前炮向先钳回车体±射界: 车体快速回转时伺服滞后, 炮管会被甩到车体后方(开炮也朝后打)
    t.turret_yaw = t.yaw + clamp(ang_diff(t.yaw, t.turret_yaw), -arc, arc)
    let before = t.turret_yaw
    t.turret_yaw = ang_move_toward(
      t.turret_yaw,
      t.yaw + lay_yaw,
      0.4.max(s.turret_traverse) * dt,
    )
    t.last_turret_rate = ang_diff(before, t.turret_yaw) / dt
  } else {
    let before = t.turret_yaw
    // 分车炮塔转速: 转向期间恒伺服 —— 目标角(车体系)随车体转动而移动, 炮塔以本车
    // turretTraverse(rad/s)的相对角速度持续追赶, 故炮塔世界转速=车体转速±turretTraverse。
    // 仅 turretHullLock 车保留旧二值分支(转向时刚体随动/松舵伺服)。
    if s.turret_hull_lock &&
      input.steer.abs() > 0.15 &&
      t.last_yaw_rate.abs() > 0.05 {
      t.turret_yaw += t.yaw - yaw0
    } else {
      t.turret_yaw = ang_move_toward(
        t.turret_yaw,
        t.yaw + local_yaw,
        s.turret_traverse * dt,
      )
    }
    t.last_turret_rate = ang_diff(before, t.turret_yaw) / dt
  }
  if !input.hold_turret {
    t.gun_pitch = move_toward(
      t.gun_pitch,
      clamp(local_elev, s.gun_depression, s.gun_elevation),
      1.2 * dt,
    )
  }
  // --- 缩圈/扩圈 ---
  // JS: const D = S.dispersion
  let move_k = t.speed.abs() / s.max_speed * s.disp_move
  let turn_k = 1.0.min(t.last_yaw_rate.abs() / s.hull_traverse) *
    s.disp_hull_turn
  let tur_k = 1.0.min(t.last_turret_rate.abs() / 0.01.max(s.turret_traverse)) *
    s.disp_turret_turn
  let disp_target = clamp(
    s.disp_base * (1.0 + move_k + turn_k + tur_k),
    s.disp_base,
    s.disp_max,
  )
  t.disp += (disp_target - t.disp) *
    (1.0 - @math.exp(-dt * 2.2 / s.disp_aim_time))
  // --- 装填 ---
  let was_loading = t.reload_t > 0.0
  t.reload_t = 0.0.max(t.reload_t - dt)
  if was_loading && t.reload_t == 0.0 {
    emit("reloaded", Reloaded({ tank: t, }))
  }
  // 开炮由薄壳在 update 返回后按同位序调用 fire()(散布/弹夹/装填数值段在本模块, 见 fire)
}

///|
/// fire (sim-engine.js:339-359): 开炮数值段(vehicle.js fire 的弹夹/装填/扩圈 + combat.js
/// spawn 的散布偏转)。pos/dir 由调用方给出, 原样随 fire 事件透出。
pub fn fire(
  t : Tank,
  world : World,
  pos : Vec3,
  dir : Vec3,
  emit : (String, EventData) -> Unit,
) -> Bool {
  if !t.alive || t.reload_t > 0.0 {
    return false
  }
  let s = t.spec
  let field = world.shells_field // JS: (world.shells && world.shells.field) || world.shells
  if field.capped() {
    // 阶段5 弹量上限: 拒发时不消耗装填/不出事件, 弹位空出即自动补发
    return false
  }
  let rack = if t.mod_ammo > 0.0 { ARMOR_AMMO_RELOAD_MULT } else { 1.0 } // 弹药架受损: 装填永久变慢
  match s.gun_autoloader {
    Some(al) =>
      if t.clip_left > 1 {
        t.clip_left -= 1
        t.reload_t = al.intra * rack
        t.clip_phase = "intra"
      } else {
        // 打完最后一发 → 整夹长装填
        t.clip_left = al.clip
        t.reload_t = al.long * rack
        t.clip_phase = "long"
      }
    None => t.reload_t = s.gun_reload * rack
  }
  t.reload_total = t.reload_t
  t.st_shots += 1
  let mut disp = t.disp
  if t.mod_gun > 0.0 {
    disp = disp * ARMOR_GUN_DISP_PENALTY
  }
  t.disp = (s.disp_base + s.disp_fire).min(s.disp_max) // 开炮瞬间扩圈
  ignore(field.spawn(t, pos, dir, disp))
  emit("fire", Fire({ tank: t, pos, dir, }))
  true
}

///|
/// makeShells (sim-engine.js:366-482): 炮弹数值积分场(combat.js SF.Shells 物理循环移植;
/// 表现/命中判定经 hooks 注入)。cap = maxShells || 96(预算缓解, 超限拒发)。
pub fn Shells::make(hooks : Hooks, max_shells? : Int) -> Shells {
  { list: [], cap: max_shells.unwrap_or(96), hooks, }
}

///|
/// hooks 对象构造(JS 传入字面量对象, 未给的钩子为 undefined → None)
pub fn Hooks::make(
  on_create? : (Shell) -> Unit,
  on_flight? : (Shell) -> Unit,
  on_impact? : (String, Vec3) -> Unit,
  on_player_miss? : (Vec3) -> Unit,
  on_near_miss? : (Shell) -> Unit,
  on_kill? : (Shell) -> Unit,
  probe_tank? : (
    Shell,
    Tank,
    Double,
    Double,
    Double,
    Double,
    Double,
    Double,
    Double,
  ) -> ObbHit?,
  on_hit_tank? : (Shell, Tank, ObbHit, Vec3) -> Unit,
  on_explode? : (Shell, Vec3, Tank?, Double) -> Unit,
) -> Hooks {
  {
    on_create,
    on_flight,
    on_impact,
    on_player_miss,
    on_near_miss,
    on_kill,
    probe_tank,
    on_hit_tank,
    on_explode,
  }
}

///|
/// capped getter (sim-engine.js:370)
pub fn Shells::capped(self : Shells) -> Bool {
  self.list.filter(fn(s2) { s2.active }).length() >= self.cap
}

///|
/// spawn (sim-engine.js:371-397): 散布: 圆内随机偏转(米@100m → 弧度近似), 2 骰/发
/// (sqrt(random()) 与 random()*2π, 与旧 combat.js spawn 同式同掷骰次序)
pub fn Shells::spawn(
  self : Shells,
  owner : Tank,
  pos : Vec3,
  dir : Vec3,
  disp_m : Double,
) -> Shell? {
  if self.capped() {
    return None
  }
  let ang = disp_m / 100.0 * rand().sqrt()
  let rot = rand() * @math.PI * 2.0
  // right = dir × (0,1,0) 归一; up = right × dir 归一(纯数域复刻 THREE crossVectors/normalize)
  let mut rx = -dir.z
  let ry = 0.0
  let mut rz = dir.x
  let rl = js_or_1((rx * rx + rz * rz).sqrt())
  rx /= rl
  rz /= rl
  let ux = -rz * dir.y
  let uy = rz * dir.x - rx * dir.z
  let uz = rx * dir.y
  let ul = js_or_1((ux * ux + uy * uy + uz * uz).sqrt())
  let ux = ux / ul
  let uy = uy / ul
  let uz = uz / ul
  let ca = @math.cos(rot) * ang
  let sa = @math.sin(rot) * ang
  let mut dx = dir.x + rx * ca + ux * sa
  let mut dy = dir.y + ry * ca + uy * sa
  let mut dz = dir.z + rz * ca + uz * sa
  let dl = js_or_1((dx * dx + dy * dy + dz * dz).sqrt())
  dx /= dl
  dy /= dl
  dz /= dl
  let sh : Shell = {
    active: true,
    owner,
    team: owner.team,
    pos: { x: pos.x, y: pos.y, z: pos.z, },
    vel: {
      x: dx * owner.spec.gun_speed,
      y: dy * owner.spec.gun_speed,
      z: dz * owner.spec.gun_speed,
    },
    pen: owner.spec.gun_pen,
    dmg: owner.spec.gun_dmg,
    cal: owner.spec.gun_cal.unwrap_or(75.0),
    life: owner.spec.gun_life.unwrap_or(4.0),
    grav: owner.spec.gun_grav.unwrap_or(SHELL_GRAVITY), // 火炮 HE 用大重力打高抛弧线
    warned: false,
    splash: owner.spec.gun_splash.unwrap_or(0.0),
    disp_at_fire: disp_m,
  }
  self.list.push(sh)
  // JS globalThis.__shellTrace 诊断桩(夹具不启用)不承载
  match self.hooks.on_create {
    Some(f) => f(sh) // 表现侧: 拖尾申请(可把 pos/vel 换成 THREE 向量, 引擎只读写分量)
    None => ()
  }
  Some(sh)
}

///|
/// update (sim-engine.js:398-480): 炮弹数值积分(分段: 先按旧速度推进, 再加重力, 弹道逐位一致)
pub fn Shells::update(self : Shells, dt : Double, env : ShellEnv) -> Unit {
  for sh in self.list {
    if !sh.active {
      continue
    }
    sh.life -= dt
    if sh.life <= 0.0 {
      sh.active = false
      match self.hooks.on_kill {
        Some(f) => f(sh)
        None => ()
      }
      continue
    }
    // 分段积分: 先按旧速度推进, 再加重力(与旧实现同序, 弹道逐位一致)
    let sx = sh.pos.x
    let sy = sh.pos.y
    let sz = sh.pos.z
    let nx = sx + sh.vel.x * dt
    let ny = sy + sh.vel.y * dt
    let nz = sz + sh.vel.z * dt
    sh.vel.y -= sh.grav * dt
    let segx = nx - sx
    let segy = ny - sy
    let segz = nz - sz
    let seg_len = (segx * segx + segy * segy + segz * segz).sqrt()
    let il = js_or_1(seg_len)
    let dx = segx / il
    let dy = segy / il
    let dz = segz / il
    // --- 收集最近命中 ---
    let mut hit_t = @double.infinity
    let mut hit_type = ""
    let mut hit_data : (Tank, ObbHit)? = None
    // 地形(沿段采样)
    let steps = (seg_len / 2.0).ceil().to_int().max(1)
    for i in 1..<=steps {
      let tt = i.to_double() / steps.to_double()
      let px = sx + segx * tt
      let py = sy + segy * tt
      let pz = sz + segz * tt
      if py <= (env.height_at)(px, pz) {
        if tt < hit_t {
          hit_t = tt
          hit_type = "ground"
        }
        break
      }
    }
    // 掩体
    let cover_t = (env.covers_blocked)(sx, sz, sy, dx, dz, seg_len, dy)
    if cover_t >= 0.0 && cover_t / seg_len < hit_t {
      hit_t = cover_t / seg_len
      hit_type = "cover"
    }
    // 坦克部位(先粗筛包围球: 线段上离圆心最近点 ≤3.6m 才进精确判定); 残骸同样挡弹
    for tk in env.tanks {
      if tk.team == sh.team {
        continue
      }
      let cy = tk.y + 1.5 // = 旧 tk.pos3 的 y 分量
      let ocx = tk.x - sx
      let ocy = cy - sy
      let ocz = tk.z - sz
      let proj = 0.0.max(seg_len.min(ocx * dx + ocy * dy + ocz * dz))
      let qx = sx + dx * proj - tk.x
      let qy = sy + dy * proj - cy
      let qz = sz + dz * proj - tk.z
      let miss_dist = (qx * qx + qy * qy + qz * qz).sqrt()
      if miss_dist > 3.6 {
        continue
      }
      let hit : ObbHit? = match self.hooks.probe_tank {
        Some(f) => f(sh, tk, sx, sy, sz, dx, dy, dz, seg_len)
        None => None
      }
      match hit {
        Some(h) =>
          if h.distance / seg_len < hit_t {
            hit_t = h.distance / seg_len
            hit_type = "tank"
            hit_data = Some((tk, h))
          }
        None => ()
      }
    }
    // --- 处理命中 ---
    if hit_type != "" {
      let off = hit_t * seg_len - 0.05
      let p : Vec3 = { x: sx + dx * off, y: sy + dy * off, z: sz + dz * off, }
      let is_tank = hit_type == "tank"
      // JS: hitType === 'tank' && !hitData.tank.alive —— 打中残骸: 弹丸被吸收, 不结算伤害
      let wreck = is_tank && !hit_data.unwrap().0.alive
      if is_tank && sh.splash == 0.0 && !wreck {
        match self.hooks.on_hit_tank {
          Some(f) =>
            f(sh, hit_data.unwrap().0, hit_data.unwrap().1, {
              x: dx,
              y: dy,
              z: dz,
            })
          None => ()
        }
      } else {
        match self.hooks.on_impact {
          Some(f) => f(if hit_type == "ground" { "ground" } else { "cover" }, p)
          None => ()
        }
        // 打飞了也要有反馈(JS: sh.owner.isPlayer && !sh.splash && !wreck && hooks.onPlayerMiss)
        if sh.owner.is_player && sh.splash == 0.0 && !wreck {
          match self.hooks.on_player_miss {
            Some(f) => f(p)
            None => ()
          }
        }
      }
      if sh.splash != 0.0 {
        let direct : Tank? = if is_tank && !wreck {
          Some(hit_data.unwrap().0)
        } else {
          None
        }
        let direct_armor : Double = if is_tank {
          hit_data.unwrap().1.armor
        } else {
          0.0
        }
        match self.hooks.on_explode {
          Some(f) => f(sh, p, direct, direct_armor)
          None => ()
        }
      }
      sh.active = false
      match self.hooks.on_kill {
        Some(f) => f(sh)
        None => ()
      }
      continue
    }
    // 敌方炮弹飞近 → 炮口来向指示(一次性)
    match env.player_pos {
      Some(pp) =>
        if sh.team != env.player_team && !sh.warned {
          let d_player = @math.hypot(sx - pp.x, sz - pp.z)
          if d_player < 45.0 {
            sh.warned = true
            match self.hooks.on_near_miss {
              Some(f) => f(sh)
              None => ()
            }
          }
        }
      None => ()
    }
    sh.pos.x = nx
    sh.pos.y = ny
    sh.pos.z = nz
    match self.hooks.on_flight {
      Some(f) => f(sh)
      None => ()
    }
  }
  self.list = self.list.filter(fn(s) { s.active })
}
