# 钢铁前沿 (steel-front)

浏览器 3D 坦克游戏。坦克世界式手感（缩圈/部位装甲/俯仰规则/点亮机制），单机闯关 + 内网联机。
全部资产程序化生成，零版权风险，零 npm 依赖（联机服务器仅 ws 一个）。

**🎮 在线玩：https://lb091188.github.io/tank-game/** （推送 main 自动部署）

## 玩法内容

- **49 辆坦克**：德/苏/美/英/法/日/中七个国家，III-VIII 级（虎王、黑豹、IS-3、T-34-85、59 式、WZ-111、地狱猫……），含弹夹连发车（AMX 13 75/AMX 50 100/洛林 40t）与自行火炮（黄蜂/野蜂/M7 牧师/SU-26），史实轮廓特征 + 参数化建模
- **3 张 1000×1000m 地图**：诺曼底树篱田野 / 废墟城市巷战 / 山川高地峡谷
- **单机闯关**：波次制遭遇战，敌军等级随你的车型动态匹配，出生点每局随机，AI 会无线电呼叫支援
- **联机**：死斗（3 分钟计分）与合作闯关，2-8 人，主机权威判定；对战服务器同源托管客户端，打开即玩无需填地址

## 运行

单机（二选一）：

- 在线 PvE 版直接玩（上方链接，GitHub Pages 部署，不含联机入口）
- 本地：`node server/dev-static.js 8341`

联机开服（Node.js 18+，同源托管客户端——朋友浏览器打开页面即玩，无需安装任何东西）：

```bash
cd server && npm install && npm start
```

开服后玩家流程：浏览器打开 `http://<你的IP>:8342` → 点「⚔ 联机对战」→ 地址留空（自动连本服）→ 房主兑换钥匙后「创建房间」（可设房间密码）→ 把房间号+密码发给朋友 → 房主选模式与地图开局。

## 准入模型（钥匙 / 通行令牌 / 房间密码）

- **建房需通行令牌**：管理员铸造一次性钥匙（按次数+有效期），玩家在联机面板兑换成通行令牌（存本浏览器，30 天）
- **进房凭房间号+密码**：密码建房时选填，按需设置
- **战绩按昵称归档**：无账号体系，管理页按昵称汇总场次/击杀/合作胜场
- 局域网自由模式：`STEEL_OPEN=1 node server/server.js` 关闭建房门禁

## 管理（curl 友好，全部需头 `-H 'X-Steel-Admin: 1'`）

管理端点只听 `127.0.0.1:<游戏端口+1>`；浏览器直接开 `http://127.0.0.1:8343/` 也有内置管理页。

```bash
# 铸钥匙 (默认 5 次 / 24 小时) → 输出 JSON 里的 key 发进团队群
curl -X POST -H 'X-Steel-Admin: 1' 'http://127.0.0.1:8343/admin/key?uses=5&ttl=86400'

curl -H 'X-Steel-Admin: 1' http://127.0.0.1:8343/admin/status    # 房间/玩家/记录概况
curl -H 'X-Steel-Admin: 1' http://127.0.0.1:8343/admin/keys      # 在役钥匙与令牌
curl -X POST -H 'X-Steel-Admin: 1' 'http://127.0.0.1:8343/admin/revoke?token=<令牌>'   # 吊销
curl -H 'X-Steel-Admin: 1' 'http://127.0.0.1:8343/admin/records?limit=50'              # 最近对局
curl -H 'X-Steel-Admin: 1' http://127.0.0.1:8343/admin/players   # 按昵称汇总档案
```

VPS 无浏览器：`ssh -L 8343:127.0.0.1:8343 你的vps` 后本地打开管理页，或直接在服务器上 curl（配合网页终端工具拿 JSON 输出）。

公网部署（可选）：任意反代终止 TLS 即可（Caddy 三行），页面与 WS 同源走 `wss://`，玩家地址填域名或留空同源自动连接。战斗记录落盘 `server/records/battles.jsonl`（JSONL，备份即复制）。协议回归测试：`node tools/steel-ws-test.js [端口] [管理端口]`（31 项）。

## 操作

| 按键 | 功能 |
|---|---|
| W / S | 前进 / 倒车 |
| A / D | 车体转向 |
| 鼠标 | 瞄准（点击画面锁定指针） |
| 左键 | 开炮 |
| 滚轮 / Shift | 缩放 / 狙击镜（狙击镜中滚轮退出） |
| 右键按住 | 自由视角（炮塔锁定） |
| R / F | 巡航前进 / 倒车 |
| E | 自动瞄准准星处目标 |
| M | 大地图 |
| Tab | 任务详情 |

核心规则与坦克世界一致：停车缩圈再开炮；入射角 >70° 跳弹、等效装甲 = 厚度/cosθ；俯角相对车体（下坡俯角更大）；歼击车射界内横瞄、超界自动转车体；被点亮（💡）会暴露给敌方无线电支援。

## 项目结构

```
tools/        资产生成器: build-models.js(坦克) build-map.js(地图) build-audio.js(备用音效) + steel-ws-test.js(协议回归)
client/       游戏: assets/(模型/地图/音效文件) + js/(引擎)
server/       对战服务: server.js(同源托管+房间+钥匙门禁+战斗记录+admin) + dev-static.js(开发静态) + records/(战绩JSONL)
.github/      Pages 部署 CI (PvE 版标记 + 版本戳)
```

- **调参**：手感与数值在 `client/js/config.js`，关卡内容在 `client/assets/maps/*/map.json`（手改即生效）
- **换资产**：模型/地图/音效均为标准格式文件（GLB / PNG+JSON / WAV），同名覆盖即可，节点命名契约见 `tools/build-models.js` 头注释
- **音效来源与授权**：见 [CREDITS.md](CREDITS.md)（炮声/引擎/金属音为 CC0 开源音源，语音为本地 Qwen3-TTS 克隆 CC0 朗诵音源，均可商用）

## 开发

```bash
node tools/build-models.js   # 重建坦克模型
node tools/build-map.js      # 重建三张地图
node tools/build-audio.js    # 备用合成音效(输出到 synth/, 不覆盖开源音源)
```

## 部署

根目录 `deploy.config.json` 配合 deploy CLI（服务器列表在 `~/.mindbase/deploy.json`）：

```bash
deploy    # 仓库根目录运行: 选服务器 → 选 tank-game 项目 → 上传 server/ + client/ → 远端 npm install → pm2 启动/重启
```

远端布局与本地一致（`server.js` 的静态目录固定为同级 `client/`）：静态文件与联机同一端口（默认 8342），部署完浏览器打开 `http://<服务器IP>:8342`。

里程碑推进：每阶段一个 git commit；联机架构为「主机权威 + 快照同步」（输入 30Hz 上行 / 快照 20Hz 下行 / 120ms 插值），服务器只做转发与托管。
