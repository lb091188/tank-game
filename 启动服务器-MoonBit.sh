#!/usr/bin/env bash
# 一键开服(MoonBit 原生版): server/server.js 的等价实现, 协议完全一致, 客户端零改动
# 前提: 本机装有 moon 工具链 (https://docs.moonbitlang.com/ 安装); 朋友从 http://<你的IP>:8342 打开页面即可
cd "$(dirname "$0")" || exit 1
PORT=8342
BIN="moonbit/_build/native/release/build/server/server.exe"

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "端口 $PORT 已有服务在跑, 直接看下方地址"
else
  # 二进制不存在或源码有更新时重新构建 (moon 增量编译, 平时秒过)
  echo "构建 MoonBit 服务器..."
  (cd moonbit && moon build --release 2>/dev/null) || { echo "构建失败, 请确认已安装 moon 工具链"; exit 1; }
  "$BIN" "$PORT" &
fi
sleep 0.8
echo ""
echo "==================== 开服成功 (MoonBit 原生) ===================="
echo "  1. 你自己:   浏览器打开 http://127.0.0.1:$PORT/"
echo "  2. 联机对战: 创建房间 → 把『邀请码』发给朋友"
echo "  3. 朋友:     同一页面地址打开 → 凭邀请码加入"
echo "  关闭本窗口或 Ctrl+C 即停服"
echo "================================================================"
wait
