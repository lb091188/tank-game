@echo off
rem 一键启动《钢铁前沿》: 起 no-cache 静态服务并打开浏览器
cd /d %~dp0
start "steel-front-server" /min node server\dev-static.js 8341
timeout /t 1 /nobreak >nul
start http://127.0.0.1:8341/
echo 《钢铁前沿》运行中 → http://127.0.0.1:8341/   (关闭标题为 steel-front-server 的窗口即停止服务)
