// client.mbt — 会话协程: 连接 → 建房/进房 → (房主)开战 → recv 循环喂共享态
// + 30Hz 输入上行 + 退出看门狗。与 gameapp 的集成走 external_loop_integration
// (async 事件循环与 GUI 循环同线程交替: recv 协程在 poll 之间运行, 渲染帧
// 回调在 poll 内运行 —— ClientState 全部字段单线程顺序访问, 无锁)。

///|
/// 单调毫秒(与 SnapBuf 时间轴同源; GUI 帧回调侧调 interpolate 用同一时钟)
pub fn now_ms() -> Double {
  @async.now().to_double()
}

///|
/// 联机会话共享态(事件循环线程独占访问, 见文件头注)
pub(all) struct ClientState {
  pub snaps : SnapBuf
  pub events : Array[ServerMsg] // ev/end/err 留给渲染帧消费(渲染帧负责清空)
  pub mut my_id : Int
  pub mut room : String
  pub mut is_host : Bool
  pub mut players : Array[PlayerRow]
  pub mut started : Bool
  pub mut seed : Int
  pub mut map : String
  pub mut mode : String
  pub mut snap_count : Int
  pub mut status : String
  pub mut fatal : String? // 连接失败/被拒/断线(渲染帧据此退出)
  // 本地最新输入(渲染帧每帧覆写, 上行协程 30Hz 取走)
  pub mut in_throttle : Double
  pub mut in_steer : Double
  pub mut in_aim_yaw : Double
  pub mut in_aim_pitch : Double
  pub mut in_fire : Bool
  pub mut quit : Bool // 渲染侧请求退出(看门狗协程关 socket 让 recv 解除阻塞)
  pub log : (String) -> Unit
}

///|
pub fn ClientState::make(log : (String) -> Unit) -> ClientState {
  {
    snaps: SnapBuf(),
    events: [],
    my_id: 0,
    room: "",
    is_host: false,
    players: [],
    started: false,
    seed: 0,
    map: "",
    mode: "dm",
    snap_count: 0,
    status: "初始化",
    fatal: None,
    in_throttle: 0.0,
    in_steer: 0.0,
    in_aim_yaw: 0.0,
    in_aim_pitch: 0.0,
    in_fire: false,
    quit: false,
    log,
  }
}

///|
/// 单条回包落地(lobby.js bindMsgs 的客户端面; snap 另喂插值缓冲)
fn apply_msg(c : ClientState, m : ServerMsg) -> Unit {
  match m {
    Joined(room, you, players, mode) => {
      c.room = room
      c.my_id = you
      c.players = players
      c.mode = mode
      c.status = "已进房 \{room}(我是 #\{you})"
      (c.log)(
        "NET joined 房间\{room} my_id=\{you} 玩家\{players.length()} 模式\{mode}",
      )
      // 名单里找自己判房主(建房者 host=true, server.js:416)
      for p in players {
        if p.id == you && p.host {
          c.is_host = true
        }
      }
    }
    Lobby(players) => {
      c.players = players
      (c.log)("NET lobby 名单\{players.length()}人")
    }
    Err(msg) => {
      c.events.push(m)
      (c.log)("NET err: \{msg}")
      // 版本/令牌类错误重试无意义 → 致命退出
      if msg.contains("过旧") || msg.contains("令牌") || msg.contains("满载") {
        c.fatal = Some(msg)
      }
    }
    Left => (c.log)("NET left(已离房)")
    Start(map, mode, seed, players, srv_sim) => {
      c.started = true
      c.map = map
      c.mode = mode
      c.seed = seed
      c.players = players
      c.snaps.reset()
      c.status = "开战 \{map}/\{mode} seed=\{seed} srvSim=\{srv_sim}"
      (c.log)(
        "NET start map=\{map} mode=\{mode} seed=\{seed} srvSim=\{srv_sim} 玩家\{players.length()}",
      )
    }
    Snap(st, tn, sc) => {
      c.snap_count += 1
      c.snaps.push(now_ms(), st, tn, sc)
    }
    Ev(_) | End(_) => c.events.push(m)
  }
}

///|
/// 回包 → 文本(recv Message 的公共出口; 解码失败记日志返空串由调用方跳过。
/// read_all 是 async(消息可能分片到达), 故本函数 async)
async fn msg_text(c : ClientState, m : @websocket.Message) -> String {
  m.read_all().text() catch {
    e => {
      (c.log)("NET 回包解码失败: \{e}")
      ""
    }
  }
}

///|
/// recv 一条并落地; false = 连接结束(quit 路径由看门狗关 socket 触发报错)
async fn pump_once(c : ClientState, ws : @websocket.Conn) -> Bool {
  let msg = ws.recv() catch {
    e => {
      if !c.quit {
        c.fatal = Some("连接断开: \{e}")
        (c.log)("NET \{e}")
      }
      return false
    }
  }
  let text = msg_text(c, msg)
  if text != "" {
    match parse_server_msg(text) {
      Some(m) => apply_msg(c, m)
      None => (c.log)("NET 未识别回包(\{text.length()} 字符), 忽略")
    }
  }
  true
}

///|
/// 进房等待(joined 回包即返 true; 期间 lobby/err 照常落地)
async fn wait_joined(c : ClientState, ws : @websocket.Conn) -> Bool {
  while c.fatal is None && !c.quit {
    let msg = ws.recv() catch {
      e => {
        c.fatal = Some("等待进房时断开: \{e}")
        return false
      }
    }
    let text = msg_text(c, msg)
    if text == "" {
      continue
    }
    match parse_server_msg(text) {
      Some(m) => {
        let is_joined = match m {
          Joined(_, _, _, _) => true
          _ => false
        }
        apply_msg(c, m)
        if is_joined {
          return true
        }
      }
      None => (c.log)("NET 未识别回包(进房阶段), 忽略")
    }
  }
  false
}

///|
/// 联机会话主协程(调用方在 task_group 里 spawn_bg):
///   room="" → 建房并作为房主直接开战(server.js 对 start 不设人数下限,
///   dm 房即刻建服务器权威仿真); room="1234" → 凭房间号加入等房主开战。
pub async fn run_session(
  c : ClientState,
  addr : String,
  room : String,
  name : String,
  tank : String,
  map : String,
) -> Unit {
  c.status = "连接 \{addr}"
  let ws = @websocket.connect(addr) catch {
    e => {
      c.fatal = Some("连接失败: \{e}")
      (c.log)("NET 连接失败: \{e}")
      return
    }
  }
  c.status = "已连接, 进房中"
  (c.log)("NET 已连接 \{addr}")
  defer {
    // 兜底: 未进房就结束(且非主动退出/已有致命错) → 视为致命, 渲染帧退出
    if !c.quit && c.fatal is None && c.room == "" {
      c.fatal = Some("会话在进房前结束")
    }
    ws.close()
  }
  // ① 建房 / 进房
  let hello = if room == "" {
    encode_create(name, tank, "")
  } else {
    encode_join(room, "", name, tank)
  }
  ws.send_text(hello) catch {
    e => {
      c.fatal = Some("进房消息发送失败: \{e}")
      return
    }
  }
  (c.log)(
    if room == "" {
      "NET 已发 create(name=\{name} tank=\{tank})"
    } else {
      "NET 已发 join(room=\{room})"
    },
  )
  // ② 等 joined(10s 超时; 超时/断线均为致命路径)
  let ok = @async.with_timeout(10000, () => wait_joined(c, ws)) catch {
    _ => {
      if c.fatal is None {
        c.fatal = Some("等待 joined 超时(10s)")
      }
      false
    }
  }
  if !ok || c.fatal is Some(_) {
    (c.log)("NET 进房未完成: \{c.fatal.unwrap_or("?")}")
    return
  }
  // ③ 房主开战(单人 dm: 服务器权威仿真即刻起跑; 加入者等房主 start 广播)
  if c.is_host && room == "" {
    ws.send_text(encode_start(map, "dm")) catch {
      e => {
        c.fatal = Some("start 发送失败: \{e}")
        return
      }
    }
    (c.log)("NET 已发 start(map=\{map} mode=dm)")
  }
  // ④ 战斗期: recv 落地 + 30Hz 输入上行 + 退出看门狗(quit → 关 socket 解除
  //    recv 阻塞, 三个协程收束 → external loop 的 with_event_loop 退出)
  @async.with_task_group(group => {
    group.spawn_bg() <| () => {
      while !c.quit {
        if !pump_once(c, ws) {
          break
        }
      }
      (c.log)("NET recv 循环结束(快照\{c.snap_count}帧)")
    }
    group.spawn_bg() <| () => {
      while !c.quit {
        @async.sleep(33) // net.js startInputLoop 的 30Hz
        if c.quit {
          break
        }
        if c.started {
          ws.send_text(
            encode_input(
              c.my_id,
              c.in_throttle,
              c.in_steer,
              c.in_aim_yaw,
              c.in_aim_pitch,
              c.in_fire,
            ),
          ) catch {
            _ => break
          }
        }
      }
    }
    group.spawn_bg() <| () => {
      while !c.quit {
        @async.sleep(250)
        if c.quit {
          ws.close() // recv 阻塞中 → 关 fd 触发其报错解除
          return
        }
      }
    }
  })
}
