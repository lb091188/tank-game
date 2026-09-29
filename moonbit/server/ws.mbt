// ws.mbt — WebSocket 会话: 升级握手 + 收包接线 server-core + 心跳 + 断线善后
// 客户端连 ws://IP:端口 (路径就是 "/"), 靠 Upgrade 头判定, 等价 ws 库的 {server} 行为

priv struct Sess {
  conn : @websocket.Conn
  mutex : @async.Mutex // 串行化跨任务发送 (帧不交错)
}

priv struct Ctx {
  core : @core.Server
  sessions : Map[Int, Sess] // sid → 会话 (投递目标)
}

///|
fn is_ws_upgrade(request : @http.Request) -> Bool {
  match request.headers.get(@http.CaseInsensitiveString("Upgrade")) {
    Some(v) => v.to_lower() == "websocket"
    None => false
  }
}

///|
async fn deliver(ctx : Ctx, d : @core.Delivery) -> Unit {
  match ctx.sessions.get(d.to) {
    Some(sess) => {
      sess.mutex.acquire()
      defer sess.mutex.release()
      try {
        sess.conn.send_text(d.text)
      } catch {
        e => eprintln("[投递失败] sid=\{d.to}: \{e}")
      }
      if d.close {
        try {
          sess.conn.send_close()
        } catch {
          _ => ()
        }
        sess.conn.close()
      }
    }
    None => () // 会话已不在 → 丢弃
  }
}

///|
// 心跳: 15s ping (浏览器自动回 pong), 失败即断
async fn heartbeat(sess : Sess) -> Unit {
  for ;; {
    @async.sleep(15000)
    sess.mutex.acquire()
    let alive = try {
      sess.conn.ping()
      true
    } catch {
      _ => false
    }
    sess.mutex.release()
    if !alive {
      sess.conn.close()
      return
    }
  }
}

///|
async fn handle_ws(
  ctx : Ctx,
  request : @http.Request,
  conn : @http.ServerConnection,
) -> Unit {
  let ws = try {
    @websocket.Conn::from_http_server(request, conn)
  } catch {
    _ => {
      conn.close() // 握手失败, 连接已无法回退成普通 HTTP
      return
    }
  }

  let sid = ctx.core.connect()
  let sess : Sess = { conn: ws, mutex: @async.Mutex::Mutex() }
  ctx.sessions.set(sid, sess)
  @async.with_task_group <| group => {
    group.spawn_bg() <| () => {
      heartbeat(sess)
    }
    // 收包 → 接线 core → 投递
    try {
      for ;; {
        let msg = sess.conn.recv()
        let text : String = if msg.kind is Text {
          try {
            msg.read_all().text()
          } catch {
            _ => "" // 非 UTF-8 文本帧 → 忽略
          }
        } else {
          ignore(msg.read_all()) // 二进制帧丢弃 (协议只用文本)
          ""
        }
        if text != "" {
          let deliveries = ctx.core.handle_text(sid, text)
          for d in deliveries {
            deliver(ctx, d)
          }
        }
      }
    } catch {
      _ => () // 断开/协议错误 → 善后
    }
    // 善后: 通知 core 摘牌 + 投递解散消息 + 移除会话
    let deliveries = ctx.core.disconnect(sid)
    ctx.sessions.remove(sid)
    for d in deliveries {
      deliver(ctx, d)
    }
    sess.conn.close()
  }
}
