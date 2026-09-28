#!/usr/bin/env bash
# 一键开服(联机主机用): 启动对战服务器(含邀请码系统)并打印给朋友的连接信息
# 前提: 本机装有 Node.js (v18+); 朋友从 http://<你的IP>:8342 打开页面即可
cd "$(dirname "$0")" || exit 1
PORT=8342

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "端口 $PORT 已有服务在跑, 直接看下方地址"
else
  node server/server.js "$PORT" &
fi
sleep 0.8
echo ""
echo "==================== 开服成功 ===================="
echo "  1. 你自己:   浏览器打开 http://127.0.0.1:$PORT/"
echo "  2. 联机对战: 创建房间 → 把『邀请码』发给朋友"
echo "  3. 朋友:     同一页面地址打开 → 凭邀请码加入"
echo "  关闭本窗口或 Ctrl+C 即停服"
echo "=================================================="
wait
