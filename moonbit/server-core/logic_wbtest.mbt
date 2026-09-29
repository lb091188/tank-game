// core_test.mbt — 房间/邀请码/路由状态机单测 (语义逐条对齐 server/server.js)

///|
fn parse_or_null(text : String) -> Json {
  try {
    @json.parse(text)
  } catch {
    _ => Json::null()
  }
}

///|
fn field_str(j : Json, key : String) -> String {
  match jstr(j, key) {
    Some(s) => s
    None => ""
  }
}

///|
fn field_num(j : Json, key : String) -> Double? {
  if j is Object(obj) {
    match obj.get(key) {
      Some(Number(n, ..)) => Some(n)
      _ => None
    }
  } else {
    None
  }
}

///|
fn has_key(j : Json, key : String) -> Bool {
  if j is Object(obj) {
    obj.contains(key)
  } else {
    false
  }
}

///|
fn players_of(j : Json) -> Array[Json] {
  if j is Object(obj) {
    match obj.get("players") {
      Some(Array(a)) => a
      _ => []
    }
  } else {
    []
  }
}

///|
fn row_bool(p : Json, key : String) -> Bool {
  if p is Object(obj) {
    match obj.get(key) {
      Some(True) => true
      _ => false
    }
  } else {
    false
  }
}

///|
fn is_digits(s : String) -> Bool {
  let mut ok = true
  for i in 0..<s.length() {
    match s.get_char(i) {
      Some(c) => if c < '0' || c > '9' { ok = false }
      None => ok = false
    }
  }
  ok
}

///|
// 邀请码必须落在 31 字符表内 (去 0O1IL)
fn in_alphabet(s : String) -> Bool {
  let alph = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  let mut ok = true
  for i in 0..<s.length() {
    let mut found = false
    match s.get_char(i) {
      Some(c) =>
        for k in 0..<alph.length() {
          match alph.get_char(k) {
            Some(a) => if a == c { found = true }
            None => ()
          }
        }
      None => ()
    }
    if !found { ok = false }
  }
  ok
}

///|
// 建房: 返回 (sid, 房间码, 首张邀请码)
fn mk_host(s : Server, name : String) -> (Int, String, String) raise {
  let sid = s.connect()
  let out = s.handle_text(sid, "{\"t\":\"create\",\"name\":\"\{name}\"}")
  inspect(out.length(), content="1")
  let j = parse_or_null(out[0].text)
  (sid, field_str(j, "room"), field_str(j, "invite"))
}

///|
// 向 host 要一张新邀请码
fn new_invite(s : Server, host : Int) -> String raise {
  let out = s.handle_text(host, "{\"t\":\"invite\"}")
  inspect(out.length(), content="1")
  field_str(parse_or_null(out[0].text), "code")
}

///|
// 用邀请码入房: 返回 (sid, 首条消息=joined 或 err)
// 成功时共 2 条投递(自己 joined + 房主 lobby), 失败时 1 条 err, 首条都是给自己的
fn mk_join(s : Server, invite : String, name : String) -> (Int, Json) raise {
  let sid = s.connect()
  let out = s.handle_text(
    sid,
    "{\"t\":\"join\",\"invite\":\"\{invite}\",\"name\":\"\{name}\"}",
  )
  inspect(out.length() >= 1, content="true")
  (sid, parse_or_null(out[0].text))
}

test "create_room_basic" {
  let s = Server::Server()
  let (_, code, invite) = mk_host(s, "张三")
  inspect(code.length(), content="4")
  inspect(is_digits(code), content="true")
  inspect(invite.length(), content="8")
  inspect(in_alphabet(invite), content="true")
  inspect(s.rooms.length(), content="1")
  // 邀请码已登记 (一次性)
  inspect(s.invites.get(invite) == Some(code), content="true")
}

test "joined_message_shape" {
  let s = Server::Server()
  let out = s.handle_text(s.connect(), "{\"t\":\"create\",\"name\":\"张三\",\"tank\":\"tiger2\"}")
  let j = parse_or_null(out[0].text)
  inspect(field_str(j, "t"), content="joined")
  inspect(field_str(j, "room"), content=field_str(j, "room")) // 房间码随机, 只验非空
  inspect(field_str(j, "room").length(), content="4")
  inspect(field_num(j, "you") == Some(1.0), content="true")
  inspect(field_str(j, "invite").length(), content="8")
  let players = players_of(j)
  inspect(players.length(), content="1")
  let p = players[0]
  inspect(field_str(p, "name"), content="张三")
  inspect(field_str(p, "tank"), content="tiger2")
  inspect(row_bool(p, "ready"), content="true")
  inspect(row_bool(p, "host"), content="true")
  inspect(row_bool(p, "connected"), content="true")
}

test "name_default_and_truncate" {
  let s = Server::Server()
  // 缺省名 → 车长; 缺省车 → sherman
  let out = s.handle_text(s.connect(), "{\"t\":\"create\"}")
  let p = players_of(parse_or_null(out[0].text))[0]
  inspect(field_str(p, "name"), content="车长")
  inspect(field_str(p, "tank"), content="sherman")
  // 超长名按 UTF-16 截 12
  let out2 = s.handle_text(
    s.connect(),
    "{\"t\":\"create\",\"name\":\"01234567890123456789\"}",
  )
  let p2 = players_of(parse_or_null(out2[0].text))[0]
  inspect(field_str(p2, "name"), content="012345678901")
}

test "join_bad_invite" {
  let s = Server::Server()
  let out = s.handle_text(
    s.connect(),
    "{\"t\":\"join\",\"invite\":\"ZZZZZZZZ\",\"name\":\"X\"}",
  )
  inspect(out.length(), content="1")
  inspect(field_str(parse_or_null(out[0].text), "msg"), content="邀请码无效或已被使用")
  // 缺 invite 字段同样无效
  let out2 = s.handle_text(s.connect(), "{\"t\":\"join\",\"name\":\"X\"}")
  inspect(field_str(parse_or_null(out2[0].text), "msg"), content="邀请码无效或已被使用")
}

test "join_lifecycle_and_invite_burn" {
  let s = Server::Server()
  let (host, code, invite) = mk_host(s, "H")
  // 正常入房: 新人拿 joined, 房主拿 lobby
  let (c1, j) = mk_join(s, invite, "C1")
  inspect(field_str(j, "t"), content="joined")
  inspect(field_str(j, "room"), content=code)
  inspect(field_num(j, "you") == Some(2.0), content="true")
  inspect(players_of(j).length(), content="2")
  ignore(c1)
  // 邀请码一次性: 复用 → 无效
  let (bad, jbad) = mk_join(s, invite, "X")
  ignore(bad)
  inspect(field_str(jbad, "t"), content="err")
  inspect(field_str(jbad, "msg"), content="邀请码无效或已被使用")
  // 小写邀请码可正常入房 (trim + 大写归一)
  let inv2 = new_invite(s, host)
  let (_, j2) = mk_join(s, inv2.to_lower(), "C2")
  inspect(field_str(j2, "t"), content="joined")
}

test "join_delivers_lobby_to_host" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let c1 = s.connect()
  let out = s.handle_text(c1, "{\"t\":\"join\",\"invite\":\"\{invite}\",\"name\":\"C1\"}")
  // 2 条: c1 的 joined + host 的 lobby
  inspect(out.length(), content="2")
  inspect(out[0].to == c1, content="true")
  inspect(field_str(parse_or_null(out[0].text), "t"), content="joined")
  inspect(out[1].to == host, content="true")
  let lobby = parse_or_null(out[1].text)
  inspect(field_str(lobby, "t"), content="lobby")
  inspect(players_of(lobby).length(), content="2")
}

test "join_blocked_when_started" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let _ = mk_join(s, invite, "C1")
  ignore(s.handle_text(host, "{\"t\":\"start\",\"map\":\"l01\",\"mode\":\"dm\"}"))
  let inv2 = new_invite(s, host)
  let (_, j) = mk_join(s, inv2, "late")
  inspect(field_str(j, "t"), content="err")
  inspect(field_str(j, "msg"), content="对战已开始")
}

test "room_full_at_8" {
  let s = Server::Server()
  let (host, _, _) = mk_host(s, "H")
  for i in 1..<8 {
    let inv = new_invite(s, host)
    let _ = mk_join(s, inv, "P\{i}")
  }
  let inv8 = new_invite(s, host)
  let (_, j) = mk_join(s, inv8, "X")
  inspect(field_str(j, "t"), content="err")
  inspect(field_str(j, "msg"), content="房间已满(8人)")
}

test "ready_broadcasts_to_all_including_self" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let (c1, _) = mk_join(s, invite, "C1")
  let out = s.handle_text(c1, "{\"t\":\"ready\",\"v\":true,\"tank\":\"tiger2\"}")
  // 广播给房内所有人 (含发送者)
  inspect(out.length(), content="2")
  for d in out {
    let lobby = parse_or_null(d.text)
    inspect(field_str(lobby, "t"), content="lobby")
    inspect(players_of(lobby).length(), content="2")
  }
  ignore(host)
  // 找到 C1 行验证状态 (顺序不定, 按名查找)
  let lobby0 = parse_or_null(out[0].text)
  let mut c1_ready = false
  let mut c1_tank = ""
  for p in players_of(lobby0) {
    if field_str(p, "name") == "C1" {
      c1_ready = row_bool(p, "ready")
      c1_tank = field_str(p, "tank")
    }
  }
  inspect(c1_ready, content="true")
  inspect(c1_tank, content="tiger2")
  // 不带 v → 按 false 处理
  let out2 = s.handle_text(c1, "{\"t\":\"ready\"}")
  inspect(out2.length(), content="2")
  let mut c1_ready2 = true
  for p in players_of(parse_or_null(out2[0].text)) {
    if field_str(p, "name") == "C1" {
      c1_ready2 = row_bool(p, "ready")
    }
  }
  inspect(c1_ready2, content="false")
}

test "start_host_only_and_shape" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let (c1, _) = mk_join(s, invite, "C1")
  // 非房主 start → 忽略
  let out_no = s.handle_text(c1, "{\"t\":\"start\",\"map\":\"l01\"}")
  inspect(out_no.length(), content="0")
  // 房主 start → 广播给所有人 (含自己)
  let out = s.handle_text(host, "{\"t\":\"start\",\"map\":\"l01\"}")
  inspect(out.length(), content="2")
  for d in out {
    let j = parse_or_null(d.text)
    inspect(field_str(j, "t"), content="start")
    inspect(field_str(j, "map"), content="l01")
    inspect(field_str(j, "mode"), content="dm") // 缺省 dm
    inspect(has_key(j, "seed"), content="true")
    inspect(players_of(j).length(), content="2")
  }
}

test "input_routed_to_host_only_verbatim" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let (c1, _) = mk_join(s, invite, "C1")
  let raw = "{\"t\":\"input\",\"id\":2,\"i\":[0.5,-0.25,1.234,0.05,1]}"
  let out = s.handle_text(c1, raw)
  inspect(out.length(), content="1")
  inspect(out[0].to == host, content="true")
  inspect(out[0].text == raw, content="true") // 原文转发, 不重序列化
  // 房主自己的 input 不回环
  let out2 = s.handle_text(host, "{\"t\":\"input\",\"id\":1,\"i\":[0,0,0,0,0]}")
  inspect(out2.length(), content="0")
}

test "host_snap_ev_broadcast_to_others_verbatim" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let (c1, _) = mk_join(s, invite, "C1")
  // 房主 snap → 其他人收原文
  let snap = "{\"t\":\"snap\",\"st\":99,\"tn\":{\"1\":[1,2,3,0,4,5,6,7,100,1]}}"
  let out = s.handle_text(host, snap)
  inspect(out.length(), content="1")
  inspect(out[0].to == c1, content="true")
  inspect(out[0].text == snap, content="true")
  // ev 同路
  let out_ev = s.handle_text(host, "{\"t\":\"ev\",\"k\":\"kill\",\"d\":{}}")
  inspect(out_ev.length(), content="1")
  inspect(out_ev[0].to == c1, content="true")
  // 非房主 snap → 忽略
  let out_no = s.handle_text(c1, "{\"t\":\"snap\",\"st\":1}")
  inspect(out_no.length(), content="0")
}

test "host_disconnect_dissolves_room" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let (c1, _) = mk_join(s, invite, "C1")
  let out = s.disconnect(host)
  // 其余人: err + close
  inspect(out.length(), content="1")
  inspect(out[0].to == c1, content="true")
  inspect(out[0].close, content="true")
  let j = parse_or_null(out[0].text)
  inspect(field_str(j, "t"), content="err")
  inspect(field_str(j, "msg"), content="房主已离开，房间解散")
  inspect(s.rooms.length(), content="0")
  inspect(s.invites.length(), content="0")
  // 残留会话再发消息 → 全忽略
  let out2 = s.handle_text(c1, "{\"t\":\"ready\",\"v\":true}")
  inspect(out2.length(), content="0")
}

test "player_disconnect_broadcasts_lobby" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  let (c1, _) = mk_join(s, invite, "C1")
  let inv2 = new_invite(s, host)
  let (c2, _) = mk_join(s, inv2, "C2")
  let out = s.disconnect(c1)
  // 房主和 c2 各得一条 lobby, 剩 2 人
  inspect(out.length(), content="2")
  for d in out {
    let lobby = parse_or_null(d.text)
    inspect(field_str(lobby, "t"), content="lobby")
    inspect(players_of(lobby).length(), content="2")
  }
  inspect(out[0].to == host || out[0].to == c2, content="true")
  inspect(s.rooms.length(), content="1")
}

test "empty_room_cleaned_up" {
  let s = Server::Server()
  let (host, _, invite) = mk_host(s, "H")
  inspect(s.rooms.length(), content="1")
  inspect(s.invites.length(), content="1")
  ignore(invite)
  let out = s.disconnect(host)
  inspect(out.length(), content="0") // 空房无人可通知
  inspect(s.rooms.length(), content="0")
  inspect(s.invites.length(), content="0")
}

test "garbage_and_unknown_ignored" {
  let s = Server::Server()
  let sid = s.connect()
  inspect(s.handle_text(sid, "not json").length(), content="0")
  inspect(s.handle_text(sid, "{\"t\":\"unknown\"}").length(), content="0")
  inspect(s.handle_text(sid, "{\"t\":123}").length(), content="0")
  inspect(s.handle_text(sid, "[1,2]").length(), content="0")
  inspect(s.handle_text(sid, "123").length(), content="0")
  inspect(s.handle_text(sid, "{}").length(), content="0")
  inspect(s.handle_text(sid, "").length(), content="0")
}

test "invite_regeneration_and_multiple_codes" {
  let s = Server::Server()
  let (host, _, invite0) = mk_host(s, "H")
  let inv1 = new_invite(s, host)
  inspect(inv1.length(), content="8")
  inspect(inv1 == invite0, content="false") // 新码不重复
  // 非房主要邀请码 → 忽略
  let stranger = s.connect()
  let out = s.handle_text(stranger, "{\"t\":\"invite\"}")
  inspect(out.length(), content="0")
  // 两张码都能入房
  let _ = mk_join(s, invite0, "A")
  let _ = mk_join(s, inv1, "B")
  inspect(s.rooms.length(), content="1")
}
