// client/js/sim-engine.js (SF.SimEngine) 数值内核子集直译 —— ai.json 夹具重放所需:
// updateTank / fire / makeShells(炮弹积分) / collideTank / probeTankOBB(部位 OBB)。
// (独立 simengine 包由后续批次落地时, 本文件可整体迁走。)
// 每个函数注释标注原 JS 函数名; 运算次序与 Math.random 掷骰次序逐句对应, 全程 Double。

///|
/// 三维向量(炮弹/法线/命中点; pos/vel 的分量可变, 其余只读场景复用同型)
pub(all) struct Pos {
  mut x : Double
  mut y : Double
  mut z : Double
}

///|
pub(all) struct Dir {
  x : Double
  y : Double
  z : Double
}

///|
/// 弹场 hooks(sim-engine.js:361-365 注入面; 夹具侧 judge 走 probeTank/onHitTank)
pub(all) struct ShellHooks {
  on_create : (Shell) -> Unit
  on_flight : (Shell) -> Unit
  on_impact : (String, Pos) -> Unit // (kind='ground'|'cover', p)
  on_player_miss : (Pos) -> Unit
  on_near_miss : (Shell) -> Unit
  on_kill : (Shell) -> Unit
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
  ) -> Hit? // (sh,tk,ox,oy,oz,dx,dy,dz,segLen)
  on_hit_tank : (Shell, Tank, Hit, Dir) -> Unit // (sh, tk, hit, segDir)
  on_explode : (Shell, Pos, Tank?, Double) -> Unit
}

///|
/// 3D 线段-OBB 命中(sim-engine.js rayOBB3D 返回 {t, point, normal} + 部位 zone/armor)
pub(all) struct Hit {
  distance : Double // t
  point : Pos
  normal : Pos
  zone : String
  armor : Double
}

///|
/// 炮弹(sim-engine.js spawn 产物字段)
pub(all) struct Shell {
  mut active : Bool
  owner : Tank
  team : Int
  pos : Pos
  vel : Pos
  mut pen : Double
  mut dmg : Double
  mut cal : Double
  mut life : Double
  mut warned : Bool // sh.warned(未定义 ↔ false)
  mut grav : Double
  mut splash : Double
  disp_at_fire : Double // _dispAtFire(表现侧字段, 直译保留)
}

///|
/// 弹场(makeShells 返回对象; capped 为方法, 直译为字段)
pub(all) struct Shells {
  mut list : Array[Shell]
  cap : Int
  hooks : ShellHooks
}

///|
/// shells.update 的 env(sim-engine.js:365): { heightAt, coversBlocked, tanks, playerPos, playerTeam }
pub(all) struct ShEnv {
  height_at : (Double, Double) -> Double
  covers_blocked : (Double, Double, Double, Double, Double, Double, Double) -> Double // (ox,oz,oy,dx,dz,len,dy)
  tanks : Array[Tank]
  player_pos : Tank? // envT.playerPos(JS 真值判定 ↔ Option)
  player_team : Int
}

///|
/// makeShells (sim-engine.js:366-482)
pub fn make_shells(hooks : ShellHooks, max_shells? : Int) -> Shells {
  let cap = max_shells.unwrap_or(96)
  { list: [], cap, hooks, }
}

///|
/// Shells.capped getter(sim-engine.js:370): active 弹数 ≥ cap
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
/// Shells.spawn (sim-engine.js:371-397): 散布圆内随机偏转 —— 2 骰次序 sqrt(random()) / random()*2π
pub fn Shells::spawn(
  self : Shells,
  ctx : Ctx,
  owner : Tank,
  pos : Pos,
  dir : Dir,
  disp_m : Double,
) -> Shell? {
  if self.capped() {
    return None
  }
  let ang = disp_m / 100.0 * ctx.rand().sqrt()
  let rot = ctx.rand() * @math.PI * 2.0
  // right = dir × (0,1,0) 归一; up = right × dir 归一
  let mut rx = -dir.z
  let ry = 0.0
  let mut rz = dir.x
  let rl = sqrt(rx * rx + rz * rz)
  let rl = if rl > 0.0 { rl } else { 1.0 } // JS: || 1(0/NaN → 1)
  rx /= rl
  rz /= rl
  let mut ux = -rz * dir.y
  let mut uy = rz * dir.x - rx * dir.z
  let mut uz = rx * dir.y
  let ul0 = sqrt(ux * ux + uy * uy + uz * uz)
  let ul = if ul0 > 0.0 { ul0 } else { 1.0 }
  ux /= ul
  uy /= ul
  uz /= ul
  let ca = @math.cos(rot) * ang
  let sa = @math.sin(rot) * ang
  let mut dx = dir.x + rx * ca + ux * sa
  let mut dy = dir.y + ry * ca + uy * sa
  let mut dz = dir.z + rz * ca + uz * sa
  let dl0 = sqrt(dx * dx + dy * dy + dz * dz)
  let dl = if dl0 > 0.0 { dl0 } else { 1.0 }
  dx /= dl
  dy /= dl
  dz /= dl
  let spec = owner.spec.gun
  let sh : Shell = {
    active: true,
    owner,
    team: owner.team,
    pos: { x: pos.x, y: pos.y, z: pos.z, },
    vel: { x: dx * spec.speed, y: dy * spec.speed, z: dz * spec.speed, },
    pen: spec.pen,
    dmg: spec.dmg,
    cal: js_or(spec.cal, 75.0),
    life: js_or(spec.life, 4.0),
    warned: false,
    grav: js_or(spec.grav, ctx.cfg.sim.shell_gravity),
    splash: js_or(spec.splash, 0.0),
    disp_at_fire: disp_m,
  }
  self.list.push(sh)
  (self.hooks.on_create)(sh)
  Some(sh)
}

///|
/// Shells.update (sim-engine.js:398-480): 分段积分 + 地形/掩体/坦克最近命中收集与结算
pub fn Shells::update(self : Shells, dt : Double, env : ShEnv) -> Unit {
  for sh in self.list {
    if !sh.active {
      continue
    }
    sh.life -= dt
    if sh.life <= 0.0 {
      sh.active = false
      (self.hooks.on_kill)(sh)
      continue
    }
    // 分段积分: 先按旧速度推进, 再加重力(与旧实现同序)
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
    let seg_len = sqrt(segx * segx + segy * segy + segz * segz)
    let il = if seg_len > 0.0 { seg_len } else { 1.0 }
    let dx = segx / il
    let dy = segy / il
    let dz = segz / il
    // --- 收集最近命中 ---
    let mut hit_t = INF
    let mut hit_type = ""
    let mut hit_tank : Tank? = None
    let mut hit_data : Hit? = None
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
    // 坦克部位(粗筛包围球 → 注入探针; 残骸同样挡弹)
    for tk in env.tanks {
      if tk.team == sh.team {
        continue
      }
      let cy = tk.y + 1.5
      let ocx = tk.x - sx
      let ocy = cy - sy
      let ocz = tk.z - sz
      let proj = clamp(ocx * dx + ocy * dy + ocz * dz, 0.0, seg_len)
      let qx = sx + dx * proj - tk.x
      let qy = sy + dy * proj - cy
      let qz = sz + dz * proj - tk.z
      let miss_dist = sqrt(qx * qx + qy * qy + qz * qz)
      if miss_dist > 3.6 {
        continue
      }
      let hit = (self.hooks.probe_tank)(sh, tk, sx, sy, sz, dx, dy, dz, seg_len)
      if hit is Some(h) && h.distance / seg_len < hit_t {
        hit_t = h.distance / seg_len
        hit_type = "tank"
        hit_tank = Some(tk)
        hit_data = Some(h)
      }
    }
    // --- 处理命中 ---
    if hit_type != "" {
      let off = hit_t * seg_len - 0.05
      let p : Pos = { x: sx + dx * off, y: sy + dy * off, z: sz + dz * off, }
      // JS: hitType==='tank' 时 hitData.tank/hit 必非空(hitData 与 hitType 同时置位)
      let mut wreck = false
      if hit_type == "tank" {
        wreck = !hit_tank.unwrap().alive
      }
      if hit_type == "tank" && sh.splash == 0.0 && !wreck {
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
        // JS: sh.owner.isPlayer && !sh.splash && !wreck && hooks.onPlayerMiss
        if sh.owner.is_player && sh.splash == 0.0 && !wreck {
          (self.hooks.on_player_miss)(p)
        }
      }
      if sh.splash > 0.0 {
        let direct_tk : Tank? = if hit_type == "tank" && !wreck {
          hit_tank
        } else {
          None
        }
        let direct_armor = if hit_type == "tank" {
          match hit_data {
            Some(hd) => js_orv(hd.armor, 0.0)
            None => 0.0
          }
        } else {
          0.0
        }
        (self.hooks.on_explode)(sh, p, direct_tk, direct_armor)
      }
      sh.active = false
      (self.hooks.on_kill)(sh)
      continue
    }
    // 敌方炮弹飞近 → 炮口来向指示(一次性)
    if env.player_pos is Some(pp) && sh.team != env.player_team && !sh.warned {
      let d_player = @math.hypot(sx - pp.x, sz - pp.z)
      if d_player < 45.0 {
        sh.warned = true
        (self.hooks.on_near_miss)(sh)
      }
    }
    sh.pos.x = nx
    sh.pos.y = ny
    sh.pos.z = nz
    (self.hooks.on_flight)(sh)
  }
  // this.list = this.list.filter(s => s.active)
  self.list = self.list.filter(fn(s) { s.active })
}

///|
/// JS `x || default`(数值假值: 0/-0/NaN/undefined → default)
fn js_or(v : Double?, default : Double) -> Double {
  match v {
    Some(x) => if x == 0.0 || x.is_nan() { default } else { x }
    None => default
  }
}

// ---------- 瞄准换算 ----------

///|
/// aimToLocal (sim-engine.js:21-41): 世界瞄准方向 → 车体局部系(r128 Quaternion.setFromEuler('YXZ')
/// .invert()(=conjugate) + Vector3.applyQuaternion 逐式复刻)
pub fn aim_to_local(
  dx : Double,
  dy : Double,
  dz : Double,
  pitch : Double,
  yaw : Double,
  roll : Double,
) -> (Double, Double, Double) {
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
  let ix = qw * dx + qy * dz - qz * dy
  let iy = qw * dy + qz * dx - qx * dz
  let iz = qw * dz + qx * dy - qy * dx
  let iw = -qx * dx - qy * dy - qz * dz
  (
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  )
}

///|
/// massOf (sim-engine.js:44-47): 撞击质量估算(吨)
pub fn mass_of(spec : Spec) -> Double {
  // DENS = { LT: 14, MT: 32, HT: 48, TD: 34, SPG: 24 }[cls] || 32
  let dens = match spec.cls {
    "LT" => 14.0
    "MT" => 32.0
    "HT" => 48.0
    "TD" => 34.0
    "SPG" => 24.0
    _ => 32.0
  }
  dens * (spec.sample.l * spec.sample.w) / (3.05 * 1.45)
}

///|
/// collideTank (sim-engine.js:51-83): 车体 OBB vs 掩体圆/OBB SAT 推出(models.js CoverField 移植)
pub fn collide_tank(t : Tank, list : @simcore.CoverList) -> (Double, Double) {
  let mut nx = t.x
  let mut nz = t.z
  let s = t.spec
  let hw = s.sample.w
  let hl = s.sample.l
  let circ = @math.hypot(hw, hl)
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
      match obb_push_out(nx, nz, t.yaw, hw, hl, c.x, c.z, c.yaw, c.hx, c.hz) {
        Some((px, pz)) => {
          nx += px
          nz += pz
        }
        None => ()
      }
    } else {
      let rx = c.x - nx
      let rz = c.z - nz
      let lx = cs * rx - sn * rz
      let lz = sn * rx + cs * rz
      let qx = -hw.max(hw.min(lx))
      let qz = -hl.max(hl.min(lz))
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
/// updateTank 的 env(sim-engine.js:15-16 注入面; 夹具侧恒提供 emit/onMoved/takeRam ——
/// JS 的 `|| Bus.emit`/`|| target.takeRam` 兜底分支为浏览器薄壳路径, 夹具不触, 不移植)
pub(all) struct Env {
  terrain : @simcore.Terrain
  covers_list : @simcore.CoverList
  tanks : Array[Tank]
  time : Double
  emit : (String, EvtData) -> Unit
  on_moved : (Tank, Double) -> Unit
  take_ram : (Tank, Tank, Int) -> Unit // (target, shooter, dmg)
}

///|
/// 事件载荷(updateTank/fire 产出; 与 golden-trace2.js emit 消费面同形)
pub(all) enum EvtData {
  FireEv(Tank, Pos, Dir) // {tank, pos, dir}
  ReloadedEv(Tank) // {tank}
  RamEv(Tank, Tank, Int) // {shooter, target, dmg}
  DestroyedEv(Tank, Tank?) // {tank, shooter?}
  HitEv(Tank?, Tank, String, String, Int, String?, Pos) // {shooter?, target, kind, zone, dmg, module?, point}
}

///|
/// updateTank (sim-engine.js:88-334): 行驶/变速箱/回转/碰撞/滑落/地形贴合/坠落/瞄准/缩圈/装填
pub fn update_tank(
  ctx : Ctx,
  t : Tank,
  input : Inp,
  dt : Double,
  env : Env,
) -> Unit {
  let cfg = ctx.cfg
  let s = t.spec
  let terrain = env.terrain
  let emit = env.emit
  let yaw0 = t.yaw
  // for (const k in t.modules): max(0, v - dt)(Infinity 永久毁伤保持)
  t.mod_track = 0.0.max(t.mod_track - dt)
  t.mod_engine = 0.0.max(t.mod_engine - dt)
  t.mod_gun = 0.0.max(t.mod_gun - dt)
  t.mod_ammo = 0.0.max(t.mod_ammo - dt)
  // --- 行驶(惯性/迟滞/滑行) ---
  let track_broken = t.mod_track > 0.0
  let max_f = if t.mod_engine > 0.0 {
    s.max_speed * cfg.armor.engine_slow
  } else {
    s.max_speed
  }
  let max_r = max_f * s.reverse_ratio
  let slope = terrain.slope_ahead(t.x, t.z, t.yaw, 4.0)
  let slope_k = clamp(1.0 - @math.sin(slope.abs()) * 0.85, 0.35, 1.0)
  let uphill = (input.throttle > 0.0 && t.speed >= 0.0) ||
    (input.throttle < 0.0 && t.speed <= 0.0)
  if track_broken {
    t.speed = move_toward(t.speed, 0.0, 6.0 * dt)
  } else {
    let mut blocked = false
    if uphill {
      let mv = if input.throttle > 0.0 { 1.0 } else { -1.0 }
      // 陡壁墙: 行进方向前方 3.5m(T.gradAt 恒存在)
      let ax = t.x + @math.sin(t.yaw) * 3.5 * mv
      let az = t.z + @math.cos(t.yaw) * 3.5 * mv
      let wall = !(terrain.height_at(ax, az) <=
        terrain.height_at(t.x, t.z) + 0.15) &&
        terrain.grad_at(ax, az) > @math.tan(cfg.sim.max_slope) * 1.25
      if wall {
        blocked = true
      }
      if slope * mv > cfg.sim.max_slope {
        blocked = true
      }
    }
    if blocked {
      t.speed = move_toward(t.speed, 0.0, 8.0 * dt)
    } else {
      // --- 自动变速箱 ---
      let gb = cfg.sim
      if t.shift_t > 0.0 {
        t.shift_t -= dt
      }
      if t.flip_t > 0.0 {
        t.flip_t -= dt
      }
      let gdir = gear_dir(t.gear)
      let gidx = gear_idx(t.gear)
      let caps = if gdir == "R" { gb.gb_rev } else { gb.gb_fwd }
      let tq = if gdir == "R" { gb.gb_torque_r } else { gb.gb_torque_f }
      let top = if gdir == "R" { max_r } else { max_f }
      // 降挡: 速度掉到下一低挡上限×0.93 以下(换向窗口内冻结)
      if t.flip_t <= 0.0 &&
        gidx > 0 &&
        t.speed.abs() < top * caps[gidx - 1] * 0.93 {
        t.gear = gdir + gidx.to_string()
      }
      let want = if input.throttle > 0.05 {
        "D"
      } else if input.throttle < -0.05 {
        "R"
      } else {
        gdir
      }
      if t.gear != "N" && want != gdir {
        // 换向直接切最高挡
        t.gear = if want == "R" {
          "R" + gb.gb_rev.length().to_string()
        } else {
          "D" + gb.gb_fwd.length().to_string()
        }
        t.shift_t = 0.0
        t.flip_t = 1.0
      }
      if t.gear == "N" {
        t.speed = move_toward(t.speed, 0.0, s.brake * dt)
        if t.shift_t <= 0.0 {
          t.gear = if want == "R" { "R1" } else { "D1" }
        }
      } else if input.throttle > 0.0 {
        if gdir != "D" || t.speed < -0.3 {
          let pull = s.accel *
            (if gdir != "D" { gb.gb_torque_r[0] } else { gb.gb_torque_f[0] })
          t.speed = move_toward(t.speed, 0.0, (s.brake + pull) * dt)
        } else {
          let cap = top * caps[gidx]
          if t.speed > cap * 0.985 && gidx < caps.length() - 1 {
            t.gear = gdir + (gidx + 2).to_string()
            t.shift_t = gb.gb_pause
          }
          let tq_i = if t.flip_t > 0.0 { tq[0] } else { tq[gidx] }
          let tq_s = if t.shift_t > 0.0 { 0.25 } else { 1.0 }
          let tq_u = if uphill { slope_k } else { 1.0 }
          let a = s.accel *
            tq_i *
            tq_s *
            tq_u *
            clamp(1.15 - t.speed.abs() / (top + 0.01) * 0.5, 0.4, 1.0)
          t.speed = (cap * input.throttle).min(t.speed + a * dt)
        }
      } else if input.throttle < 0.0 {
        if gdir != "R" || t.speed > 0.3 {
          let pull = s.accel *
            (if gdir != "R" { gb.gb_torque_f[0] } else { gb.gb_torque_r[0] })
          t.speed = move_toward(t.speed, 0.0, (s.brake + pull) * dt)
        } else {
          let cap = top * caps[gidx]
          if t.speed < -cap * 0.985 && gidx < caps.length() - 1 {
            t.gear = gdir + (gidx + 2).to_string()
            t.shift_t = gb.gb_pause
          }
          let rq_i = if t.flip_t > 0.0 { tq[0] } else { tq[gidx] }
          let rq_s = if t.shift_t > 0.0 { 0.25 } else { 1.0 }
          let a = s.accel * rq_i * rq_s
          t.speed = (-cap).max(t.speed - a * dt)
        }
      } else {
        t.speed = move_toward(t.speed, 0.0, s.coast_drag * dt)
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
  if t.speed.abs() > 0.5 {
    t.speed -= t.speed * input.steer.abs() * 0.4 * dt
  }
  // --- 位移与碰撞 ---
  t.x += @math.sin(t.yaw) * t.speed * dt
  t.z += @math.cos(t.yaw) * t.speed * dt
  t.x = clamp(t.x, -terrain.half + 16.0, terrain.half - 16.0)
  t.z = clamp(t.z, -terrain.half + 16.0, terrain.half - 16.0)
  let cx0 = t.x
  let cz0 = t.z
  let (ncx, ncz) = collide_tank(t, env.covers_list)
  t.x = ncx
  t.z = ncz
  if t.x != cx0 || t.z != cz0 {
    let px2 = t.x - cx0
    let pz2 = t.z - cz0
    let pl0 = @math.hypot(px2, pz2)
    let pl = if pl0 > 0.0 { pl0 } else { 1.0 }
    let cosv = (@math.sin(t.yaw) * px2 + @math.cos(t.yaw) * pz2) / pl
    if cosv < -0.5 && t.speed.abs() > 1.0 {
      t.speed *= 0.3
    }
  }
  // 车车碰撞: 含残骸
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
      Some((push_x, push_z)) => {
        me_x += push_x
        me_z += push_z
        let plen0 = @math.hypot(push_x, push_z)
        let plen = if plen0 > 0.0 { plen0 } else { 1.0 }
        let nvx = @math.sin(t.yaw) * t.speed
        let nvz = @math.cos(t.yaw) * t.speed
        let ovx = @math.sin(o.yaw) * o.speed
        let ovz = @math.cos(o.yaw) * o.speed
        let closing = -((nvx - ovx) * push_x / plen +
          (nvz - ovz) * push_z / plen)
        let cosv = (@math.sin(t.yaw) * push_x + @math.cos(t.yaw) * push_z) /
          plen
        if cosv < -0.5 && t.speed.abs() > 1.0 {
          t.speed *= 0.4
        }
        // 撞击伤害(WoT): 双方掉血; JS `env.time - (t._ramT || -9) > 0.5`(_ramT=0 亦按 -9)
        if o.team != t.team && o.alive && env.time - js_orv(t.ram_t, -9.0) > 0.5 {
          t.ram_t = env.time
          o.ram_t = env.time
          let m1 = mass_of(s)
          let m2 = mass_of(o.spec)
          let e = closing * closing * 0.55
          (env.take_ram)(t, o, js_round(e * m2 / (m1 + m2)).to_int())
          (env.take_ram)(o, t, js_round(e * m1 / (m1 + m2)).to_int())
        }
      }
      None => ()
    }
  }
  t.x = me_x
  t.z = me_z
  // --- 陡坡滑落 ---
  if t.y - terrain.height_at(t.x, t.z) < 1.0 {
    let g_lim = @math.tan(cfg.sim.max_slope) * 1.02
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
      let gl0 = @math.hypot(gx, gz)
      let gl = if gl0 > 0.0 { gl0 } else { 1.0 }
      let slide = 4.5.min((g_here - g_lim) * 5.5) * dt
      t.x -= gx / gl * slide
      t.z -= gz / gl * slide
      t.x = clamp(t.x, -terrain.half + 16.0, terrain.half - 16.0)
      t.z = clamp(t.z, -terrain.half + 16.0, terrain.half - 16.0)
      t.speed *= 0.0.max(1.0 - dt * 2.2)
    }
  }
  // --- 地形贴合(履带四角采样) ---
  let sn = @math.sin(t.yaw)
  let cs = @math.cos(t.yaw)
  let sl = s.sample.l
  let sw = s.sample.w
  let h_f = terrain.height_at(t.x + sn * sl, t.z + cs * sl)
  let h_b = terrain.height_at(t.x - sn * sl, t.z - cs * sl)
  let h_l = terrain.height_at(t.x + cs * sw, t.z - sn * sw)
  let h_r = terrain.height_at(t.x - cs * sw, t.z + sn * sw)
  let h_c = terrain.height_at(t.x, t.z)
  let target_y = h_c.max((h_f + h_b + h_l + h_r) / 4.0)
  let t_pitch = @math.atan2(h_f - h_b, 2.0 * sl)
  let t_roll = @math.atan2(h_l - h_r, 2.0 * sw)
  if !t.y_init {
    t.y_init = true
    t.y = target_y
    t.pitch = t_pitch
    t.roll = t_roll
  }
  let sm = 1.0 - @math.exp(-12.0 * dt)
  // --- 坠落 ---
  let gap = t.y - target_y
  if gap > 1.2 {
    t.fall_v = t.fall_v + 9.8 * 2.0 * dt // JS: (t._fallV || 0) + ...(_fallV 非 0/NaN 恒成立)
    t.y -= t.fall_v * dt
    t.pitch = lerp(t.pitch, -0.5.min(t.fall_v * 0.06), sm)
    if t.y <= target_y {
      // 落地结算
      let v = t.fall_v
      t.y = target_y
      t.fall_v = 0.0
      let f_safe = cfg.sim.fall_safe_v
      if v > f_safe && t.alive {
        let dmg = js_round((v - f_safe) * (v - f_safe) * cfg.sim.fall_k).to_int()
        // 重摔可能断带: trackV > 0 && v > trackV && random() < trackChance(掷骰次序: 仅短路后掷)
        let tr = if cfg.sim.fall_track_v > 0.0 &&
          v > cfg.sim.fall_track_v &&
          ctx.rand() < cfg.sim.fall_track_chance {
          6.0
        } else {
          0.0
        }
        t.mod_track = t.mod_track.max(tr)
        t.hp -= dmg.to_double()
        if t.hp <= 0.0 {
          t.hp = 0.0
          t.alive = false
          emit("destroyed", DestroyedEv(t, None))
        }
        emit(
          "hit",
          HitEv(
            None,
            t,
            "fall",
            "fall",
            dmg,
            if v > cfg.sim.fall_track_v {
              Some("track")
            } else {
              None
            },
            { x: t.x, y: t.y + 1.0, z: t.z, },
          ),
        )
      }
    }
  } else {
    t.fall_v = 0.0
    t.y = lerp(t.y, target_y, sm)
  }
  t.pitch = lerp(t.pitch, t_pitch, sm)
  t.roll = lerp(t.roll, t_roll, sm)
  // 履带滚动/纹理相位(表现侧钩子)
  (env.on_moved)(t, dt)
  // --- 炮塔/火炮瞄准 ---
  let ap = js_or0v(input.aim_pitch)
  let cp = @math.cos(ap)
  let sp2 = @math.sin(ap)
  let loc = aim_to_local(
    @math.sin(input.aim_yaw) * cp,
    sp2,
    @math.cos(input.aim_yaw) * cp,
    t.pitch,
    t.yaw,
    t.roll,
  )
  let loc_yaw = @math.atan2(loc.0, loc.2)
  let loc_elev = @math.atan2(loc.1, @math.hypot(loc.0, loc.2))
  if input.hold_turret {
    t.turret_yaw += t.yaw - yaw0
    t.last_turret_rate = 0.0
  } else if t.parts_no_turret {
    let arc = s.gun_arc.unwrap_or(10.0 * @math.PI / 180.0)
    let lay_yaw = clamp(loc_yaw, -arc, arc)
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
        t.yaw + loc_yaw,
        s.turret_traverse * dt,
      )
    }
    t.last_turret_rate = ang_diff(before, t.turret_yaw) / dt
  }
  if !input.hold_turret {
    t.gun_pitch = move_toward(
      t.gun_pitch,
      clamp(loc_elev, s.gun_depression, s.gun_elevation),
      1.2 * dt,
    )
  }
  // --- 缩圈/扩圈 ---
  let d = s.dispersion
  let move_k = t.speed.abs() / s.max_speed * d.dmove
  let turn_k = (t.last_yaw_rate.abs() / s.hull_traverse).min(1.0) * d.hull_turn
  let tur_k = (t.last_turret_rate.abs() / s.turret_traverse.max(0.01)).min(1.0) *
    d.turret_turn
  let target = clamp(d.base * (1.0 + move_k + turn_k + tur_k), d.base, d.max)
  t.disp += (target - t.disp) * (1.0 - @math.exp(-dt * 2.2 / d.aim_time))
  // --- 装填 ---
  let was_loading = t.reload_t > 0.0
  t.reload_t = 0.0.max(t.reload_t - dt)
  if was_loading && t.reload_t == 0.0 {
    emit("reloaded", ReloadedEv(t))
  }
}

///|
/// gear 首字符("D"/"R"/"N")
fn gear_dir(g : String) -> String {
  match g.get_char(0) {
    Some(c) => c.to_string()
    None => "N"
  }
}

///|
/// gear 挡位下标(JS +t.gear[1] - 1; "N" → -1)
fn gear_idx(g : String) -> Int {
  if g == "N" {
    -1
  } else {
    match g.get_char(1) {
      Some(c) => c.to_int() - 49
      None => -1
    }
  }
}

///|
/// fire (sim-engine.js:339-359): 弹夹/装填/扩圈 + 弹场 spawn(2 骰)
pub fn fire(
  ctx : Ctx,
  t : Tank,
  world_shells : Shells,
  pos : Pos,
  dir : Dir,
  emit : (String, EvtData) -> Unit,
) -> Bool {
  if !t.alive || t.reload_t > 0.0 {
    return false
  }
  let cfg = ctx.cfg
  let s = t.spec
  let field = world_shells
  if field.capped() {
    return false
  }
  let al = s.gun.autoloader
  // 弹药架受损: 装填永久变慢
  let rack = if t.mod_ammo > 0.0 { cfg.armor.ammo_reload_mult } else { 1.0 }
  match al {
    Some(a) =>
      if t.clip_left > 1 {
        t.clip_left -= 1
        t.reload_t = a.intra * rack
        t.clip_phase = "intra"
      } else {
        t.clip_left = a.clip
        t.reload_t = a.long * rack
        t.clip_phase = "long"
      }
    None => t.reload_t = s.gun.reload * rack
  }
  t.reload_total = t.reload_t
  t.stats_shots += 1
  let mut disp = t.disp
  if t.mod_gun > 0.0 {
    disp *= cfg.armor.gun_disp_penalty
  }
  // 开炮瞬间扩圈
  t.disp = s.dispersion.max.min(s.dispersion.base + s.dispersion.fire)
  let _ = field.spawn(ctx, t, pos, dir, disp)
  emit("fire", FireEv(t, pos, dir))
  true
}

// ---------- 3D 线段-OBB 求交与部位判定 ----------

///|
/// 局部轴基(sim-engine.js:486-527)
pub(all) struct Axes {
  ex : Pos
  ey : Pos
  ez : Pos
}

///|
/// axesYXZ (sim-engine.js:488-501): YXZ 欧拉 = RY·RX·RZ
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
/// mulAxes (sim-engine.js:510-515): R = A·B
fn mul_axes(a : Axes, b : Axes) -> Axes {
  fn col(v : Pos) -> Pos {
    {
      x: a.ex.x * v.x + a.ey.x * v.y + a.ez.x * v.z,
      y: a.ex.y * v.x + a.ey.y * v.y + a.ez.y * v.z,
      z: a.ex.z * v.x + a.ey.z * v.y + a.ez.z * v.z,
    }
  }

  { ex: col(b.ex), ey: col(b.ey), ez: col(b.ez), }
}

///|
/// axesQuat (sim-engine.js:516-523)
fn axes_quat(qx : Double, qy : Double, qz : Double, qw : Double) -> Axes {
  {
    ex: {
      x: 1.0 - 2.0 * (qy * qy + qz * qz),
      y: 2.0 * (qx * qy + qz * qw),
      z: 2.0 * (qx * qz - qy * qw),
    },
    ey: {
      x: 2.0 * (qx * qy - qz * qw),
      y: 1.0 - 2.0 * (qx * qx + qz * qz),
      z: 2.0 * (qy * qz + qx * qw),
    },
    ez: {
      x: 2.0 * (qx * qz + qy * qw),
      y: 2.0 * (qy * qz - qx * qw),
      z: 1.0 - 2.0 * (qx * qx + qy * qy),
    },
  }
}

///|
fn dot3(a : Pos, bx : Double, by : Double, bz : Double) -> Double {
  a.x * bx + a.y * by + a.z * bz
}

///|
/// U_angDiff (sim-engine.js:570)(与 Util.angDiff 同式)
fn u_ang_diff(a : Double, b : Double) -> Double {
  ang_diff(a, b)
}

///|
/// rayOBB3D (sim-engine.js:531-550): slab 法; 返回命中 {t, point, normal} 或 None
pub fn ray_obb3d(
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  len : Double,
  cx : Double,
  cy : Double,
  cz : Double,
  r : Axes,
  hx : Double,
  hy : Double,
  hz : Double,
) -> (Double, Pos, Pos)? {
  let px = ox - cx
  let py = oy - cy
  let pz = oz - cz
  let lo = [
    dot3(r.ex, px, py, pz),
    dot3(r.ey, px, py, pz),
    dot3(r.ez, px, py, pz),
  ]
  let ld = [
    dot3(r.ex, dx, dy, dz),
    dot3(r.ey, dx, dy, dz),
    dot3(r.ez, dx, dy, dz),
  ]
  let h = [hx, hy, hz]
  let mut tmin = -INF
  let mut tmax = INF
  let mut ax_min = 0
  let mut sg_min = 1.0
  for a in 0..<3 {
    if ld[a].abs() < 1.0e-9 {
      if lo[a] < -h[a] || lo[a] > h[a] {
        return None
      }
      continue
    }
    let inv = 1.0 / ld[a]
    let mut t1 = (-h[a] - lo[a]) * inv
    let mut t2 = (h[a] - lo[a]) * inv
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
  let tt = tmin.max(0.0)
  let axis = [r.ex, r.ey, r.ez][ax_min]
  let n = sg_min * (if tmin < 0.0 { -1.0 } else { 1.0 })
  Some(
    (
      tt,
      { x: ox + dx * tt, y: oy + dy * tt, z: oz + dz * tt, },
      { x: axis.x * n, y: axis.y * n, z: axis.z * n, },
    ),
  )
}

///|
/// tankOBBFrames (sim-engine.js:555-569): 车体(YXZ) → 炮塔(+turretYaw) → 火炮(+gunPitch) 复合基
fn tank_obb_frames(
  t : Tank,
  boxes : TypeBoxes?,
) -> (Axes, Pos, Axes, Pos, Axes, Pos) {
  let hull = axes_yxz(t.pitch, t.yaw, t.roll)
  let base : Pos = { x: t.x, y: t.y, z: t.z, }
  let tb = boxes
  let tp = match tb {
    Some(b) => b.turret_pivot
    None => (0.0, 1.5, 0.0)
  }
  // at(hull, tp)
  let turret_base : Pos = {
    x: base.x + dot3(hull.ex, tp.0, tp.1, tp.2),
    y: base.y + dot3(hull.ey, tp.0, tp.1, tp.2),
    z: base.z + dot3(hull.ez, tp.0, tp.1, tp.2),
  }
  let turret_r = mul_axes(hull, axes_ry(u_ang_diff(t.yaw, t.turret_yaw)))
  let gp = match tb {
    Some(b) => b.gun_pivot
    None => (0.0, 0.4, 1.0)
  }
  let gp_parent = match tb {
    Some(b) => b.gun_parent
    None => "turret"
  }
  // gpParent === 'turret' ? f.turret : f.hull
  let (gp_base_p, gp_base_r) = if gp_parent == "turret" {
    (turret_base, turret_r)
  } else {
    (base, hull)
  }
  let gun_base : Pos = {
    x: gp_base_p.x + dot3(gp_base_r.ex, gp.0, gp.1, gp.2),
    y: gp_base_p.y + dot3(gp_base_r.ey, gp.0, gp.1, gp.2),
    z: gp_base_p.z + dot3(gp_base_r.ez, gp.0, gp.1, gp.2),
  }
  let gun_r = mul_axes(gp_base_r, axes_rx(-t.gun_pitch))
  (hull, base, turret_r, turret_base, gun_r, gun_base)
}

///|
/// probeTankOBB (sim-engine.js:571-596): 部位盒逐盒求交取最近。
/// boxes=None(表缺车型)走 JS 同款 3 盒兜底(tracks/hullSide/turretFront); JS 侧同时写
/// t._obbFallback(未消费副作用), 直译略去(注释保留口径)。
pub fn probe_tank_obb(
  t : Tank,
  boxes : TypeBoxes?,
  ox : Double,
  oy : Double,
  oz : Double,
  dx : Double,
  dy : Double,
  dz : Double,
  seg_len : Double,
) -> Hit? {
  // 盒集: 表内 zones / 兜底 3 盒(与 JS box(z, armor, cy, hh, p) 同式)
  let zones : Array[PartBox] = match boxes {
    Some(b) => b.zones
    None => {
      let s = t.spec.sample
      fn mk(
        zone : String,
        armor : Double,
        cy : Double,
        hh : Double,
        p : String,
      ) -> PartBox {
        {
          zone,
          armor,
          px: p,
          cx: 0.0,
          cy,
          cz: 0.0,
          qx: 0.0,
          qy: 0.0,
          qz: 0.0,
          qw: 0.0,
          hx: s.w,
          hy: hh,
          hz: s.l,
        }
      }

      [
        mk("tracks", 20.0, 0.45, 0.5, "root"),
        mk("hullSide", 30.0, 1.0, 0.55, "root"),
        mk("turretFront", 40.0, 1.7, 0.35, "turret"),
      ]
    }
  }
  let (hull, hull_base, turret_r, turret_base, gun_r, gun_base) = tank_obb_frames(
    t, boxes,
  )
  let mut best : Hit? = None
  for z in zones {
    // spaces[z.p]: root=车体 / turret / gun
    let (sp_p, sp_r) = match z.px {
      "turret" => (turret_base, turret_r)
      "gun" => (gun_base, gun_r)
      _ => (hull_base, hull)
    }
    let c_x = sp_p.x + dot3(sp_r.ex, z.cx, z.cy, z.cz)
    let c_y = sp_p.y + dot3(sp_r.ey, z.cx, z.cy, z.cz)
    let c_z = sp_p.z + dot3(sp_r.ez, z.cx, z.cy, z.cz)
    let rr = @math.hypot(@math.hypot(z.hx, z.hy), z.hz)
    let cd = @math.hypot(@math.hypot(c_x - ox, c_y - oy), c_z - oz)
    if cd - rr > seg_len + 2.0 {
      continue
    }
    let r = if z.qx != 0.0 || z.qy != 0.0 || z.qz != 0.0 || z.qw != 0.0 {
      mul_axes(sp_r, axes_quat(z.qx, z.qy, z.qz, z.qw))
    } else {
      sp_r
    }
    // JS: const R = z.q ? mulAxes(...) : sp.R —— q 数组真值判定; 盒表缺 q 的条目 q 字段为
    // undefined ↔ 全零四元数, 二者一致(无 [0,0,0,0] 合法 q 数据)。
    match
      ray_obb3d(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        seg_len,
        c_x,
        c_y,
        c_z,
        r,
        z.hx,
        z.hy,
        z.hz,
      ) {
      Some((tt, point, normal)) =>
        // JS: if (hit && (!best || hit.t < best.t)) best = { distance: hit.t, ... } —— best 存的
        // 字段名是 distance, 比较读的 best.t 恒 undefined → 首次命中后比较恒 false, 实际语义 =
        // 返回迭代序首个命中盒(而非最近)。上游缺陷, 夹具原样记录(SPEC §6), 直译同构复刻。
        if best is None {
          best = Some({
            distance: tt,
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
