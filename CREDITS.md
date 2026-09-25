# 音效来源与授权 (CREDITS)

游戏音效来自 OpenGameArt.org 的开源音源。替换/分发时请保留本文件。

| 用途 | 文件 | 来源 | 作者 | 授权 |
|---|---|---|---|---|
| 坦克开炮 | `audio/cannon.ogg` | [Cannon fire](https://opengameart.org/content/cannon-fire) | — | **CC0**（公有领域，无需署名） |
| 坦克引擎循环 | `audio/engine-loop.wav` | [Engine-loop heavy vehicle/tank](https://opengameart.org/content/engine-loop-heavy-vehicletank) | **Nayckron**（qubodup 整理） | **CC-BY 3.0**（需署名：请注明作者 Nayckron 与来源链接） |
| 爆炸/殉爆 | `audio/explosion.wav` | [Explosion](https://opengameart.org/content/explosion-0) | — | **CC0** |
| 击穿(金属穿透) | `audio/pen.wav` | [Metal Impact Sounds](https://opengameart.org/content/metal-impact-sounds) | Brian MacIntosh | **CC0**（可选署名） |
| 跳弹(金属弹开) | `audio/bounce.wav` | 同上 | Brian MacIntosh | CC0 |
| 未击穿(闷响) | `audio/nopen.wav` | 同上 | Brian MacIntosh | CC0 |
| 履带断裂 | `audio/track.wav` | 同上 | Brian MacIntosh | CC0 |
| 装填完成 | `audio/reload.wav` | 同上 | Brian MacIntosh | CC0 |
| 环境风声 | `audio/wind.wav` | 程序合成（tools/build-audio.js） | 本项目 | 项目自身 |
| 中文战斗语音 ×11 | `audio/voice/v_*.mp3` | edge-tts 生成（zh-CN-YunjianNeural 神经语音） | 微软 Azure 神经语音 | **仅限个人/非商用使用**（edge-tts 走微软在线服务；商业发行需换自录或购买授权的语音） |

- 引擎音经过 playbackRate 变调处理（随车速 0.88–1.62 倍速），属对原素材的使用性修改。
- 语音重新生成方法：`python3 -c "..."`（见 git 历史或用 edge-tts，VOICE=zh-CN-YunjianNeural）。
- 若商业发行：CC-BY 素材（引擎循环）必须在游戏内或发行说明中保留署名；CC0 无义务但建议保留本文件；**语音需替换为自有版权音源**。
- 备用合成音源在 `audio/synth/`（由 tools/build-audio.js 生成），与开源音源互不影响。
