// audio — client/js/audio.js 能力面的 MoonBit 原生对齐包(moon_rodio 后端)。
//
// 对齐面(见 client/js/audio.js:5-93):
//   按名加载 ogg/mp3/wav(默认根 ../client/assets, 搜索 audio/ 与 audio/voice/) 带原始字节缓存;
//   一次性播放(可调 gain/rate, 对齐 JS play 的 opts.gain/opts.rate 与 voices>14 拒播上限);
//   命名循环播放(引擎声/环境音, speed/volume 可实时调, 对齐 startEngine/setEngine/startAmbient);
//   停止(单通道 stop_loop / 退出战斗 stop_battle / 全停 stop_all, 对齐 stopBattle);
//   全局主音量 set_volume(对齐 master.gain, 经 moon_rodio Sink 逐样本乘系数实时生效)。
//
// 与 JS 版的已知差异(原生无 WebAudio, 有意不做):
//   - 无空间化(play(pos) 的距离衰减/声像)与低通滤波(SF.CFG.audio 的 LP 面);
//   - 无系统 TTS 兜底(speechSynthesis), 语音播报退化为普通一次性播放;
//   - 一次性声的主音量变更对"已结束"的声自然无意义, 对活动声经 Voice::set_gain 实时生效。
//
// 底层事实(moon_rodio 0.3.5, 见其 sink.mbt): 每个 Sink 独立持有 volume/speed 控制并
// 逐样本应用(volume 在 ControlledQueueSource::next 里乘上), 故每音一 Sink、主音量广播
// 即可实时生效; Mixer 会在源结束时自动回收该源, 每音一 Sink 不泄漏。

///|
/// 播放参数: gain 声源增益(1.0 原声), rate 播放速度/变调(1.0 原速, 对齐 JS playbackRate)。
pub(all) struct PlayOpts {
  gain : Double
  rate : Double
}

///|
pub fn PlayOpts::new() -> PlayOpts {
  { gain: 1.0, rate: 1.0, }
}

///|
/// 并发声上限: JS `if (voices > 14) return` → 最多同时 15 个活动声, 第 16 个拒播。
const MAX_VOICES : Int = 15

///|
pub(all) enum AudioError {
  /// 打开输出设备失败或尚未 open()(参数为原因/提示)
  NoDevice(String)
  /// 按名找不到可读音频(参数: 名字, 尝试过的路径与底层错误)
  LoadFailed(String, String)
  /// 文件读到了但解码失败(参数: 名字, 解码器错误)
  DecodeFailed(String, String)
  /// 并发声已达上限拒播(参数: 当前活动声数)
  TooManyVoices(Int)
} derive(Eq, Debug)

///|
pub extend AudioError with Eq::{not_equal, equal}

///|
pub extend AudioError with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub fn AudioError::message(self : AudioError) -> String {
  match self {
    NoDevice(hint) => "输出设备未打开或打开失败: \{hint}"
    LoadFailed(name, detail) => "音频加载失败[\{name}]: \{detail}"
    DecodeFailed(name, detail) => "音频解码失败[\{name}]: \{detail}"
    TooManyVoices(n) =>
      "并发达上限(已有 \{n} 个活动声), 拒绝新声(对齐 JS voices>14)"
  }
}

///|
/// 一路声音的句柄: play() 的一次性声与 start_loop() 的循环声都用它控制。
/// base_gain 是该声自身增益, 实际输出 = base_gain × 主音量(主音量变更时由 Audio 广播)。
pub struct Voice {
  sink : @moon_rodio.Sink
  master : Ref[Double]
  base_gain : Ref[Double]
  key : String
  stopped : Ref[Bool]
}

///|
/// 停止该声(循环声停止后 is_active 即为 false; 一次性声停止后随 Mixer 回收)。
pub fn Voice::stop(self : Voice) -> Unit {
  self.stopped.val = true
  self.sink.stop()
}

///|
/// 实时调播放速度(变调)。非正值会被钳到 0.01(moon_rodio 对 <=0 直接 panic)。
pub fn Voice::set_speed(self : Voice, rate : Double) -> Unit {
  self.sink.set_speed(clamp_rate(rate))
}

///|
/// 实时调该声增益(再乘全局主音量), 对齐 JS 对 engineGain.gain 的直接赋值。
pub fn Voice::set_gain(self : Voice, gain : Double) -> Unit {
  let g = clamp01(gain)
  self.base_gain.val = g
  self.sink.set_volume(g * self.master.val)
}

///|
pub fn Voice::gain(self : Voice) -> Double {
  self.base_gain.val
}

///|
pub fn Voice::speed(self : Voice) -> Double {
  self.sink.speed()
}

///|
pub fn Voice::key(self : Voice) -> String {
  self.key
}

///|
/// 是否仍在出声(未停止且 sink 里还有声源)。循环声不 stop 则恒真。
pub fn Voice::is_active(self : Voice) -> Bool {
  !self.stopped.val && !self.sink.empty()
}

///|
/// 音频系统: 按名加载+缓存, 播放调度, 主音量。
/// 默认 root 为 "../client/assets"(runCmd 约定在 moonbit/ 模块根执行), 并兜底
/// 仓根相对布局——用法见 audio_smoke 与本包测试。
pub struct Audio {
  root : String
  /// 相对 root 的搜索子目录, 依次尝试
  mut search_dirs : Array[String]
  /// 尝试的扩展名(顺序即优先级)
  mut exts : Array[String]
  /// 名字 → 原始文件字节。moon_rodio Decoder 是一次性流, 重播靠缓存的重解码。
  cache : Map[String, Bytes]
  /// 全局主音量 0..1(对齐 JS master.gain)
  master : Ref[Double]
  /// 打开的设备 sink, 持引用保流存活
  mut device : @moon_rodio.MixerDeviceSink?
  /// 设备混音器; None = 尚未 open()。测试可经 attach_mixer 注入离线混音器。
  mut mixer : @moon_rodio.Mixer?
  /// 命名循环通道(engine/ambient/…), 同键 start 会先停旧声(单实例语义)
  loops : Map[String, Voice]
  /// 活动中的一次性声(用于主音量广播与并发上限)
  mut oneshots : Array[Voice]
}

///|
pub fn Audio::new(root? : String = "../client/assets") -> Audio {
  {
    root,
    search_dirs: ["audio", "audio/voice"],
    exts: ["ogg", "mp3", "wav"],
    cache: {},
    master: @ref.new(1.0),
    device: None,
    mixer: None,
    loops: {},
    oneshots: [],
  }
}

///|
/// 覆盖搜索子目录(链式)。
pub fn Audio::with_search_dirs(self : Audio, dirs : Array[String]) -> Audio {
  self.search_dirs = dirs
  self
}

///|
/// 覆盖扩展名优先级(链式)。
pub fn Audio::with_exts(self : Audio, exts : Array[String]) -> Audio {
  self.exts = exts
  self
}

///|
/// 打开默认输出设备(moon_rodio DeviceSinkBuilder::open_default_sink, 同 v8_audio)。
pub fn Audio::open(self : Audio) -> Result[Unit, AudioError] {
  let sink = @moon_rodio.DeviceSinkBuilder::open_default_sink() catch {
    e => return Err(NoDevice(e.to_string()))
  }
  self.device = Some(sink)
  self.mixer = Some(sink.mixer())
  Ok(())
}

///|
/// 离线/测试用: 不开设备, 直接挂一个混音器(如 @moon_rodio.mixer(2, 44100) 的产物),
/// 之后 play/start_loop 的全部链路(解码→入队→拉样→排空)都可无设备驱动。
pub fn Audio::attach_mixer(self : Audio, mixer : @moon_rodio.Mixer) -> Unit {
  self.mixer = Some(mixer)
}

///|
pub fn Audio::is_open(self : Audio) -> Bool {
  self.mixer is Some(_)
}

///|
/// 全局主音量(0..1, 越界钳制)。对活动中各声实时生效(广播到各 Sink 的逐样本系数)。
pub fn Audio::set_volume(self : Audio, v : Double) -> Unit {
  self.master.val = clamp01(v)
  self.apply_master()
}

///|
pub fn Audio::volume(self : Audio) -> Double {
  self.master.val
}

///|
/// 把主音量广播到所有活动声。
fn Audio::apply_master(self : Audio) -> Unit {
  for h in self.oneshots {
    h.sink.set_volume(h.base_gain.val * self.master.val)
  }
  for _, h in self.loops {
    h.sink.set_volume(h.base_gain.val * self.master.val)
  }
}

///|
/// 名字 → 候选路径(搜索目录×扩展名的笛卡尔积, 顺序即优先级)。
fn Audio::candidate_paths(self : Audio, name : String) -> Array[String] {
  let paths : Array[String] = []
  for d in self.search_dirs {
    for e in self.exts {
      paths.push("\{self.root}/\{d}/\{name}.\{e}")
    }
  }
  paths
}

///|
/// 探测名字对应的实际文件路径(不读入内存); 找不到返回 None。
pub fn Audio::resolve(self : Audio, name : String) -> String? {
  for path in self.candidate_paths(name) {
    let _ = @moon_rodio.Reader::from_file(path) catch { _ => continue }
    return Some(path)
  }
  None
}

///|
/// 按名加载(带缓存): 命中缓存直接返回; 否则按候选路径读首个可读文件进缓存。
/// moon_rodio Reader::from_file 对"不存在"与"读失败"同错(其 decoder_bridge.mbt:105
/// 把一切归为 UnrecognizedFormat), 故错误统一报 LoadFailed 并列出尝试过的路径。
pub fn Audio::load(self : Audio, name : String) -> Result[Bytes, AudioError] {
  match self.cache.get(name) {
    Some(bs) => Ok(bs)
    None => {
      let tried : Array[String] = []
      let mut last_err = ""
      for path in self.candidate_paths(name) {
        tried.push(path)
        let reader = @moon_rodio.Reader::from_file(path) catch {
          e => {
            last_err = e.to_string()
            continue
          }
        }
        let bs = reader.into_bytes()
        self.cache[name] = bs
        return Ok(bs)
      }
      Err(
        LoadFailed(
          name,
          "试过 \{tried.length()} 个路径(\{join(tried, "; ")}), 最后错误: \{last_err}",
        ),
      )
    }
  }
}

///|
pub fn Audio::is_cached(self : Audio, name : String) -> Bool {
  self.cache.get(name) is Some(_)
}

///|
pub fn Audio::cache_count(self : Audio) -> Int {
  self.cache.length()
}

///|
/// 按名解码为一次性流(对应 JS 一次性 BufferSource)。
fn Audio::decode_one(
  self : Audio,
  name : String,
) -> Result[@moon_rodio.Decoder, AudioError] {
  let bs = match self.load(name) {
    Ok(bs) => bs
    Err(e) => return Err(e)
  }
  let dec = @moon_rodio.Decoder::builder().with_data(bs).build() catch {
      e => return Err(DecodeFailed(name, e.to_string()))
    }
  Ok(dec)
}

///|
/// 按名解码为循环流(对应 JS loop=true 的引擎/环境声)。
fn Audio::decode_loop(
  self : Audio,
  name : String,
) -> Result[@moon_rodio.LoopedDecoder, AudioError] {
  let bs = match self.load(name) {
    Ok(bs) => bs
    Err(e) => return Err(e)
  }
  let dec = @moon_rodio.Decoder::builder().with_data(bs).build_looped() catch {
      e => return Err(DecodeFailed(name, e.to_string()))
    }
  Ok(dec)
}

///|
/// 一次性播放(对齐 JS play): 解码→独立 Sink 入队(own gain×主音量, rate 变调)。
/// 返回句柄可提前 stop; 声源排空后句柄 is_active 变 false 并在下次调度时被清理。
pub fn Audio::play(
  self : Audio,
  name : String,
  opts? : PlayOpts = PlayOpts::new(),
) -> Result[Voice, AudioError] {
  let mixer = match self.mixer {
    Some(m) => m
    None => return Err(NoDevice("play(\"\{name}\") 前先 open()"))
  }
  self.prune_oneshots()
  if self.oneshots.length() >= MAX_VOICES {
    return Err(TooManyVoices(self.oneshots.length()))
  }
  let dec = match self.decode_one(name) {
    Ok(dec) => dec
    Err(e) => return Err(e)
  }
  let sink = @moon_rodio.Sink::connect_new(mixer)
  sink.set_speed(clamp_rate(opts.rate))
  sink.set_volume(clamp01(opts.gain) * self.master.val)
  sink.append(dec)
  let h : Voice = {
    sink,
    master: self.master,
    base_gain: @ref.new(clamp01(opts.gain)),
    key: name,
    stopped: @ref.new(false),
  }
  self.oneshots.push(h)
  Ok(h)
}

///|
/// 命名循环播放(对齐 JS startEngine/startAmbient 的单实例语义):
/// 同键已有循环先停旧声再起新声。key 缺省用 name。
pub fn Audio::start_loop(
  self : Audio,
  name : String,
  key? : String = "",
  opts? : PlayOpts = PlayOpts::new(),
) -> Result[Voice, AudioError] {
  let k = if key == "" { name } else { key }
  match self.loops.get(k) {
    Some(old) => old.stop()
    None => ()
  }
  let mixer = match self.mixer {
    Some(m) => m
    None => return Err(NoDevice("start_loop(\"\{name}\") 前先 open()"))
  }
  let dec = match self.decode_loop(name) {
    Ok(dec) => dec
    Err(e) => return Err(e)
  }
  let sink = @moon_rodio.Sink::connect_new(mixer)
  sink.set_speed(clamp_rate(opts.rate))
  sink.set_volume(clamp01(opts.gain) * self.master.val)
  sink.append(dec)
  let h : Voice = {
    sink,
    master: self.master,
    base_gain: @ref.new(clamp01(opts.gain)),
    key: k,
    stopped: @ref.new(false),
  }
  self.loops[k] = h
  Ok(h)
}

///|
/// 玩家引擎声(对齐 JS startEngine 的 'engine-loop')。
pub fn Audio::start_engine(self : Audio) -> Result[Voice, AudioError] {
  self.start_loop("engine-loop", key="engine")
}

///|
/// 环境风声(对齐 JS startAmbient 的 'wind')。
pub fn Audio::start_ambient(self : Audio) -> Result[Voice, AudioError] {
  self.start_loop("wind", key="ambient", opts={ gain: 0.05, rate: 1.0, })
}

///|
/// 实时调某命名循环的速度(变调), 对齐 JS setEngine 的 playbackRate 侧。
/// 返回 false = 该键无循环。
pub fn Audio::set_loop_speed(self : Audio, key : String, rate : Double) -> Bool {
  match self.loops.get(key) {
    Some(h) => {
      h.set_speed(rate)
      true
    }
    None => false
  }
}

///|
/// 实时调某命名循环的增益(再乘主音量), 对齐 JS setEngine 的 gain 侧。
pub fn Audio::set_loop_gain(self : Audio, key : String, gain : Double) -> Bool {
  match self.loops.get(key) {
    Some(h) => {
      h.set_gain(gain)
      true
    }
    None => false
  }
}

///|
/// 停某命名循环; 返回是否存在该键。
pub fn Audio::stop_loop(self : Audio, key : String) -> Bool {
  match self.loops.get(key) {
    Some(h) => {
      h.stop()
      true
    }
    None => false
  }
}

///|
/// 退出战斗(对齐 JS stopBattle): 停所有命名循环(引擎/环境), 一次性短音放完自然结束。
pub fn Audio::stop_battle(self : Audio) -> Unit {
  for _, h in self.loops {
    h.stop()
  }
}

///|
/// 全停: 命名循环 + 一次性声全停(比 JS stopBattle 更彻底, 供关卡卸载/静音切换用)。
pub fn Audio::stop_all(self : Audio) -> Unit {
  self.stop_battle()
  for h in self.oneshots {
    h.stop()
  }
  self.prune_oneshots()
}

///|
/// 活动声数(一次性声先清理已排空的; 循环声只算未 stop 的)。
pub fn Audio::active_voice_count(self : Audio) -> Int {
  self.prune_oneshots()
  let mut n = 0
  for h in self.oneshots {
    if h.is_active() {
      n += 1
    }
  }
  for _, h in self.loops {
    if h.is_active() {
      n += 1
    }
  }
  n
}

///|
/// 丢弃已排空的一次性声。
fn Audio::prune_oneshots(self : Audio) -> Unit {
  let live : Array[Voice] = []
  for h in self.oneshots {
    if h.is_active() {
      live.push(h)
    }
  }
  self.oneshots = live
}

///|
fn clamp01(v : Double) -> Double {
  if v < 0.0 {
    0.0
  } else if v > 1.0 {
    1.0
  } else {
    v
  }
}

///|
/// moon_rodio Sink::set_speed 对 <=0 直接 panic(其 sink.mbt:300 guard), 这里钳到 0.01。
fn clamp_rate(rate : Double) -> Double {
  if rate < 0.01 {
    0.01
  } else {
    rate
  }
}

///|
fn join(items : Array[String], sep : String) -> String {
  let mut out = ""
  for i, s in items {
    if i > 0 {
      out += sep
    }
    out += s
  }
  out
}
