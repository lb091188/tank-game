// audio_smoke — 音频管线冒烟: 顺序播 3 个音(ogg 一次性 / wav 一次性 / 引擎循环变速变音量)
// 后正常退出(退出码 0)。设备与链路自动判定: sink 排空=设备在消费; 超时未排空=设备链路
// 无拉样进度, 以退出码 1 失败并给出诊断(不伪造通过)。音色/变调听感请人耳复核。
// 对应 client/js/audio.js 的 play / startEngine / setEngine / stopBattle 面;
// 空间化(pan/距离衰减)与 TTS 兜底不在原生对齐范围(见 moonbit/audio/README.md)。
//
// 已知环境问题(2026-10-06, 本仓验证机实测): moon_cpal 0.11.8 ALSA 后端对 "default"
// (PipeWire 插件)PCM 启动即 StreamInvalidated, 音频线程零拉样, 所有 builder 变体与
// sync/async 均复现; 同机 aplay 走同一 PCM 正常 → moon_rodio/moon_cpal 依赖层缺陷,
// 在此环境下本冒烟会以 FAIL(退出码 1)收场, 解码/入队链路由包内单测独立覆盖。

///|
extern "C" fn c_exit(code : Int) -> Unit = "exit"

///|
/// 失败出口: 打印 [FAIL] 并以退出码 1 结束。泛型返回 + panic() 使其可发散,
/// 直接用在 match 臂里(进程在 c_exit 处已终止, panic 不会真的执行)。
fn[T] die(msg : String) -> T {
  println("[FAIL] \{msg}")
  c_exit(1)
  panic()
}

///|
// runCmd 约定在 moonbit/ 模块根执行(../client/assets); 兜底仓根相对布局(client/assets)
fn pick_audio() -> @audio.Audio {
  let primary = @audio.Audio::new(root="../client/assets")
  if primary.resolve("engine-loop") is Some(_) {
    return primary
  }
  let fallback = @audio.Audio::new(root="client/assets")
  if fallback.resolve("engine-loop") is Some(_) {
    return fallback
  }
  primary
}

///|
/// 等一次性声排空; 超时仍活着返回 false。
async fn wait_done(v : @audio.Voice, timeout_ms : Int) -> Bool {
  let mut waited = 0
  while v.is_active() && waited < timeout_ms {
    @async.sleep(20)
    waited += 20
  }
  !v.is_active()
}

///|
async fn main {
  println("[INFO] audio_smoke: 打开默认输出设备…")
  let audio = pick_audio()
  match audio.open() {
    Err(e) => die("设备打开失败: \{e.message()}")
    Ok(_) => println("[PASS] 设备已打开")
  }
  // ① cannon.ogg 一次性(火炮)
  let cannon = match audio.play("cannon") {
    Ok(v) => v
    Err(e) => die("① cannon 播放失败: \{e.message()}")
  }
  println("[PLAY] ① cannon (ogg) 一次性")
  if !wait_done(cannon, 8000) {
    die(
      "① cannon 8s 未排空 → 设备未消费声源(音频线程无拉样进度; 解码/入队已由包内单测覆盖)。见 main.mbt 头注的环境问题说明",
    )
  }
  println("[PASS] ① cannon 排空(设备在实时消费)")
  // ② reload.wav 一次性(装填), 0.8 倍增益 1.1 倍速体现 opts 面
  let reload = match audio.play("reload", opts={ gain: 0.8, rate: 1.1, }) {
    Ok(v) => v
    Err(e) => die("② reload 播放失败: \{e.message()}")
  }
  println("[PLAY] ② reload (wav) 一次性 gain=0.8 rate=1.1")
  if !wait_done(reload, 8000) {
    die("② reload 8s 未排空 → 设备未消费声源")
  }
  println("[PASS] ② reload 排空")
  // ③ engine-loop.wav 循环(引擎): 起速→提速变调变音量→主音量→停, 对齐 startEngine/setEngine
  let engine = match audio.start_engine() {
    Ok(v) => v
    Err(e) => die("③ engine-loop 启动失败: \{e.message()}")
  }
  println("[PLAY] ③ engine-loop (wav) 循环 speed=1.0")
  @async.sleep(1000)
  if !engine.is_active() {
    die("③ engine 循环意外播空")
  }
  engine.set_speed(1.5)
  engine.set_gain(0.8)
  println(
    "[INFO] ③ 提速 speed=1.5 gain=0.8(应听到音调变高、变响)…",
  )
  @async.sleep(1500)
  if !engine.is_active() {
    die("③ engine 循环在变速后意外播空")
  }
  println("[PASS] ③ 循环源持续推进(sink 非空)")
  audio.set_volume(0.5)
  @async.sleep(600)
  println("[INFO] ③ 主音量降到 0.5(应变轻)…")
  engine.stop()
  audio.stop_all()
  if audio.active_voice_count() != 0 {
    die("stop_all 后仍有活动声")
  }
  println("[PASS] ③ engine 已停, 全部声源清零")
  println(
    "AUDIO SMOKE PASS: 3 音顺序播放完毕, 正常退出(音色/变调请人耳复核)",
  )
}
