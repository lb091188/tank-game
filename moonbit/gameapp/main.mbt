// gameapp/main.mbt — 场景装配主入口。骨架沿用 three-native examples/map_lightup
// (yue 窗口 + native_handle_view + from_xlib 渲染器 + set_timer 帧循环,
// 本机已验证可跑), 装配内容对齐 client/js 的真实装载逻辑:
//   地形    client/js/assets.js:52 + terrain.js buildMesh
//   出生    client/js/main.js buildScene(spawns 池) + waves[].enemies
//   模型    client/js/assets.js MODEL_FILES(file_of_type)+ models.js makeTank 阴影

///|
#borrow(widget)
extern "c" fn ffi_gtk_widget_get_window(widget : UInt64) -> UInt64 = "gtk_widget_get_window"

///|
#borrow(gdkwin)
extern "c" fn ffi_gdk_window_get_display(gdkwin : UInt64) -> UInt64 = "gdk_window_get_display"

///|
#borrow(gdkwin)
extern "c" fn ffi_gdk_x11_window_get_xid(gdkwin : UInt64) -> UInt = "gdk_x11_window_get_xid"

///|
#borrow(display)
extern "c" fn ffi_gdk_x11_display_get_xdisplay(display : UInt64) -> UInt64 = "gdk_x11_display_get_xdisplay"

///|
#borrow(cmd)
extern "c" fn c_system(cmd : Bytes) -> Int = "system"

///|
#borrow(name)
extern "c" fn c_getenv(name : Bytes) -> UInt64 = "getenv"

///|
extern "c" fn c_atoi(p : UInt64) -> Int = "atoi"

///|
#borrow(path, mode)
extern "c" fn c_fopen(path : Bytes, mode : Bytes) -> UInt64 = "fopen"

///|
#borrow(s, f)
extern "c" fn c_fputs(s : Bytes, f : UInt64) -> Int = "fputs"

///|
#borrow(buf, f)
extern "c" fn c_fread(
  buf : Bytes,
  size : UInt64,
  n : UInt64,
  f : UInt64,
) -> UInt64 = "fread"

///|
extern "c" fn c_fseek(f : UInt64, off : UInt64, whence : Int) -> Int = "fseek"

///|
extern "c" fn c_ftell(f : UInt64) -> UInt64 = "ftell"

///|
extern "c" fn c_fclose(f : UInt64) -> Int = "fclose"

///|
extern "c" fn c_fflush(f : UInt64) -> Int = "fflush"

///|
/// CLOCK_MONOTONIC(linux clock_gettime clk_id=1; timespec = 两个 i64)
#borrow(tp)
extern "c" fn c_clock_gettime(clk : Int, tp : Bytes) -> Int = "clock_gettime"

///|
/// 单调时钟当前秒(固定步长累加器的帧间实测 dt, JS tick(performance.now) 同位)
fn mono_now() -> Double {
  let tp = Bytes::make(16, 0)
  ignore(c_clock_gettime(1, tp))
  let mut sec : Int64 = 0L
  let mut nsec : Int64 = 0L
  for i in 0..<8 {
    sec = sec | (tp[i].to_int().to_int64() << (i * 8))
    nsec = nsec | (tp[8 + i].to_int().to_int64() << (i * 8))
  }
  sec.to_double() + nsec.to_double() * 1.0e-9
}

///|
/// C 字符串(补 \0)
fn nul(s : String) -> Bytes {
  @utf8.encode(s) + b"\x00"
}

///|
/// 追加一行日志(立即落盘, 便于无头验收取证)
fn logln(s : String) -> Unit {
  let line : Bytes = @utf8.encode(s) + b"\n\x00"
  let f = c_fopen(b"/tmp/gameapp.log\x00", b"a\x00")
  if f != 0 {
    ignore(c_fputs(line, f))
    ignore(c_fflush(f))
  }
}

///|
/// 读整个文件(游戏资产在 steel-front 主仓, 绝对/相对路径只读)
fn read_file(path : String) -> Bytes raise {
  let f = c_fopen(nul(path), b"rb\x00")
  if f == 0 {
    raise Failure("打不开 \{path}")
  }
  ignore(c_fseek(f, 0UL, 2))
  let len = c_ftell(f).reinterpret_as_int64().to_int()
  ignore(c_fseek(f, 0UL, 0))
  let buf = Bytes::makei(len, _ => b'\x00')
  let got = c_fread(buf, 1UL, len.to_uint64(), f)
  ignore(c_fclose(f))
  if got.reinterpret_as_int64().to_int() != len {
    raise Failure("读不完整 \{path}")
  }
  buf
}

///|
/// 读 client/ 资产(rel 如 "assets/models/bt7.glb"): 沿 assets.client_prefixes
/// 探测(运行 cwd 可能是模块根/仓根, 同 assets 包的多 cwd 兜底口径)
fn read_asset(rel : String) -> Bytes raise {
  for p in @assets.client_prefixes {
    let path = p + rel
    let f = c_fopen(nul(path), b"rb\x00")
    if f != 0 {
      ignore(c_fclose(f))
      return read_file(path)
    }
  }
  raise Failure("资产缺失: \{rel}(client/ 前缀均未命中)")
}

///|
/// GAMEAPP_FRAMES 环境变量(FFI getenv+atoi)→ 帧数; 未设/非法用默认值
fn env_frames_or(def : Int) -> Int {
  let p = c_getenv(b"GAMEAPP_FRAMES\x00")
  if p == 0UL {
    def
  } else {
    let n = c_atoi(p)
    if n <= 0 {
      def
    } else {
      n
    }
  }
}

///|
/// GAMEAPP_DEMO 环境变量: 设定即内置自动演示(自动瞄准开火多次, tracer/
/// 爆炸可见; GAMEAPP_FRAMES 跑满自然退出 rc=0)
fn env_demo() -> Bool {
  c_getenv(b"GAMEAPP_DEMO\x00") != 0UL
}

///|
/// GAMEAPP_MOUSELOCK 环境变量: 默认开, "0"=显式关。FPS 式指针锁定
/// (常规端游口径 —— 点击进锁定/锁定中鼠标转视角+LMB 开火/ESC 先
/// 解锁/失焦自动释放; 机制在 three-native input::PointerLock;
/// 自动演示(DEMO)/MP 自动巡航不启用 —— 看演示不该吞鼠标; MP 手动
/// 需配合 GAMEAPP_MP_MANUAL=1)。
fn env_mouselock() -> Bool {
  let p = c_getenv(b"GAMEAPP_MOUSELOCK\x00")
  if p == 0UL {
    true // 默认开:锁定即默认体验, 拖拽模式用 0 显式退回
  } else {
    c_atoi(p) != 0
  }
}

///|
/// UInt → "0x..." 十六进制(xid 传给 import/xwininfo 用)
fn u32_hex(v : UInt) -> String {
  let digits : Array[Char] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
  ]
  let sb = StringBuilder::new()
  sb.write_string("0x")
  let mut started = false
  for shift in [28, 24, 20, 16, 12, 8, 4, 0] {
    let d = ((v >> shift) & 0xFU).to_int()
    if d != 0 || started || shift == 0 {
      ignore(sb.write_char(digits[d]))
      started = true
    }
  }
  sb.to_string()
}

///|
/// map.json lighting 段(client main.js buildScene 的 L 口径)
struct Lighting {
  sun_dir : @math3d.Vector3
  sun_color : @math3d.Color
  sun_intensity : Double
  ambient : Double
  ambient_color : @math3d.Color
  fog_color : @math3d.Color
  fog_density : Double
  sky_top : @math3d.Color
  sky_bottom : @math3d.Color
}

///|
/// JSON 数值字段(缺键/类型不符 raise)
fn jnum(obj : Map[String, Json], key : String) -> Double raise {
  match obj.get(key) {
    Some(Json::Number(v, ..)) => v
    _ => raise Failure("缺数值字段: \{key}")
  }
}

///|
/// [x, y, z] 三元数值数组
fn jarr3(
  obj : Map[String, Json],
  key : String,
) -> (Double, Double, Double) raise {
  let arr = match obj.get(key) {
    Some(Json::Array(a)) => a
    _ => raise Failure("缺数组字段: \{key}")
  }
  if arr.length() < 3 {
    raise Failure("数组字段 \{key} 长度 \{arr.length()} < 3")
  }
  let num = fn(k : Int) -> Double raise {
    match arr[k] {
      Json::Number(d, ..) => d
      _ => raise Failure("\{key}[\{k}] 非数值")
    }
  }
  (num(0), num(1), num(2))
}

///|
/// lighting 段解析(颜色直建, sunDir 归一化)
fn lighting_of(raw : Json) -> Lighting raise {
  let obj = match raw {
    Json::Object(m) => m
    _ => raise Failure("map.json 顶层不是 object")
  }
  let l = match obj.get("lighting") {
    Some(Json::Object(l)) => l
    _ => raise Failure("map.json 缺 lighting 段")
  }
  let (sx, sy, sz) = jarr3(l, "sunDir")
  let dlen = (sx * sx + sy * sy + sz * sz).sqrt()
  let (sc0, sc1, sc2) = jarr3(l, "sunColor")
  let (ac0, ac1, ac2) = jarr3(l, "ambientColor")
  let (fc0, fc1, fc2) = jarr3(l, "fogColor")
  let (st0, st1, st2) = jarr3(l, "skyTop")
  let (sb0, sb1, sb2) = jarr3(l, "skyBottom")
  {
    sun_dir: @math3d.Vector3::new(sx / dlen, sy / dlen, sz / dlen),
    sun_color: @math3d.Color::new(sc0, sc1, sc2),
    sun_intensity: jnum(l, "sunIntensity"),
    ambient: jnum(l, "ambient"),
    ambient_color: @math3d.Color::new(ac0, ac1, ac2),
    fog_color: @math3d.Color::new(fc0, fc1, fc2),
    fog_density: jnum(l, "fogDensity"),
    sky_top: @math3d.Color::new(st0, st1, st2),
    sky_bottom: @math3d.Color::new(sb0, sb1, sb2),
  }
}

///|
/// 摆放清单: 类型 + 世界坐标 + 朝向(player.spawn / spawns 池 / waves[].enemies)
struct TankPlacement {
  typ : String
  x : Double
  z : Double
  yaw : Double
  label : String
}

///|
/// waves[].enemies[] → 摆放清单(pos 是 [x, z] 二元, yaw 缺省 0)
fn enemy_placements_of(raw : Json) -> Array[TankPlacement] raise {
  let out : Array[TankPlacement] = []
  let obj = match raw {
    Json::Object(m) => m
    _ => raise Failure("map.json 顶层不是 object")
  }
  match obj.get("waves") {
    Some(Json::Array(waves)) =>
      for w in waves {
        match w {
          Json::Object(wo) =>
            match wo.get("enemies") {
              Some(Json::Array(es)) =>
                for e in es {
                  match e {
                    Json::Object(eo) => {
                      let typ = match eo.get("type") {
                        Some(Json::String(s)) => s
                        _ => raise Failure("enemy 缺 type")
                      }
                      let pos = match eo.get("pos") {
                        Some(Json::Array(a)) => a
                        _ => raise Failure("enemy 缺 pos")
                      }
                      if pos.length() < 2 {
                        raise Failure("enemy pos 长度 < 2")
                      }
                      let num = fn(k : Int) -> Double raise {
                        match pos[k] {
                          Json::Number(d, ..) => d
                          _ => raise Failure("pos[\{k}] 非数值")
                        }
                      }
                      let yaw = match eo.get("yaw") {
                        Some(Json::Number(d, ..)) => d
                        _ => 0.0
                      }
                      out.push({
                        typ,
                        x: num(0),
                        z: num(1),
                        yaw,
                        label: "enemy-\{typ}",
                      })
                    }
                    _ => raise Failure("enemy 不是 object")
                  }
                }
              _ => ()
            }
          _ => ()
        }
      }
    _ => ()
  }
  out
}

///|
fn lerp(a : Double, b : Double, t : Double) -> Double {
  a + (b - a) * t
}

///|
fn clamp01(v : Double) -> Double {
  if v < 0.0 {
    0.0
  } else if v > 1.0 {
    1.0
  } else {
    v
  }
}

///|
/// 地形顶点色 —— client/js/terrain.js buildMesh 的 grass 主题逐句直译:
/// 棋盘草色 + 低地压暗 + 陡坡岩/土 + 谷地土路 + 不可攀断崖压黑
/// (坡度=中心差分, 采样走 assets.heightmap_height_at, 与 sim heightAt 同式)。
fn terrain_vertex_colors(map : @assets.MapData) -> Array[Double] {
  let res = map.terrain.resolution
  let size = map.terrain.size
  let half = size / 2.0
  let cell = size / (res - 1).to_double()
  // grass 主题配色(terrain.js:18)
  let low = (0.44, 0.46, 0.30)
  let grass = (0.32, 0.42, 0.20) // P.mid
  let grass2 = (0.38, 0.47, 0.24) // P.mid2
  let rock = (0.44, 0.43, 0.41) // P.high
  let dirt = (0.45, 0.38, 0.26) // P.slope
  let colors : Array[Double] = Array::new()
  for j in 0..<res {
    for i in 0..<res {
      let x = -half + i.to_double() * cell
      let z = -half + j.to_double() * cell
      let hh = map.heights[j * res + i]
      // 坡度(中心差分, terrain.js:35-37)
      let hx = map.height_at(x + cell, z) - map.height_at(x - cell, z)
      let hz = map.height_at(x, z + cell) - map.height_at(x, z - cell)
      let slope = (hx * hx + hz * hz).sqrt() / (cell * 2.0)
      // 棋盘草色(terrain.js:39: hh<9 时 XOR 棋盘, 否则 grass2)
      let base = if hh < 9.0 {
        if ((j % 2) ^ (i % 2)) != 0 {
          grass
        } else {
          grass2
        }
      } else {
        grass2
      }
      let mut c0 = base.0
      let mut c1 = base.1
      let mut c2 = base.2
      // 低地压暗(terrain.js:40)
      let lowk = clamp01((9.0 - hh) / 6.0) * 0.7
      c0 = lerp(c0, low.0, lowk)
      c1 = lerp(c1, low.1, lowk)
      c2 = lerp(c2, low.2, lowk)
      // 陡 → 岩/土(terrain.js:41-42)
      let k = clamp01((slope - 0.25) * 2.2)
      let rc = if hh > 30.0 { rock } else { dirt }
      c0 = lerp(c0, rc.0, k)
      c1 = lerp(c1, rc.1, k)
      c2 = lerp(c2, rc.2, k)
      // 草原谷地土路(terrain.js:50-51)
      if x.abs() < 8.0 && hh < 10.0 && z > -250.0 {
        c0 = lerp(c0, 0.30, 0.55)
        c1 = lerp(c1, 0.30, 0.55)
        c2 = lerp(c2, 0.30, 0.55)
      }
      // 不可攀断崖压黑(terrain.js:55-56)
      let ck = clamp01((slope - 0.68) / 0.37)
      if ck > 0.0 {
        let mul = 1.0 - ck * 0.85
        c0 = c0 * mul
        c1 = c1 * mul
        c2 = c2 * mul
      }
      colors.push(c0)
      colors.push(c1)
      colors.push(c2)
    }
  }
  colors
}

///|
/// 按类型名装载坦克 GLB(字节层走 assets 清单反查 + 本地 C 读,
/// dataURI 贴图车型先经 glbfix 重写 —— m4-sherman/stug3 等 7 型不带这层会 panic)
fn load_tank_root(typ : String) -> @core.Object3D raise {
  let file = match @assets.file_of_type(typ) {
    Some(f) => f
    None => raise Failure("未知坦克类型: \{typ}")
  }
  let raw = read_asset("assets/models/\{file}.glb")
  let patched = @glbfix.patch_glb_datauri(raw)
  let root = @loaders.load_glb(patched)
  let tris = Ref(0)
  root.traverse(fn(o) {
    match o.mesh {
      Some(m) => tris.val = tris.val + m.geometry.index_count() / 3
      None => ()
    }
    true
  })
  logln("模型 \{typ} ← \{file}.glb: \{tris.val} 三角形")
  root
}

///|
/// 按 spawn 摆一辆坦克: 贴地(assets 双线性高程, sim heightAt 同式)+ yaw 朝向
/// + 部件网格投影(client models.js makeTank 的 castShadow 同语义)。
/// 返回根节点(本车要被 sim tick 逐帧驱动, 调用方保留引用)。
fn place_tank(
  scene : @core.Scene,
  map : @assets.MapData,
  p : TankPlacement,
) -> @core.Object3D raise {
  let root = load_tank_root(p.typ)
  let y = map.height_at(p.x, p.z)
  root.position = @math3d.Vector3::new(p.x, y, p.z)
  root.rotation = @math3d.Quaternion::from_euler(
    @math3d.Euler::new(0.0, p.yaw, 0.0),
  )
  root.traverse(fn(o) {
    match o.mesh {
      Some(m) => m.cast_shadow = true
      None => ()
    }
    true
  })
  scene.add(root)
  logln("摆放 \{p.label} @ (\{p.x}, \{y}, \{p.z}) yaw=\{p.yaw}")
  root
}

///|
// mkTank 对象同一性(o === t)的发号器(updateTank 的 o===t 分支以 tag 判等;
// 同 traceengine/main.mbt 口径)
let tag_seq : Ref[Int] = Ref(0)

///|
/// 本车 spec: sherman(client/js/config.js:17-28 vehicles.sherman 逐字段直译)。
/// simengine.vehicle_spec 只收录 golden-trace 用的 pz4/stug3, sherman 在
/// gameapp 本地补齐(字段序/口径同 cfg.mbt pz4 分支), 不动冻结的 trace 包。
fn sherman_spec() -> @simengine.Spec {
  {
    typ: "sherman",
    cls: "MT",
    hp: 900.0,
    max_speed: 13.3, // 极速 48km/h
    reverse_ratio: 0.42,
    accel: 4.0,
    brake: 9.5,
    coast_drag: 5.5,
    hull_traverse: 40.0 * @math.PI / 180.0,
    turret_traverse: 38.0 * @math.PI / 180.0,
    gun_depression: -12.0 * @math.PI / 180.0,
    gun_elevation: 18.0 * @math.PI / 180.0,
    gun_arc: None,
    turret_hull_lock: false,
    sample_l: 3.05,
    sample_w: 1.45,
    disp_base: 0.38,
    disp_aim_time: 2.2,
    disp_max: 2.2,
    disp_move: 1.5,
    disp_hull_turn: 1.1,
    disp_turret_turn: 0.55,
    disp_fire: 1.6,
    gun_reload: 3.5,
    gun_autoloader: None,
    gun_pen: 95.0,
    gun_dmg: 150.0,
    gun_cal: None,
    gun_speed: 750.0,
    gun_life: None,
    gun_grav: None,
    gun_splash: None,
  }
}

///|
/// tiger1 spec(client/js/config.js:83-93 逐字段直译; simengine.vehicle_spec
/// 只收录 golden-trace 用的 pz4/stug3, demo 波次的虎 I 在 gameapp 本地补齐)
fn tiger1_spec() -> @simengine.Spec {
  {
    typ: "tiger1",
    cls: "HT",
    hp: 1400.0,
    max_speed: 11.11,
    reverse_ratio: 0.42,
    accel: 3.0,
    brake: 9.0,
    coast_drag: 5.2,
    hull_traverse: 35.0 * @math.PI / 180.0,
    turret_traverse: 32.0 * @math.PI / 180.0,
    gun_depression: -10.0 * @math.PI / 180.0,
    gun_elevation: 15.0 * @math.PI / 180.0,
    gun_arc: None,
    turret_hull_lock: false,
    sample_l: 3.3,
    sample_w: 1.85,
    disp_base: 0.40,
    disp_aim_time: 2.3,
    disp_max: 2.4,
    disp_move: 1.5,
    disp_hull_turn: 1.1,
    disp_turret_turn: 0.55,
    disp_fire: 1.6,
    gun_reload: 6.4,
    gun_autoloader: None,
    gun_pen: 145.0,
    gun_dmg: 220.0,
    gun_cal: Some(88.0),
    gun_speed: 820.0,
    gun_life: None,
    gun_grav: None,
    gun_splash: None,
  }
}

///|
/// HUD 字形字体读取(fixtures/fonts/HudFont.ttf, ASCII+常用符号子集;
/// 候选前缀兼容 模块根/仓根 两种 cwd)
fn read_hud_font() -> Bytes? raise {
  for
    path in [
      "fixtures/fonts/HudFont.ttf", "moonbit/fixtures/fonts/HudFont.ttf", "../moonbit/fixtures/fonts/HudFont.ttf",
    ] {
    let f = c_fopen(nul(path), b"rb\x00")
    if f != 0 {
      ignore(c_fclose(f))
      return Some(read_file(path))
    }
  }
  None
}

///|
/// HUD 装配(字体烘焙失败抛错 → 调用方降级为无 HUD 继续跑)
fn build_hud(scene : @core.Scene) -> @hud.Hud raise {
  let data = match read_hud_font() {
    Some(d) => d
    None => raise Failure("fixtures/fonts/HudFont.ttf 未找到")
  }
  let atlas = @fontatlas.FontAtlas::bake(
    data,
    18.0,
    512,
    256,
    @fontatlas.hud_codepoints(),
  )
  logln(
    "HUD 字形图集: 512×256 @18px, \{atlas.glyph_count()} 字形(ASCII+常用符号)",
  )
  @hud.Hud::new(scene, atlas, 800, 600, 55.0)
}

///|
/// sim 桩(traceengine mk_tank 同式, 字段集 = simengine updateTank 读写清单):
/// typ/x/z/yaw/team 由调用方给定, 其余初值与 golden-trace2.js mkTank 一致。
fn mk_sim_tank(
  typ : String,
  x : Double,
  z : Double,
  yaw : Double,
  team : Int,
  is_player : Bool,
) -> @simengine.Tank raise {
  let spec = if typ == "sherman" {
    sherman_spec()
  } else if typ == "tiger1" {
    tiger1_spec()
  } else {
    match @simengine.vehicle_spec(typ) {
      Some(s) => s
      None =>
        raise Failure(
          "mk_sim_tank: 未知车型 \{typ}(vehicle_spec 未覆盖)",
        )
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
    net_id: 0,
    is_player,
    st_shots: 0,
    st_hits: 0,
    st_pens: 0,
    st_dmg_dealt: 0.0,
    last_fire_t: -99.0,
  }
}

///|
/// sim 世界搭建: 地形(Float 高程, golden-trace 同 make_terrain 口径)
/// + 掩体(map.json covers → cover_col)。sim heightAt 与 assets MapData
/// height_at 同一高程网格, 仅 Float/Double 精度差(视觉摆放无感)。
fn sim_world_of(
  map : @assets.MapData,
) -> (@simcore.Terrain, @simcore.CoverList) {
  let res = map.terrain.resolution
  let heights : FixedArray[Float] = FixedArray::makei(res * res, fn(i) {
    Float::from_double(map.heights[i])
  })
  let terrain = @simcore.make_terrain(heights, map.terrain.size, res)
  let items : Array[@simcore.Cover] = []
  for c in map.covers {
    items.push(
      @simcore.cover_col({
        typ: c.typ,
        x: c.x,
        z: c.z,
        yaw: Some(c.yaw),
        scale: Some(c.scale),
      }),
    )
  }
  (terrain, { items, bushes: None, })
}

///|
/// sim 状态 → 渲染节点(client/js/vehicle.js _syncNode 直译):
///   group.rotation.set(-pitch, yaw, roll, 'YXZ') → qy(yaw)·qx(-pitch)·qz(roll)
///   turret.rotation.y = angDiff(yaw, turretYaw); gun.rotation.x = -gunPitch
/// 车型 GLB 的 turret/gun 节点静息旋转为恒等(m4-sherman.glb 实测 rot=None),
/// 整体覆写 rotation 与 JS 改单轴分量等价。
fn sync_tank_node(
  root : @core.Object3D,
  turret : @core.Object3D?,
  gun : @core.Object3D?,
  t : @simengine.Tank,
) -> Unit {
  root.position = @math3d.Vector3::new(t.x, t.y, t.z)
  let qx = @math3d.Quaternion::from_axis_angle(
    @math3d.Vector3::new(1.0, 0.0, 0.0),
    -t.pitch,
  )
  let qy = @math3d.Quaternion::from_axis_angle(
    @math3d.Vector3::new(0.0, 1.0, 0.0),
    t.yaw,
  )
  let qz = @math3d.Quaternion::from_axis_angle(
    @math3d.Vector3::new(0.0, 0.0, 1.0),
    t.roll,
  )
  root.rotation = qy.multiply(qx).multiply(qz)
  let qy_unit = @math3d.Vector3::new(0.0, 1.0, 0.0)
  match turret {
    Some(tp) =>
      tp.rotation = @math3d.Quaternion::from_axis_angle(
        qy_unit,
        @simengine.ang_diff(t.yaw, t.turret_yaw),
      )
    None => ()
  }
  match gun {
    Some(g) =>
      g.rotation = @math3d.Quaternion::from_axis_angle(
        @math3d.Vector3::new(1.0, 0.0, 0.0),
        -t.gun_pitch,
      )
    None => ()
  }
}

///|
/// 按名字找部件节点(client models.js traverse 找 'turret'/'gun' 同式)
fn find_child_named(root : @core.Object3D, name : String) -> @core.Object3D? {
  let hit : Ref[@core.Object3D?] = Ref(None)
  root.traverse(fn(o) {
    if o.name == name && hit.val is None {
      hit.val = Some(o)
    }
    true
  })
  hit.val
}

///|
/// 追逐相机(第三人称跟车)。口径对齐 client/js/main.js updateCamera 追尾分支:
///   pivot = 车位 + CFG.camera.height(4.0)
///   off   = (-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch)) × dist
///   look  = pivot + (sin(yaw), sin(-pitch), cos(yaw)) × 8
///   眼点贴地: 不低于 terrain.heightAt(眼) + 0.6
/// 在 JS 硬跟随之上加两处平滑(本文件新增):
///   1) 偏航回随: 非拖拽时 yaw 以 1-exp(-k·dt) 向车体 yaw 收敛(绕到车尾);
///   2) 眼点指数平滑: 车辆加速/换挡/转向时相机不抖。
struct ChaseCamera {
  mut yaw : Double
  mut pitch : Double
  mut dist : Double
  mut eye : @math3d.Vector3
  mut dragging : Bool
}

///|
/// 构造: yaw/pitch/dist 即时生效, 眼点取初始期望位(贴地后)
fn ChaseCamera::new(
  yaw : Double,
  pitch : Double,
  dist : Double,
  tank : @simengine.Tank,
  map : @assets.MapData,
) -> ChaseCamera {
  let cam : ChaseCamera = {
    yaw,
    pitch,
    dist,
    eye: @math3d.Vector3::new(0.0, 0.0, 0.0),
    dragging: false,
  }
  cam.eye = cam.desired_eye(tank, map)
  cam
}

///|
/// 当前期望眼点(JS 追尾分支的 camera.position 同式, 含贴地钳制)
fn ChaseCamera::desired_eye(
  self : ChaseCamera,
  tank : @simengine.Tank,
  map : @assets.MapData,
) -> @math3d.Vector3 {
  let cp = @math.cos(self.pitch)
  let ex = tank.x - @math.sin(self.yaw) * cp * self.dist
  let mut ey = tank.y + 4.0 + @math.sin(self.pitch) * self.dist
  let ez = tank.z - @math.cos(self.yaw) * cp * self.dist
  let min_y = map.height_at(ex, ez) + 0.6
  if ey < min_y {
    ey = min_y
  }
  @math3d.Vector3::new(ex, ey, ez)
}

///|
/// 每渲染帧推进(dt 实测秒): 偏航回随 + 眼点指数平滑
fn ChaseCamera::update(
  self : ChaseCamera,
  dt : Double,
  tank : @simengine.Tank,
  map : @assets.MapData,
) -> Unit {
  if !self.dragging {
    let k = 1.0 - @math.exp(-2.5 * dt)
    self.yaw = self.yaw + @simengine.ang_diff(self.yaw, tank.yaw) * k
  }
  let want = self.desired_eye(tank, map)
  let k2 = 1.0 - @math.exp(-10.0 * dt)
  self.eye = @math3d.Vector3::new(
    self.eye.x + (want.x - self.eye.x) * k2,
    self.eye.y + (want.y - self.eye.y) * k2,
    self.eye.z + (want.z - self.eye.z) * k2,
  )
}

///|
/// 相机 lookAt 目标(JS 追尾分支: pivot + (sin yaw, sin -pitch, cos yaw)×8)
fn ChaseCamera::look_target(
  self : ChaseCamera,
  tank : @simengine.Tank,
) -> @math3d.Vector3 {
  @math3d.Vector3::new(
    tank.x + @math.sin(self.yaw) * 8.0,
    tank.y + 4.0 + @math.sin(-self.pitch) * 8.0,
    tank.z + @math.cos(self.yaw) * 8.0,
  )
}

///|
/// 入口(async fn main: moon 工具链以 run_async_main 驱动 —— with_event_loop
/// 由工具链接管, 外部循环接线必须是第一句, 见 mp.mbt YueGlibLoop)。
/// GAMEAPP_MP 设定 → 联机模式(mp.mbt); 未设 → 本地演示/手动模式(原路径)。
async fn main {
  @async.set_external_event_loop({ polls: 0, dispatched: 0 })
  match mp_addr() {
    Some(addr) =>
      mp_main(addr) catch {
        e => logln("MP 致命错误: \{e}")
      }
    None =>
      local_main() catch {
        e => logln("本地模式致命错误: \{e}")
      }
  }
  // 优雅收束已回: 断开全部视图信号(yue_mbt_quit 的析构防崩清理)后返回
  @yue.quit()
  logln("退出")
}

///|
/// 本地模式(单机 PVE 演示/手动): 原 fn main 主体, 退出路径从 @yue.quit()
/// 改为 gate 闸(GLib 外部循环下没有 yue::run 可退, 保活协程看闸收束)
async fn local_main() -> Unit {
  // 未设 GAMEAPP_FRAMES 默认 1_000_000 帧(≈4.6h, 手动玩语义: 玩家关窗/
  // Ctrl-C 退); 验收/冒烟脚本一律显式设帧数(30/600 等), 不受影响
  let total_frames = env_frames_or(1000000)
  let demo = env_demo()
  let mouselock = env_mouselock() && !demo // 自动演示不吞鼠标
  // 退出闸: 帧满/窗口关/渲染失败置位; 保活协程(尾部)据此收束事件循环
  let gate = Ref(false)
  // FPS 式指针锁定(GAMEAPP_MOUSELOCK=1): 机制在 three-native input
  // PointerLock(GDK display 上 XGrabPointer+隐形光标+回中差分); 策略
  // 在此 —— 点击进锁定 / 锁定中鼠标直接转视角+LMB 开火 / ESC 先解锁 /
  // 失焦自动释放。attach 需窗口 XID, 延到 post_task 取到句柄后做。
  let pl : Ref[@input.PointerLock?] = Ref(None)
  let lock_engaged = Ref(false)
  let lock_moves = Ref(0) // 锁定期增量日志限流(前 3 条,验收取证用)
  let lock_diag = Ref(false) // 焦点链诊断一次性标志(每次进锁打 1 条)
  let lock_suppress = Ref(false) // ESC 解锁后抑制自动锁, 失焦重新武装
  let lock_focus_streak = Ref(0) // 连续聚焦 tick 数(自动锁的迟滞确认)
  let lock_request = Ref(false) // 锁定请求(点击或激活触发, tick 内兑现)
  let lock_grab_fails = Ref(0) // 兑现期连续失败计数(限流日志)
  fn release_lock(reason : String) -> Unit {
    match pl.val {
      Some(lock) => {
        lock.release()
        lock_engaged.val = false
        logln("鼠标解锁(\{reason})")
      }
      None => ()
    }
  }
  fn request_quit(reason : String) -> Unit {
    if !gate.val {
      gate.val = true
      logln("本地模式请求退出: \{reason}")
      // 退出前若仍锁定, 还原指针(机制幂等)
      match pl.val {
        Some(lock) => {
          lock.release()
          lock_engaged.val = false
        }
        None => ()
      }
      // 兜底: 保活协程理论上 100ms 内收束, 卡死则 2.5s 硬退
      ignore(
        @yue.set_timeout(2500, fn() {
          logln("本地模式兜底硬退出(优雅收束未达)")
          mp_exit(0)
        }),
      )
    }
  }
  logln(
    "---- gameapp 启动: GAMEAPP_FRAMES=\{total_frames} GAMEAPP_DEMO=\{demo} GAMEAPP_MOUSELOCK=\{mouselock} ----",
  )
  // ---- 地图: map.json + 16 位高程 PNG(assets.load_map 的同步版:
  //      先解析 terrain 段拿 resolution/maxHeight, 再解码高程) ----
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
  let root : Json = @json.parse(text)
  let terrain_obj = match root {
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
    "地图 \{map.name}: 高程 \{res}²(maxH \{max_height}), 地形 \{map.terrain.size}m, spawns \{map.spawns.length()}, covers \{map.covers.length()}, waves \{map.wave_count}",
  )
  let lit = lighting_of(map.raw)
  // ---- 草地贴图(Repeat 平铺, 世界坐标 UV 由 heightfield 生成) ----
  let grass = @loaders.load_texture_jpeg_bytes(
    read_asset("assets/textures/grass.jpg"),
  ) catch {
    e => {
      logln("草地贴图解码失败 \{e}")
      return
    }
  }
  grass.wrap_s = @core.Wrapping::Repeat
  grass.wrap_t = @core.Wrapping::Repeat
  grass.anisotropy = 8
  // ---- 场景: 天色/雾(map.json; 无着色器天空穹, 以 skyBottom 作背景色融雾) ----
  let scene = @core.Scene::new()
  scene.background = Some(lit.sky_bottom)
  scene.fog = Some(@core.Fog::exp2(lit.fog_color, lit.fog_density))
  // 地形: 全分辨率网格(res² 顶点, 同 client PlaneGeometry(res-1)² 口径)
  let size = map.terrain.size
  let terrain_geo = @core.BufferGeometry::heightfield(
    size,
    size,
    res - 1,
    res - 1,
    fn(i, j) { map.heights[j * res + i] },
    size / 150.0, // client tex.repeat=150 → 世界 150 次平铺
  )
  terrain_geo.set_colors(terrain_vertex_colors(map))
  let terrain_mat = @core.Material::lambert(
    @math3d.Color::white(),
    @math3d.Color::black(),
  )
  terrain_mat.map = Some(grass)
  terrain_mat.vertex_colors = true
  // Mesh::new 默认 cast/receive_shadow=true(core/mesh.mbt:24-26), 地形直接受影
  let terrain = @core.Mesh::new(terrain_geo, terrain_mat)
  scene.add(terrain)
  logln(
    "地形: \{terrain_geo.vertex_count()} 顶点 / \{terrain_geo.index_count() / 3} 三角",
  )
  // ---- 坦克按 spawn 摆放 ----
  // 玩家: 车库默认 selTank='sherman'(client/js/garage.js:9), 出生取 spawns 池
  // 第 0 组(client 每局随机; 演示模式取离首个敌人最近的出生点, 确定性可复现)
  // 本车同时建 sim 状态(simengine.Tank), 由固定步长 tick 驱动并回写渲染节点
  let enemy_list = enemy_placements_of(map.raw)
  // 演示模式导演位: 沿"离敌最近出生点 → 首敌"方向收到 120m 处落位, 保证
  // 接战距离在弹道/命中手感的甜点区(实测 174m 起步直线被地形卡住到不了位)
  let sp : @assets.SpawnPoint = if demo && enemy_list.length() > 0 {
    let e0 = enemy_list[0]
    let mut best = map.spawns[0]
    let mut best_d = 1.0e18
    for s in map.spawns {
      let d = @math.hypot(s.x - e0.x, s.z - e0.z)
      if d < best_d {
        best_d = d
        best = s
      }
    }
    let vx = best.x - e0.x
    let vz = best.z - e0.z
    let vl = 1.0.max(@math.hypot(vx, vz))
    let px = @simengine.clamp(e0.x + vx / vl * 120.0, -480.0, 480.0)
    let pz = @simengine.clamp(e0.z + vz / vl * 120.0, -480.0, 480.0)
    let pyaw = @math.atan2(e0.x - px, e0.z - pz)
    logln(
      "DEMO 导演位: (\{px}, \{pz}) 朝敌 yaw=\{pyaw}(首敌 (\{e0.x}, \{e0.z}) 距 \{@math.hypot(e0.x - px, e0.z - pz)}m)",
    )
    { x: px, z: pz, yaw: pyaw, }
  } else {
    map.spawns[0]
  }
  let player_root = place_tank(scene, map, {
    typ: "sherman",
    x: sp.x,
    z: sp.z,
    yaw: sp.yaw,
    label: "player",
  })
  let turret = find_child_named(player_root, "turret")
  let gun = find_child_named(player_root, "gun")
  logln("本车部件: turret=\{turret is Some(_)} gun=\{gun is Some(_)}")
  let player = mk_sim_tank("sherman", sp.x, sp.z, sp.yaw, 0, true)
  // 敌人: waves[].enemies[](type/pos/yaw 全按 map.json; 各建 sim 状态供
  // 弹场命中判定/还击, 渲染节点同由 sim tick 驱动)
  let combatants : Array[Combatant] = []
  combatants.push({ t: player, root: player_root, turret, gun, smoke_t: 0.0, })
  for p in enemy_list {
    let root = place_tank(scene, map, p)
    let et = mk_sim_tank(p.typ, p.x, p.z, p.yaw, 1, false)
    combatants.push({
      t: et,
      root,
      turret: find_child_named(root, "turret"),
      gun: find_child_named(root, "gun"),
      smoke_t: 0.0,
    })
  }
  let sim_tanks : Array[@simengine.Tank] = []
  for w in combatants {
    sim_tanks.push(w.t)
  }
  logln(
    "战斗单位: \{combatants.length()} 辆(玩家 sherman + 敌方 \{combatants.length() - 1})",
  )
  // ---- sim 世界: 地形(Float 高程)+ 掩体(本车行驶的坡度/碰撞口径) ----
  let (sim_terrain, sim_covers) = sim_world_of(map)
  let sim_time = Ref(0.0)
  // ---- 战斗闭环: 部位盒表 + 音频 + 弹场/裁判/特效(战斗闭环.mbt) ----
  // 弹道/散布/装填等全局随机流固定种子(demo 可复现)
  @simengine.set_rng(42)
  let partboxes : Map[String, @simengine.PartBoxEntry]? = match
    read_partboxes_text() {
    Some(text) => {
      let pb = partbox_entries_of(@assets.parse_partboxes(text))
      logln(
        "partboxes: \{pb.length()} 车型部位表(命中判定弹-车精确 OBB)",
      )
      Some(pb)
    }
    None => {
      logln(
        "partboxes.json 未找到 → 弹-车判定走 simengine 兜底三盒",
      )
      None
    }
  }
  let audio = @audio.Audio::new(root="../client/assets")
  match audio.open() {
    Ok(_) => logln("音频设备已打开(战斗音效链路在位)")
    Err(e) =>
      logln(
        "音频设备打开失败(静音继续, 不阻断战斗闭环): \{e.message()}",
      )
  }
  let combat = combat_new(scene, combatants, 0, audio, partboxes)
  // ---- HUD 自渲染(D1: 同一 wgpu surface, 相机锁定屏幕层) ----
  // 字体/图集失败降级为无 HUD(不阻断战斗闭环); 击毁事件接播报
  let hud : @hud.Hud? = try {
    let h = build_hud(scene)
    combat.on_kill = Some(fn(killer, victim, ally) {
      h.push_kill(killer, victim, ally, sim_time.val)
    })
    Some(h)
  } catch {
    e => {
      logln("HUD 不可用(降级继续): \{e}")
      None
    }
  }
  // 每 tick 新建 env(golden-trace env() 同式); emit 接战斗事件出口
  let make_env = fn() -> @simengine.Env {
    {
      terrain: sim_terrain,
      covers_list: sim_covers,
      tanks: sim_tanks,
      time: sim_time.val,
      emit: fn(kind : String, ev : @simengine.EventData) {
        combat_emit(combat, kind, ev)
      },
      on_moved: None,
      take_ram: None,
    }
  }
  let shell_env = shell_env_of(sim_terrain, sim_covers, sim_tanks, player, 0)
  let dt_sim : Double = 1.0 / 60.0 // client/js/config.js sim.dt(固定模拟步长)
  // ---- 光照: 方向光(开阴影, 随 map.json sunDir)+ 半球光(client L 口径,
  //      地色 #39412e 与 main.js:258 同值) ----
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
  logln(
    "光照: sun \{lit.sun_intensity} dir(\{lit.sun_dir.x},\{lit.sun_dir.y},\{lit.sun_dir.z}) 雾 exp2 \{lit.fog_density}",
  )
  // ---- 相机: ChaseCamera 追车视角(client updateCamera 追尾分支口径) ----
  let camera = @core.PerspectiveCamera::new(55.0, 800.0 / 600.0, 0.3, 2200.0)
  let cam = ChaseCamera::new(player.yaw, 0.30, 15.0, player, map) // pitch/dist = CFG.camera.pitch/dist
  camera.obj.position = cam.eye
  camera.look_at(cam.eye, cam.look_target(player))
  scene.update_matrix_world()
  // ---- 输入: three-native input 抽象(InputState 聚合) + yue Window 级事件源
  //      (X11 泵在 GTK 宿主进程内被进程级因素阻断, 见 moon.pkg 头注;
  //       kev.code 是 VKEY 键码, 字母段 0x41..0x5A 与 keysym_to_keycode 的
  //       'A'..'Z' 分支重合, A9 验收实录本机 xdotool 发键可达) ----
  let state = @input.InputState::new()
  // 左键拖拽自由视角(差分按 root 坐标, 双挂 host/window 的 move 幂等)
  // (FPS 锁定态不走此路:core grab 抑制宿主 XI2 投递, 差分/按钮改由
  //  tick 轮询 XQueryPointer 驱动, 见 set_timer ⓪ 块)
  let drag_x = Ref(0.0)
  let drag_y = Ref(0.0)
  let lock_btn1 = Ref(false) // 轮询按钮边沿态(按住=开火)
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
  // ---- 窗口 ----
  if !@yue.initialize() {
    logln("yue init 失败")
    return
  }
  @wgpu_mbt.require_native()
  let window = @yue.Window::new()
  window.set_title("steel-front — gameapp 场景装配")
  let host = @yue.Container::new()
  host.set_background_color("#222222")
  window.set_content(host)
  window.on_close(fn(_w) { request_quit("窗口关闭") })
  window.set_content_size(800.0, 600.0)
  window.activate()
  window.on_key_down(fn(kev) {
    let k = @input.keysym_to_keycode(kev.code.to_uint64())
    // 锁定态 ESC 只解锁(常规端游铁律:ESC 先还光标再谈退出)
    if k is Esc && lock_engaged.val {
      release_lock("ESC")
      lock_suppress.val = true // 尊重解锁意图, 不再自动锁(下次失焦重武装)
      if lock_btn1.val {
        state.apply(@input.InputEvent::mouse_up(@input.MouseButton::from_yue(1), 0.0, 0.0))
        lock_btn1.val = false
      }
      return false
    }
    state.apply(@input.InputEvent::key_down(k))
    logln("KEY down \{k.label()} (VKEY=\{kev.code})")
    false
  })
  window.on_key_up(fn(kev) {
    let k = @input.keysym_to_keycode(kev.code.to_uint64())
    state.apply(@input.InputEvent::key_up(k))
    logln("KEY up \{k.label()}")
    false
  })
  window.on_mouse_down(fn(me) {
    // FPS 锁定模式: 首次点击=进锁定(不当作开火/拖拽); 锁定中 LMB=开火
    // (state 走 fire 路径), 但不启动相机拖拽
    if mouselock && me.button == 1 {
      match pl.val {
        Some(lock) => {
          if !lock_engaged.val {
            // 只立请求, 抓捕由 tick 兑现(press 瞬间的隐式抓捕会顶掉
            // 同步 XGrabPointer, 按钮一松 tick 就能成功)
            lock_request.val = true
            lock_suppress.val = false
            lock_focus_streak.val = 0 // 防 3 tick 阈值立即自动触发歧义
            return false
          }
          state.apply(
            @input.InputEvent::mouse_down(
              @input.MouseButton::from_yue(me.button),
              me.screen_x,
              me.screen_y,
            ),
          )
          return false
        }
        None => ()
      }
    }
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
      logln("MOUSE drag 起拍 @(\{me.screen_x},\{me.screen_y})")
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
    // yue d ≈ ±1/格; CFG.camera minDist/maxDist = 6.5/30
    let mut nd = cam.dist + d * 1.2
    if nd < 6.5 {
      nd = 6.5
    }
    if nd > 30.0 {
      nd = 30.0
    }
    cam.dist = nd
    logln("WHEEL d=\{d} → dist=\{cam.dist}")
  })
  let xid_hex = Ref("")
  // 截图帧: 默认总帧 2/3; 战斗里出现首个击毁事件时改到事件后 6 帧(爆炸
  // 闪光 0.08s≈5 帧 + 烟/火星仍在), 保证验收截图里 tracer/爆炸至少其一可见
  let shot_frame = Ref(total_frames * 2 / 3)
  let shot_stage = Ref(0) // 0=未调 1=玩家命中占位 2=击毁爆炸(优先)
  @yue.post_task(fn() {
    let widget = @yue.native_handle_view(host.view)
    let gdkwin = ffi_gtk_widget_get_window(widget)
    let xid = ffi_gdk_x11_window_get_xid(gdkwin)
    let xdisplay = ffi_gdk_x11_display_get_xdisplay(
      ffi_gdk_window_get_display(gdkwin),
    )
    xid_hex.val = u32_hex(xid)
    logln("窗口 xid=\{xid_hex.val}, 截图帧 \{shot_frame}")
    // 指针锁定机制绑定: 与 from_xlib 同源的 GDK xdisplay/xid(主线程内
    // 命令型调用, 不碰事件流; 见 input/pointer_lock.mbt 头注)
    if mouselock {
      let b0 = host.get_bounds()
      pl.val = @input.PointerLock::attach(
        xdisplay,
        xid,
        b0.width.to_int(),
        b0.height.to_int(),
      )
      match pl.val {
        Some(_) => logln("PointerLock 就绪(点击画面进入锁定)")
        None => logln("PointerLock 不可用(X11 缺失/参数无效), 锁定模式降级关闭")
      }
    }
    let renderer = @renderers.WebGPURenderer::from_xlib(
      xdisplay,
      xid.to_uint64(),
      800U,
      600U,
    ) catch {
      e => {
        logln("渲染器建立失败 \{e}")
        request_quit("渲染器建立失败")
        return
      }
    }
    host.on_size_changed(fn() {
      let b = host.get_bounds()
      renderer.resize(b.width.to_uint(), b.height.to_uint())
      match pl.val {
        Some(lock) => lock.update_size(b.width.to_int(), b.height.to_int())
        None => ()
      }
    })
    logln(
      "渲染器就绪, 追车视角启动(本车出生 (\{player.x}, \{player.z}) yaw=\{player.yaw})",
    )
    match hud {
      Some(h) => h.attach_renderer(renderer)
      None => ()
    }
    let frame = Ref(0)
    let acc = Ref(0.0) // 固定步长累加器(JS tick 同式)
    let last_t = Ref(mono_now())
    let sim_ticks = Ref(0)
    @yue.set_timer(16, fn() {
      frame.val = frame.val + 1
      // ⓪ FPS 锁定态驱动(核心: XQueryPointer 轮询 —— core grab 抑制
      //    宿主 XI2 投递, yue on_mouse_* 在锁定期间不响, 全靠这里):
      //    窗口激活自动锁定(连续 3 tick 确认, ESC 后抑制到下次失焦) +
      //    失焦巡检 + 指针差分转视角 + 回中 + 左键边沿开火
      if mouselock {
        match pl.val {
          Some(lock) => {
            if !lock.focused() {
              lock_focus_streak.val = 0
              // 失焦即重新武装(下次激活自动锁) —— 无论失焦时是否处于
              // 锁定态: ESC 解锁后抑制, 切走再切回要能重新自动锁
              lock_suppress.val = false
              lock_request.val = false
              lock_grab_fails.val = 0
              if lock_engaged.val {
                release_lock("失焦自动释放")
                if lock_btn1.val {
                  state.apply(
                    @input.InputEvent::mouse_up(
                      @input.MouseButton::from_yue(1),
                      0.0,
                      0.0,
                    ),
                  )
                  lock_btn1.val = false
                }
              }
            } else {
              lock_focus_streak.val = lock_focus_streak.val + 1
              // 激活即锁(用户口径): ESC 解锁的抑制期内不自动锁, 点击仍可
              if !lock_engaged.val &&
                !lock_suppress.val &&
                lock_focus_streak.val >= 3 {
                lock_request.val = true
              }
              // 兑现锁定请求: 抓捕失败多为瞬态(按钮按住的隐式抓捕=
              // AlreadyGrabbed / 切换动画中=NotViewable), 约 2s(120 tick)
              // 内持续重试, 失败不永久抑制(松键/动画结束自然成功)
              if !lock_engaged.val &&
                lock_request.val &&
                lock_focus_streak.val <= 120 {
                if lock.acquire() {
                  lock_engaged.val = true
                  lock_diag.val = false
                  lock_request.val = false
                  lock_grab_fails.val = 0
                  logln(
                    "鼠标锁定(\{if lock_focus_streak.val >= 3 { "窗口激活" } else { "点击" }}; 移动=视角, LMB=开火, ESC=解锁, 失焦自动释放)",
                  )
                } else {
                  lock_grab_fails.val = lock_grab_fails.val + 1
                  if lock_grab_fails.val == 20 {
                    logln(
                      "锁定抓捕连续失败 x20, 最近错误码 \{lock.last_grab_status()}(1=他人抓捕中 3=窗口未显示); 继续重试中",
                    )
                  }
                }
              }
            }
            if lock_engaged.val {
            if !lock_diag.val {
              lock_diag.val = true
              logln("锁定焦点链诊断: \{lock.debug_focus_chain()}")
            }
            {
              let (dx, dy, btn1) = lock.poll()
              if dx != 0.0 || dy != 0.0 {
                cam.yaw = cam.yaw - dx * 0.005
                let mut np = cam.pitch + dy * 0.005
                if np < -0.12 {
                  np = -0.12
                }
                if np > 1.1 {
                  np = 1.1
                }
                cam.pitch = np
                lock.recentre()
                lock_moves.val = lock_moves.val + 1
                if lock_moves.val <= 3 {
                  logln(
                    "锁定视角增量 #\{lock_moves.val}: dx=\{dx} dy=\{dy} → yaw=\{cam.yaw}",
                  )
                }
              }
              // 左键边沿:grab 期间 yue 不投递 button 事件, 轮询补
              if btn1 && !lock_btn1.val {
                lock_btn1.val = true
                state.apply(
                  @input.InputEvent::mouse_down(
                    @input.MouseButton::from_yue(1),
                    0.0,
                    0.0,
                  ),
                )
              }
              if !btn1 && lock_btn1.val {
                lock_btn1.val = false
                state.apply(@input.InputEvent::mouse_up(@input.MouseButton::from_yue(1), 0.0, 0.0))
              }
            }
            }
          }
          None => ()
        }
      }
      // ① 实测帧间 dt(钳 [0, 0.1], JS tick 的 min(0.1, ...) 同式)
      let now = mono_now()
      let mut dt_real = now - last_t.val
      last_t.val = now
      if dt_real < 0.0 {
        dt_real = 0.0
      }
      if dt_real > 0.1 {
        dt_real = 0.1
      }
      // ② 固定步长模拟(JS tick: while (acc >= dt) { step(dt); acc -= dt })
      acc.val = acc.val + dt_real
      while acc.val >= dt_sim {
        acc.val = acc.val - dt_sim
        sim_ticks.val = sim_ticks.val + 1
        // 每车输入: 演示=自动瞄准开火(玩家打最近敌, 敌方还击); 手动=玩家
        // WASD+相机瞄准(拖拽转炮塔)+左键开火, 敌人待机(炮塔随车体, client
        // IDLE_INPUT 的 holdTurret 同语义)
        let inputs : Array[@simengine.Input] = []
        for w in combat.tanks {
          inputs.push(
            if demo {
              demo_input(combat, w)
            } else if w.t.is_player {
              manual_input(state, cam.yaw)
            } else {
              {
                throttle: 0.0,
                steer: 0.0,
                aim_yaw: w.t.yaw,
                aim_pitch: 0.0,
                fire: false,
                hold_turret: true,
              }
            },
          )
        }
        sim_time.val = sim_time.val + dt_sim
        combat_tick(combat, inputs, dt_sim, make_env(), shell_env)
      }
      // ③ sim 状态 → 渲染节点(全部战斗单位, vehicle.js _syncNode 直译)
      for w in combat.tanks {
        sync_tank_node(w.root, w.turret, w.gun, w.t)
      }
      // ④ 追逐相机平滑跟随 + 特效步进 + 渲染
      wreck_smoke(combat, dt_real)
      cam.update(dt_real, player, map)
      camera.obj.position = cam.eye
      camera.look_at(cam.eye, cam.look_target(player))
      // ④'' HUD 刷新(根对齐相机 + 血条/装填/播报; 渲染前, 相机位姿就位后)
      match hud {
        Some(h) =>
          h.update(
            camera,
            player.hp,
            player.spec.hp,
            player.reload_t,
            player.reload_total,
            player.spec.gun_pen.to_int(),
            "SHERMAN",
            sim_time.val,
          )
        None => ()
      }
      let (bb_r, bb_u) = @core.billboard_axes_of(camera)
      combat.fx.update(dt_real, bb_r, bb_u)
      scene.update_matrix_world()
      renderer.render(scene, camera) catch {
        e => {
          logln("渲染失败 \{e}")
          request_quit("渲染失败")
          return false
        }
      }
      // ④' 取证调度: 玩家首发命中(弹着火花)先占位, 首个击毁(爆炸)出现则
      // 覆写到爆炸后 6 帧(闪光 0.08s≈5 帧, 烟/火星仍在) —— 爆炸画面优先
      if combat.destroy_count > 0 && shot_stage.val < 2 {
        shot_stage.val = 2
        let f2 = frame.val + 6
        if f2 < total_frames {
          shot_frame.val = f2
          logln("首个击毁事件已见 → 截图帧改 \{shot_frame.val}")
        }
      } else if shot_stage.val < 1 && combat.player_hit_count > 0 {
        shot_stage.val = 1
        let f2 = frame.val + 6
        if f2 < total_frames {
          shot_frame.val = f2
          logln("首个玩家命中已见 → 截图帧 \{shot_frame.val}")
        }
      }
      // ⑤ 取证: 每 60 sim tick 一行状态(位移/速度/弹场/击毁数)
      if sim_ticks.val % 60 == 0 && frame.val > 2 {
        logln(
          "SIM t=\{sim_time.val} x=\{player.x} z=\{player.z} yaw=\{player.yaw} spd=\{player.speed} gear=\{player.gear} hp=\{player.hp} | 弹场 active=\{combat.shells.list.length()} tracers=\{combat.tracers.length()} 击毁=\{combat.destroy_count} 拖尾失配=\{combat.tracer_misses}",
        )
      }
      if frame.val == shot_frame.val {
        // 约定截图: 抓窗(按 xid 抓取即裁窗)+ 窗几何 + 全屏底(兜底)
        ignore(
          c_system(
            nul(
              "import -window \{xid_hex.val} /tmp/gameapp_scene.png 2>/tmp/gameapp_import.err",
            ),
          ),
        )
        ignore(
          c_system(
            nul(
              "xwininfo -id \{xid_hex.val} -stats > /tmp/gameapp_xwin.txt 2>&1",
            ),
          ),
        )
        ignore(
          c_system(
            nul(
              "import -window root /tmp/gameapp_scene_root.png 2>>/tmp/gameapp_import.err",
            ),
          ),
        )
        logln(
          "截图帧 \{frame.val}: import -window \{xid_hex.val} → /tmp/gameapp_scene.png",
        )
      }
      if frame.val >= total_frames {
        logln(
          "\{total_frames} 帧跑满, 自然退出(sim ticks=\{sim_ticks.val}, 末位 x=\{player.x} z=\{player.z} spd=\{player.speed})",
        )
        request_quit("帧跑满")
        return false
      }
      true
    })
  })
  // 消息循环: GLib 外部循环驱动(async fn main 顶已接线) —— 渲染帧定时器
  // 在 poll 内分派, 保活协程看 gate 闸, 退出即收束 with_event_loop
  @async.with_task_group(group => {
    group.spawn_bg() <| () => {
      while !gate.val {
        @async.sleep(100)
      }
    }
  })
}
