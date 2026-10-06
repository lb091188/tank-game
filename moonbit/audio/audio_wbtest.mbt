// audio 包内单测: 全部无设备可跑(解码/缓存/名字解析/错误面用真夹具文件;
// 播放链路用 @moon_rodio.mixer(2,44100) 的离线混音器注入, 拉样驱动到排空)。
// 真设备出声链路由 audio_smoke 子包负责。
// 夹具来源: bounce.wav / v_nopen2.mp3 为 client/assets 原文件小体积拷贝,
// cannon-mini.ogg 为 cannon.ogg 经 ffmpeg 截 0.25s 单声道重编码, broken.ogg 为纯文本假声。

///|
// runCmd 约定在 moonbit/ 模块根执行, 兜底仓根相对路径(同 tracecheck 惯例)
fn fixture_audio() -> Audio {
  let a = Audio::new(root="audio").with_search_dirs(["fixtures"])
  match a.resolve("bounce") {
    Some(_) => a
    None => Audio::new(root="moonbit/audio").with_search_dirs(["fixtures"])
  }
}

///|
fn approx(a : Double, b : Double) -> Bool {
  (a - b).abs() <= 1.0e-9
}

///|
test "load 三格式(wav/ogg/mp3)与缓存命中" {
  let a = fixture_audio()
  assert_eq(a.cache_count(), 0)
  let wav = match a.load("bounce") {
    Ok(bs) => bs
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(wav.length() > 10000, true)
  assert_eq(a.is_cached("bounce"), true)
  assert_eq(a.cache_count(), 1)
  // 再取同一名字: 命中缓存(内容一致, 且不再走盘)
  match a.load("bounce") {
    Ok(bs) => assert_eq(bs.length(), wav.length())
    Err(e) => fail("\{e.message()}")
  }
  // ogg / mp3 各加载一份
  assert_eq(
    match a.load("cannon-mini") {
      Ok(bs) => bs.length() > 1000
      Err(e) => fail("\{e.message()}")
    },
    true,
  )
  assert_eq(
    match a.load("v_nopen2") {
      Ok(bs) => bs.length() > 1000
      Err(e) => fail("\{e.message()}")
    },
    true,
  )
  assert_eq(a.cache_count(), 3)
}

///|
test "load 未知名报 LoadFailed 且列出尝试路径" {
  let a = fixture_audio()
  match a.load("no_such_sound") {
    Ok(_) => fail("未知名不应加载成功")
    Err(LoadFailed(name, detail)) => {
      assert_eq(name, "no_such_sound")
      assert_eq(detail.contains("no_such_sound.ogg"), true)
      assert_eq(detail.contains("no_such_sound.wav"), true)
      assert_eq(detail.contains("no_such_sound.mp3"), true)
    }
    Err(other) => fail("应报 LoadFailed, 实际 \{other.message()}")
  }
}

///|
test "未 open() 时播放类调用报 NoDevice" {
  let a = fixture_audio()
  assert_eq(a.is_open(), false)
  match a.play("bounce") {
    Ok(_) => fail("无设备 play 不应成功")
    Err(NoDevice(_)) => ()
    Err(other) => fail("应报 NoDevice, 实际 \{other.message()}")
  }
  match a.start_loop("bounce", key="engine") {
    Ok(_) => fail("无设备 start_loop 不应成功")
    Err(NoDevice(_)) => ()
    Err(other) => fail("应报 NoDevice, 实际 \{other.message()}")
  }
}

///|
test "三格式解码元数据 + 循环解码 + 垃圾数据解码失败" {
  let a = fixture_audio()
  for name in ["bounce", "cannon-mini", "v_nopen2"] {
    match a.decode_one(name) {
      Ok(dec) => {
        assert_eq(dec.channels() >= 1, true)
        assert_eq(dec.sample_rate() > 0, true)
      }
      Err(e) => fail("解码 \{name}: \{e.message()}")
    }
  }
  match a.decode_loop("bounce") {
    Ok(dec) => assert_eq(dec.sample_rate() > 0, true)
    Err(e) => fail("循环解码 bounce: \{e.message()}")
  }
  // broken.ogg: 可读但不可解码 → DecodeFailed
  match a.decode_one("broken") {
    Ok(_) => fail("纯文本假声不应解码成功")
    Err(DecodeFailed(name, _)) => assert_eq(name, "broken")
    Err(other) => fail("应报 DecodeFailed, 实际 \{other.message()}")
  }
}

///|
test "LoopedDecoder 真循环: 拉两倍时长样不枯竭" {
  let a = fixture_audio()
  let dec = match a.decode_loop("bounce") {
    Ok(dec) => dec
    Err(e) => fail("\{e.message()}")
  }
  let total = dec.sample_rate() * dec.channels() * 2
  let mut ok = true
  for _ in 0..<total {
    if dec.next() is None {
      ok = false
      break
    }
  }
  assert_eq(ok, true)
}

///|
test "resolve 命中与未命中" {
  let a = fixture_audio()
  match a.resolve("bounce") {
    Some(path) => assert_eq(path.contains("bounce.wav"), true)
    None => fail("bounce 应能解析到")
  }
  assert_eq(a.resolve("no_such_sound") is None, true)
}

///|
test "离线混音器全链路: play→拉样→排空→清理" {
  let a = fixture_audio()
  let (mixer, src) = @moon_rodio.mixer(2, 44100)
  a.attach_mixer(mixer)
  assert_eq(a.is_open(), true)
  let v = match a.play("bounce") {
    Ok(v) => v
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(v.is_active(), true)
  assert_eq(v.key(), "bounce")
  assert_eq(a.oneshots.length(), 1)
  // 拉样驱动直到声源被消费完。注意 moon_rodio Sink::new() 是 keep_alive_if_empty=true
  // (其 sink.mbt:222 queue(true)): 声源放完后队列转静音兜底, MixerSource::next() 永不
  // 返回 None, 故排空信号用 sound_count→0(empty()/is_active()), 不是混音器枯竭。
  let mut drained = false
  let mut pulled = 0
  while pulled < 200000 {
    pulled += 1
    let _ = src.next()
    if !v.is_active() {
      drained = true
      break
    }
  }
  assert_eq(drained, true)
  assert_eq(v.sink.empty(), true)
  assert_eq(v.is_active(), false)
  assert_eq(a.active_voice_count(), 0)
  // 再播一次: 上一声已被清理, 不累积
  match a.play("bounce", opts={ gain: 0.5, rate: 1.0, }) {
    Ok(_) => ()
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(a.oneshots.length(), 1)
}

///|
test "并发声上限 15(对齐 JS voices>14 拒播)" {
  let a = fixture_audio()
  let (mixer, _src) = @moon_rodio.mixer(2, 44100)
  a.attach_mixer(mixer)
  let mut ok_count = 0
  for _ in 0..<15 {
    match a.play("bounce") {
      Ok(_) => ok_count += 1
      Err(e) => fail("第 \{ok_count + 1} 个声被拒: \{e.message()}")
    }
  }
  assert_eq(ok_count, 15)
  match a.play("bounce") {
    Ok(_) => fail("第 16 个并发声应被拒")
    Err(TooManyVoices(n)) => assert_eq(n, 15)
    Err(other) => fail("应报 TooManyVoices, 实际 \{other.message()}")
  }
}

///|
test "主音量: 钳制/取值/对活动声实时广播" {
  let a = fixture_audio()
  a.set_volume(0.5)
  assert_eq(a.volume(), 0.5)
  a.set_volume(7.0)
  assert_eq(a.volume(), 1.0)
  a.set_volume(-3.0)
  assert_eq(a.volume(), 0.0)
  a.set_volume(0.5)
  let (mixer, _src) = @moon_rodio.mixer(2, 44100)
  a.attach_mixer(mixer)
  let v = match a.play("bounce", opts={ gain: 0.8, rate: 1.0, }) {
    Ok(v) => v
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(v.gain(), 0.8)
  assert_eq(approx(v.sink.volume(), 0.8 * 0.5), true)
  // 主音量变更广播到活动一次性声
  a.set_volume(1.0)
  assert_eq(approx(v.sink.volume(), 0.8), true)
  // 循环声同样被广播
  let eng = match
    a.start_loop("bounce", key="engine", opts={ gain: 0.9, rate: 1.0, }) {
    Ok(h) => h
    Err(e) => fail("\{e.message()}")
  }
  a.set_volume(0.25)
  assert_eq(approx(eng.sink.volume(), 0.9 * 0.25), true)
  assert_eq(approx(v.sink.volume(), 0.8 * 0.25), true)
}

///|
test "命名循环: 启动/变速/同键重启/停止/便捷方法" {
  let a = fixture_audio()
  let (mixer, src) = @moon_rodio.mixer(2, 44100)
  a.attach_mixer(mixer)
  let v1 = match a.start_loop("bounce", key="engine") {
    Ok(h) => h
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(v1.is_active(), true)
  v1.set_speed(1.5)
  assert_eq(approx(v1.speed(), 1.5), true)
  // 非正速度钳到 0.01, 不触发 moon_rodio 的 panic guard
  v1.set_speed(0.0)
  assert_eq(approx(v1.speed(), 0.01), true)
  // 拉一截样: 循环源不枯竭
  let mut alive = true
  for _ in 0..<2000 {
    if src.next() is None {
      alive = false
      break
    }
  }
  assert_eq(alive, true)
  assert_eq(v1.is_active(), true)
  // 便捷方法: set_loop_speed / set_loop_gain
  assert_eq(a.set_loop_speed("engine", 1.25), true)
  assert_eq(approx(v1.speed(), 1.25), true)
  assert_eq(a.set_loop_gain("engine", 0.5), true)
  assert_eq(approx(v1.gain(), 0.5), true)
  assert_eq(a.set_loop_speed("no_such_key", 2.0), false)
  // 同键重启: 旧声停, 新声活, 通道仍单实例
  let v2 = match a.start_loop("bounce", key="engine") {
    Ok(h) => h
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(v1.is_active(), false)
  assert_eq(v2.is_active(), true)
  assert_eq(a.loops.length(), 1)
  // 停止
  assert_eq(a.stop_loop("engine"), true)
  assert_eq(v2.is_active(), false)
  assert_eq(a.stop_loop("no_such_key"), false)
  assert_eq(a.active_voice_count(), 0)
}

///|
test "stop_all 全停与 stop_battle 只停循环" {
  let a = fixture_audio()
  let (mixer, _src) = @moon_rodio.mixer(2, 44100)
  a.attach_mixer(mixer)
  let eng = match a.start_loop("bounce", key="engine") {
    Ok(h) => h
    Err(e) => fail("\{e.message()}")
  }
  let one = match a.play("bounce") {
    Ok(h) => h
    Err(e) => fail("\{e.message()}")
  }
  // stop_battle(对齐 JS stopBattle): 只停命名循环, 一次性声不动
  a.stop_battle()
  assert_eq(eng.is_active(), false)
  assert_eq(one.is_active(), true)
  // stop_all: 连一次性声一起停
  a.stop_all()
  assert_eq(one.is_active(), false)
  assert_eq(a.active_voice_count(), 0)
}

///|
test "PlayOpts 缺省与自定义 rate 生效" {
  let a = fixture_audio()
  let (mixer, _src) = @moon_rodio.mixer(2, 44100)
  a.attach_mixer(mixer)
  let v = match a.play("bounce", opts={ gain: 1.0, rate: 0.75, }) {
    Ok(h) => h
    Err(e) => fail("\{e.message()}")
  }
  assert_eq(approx(v.speed(), 0.75), true)
  ignore(PlayOpts::new())
}
