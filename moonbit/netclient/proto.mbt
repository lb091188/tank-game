// proto.mbt — 线协议: 出线编码(net.js createRoom/joinRoom/setReady/setTeam/
// setMode/startMatch/startInputLoop 的 JSON 形状)+ 回包解析(lobby.js bindMsgs
// 消费的消息面 + net.js interpolate 消费的 snap 面)。字段名/版本门禁与
// server/server.js:398-565 逐条对照。

///|
/// 快照单行 14 字段(net.js:96-97 行布局): x,z,y,yaw,tur,pitch,speed,hp,alive,
/// reloadT,reloadTotal,clipLeft,bodyPitch,bodyRoll —— srv-sim.js snapshot 同构
pub(all) struct SnapRow {
  pub x : Double
  pub z : Double
  pub y : Double
  pub yaw : Double
  pub tur : Double
  pub pitch : Double
  pub speed : Double
  pub hp : Double
  pub alive : Bool
  pub reload_t : Double
  pub reload_total : Double
  pub clip_left : Int
  pub body_pitch : Double
  pub body_roll : Double
}

///|
/// 房间名单行(server.js roomState: {id,name,tank,ready,host,team,connected})
pub(all) struct PlayerRow {
  pub id : Int
  pub name : String
  pub tank : String
  pub ready : Bool
  pub host : Bool
  pub team : Int
  pub connected : Bool
}

///|
/// 对战事件(server.js KNOWN 白名单: fire/hit/kill/aiWave/pkGet)
pub(all) struct EvData {
  pub kind : String
  pub shooter : Int
  pub target : Int
  pub hit_kind : String
  pub dmg : Int
  pub point : (Double, Double, Double)
}

///|
/// 服务器回包(解析产物; Snap 单列给插值缓冲, 其余进事件面; 构造子参数顺序
/// = 各字段注释: Joined(room,you,players,mode) / Start(map,mode,seed,players,srvSim) /
/// Snap(st,tn,sc) / End(scores) / Err(msg) / Lobby(players))
pub(all) enum ServerMsg {
  Joined(String, Int, Array[PlayerRow], String)
  Lobby(Array[PlayerRow])
  Err(String)
  Start(String, String, Int, Array[PlayerRow], Bool)
  Snap(Int, Map[Int, SnapRow], Map[Int, Int])
  Ev(EvData)
  End(Array[(Int, String, Int)])
  Left
}

///|
/// JSON 字符串转义(名字/房间号等用户输入出线; 名字限 12 字但仍防引号/反斜杠)
fn json_escape(s : String) -> String {
  let sb = StringBuilder::new()
  for ch in s {
    match ch {
      '"' => sb.write_string("\\\"")
      '\\' => sb.write_string("\\\\")
      '\n' => sb.write_string("\\n")
      '\r' => sb.write_string("\\r")
      '\t' => sb.write_string("\\t")
      c =>
        if c.to_int() < 0x20 {
          sb.write_string("\\u\{c.to_int().to_string()}")
        } else {
          ignore(sb.write_char(c))
        }
    }
  }
  sb.to_string()
}

///|
/// 数值出线格式: 四舍五入到 prec 位再输出(等价 JS +x.toFixed(n) 后的
/// JSON.stringify —— 整数不带小数点, 其余最短表示)
pub fn fmt_num(v : Double, prec : Int) -> String {
  let p = @math.pow(10.0, prec.to_double())
  let r = (v * p).round() / p
  if r == r.floor() && r.abs() < 1.0e15 {
    r.to_int64().to_string()
  } else {
    r.to_string()
  }
}

///|
/// 建房(net.js:66 createRoom; proto:3 = 快照 14 字段版本门禁, server.js:401)
pub fn encode_create(name : String, tank : String, pass : String) -> String {
  "{\"t\":\"create\",\"name\":\"\{json_escape(name)}\",\"tank\":\"\{json_escape(tank)}\"\{pass_part(pass)},\"proto\":3}"
}

///|
/// 进房(net.js:67 joinRoom)
pub fn encode_join(
  room : String,
  pass : String,
  name : String,
  tank : String,
) -> String {
  "{\"t\":\"join\",\"room\":\"\{json_escape(room)}\"\{pass_part(pass)},\"name\":\"\{json_escape(name)}\",\"tank\":\"\{json_escape(tank)}\",\"proto\":3}"
}

///|
/// 可选密码段(空串=不带字段, 与 net.js pass: pass || undefined 同语义)
fn pass_part(pass : String) -> String {
  if pass == "" {
    ""
  } else {
    ",\"pass\":\"\{json_escape(pass)}\""
  }
}

///|
/// 准备/换车(net.js:78 setReady)
pub fn encode_ready(v : Bool, tank : String) -> String {
  "{\"t\":\"ready\",\"v\":\{if v { "true" } else { "false" }},\"tank\":\"\{json_escape(tank)}\"}"
}

///|
/// 选阵营(net.js:80 setTeam; 0=红 1=蓝)
pub fn encode_team(v : Int) -> String {
  "{\"t\":\"team\",\"v\":\{if v == 1 { 1 } else { 0 }}}"
}

///|
/// 切模式(net.js:79 setMode; 仅房主)
pub fn encode_mode(mode : String) -> String {
  "{\"t\":\"mode\",\"mode\":\"\{json_escape(mode)}\"}"
}

///|
/// 开战(net.js:82 startMatch; 仅房主)
pub fn encode_start(map : String, mode : String) -> String {
  "{\"t\":\"start\",\"map\":\"\{json_escape(map)}\",\"mode\":\"\{json_escape(mode)}\"}"
}

///|
/// 离房(net.js:81 leave)
pub fn encode_leave() -> String {
  "{\"t\":\"leave\"}"
}

///|
/// 本地输入上行(net.js:90: i=[throttle,steer,aimYaw,aimPitch,fire] 5 元组,
/// 30Hz; id=服务器分配的 myId)
pub fn encode_input(id : Int, throttle : Double, steer : Double, aim_yaw : Double, aim_pitch : Double, fire : Bool) -> String {
  "{\"t\":\"input\",\"id\":\{id},\"i\":[\{fmt_num(throttle, 2)},\{fmt_num(steer, 2)},\{fmt_num(aim_yaw, 3)},\{fmt_num(aim_pitch, 3)},\{if fire { 1 } else { 0 }}]}"
}

///|
/// JSON 对象字符串字段(String 型; 缺键/类型不符 → None)
fn jstr(obj : Map[String, Json], key : String) -> String? {
  match obj.get(key) {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
}

///|
/// JSON 整数字段(饱和转换; 缺键 → 默认值。Double::to_int 是数值转换,
/// reinterpret_as_int64 是按位重解释 —— 勿混)
fn jint(obj : Map[String, Json], key : String, def : Int) -> Int {
  match obj.get(key) {
    Some(Json::Number(v, ..)) => v.to_int()
    _ => def
  }
}

///|
/// JSON 布尔字段(缺键 → 默认值; 容忍 1/0 数值形式)
fn jbool(obj : Map[String, Json], key : String, def : Bool) -> Bool {
  match obj.get(key) {
    Some(Json::True) => true
    Some(Json::False) => false
    Some(Json::Number(v, ..)) => v != 0.0
    _ => def
  }
}

///|
/// 名单行解析(server.js roomState → lobby.js joined/lobby/start 消费)
fn parse_player(o : Map[String, Json]) -> PlayerRow? {
  let name = match jstr(o, "name") {
    Some(n) => n
    None => return None
  }
  Some({
    id: jint(o, "id", 0),
    name,
    tank: jstr(o, "tank").unwrap_or("sherman"),
    ready: jbool(o, "ready", false),
    host: jbool(o, "host", false),
    team: jint(o, "team", 0),
    connected: jbool(o, "connected", true),
  })
}

///|
/// 名单数组解析(容忍缺字段项跳过)
fn parse_players(raw : Json?) -> Array[PlayerRow] {
  let out : Array[PlayerRow] = []
  match raw {
    Some(Json::Array(arr)) =>
      for it in arr {
        match it {
          Json::Object(o) =>
            match parse_player(o) {
              Some(p) => out.push(p)
              None => ()
            }
          _ => ()
        }
      }
    _ => ()
  }
  out
}

///|
/// 快照行解析(net.js:96 14 字段布局; 旧 12 字段行 bodyPitch/bodyRoll 补 0)
fn parse_snap_row(arr : Array[Json]) -> SnapRow? {
  if arr.length() < 12 {
    return None
  }
  let num = fn(i : Int, def : Double) -> Double {
    if i >= arr.length() {
      return def // 旧 12 字段行没有 12/13 位(bodyPitch/bodyRoll), 补 0
    }
    match arr[i] {
      Json::Number(v, ..) => v
      _ => def
    }
  }
  Some({
    x: num(0, 0.0),
    z: num(1, 0.0),
    y: num(2, 0.0),
    yaw: num(3, 0.0),
    tur: num(4, 0.0),
    pitch: num(5, 0.0),
    speed: num(6, 0.0),
    hp: num(7, 0.0),
    alive: num(8, 0.0) != 0.0,
    reload_t: num(9, 0.0),
    reload_total: num(10, 0.0),
    clip_left: num(11, 0.0).to_int(),
    body_pitch: num(12, 0.0),
    body_roll: num(13, 0.0),
  })
}

///|
/// 名单/快照行键(tank id)字符串 → 非负整数(服务器 id 恒为正整数键; 非 digit 返 -1)
fn parse_id(s : String) -> Int {
  let mut n = 0
  for ch in s {
    if ch >= '0' && ch <= '9' {
      n = n * 10 + (ch.to_int() - 48)
    } else {
      return -1
    }
  }
  n
}

///|
/// 快照消息解析: {t:'snap', st, tn:{id:[14]}, sc:{id:k}}(coop 追加 wv/dt/rp/pk
/// 字段此处不消费, dm 路径足够; 引擎快照行见 srv-sim.js:517-540)
fn parse_snap(obj : Map[String, Json]) -> ServerMsg? {
  let tn : Map[Int, SnapRow] = Map([], capacity=16)
  match obj.get("tn") {
    Some(Json::Object(rows)) =>
      for id, row in rows {
        match row {
          Json::Array(arr) =>
            match parse_snap_row(arr) {
              Some(r) => tn[parse_id(id)] = r
              None => ()
            }
          _ => ()
        }
      }
    _ => ()
  }
  let sc : Map[Int, Int] = Map([], capacity=8)
  match obj.get("sc") {
    Some(Json::Object(rows)) =>
      for id, k in rows {
        match k {
          Json::Number(v, ..) => sc[parse_id(id)] = v.to_int()
          _ => ()
        }
      }
    _ => ()
  }
  Some(Snap(jint(obj, "st", 0), tn, sc))
}

///|
/// 事件消息解析: {t:'ev', k, d}(server.js onEvent → 线协议形状; fire 是
/// {id, p:[x,y,z]}, hit 是 {s,g,kind,dmg,module,p}, kill 是 {id,by,p})
fn parse_ev(kind : String, d : Json?) -> ServerMsg {
  let o = match d {
    Some(Json::Object(m)) => m
    _ => return Ev({ kind, shooter: 0, target: 0, hit_kind: "", dmg: 0, point: (0.0, 0.0, 0.0), })
  }
  let pt = match o.get("p") {
    Some(Json::Array(a)) =>
      if a.length() >= 3 {
        let g = fn(i : Int) -> Double {
          match a[i] {
            Json::Number(v, ..) => v
            _ => 0.0
          }
        }
        (g(0), g(1), g(2))
      } else {
        (0.0, 0.0, 0.0)
      }
    _ => (0.0, 0.0, 0.0)
  }
  // fire 载荷键是 id(射手), hit 是 s/g, kill 是 id(被毁)/by(射手): 统一收口
  let shooter = jint(o, "by", jint(o, "s", jint(o, "id", 0)))
  let target = jint(o, "g", jint(o, "id", 0))
  Ev({
    kind,
    shooter,
    target,
    hit_kind: jstr(o, "kind").unwrap_or(""),
    dmg: jint(o, "dmg", 0),
    point: pt,
  })
}

///|
/// seed 解析: 服务器广播 uint32(server.js:498 Math.random()*4294967296)。
/// Double::to_int 对超 Int32 值是饱和不是截断 —— 先 to_int64 再截断保位样,
/// 消费侧(simcore.Mulberry32::new)再 reinterpret_as_uint 复原。
fn jseed(obj : Map[String, Json]) -> Int {
  match obj.get("seed") {
    Some(Json::Number(v, ..)) => v.to_int64().to_int()
    _ => 0
  }
}

///|
/// 服务器回包解析(全部消息面; 未识别的 t → None 由调用方计日志)
pub fn parse_server_msg(text : String) -> ServerMsg? raise {
  let root = @json.parse(text)
  let obj = match root {
    Json::Object(m) => m
    _ => return None
  }
  let t = match jstr(obj, "t") {
    Some(s) => s
    None => return None
  }
  match t {
    "joined" => Some(
      Joined(
        jstr(obj, "room").unwrap_or(""),
        jint(obj, "you", 0),
        parse_players(obj.get("players")),
        jstr(obj, "mode").unwrap_or("dm"),
      ),
    )
    "lobby" => Some(Lobby(parse_players(obj.get("players"))))
    "err" => Some(Err(jstr(obj, "msg").unwrap_or("未知错误")))
    "left" => Some(Left)
    "start" => Some(
      Start(
        jstr(obj, "map").unwrap_or("l01"),
        jstr(obj, "mode").unwrap_or("dm"),
        jseed(obj),
        parse_players(obj.get("players")),
        jbool(obj, "srvSim", false),
      ),
    )
    "snap" => parse_snap(obj)
    "ev" => Some(parse_ev(jstr(obj, "k").unwrap_or(""), obj.get("d")))
    "end" => {
      let scores : Array[(Int, String, Int)] = []
      match obj.get("scores") {
        Some(Json::Array(arr)) =>
          for row in arr {
            match row {
              Json::Array(r) =>
                if r.length() >= 3 {
                  let id = match r[0] {
                    Json::Number(v, ..) => v.to_int()
                    _ => 0
                  }
                  let name = match r[1] {
                    Json::String(s) => s
                    _ => "?"
                  }
                  let k = match r[2] {
                    Json::Number(v, ..) => v.to_int()
                    _ => 0
                  }
                  scores.push((id, name, k))
                }
              _ => ()
            }
          }
        _ => ()
      }
      Some(End(scores))
    }
    _ => None
  }
}
