// main.mbt — steel-server 入口: 一个端口两件事 (server/server.js 的 MoonBit 原生副本)
//   ① 静态托管 client/ (局域网玩家浏览器直开)
//   ② WebSocket 房间中继 (协议与 server.js 完全一致, 游戏判定在房主浏览器)

async fn main {
  let matches = @argparse.Command(
      "steel-server",
      about="钢铁前沿 内网对战服务器 (MoonBit 原生)",
      positionals=[
        PositionArg("port", about="监听端口 (默认 8342)", default_values=["8342"]),
        PositionArg("root", about="client 静态目录 (默认自动寻找)", default_values=[""]),
      ],
    ).parse()
  let (port_s, root_hint) = match matches.values {
    { "port": [p], "root": [r], .. } => (p, r)
    { "port": [p], .. } => (p, "")
    _ => ("8342", "")
  }
  let port = try {
    @string.parse_int(port_s)
  } catch {
    _ => 8342
  }
  // 定位 client/ 静态目录 (参数优先, 再从当前目录逐级向上找)
  let root = match find_client_root(root_hint) {
    Some(r) => r
    None => {
      eprintln("找不到 client/index.html — 请在仓库根目录运行, 或用第 2 个参数指定 client 目录")
      return
    }
  }
  print_banner(port, root)
  let ctx : Ctx = { core: @core.Server::Server(), sessions: {} }
  let server = @http.Server(@socket.Addr::parse("0.0.0.0:\{port}"))
  server.run_forever() <| ((request, _body, conn) => {
    if is_ws_upgrade(request) {
      handle_ws(ctx, request, conn)
    } else {
      serve_static(conn, request, root)
    }
  })
}

///|
async fn find_client_root(hint : String) -> String? {
  let candidates : Array[String] = []
  if hint != "" {
    candidates.push(hint)
  }
  candidates.push("client")
  candidates.push("../client")
  candidates.push("../../client")
  candidates.push("../../../client")
  for c in candidates {
    if @fs.exists(c + "/index.html") {
      return Some(@fs.realpath(c))
    }
  }
  None
}

///|
// UDP connect 探测本机出口地址 (不发包); 两种目标都失败则回落 127.0.0.1
async fn lan_ip() -> String {
  for target in ["10.255.255.255:1", "8.8.8.8:53"] {
    try {
      let udp = @socket.UdpClient::UdpClient(@socket.Addr::parse(target))
      defer udp.close()
      let a = udp.addr
      if a.ip() != 0 {
        let s = a.to_string()
        match s.rev_find(":") {
          Some(i) => return s[:i].to_owned()
          None => return s
        }
      }
    } catch {
      _ => ()
    }
  }
  "127.0.0.1"
}

///|
async fn print_banner(port : Int, root : String) -> Unit {
  let lan = lan_ip()
  eprintln("钢铁前沿对战服务器已启动 (MoonBit 原生)")
  eprintln("  静态目录: \{root}")
  eprintln("  页面地址(浏览器打开): http://127.0.0.1:\{port}")
  eprintln("  WebSocket 地址(填进客户端设置): ws://127.0.0.1:\{port}")
  if lan != "127.0.0.1" {
    eprintln("  内网页面:   http://\{lan}:\{port}")
    eprintln("  内网 WS 地址: ws://\{lan}:\{port}  ← 其他玩家把这个填进游戏\"联机设置\"")
  }
}
