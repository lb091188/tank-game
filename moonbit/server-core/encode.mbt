// encode.mbt — 上行取值 + 下行构造 (与 server.js 的 JSON 消息逐字段对齐)

///|
/// 取对象字符串字段 (类型不符/缺省 → None)
fn jstr(j : Json, key : String) -> String? {
  if j is Object(obj) {
    match obj.get(key) {
      Some(String(s)) => Some(s)
      _ => None
    }
  } else {
    None
  }
}

///|
fn jstr_or(j : Json, key : String, dft : String) -> String {
  match jstr(j, key) {
    Some(s) => s
    None => dft
  }
}

///|
/// JS 的 falsy 语义: 仅显式 true 才为 true
fn jbool(j : Json, key : String) -> Bool {
  if j is Object(obj) {
    match obj.get(key) {
      Some(True) => true
      _ => false
    }
  } else {
    false
  }
}

///|
/// JS: (m.name || '车长').slice(0, 12) —— 空串/缺省 → '车长', 再按 UTF-16 截 12
fn norm_name(j : Json) -> String {
  let n = jstr_or(j, "name", "")
  let n = if n == "" { "车长" } else { n }
  if n.length() > 12 {
    n[:12].to_owned()
  } else {
    n
  }
}

///|
/// 玩家行: {id, name, tank, ready, host, connected}
fn player_json(p : Player) -> Json {
  {
    "id": p.id,
    "name": p.name,
    "tank": p.tank,
    "ready": p.ready,
    "host": p.host,
    "connected": true,
  }
}

///|
fn players_json(room : Room) -> Json {
  let arr : Array[Json] = []
  for p in room.players.values() {
    arr.push(player_json(p))
  }
  Json::array(arr)
}

///|
/// {t:'joined', room, you, players, invite?} —— invite 仅建房时携带
fn joined_msg(room_code : String, you : Int, room : Room, invite : String?) -> String {
  let obj : Map[String, Json] = {
    "t": Json::string("joined"),
    "room": Json::string(room_code),
    "you": Json::number(you.to_double()),
    "players": players_json(room),
  }
  match invite {
    Some(inv) => obj.set("invite", Json::string(inv))
    None => ()
  }
  Json::object(obj).stringify()
}

///|
/// {t:'lobby', players}
fn lobby_msg(room : Room) -> String {
  let obj : Map[String, Json] = {
    "t": Json::string("lobby"),
    "players": players_json(room),
  }
  Json::object(obj).stringify()
}

///|
/// {t:'invite', code}
fn invite_msg(code : String) -> String {
  let obj : Map[String, Json] = {
    "t": Json::string("invite"),
    "code": Json::string(code),
  }
  Json::object(obj).stringify()
}

///|
/// {t:'err', msg}
fn err_msg(msg : String) -> String {
  let obj : Map[String, Json] = {
    "t": Json::string("err"),
    "msg": Json::string(msg),
  }
  Json::object(obj).stringify()
}

///|
/// {t:'start', map?, mode, seed, players} —— map 缺省时整个键省略 (对齐 JS stringify(undefined))
fn start_json(msg : Json, room : Room, seed : Double) -> String {
  let obj : Map[String, Json] = {
    "t": Json::string("start"),
    "mode": Json::string(jstr_or(msg, "mode", "dm")),
    "seed": Json::number(seed),
    "players": players_json(room),
  }
  match jstr(msg, "map") {
    Some(m) => obj.set("map", Json::string(m))
    None => ()
  }
  Json::object(obj).stringify()
}
