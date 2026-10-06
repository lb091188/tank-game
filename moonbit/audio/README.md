# moonbit/audio — client/js/audio.js 的 MoonBit 原生对齐包

底层 moon_rodio 0.3.5(`Milky2018/moon_rodio`), 播放链路与已验证的 `v8_audio` 同源。
`audio_smoke` 子包为真设备冒烟入口。

## 能力面(对齐 audio.js)

| audio.js | 本包 |
| --- | --- |
| `SF.Assets.sounds[name]` 加载 | `Audio::load(name)` 按名加载 ogg/mp3/wav, 原始字节缓存(重播=缓存重解码, rodio Decoder 是一次性流) |
| `play(name, pos, opts)` | `Audio::play(name, opts~)` 一次性; `opts.gain`/`opts.rate`(=playbackRate); 并发上限 15(对齐 `voices>14` 拒播) |
| `startEngine()/startAmbient()` | `Audio::start_engine()`/`start_ambient()`; 通用 `start_loop(name, key~)` 命名循环, 同键重启先停旧声 |
| `setEngine(...)` 调速/音量 | `Voice::set_speed/set_gain`, 或 `Audio::set_loop_speed/set_loop_gain`; 实时生效 |
| `stopBattle()` | `Audio::stop_battle()`(只停循环) / `stop_all()`(全停) |
| `master.gain` | `Audio::set_volume/volume`(0..1), 经各 Sink 逐样本系数实时广播 |

搜索规则: `root/search_dir/name.ext`, 默认 root `../client/assets`(runCmd 在 moonbit/
模块根执行), 搜索目录 `["audio", "audio/voice"]`, 扩展名优先级 `["ogg","mp3","wav"]`。

## 与 JS 版的有意差异

- 无空间化(`play(pos)` 的距离衰减/声像)与低通滤波(CFG.audio 的 LP 面);
- 无系统 TTS 兜底(speechSynthesis), 语音播报=普通一次性播放;
- 每音独立 moon_rodio Sink(独立 gain/speed 控制); 声源排空后 Mixer 即回收声源。

## 已知环境限制(2026-10-06 验证机实测)

moon_cpal 0.11.8 ALSA 后端对 `default`(PipeWire 插件)PCM 启动即
`StreamInvalidated`, 音频线程零拉样 —— 所有 builder 变体、sync/async main 均复现;
同机 `aplay` 走同一 PCM 正常。属 moon_rodio/moon_cpal 依赖层缺陷, 因此:
本包单测全部无设备可跑(解码/缓存/播放调度用离线 `@moon_rodio.mixer` 注入驱动);
真设备出声验证交给 `audio_smoke`(设备不可用时以退出码 1 + 诊断失败, 不伪造通过)。
