# 交接: 在本机(Linux)补合成 v_supply 战斗语音并部署上线

> 交接来源: Windows 开发机 ZCode 会话, 2026-10-02。本文件自包含, 无需原会话上下文。
> 对应提交: `f9cb3be`(make-voices.py LINES 已补 v_supply 两条文案), 拉取 main 最新即可。

## 背景

- 补给玩法(pickups)在代码里登记了战斗语音变体 `v_supply`(2 条):
  - `client/js/audio.js` 的 VOICE_VARIANTS(`v_supply: 2`)与 VOICE_TEXT(`['补给已送达！', '空投补给，请查收！']`)
  - `client/js/assets.js` 变体表同步登记
- 但语音合成脚本 `tools/make-voices.py` 的 LINES 当时漏了同步 → `v_supply1.mp3` / `v_supply2.mp3` 从未合成。仓库 `client/assets/audio/voice/` 现有 41 个 mp3, 独缺这两个。
- 现状影响: 本地与线上(game.liuziheng.top:17820)控制台各报两条 404, 然后退回系统 TTS 播报——功能不受影响, 本次是把兜底换成真人克隆语音。
- 上一提交 `f9cb3be` 已把两条文案补进 make-voices.py LINES(与 audio.js 逐字一致), 本机可直接重跑。

## 本机环境(来自 make-voices.py 用法注释, 以实际为准)

- TTS 服务: `http://127.0.0.1:50000`(Qwen3-TTS 零样本克隆, pm2 进程名 `qwen3-tts`), 先 `pm2 ls` 确认在跑, 没跑先拉起来。
- 运行解释器: `/home/lkyh/soft/qwen3-tts/.venv/bin/python`(gradio_client 装在该 venv)。
- 还需要 `ffmpeg`(静音裁剪/响度归一/提速用)。

## 任务步骤

1. **向用户要参考音频**: 合成需要"参考音频文件 + 其逐字稿"两个参数(上次合成 41 条语音用的那套)。若用户一时找不到, 问清楚路径再继续, 不要用随便的音频顶替(音色会变, 与现有 41 条不一致)。
2. **决定合成范围**(二选一, 默认走 ②):
   - ① 只补两条: 临时把 LINES 里除 `v_supply1/v_supply2` 外的条目注释掉再跑(跑完还原, 临时改动**不要提交**)。
   - ② 全量重合成: LINES 全部 43 条重跑。同一参考音频音色一致, 但其余 41 个 mp3 字节会变(每次合成有随机性), diff 大、历史体积涨, 需用户点头。
3. **执行**(在仓库根目录):
   ```bash
   /home/lkyh/soft/qwen3-tts/.venv/bin/python tools/make-voices.py <参考音频> "<参考音频逐字稿>"
   ```
4. **校验产物**: `client/assets/audio/voice/v_supply1.mp3`、`v_supply2.mp3` 出现; `ffprobe`(或 `ffmpeg -i`)确认时长在 1~3 秒量级、44.1k 单声道; 人工听一遍不炸音不拖沓。
5. **入库**: `git add client/assets/audio/voice/v_supply1.mp3 v_supply2.mp3` 后提交(中文详述风格, 说明是补齐 pickups 补给播报), push 到 origin main——Windows 开发机要同步这两个文件。
6. **部署到 game.liuziheng.top**: 按 `deploy.config.json` 流程重传 client 目录(目标 `/application/tank-game/client`)。静态文件 server.js 是逐请求 readFile, **无需 pm2 restart**。
7. **线上验证**:
   ```bash
   curl -sI https://game.liuziheng.top:17820/assets/audio/voice/v_supply1.mp3   # 期望 200
   ```
   再开页面打一局捡补给, 控制台不应再出现"语音文件缺失, 将退回系统TTS: v_supply*"。

## 不要顺手"修"的东西

- `GET /edition.js 404` 是设计内行为: 仅 pages.dev 静态版生成 edition.js(build-pages-dist.js 写 `SF_EDITION='pve'` 隐藏联机入口), 自托管完整版靠 index.html 里 script 标签的 onerror 标记 `full`。**不是 bug, 别加文件**。
- nginx 已修好 WebSocket 透传(Upgrade/Connection 三行), 线上联机正常, 不用再动。
