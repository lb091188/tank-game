#!/usr/bin/env bash
# 一键开服: 同源托管客户端+联机服务; 管理页 http://127.0.0.1:8343 (铸钥匙/战绩)
# 前提: 本机装有 Node.js (v18+); 朋友从 http://<你的IP>:8342 打开页面即可
cd "$(dirname "$0")" || exit 1
PORT=8342

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "端口 $PORT 已有服务在跑"
else
  (cd server && npm install --silent 2>/dev/null)
  node server/server.js "$PORT" &
fi
sleep 0.8
echo ""
echo "==================== 开服成功 ===================="
echo "  朋友:  浏览器打开 http://<你的IP>:$PORT/"
echo "  你:    同页建房(先铸钥匙) 或 管理页 http://127.0.0.1:$((PORT+1))/"
echo "  钥匙:  curl -X POST -H 'X-Steel-Admin: 1' http://127.0.0.1:$((PORT+1))/admin/key"
echo "  关闭本窗口或 Ctrl+C 即停服"
echo "=================================================="
wait
