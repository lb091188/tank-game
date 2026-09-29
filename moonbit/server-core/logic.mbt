// logic.mbt — 房间状态机: create/join/invite/ready/start/input/snap/ev/end + 断线善后
// 语义逐条对齐 server/server.js (主机权威, 服务器只转发不解析游戏数据)

///|
/// 新连接接入: 登记 sid (IO 层在 WS 建立后调用)
pub fn Server::connect(self : Server) -> Int {
  self.next_sid += 1
  self.sessions.set(self.next_sid, { room_code: None, pid: None })
  self.next_sid
}

///|
/// 处理一条上行文本, 返回本次事件产生的全部投递动作.
/// 非法 JSON / 未知类型 / 无权限一律静默忽略 (对齐 server.js).
pub fn Server::handle_text(self : Server, sid : Int, raw : String) -> Array[Delivery] {
  let out : Array[Delivery] = []
  let msg : Json = try {
    @json.parse(raw)
  } catch {
    _ => return out
  }
  let t = match jstr(msg, "t") {
    Some(s) => s
    None => return out
  }
  match t {
    "create" => self.do_create(sid, msg, out)
    "join" => self.do_join(sid, msg, out)
    "invite" =>
      match self.me_player(sid) {
        Some((code, _, p)) if p.host =>
          match self.new_invite(code) {
            Some(inv) => {
              out.push({ to: sid, text: invite_msg(inv), close: false })
              (self.logger)("[房间\{code}] 新邀请码 \{inv}")
            }
            None => ()
          }
        _ => ()
      }
    "ready" =>
      match self.me_player(sid) {
        Some((_, room, p)) => {
          p.ready = jbool(msg, "v")
          match jstr(msg, "tank") {
            Some(tank) => p.tank = tank
            None => ()
          }
          let text = lobby_msg(room)
          for other in room.players.values() {
            out.push({ to: other.sid, text, close: false })
          }
        }
        _ => ()
      }
    "start" =>
      match self.me_player(sid) {
        Some((code, room, p)) if p.host => {
          room.started = true
          let text = start_json(msg, room, self.rng.double())
          for other in room.players.values() {
            out.push({ to: other.sid, text, close: false })
          }
          (self.logger)("[房间\{code}] 开战 \{jstr_or(msg, "map", "?")}")
        }
        _ => ()
      }
    // 客户端输入 → 只发给主机 (原文转发, 不解析)
    "input" =>
      match self.me_player(sid) {
        Some((_, room, p)) =>
          if !p.host {
            for other in room.players.values() {
              if other.host && other.sid != sid {
                out.push({ to: other.sid, text: raw, close: false })
              }
            }
          }
        _ => ()
      }
    // 主机快照/事件/结算 → 广播给其他人 (原文转发)
    "snap" | "ev" | "end" =>
      match self.me_player(sid) {
        Some((_, room, p)) =>
          if p.host {
            for other in room.players.values() {
              if other.sid != sid {
                out.push({ to: other.sid, text: raw, close: false })
              }
            }
          }
        _ => ()
      }
    _ => ()
  }
  out
}

///|
/// 连接断开: 摘牌 + 房间善后 (空房删除 / 房主解散 / 其余广播 lobby)
pub fn Server::disconnect(self : Server, sid : Int) -> Array[Delivery] {
  let out : Array[Delivery] = []
  let sess = match self.sessions.get(sid) {
    Some(s) => s
    None => return out
  }
  self.sessions.remove(sid)
  let code = match sess.room_code {
    Some(c) => c
    None => return out
  }
  let room = match self.rooms.get(code) {
    Some(r) => r
    None => return out
  }
  let pid = match sess.pid {
    Some(p) => p
    None => return out
  }
  let me = room.players.get(pid)
  room.players.remove(pid)
  let me_name = match me {
    Some(p) => p.name
    None => "?"
  }
  (self.logger)("[房间\{code}] 离开 \{me_name}")
  if room.players.is_empty() {
    // 空房 → 删除 + 邀请码全部作废
    self.drop_invites(code)
    self.rooms.remove(code)
    return out
  }
  match me {
    Some(p) if p.host => {
      // 房主掉线 → 广播 err 并断开全员, 房间解散
      let text = err_msg("房主已离开，房间解散")
      for other in room.players.values() {
        out.push({ to: other.sid, text, close: true })
      }
      self.drop_invites(code)
      self.rooms.remove(code)
    }
    _ => {
      let text = lobby_msg(room)
      for other in room.players.values() {
        out.push({ to: other.sid, text, close: false })
      }
    }
  }
  out
}

///|
/// —— create ——
fn Server::do_create(
  self : Server,
  sid : Int,
  msg : Json,
  out : Array[Delivery],
) -> Unit {
  let code = self.gen_code()
  let room : Room = { players: {}, invites: {}, started: false }
  self.rooms.set(code, room)
  let pid = self.next_pid
  self.next_pid += 1
  let name = norm_name(msg)
  room.players.set(
    pid,
    { sid, id: pid, name, tank: jstr_or(msg, "tank", "sherman"), ready: true, host: true },
  )
  // 直接覆盖登记 (对齐 server.js: ws._room 覆盖写)
  self.sessions.set(sid, { room_code: Some(code), pid: Some(pid) })
  let invite = self.new_invite(code) // 建房自动发第一张邀请码
  out.push({ to: sid, text: joined_msg(code, pid, room, invite), close: false })
  let inv_txt = match invite {
    Some(inv) => " · 邀请码 \{inv}"
    None => ""
  }
  (self.logger)("[房间\{code}] 创建 by \{name}\{inv_txt}")
}

///|
/// —— join —— (仅邀请制: 一次性邀请码, trim + 大写归一)
fn Server::do_join(
  self : Server,
  sid : Int,
  msg : Json,
  out : Array[Delivery],
) -> Unit {
  let inv = jstr_or(msg, "invite", "").trim().to_upper().to_owned()
  if !self.invites.contains(inv) {
    out.push({ to: sid, text: err_msg("邀请码无效或已被使用"), close: false })
    return
  }
  let code = match self.invites.get(inv) {
    Some(c) => c
    None => return
  }
  let room = match self.rooms.get(code) {
    Some(r) => r
    None => {
      self.invites.remove(inv)
      out.push({ to: sid, text: err_msg("房间已解散"), close: false })
      return
    }
  }
  if room.started {
    out.push({ to: sid, text: err_msg("对战已开始"), close: false })
    return
  }
  if room.players.length() >= self.max_players {
    out.push({ to: sid, text: err_msg("房间已满(8人)"), close: false })
    return
  }
  // 一次性: 加入即销毁
  self.invites.remove(inv)
  room.invites.remove(inv)
  let pid = self.next_pid
  self.next_pid += 1
  let name = norm_name(msg)
  room.players.set(
    pid,
    { sid, id: pid, name, tank: jstr_or(msg, "tank", "sherman"), ready: false, host: false },
  )
  self.sessions.set(sid, { room_code: Some(code), pid: Some(pid) })
  out.push({ to: sid, text: joined_msg(code, pid, room, None), close: false })
  let text = lobby_msg(room)
  for other in room.players.values() {
    if other.sid != sid {
      out.push({ to: other.sid, text, close: false })
    }
  }
  (self.logger)("[房间\{code}] 邀请加入 \{name}")
}

///|
/// 会话所在的 (房间码, 房间, 玩家); 未入房/房已散 → None
fn Server::me_player(self : Server, sid : Int) -> Option[(String, Room, Player)] {
  match self.sessions.get(sid) {
    Some({ room_code: Some(code), pid: Some(pid) }) =>
      match self.rooms.get(code) {
        Some(room) =>
          match room.players.get(pid) {
            Some(p) => Some((code, room, p))
            None => None
          }
        None => None
      }
    _ => None
  }
}

///|
/// 4 位数字房间码 (1000–9999), 冲突重试
fn Server::gen_code(self : Server) -> String {
  for ;; {
    let code = (1000 + self.rng.int(limit=9000)).to_string()
    if !self.rooms.contains(code) {
      return code
    }
  }
}

///|
/// 8 位一次性邀请码 (31 字符表, 去掉易混字符 0O1IL), 碰撞重试
fn Server::gen_invite(self : Server) -> String {
  let alph = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  for ;; {
    let mut code = ""
    for _ in 0..<8 {
      match alph.get_char(self.rng.int(limit=31)) {
        Some(c) => code = code + c.to_string()
        None => ()
      }
    }
    if code.length() == 8 && !self.invites.contains(code) {
      return code
    }
  }
}

///|
/// 给房间发一张新邀请码
fn Server::new_invite(self : Server, room_code : String) -> String? {
  let room = match self.rooms.get(room_code) {
    Some(r) => r
    None => return None
  }
  let code = self.gen_invite()
  room.invites.set(code, ())
  self.invites.set(code, room_code)
  Some(code)
}

///|
/// 房间解散 → 其邀请码全部作废
fn Server::drop_invites(self : Server, room_code : String) -> Unit {
  match self.rooms.get(room_code) {
    Some(room) => {
      for c in room.invites.keys() {
        self.invites.remove(c)
      }
    }
    None => {
      let dead : Array[String] = []
      self.invites.each(fn(c, rc) { if rc == room_code { dead.push(c) } })
      for c in dead {
        self.invites.remove(c)
      }
    }
  }
}
