// static.mbt — 静态托管 client/: 与 server.js 同款缓存策略
//   index.html/version.txt 永远最新(no-store); 带 ?v= 的资源长缓存 immutable; 其余 no-cache

///|
fn mime_of(path : String) -> String {
  match path {
    [.., .. ".html"] => "text/html; charset=utf-8"
    [.., .. ".js"] => "text/javascript; charset=utf-8"
    [.., .. ".css"] => "text/css; charset=utf-8"
    [.., .. ".json"] => "application/json; charset=utf-8"
    [.., .. ".png"] => "image/png"
    [.., .. ".jpg"] | [.., .. ".jpeg"] => "image/jpeg"
    [.., .. ".glb"] => "model/gltf-binary"
    [.., .. ".wav"] => "audio/wav"
    [.., .. ".mp3"] => "audio/mpeg"
    [.., .. ".ogg"] => "audio/ogg"
    [.., .. ".ico"] => "image/x-icon"
    [.., .. ".txt"] => "text/plain; charset=utf-8"
    _ => "application/octet-stream"
  }
}

///|
// /[?&]v=/ 语义: 紧跟 ? 或 & 的 v=
fn query_has_v(q : String) -> Bool {
  q.find("v=") is Some(0) || q.contains("&v=")
}

///|
fn hex_val(c : Char?) -> Int? {
  match c {
    Some(c) =>
      if c >= '0' && c <= '9' {
        Some(c.to_int() - '0'.to_int())
      } else if c >= 'a' && c <= 'f' {
        Some(c.to_int() - 'a'.to_int() + 10)
      } else if c >= 'A' && c <= 'F' {
        Some(c.to_int() - 'A'.to_int() + 10)
      } else {
        None
      }
    None => None
  }
}

///|
// decodeURIComponent 的宽松版: %XX 解码, 非法序列原样保留
fn url_decode(s : String) -> String {
  let out = StringBuilder()
  let n = s.length()
  let mut i = 0
  while i < n {
    if s.get_char(i) is Some('%') && i + 2 < n {
      match (hex_val(s.get_char(i + 1)), hex_val(s.get_char(i + 2))) {
        (Some(h), Some(l)) => {
          out.write_char((h * 16 + l).unsafe_to_char())
          i += 3
        }
        _ => {
          out.write_char('%')
          i += 1
        }
      }
    } else {
      match s.get_char(i) {
        Some(c) => out.write_char(c)
        None => ()
      }
      i += 1
    }
  }
  out.to_string()
}

///|
async fn send_404(conn : @http.ServerConnection, p : String) -> Unit {
  let headers : Map[@http.CaseInsensitiveString, String] = Map([])
  headers.set(@http.CaseInsensitiveString("Content-Type"), "text/plain; charset=utf-8")
  conn.send_response(404, "Not Found", extra_headers=headers)
  conn.write_string("404: \{p}")
  conn.end_response()
}

///|
async fn serve_static(
  conn : @http.ServerConnection,
  request : @http.Request,
  root : String,
) -> Unit {
  // 拆查询串: /js/main.js?v=123 → 路径 /js/main.js, 查询 v=123
  let (raw_path, query) = match request.path.find("?") {
    Some(i) => (request.path[:i].to_owned(), request.path[i + 1:].to_owned())
    None => (request.path, "")
  }
  let mut p = url_decode(raw_path)
  if p == "/" {
    p = "/index.html"
  }
  // 穿越防护 (等价 server.js 的 startsWith(ROOT) 检查)
  if p.contains("..") {
    conn.send_response(403, "Forbidden")
    conn.end_response()
    return
  }
  let file_path = root + p
  let file = try {
    @fs.open(file_path, mode=ReadOnly)
  } catch {
    _ => {
      send_404(conn, p)
      return
    }
  }
  defer file.close()
  // 目录 → 404 (对齐 Node readFile(目录) 报错)
  if @fs.kind(file_path) is Directory {
    send_404(conn, p)
    return
  }
  let cache : String = if p == "/index.html" || p == "/version.txt" {
    "no-store"
  } else if query_has_v(query) {
    "public, max-age=31536000, immutable"
  } else {
    "no-cache"
  }
  let headers : Map[@http.CaseInsensitiveString, String] = Map([])
  headers.set(@http.CaseInsensitiveString("Content-Type"), mime_of(p))
  headers.set(@http.CaseInsensitiveString("Content-Length"), file.size().to_string())
  headers.set(@http.CaseInsensitiveString("Cache-Control"), cache)
  conn.send_response(200, "OK", extra_headers=headers)
  if request.meth is Get {
    conn.write_reader(file)
  }
  conn.end_response()
}
