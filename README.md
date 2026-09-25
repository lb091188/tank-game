# 钢铁前沿 (steel-front)

浏览器 3D 坦克游戏 · 坦克世界手感 · 单机 PVE 闯关。
零外部素材（模型/地形/音效全部程序化生成，零版权风险），零 npm 依赖，无构建步骤。

**阶段一（已完成）**：单机 PVE 原型 —— M4 谢尔曼 + 一张诺曼底风地图 + 第一关「遭遇战」
**阶段二（规划中）**：WebSocket 内网对战（房主 Node 服务 + 主机权威状态同步）

**🎮 在线试玩：https://lb091188.github.io/tank-game/**（推送 main 分支自动部署，CI 见 `.github/workflows/deploy.yml`）

---

## 运行

需要 Node.js（任意近年版本，无需 npm install）。

- **Linux / macOS**：双击或运行 `./启动游戏.sh`
- **Windows**：双击 `启动游戏.bat`
- 手动方式：`node server/dev-static.js 8341`，然后浏览器打开 http://127.0.0.1:8341/

> 必须通过 HTTP 访问（Chrome 拦截 file:// 下的资源请求），启动脚本已代劳。
> 服务带 `Cache-Control: no-cache`，改完代码刷新页面即生效。

## 操作

| 按键 | 功能 |
|---|---|
| W / S | 前进 / 倒车（倒车更慢——倒车伸缩炮的基础） |
| A / D | 车体转向（可原地转向；车速越快回转越慢） |
| 鼠标 | 炮塔瞄准（点击画面锁定鼠标指针） |
| 左键 | 开炮（受装填与缩圈影响） |
| 滚轮 | 相机距离 |
| Shift | 狙击镜切换 |

**打法提示**：移动中圈大打不准，停车等缩圈（圈变绿）再开炮；打敌人**首下与侧面**；歼击车正面 120mm 很硬，**绕侧打**；重坦首上打不穿，等它开炮后打**首下**或绕后；缓坡只露炮塔（卖头）能骗炮弹。

## 项目结构

```
├── 启动游戏.sh / .bat        一键启动
├── tools/                     资产生成器（纯 Node，零依赖）
│   ├── build-models.js        → client/assets/models/*.glb（含部位装甲数据）
│   ├── build-map.js           → 高程图 PNG + map.json 关卡数据
│   └── build-audio.js         → 全套 WAV 音效（程序合成）
├── client/                    浏览器端（需通过 HTTP 访问）
│   ├── index.html             HUD 与加载/标题/结算界面
│   ├── assets/                ★ 全部资产文件（可替换）
│   │   ├── models/            *.glb 坦克模型
│   │   ├── maps/l01-encounter/heightmap.png + map.json
│   │   └── audio/             *.wav 音效
│   └── js/                    引擎（输入/模拟/渲染三层分离，为联机打底）
│       ├── config.js          ★ 全部手感与数值参数（调参入口）
│       ├── assets.js / terrain.js / models.js / vehicle.js
│       ├── combat.js / ai.js / hud.js / audio.js / main.js
│       └── net.js / lobby.js  [阶段二] WebSocket
└── server/
    ├── dev-static.js          开发静态服务（no-cache）
    └── server.js              [阶段二] 房间管理 + 消息路由（ws）
```

## 调参指南（都在 `client/js/config.js`，中文注释）

- **车辆手感**：`vehicles.sherman` —— 极速/倒车比/加速度/刹车滑行、车体回转 40°/s、炮塔回转 38°/s、缩圈 2.2s 与各类扩圈系数、穿深/伤害/装填
- **装甲规则**：`armor` —— 跳弹角 70°、穿深浮动 ±25%、模块概率（履带/发动机/弹药架）
- **AI 难度**：`ai.personalities` —— `aimPatience`（开炮纪律：越低越急着开火越不准）、`band`（交战距离）、`flankChance`（绕侧倾向）、`leadSkill`（预判能力）
- 关卡内容（敌人位置/波次/掩体/出生点）在 `client/assets/maps/l01-encounter/map.json`，**手改即生效**

## 资产替换指南

| 资产 | 替换方法 |
|---|---|
| 坦克模型 | Blender 建模 → 导出 `.glb` → 覆盖 `assets/models/` 同名文件。保持节点结构：部位节点命名 `glacis/lowerPlate/hullSide/hullRear/hullTop/turretFront/turretSide/turretRear/turretRoof/mantlet`（extras 带 `zone` 和 `armor` 毫米值）；可动件 `turret`（枢轴）→ `gun`（枢轴）→ `muzzle`（炮口空节点） |
| 地形 | 任何工具重画 16 位灰度高程图（256×256，0→0m / 65535→70m）覆盖 `heightmap.png`；掩体/敌人/出生点改 `map.json` |
| 音效 | 同名文件覆盖（引擎 `engine-loop.wav` 需无缝循环，引擎声用 playbackRate 变调）。现用音源来自 OpenGameArt 开源音效，授权与署名见 [CREDITS.md](CREDITS.md)；备用合成音源由 `node tools/build-audio.js` 生成到 `synth/` 子目录，不会覆盖开源文件 |

改模型/地图后无需重新生成其他资产；改生成器源码后跑 `node tools/build-models.js` 等重建。

## 手感系统说明（实现于 vehicle.js / combat.js）

- 车体炮塔分离，各自限速回转；地形 4 点采样贴合俯仰侧倾，坡度阻力/极限坡度
- 缩圈模型：移动/车体转/炮塔转/开炮分别累加扩圈，停车指数收敛（瞄准时间 2.2s）
- 弹道：弹速 750m/s + 弱下坠，命中按**部位查表装甲**：入射角>70° 跳弹；等效=厚度/cosθ；穿深±25% 浮动；击穿掷模块损伤
- AI 与玩家共用同一车辆接口（同样要缩圈、有装填），难度差异来自"纪律"而非数值作弊

## 阶段二：WebSocket 内网对战（下一步）

架构已定型：房主跑 `server/server.js`（静态托管 + 房间 + 消息路由），主机权威在房主浏览器，输入 30Hz 上行 / 快照 20Hz 下行；现有"输入/模拟/渲染分离"架构保证联机不重写玩法代码。

## 已知限制（原型版）

- 音效为程序合成，自动化测试环境无法验证实际播放；实机若有异常优先检查浏览器自动播放策略（点击页面即可激活）
- 敌人 AI 避障为简单启发式，复杂地形偶尔卡住后会自动倒车脱困
- 狙击镜（Shift）逻辑已实现，视野效果未在自动化环境逐帧验证
