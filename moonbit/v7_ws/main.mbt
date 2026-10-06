// 阶段0-V7:官方 async/websocket 连本机游戏服务器(server.js :8342),
// 按 net.js:56 的 join 门禁格式发一条 JSON,收第一条回包打印。
// 通过标准:收到服务器 JSON 回包(joined/lobby/err 任意一种都算链路通)。

///|
async fn main {
  let url = "ws://127.0.0.1:8342/"
  println("[INFO] 连接 \{url}")
  let ws = @websocket.connect(url) catch {
    e => {
      println("[FAIL] 连接失败: \{e}")
      return
    }
  }
  defer ws.close()
  // net.js:56-57: join 带 proto:2 版本门禁
  let join = "{\"t\":\"join\",\"room\":\"mb01\",\"pw\":\"\",\"name\":\"mb_test\",\"tank\":\"bt7\",\"proto\":2}"
  ws.send_text(join) catch {
    e => {
      println("[FAIL] 发送失败: \{e}")
      return
    }
  }
  println("[INFO] 已发 join,等待回包(5s 超时)")
  let reply = @async.with_timeout(5000, () => {
    let msg = ws.recv() catch {
      e => {
        println("[FAIL] recv 失败: \{e}")
        return ""
      }
    }
    let data = msg.read_all()
    data.text()
  }) catch {
    _ => {
      println("[FAIL] 超时未收到回包")
      return
    }
  }
  if reply == "" {
    return
  }
  println(
    "[PASS] 收到回包(\{reply.length()} 字符): \{reply[:if reply.length() > 300 { 300 } else { reply.length() }]}",
  )
  ws.send_close() catch {
    _ => ()
  }
  println(
    "V7 结论: MoonBit async/websocket ↔ Node 游戏服务器链路通(JSON 文本帧往返)",
  )
}
