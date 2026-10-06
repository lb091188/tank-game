// 阶段0-V8:moon_rodio 三格式播放(对应清单 V8)。
// 放:① cannon.ogg 一次性;② 语音 v_ammo1.mp3;③ reload.wav;
// ④ engine-loop.wav build_looped 循环 + set_speed(1.5) 变调。
// 程序判定:设备打开/解码/入队/播放推进(sink 非空→空)无错;
// 出声与音调变化请人耳确认(跑的时候音箱别静音)。

///|
async fn read_file(path : String) -> Bytes raise Error {
  let size = @fs.file_size(path)
  let f = @fs.open(path, mode=ReadOnly)
  let raw = f.read_exactly_at(size.to_int(), position=0)
  f.close()
  raw
}

///|
async fn main {
  println("[INFO] 打开默认输出设备(PulseAudio)…")
  let device_sink = @moon_rodio.DeviceSinkBuilder::open_default_sink() catch {
    e => {
      println("[FAIL] 设备打开失败: \{e}")
      return
    }
  }
  let mixer = device_sink.mixer()
  let all_ok = Ref(true)
  // ①②③ 一次性音效:ogg / mp3 / wav
  let oneshots : Array[(String, Int)] = [
    ("../client/assets/audio/cannon.ogg", 2000),
    ("../client/assets/audio/voice/v_ammo1.mp3", 2000),
    ("../client/assets/audio/reload.wav", 1500),
  ]
  for item in oneshots {
    let (path, wait_ms) = item
    let raw = read_file(path) catch {
      e => {
        println("[FAIL] 读文件 \{path}: \{e}")
        all_ok.val = false
        continue
      }
    }
    let dec = @moon_rodio.Decoder::builder().with_data(raw).build() catch {
        e => {
          println("[FAIL] 解码 \{path}: \{e}")
          all_ok.val = false
          continue
        }
      }
    let sink = @moon_rodio.Sink::connect_new(mixer)
    sink.append(dec)
    println("[PLAY] \{path}(\{raw.length()}B)已入队,播 \{wait_ms}ms")
    @async.sleep(wait_ms)
    if not(sink.empty()) {
      println("[INFO] \{path} 仍在播(长音)")
    }
    sink.stop()
  }
  // ④ 引擎循环 + 1.5 倍速变调(对应 audio.js 引擎音 playbackRate 语义)
  let engine = read_file("../client/assets/audio/engine-loop.wav") catch {
    e => {
      println("[FAIL] 读 engine-loop.wav: \{e}")
      return
    }
  }
  let looped = @moon_rodio.Decoder::builder().with_data(engine).build_looped() catch {
      e => {
        println("[FAIL] engine-loop.wav 解码: \{e}")
        all_ok.val = false
        return
      }
    }
  let sink = @moon_rodio.Sink::connect_new(mixer)
  sink.append(looped)
  sink.set_speed(1.5)
  println("[PLAY] engine-loop 循环 + speed=1.5,播 3000ms(应变高音)")
  @async.sleep(3000)
  if sink.empty() {
    println("[FAIL] 循环源意外播空")
    all_ok.val = false
  } else {
    println("[PASS] 循环源持续推进(sink 非空)")
  }
  sink.stop()
  println(
    if all_ok.val {
      "V8 结论: 三格式解码+播放全通,循环+变调链路可用 —— 出声与音高请人耳复核"
    } else {
      "V8 结论: 存在失败项,见上"
    },
  )
}
