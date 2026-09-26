#!/usr/bin/env python3
# make-voices.py — 战斗语音重合成: 本地 Qwen3-TTS 零样本克隆
# 用法: /home/lkyh/soft/qwen3-tts/.venv/bin/python tools/make-voices.py <参考音频> "<参考音频逐字稿>" [输出目录]
# 依赖: ffmpeg(响度归一化); TTS 服务: http://127.0.0.1:50000 (pm2 qwen3-tts)
import os, shutil, subprocess, sys, tempfile, time

from gradio_client import Client, handle_file

TTS = "http://127.0.0.1:50000"
# 播报文案: 短促带感叹号(TTS 按标点起势), 与 audio.js VOICE_TEXT 同步维护
LINES = {
    "v_pen":    "击穿！",
    "v_nopen":  "未能击穿！",
    "v_bounce": "跳弹！",
    "v_miss":   "未命中！",
    "v_kill":   "目标击毁！",
    "v_hitpen": "警告！装甲被击穿！",
    "v_track":  "履带断裂！",
    "v_ammo":   "弹药架受损！",
    "v_engine": "发动机受损！",
    "v_gun":    "火炮受损！",
    "v_reload": "装填完毕！",
}

def main():
    ref_audio, ref_text = os.path.abspath(sys.argv[1]), sys.argv[2]
    outdir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), "..", "client/assets/audio/voice")
    assert os.path.exists(ref_audio), f"参考音频不存在: {ref_audio}"
    # 1) 预处理参考: 转 16k 单声道 wav(TTS 克隆标准输入)
    ref16 = os.path.join(tempfile.gettempdir(), "voice-ref-16k.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", ref_audio, "-ar", "16000", "-ac", "1", ref16], check=True)
    client = Client(TTS)
    # 2) 逐条克隆合成 → 响度归一化(44.1k 单声道 mp3 96k, 与旧文件一致)
    tmp = tempfile.mkdtemp(prefix="sfvoice-")
    for name, text in LINES.items():
        audio, _status = client.predict(
            ref_aud=handle_file(ref16), ref_txt=ref_text, use_xvec=True,
            text=text, lang_disp="Chinese", api_name="/run_voice_clone")
        wav = audio if isinstance(audio, str) else audio["path"] if isinstance(audio, dict) else None
        assert wav, f"{name} 合成失败: {audio}"
        dst = os.path.join(outdir, f"{name}.mp3")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav,
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=9", "-ar", "44100", "-ac", "1",
                        "-b:a", "96k", dst], check=True)
        print(f"✓ {name}: {text} → {dst}")
        time.sleep(0.3)
    shutil.rmtree(tmp, ignore_errors=True)
    print("全部完成")

if __name__ == "__main__":
    main()
