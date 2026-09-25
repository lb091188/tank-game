#!/usr/bin/env bash
# 一键启动《钢铁前沿》: 起 no-cache 静态服务并打开浏览器
cd "$(dirname "$0")" || exit 1
PORT=8341

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "端口 $PORT 已有服务, 直接打开页面"
else
  node server/dev-static.js "$PORT" &
fi
sleep 0.6
(xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 \
  || open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 \
  || echo "请手动打开: http://127.0.0.1:$PORT/")
echo "《钢铁前沿》运行中 → http://127.0.0.1:$PORT/   (关闭本窗口或 Ctrl+C 停止服务)"
wait
