// sim-engine.js (SF.SimEngine) 直译: 行驶/自动挡/转向/车车碰撞/掩体碰撞/地形贴合/坠落摔伤/
// 瞄准换算/装填/开炮(散布/弹夹)/炮弹数值积分/3D OBB 部位判定。逐函数对照, 注释标原函数名。

///|
/// 三维向量(muzzleOf/aimDirOf/rayOBB3D 的点/方向; JS 侧为普通对象)
pub(all) struct Vec3 {
  x : Double
  y : Double
  z : Double
}

///|
/// 部位盒(SF.CFG.partBoxes zones 条目; partboxes.json)
pub(all) struct PartBox {
  zone : String // z
  armor : Double
  p : String // 空间: 'root'/'turret'/'gun'
  c : Vec3 // 盒中心(父空间)
  h : Vec3 // 半长
  q : (Double, Double, Double, Double)? // 附加四元数(x,y,z,w; 缺省 None)
}

///|
/// 单车型部位表(SF.CFG.partBoxes[type])
pub(all) struct PartBoxSet {
  turret_pivot : Vec3 // turretPivot
  gun_pivot : Vec3 // gunPivot
  gun_parent : String // gunParent 'turret'/'hull'
  zones : Array[PartBox]
}

///|
/// SF.CFG.partBoxes 全局表(tracesrv 由 moonbit/partboxes.json 装入)
let g_partboxes : Ref[Map[String, PartBoxSet]] = { val: Map::new(), }

///|
/// 装载 partboxes.json 解析结果(build-models.js --part-boxes 生成段)
pub fn partboxes_load(j : Json) -> Unit raise {
  let m : Map[String, PartBoxSet] = Map::new()
  match j {
    Object(map) =>
      for key, v in map {
        let zones : Array[PartBox] = []
        let mut turret_pivot = { x: 0.0, y: 1.5, z: 0.0, }
        let mut gun_pivot = { x: 0.0, y: 0.4, z: 1.0, }
        let mut gun_parent = "turret"
        match v {
          Object(o) => {
            match o.get("turretPivot") {
              Some(Array(a)) =>
                turret_pivot = {
                  x: num_of(a[0]),
                  y: num_of(a[1]),
                  z: num_of(a[2]),
                }
              _ => ()
            }
            match o.get("gunPivot") {
              Some(Array(a)) =>
                gun_pivot = {
                  x: num_of(a[0]),
                  y: num_of(a[1]),
                  z: num_of(a[2]),
                }
              _ => ()
            }
            match o.get("gunParent") {
              Some(String(s)) => gun_parent = s
              _ => ()
            }
            match o.get("zones") {
              Some(Array(zs)) =>
                for zj in zs {
                  match zj {
                    Object(z) => {
                      let zone = match z.get("z") {
                        Some(String(s)) => s
                        _ => continue
                      }
                      let armor = match z.get("armor") {
                        Some(n) => num_of(n)
                        _ => continue
                      }
                      let p = match z.get("p") {
                        Some(String(s)) => s
                        _ => continue
                      }
                      let c = match z.get("c") {
                        Some(Array(a)) =>
                          { x: num_of(a[0]), y: num_of(a[1]), z: num_of(a[2]), }
                        _ => continue
                      }
                      let h = match z.get("h") {
                        Some(Array(a)) =>
                          { x: num_of(a[0]), y: num_of(a[1]), z: num_of(a[2]), }
                        _ => continue
                      }
                      let q : (Double, Double, Double, Double)? = match
                        z.get("q") {
                        Some(Array(a)) =>
                          Some(
                            (
                              num_of(a[0]),
                              num_of(a[1]),
                              num_of(a[2]),
                              num_of(a[3]),
                            ),
                          )
                        _ => None
                      }
                      zones.push({ zone, armor, p, c, h, q, })
                    }
                    _ => continue
                  }
                }
              _ => ()
            }
          }
          _ => continue
        }
        m[key] = { turret_pivot, gun_pivot, gun_parent, zones, }
      }
    _ => ()
  }
  g_partboxes.val = m
}

///|
/// JSON 数值读取(Number → Double; 非 Number 报错)
fn num_of(j : Json) -> Double raise {
  match j {
    Number(d, ..) => d
    _ => fail("partboxes 期望数值")
  }
}

///|
/// 事件载荷(sum type; JS 侧为动态对象, srv-sim 链内事件形状封闭于此)
pub(all) enum Ev {
  Kill(Int, Int, Double, Double, Double) // kill {id, by, p:[x,y,z]}(本版 MoonBit 枚举仅位置变体)
  HitJudge(Int, Int, String, Double, String, Double, Double, Double) // hit {s,g,kind,dmg,module,p}
  HitFall(Tank, Double, Bool) // 坠落 hit {target, shooter:null, zone:'fall', kind:'fall', module}
  Destroyed(Tank) // 坠落 destroyed {tank, shooter:null}
  Fire(Tank, Vec3, Vec3) // fire {tank, pos, dir}
  Reloaded(Tank) // reloaded {tank}
  AiWave(Array[(Int, String)]) // aiWave {list:[{id,type}]}
  PkGet(Int, Int, String) // pkGet {id, by, type}
}

///|
/// Ev → JS 事件名(onEvent 计数键)
pub fn Ev::kind(self : Ev) -> String {
  match self {
    Kill(_, _, _, _, _) => "kill"
    HitJudge(_, _, _, _, _, _, _, _) => "hit"
    HitFall(_, _, _) => "hit"
    Destroyed(_) => "destroyed"
    Fire(_, _, _) => "fire"
    Reloaded(_) => "reloaded"
    AiWave(_) => "aiWave"
    PkGet(_, _, _) => "pkGet"
  }
}

///|
/// updateTank 的 env(client/js/sim-engine.js:15-17 env 约定)
pub(all) struct TankEnv {
  terrain : @simcore.Terrain
  covers_list : Array[@simcore.Cover]
  tanks : Array[Tank]
  mut time : Double
  emit : (Ev) -> Unit
  take_ram : (Tank, Tank, Double) -> Unit // env.takeRam
}

///|
/// 命中记录(probeTankOBB 返回 {distance, point, normal, zone, armor})
pub(all) struct HitRec {
  distance : Double
  point : Vec3
  normal : Vec3
  zone : String
  armor : Double
}

///|
/// 弹丸(makeShells.list 条目)
pub(all) struct Shell {
  mut active : Bool
  owner : Tank
  team : Int
  mut px : Double // pos.x
  mut py : Double // pos.y
  mut pz : Double // pos.z
  mut vx : Double // vel.x
  mut vy : Double // vel.y
  mut vz : Double // vel.z
  pen : Double
  dmg : Double
  cal : Double
  mut life : Double
  mut warned : Bool // sh.warned(近弹指示一次性)
  grav : Double
  splash : Double
}

///|
/// 弹场 hooks(makeShells 参数; srv-sim 以裁判对象合并注入)
pub(all) struct ShellHooks {
  probe_tank : (
    Shell,
    Tank,
    Double,
    Double,
    Double,
    Double,
    Double,
    Double,
    Double,
  ) -> HitRec? // probeTank(sh,tk,ox,oy,oz,dx,dy,dz,segLen)
  on_hit_tank : (Shell, Tank, HitRec, Vec3) -> Unit // onHitTank(sh,tk,hit,segDir)
  on_impact : (String, Vec3) -> Unit // onImpact(kind, p)
  on_player_miss : (Vec3) -> Unit
  on_near_miss : (Shell) -> Unit
  on_flight : (Shell) -> Unit
  on_kill : (Shell) -> Unit
  on_explode : (Shell, Vec3, Tank?, Double) -> Unit // onExplode(sh,p,directTank,directArmor)
  on_create : (Shell) -> Unit
  take_ram : (Tank, Tank, Double) -> Unit // judge.takeRam 随 Object.assign 挂入(弹场自身不调用)
}

///|
/// 弹场(makeShells 返回; cap=96 缺省)
pub(all) struct Shells {
  mut list : Array[Shell]
  hooks : ShellHooks
  cap : Int // 弹量上限(阶段5)
}

///|
/// shells.capped(sim-engine.js:370: 活跃弹数 ≥ cap)
pub fn Shells::capped(self : Shells) -> Bool {
  let mut n = 0
  for s in self.list {
    if s.active {
      n += 1
    }
  }
  n >= self.cap
}

///|
/// makeShells (sim-engine.js:366-482)。max_shells 缺省 96(本链全部缺省)。
pub fn make_shells(hooks : ShellHooks, max_shells? : Int) -> Shells {
  let cap = max_shells.unwrap_or(96)
  { list: [], hooks, cap, }
}

///|
/// 弹场逐帧积分(update(dt, env); sim-engine.js:398-480)
pub fn Shells::update(
  self : Shells,
  dt : Double,
  height_at : (Double, Double) -> Double,
  covers_list : Array[@simcore.Cover],
  tanks : Array[Tank],
  player_pos : Tank?,
  player_team : Int,
) -> Unit {
  for sh in self.list {
    if not(sh.active) {
      continue
    }
    sh.life -= dt
    if sh.life <= 0.0 {
      sh.active = false
      (self.hooks.on_kill)(sh)
      continue
    }
    // 分段积分: 先按旧速度推进, 再加重力(与旧实现同序, 弹道逐位一致)
    let sx = sh.px
    let sy = sh.py
    let sz = sh.pz
    let nx = sx + sh.vx * dt
    let ny = sy + sh.vy * dt
    let nz = sz + sh.vz * dt
    sh.vy -= sh.grav * dt
    let segx = nx - sx
    let segy = ny - sy
    let segz = nz - sz
    let seg_len = (segx * segx + segy * segy + segz * segz).sqrt()
    let il = if seg_len > 0.0 { seg_len } else { 1.0 }
    let dx = segx / il
    let dy = segy / il
    let dz = segz / il
    // --- 收集最近命中 ---
    let mut hit_t = inf()
    let mut hit_type = ""
    let mut hit_data : HitRec? = None
    let mut hit_tank : Tank? = None
    // 地形(沿段采样)
    let steps = 1.0.max((seg_len / 2.0).ceil()).to_int()
    for i in 1..<=steps {
      let tt = i.to_double() / steps.to_double()
      let p_x = sx + segx * tt
      let p_y = sy + segy * tt
      let p_z = sz + segz * tt
      if p_y <= height_at(p_x, p_z) {
        if tt < hit_t {
          hit_t = tt
          hit_type = "ground"
        }
        break
      }
    }
    // 掩体
    let cover_t = @simcore.covers_blocked(
      { items: covers_list, bushes: None, },
      height_at,
      sx,
      sz,
      sy,
      dx,
      dz,
      seg_len,
      dy,
    )
    if cover_t >= 0.0 && cover_t / seg_len < hit_t {
      hit_t = cover_t / seg_len
      hit_type = "cover"
    }
    // 坦克部位(先粗筛包围球: 线段上离圆心最近点 ≤3.6m 才进精确判定); 残骸同样挡弹
    for tk in tanks {
      if tk.team == sh.team {
        continue
      }
      let cy = tk.y + 1.5 // = 旧 tk.pos3 的 y 分量
      let ocx = tk.x - sx
      let ocy = cy - sy
      let ocz = tk.z - sz
      let proj = seg_len.min((ocx * dx + ocy * dy + ocz * dz).max(0.0))
      let qx = sx + dx * proj - tk.x
      let qy = sy + dy * proj - cy
      let qz = sz + dz * proj - tk.z
      let miss_dist = (qx * qx + qy * qy + qz * qz).sqrt()
      if miss_dist > 3.6 {
        continue
      }
      let hit = (self.hooks.probe_tank)(sh, tk, sx, sy, sz, dx, dy, dz, seg_len)
      match hit {
        Some(h) =>
          if h.distance / seg_len < hit_t {
            hit_t = h.distance / seg_len
            hit_type = "tank"
            hit_data = Some(h)
            hit_tank = Some(tk)
          }
        None => ()
      }
    }
    // --- 处理命中 ---
    if hit_type != "" {
      let off = hit_t * seg_len - 0.05
      let p : Vec3 = { x: sx + dx * off, y: sy + dy * off, z: sz + dz * off, }
      let wreck = match hit_tank {
        Some(tk) => hit_type == "tank" && not(tk.alive)
        None => false
      }
      if hit_type == "tank" && sh.splash == 0.0 && not(wreck) {
        (self.hooks.on_hit_tank)(sh, hit_tank.unwrap(), hit_data.unwrap(), {
          x: dx,
          y: dy,
          z: dz,
        })
      } else {
        (self.hooks.on_impact)(
          if hit_type == "ground" {
            "ground"
          } else {
            "cover"
          },
          p,
        )
        if sh.owner.is_player && sh.splash == 0.0 && not(wreck) {
          (self.hooks.on_player_miss)(p)
        }
      }
      if sh.splash != 0.0 {
        let direct_tk : Tank? = match hit_tank {
          Some(tk) =>
            if hit_type == "tank" && not(wreck) {
              Some(tk)
            } else {
              None
            }
          None => None
        }
        let direct_armor : Double = match (hit_tank, hit_data) {
          (Some(_), Some(h)) => if hit_type == "tank" { h.armor } else { 0.0 }
          _ => 0.0
        }
        (self.hooks.on_explode)(sh, p, direct_tk, direct_armor)
      }
      sh.active = false
      (self.hooks.on_kill)(sh)
      continue
    }
    // 敌方炮弹飞近 → 炮口来向指示(一次性)
    match player_pos {
      Some(pp) =>
        if sh.team != player_team && not(sh.warned) {
          let d_player = @math.hypot(sx - pp.x, sz - pp.z)
          if d_player < 45.0 {
            sh.warned = true
            (self.hooks.on_near_miss)(sh)
          }
        }
      None => ()
    }
    sh.px = nx
    sh.py = ny
    sh.pz = nz
    (self.hooks.on_flight)(sh)
  }
  // this.list = this.list.filter(s => s.active)
  self.list = self.list.filter(fn(s) { s.active })
}

///|
/// aimToLocal (sim-engine.js:21-41): 世界瞄准方向 → 车体局部系(YXZ 欧拉四元数共轭, r128 位级)
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
  let c1 = v8_cos(hx / 2.0)
  let c2 = v8_cos(hy / 2.0)
  let c3 = v8_cos(hz / 2.0)
  let s1 = v8_sin(hx / 2.0)
  let s2 = v8_sin(hy / 2.0)
  let s3 = v8_sin(hz / 2.0)
  let qx = -(s1 * c2 * c3 + c1 * s2 * s3)
  let qy = -(c1 * s2 * c3 - s1 * c2 * s3)
  let qz = -(c1 * c2 * s3 - s1 * s2 * c3)
  let qw = c1 * c2 * c3 + s1 * s2 * s3
  // Vector3.applyQuaternion 逐式(q*v 后再乘 q 共轭)
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
/// massOf (sim-engine.js:44-47): 撞击质量估算(吨)
pub fn mass_of(spec : VSpec) -> Double {
  // DENS = { LT: 14, MT: 32, HT: 48, TD: 34, SPG: 24 }
  let dens = if spec.cls == "LT" {
    14.0
  } else if spec.cls == "MT" {
    32.0
  } else if spec.cls == "HT" {
    48.0
  } else if spec.cls == "TD" {
    34.0
  } else if spec.cls == "SPG" {
    24.0
  } else {
    32.0
  }
  dens * (spec.sample.l * spec.sample.w) / (3.05 * 1.45)
}

///|
/// collideTank (sim-engine.js:51-83): 车体 OBB vs 掩体圆/OBB SAT 推出
pub fn collide_tank(t : Tank, list : Array[@simcore.Cover]) -> (Double, Double) {
  let mut nx = t.x
  let mut nz = t.z
  let hw = t.spec.sample.w
  let hl = t.spec.sample.l
  let circ = @math.hypot(hw, hl) // 车体外接半径
  let cs = v8_cos(t.yaw)
  let sn = v8_sin(t.yaw)
  for c in list {
    if not(c.blocks_move) {
      continue
    }
    let dx0 = nx - c.x
    let dz0 = nz - c.z
    let rr = c.r + circ
    if dx0 * dx0 + dz0 * dz0 > rr * rr {
      continue
    }
    if c.shape == "box" {
      match obb_push_out(nx, nz, t.yaw, hw, hl, c.x, c.z, c.yaw, c.hx, c.hz) {
        Some(push) => {
          nx += push.0
          nz += push.1
        }
        None => ()
      }
    } else {
      // 圆掩体 vs 车体 OBB: 掩体圆心变换到车体局部系求最近点, 按穿透深度推出
      let rx = c.x - nx
      let rz = c.z - nz
      let lx = cs * rx - sn * rz
      let lz = sn * rx + cs * rz
      // JS: qx = Math.max(-hw, Math.min(hw, lx)); qz = Math.max(-hl, Math.min(hl, lz))
      let qx = lx.min(hw).max(-hw)
      let qz = lz.min(hl).max(-hl)
      let ddx = lx - qx
      let ddz = lz - qz
      let d = @math.hypot(ddx, ddz)
      if d < 1.0e-6 {
        // 圆心陷入车体: 沿圆心→车心方向退出一个半径
        let bx = nx - c.x
        let bz = nz - c.z
        let bl0 = @math.hypot(bx, bz)
        let bl = if bl0 > 0.0 { bl0 } else { 1.0 }
        nx += bx / bl * (c.r + hl)
        nz += bz / bl * (c.r + hl)
        continue
      }
      if d < c.r {
        let k = (c.r - d) / d
        let px2 = -ddx * k
        let pz2 = -ddz * k
        nx += cs * px2 + sn * pz2
        nz += -sn * px2 + cs * pz2
      }
    }
  }
  (nx, nz)
}

///|
/// updateTank (sim-engine.js:88-334): 车辆逐帧数值更新(行驶/变速箱/转向/碰撞/地形/坠落/瞄准/装填)
pub fn update_tank(t : Tank, input : Input, dt : Double, env : TankEnv) -> Unit {
  let s = t.spec
  let t_terrain = env.terrain
  let emit = env.emit
  let yaw0 = t.yaw // 车体本帧转前朝向
  // for (const k in t.modules) modules[k] = max(0, k - dt)
  t.mod_track = 0.0.max(t.mod_track - dt)
  t.mod_engine = 0.0.max(t.mod_engine - dt)
  t.mod_gun = 0.0.max(t.mod_gun - dt)
  t.mod_ammo = 0.0.max(t.mod_ammo - dt)
  // --- 行驶(惯性/迟滞/滑行) ---
  let track_broken = t.mod_track > 0.0
  // 极速: 发动机损毁 ×slow
  let max_f = if t.mod_engine > 0.0 {
    s.max_speed * armor_cfg.engine_slow
  } else {
    s.max_speed
  }
  let max_r = max_f * s.reverse_ratio
  let slope = t_terrain.slope_ahead(t.x, t.z, t.yaw, 4.0)
  let slope_k = clamp(1.0 - v8_sin(slope.abs()) * 0.85, 0.35, 1.0)
  let uphill = (input.throttle > 0.0 && t.speed >= 0.0) ||
    (input.throttle < 0.0 && t.speed <= 0.0)
  if track_broken {
    t.speed = move_toward(t.speed, 0.0, 6.0 * dt) // 断带: 瘫痪
  } else {
    // 只挡"沿行进方向往高处去"且超极限; 倒车脱离/顺坡向下永远放行
    let mut blocked = false
    if uphill {
      let mv = if input.throttle > 0.0 { 1.0 } else { -1.0 }
      // 陡壁墙: 行进方向前方 3.5m(T.gradAt 恒有值, JS if(T.gradAt) 恒真)
      let ax = t.x + v8_sin(t.yaw) * 3.5 * mv
      let az = t.z + v8_cos(t.yaw) * 3.5 * mv
      if !(t_terrain.height_at(ax, az) <= t_terrain.height_at(t.x, t.z) + 0.15) &&
        t_terrain.grad_at(ax, az) > v8_tan_max_slope * 1.25 {
        blocked = true
      }
      if slope * mv > sim_cfg.max_slope {
        blocked = true
      }
    }
    if blocked {
      t.speed = move_toward(t.speed, 0.0, 8.0 * dt)
    } else {
      // --- 自动变速箱 ---
      let gb = sim_cfg.gearbox
      if t.shift_t > 0.0 {
        t.shift_t -= dt
      }
      if t.flip_t > 0.0 {
        t.flip_t -= dt
      }
      // t.gear ∈ {N, D1, D2, D3, R1, R2}: 首字符=挡向, 次字符=挡序(JS charAt)
      let g_dir = match t.gear.get_char(0) {
        Some(c) => if c == 'D' { "D" } else if c == 'R' { "R" } else { "N" }
        None => "N"
      }
      let g_idx : Int = match t.gear.get_char(1) {
        Some(c) => c.to_int() - 49 // '1' = 49
        None => -1
      }
      let caps = if g_dir == "R" { gb.rev } else { gb.fwd }
      let tq = if g_dir == "R" { gb.torque_r } else { gb.torque_f }
      let top = if g_dir == "R" { max_r } else { max_f }
      // 降挡: 速度掉到下一低挡上限×0.93 以下; 换向窗口内冻结
      if t.flip_t <= 0.0 &&
        g_idx > 0 &&
        t.speed.abs() < top * caps[g_idx - 1] * 0.93 {
        t.gear = g_dir + g_idx.to_string() // 'D'+gIdx(gIdx=2 → 'D2')
      }
      let want = if input.throttle > 0.05 {
        "D"
      } else if input.throttle < -0.05 {
        "R"
      } else {
        g_dir
      }
      if t.gear != "N" && want != g_dir {
        // 换向直接切最高挡
        t.gear = if want == "R" {
          "R" + gb.rev.length().to_string()
        } else {
          "D" + gb.fwd.length().to_string()
        }
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
          // 换向/向后溜: 制动 + 新方向全扭矩反拽
          let pull = s.accel *
            (if g_dir != "D" { gb.torque_r[0] } else { gb.torque_f[0] })
          t.speed = move_toward(t.speed, 0.0, (s.brake + pull) * dt)
        } else {
          let cap = top * caps[g_idx]
          if t.speed > cap * 0.985 && g_idx < caps.length() - 1 {
            t.gear = g_dir + (g_idx + 2).to_string()
            t.shift_t = gb.pause
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
          // 换向/向前冲: 镜像——倒挡扭矩参与杀前冲动量
          let pull = s.accel *
            (if g_dir != "R" { gb.torque_f[0] } else { gb.torque_r[0] })
          t.speed = move_toward(t.speed, 0.0, (s.brake + pull) * dt)
        } else {
          let cap = top * caps[g_idx]
          if t.speed < -cap * 0.985 && g_idx < caps.length() - 1 {
            t.gear = g_dir + (g_idx + 2).to_string()
            t.shift_t = gb.pause
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
  // --- 车体回转 ---
  let steer_auth = if track_broken { 0.25 } else { 1.0 }
  let yaw_rate = s.hull_traverse *
    input.steer *
    steer_auth *
    clamp(1.0 - t.speed.abs() / (max_f * 2.0), 0.55, 1.0)
  t.yaw += yaw_rate * dt
  t.last_yaw_rate = yaw_rate
  // 转向掉速(WoT)
  if t.speed.abs() > 0.5 {
    t.speed -= t.speed * input.steer.abs() * 0.4 * dt
  }
  // --- 位移与碰撞 ---
  t.x += v8_sin(t.yaw) * t.speed * dt
  t.z += v8_cos(t.yaw) * t.speed * dt
  t.x = clamp(t.x, -t_terrain.half + 16.0, t_terrain.half - 16.0)
  t.z = clamp(t.z, -t_terrain.half + 16.0, t_terrain.half - 16.0)
  // 掩体碰撞
  let cx0 = t.x
  let cz0 = t.z
  let pushed = collide_tank(t, env.covers_list)
  t.x = pushed.0
  t.z = pushed.1
  if t.x != cx0 || t.z != cz0 {
    let px2 = t.x - cx0
    let pz2 = t.z - cz0
    let pl0 = @math.hypot(px2, pz2)
    let pl = if pl0 > 0.0 { pl0 } else { 1.0 }
    let cosv = (v8_sin(t.yaw) * px2 + v8_cos(t.yaw) * pz2) / pl
    if cosv < -0.5 && t.speed.abs() > 1.0 {
      t.speed *= 0.3 // 迎面 60° 锥内才算顶撞
    }
  }
  // 车车碰撞: 含残骸; 车体 OBB 互推, 顶撞掉速
  let mut me_x = t.x
  let mut me_z = t.z
  let my_circ = @math.hypot(s.sample.w, s.sample.l)
  for o in env.tanks {
    if o.uid == t.uid {
      continue
    }
    let dx0 = t.x - o.x
    let dz0 = t.z - o.z
    let rr = my_circ + @math.hypot(o.spec.sample.w, o.spec.sample.l)
    if dx0 * dx0 + dz0 * dz0 > rr * rr {
      continue
    }
    match
      obb_push_out(
        me_x,
        me_z,
        t.yaw,
        s.sample.w,
        s.sample.l,
        o.x,
        o.z,
        o.yaw,
        o.spec.sample.w,
        o.spec.sample.l,
      ) {
      Some(push) => {
        me_x += push.0
        me_z += push.1
        let plen0 = @math.hypot(push.0, push.1)
        let plen = if plen0 > 0.0 { plen0 } else { 1.0 }
        // 撞击逼近速度要先于顶撞掉速取值
        let nvx = v8_sin(t.yaw) * t.speed
        let nvz = v8_cos(t.yaw) * t.speed
        let ovx = v8_sin(o.yaw) * o.speed
        let ovz = v8_cos(o.yaw) * o.speed
        let closing = -((nvx - ovx) * push.0 / plen +
          (nvz - ovz) * push.1 / plen)
        let cosv = (v8_sin(t.yaw) * push.0 + v8_cos(t.yaw) * push.1) / plen
        if cosv < -0.5 && t.speed.abs() > 1.0 {
          t.speed *= 0.4
        }
        // 撞击伤害(WoT): 高速互撞双方掉血(残骸不伤人)
        let ram_prev = if t.ram_t == 0.0 || t.ram_t.is_nan() {
          -9.0
        } else {
          t.ram_t
        }
        if o.team != t.team && o.alive && env.time - ram_prev > 0.5 {
          t.ram_t = env.time
          o.ram_t = env.time // 双方共冷却
          let m1 = mass_of(s)
          let m2 = mass_of(o.spec)
          let e = closing * closing * 0.55
          (env.take_ram)(t, o, js_round(e * m2 / (m1 + m2)))
          (env.take_ram)(o, t, js_round(e * m1 / (m1 + m2)))
        }
      }
      None => ()
    }
  }
  t.x = me_x
  t.z = me_z
  // --- 陡坡滑落 ---
  if t.y - t_terrain.height_at(t.x, t.z) < 1.0 {
    let g_lim = v8_tan_max_slope * 1.02
    let g_here = t_terrain.grad_at(t.x, t.z)
    if g_here > g_lim {
      let e2 = 2.0
      let gx = (
          t_terrain.height_at(t.x + e2, t.z) -
          t_terrain.height_at(t.x - e2, t.z)
        ) /
        (2.0 * e2)
      let gz = (
          t_terrain.height_at(t.x, t.z + e2) -
          t_terrain.height_at(t.x, t.z - e2)
        ) /
        (2.0 * e2)
      let gl0 = @math.hypot(gx, gz)
      let gl = if gl0 > 0.0 { gl0 } else { 1.0 }
      let slide = 4.5.min((g_here - g_lim) * 5.5) * dt
      t.x -= gx / gl * slide
      t.z -= gz / gl * slide
      t.x = clamp(t.x, -t_terrain.half + 16.0, t_terrain.half - 16.0)
      t.z = clamp(t.z, -t_terrain.half + 16.0, t_terrain.half - 16.0)
      t.speed *= (1.0 - dt * 2.2).max(0.0)
    }
  }
  // --- 地形贴合(履带四角采样) ---
  let sn = v8_sin(t.yaw)
  let cs = v8_cos(t.yaw)
  let sl = s.sample.l
  let sw = s.sample.w
  let h_f = t_terrain.height_at(t.x + sn * sl, t.z + cs * sl)
  let h_b = t_terrain.height_at(t.x - sn * sl, t.z - cs * sl)
  let h_l = t_terrain.height_at(t.x + cs * sw, t.z - sn * sw)
  let h_r = t_terrain.height_at(t.x - cs * sw, t.z + sn * sw)
  let h_c = t_terrain.height_at(t.x, t.z)
  let target_y = h_c.max((h_f + h_b + h_l + h_r) / 4.0)
  let t_pitch = v8_atan2(h_f - h_b, 2.0 * sl)
  let t_roll = v8_atan2(h_l - h_r, 2.0 * sw)
  if not(t.y_init) {
    t.y_init = true
    t.y = target_y
    t.pitch = t_pitch
    t.roll = t_roll
  }
  let sm = 1.0 - v8_exp(-12.0 * dt)
  // --- 坠落(WoT 坠崖) ---
  let gap = t.y - target_y
  if gap > 1.2 {
    t.fall_v = t.fall_v + 9.8 * 2.0 * dt
    t.y -= t.fall_v * dt
    t.pitch = lerp(t.pitch, -0.5.min(t.fall_v * 0.06), sm)
    if t.y <= target_y {
      // 落地结算
      let v = t.fall_v
      t.y = target_y
      t.fall_v = 0.0
      let f = sim_cfg.fall
      if v > f.safe_v && t.alive {
        let dmg = js_round((v - f.safe_v) * (v - f.safe_v) * f.k)
        let track_hit = f.track_v > 0.0 &&
          v > f.track_v &&
          random() < f.track_chance
        t.mod_track = t.mod_track.max(if track_hit { 6.0 } else { 0.0 })
        t.hp -= dmg
        if t.hp <= 0.0 {
          t.hp = 0.0
          t.alive = false
          emit(Destroyed(t))
        }
        emit(HitFall(t, dmg, v > f.track_v))
      }
    }
  } else {
    t.fall_v = 0.0
    t.y = lerp(t.y, target_y, sm)
  }
  t.pitch = lerp(t.pitch, t_pitch, sm)
  t.roll = lerp(t.roll, t_roll, sm)
  // (env.onMoved 恒为 no-op, 略)
  // --- 炮塔/火炮瞄准 ---
  let ap = if input.aim_pitch == 0.0 || input.aim_pitch.is_nan() {
    0.0
  } else {
    input.aim_pitch
  }
  let cp = v8_cos(ap)
  let sp2 = v8_sin(ap)
  let aim_loc = aim_to_local(
    v8_sin(input.aim_yaw) * cp,
    sp2,
    v8_cos(input.aim_yaw) * cp,
    t.pitch,
    t.yaw,
    t.roll,
  )
  let local_yaw = v8_atan2(aim_loc.x, aim_loc.z)
  let local_elev = v8_atan2(aim_loc.y, @math.hypot(aim_loc.x, aim_loc.z))
  if input.hold_turret {
    // 右键锁定(本链恒 false)
    t.turret_yaw += t.yaw - yaw0
    t.last_turret_rate = 0.0
  } else if t.no_turret {
    // 固定战斗室: ±gunArc 射界内横向伺服
    let arc = match s.gun_arc {
      Some(a) => a
      None => 10.0 * @math.PI / 180.0
    }
    let lay_yaw = clamp(local_yaw, -arc, arc)
    t.turret_yaw = t.yaw + clamp(ang_diff(t.yaw, t.turret_yaw), -arc, arc)
    let before = t.turret_yaw
    t.turret_yaw = ang_move_toward(
      t.turret_yaw,
      t.yaw + lay_yaw,
      s.turret_traverse.max(0.4) * dt,
    )
    t.last_turret_rate = ang_diff(before, t.turret_yaw) / dt
  } else {
    let before = t.turret_yaw
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
  if not(input.hold_turret) {
    t.gun_pitch = move_toward(
      t.gun_pitch,
      clamp(local_elev, s.gun_depression, s.gun_elevation),
      1.2 * dt,
    )
  }
  // --- 缩圈/扩圈 ---
  let d = s.dispersion
  let move_k = t.speed.abs() / s.max_speed * d.move_
  let turn_k = (t.last_yaw_rate.abs() / s.hull_traverse).min(1.0) * d.hull_turn
  let tur_k = (t.last_turret_rate.abs() / s.turret_traverse.max(0.01)).min(1.0) *
    d.turret_turn
  let target_disp = clamp(
    d.base * (1.0 + move_k + turn_k + tur_k),
    d.base,
    d.max,
  )
  t.disp += (target_disp - t.disp) * (1.0 - v8_exp(-dt * 2.2 / d.aim_time))
  // --- 装填 ---
  let was_loading = t.reload_t > 0.0
  t.reload_t = 0.0.max(t.reload_t - dt)
  if was_loading && t.reload_t == 0.0 {
    emit(Reloaded(t))
  }
}

///|
/// fire (sim-engine.js:339-359): 开炮数值段(弹夹/装填/扩圈 + spawn 的散布偏转)。
/// JS 参数 world = {shells:{field}} / {shells}; 本链恒 {shells:{field}}, 以 field 直取。
pub fn fire(
  t : Tank,
  field : Shells,
  pos : Vec3,
  dir : Vec3,
  emit : (Ev) -> Unit,
) -> Bool {
  if not(t.alive) || t.reload_t > 0.0 {
    return false
  }
  let s = t.spec
  if field.capped() {
    return false // 阶段5 弹量上限: 拒发时不消耗装填/不出事件
  }
  let rack = if t.mod_ammo > 0.0 { armor_cfg.ammo_reload_mult } else { 1.0 } // 弹药架受损: 装填永久变慢
  match s.gun.autoloader {
    Some(al) =>
      if t.clip_left > 1 {
        t.clip_left -= 1
        t.reload_t = al.intra * rack
        t.clip_phase = "intra"
      } else {
        t.clip_left = al.clip
        t.reload_t = al.long * rack
        t.clip_phase = "long" // 打完最后一发 → 整夹长装填
      }
    None => t.reload_t = s.gun.reload * rack
  }
  t.reload_total = t.reload_t
  t.shots += 1
  let mut disp = t.disp
  if t.mod_gun > 0.0 {
    disp *= armor_cfg.gun_disp_penalty
  }
  t.disp = s.dispersion.max.min(s.dispersion.base + s.dispersion.fire) // 开炮瞬间扩圈
  shells_spawn(field, t, pos, dir, disp)
  emit(Fire(t, pos, dir))
  true
}

///|
/// shells.spawn 内联辅助(fire 侧; 与 make_shells 内 spawn 同式, 掷骰次序一致)
fn shells_spawn(
  field : Shells,
  owner : Tank,
  pos : Vec3,
  dir : Vec3,
  disp_m : Double,
) -> Unit {
  let ang = disp_m / 100.0 * random().sqrt()
  let rot = random() * @math.PI * 2.0
  let mut rx = -dir.z
  let ry = 0.0
  let mut rz = dir.x
  let rl0 = (rx * rx + rz * rz).sqrt()
  let rl = if rl0 > 0.0 { rl0 } else { 1.0 }
  rx /= rl
  rz /= rl
  let mut ux = -rz * dir.y
  let mut uy = rz * dir.x - rx * dir.z
  let mut uz = rx * dir.y
  let ul0 = (ux * ux + uy * uy + uz * uz).sqrt()
  let ul = if ul0 > 0.0 { ul0 } else { 1.0 }
  ux /= ul
  uy /= ul
  uz /= ul
  let ca = v8_cos(rot) * ang
  let sa = v8_sin(rot) * ang
  let mut dx = dir.x + rx * ca + ux * sa
  let mut dy = dir.y + ry * ca + uy * sa
  let mut dz = dir.z + rz * ca + uz * sa
  let dl0 = (dx * dx + dy * dy + dz * dz).sqrt()
  let dl = if dl0 > 0.0 { dl0 } else { 1.0 }
  dx /= dl
  dy /= dl
  dz /= dl
  let spec = owner.spec.gun
  let sh : Shell = {
    active: true,
    owner,
    team: owner.team,
    px: pos.x,
    py: pos.y,
    pz: pos.z,
    vx: dx * spec.speed,
    vy: dy * spec.speed,
    vz: dz * spec.speed,
    pen: spec.pen,
    dmg: spec.dmg,
    cal: spec.cal,
    life: spec.life.unwrap_or(4.0),
    warned: false,
    grav: spec.grav.unwrap_or(sim_cfg.shell_gravity),
    splash: spec.splash.unwrap_or(0.0),
  }
  field.list.push(sh)
  (field.hooks.on_create)(sh)
}

///|
/// 旋转基(列向量; sim-engine.js:488-501 axesYXZ)
pub(all) struct Axes {
  ex : Vec3
  ey : Vec3
  ez : Vec3
}

///|
fn axes_yxz(pitch : Double, yaw : Double, roll : Double) -> Axes {
  let cy = v8_cos(yaw)
  let sy = v8_sin(yaw)
  let cx = v8_cos(pitch)
  let sx = v8_sin(pitch)
  let cz = v8_cos(roll)
  let sz = v8_sin(roll)
  {
    ex: { x: cy * cz + sy * sx * sz, y: cx * sz, z: -sy * cz + cy * sx * sz, },
    ey: { x: -cy * sz + sy * sx * cz, y: cx * cz, z: sy * sz + cy * sx * cz, },
    ez: { x: sy * cx, y: -sx, z: cy * cx, },
  }
}

///|
fn axes_ry(a : Double) -> Axes {
  let c = v8_cos(a)
  let s = v8_sin(a)
  {
    ex: { x: c, y: 0.0, z: -s, },
    ey: { x: 0.0, y: 1.0, z: 0.0, },
    ez: { x: s, y: 0.0, z: c, },
  }
}

///|
fn axes_rx(a : Double) -> Axes {
  let c = v8_cos(a)
  let s = v8_sin(a)
  {
    ex: { x: 1.0, y: 0.0, z: 0.0, },
    ey: { x: 0.0, y: c, z: s, },
    ez: { x: 0.0, y: -s, z: c, },
  }
}

///|
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
fn axes_quat(q : (Double, Double, Double, Double)) -> Axes {
  let x = q.0
  let y = q.1
  let z = q.2
  let w = q.3
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
fn dot3(a : Vec3, b : Vec3) -> Double {
  a.x * b.x + a.y * b.y + a.z * b.z
}

///|
/// rayOBB3D (sim-engine.js:531-550): 3D 线段 vs OBB(slab 法), 返回 {t, point, normal} 或 None
pub fn ray_obb3d(
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  len : Double,
  c : Vec3,
  r : Axes,
  h : Vec3,
) -> (Double, Vec3, Vec3)? {
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
  let hs = [h.x, h.y, h.z]
  let mut tmin = -inf()
  let mut tmax = inf()
  let mut ax_min = 0
  let mut sg_min = 1.0
  for a in 0..<3 {
    if ld[a].abs() < 1.0e-9 {
      if lo[a] < -hs[a] || lo[a] > hs[a] {
        return None
      }
      continue
    }
    let inv = 1.0 / ld[a]
    let mut t1 = (-hs[a] - lo[a]) * inv
    let mut t2 = (hs[a] - lo[a]) * inv
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
  let t = tmin.max(0.0) // 起点在盒内: 钳到段首
  let axis = [r.ex, r.ey, r.ez][ax_min]
  let n = sg_min * (if tmin < 0.0 { -1.0 } else { 1.0 })
  Some(
    (
      t,
      { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, },
      { x: axis.x * n, y: axis.y * n, z: axis.z * n, },
    ),
  )
}

///|
/// U_angDiff (sim-engine.js:570)
fn u_ang_diff(a : Double, b : Double) -> Double {
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
/// tankOBBFrames (sim-engine.js:555-569): 组合 车体(YXZ) → 炮塔(+turretYaw) → 火炮(+gunPitch)
pub fn tank_obb_frames(t : Tank) -> (Axes, (Vec3, Axes), (Vec3, Axes)) {
  let hull = axes_yxz(t.pitch, t.yaw, t.roll)
  let base : Vec3 = { x: t.x, y: t.y, z: t.z, }
  fn at(r : Axes, off : Vec3) -> Vec3 {
    {
      x: base.x + dot3(r.ex, off),
      y: base.y + dot3(r.ey, off),
      z: base.z + dot3(r.ez, off),
    }
  }
  let tb = g_partboxes.val.get(t.typ)
  let tp = match tb {
    Some(b) => b.turret_pivot
    None => { x: 0.0, y: 1.5, z: 0.0, }
  }
  let turret : (Vec3, Axes) = (
    at(hull, tp),
    mul_axes(hull, axes_ry(u_ang_diff(t.yaw, t.turret_yaw))),
  )
  let gp = match tb {
    Some(b) => b.gun_pivot
    None => { x: 0.0, y: 0.4, z: 1.0, }
  }
  let gp_parent = match tb {
    Some(b) => b.gun_parent
    None => "turret"
  }
  let gp_base = if gp_parent == "turret" { turret } else { (base, hull) }
  let gun : (Vec3, Axes) = (
    {
      x: gp_base.0.x + dot3(gp_base.1.ex, gp),
      y: gp_base.0.y + dot3(gp_base.1.ey, gp),
      z: gp_base.0.z + dot3(gp_base.1.ez, gp),
    },
    mul_axes(gp_base.1, axes_rx(-t.gun_pitch)),
  )
  (hull, turret, gun)
}

///|
/// probeTankOBB (sim-engine.js:571-596): 部位 OBB 探针, 对 partBoxes 表逐盒求交取最近。
pub fn probe_tank_obb(
  t : Tank,
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  seg_len : Double,
) -> HitRec? {
  let tb = g_partboxes.val.get(t.typ)
  // 兜底三盒(表覆盖全部 129 型, 仅防御未知车; t._obbFallback 无消费方, 略)
  let zones : Array[PartBox] = match tb {
    Some(b) => b.zones
    None => {
      let sw = t.spec.sample.w
      let sl = t.spec.sample.l
      [
        {
          zone: "tracks",
          armor: 20.0,
          p: "root",
          c: { x: 0.0, y: 0.45, z: 0.0, },
          h: { x: sw, y: 0.5, z: sl, },
          q: None,
        },
        {
          zone: "hullSide",
          armor: 30.0,
          p: "root",
          c: { x: 0.0, y: 1.0, z: 0.0, },
          h: { x: sw, y: 0.55, z: sl, },
          q: None,
        },
        {
          zone: "turretFront",
          armor: 40.0,
          p: "turret",
          c: { x: 0.0, y: 1.7, z: 0.0, },
          h: { x: sw, y: 0.35, z: sl, },
          q: None,
        },
      ]
    }
  }
  let frames = tank_obb_frames(t)
  let hull_r : Axes = frames.0
  let hull_base : Vec3 = { x: t.x, y: t.y, z: t.z, }
  // spaces: root=hull(base+R), turret, gun
  let mut best : HitRec? = None
  for z in zones {
    // 逐盒粗距早退(阶段5 性能; 不改变命中结果)
    // spaces[z.p] || f.hull
    let (sp_base, sp_r) : (Vec3, Axes) = if z.p == "turret" {
      (frames.1.0, frames.1.1)
    } else if z.p == "gun" {
      (frames.2.0, frames.2.1)
    } else {
      (hull_base, hull_r)
    }
    let c : Vec3 = {
      x: sp_base.x + dot3(sp_r.ex, z.c),
      y: sp_base.y + dot3(sp_r.ey, z.c),
      z: sp_base.z + dot3(sp_r.ez, z.c),
    }
    let rr = (z.h.x * z.h.x + z.h.y * z.h.y + z.h.z * z.h.z).sqrt()
    let cd = ((c.x - ox) * (c.x - ox) +
    (c.y - oy) * (c.y - oy) +
    (c.z - oz) * (c.z - oz)).sqrt()
    if cd - rr > seg_len + 2.0 {
      continue
    }
    let r = match z.q {
      Some(q) => mul_axes(sp_r, axes_quat(q))
      None => sp_r
    }
    match ray_obb3d(ox, oy, oz, dx, dy, dz, seg_len, c, r, z.h) {
      Some((ht, point, normal)) =>
        // JS 原文: `if (hit && (!best || hit.t < best.t)) best = { distance: hit.t, ... }`
        // —— best 存的是 distance 字段, best.t 恒 undefined → 一旦有首个命中, 条件恒假。
        // 实际语义 = 取迭代序首个命中盒(源码"取最近"的注释与行为不符, 缺陷原样同构)。
        match best {
          Some(_) => ()
          None =>
            best = Some({
              distance: ht,
              point,
              normal,
              zone: z.zone,
              armor: z.armor,
            })
        }
      None => ()
    }
  }
  best
}
