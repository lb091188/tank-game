// types.mbt — server-core 数据结构
// 纯逻辑层: 不持有连接, 只产生 Delivery 动作, 由 IO 层执行.

///|
/// 投递指令: core 产生的对外动作, IO 层负责真正发送.
pub(all) struct Delivery {
  /// 目标会话 id (Server::connect 返回的 sid)
  to : Int
  /// 要发送的 JSON 文本 (构造好的下行消息, 或客户端原文转发)
  text : String
  /// 发送后断开该连接 (房主掉线解散房间时)
  close : Bool
}

///|
/// 房间内玩家 (sid 桥接到投递目标)
priv struct Player {
  sid : Int
  id : Int
  name : String
  mut tank : String
  mut ready : Bool
  host : Bool
}

///|
struct Room {
  players : Map[Int, Player]
  invites : Map[String, Unit]
  mut started : Bool
}

///|
struct Session {
  room_code : String?
  pid : Int?
}

///|
/// 纯逻辑联机服务器: 房间管理 + 一次性邀请码 + 消息路由.
/// 协议与 server/server.js 逐条对齐 (主机权威, 服务器不解析游戏数据).
pub struct Server {
  max_players : Int
  rooms : Map[String, Room]
  invites : Map[String, String]
  sessions : Map[Int, Session]
  mut next_pid : Int
  mut next_sid : Int
  rng : @random.Rand
  mut logger : (String) -> Unit
}

///|
pub fn Server::Server(max_players? : Int = 8) -> Self {
  {
    max_players,
    rooms: {},
    invites: {},
    sessions: {},
    next_pid: 1,
    next_sid: 0,
    rng: @random.Rand::new(),
    logger: fn(s : String) { eprintln(s) },
  }
}

///|
/// 替换日志输出 (默认 eprintln(stderr, 实时); 后续 GUI 阶段可接到界面上)
pub fn Server::set_logger(self : Server, f : (String) -> Unit) -> Unit {
  self.logger = f
}
