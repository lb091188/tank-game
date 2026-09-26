#!/usr/bin/env python3
# make-voices.py — 战斗语音重合成: 本地 Qwen3-TTS 零样本克隆
# 用法: /home/lkyh/soft/qwen3-tts/.venv/bin/python tools/make-voices.py <参考音频> "<参考音频逐字稿>" [输出目录]
# 依赖: ffmpeg(响度归一化+语速); TTS 服务: http://127.0.0.1:50000 (pm2 qwen3-tts)
import os, shutil, subprocess, sys, tempfile, time

from gradio_client import Client, handle_file

TTS = "http://127.0.0.1:50000"
TEMPO = 1.18   # 语速(不变调): 战场播报要快, 不拖沓
# 播报文案: 每事件多条变体(游戏内随机播), 短促带感叹号(TTS 按标点起势)
# 命名 v_<事件><序号>; 与 audio.js VOICE_VARIANTS/VOICE_TEXT 同步维护
LINES = {
    # 我打出去的结果
    "v_pen1":    "击穿！",     "v_pen2":    "打穿了！",   "v_pen3":    "吃我一炮！",
    "v_nopen1":  "未能击穿！", "v_nopen2":  "没打穿！",   "v_nopen3":  "装甲太硬！",
    "v_bounce1": "跳弹！",     "v_bounce2": "弹开了！",   "v_bounce3": "角度太刁！",
    "v_absorb1": "履带打断！", "v_absorb2": "断他履带！", "v_absorb3": "跑不掉了！",
    "v_gunout1": "火炮损毁！", "v_gunout2": "打哑他了！",
    "v_ram1":    "撞击命中！", "v_ram2":    "撞上去了！",
    "v_kill1":   "目标击毁！", "v_kill2":   "干掉一辆！", "v_kill3":   "送他上路！",
    "v_wipe1":   "敌军全歼！", "v_wipe2":   "一个不留！",
    # 我挨打了
    "v_hitpen1": "警告！被击穿！", "v_hitpen2": "装甲被击穿！", "v_hitpen3": "遭到贯穿！",
    "v_track1":  "履带断裂！", "v_track2":  "断带了！",   "v_track3":  "履带被打断！",
    "v_ammo1":   "弹药架受损！", "v_ammo2": "弹药架被击中！", "v_ammo3": "小心弹药架！",
    "v_engine1": "发动机受损！", "v_engine2": "发动机中弹！",
    "v_gun1":    "火炮受损！", "v_gun2":    "炮管打坏了！",
    "v_rammed1": "遭到撞击！", "v_rammed2": "车体被撞！",
    "v_splash1": "遭到炮击！", "v_splash2": "炮击！落点很近！",
    # 慢炮装填完毕(快炮只有音效)
    "v_reload1": "装填完毕！", "v_reload2": "弹药就绪！", "v_reload3": "装填完成！",
}

def main():
    ref_audio, ref_text = os.path.abspath(sys.argv[1]), sys.argv[2]
    outdir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), "..", "client/assets/audio/voice")
    assert os.path.exists(ref_audio), f"参考音频不存在: {ref_audio}"
    # 1) 预处理参考: 转 16k 单声道 wav(TTS 克隆标准输入)
    ref16 = os.path.join(tempfile.gettempdir(), "voice-ref-16k.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", ref_audio, "-ar", "16000", "-ac", "1", ref16], check=True)
    client = Client(TTS)
    # 2) 逐条克隆合成 → 响度归一化 + 提速(44.1k 单声道 mp3 96k)
    tmp = tempfile.mkdtemp(prefix="sfvoice-")
    for name, text in LINES.items():
        audio, _status = client.predict(
            ref_aud=handle_file(ref16), ref_txt=ref_text, use_xvec=True,
            text=text, lang_disp="Chinese", api_name="/run_voice_clone")
        wav = audio if isinstance(audio, str) else audio["path"] if isinstance(audio, dict) else None
        assert wav, f"{name} 合成失败: {audio}"
        dst = os.path.join(outdir, f"{name}.mp3")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav,
                        "-af", f"silenceremove=start_periods=1:start_threshold=-40dB,areverse,"
                               f"silenceremove=start_periods=1:start_threshold=-40dB,areverse,"
                               f"silenceremove=stop_periods=-1:stop_duration=0.22:stop_threshold=-38dB,"
                               f"atempo={TEMPO},loudnorm=I=-16:TP=-1.5:LRA=9",
                        "-ar", "44100", "-ac", "1", "-b:a", "96k", dst], check=True)
        print(f"✓ {name}: {text} → {dst}", flush=True)
        time.sleep(0.3)
    shutil.rmtree(tmp, ignore_errors=True)
    print("全部完成")

if __name__ == "__main__":
    main()
