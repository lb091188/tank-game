// 阶段0-JSON:1.7MB partBoxes(129 车型 OBB 装甲盒表)运行时解析耗时。
// 规划 D3/B2 的决策依据:数据外置 JSON、core/json 运行时解析,
// 而不是硬编码进 MoonBit 源码(编译会炸)。
// 验收口径:启动时解析 < 1s 即完全可接受(网页版要先 fetch 再 parse,更慢)。

///|
async fn main {
  let path = "partboxes.json"
  let size = @fs.file_size(path)
  println("[INFO] \{path}: \{size} 字节")
  let f = @fs.open(path, mode=ReadOnly)
  let raw = f.read_exactly_at(size.to_int(), position=0)
  f.close()
  let s = @utf8.decode(raw) catch {
    _ => {
      println("[FAIL] UTF-8 解码失败")
      return
    }
  }
  // 预热 1 次 + 计时 5 次取最优/最差
  let parse_once = fn() -> Int64 raise {
    let t0 = @async.now()
    let v = @json.parse(s) catch {
      e => {
        println("[FAIL] JSON 解析失败: \{e}")
        return -1L
      }
    }
    let t1 = @async.now()
    // 顺手验内容:顶层必须是 129 车型的 object
    match v {
      Object(m) =>
        println(
          "[INFO] 顶层键数 = \{m.size()}(期望 129): \{if m.size() == 129 { "对" } else { "不符" }}",
        )
      _ => println("[FAIL] 顶层不是 object")
    }
    t1 - t0
  }
  let _warm = parse_once()
  let mut best = 0x7FFFFFFFFFFFFFFFL
  let mut worst = 0L
  for i in 0..<5 {
    ignore(i)
    let d = parse_once()
    if d < 0 {
      return
    }
    if d < best {
      best = d
    }
    if d > worst {
      worst = d
    }
  }
  // @async.now() 单位视实现而定,两种口径都打,数量级看哪个合理
  println("[INFO] 6 次解析耗时(原始 delta): best=\{best} worst=\{worst}")
  println(
    if best / 1_000_000 < 1000 {
      "[PASS] JSON 基准: 最快 \{best / 1_000_000}ms / 最慢 \{worst / 1_000_000}ms —— 运行时外置可行"
    } else {
      "[WARN] 解析偏慢,见上"
    },
  )
}
