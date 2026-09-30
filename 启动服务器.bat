@echo off
rem 一键开服: 同源托管客户端+联机服务; 管理页 http://127.0.0.1:8343 (铸钥匙/战绩)
cd /d %~dp0
start "steel-front-server" /min cmd /c "cd server && npm install && node server.js 8342"
timeout /t 2 >nul
start http://127.0.0.1:8342/
echo 朋友: 浏览器打开 http://<你的IP>:8342/   管理: http://127.0.0.1:8343/
pause
