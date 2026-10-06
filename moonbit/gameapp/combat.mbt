// combat.mbt — 战斗闭环: 瞄准(鼠标转炮塔)/开火 → simengine 弹场(散布/积分/部位 OBB 探针)
// → 命中结算(裁判, srvsim Judge::on_hit_tank 同式: 穿深/跳弹/毁伤/模块) → 事件
// → 视效(combat.js SF.FX 直译: 曳光线条/火花烟粒子/闪光精灵)+ 音效(moonbit/audio,
// 名目对照 client/js/audio.js: cannon/pen/bounce/nopen/explosion/reload/track)。
// 每段标注 client 原函数/文件行号; GAMEAPP_DEMO=1 走自动瞄准开火演示驱动。

///|
/// CFG.armor(client/js/config.js:1136-1149): 跳弹角/穿深浮动/伤害浮动/模块参数
let armor_ricochet_angle : Double = 70.0 * @math.PI / 180.0

///|
let armor_pen_variance : Double = 0.25

///|
let armor_dmg_variance : Double = 0.25

///|
let armor_track_duration : Double = 6.0

///|
let armor_ammo_chance : Double = 0.08

///|
let armor_ammo_dmg_mult : Double = 1.6

///|
let armor_engine_rear_chance : Double = 0.55

///|
/// 战斗单位: sim 状态 + 渲染节点(smoke_t: 残骸烟间歇计时, vehicle.js _deathFx)
struct Combatant {
  t : @simengine.Tank
  root : @core.Object3D
  turret : @core.Object3D?
  gun : @core.Object3D?
  mut smoke_t : Double
}

///|
/// 曳光拖尾(combat.js shell.trailPts 同语义): 弹场无 id 字段, 以
/// owner_tag + 上次弹位(<0.05m)弱键匹配 hooks 回调里的弹丸。
struct Tracer {
  owner_tag : Int
  mut px : Double
  mut py : Double
  mut pz : Double
  mut flown : Bool
  mut node : @core.Object3D?
  pts : Array[@math3d.Vector3]
  col : (Double, Double, Double)
}

///|
/// 闪光精灵池项(client fx.flashes: life 0.08s 渐隐)
struct FlashItem {
  obj : @core.Object3D
  mat : @core.Material
  mut life : Double
}

///|
/// 特效池(combat.js SF.FX native 对齐): 火花/土屑/烟三张 CPU 粒子池
/// (每池单色, 以池分色替代 client 的逐粒子顶点色) + 闪光精灵池。
struct Fx {
  sparks : @core.ParticleSystem // 穿透/爆炸火星(暖橙)
  grit : @core.ParticleSystem // 跳弹/未穿透/地形土屑(灰白)
  smoke : @core.ParticleSystem // 爆炸烟/残骸烟(深灰)
  flashes : Array[FlashItem]
  mut cursor : Int
}

///|
/// 径向光晕贴图(combat.js:23-29 canvas 径向渐变的同款衰减曲线:
/// 0→1, 0.4→0.5, 1→0 分段线性), 供闪光/粒子共用。
fn glow_texture() -> @core.Texture {
  let n = 64
  let fa : FixedArray[Byte] = FixedArray::make(n * n * 4, b'\x00')
  for j in 0..<n {
    for i in 0..<n {
      let dx = (i - 32).to_double()
      let dy = (j - 32).to_double()
      let d = @math.hypot(dx, dy) / 30.0
      let a = if d < 0.4 { 1.0 - 1.25 * d } else { 0.8333333 * (1.0 - d) }
      let alpha = clamp01(a)
      let o = (j * n + i) * 4
      fa.set(o, (255 : Int).to_byte())
      fa.set(o + 1, (255 : Int).to_byte())
      fa.set(o + 2, (255 : Int).to_byte())
      fa.set(o + 3, (alpha * 255.0).to_int().to_byte())
    }
  }
  @core.Texture::from_rgba(n, n, Bytes::from_array(fa[:]))
}

///|
/// 闪光精灵(公告板单位四边形 + sprite 材质; Mesh::new 默认投/受影,
/// 精灵/粒子一律关掉 —— A5 阴影深度按三角面光栅化会烙错误阴影)
fn make_flash_sprite(
  scene : @core.Scene,
  glow : @core.Texture,
  color : String,
) -> FlashItem {
  let mat = @core.Material::sprite(@math3d.Color::from_hex(color).unwrap())
  mat.map = Some(glow)
  let obj = @core.Mesh::new(@core.BufferGeometry::sprite_quad(), mat)
  obj.mesh.unwrap().cast_shadow = false
  obj.mesh.unwrap().receive_shadow = false
  obj.visible = false
  scene.add(obj)
  { obj, mat, life: 0.0, }
}

///|
fn Fx::new(scene : @core.Scene) -> Fx {
  let glow = glow_texture()
  let spark_mat = @core.Material::particle(
    @math3d.Color::from_hex("#ff8c33").unwrap(),
  )
  spark_mat.map = Some(glow)
  spark_mat.opacity = 0.95
  let grit_mat = @core.Material::particle(
    @math3d.Color::from_hex("#b0a893").unwrap(),
  )
  grit_mat.map = Some(glow)
  grit_mat.opacity = 0.9
  let smoke_mat = @core.Material::particle(
    @math3d.Color::from_hex("#3a3a3a").unwrap(),
  )
  smoke_mat.map = Some(glow)
  smoke_mat.opacity = 0.4
  let sparks = @core.ParticleSystem::new(320, spark_mat)
  let grit = @core.ParticleSystem::new(160, grit_mat)
  let smoke = @core.ParticleSystem::new(80, smoke_mat)
  smoke.gravity = 0.6 // 烟往上飘(负重力=升力)
  scene.add(sparks.obj)
  scene.add(grit.obj)
  scene.add(smoke.obj)
  let flashes : Array[FlashItem] = []
  for _i in 0..<8 {
    flashes.push(make_flash_sprite(scene, glow, "#ffcf7a"))
  }
  { sparks, grit, smoke, flashes, cursor: 0, }
}

///|
/// burst(combat.js:58-67): 球面随机方向迸射 n 粒(速度扰动 0.4..1.2,
/// up 分量抬升), 寿命 0.35..0.75s
fn fx_burst(
  x : Double,
  y : Double,
  z : Double,
  sys : @core.ParticleSystem,
  n : Int,
  speed : Double,
  up : Double,
) -> Unit {
  for _k in 0..<n {
    let th = @simengine.rand() * @math.PI * 2.0
    let ph = @math.acos(@simengine.rand() * 2.0 - 1.0)
    let sp = speed * (0.4 + @simengine.rand() * 0.8)
    ignore(
      sys.spawn(
        x,
        y,
        z,
        @math.sin(ph) * @math.cos(th) * sp,
        @math.cos(ph).abs() * sp * up + up,
        @math.sin(ph) * @math.sin(th) * sp,
        0.5,
        0.35 + @simengine.rand() * 0.4,
      ),
    )
  }
}

///|
/// 单颗烟团(client fx.smoke 的 sprite 版换算成粒子: 初速 vy 1.6 + 随机横漂)
fn Fx::smoke_puff(
  self : Fx,
  x : Double,
  y : Double,
  z : Double,
  big : Double,
) -> Unit {
  ignore(
    self.smoke.spawn(
      x,
      y,
      z,
      (@simengine.rand() - 0.5) * 0.6,
      1.6,
      (@simengine.rand() - 0.5) * 0.6,
      1.5 * big,
      1.6 * big,
    ),
  )
}

///|
/// flash(combat.js:77-82): 取空闲精灵(无则轮转抢占), 0.08s 内线性渐隐
fn Fx::flash(
  self : Fx,
  x : Double,
  y : Double,
  z : Double,
  size : Double,
) -> Unit {
  let mut it : FlashItem? = None
  for f in self.flashes {
    if f.life <= 0.0 {
      it = Some(f)
      break
    }
  }
  let f = match it {
    Some(f) => f
    None => {
      self.cursor = (self.cursor + 1) % self.flashes.length()
      self.flashes[self.cursor]
    }
  }
  f.life = 0.08
  f.obj.position = @math3d.Vector3::new(x, y, z)
  f.obj.scale = @math3d.Vector3::new(size, size, size)
  f.mat.opacity = 1.0
  f.obj.visible = true
}

///|
/// impact(combat.js:121-125): 弹着火花/土屑, pen 加一点闪光
fn Fx::impact(self : Fx, kind : String, p : @simengine.Vec3) -> Unit {
  let n = if kind == "pen" || kind == "ground" { 14 } else { 8 }
  let sp = if kind == "ground" { 4.0 } else { 7.0 }
  if kind == "pen" || kind == "gun" {
    fx_burst(p.x, p.y, p.z, self.sparks, n, sp, 0.5)
  } else {
    fx_burst(p.x, p.y, p.z, self.grit, n, sp, 0.5)
  }
  if kind == "pen" {
    self.flash(p.x, p.y, p.z, 1.6)
  }
}

///|
/// explosion(combat.js:127-132): 火星 26 @9 + 灰屑 14 @5 + 大闪光 + 烟
fn Fx::explosion(self : Fx, p : @simengine.Vec3) -> Unit {
  fx_burst(p.x, p.y, p.z, self.sparks, 26, 9.0, 1.0)
  fx_burst(p.x, p.y, p.z, self.grit, 14, 5.0, 1.2)
  self.flash(p.x, p.y, p.z, 5.0)
  for _i in 0..<3 {
    self.smoke_puff(p.x, p.y + 1.0, p.z, 2.2)
  }
}

///|
/// 每渲染帧: 粒子步进(公告板轴取自相机) + 闪光渐隐(combat.js:134-160)
fn Fx::update(
  self : Fx,
  dt : Double,
  right : @math3d.Vector3,
  up : @math3d.Vector3,
) -> Unit {
  self.sparks.step(dt, right, up)
  self.grit.step(dt, right, up)
  self.smoke.step(dt, right, up)
  for f in self.flashes {
    if f.life > 0.0 {
      f.life -= dt
      f.mat.opacity = 0.0.max(f.life / 0.08)
      if f.life <= 0.0 {
        f.obj.visible = false
      }
    }
  }
}

///|
/// tracer 拖尾色(combat.js:88: 己方金 / 敌方橙红)
fn tracer_color_for(team : Int, player_team : Int) -> (Double, Double, Double) {
  if team == player_team {
    (1.0, 0.85, 0.45)
  } else {
    (1.0, 0.42, 0.12)
  }
}

///|
/// 弱键匹配(下标): 同主(owner_tag)拖尾里取离当前弹位最近者, 阈值 20m。
/// 弹位在 hooks 间每 tick 跳进 ~13m(790m/s × 1/60): on_create 记的是炮口位,
/// 首次 on_flight 已飞出一段; 寿命到点的 on_kill 在位置推进前触发, 距上次
/// on_flight 差一个 tick —— 两处都要靠 20m 窗口收编。同主多弹并存时(装填
/// < 弹寿命)弹间距离 ≥ 数百米, 最近者即正确弹; fresh 拖尾(px=炮口位)不参与
/// 20m 收编(避免过期弹误删新弹的拖尾, flown 标记区分), 但出膛即中的弹
/// (首段撞地, 从未飞过)仍以精确位置匹配收编。
fn tracer_find_index(
  list : Array[Tracer],
  sh : @simengine.Shell,
  kill : Bool,
) -> Int {
  // 出膛即中(首段就撞地/撞掩体, 弹从没飞过): 弹位仍在炮口, 与 fresh 拖尾
  // 的 px(=炮口位)精确重合 —— kill 路径先做全量精确匹配吸收这一 case
  for i, tr in list {
    if tr.owner_tag != sh.owner.tag {
      continue
    }
    let ex = tr.px - sh.pos.x
    let ey = tr.py - sh.pos.y
    let ez = tr.pz - sh.pos.z
    if ex * ex + ey * ey + ez * ez < 0.0025 {
      return i
    }
  }
  let mut best = -1
  let mut best_d2 = 400.0 // 20m²
  for i, tr in list {
    if tr.owner_tag != sh.owner.tag {
      continue
    }
    if kill && !tr.flown {
      continue
    }
    let dx = tr.px - sh.pos.x
    let dy = tr.py - sh.pos.y
    let dz = tr.pz - sh.pos.z
    let d2 = dx * dx + dy * dy + dz * dz
    if d2 < best_d2 {
      best_d2 = d2
      best = i
    }
  }
  best
}

///|
/// 拖尾节点重建: three-native 渲染器对线几何只在上传一次(ensure_gpu_mesh
/// 缓存), 故换点即换节点 —— 移除旧节点新建 8 点渐隐折线(combat.js
/// updateTrail 的 尾暗头亮 顶点色同式)。
fn tracer_sync_node(scene : @core.Scene, tr : Tracer) -> Unit {
  match tr.node {
    Some(n) => {
      scene.root.remove(n)
      n.visible = false
      tr.node = None
    }
    None => ()
  }
  let head = @math3d.Vector3::new(tr.px, tr.py, tr.pz)
  let pts : Array[@math3d.Vector3] = []
  for p in tr.pts {
    pts.push(p)
  }
  pts.push(head)
  let off = 8 - pts.length()
  let positions : Array[Double] = []
  let colors : Array[Double] = []
  for i in 0..<8 {
    let pt = pts[(i - off).max(0)]
    positions.push(pt.x)
    positions.push(pt.y)
    positions.push(pt.z)
    let k = 0.12 + 0.88 * ((i - off + 1).to_double() / 8.0).max(0.0)
    colors.push(tr.col.0 * k)
    colors.push(tr.col.1 * k)
    colors.push(tr.col.2 * k)
  }
  let mat = @core.Material::line_basic(@math3d.Color::white())
  let node = @core.Line::from_positions(positions, mat, colors~)
  scene.add(node)
  tr.node = Some(node)
}

///|
/// 战斗单位展示名: 玩家车 "YOU", 其余车型大写(HUD 击杀播报口径)
fn tank_label(t : @simengine.Tank) -> String {
  if t.is_player {
    "YOU"
  } else {
    upper_ascii(t.typ)
  }
}

///|
/// ASCII 大写(车型名全 ASCII; core String 无 to_upper)
fn upper_ascii(s : String) -> String {
  let sb = StringBuilder()
  for ch in s {
    let u = if ch >= 'a' && ch <= 'z' {
      (ch.to_int() - 32).unsafe_to_char()
    } else {
      ch
    }
    ignore(sb.write_char(u))
  }
  sb.to_string()
}

///|
/// 战斗系统(开火/弹场/裁判/表现钩子/音效的聚合根)
struct Combat {
  scene : @core.Scene
  tanks : Array[Combatant]
  shells : @simengine.Shells
  world : @simengine.World
  partboxes : Map[String, @simengine.PartBoxEntry]?
  tracers : Array[Tracer]
  fx : Fx
  audio : @audio.Audio
  player_team : Int
  mut time : Double
  mut destroy_count : Int
  mut player_hit_count : Int
  mut audio_fail_logged : Int
  mut tracer_misses : Int
  /// 击毁出口(HUD 击杀播报消费; 后置绑定, None 静默)
  /// 参数: (击杀方展示名, 被毁方展示名, 击杀方是否玩家方)
  mut on_kill : ((String, String, Bool) -> Unit)?
}

///|
/// 真实炮向(视觉口径): client vehicle.js gunDir() 的 (0,0,1)·炮世界四元数
/// 同语义 —— group Euler(-pitch,yaw,roll,'YXZ')·turret.y·gun.x=-gunPitch,
/// 化简后 = 平炮塔向(turret_yaw)+ 世界俯仰(gun_pitch + pitch)。
/// 注意不能拿 tank_obb_frames 的 gun.ez 当弹向: 部位盒帧是探针约定
/// Rx(+pitch)(ez.y = sin(gun_pitch - pitch)), 与瞄准伺服 aim_to_local 的
/// 视觉约定差 2×pitch —— demo 坡上实测弹全程 8° 高从靶顶飞过。
/// 平地(pitch=0)两式同值, golden-trace 口径不变。
fn gun_dir_world(t : @simengine.Tank) -> @simengine.Vec3 {
  let e = t.gun_pitch + t.pitch
  let ce = @math.cos(e)
  {
    x: ce * @math.sin(t.turret_yaw),
    y: @math.sin(e),
    z: ce * @math.cos(t.turret_yaw),
  }
}

///|
/// muzzleOf(srv-sim.js:254 同式): 确定性炮口位姿(车前 2m, 高 2.1)
fn muzzle_of(t : @simengine.Tank) -> @simengine.Vec3 {
  {
    x: t.x + @math.sin(t.yaw) * 2.0,
    y: t.y + 2.1,
    z: t.z + @math.cos(t.yaw) * 2.0,
  }
}

///|
/// 一次性音效(失败静默: 无设备/解码失败不影响战斗闭环; 前三条错误记日志
/// 后限流 —— 本机 moon_cpal ALSA 后端不拉样(audio_smoke 头注同源环境问题),
/// 声不排空堆到 15 并发上限后每声都拒, 全量记日志会淹没战斗取证)
fn sfx(c : Combat, name : String, gain : Double) -> Unit {
  match c.audio.play(name, opts={ gain, rate: 1.0, }) {
    Ok(_) => ()
    Err(e) =>
      if c.audio_fail_logged < 3 {
        c.audio_fail_logged += 1
        logln("AUDIO \{name} 播放失败: \{e.message()}")
      }
  }
}

///|
/// 事件出口(client main.js bindBus 的 native 对齐: fire/hit/destroyed/
/// reloaded → 视效+音效+日志取证)
fn combat_emit(c : Combat, _kind : String, ev : @simengine.EventData) -> Unit {
  match ev {
    Fire(f) => {
      c.fx.flash(
        f.pos.x,
        f.pos.y,
        f.pos.z,
        if f.tank.is_player {
          2.6
        } else {
          2.0
        },
      )
      sfx(c, "cannon", if f.tank.is_player { 1.8 } else { 1.2 })
      logln(
        "BATTLE FIRE t=\{c.time} shooter=\{f.tank.typ}(team\{f.tank.team}) pos=(\{f.pos.x},\{f.pos.y},\{f.pos.z})",
      )
    }
    Hit(r) => {
      c.fx.impact(r.kind, r.point)
      let snd = if r.kind == "pen" {
        "pen"
      } else if r.kind == "bounce" {
        "bounce"
      } else {
        "nopen"
      }
      if r.kind != "fall" {
        sfx(c, snd, if r.target.is_player { 1.7 } else { 1.0 })
      }
      if r.module_ == Some("track") {
        sfx(c, "track", 1.2)
      }
      logln(
        "BATTLE HIT t=\{c.time} \{r.kind} dmg=\{r.dmg} zone=\{r.zone} target=\{r.target.typ}(team\{r.target.team}) @(\{r.point.x},\{r.point.y},\{r.point.z})",
      )
    }
    Destroyed(d) => {
      let p : @simengine.Vec3 = { x: d.tank.x, y: d.tank.y + 1.0, z: d.tank.z, }
      c.fx.explosion(p)
      sfx(c, "explosion", 1.3)
      c.destroy_count += 1
      let by = match d.shooter {
        Some(s) => s.typ
        None => "world"
      }
      logln(
        "BATTLE DESTROYED t=\{c.time} tank=\{d.tank.typ}(team\{d.tank.team}) by=\{by}",
      )
      // 击杀播报出口(HUD): 展示名 YOU/车型大写, 击杀方阵营定色
      match c.on_kill {
        Some(f) => {
          let (kn, vn, ally) = match d.shooter {
            Some(s) =>
              (tank_label(s), tank_label(d.tank), s.team == c.player_team)
            None => ("WORLD", tank_label(d.tank), false)
          }
          f(kn, vn, ally)
        }
        None => ()
      }
    }
    Reloaded(r) => if r.tank.is_player { sfx(c, "reload", 1.5) }
    Ram(_) => ()
  }
}

///|
/// 裁判结算(srvsim Judge::on_hit_tank 直译, srv-sim.js:128-158):
/// 入射角→等效装甲→穿深浮动→跳弹/穿透/吸收/模块损伤→掉血→击毁事件。
fn judge_on_hit(
  c : Combat,
  sh : @simengine.Shell,
  tk : @simengine.Tank,
  hit : @simengine.ObbHit,
  seg_dir : @simengine.Vec3,
) -> Unit {
  if !tk.alive {
    return
  }
  let incidence = @math.acos(
    1.0.min(
      (-1.0).max(
        -(hit.normal.x * seg_dir.x +
        hit.normal.y * seg_dir.y +
        hit.normal.z * seg_dir.z),
      ),
    ),
  )
  let armor = hit.armor
  let cal = sh.cal
  let over3 = armor > 0.0 && cal > armor * 3.0
  let mut norm = 5.0 * @math.PI / 180.0
  if armor > 0.0 && cal > armor * 2.0 {
    norm *= 2.0
  }
  let eff = armor / @math.cos(0.0.max(incidence - norm)).max(0.05)
  let pen = sh.pen *
    (1.0 + (@simengine.rand() * 2.0 - 1.0) * armor_pen_variance)
  let rico = armor > 0.0 && !over3 && incidence > armor_ricochet_angle
  let mut kind = "nopen"
  let mut module_ : String? = None
  let mut dmg = 0.0
  sh.owner.st_hits += 1
  if hit.zone == "gun" {
    tk.mod_gun = @double.infinity // 炮管吸收: 火炮损(永久)
    kind = "gun"
    module_ = Some("gun")
  } else if hit.zone == "tracks" {
    tk.mod_track = armor_track_duration
    module_ = Some("track")
    if rico {
      kind = "bounce"
    } else if pen >= eff {
      kind = "pen"
      dmg = @simengine.js_round(
        sh.dmg * (1.0 + (@simengine.rand() * 2.0 - 1.0) * armor_dmg_variance),
      ).to_double()
    } else {
      kind = "absorb"
    }
  } else if rico {
    kind = "bounce"
  } else if pen >= eff {
    kind = "pen"
    let mut d2 = sh.dmg *
      (1.0 + (@simengine.rand() * 2.0 - 1.0) * armor_dmg_variance)
    if @simengine.rand() < armor_ammo_chance {
      d2 *= armor_ammo_dmg_mult
      module_ = Some("ammo")
      tk.mod_ammo = @double.infinity
    } else if hit.zone == "hullRear" &&
      @simengine.rand() < armor_engine_rear_chance {
      module_ = Some("engine")
      tk.mod_engine = @double.infinity
    }
    dmg = @simengine.js_round(d2).to_double()
  }
  if kind == "pen" {
    tk.hp -= dmg
    sh.owner.st_pens += 1
    sh.owner.st_dmg_dealt += dmg
  }
  if sh.owner.is_player {
    c.player_hit_count += 1
  }
  if tk.hp <= 0.0 && tk.alive {
    tk.hp = 0.0
    tk.alive = false
    combat_emit(
      c,
      "destroyed",
      Destroyed({ tank: tk, shooter: Some(sh.owner), }),
    )
  }
  combat_emit(
    c,
    "hit",
    Hit({
      target: tk,
      shooter: Some(sh.owner),
      point: hit.point,
      zone: hit.zone,
      dmg: dmg.to_int(),
      kind,
      module_,
    }),
  )
}

///|
/// partboxes.json → simengine 部位盒表(assets 解析 → simengine 结构直转)
fn partbox_entries_of(
  tables : Map[String, @assets.PartBoxTable],
) -> Map[String, @simengine.PartBoxEntry] {
  let out : Map[String, @simengine.PartBoxEntry] = Map([], capacity=16)
  for k, v in tables {
    let zones : Array[@simengine.ZoneBox] = []
    for z in v.zones {
      zones.push({
        z: z.zone,
        armor: z.armor.to_double(),
        c: (z.c.x, z.c.y, z.c.z),
        h: (z.h.x, z.h.y, z.h.z),
        p: z.parent,
        q: match z.q {
          Some(q) => Some((q.x, q.y, q.z, q.w))
          None => None
        },
      })
    }
    out[k] = {
      turret_pivot: Some((v.turret_pivot.x, v.turret_pivot.y, v.turret_pivot.z)),
      gun_pivot: Some((v.gun_pivot.x, v.gun_pivot.y, v.gun_pivot.z)),
      gun_parent: Some(v.gun_parent),
      zones: Some(zones),
    }
  }
  out
}

///|
/// 模块根 partboxes.json 探测读取(与 tracesrv/tracesengine 候选口径一致)
fn read_partboxes_text() -> String? raise {
  for path in ["partboxes.json", "moonbit/partboxes.json", "../partboxes.json"] {
    let f = c_fopen(nul(path), b"rb\x00")
    if f != 0 {
      ignore(c_fclose(f))
      return Some(@utf8.decode(read_file(path)))
    }
  }
  None
}

///|
/// 弹场环境(每 tick 新建; 高程/掩体闭包走 simcore 同一口径)
fn shell_env_of(
  terrain : @simcore.Terrain,
  covers : @simcore.CoverList,
  tanks : Array[@simengine.Tank],
  player : @simengine.Tank,
  player_team : Int,
) -> @simengine.ShellEnv {
  {
    height_at: fn(x : Double, z : Double) { terrain.height_at(x, z) },
    covers_blocked: fn(
      ox : Double,
      oz : Double,
      oy : Double,
      dx : Double,
      dz : Double,
      len : Double,
      dy : Double,
    ) {
      @simcore.covers_blocked(
        covers,
        fn(x : Double, z : Double) { terrain.height_at(x, z) },
        ox,
        oz,
        oy,
        dx,
        dz,
        len,
        dy,
      )
    },
    tanks,
    player_pos: Some(player),
    player_team,
  }
}

///|
/// 瞄准换算(client main.js playerInput 的 tg 段同式): 目标点 →
/// 世界 aim_yaw / aim_pitch(瞄点高 target.y+1.1, 眼高 p.y+2.2)
fn aim_angles_at(
  from : @simengine.Tank,
  tx : Double,
  ty : Double,
  tz : Double,
) -> (Double, Double) {
  let dx = tx - from.x
  let dz = tz - from.z
  let d = 1.0.max(@math.hypot(dx, dz))
  (@math.atan2(dx, dz), @math.atan2(ty - (from.y + 2.2), d))
}

///|
/// 最近活敌(演示自动瞄准目标)
fn nearest_enemy(c : Combat, of : @simengine.Tank) -> @simengine.Tank? {
  let mut best : @simengine.Tank? = None
  let mut best_d = 1.0e18
  for w in c.tanks {
    if w.t.team == of.team || w.t.tag == of.tag || !w.t.alive {
      continue
    }
    let d = @math.hypot(w.t.x - of.x, w.t.z - of.z)
    if d < best_d {
      best_d = d
      best = Some(w.t)
    }
  }
  best
}

///|
/// 单车输入(演示驱动): 玩家=最近敌自动瞄准+装填好即开火+距离远时推进
/// (车体缓慢对准目标方向); 敌人=瞄玩家+装填好即开火。非演示的敌人待机。
fn demo_input(c : Combat, w : Combatant) -> @simengine.Input {
  let t = w.t
  let target : @simengine.Tank? = if t.is_player {
    nearest_enemy(c, t)
  } else {
    // 敌方瞄玩家(任一存活玩家方单位)
    let mut best : @simengine.Tank? = None
    let mut best_d = 1.0e18
    for p in c.tanks {
      if p.t.team == t.team || !p.t.alive {
        continue
      }
      let d = @math.hypot(p.t.x - t.x, p.t.z - t.z)
      if d < best_d {
        best_d = d
        best = Some(p.t)
      }
    }
    best
  }
  let (yaw, pitch) = match target {
    Some(tg) => aim_angles_at(t, tg.x, tg.y + 1.1, tg.z)
    None => (t.yaw, 0.0)
  }
  // 开火纪律: 炮塔偏航对准瞄向 0.012rad(≈0.7°)才开炮 —— client AI 的
  // aimed 门是 0.05rad(ai.js:1891), 但它有更大的扩圈阈兜底; demo 对静态
  // 靶用紧门(0.7° @103m ≈ 1.3m, 加散布 0.4m 仍在靶内), 否则炮塔从单侧
  // 扫进门槛的瞬间开炮, 每发都带着同向 ~2.9° 的固定偏角必然系统性脱靶
  let laid = @simengine.ang_diff(t.turret_yaw, yaw).abs() < 0.012
  if t.is_player {
    let mut throttle = 0.0
    let mut steer = 0.0
    match target {
      Some(tg) => {
        let dist = @math.hypot(tg.x - t.x, tg.z - t.z)
        // 接敌到 ~100m 再站稳打(client ai.js fireThreshold 标定的首下@100m 口径;
        // 175m+ 处炮塔伺服 ~1° 残差即 3m 级偏差, 命中率太低)
        if dist > 100.0 {
          throttle = 1.0
          steer = @simengine.clamp(
            @simengine.ang_diff(t.yaw, yaw) * 3.0,
            -1.0,
            1.0,
          )
        }
      }
      None => ()
    }
    {
      throttle,
      steer,
      aim_yaw: yaw,
      aim_pitch: pitch,
      fire: t.reload_t <= 0.0 && laid,
      hold_turret: false,
    }
  } else {
    {
      throttle: 0.0,
      steer: 0.0,
      aim_yaw: yaw,
      aim_pitch: pitch,
      fire: t.reload_t <= 0.0 && laid,
      hold_turret: false,
    }
  }
}

///|
/// 手动输入(鼠标玩家): WASD 轴 + 相机偏航瞄准(拖拽即转炮塔) + 左键开火
fn manual_input(
  state : @input.InputState,
  cam_yaw : Double,
) -> @simengine.Input {
  let (mdx, mdz) = state.move_axis()
  {
    throttle: -mdz,
    steer: -mdx,
    aim_yaw: cam_yaw,
    aim_pitch: 0.0,
    fire: state.is_button_down(@input.MouseButton::from_yue(1)),
    hold_turret: false,
  }
}

///|
/// 战斗系统搭建: 弹场+裁判钩子+拖尾/特效/音效全接(钩子经 combat_holder
/// 后置绑定 —— 构造期闭包先持 Ref, 战斗期已就位)
fn combat_new(
  scene : @core.Scene,
  tanks : Array[Combatant],
  player_team : Int,
  audio : @audio.Audio,
  partboxes : Map[String, @simengine.PartBoxEntry]?,
) -> Combat {
  let combat_holder : Ref[Combat?] = Ref(None)
  let get = fn() -> Combat {
    match combat_holder.val {
      Some(cc) => cc
      None => abort("combat 未初始化")
    }
  }
  let hooks = @simengine.Hooks::make(
    on_create=fn(sh) {
      let c = get()
      let tr : Tracer = {
        owner_tag: sh.owner.tag,
        px: sh.pos.x,
        py: sh.pos.y,
        pz: sh.pos.z,
        flown: false,
        node: None,
        pts: [],
        col: tracer_color_for(sh.team, c.player_team),
      }
      c.tracers.push(tr)
      tracer_sync_node(c.scene, tr)
    },
    on_flight=fn(sh) {
      let c = get()
      let idx = tracer_find_index(c.tracers, sh, false)
      if idx >= 0 {
        let tr = c.tracers[idx]
        tr.flown = true
        // 拖尾点(client updateTrail: 位移 >8m 才收点)
        let far = if tr.pts.length() > 0 {
          let p = tr.pts[tr.pts.length() - 1]
          @math.hypot(sh.pos.x - p.x, sh.pos.z - p.z) > 8.0
        } else {
          true
        }
        if far {
          tr.pts.push(@math3d.Vector3::new(sh.pos.x, sh.pos.y, sh.pos.z))
          if tr.pts.length() > 7 {
            ignore(tr.pts.remove(0))
          }
        }
        tr.px = sh.pos.x
        tr.py = sh.pos.y
        tr.pz = sh.pos.z
        tracer_sync_node(c.scene, tr)
      } else {
        c.tracer_misses += 1
      }
    },
    on_impact=fn(kind, p) {
      let c = get()
      c.fx.impact(kind, p)
    },
    on_player_miss=fn(p) {
      logln(
        "BATTLE MISS t=\{get().time} player shot landed @(\{p.x},\{p.y},\{p.z})",
      )
    },
    on_near_miss=fn(sh) {
      logln(
        "BATTLE NEARMISS t=\{get().time} 敌弹来自 (\{sh.owner.x},\{sh.owner.z})",
      )
    },
    on_kill=fn(sh) {
      let c = get()
      let idx = tracer_find_index(c.tracers, sh, true)
      if idx >= 0 {
        let tr = c.tracers[idx]
        match tr.node {
          Some(n) => {
            c.scene.root.remove(n)
            n.visible = false
          }
          None => ()
        }
        ignore(c.tracers.remove(idx))
      } else {
        c.tracer_misses += 1
      }
    },
    probe_tank=fn(_sh, tk, ox, oy, oz, dx, dy, dz, seg_len) {
      @simengine.probe_tank_obb(
        get().partboxes,
        tk,
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        seg_len,
      )
    },
    on_hit_tank=fn(sh, tk, hit, seg_dir) {
      judge_on_hit(get(), sh, tk, hit, seg_dir)
    },
    on_explode=fn(_sh, p, _direct, _armor) {
      let c = get()
      c.fx.explosion(p)
      sfx(c, "explosion", 1.0)
    },
  )
  let shells = @simengine.Shells::make(hooks)
  let fx = Fx::new(scene)
  let combat : Combat = {
    scene,
    tanks,
    shells,
    world: { shells_field: shells, },
    partboxes,
    tracers: [],
    fx,
    audio,
    player_team,
    time: 0.0,
    destroy_count: 0,
    player_hit_count: 0,
    audio_fail_logged: 0,
    tracer_misses: 0,
    on_kill: None,
  }
  combat_holder.val = Some(combat)
  combat
}

///|
/// 每 sim tick 推进战斗: 各车 update_tank(装填/瞄准/行驶) → 开火
/// (simengine.fire, 炮口/弹向确定性位姿) → 弹场积分(命中钩子在上面的
/// hooks 里闭环)。inputs 与 tanks 同序。
fn combat_tick(
  c : Combat,
  inputs : Array[@simengine.Input],
  dt : Double,
  env : @simengine.Env,
  shell_env : @simengine.ShellEnv,
) -> Unit {
  c.time += dt
  for i, w in c.tanks {
    let inp = inputs[i]
    if w.t.alive {
      @simengine.update_tank(w.t, inp, dt, env)
      if inp.fire {
        ignore(
          @simengine.fire(w.t, c.world, muzzle_of(w.t), gun_dir_world(w.t), fn(
            kind : String,
            ev : @simengine.EventData,
          ) {
            combat_emit(c, kind, ev)
          }),
        )
      }
    }
  }
  @simengine.Shells::update(c.shells, dt, shell_env)
}

///|
/// 残骸烟(vehicle.js _deathFx 对齐): 击毁的车每 ~0.35s 冒一缕烟
fn wreck_smoke(c : Combat, dt : Double) -> Unit {
  for w in c.tanks {
    if !w.t.alive {
      w.smoke_t -= dt
      if w.smoke_t <= 0.0 {
        w.smoke_t = 0.35
        c.fx.smoke_puff(w.t.x, w.t.y + 1.2, w.t.z, 1.0)
      }
    }
  }
}
