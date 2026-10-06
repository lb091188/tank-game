// mp.mbt — 联机模式入口(GAMEAPP_MP=ws://host:port 触发, main() 顶部分流至此)。
// 场景装配复用 main.mbt 同包工具(地图/地形顶点色/光照/HUD/GLB 装载); 战斗
// 权威在服务器(server.js srvSim): 本地不跑 sim tick —— 快照插值姿态逐帧
// 覆写 @simengine.Tank 的位姿字段(姿态载体, 渲染 sync_tank_node/追车相机/
// HUD 读条管线零改动消费, 即"收快照喂内核姿态"), ev 事件(fire/hit/kill)
// 出视效音效, 本地输入 30Hz 经 netclient 会话协程上行。
// 消息循环接管: async 的 ExternalEventLoop 用 GLib 默认主上下文单步泵
// (glib_loop.c) —— yue 渲染帧定时器(16ms)在 poll 的 dispatch 里跑, WS 收发
// 协程在 poll 之间跑, 同线程交替, 不阻塞渲染帧(external_loop_integration
// 官方约定; 蓝本: moonbit-libyue experiment/async_coexist 实验 4 实测)。

///|
extern "c" fn sf_glib_poll(timeout_ms : Int) -> Int = "sf_glib_poll"

///|
extern "C" fn sf_glib_wakeup() -> Unit = "sf_glib_wakeup"

///|
extern "C" fn mp_exit(code : Int) -> Unit = "exit"

///|
/// yue(GTK)消息循环交由 async runtime 托管: poll=GLib 单步迭代(分派渲染帧
/// 定时器/窗口事件), wakeup=waiter 线程跨线程唤醒阻塞中的 g_poll
struct YueGlibLoop {
  mut polls : Int
  mut dispatched : Int
}

///|
using @external_loop_integration {trait ExternalEventLoop}

///|
/// 唤醒回调在 async 的 waiter 专用线程被调 —— 契约只准纯 C FFI(sf_glib_wakeup
/// 内部 g_main_context_wakeup 线程安全, 无 MoonBit 引用计数操作)
pub impl ExternalEventLoop for YueGlibLoop with fn get_wakeup_callback_for_foreign_thread(
  _self,
) {
  () => sf_glib_wakeup()
}

///|
pub impl ExternalEventLoop for YueGlibLoop with fn poll(
  self : YueGlibLoop,
  timeout? : Int,
) {
  let t = match timeout {
    Some(v) => v
    None => -1
  }
  self.polls += 1
  let r = sf_glib_poll(t)
  if r < 0 {
    // 默认 GMainContext 只会被本线程 acquire, 拿不到即是异常态(死锁风险)
    abort("sf_glib_poll: GMainContext acquire 失败")
  }
  if r > 0 {
    self.dispatched += 1
  }
}

///|
pub impl ExternalEventLoop for YueGlibLoop with fn terminate(self : YueGlibLoop) {
  logln(
    "MP 外部循环 terminate: \{self.polls} 次 poll / \{self.dispatched} 次派发",
  )
}

///|
/// 环境变量读取(core/env; 未设/空 → None)
fn env_opt(key : String) -> String? {
  match @env.get_env_var(key) {
    Some(v) => if v == "" { None } else { Some(v) }
    None => None
  }
}

///|
/// GAMEAPP_MP: 联机服务器地址(ws://host:port), 设定即联机模式
pub fn mp_addr() -> String? {
  env_opt("GAMEAPP_MP")
}

///|
/// GAMEAPP_MP_ROOM: 四位房间号(缺省建房当房主自动开战)
fn mp_room() -> String {
  env_opt("GAMEAPP_MP_ROOM").unwrap_or("")
}

///|
/// GAMEAPP_MP_NAME: 昵称(服务器全服查重)
fn mp_name() -> String {
  env_opt("GAMEAPP_MP_NAME").unwrap_or("moon-native")
}

///|
/// GAMEAPP_MP_TANK: 联机用车(默认 sherman, 车库同款默认)
fn mp_tank() -> String {
  env_opt("GAMEAPP_MP_TANK").unwrap_or("sherman")
}

///|
/// GAMEAPP_MP_MAP: 开战地图(房主用; 默认 l01)
fn mp_map() -> String {
  env_opt("GAMEAPP_MP_MAP").unwrap_or("l01")
}

///|
/// GAMEAPP_MP_MANUAL: 设定即手动驾驶(WASD+左键开火), 缺省自动巡航演示
/// (自动前进+缓转+周期开火 —— 让服务器权威模拟真实动起来, 快照位移可验)
fn mp_manual() -> Bool {
  env_opt("GAMEAPP_MP_MANUAL") is Some(_)
}

///|
/// 联机幽灵单位: 服务器权威姿态, 本地只渲染(位姿字段逐帧被插值快照覆写)
struct Ghost {
  net_id : Int
  name : String
  team : Int
  t : @simengine.Tank // 位姿载体(x/z/y/yaw/turret_yaw/gun_pitch/pitch/roll/hp/alive/reload*)
  root : @core.Object3D
  turret : @core.Object3D?
  gun : @core.Object3D?
  mut fed : Bool // 已收到首帧姿态(此前保持地图出生池第 0 组占位)
  mut smoke_t : Double // 残骸烟间歇计时(vehicle.js _deathFx 同语义)
}

///|
/// 幽灵位姿载体构造(spec 仅作字段默认值来源: MP 本地不 tick, spec 数值
/// 不参与判定, 未知车型一律 sherman spec)
fn mk_ghost_tank(
  typ : String,
  net_id : Int,
  x : Double,
  z : Double,
  yaw : Double,
  team : Int,
  is_player : Bool,
) -> @simengine.Tank raise {
  // spec 按已知车型选(未知回 sherman): 本地不 tick 判定, 但 HUD 血量/装填
  // 读条分母读 spec(快照只给 hp/reloadT 绝对值)
  let spec = if typ == "sherman" {
    sherman_spec()
  } else if typ == "tiger1" {
    tiger1_spec()
  } else {
    match @simengine.vehicle_spec(typ) {
      Some(s) => s
      None => sherman_spec()
    }
  }
  tag_seq.val += 1
  {
    tag: tag_seq.val,
    typ,
    spec,
    x,
    z,
    y: 0.0,
    yaw,
    speed: 0.0,
    last_yaw_rate: 0.0,
    last_turret_rate: 0.0,
    turret_yaw: yaw,
    gun_pitch: 0.0,
    pitch: 0.0,
    roll: 0.0,
    track_offset: 0.0,
    gear: "D1",
    shift_t: 0.0,
    flip_t: 0.0,
    y_init: false,
    fall_v: 0.0,
    ram_t: -9.0,
    hp: spec.hp,
    alive: true,
    reload_t: 1.0,
    reload_total: 1.0,
    clip_left: match spec.gun_autoloader {
      Some(al) => al.clip
      None => 0
    },
    clip_phase: match spec.gun_autoloader {
      Some(_) => "intra"
      None => "single"
    },
    disp: spec.disp_max,
    mod_track: 0.0,
    mod_engine: 0.0,
    mod_gun: 0.0,
    mod_ammo: 0.0,
    no_turret: spec.gun_arc is Some(_),
    obb_fallback: false,
    team,
    net_id,
    is_player,
    st_shots: 0,
    st_hits: 0,
    st_pens: 0,
    st_dmg_dealt: 0.0,
    last_fire_t: -99.0,
  }
}

///|
/// 一次性音效(失败静默限流, combat.mbt sfx 同口径)
fn mp_sfx(
  audio : @audio.Audio,
  name : String,
  gain : Double,
  fails : Ref[Int],
) -> Unit {
  match audio.play(name, opts={ gain, rate: 1.0, }) {
    Ok(_) => ()
    Err(e) =>
      if fails.val < 3 {
        fails.val += 1
        logln("AUDIO \{name} 播放失败: \{e.message()}")
      }
  }
}

///|
/// 联机事件 → 视效/音效/播报(main.js bindMpRelay 客户端还原分支的子集:
/// fire=炮口闪光+炮声, hit=弹着粒子+音, kill=爆炸+播报)
fn mp_apply_event(
  ev : @netclient.EvData,
  fx : Fx,
  audio : @audio.Audio,
  sfx_fails : Ref[Int],
  hud : @hud.Hud?,
  ghosts : Array[Ghost],
  my_id : Int,
  time : Double,
  shot_armed : Ref[Int],
) -> Unit {
  let (px, py, pz) = ev.point
  match ev.kind {
    "fire" => {
      fx.flash(px, py, pz, 2.4)
      mp_sfx(audio, "cannon", 1.4, sfx_fails)
      // 本车开火 → 2 帧后抢拍(炮口闪光入镜, 联机弹道的画内证据)
      if ev.shooter == my_id && shot_armed.val == 0 {
        shot_armed.val = 2
      }
      logln("MP EV fire by=#\{ev.shooter} @(\{px},\{py},\{pz})")
    }
    "hit" => {
      fx.impact(
        if ev.hit_kind == "" { "nopen" } else { ev.hit_kind },
        { x: px, y: py, z: pz, },
      )
      let snd = if ev.hit_kind == "pen" {
        "pen"
      } else if ev.hit_kind == "bounce" {
        "bounce"
      } else {
        "nopen"
      }
      mp_sfx(audio, snd, if ev.target == my_id { 1.6 } else { 0.9 }, sfx_fails)
      logln("MP EV hit \{ev.hit_kind} dmg=\{ev.dmg} #\{ev.shooter}→#\{ev.target}")
    }
    "kill" => {
      fx.explosion({ x: px, y: py, z: pz, })
      mp_sfx(audio, "explosion", 1.3, sfx_fails)
      let label = fn(id : Int) -> String {
        if id == my_id {
          "YOU"
        } else {
          for g in ghosts {
            if g.net_id == id {
              return g.name
            }
          }
          "#\{id}"
        }
      }
      match hud {
        Some(h) =>
          h.push_kill(label(ev.shooter), label(ev.target), ev.shooter == my_id, time)
        None => ()
      }
      logln("MP EV kill #\{ev.shooter} ⇒ #\{ev.target}")
    }
    _ => () // aiWave/pkGet 是 coop 事件, dm 路径不消费
  }
}

///|
/// 幽灵装配(开战消息到达后一次性, 帧回调里做不阻塞 recv 泵): 每名玩家一辆
/// GLB; 服务器侧出生点未知前先用地图出生池第 0 组占位, 首帧快照即接管
fn mp_build_ghosts(
  scene : @core.Scene,
  map : @assets.MapData,
  players : Array[@netclient.PlayerRow],
  my_id : Int,
) -> Array[Ghost] raise {
  let ghosts : Array[Ghost] = []
  let sp = map.spawns[0]
  let y = map.height_at(sp.x, sp.z)
  for i, p in players {
    let root = try {
      load_tank_root(p.tank)
    } catch {
      _ => {
        logln("MP 车型 \{p.tank} 装载失败, 回 sherman")
        load_tank_root("sherman")
      }
    }
    root.position = @math3d.Vector3::new(sp.x, y, sp.z)
    root.traverse(fn(o) {
      match o.mesh {
        Some(m) => m.cast_shadow = true
        None => ()
      }
      true
    })
    scene.add(root)
    ghosts.push({
      net_id: p.id,
      name: p.name,
      team: p.team,
      t: mk_ghost_tank(p.tank, p.id, sp.x, sp.z, sp.yaw, p.team, p.id == my_id),
      root,
      turret: find_child_named(root, "turret"),
      gun: find_child_named(root, "gun"),
      fed: false,
      smoke_t: 0.0,
    })
    logln(
      "MP 幽灵 #\{i} id=\{p.id} name=\{p.name} tank=\{p.tank} team=\{p.team} me=\{p.id == my_id}",
    )
  }
  ghosts
}

///|
/// 自动巡航输入(验收演示: 前进+缓慢蛇行+每 4s 一轮 1.5s 连射; 服务器按装填
/// 门禁自行节流)
fn mp_autopilot(time : Double, yaw : Double) -> @simengine.Input {
  {
    throttle: 1.0,
    steer: 0.35 * @math.sin(time * 0.1),
    aim_yaw: yaw,
    aim_pitch: 0.0,
    fire: (time % 4.0) < 1.5,
    hold_turret: false,
  }
}

///|
/// 插值姿态 → 位姿载体覆写(clientFrame ghostPose 的字段面: 主循环位姿/
/// 炮塔/火炮/车体俯仰侧滚 + 装填读条/弹夹最新帧对账)
fn ghost_feed_pose(t : @simengine.Tank, p : @netclient.Pose) -> Unit {
  t.x = p.x
  t.z = p.z
  t.y = p.y
  t.yaw = p.yaw
  t.turret_yaw = p.tur
  t.gun_pitch = p.pitch
  t.pitch = p.body_pitch
  t.roll = p.body_roll
  t.speed = p.speed
  t.hp = p.hp
  t.alive = p.alive
  t.reload_t = p.reload_t
  t.reload_total = p.reload_total
  t.clip_left = p.clip_left
}

///|
/// 幽灵残骸烟(vehicle.js _deathFx 同语义: 阵亡车每 ~0.35s 一缕)
fn mp_wreck_smoke(ghosts : Array[Ghost], fx : Fx, dt : Double) -> Unit {
  for g in ghosts {
    if g.fed && !g.t.alive {
      g.smoke_t -= dt
      if g.smoke_t <= 0.0 {
        g.smoke_t = 0.35
        fx.smoke_puff(g.t.x, g.t.y + 1.2, g.t.z, 1.0)
      }
    }
  }
}

///|
/// 联机主入口: 场景装配 → yue 窗口/渲染器 → netclient 会话(WS 建房/开战/
/// 快照/输入上行)与渲染帧经 GLib 外部循环同线程交替 → 帧满/断线退出。
/// (调用方 async fn main 已 set_external_event_loop, 这里直接组任务组)
async fn mp_main(addr : String) -> Unit {
  // 联机默认 ~30s(GAMEAPP_FRAMES 可覆写; 16ms 定时器 1875 帧 ≈ 30s)
  let total_frames = env_frames_or(1875)
  let manual = mp_manual()
  logln(
    "---- gameapp MP 启动: addr=\{addr} room=\{mp_room()} name=\{mp_name()} tank=\{mp_tank()} map=\{mp_map()} frames=\{total_frames} manual=\{manual} ----",
  )
  // ---- 地图/场景装配(与 local_main 同款工具) ----
  let dir = {
    let mut d = ""
    for m in @assets.maps_manifest {
      if m.id == "l01" {
        d = m.dir
      }
    }
    d
  }
  if dir == "" {
    logln("地图清单里没有 l01")
    return
  }
  let text = @utf8.decode(read_asset("assets/maps/\{dir}/map.json"))
  let root_json : Json = @json.parse(text)
  let terrain_obj = match root_json {
    Json::Object(m) =>
      match m.get("terrain") {
        Some(Json::Object(t)) => t
        _ => {
          logln("map.json 缺 terrain 段")
          return
        }
      }
    _ => {
      logln("map.json 顶层不是 object")
      return
    }
  }
  let res = jnum(terrain_obj, "resolution").to_int()
  let max_height = jnum(terrain_obj, "maxHeight")
  let png = read_asset("assets/maps/\{dir}/heightmap.png")
  let heights = @assets.load_heightmap(png, res, max_height)
  let map = @assets.parse_map_json(text, dir, heights)
  logln(
    "MP 地图 \{map.name}: 高程 \{res}², 地形 \{map.terrain.size}m, spawns \{map.spawns.length()}",
  )
  let lit = lighting_of(map.raw)
  let grass = @loaders.load_texture_jpeg_bytes(read_asset("assets/textures/grass.jpg")) catch {
    e => {
      logln("草地贴图解码失败 \{e}")
      return
    }
  }
  grass.wrap_s = @core.Wrapping::Repeat
  grass.wrap_t = @core.Wrapping::Repeat
  grass.anisotropy = 8
  let scene = @core.Scene::new()
  scene.background = Some(lit.sky_bottom)
  scene.fog = Some(@core.Fog::exp2(lit.fog_color, lit.fog_density))
  let size = map.terrain.size
  let terrain_geo = @core.BufferGeometry::heightfield(
    size,
    size,
    res - 1,
    res - 1,
    fn(i, j) { map.heights[j * res + i] },
    size / 150.0,
  )
  terrain_geo.set_colors(terrain_vertex_colors(map))
  let terrain_mat = @core.Material::lambert(
    @math3d.Color::white(),
    @math3d.Color::black(),
  )
  terrain_mat.map = Some(grass)
  terrain_mat.vertex_colors = true
  scene.add(@core.Mesh::new(terrain_geo, terrain_mat))
  // ---- 本车位姿载体(未开战前先摆出生点; 幽灵装配后重绑到我的幽灵载体,
  //      相机/HUD/自动瞄准全体跟随服务器权威姿态) ----
  let sp0 = map.spawns[0]
  let player : Ref[@simengine.Tank] = Ref(
    mk_sim_tank(mp_tank(), sp0.x, sp0.z, sp0.yaw, 0, true),
  )
  // ---- 特效/音频 ----
  let fx = Fx::new(scene)
  let audio = @audio.Audio::new(root="../client/assets")
  match audio.open() {
    Ok(_) => logln("MP 音频设备已打开")
    Err(e) => logln("MP 音频设备打开失败(静音继续): \{e.message()}")
  }
  let sfx_fails : Ref[Int] = Ref(0)
  // ---- HUD(失败降级) ----
  let hud : @hud.Hud? = try {
    Some(build_hud(scene))
  } catch {
    e => {
      logln("MP HUD 不可用(降级继续): \{e}")
      None
    }
  }
  // ---- 光照(local_main 同款) ----
  let sun = @lights.DirectionalLight::new()
  sun.color = lit.sun_color
  sun.intensity = lit.sun_intensity
  sun.obj.position = @math3d.Vector3::new(
    lit.sun_dir.x * 300.0,
    lit.sun_dir.y * 300.0,
    lit.sun_dir.z * 300.0,
  )
  sun.cast_shadow = true
  sun.shadow.map_size = 2048
  sun.shadow.bias = 0.0015
  sun.shadow.camera.left = -260.0
  sun.shadow.camera.right = 260.0
  sun.shadow.camera.top = 260.0
  sun.shadow.camera.bottom = -260.0
  sun.shadow.camera.near = 1.0
  sun.shadow.camera.far = 700.0
  @renderers.attach_directional_light(scene, sun)
  let hemi = @lights.HemisphereLight::new(
    sky_color=lit.ambient_color,
    ground_color=@math3d.Color::from_hex("#39412e").unwrap(),
    intensity=lit.ambient,
  )
  @renderers.attach_hemisphere_light(scene, hemi)
  // ---- 相机/输入 ----
  let camera = @core.PerspectiveCamera::new(55.0, 800.0 / 600.0, 0.3, 2200.0)
  let cam = ChaseCamera::new(player.val.yaw, 0.30, 15.0, player.val, map)
  camera.obj.position = cam.eye
  camera.look_at(cam.eye, cam.look_target(player.val))
  scene.update_matrix_world()
  let state = @input.InputState::new()
  let drag_x = Ref(0.0)
  let drag_y = Ref(0.0)
  let on_move = fn(x : Double, y : Double) -> Unit {
    if cam.dragging {
      let dx = x - drag_x.val
      let dy = y - drag_y.val
      cam.yaw = cam.yaw - dx * 0.005
      let mut np = cam.pitch + dy * 0.005
      if np < -0.12 {
        np = -0.12
      }
      if np > 1.1 {
        np = 1.1
      }
      cam.pitch = np
    }
    drag_x.val = x
    drag_y.val = y
    state.apply(@input.InputEvent::mouse_move(x, y))
  }
  // ---- 联机会话共享态 + 帧回调状态(先声明后入闭包) ----
  let net = @netclient.ClientState::make(fn(s) { logln(s) })
  let quit_gate = Ref(false) // 窗口关/渲染失败等本地退出闸
  let ghosts : Ref[Array[Ghost]] = Ref([])
  let sim_time = Ref(0.0)
  let frame = Ref(0)
  let last_t = Ref(mono_now())
  let shot_frame = total_frames * 2 / 3
  let hud_pulse = Ref(0.0)
  let xid_hex = Ref("")
  // 开火事件触发的抢拍倒计时(>0 时每帧递减, 到 0 立即截图 —— 炮口闪光
  // 0.08s 寿命, +2 帧截取仍有 60% 透明度; 未触发则以 2/3 帧保底)
  let shot_armed = Ref(0)
  // ---- 窗口 ----
  if !@yue.initialize() {
    logln("yue init 失败")
    return
  }
  @wgpu_mbt.require_native()
  let window = @yue.Window::new()
  window.set_title("steel-front — gameapp 联机 \{addr}")
  let host = @yue.Container::new()
  host.set_background_color("#222222")
  window.set_content(host)
  window.on_close(fn(_w) {
    logln("MP 窗口关闭 → 请求退出")
    quit_gate.val = true
  })
  window.set_content_size(800.0, 600.0)
  window.activate()
  window.on_key_down(fn(kev) {
    let k = @input.keysym_to_keycode(kev.code.to_uint64())
    state.apply(@input.InputEvent::key_down(k))
    false
  })
  window.on_key_up(fn(kev) {
    let k = @input.keysym_to_keycode(kev.code.to_uint64())
    state.apply(@input.InputEvent::key_up(k))
    false
  })
  window.on_mouse_down(fn(me) {
    state.apply(
      @input.InputEvent::mouse_down(
        @input.MouseButton::from_yue(me.button),
        me.screen_x,
        me.screen_y,
      ),
    )
    if me.button == 1 {
      cam.dragging = true
      drag_x.val = me.screen_x
      drag_y.val = me.screen_y
    }
    false
  })
  window.on_mouse_up(fn(me) {
    state.apply(
      @input.InputEvent::mouse_up(
        @input.MouseButton::from_yue(me.button),
        me.screen_x,
        me.screen_y,
      ),
    )
    if me.button == 1 {
      cam.dragging = false
    }
    false
  })
  window.on_mouse_move(fn(me) { on_move(me.screen_x, me.screen_y) })
  host.on_mouse_move(fn(me) { on_move(me.screen_x, me.screen_y) })
  window.on_wheel(fn(d) {
    let mut nd = cam.dist + d * 1.2
    if nd < 6.5 {
      nd = 6.5
    }
    if nd > 30.0 {
      nd = 30.0
    }
    cam.dist = nd
  })
  // ---- 渲染器 + 联机帧循环(glib 定时器, async poll 的 dispatch 里跑) ----
  @yue.post_task(fn() {
    let widget = @yue.native_handle_view(host.view)
    let gdkwin = ffi_gtk_widget_get_window(widget)
    let xid = ffi_gdk_x11_window_get_xid(gdkwin)
    let xdisplay = ffi_gdk_x11_display_get_xdisplay(
      ffi_gdk_window_get_display(gdkwin),
    )
    xid_hex.val = u32_hex(xid)
    logln("MP 窗口 xid=\{xid_hex.val}, 截图帧 \{shot_frame}")
    let renderer = @renderers.WebGPURenderer::from_xlib(
      xdisplay,
      xid.to_uint64(),
      800U,
      600U,
    ) catch {
      e => {
        logln("MP 渲染器建立失败 \{e}")
        quit_gate.val = true
        return
      }
    }
    host.on_size_changed(fn() {
      let b = host.get_bounds()
      renderer.resize(b.width.to_uint(), b.height.to_uint())
    })
    match hud {
      Some(h) => h.attach_renderer(renderer)
      None => ()
    }
    logln("MP 渲染器就绪, 进入联机帧循环")
    @yue.set_timer(16, fn() {
      frame.val += 1
      // ① 实测帧间 dt(相机平滑/特效/HUD 时钟)
      let now = mono_now()
      let mut dt_real = now - last_t.val
      last_t.val = now
      if dt_real < 0.0 {
        dt_real = 0.0
      }
      if dt_real > 0.1 {
        dt_real = 0.1
      }
      sim_time.val += dt_real
      // ② 开战即装幽灵(GLB 一次性装载)
      if net.started && ghosts.val.length() == 0 && net.players.length() > 0 {
        ghosts.val = try {
          mp_build_ghosts(scene, map, net.players, net.my_id)
        } catch {
          e => {
            logln("MP 幽灵装配失败: \{e}(继续空场跑帧)")
            []
          }
        }
        // 本车位姿载体重绑到我的幽灵(相机/HUD/自动瞄准从此跟权威姿态)
        for g in ghosts.val {
          if g.net_id == net.my_id {
            player.val = g.t
            logln("MP 本车载体已绑定幽灵 #\{g.net_id}(服务器位姿接管)")
          }
        }
      }
      // ③ 本地输入写共享态(手动=键盘+相机瞄准+左键; 自动=巡航演示),
      //    30Hz 由 netclient 上行协程取走
      let inp = if manual {
        manual_input(state, cam.yaw)
      } else {
        mp_autopilot(sim_time.val, player.val.yaw)
      }
      net.in_throttle = inp.throttle
      net.in_steer = inp.steer
      net.in_aim_yaw = inp.aim_yaw
      net.in_aim_pitch = inp.aim_pitch
      net.in_fire = inp.fire
      // ④ 快照插值 → 幽灵位姿载体 → 渲染节点(clientFrame ghostPose 同式)
      if net.started && ghosts.val.length() > 0 {
        match net.snaps.interpolate(@netclient.now_ms()) {
          Some(pp) =>
            for g in ghosts.val {
              match pp.poses.get(g.net_id) {
                Some(pose) => {
                  ghost_feed_pose(g.t, pose)
                  g.fed = true
                }
                None => ()
              }
              sync_tank_node(g.root, g.turret, g.gun, g.t)
            }
          None => ()
        }
        // ⑤ 事件面: ev(fire/hit/kill) → 视效/音效/播报; end → 记分收尾
        for ev in net.events {
          match ev {
            Ev(e) =>
              mp_apply_event(
                e,
                fx,
                audio,
                sfx_fails,
                hud,
                ghosts.val,
                net.my_id,
                sim_time.val,
                shot_armed,
              )
            End(scores) => {
              let sb = StringBuilder()
              for i, r in scores {
                if i > 0 {
                  ignore(sb.write_string(", "))
                }
                ignore(sb.write_string("\{r.1} \{r.2}杀"))
              }
              logln("MP 结算: \{sb.to_string()}")
              quit_gate.val = true
            }
            Err(msg) => logln("MP 服务器 err: \{msg}")
            _ => ()
          }
        }
        net.events.clear()
      }
      // ⑥ 相机/特效/HUD 刷新
      mp_wreck_smoke(ghosts.val, fx, dt_real)
      cam.update(dt_real, player.val, map)
      camera.obj.position = cam.eye
      camera.look_at(cam.eye, cam.look_target(player.val))
      match hud {
        Some(h) => {
          h.update(
            camera,
            player.val.hp,
            player.val.spec.hp,
            player.val.reload_t,
            player.val.reload_total,
            player.val.spec.gun_pen.to_int(),
            upper_ascii(player.val.typ),
            sim_time.val,
          )
          // HUD 状态行(借击杀播报通道, ASCII, 每 3s 重推保持可见): 截图内
          // 直接可见 快照计数/房间号 —— 联机在跑的画内证据
          if sim_time.val - hud_pulse.val > 3.0 {
            hud_pulse.val = sim_time.val
            h.push_kill(
              "SNAP \{net.snap_count}",
              "SRV \{net.room}",
              true,
              sim_time.val,
            )
          }
        }
        None => ()
      }
      let (bb_r, bb_u) = @core.billboard_axes_of(camera)
      fx.update(dt_real, bb_r, bb_u)
      scene.update_matrix_world()
      renderer.render(scene, camera) catch {
        e => {
          logln("MP 渲染失败 \{e}")
          quit_gate.val = true
          return false
        }
      }
      // ⑦ 取证: 状态行(60 帧一条)+ 裁窗截图 + 退出闸
      let do_shot = fn() -> Unit {
        ignore(
          c_system(
            nul("import -window \{xid_hex.val} /tmp/gameapp_mp.png 2>/tmp/gameapp_mp_import.err"),
          ),
        )
        ignore(
          c_system(
            nul("xwininfo -id \{xid_hex.val} -stats > /tmp/gameapp_mp_xwin.txt 2>&1"),
          ),
        )
        logln("MP 截图 frame=\{frame.val}: import -window \{xid_hex.val} → /tmp/gameapp_mp.png")
      }
      if shot_armed.val > 0 {
        shot_armed.val -= 1
        if shot_armed.val == 0 {
          do_shot()
        }
      }
      if frame.val % 60 == 0 {
        logln(
          "MP SIM t=\{sim_time.val} frame=\{frame.val} status=\{net.status} snaps=\{net.snap_count} ghosts=\{ghosts.val.length()} | 本车 x=\{player.val.x} z=\{player.val.z} yaw=\{player.val.yaw} hp=\{player.val.hp} 装填=\{player.val.reload_t}",
        )
        window.set_title("steel-front MP \{net.status} · 快照\{net.snap_count}")
      }
      if frame.val == shot_frame && shot_armed.val == 0 {
        do_shot()
      }
      // 退出闸: 帧满 / 断线 / 窗口关 / 渲染失败 → 置 net.quit(会话与保活收束)
      if frame.val >= total_frames || net.fatal is Some(_) || quit_gate.val {
        if net.fatal is Some(e) {
          logln("MP 致命错误退出: \{e}")
        }
        logln(
          "MP 帧循环结束 frame=\{frame.val}/\{total_frames} snaps=\{net.snap_count} ghosts=\{ghosts.val.length()} t=\{sim_time.val}",
        )
        net.quit = true
        quit_gate.val = true
        // 兜底: 会话协程理论上 ≤300ms 收束(看门狗 250ms 关 socket), 卡死 2.5s 硬退
        ignore(
          @yue.set_timeout(2500, fn() {
            logln("MP 兜底硬退出(优雅收束未达)")
            mp_exit(0)
          }),
        )
        return false
      }
      true
    })
  })
  // ---- 会话与保活(async 协程在 poll 之间跑; GLib 外部循环已在 main 接线) ----
  @async.with_task_group(group => {
    group.spawn_bg() <| () => {
      @netclient.run_session(
        net,
        addr,
        mp_room(),
        mp_name(),
        mp_tank(),
        mp_map(),
      ) catch {
        e => {
          net.fatal = Some("会话异常: \{e}")
          logln("MP 会话异常: \{e}")
        }
      }
    }
    // 保活: 渲染侧没请求退出且没断线就保持事件循环(渲染帧在 poll 里跑)
    group.spawn_bg() <| () => {
      while !net.quit && net.fatal is None && !quit_gate.val {
        @async.sleep(100)
      }
      net.quit = true
    }
  })
  logln("MP 退出(优雅路径)")
}
