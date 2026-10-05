# steel-front → MoonBit 桌面端全量迁移规划(规划与统计,不含实现)

> 状态:**规划稿** —— 2026-10-05 只做盘点/规划/工作量统计,不动代码。
> 目标:把本游戏全量迁移到 MoonBit 桌面端,技术栈 = **moonbit-libyue**(原生窗口与控件)+ **three-native**(three.js 的 MoonBit/WebGPU 移植),不用浏览器/WebView 混合方案。
> 依据:游戏侧逐文件依赖盘点(带行号)、three-native 覆盖矩阵与渲染器源码、mooncakes.io 生态检索(2026-10-05 实查)。

---

## 0. 结论先行

1. **可行,但工程性质是"补引擎"而非"翻译游戏"。** three-native 当前渲染能力(Basic + Lambert/Phong 直照管线)只覆盖本游戏所需渲染面的约 1/3;纹理采样、GLB 加载、阴影、雾、Line/粒子/Sprite 管线、透明混合全部缺失,需在 three-native 里补齐后游戏才搬得动。游戏逻辑层(`simcore/sim-engine/ai/srv-sim`,~3,180 行)已零 THREE/零 DOM,可对照直译,且有 `tools/golden-trace.js` 黄金轨迹可做 JS↔MoonBit 等价性验证。
2. **"局部渲染 three 画面"——可以,且已验证。** three-native `examples/cube3d` 就是标准形态:yue 窗口内放 `Container` 子区域 → `native_handle_view` 取 GtkWidget → X11 XID → `WebGPURenderer::from_xlib` 建 surface,`host.on_size_changed` 接 resize。3D 视图可以是窗口任意子矩形,与原生控件并存。两条限制:① 跨平台只趟通了 Linux/X11(`from_win32`/macOS 路径未实现);② 原生控件**叠加在 3D 画面上方**受 X11 子窗口层级限制——本游戏 HUD 恰好是全屏 overlay 叠 3D,因此战斗 HUD 规划为**画进 GPU 的 2D overlay 管线**(与现状一致:HUD 本来就是手工 NDC 投影对齐,hud.js:54-61,同一套数学直接搬)。
3. **总工作量统计:约 185~265 人日(≈9~13 人月,单人),其中 three-native 引擎补齐约占 40%。** 明细见 §5。
4. **好消息(削减范围):** 游戏全项目 grep 证实**零 AnimationMixer/SkinnedMesh/InstancedMesh/后处理**——"动画系统/蒙皮/实例化"三项**不需要**给 three-native 补(坦克炮塔炮管是手动改 rotation,掩体 411 个靠手工几何合批已是静态十几个 Mesh);"粒子/线/Sprite"三项**必须补**(曳光拖尾、烟/闪光、空投图标全在用)。

---

## 1. 三方现状盘点

### 1.1 steel-front(本仓库,基准)

- 规模:**11,425 行自有代码**(不含 vendor three.min.js r128 + GLTFLoader.js);`client/index.html` 534 行(346 行 CSS + 186 行 DOM,110 个静态 id + 运行时 ~15 个动态 id)。
- 分层极有利于迁移:模拟内核(simcore 117 / sim-engine 599 / ai 1877 / srv-sim 588,共 ~3,180 行)零 THREE/零 DOM,浏览器/Worker/Node 三栖已验证;表现壳(vehicle 272 / combat 235 / pickups 301)很薄;重头在渲染与 UI 侧(main 2092 / models 594 / hud 584 / garage 304 / lobby 325 / terrain 76)。
- 资产:129 个 GLB(88MB,静态节点树 + extras[zone/wheelR] + 顶点色 + 内嵌贴图,**无骨骼动画**)、8 张 JPG 纹理、6 张 16 位灰度 PNG 高程图(288×288,R*256+G)、战斗音效 11 个(wav/ogg)+ 43 条中文语音 mp3、6 张 map.json(18~48KB/张)。
- 主循环:rAF + 固定步长累加器(60Hz step + 每 rAF 一次 frame),rAF 停摆看门狗降级 setInterval;阴影按需重绘(太阳盒 2m 量化格 + shadowHz 限频);画质三档(dpr/MSAA/shadowRes);HUD DOM 脏检查 + 小地图离屏预渲染。
- 服务端:Node `server.js` 751 行 = 静态托管 + 房间 + 一次性钥匙 + JSONL 记录 + **服务器权威仿真**(把客户端四个零依赖 js 读进 vm 沙箱跑);协议纯 JSON 文本 WS(proto:2 门禁;input 30Hz / snap 20Hz / ev 事件)。**sp 单机模式完全不经服务端。**

### 1.2 three-native(本地 `/home/lkyh/ownCode/three-native`,对照基准 three.js r186)

已有:
- math3d 13/24 类(Vector2/3/4、Matrix3/4、Quaternion、Euler、Color、Box3、Sphere、Plane、**Ray**、Frustum、MathUtils);
- 场景图 Object3D/Scene/BufferGeometry(位置/法线/UV/索引)、Mesh;
- 相机 Perspective/Orthographic(WebGPU 深度域 z∈[0,1] —— HUD 手工投影数学要按此适配);
- 光照数据层 5 种;**渲染管线两条**:basic(纯色)与 lit(Lambert/Phong,ambient+单平行光+单点光,WGSL,公式照搬 three ShaderChunk)——游戏只需 Directional+Hemisphere,映射到 lit 管线需补 hemisphere 项;
- WebGPURenderer:wgpu surface、逐 mesh GPU 资源缓存、深度附着、resize;**嵌入已验证**(cube3d:Container→XID→from_xlib;input_diag:host.on_mouse_down/on_wheel 在渲染循环运行时事件通道可用)。

缺失(对照游戏需求,全部要补):纹理 GPU 上传与采样、GLTF/GLB 加载器、阴影、雾(Fog/FogExp2)、Line(基本/虚线/顶点色/加法混合)、Points 粒子、Sprite 公告板、透明排序与 depthWrite 控制、自定义着色器注入、Raycaster、Extrude+Shape/Icosahedron/Ring/Circle 几何、渲染统计出口、**from_win32/macOS surface**。

### 1.3 moonbit-libyue(本地,`moon add NoahLiu/moonbit-libyue`)

- 55 原生控件全量封装 + 57 主题化自绘组件、声明式节点树 + Signal/Store 响应式、dialog/toast/context_menu、托盘/通知/剪贴板/文件对话框;Windows/Linux/macOS(β)。
- 对本游戏:UI 层的"非 overlay"部分(车库/大厅/设置面板/结算卡)用 libyue 重写很顺;**战斗 HUD overlay 部分走 GPU 自绘**(见 §3 决策)。

---

## 2. mooncakes.io 生态依赖盘点(2026-10-05 检索,不可遗漏项)

| 需求 | 选型(版本) | 说明 | 备选 |
|---|---|---|---|
| **音频播放+解码** | **Milky2018/moon_rodio 0.3.5**(6,638 下载) | Rust rodio 的 native 移植:播放管线、源效果、**WAV/MP3/FLAC/Vorbis/MP4A 全解码**——一包覆盖游戏全部音频格式(wav/ogg/mp3)。与 three-native 同依赖 wgpu-mbt 作者生态 | moon_cpal 0.11.8(设备层)、CorvusCinereus/miniaudio 0.4.0、纯解码:LL728/moonvorbis、enanandesu/mp3、bw448/moon-wav |
| 声像/滤波 | moon_rodio 源效果 + 自写 biquad | 游戏 WebAudio 用法很浅:手写距离衰减+sin(relYaw) 立体声像、引擎音 lowpass、playbackRate 变调、loop——全部可在解码 PCM 上等价实现,无需 PannerNode/HRTF | moondsp(DSP 引擎) |
| **图像解码** | **mizchi/image 0.4.3**(21,374 下载) | PNG/BMP/JPEG 解码+缩放——覆盖 8 张 JPG 纹理 + 16 位灰度 PNG 高程图(需确认 16 位灰度通道支持,阶段0 验证;不行就手写 PNG16 解码,服务端已有一份 zlib+5 种 filter 的参考实现 server.js:91-117) | riantr/moonbit_image、shunge/image(纯 MoonBit 六格式)、mizchi/zlib(DEFLATE) |
| **WebSocket 客户端** | tonyfettes/soup 0.2.0(libsoup3 绑定,HTTP+WS,与 libyue 同 GTK 栈)或 Hosi121/ws_session(基于 moonbitlang/async) | 协议是纯 JSON 文本帧,客户端只要 connect/send/on-message | 兜底:基于 moonbitlang/async 的 native TCP 自实现 RFC6455 客户端(握手+帧编解码,几百行)。⚠️ zdu881/webmocket 是 JS FFI 包装器,**仅浏览器目标不可用** |
| HTTP(钥匙兑换 POST) | soup 或 moonbitlang/async | net.js:59-67 `POST /key/redeem` | moonbitstack/moonhttp |
| **GLTF 解析参考** | hzfhzf89/moonbit-gltf-tools 0.1.2 | GLB 读取/校验/节点树遍历,可作 three-native GLTF 加载器的解析层参考或直接依赖 | 自写(GLB=JSON chunk+bin chunk,游戏只消费静态网格/材质/extras/顶点色/内嵌贴图,面不宽) |
| 动画参考(不需要) | mizchi/anim3d 0.6.0 | 游戏**不用**骨骼/关键帧动画,不引入 | — |
| 中文字体(2D HUD 文字用) | mizchi/font 0.7.4(30,870 下载,TTF/OTF 解析)+ 自写光栅化/图集 | 伤害数字/敌名牌/提示大量中文 | bikallem/freetype 0.5.3(纯 FreeType 兼容引擎) |
| 手柄(可选加分项) | Milky2018/gamepad 0.4.7(6,660 下载) | 网页版未用手柄;桌面版可选支持 | — |
| 本地存档 | moonbitlang/async(fs)+ JSON 文件 | localStorage 10 个键(sf_pve/sf_gfx/sf_touch/sf_tips/sf_mp_tank/sf_map/sf_name/sf_token…) → 用户配置目录一个 JSON | libyue 会话/配置能力 |
| JSON | moonbitlang/core 内建 | map.json/config 数值表解析 | — |

---

## 3. 关键架构决策

### D1. 战斗 HUD:画进 GPU,不用原生控件叠(必选)
现状 HUD 全部叠在 3D 上(z-index:#game < #hud < overlay),靠手工 NDC 投影对齐;而 libyue+three-native 的嵌入形态是"3D 占窗口子矩形、原生控件在旁"。X11 子窗口层级决定原生控件压不到 3D 上面。**方案:战斗场景让 Container 占满窗口,HUD 用 three-native 新增的"2D overlay 管线"(正交相机 + 矩形/圆弧/线段图元 + 文字纹理图集)画在同一 wgpu surface 上**——与网页版"canvas 上画 HUD"同构,投影数学(hud.js:54-61,注意 WebGPU z∈[0,1] 与 Y 翻转)直接搬。车库/大厅/结算这类"整屏 UI"则用 libyue 声明式重写,3D 车库展台作为窗口内子区域嵌入(D1 与 cube3d 形态一致)。

### D2. three-native 需补齐的管线清单(=本迁移的"引擎工程"部分)
按依赖顺序:
1. **纹理管线**:mizchi/image 解码 → wgpu 上传 + mipmap + 采样器(Repeat/anisotropy);材质 map/vertexColors/repeat 进管线;
2. **GLB 加载器**:解析(JSON+bin chunk)→ Object3D 树 + BufferGeometry + 材质 + extras(userData.zone/wheelR)+ 顶点色 + 内嵌贴图;
3. **材质管线分发**:Lambert(带贴图/顶点色)为主力,Basic(发光/轮廓壳),Standard 降级为 Phong 近似(游戏只用在木箱与残骸);
4. **HemisphereLight 进 lit 管线**(现状只有 ambient/dir/point);
5. **阴影**:平行光正交深度 pass + PCF 软阴影 + shadow camera(±95/far700/bias)+ `autoUpdate=false` 按需重绘语义;
6. **雾**:FogExp2/Fog 距离混合(天空穹 fog:false);
7. **Line 管线**:LineBasic(顶点色+Additive)/LineDashed(computeLineDistances);
8. **Points 粒子管线**(size attenuation/vertexColors/贴图光晕)、**Sprite 公告板**(透明/Additive/depthTest off);
9. **透明排序 + depthWrite/depthTest/blending 控制**;
10. **着色器注入点**:天空穹渐变、瞄准轮廓壳(`transformed += normal*0.11`)、近距草透明(uniform uFocus)三处自定义效果 → 设计成管线可插拔开关;
11. **2D overlay 管线**(D1);
12. **Raycaster**(CPU 数学,math3d 已有 Ray,三角求交+face normal);
13. **几何补齐**:Extrude+Shape(山墙)、Icosahedron(岩石,顶点扰动+重算法线)、Ring/Circle;
14. 渲染统计(info.calls/triangles 给 F3 角标)、画质档(dpr/MSAA/shadowRes)、每场销毁重建语义;
15. **from_win32 surface(Windows 支持的硬前提)**,macOS 后置。

**不需要补**:AnimationMixer/AnimationClip/SkinnedMesh/morph(游戏零使用)、InstancedMesh(手工合批已覆盖)、后处理(零使用)、WebXR、Points 之外的 GPU 粒子。

### D3. 逻辑内核:对照直译 + 黄金轨迹验证
simcore/sim-engine/ai/srv-sim 按行为逐函数译成 MoonBit(纯数值,无平台依赖);`tools/golden-trace.js` 与 `tools/sim-headless.js` 已能离线跑 JS 内芯产轨迹——迁移期间以"同输入同轨迹逐帧对比"作验收门。config.js 拆两半:数值参数(手译)+ `partBoxes` 1.7MB 数据(**改构建期生成 JSON、运行时加载**,不要硬编码进 MoonBit 源码,编译会炸)。

### D4. AI 线程模型(阶段0 调研项)
网页版 AI 在 Web Worker 33ms 独立时钟跑,主线程降级路径已存在(main.js:116-142)。桌面端顺序:① 先用主线程分帧跑(降级路径行为等价,AI 是 30Hz 思考+每帧只消费输入缓存,不卡渲染的可行性要在真机测);② MoonBit native 线程成熟则换线程;③ 兜底独立进程+管道。**此项不阻塞其余阶段。**

### D5. 联机:协议不动,服务端不迁(第一阶段)
桌面客户端连现有 Node 服务器(JSON 文本 WS,proto:2)。客户端侧用 soup/ws_session/自实现 RFC6455。服务器迁 MoonBit(moonback/async 生态已备)列为远期可选,不在本次统计内。

### D6. 明确裁剪项
触摸虚拟摇杆/双指捏合(移动端形态,桌面版不需要,后续要触屏再补)、speechSynthesis TTS 兜底(43 条语音 mp3 已打包齐,缺一补一即可)、`?v=` 版本戳(本地文件无需)、竖屏遮罩/orientation lock(桌面无此态)、Fullscreen API(libyue 窗口原生全屏)。

---

## 4. 模块映射表(JS → MoonBit)

| 现模块 | 行数 | 去向 | 策略 | 依赖 |
|---|---|---|---|---|
| simcore.js | 117 | `sim/core` | 直译 | 无 |
| sim-engine.js | 599 | `sim/engine` | 直译 | sim/core |
| ai.js | 1877 | `sim/ai` | 直译 | sim/core |
| srv-sim.js | 588 | `sim/srv`(桌面联机客户端其实不用,先译保持与服务器语义对齐) | 直译 | sim/engine |
| config.js | 1530 | `cfg`(参数)+ `assets/config-data.json`(partBoxes 等大数据) | 参数手译 + 数据外置 | moonbitlang/core JSON |
| assets.js | 199 | `platform/assets` | 重写(本地 fs + 解码器接线) | mizchi/image、GLB 加载器、moon_rodio |
| audio.js | 170 | `platform/audio` | 重写(等价:衰减/声像/lowpass/变调/loop/14 voice 上限) | moon_rodio |
| net.js | 121 | `platform/net` | 重写(WS 客户端 + 30Hz input + 120ms 插值缓冲) | soup / async+自实现 RFC6455 |
| main.js | 2092 | `game/app`(场景/相机/输入/主循环/波次/联机表现) | 重写(结构对照搬) | three-native 全管线、libyue |
| models.js | 594 | `game/world`(GLB 装配/掩体建模/**合批**/碰撞注册) | 重写(合批策略原样:烘世界矩阵+UV+顶点色,十几个静态 Mesh) | GLB 加载器、几何补齐 |
| terrain.js | 76 | `game/terrain` | 直译 | 纹理管线、PlaneGeometry |
| vehicle.js | 272 | `game/vehicle` | 薄改写(模型枢轴同名 turret/gun/muzzle) | — |
| combat.js | 235 | `game/fx` | 重写(Points 500 池/烟 40/闪 10/曳光 30 条线) | Points/Sprite/Line 管线 |
| pickups.js | 301 | `game/pickups` | 重写(图标 CanvasTexture→运行时光栅化) | Sprite 管线 |
| hud.js | 584 | `game/hud`(画进 GPU 的 2D overlay) | 重写(小地图/罗盘/装填环四块 canvas 语义平移) | 2D overlay 管线、字体 |
| garage.js | 304 | `app/garage`(libyue 界面 + 3D 展台子区域) | 重写 | libyue、three-native |
| lobby.js | 325 | `app/lobby`(libyue) | 重写 | libyue、platform/net |
| index.html | 534 | libyue 声明式节点树(车库/大厅/结算)+ GPU overlay(战斗) | 重写 | libyue |
| ai-worker.js | 117 | 并入 `sim/ai` 调度(D4) | 重写 | — |
| localStorage×10 | — | 用户目录 JSON 存档 | 重写 | async fs |
| server/*.js | 790 | **不迁**(现有 Node 服务器继续服务) | — | — |

---

## 5. 工作量统计(人日,单人含自测)

### A. three-native 引擎补齐(D2 清单)

| # | 项 | 预估 |
|---|---|---|
| A1 | 纹理管线(解码集成/上传/mipmap/采样/repeat/vertexColors) | 8–12 |
| A2 | GLB 加载器(解析+节点树+extras+内嵌贴图;参考 moonbit-gltf-tools) | 10–15 |
| A3 | 材质管线分发(Lambert 贴图主力/Basic/Standard→Phong 降级) | 6–10 |
| A4 | Hemisphere 进 lit 管线 | 2–3 |
| A5 | 阴影(深度 pass/PCF/shadow camera/按需重绘) | 10–15 |
| A6 | 雾 FogExp2/Fog | 2 |
| A7 | Line 管线(基本/虚线/顶点色/加法) | 4–6 |
| A8 | Points 粒子 + Sprite 公告板 | 8–12 |
| A9 | 透明排序 + 状态控制(depthWrite/Test/blending) | 3–5 |
| A10 | 着色器注入点(天空穹/轮廓壳/草透明) | 5–8 |
| A11 | 2D overlay 管线(正交+图元+文字图集) | 10–15 |
| A12 | Raycaster | 3–5 |
| A13 | 几何补齐(Extrude+Shape/Icosahedron/Ring/Circle) | 4–6 |
| A14 | 统计/画质档/上下文销毁重建 | 3–5 |
| A15 | from_win32 surface | 5–10 |
| | **小计** | **83–129** |

### B. 游戏本体

| # | 项 | 预估 |
|---|---|---|
| B1 | 逻辑内核直译(3,180 行)+ 黄金轨迹对拍验收 | 15–20 |
| B2 | config 拆分与数据外置(1.7MB→JSON) | 3–5 |
| B3 | main(场景/相机/输入/主循环/波次) 2,092 行重写 | 15–20 |
| B4 | models(装配/掩体/合批/碰撞表) | 10–15 |
| B5 | terrain + vehicle + combat + pickups 表现层 | 10–14 |
| B6 | 战斗 HUD(2D overlay 重写,四块 canvas 语义平移) | 12–18 |
| B7 | 车库/大厅/结算(libyue 重写,534 行 CSS/DOM + 630 行 js) | 10–15 |
| | **小计** | **75–107** |

### C. 平台层

| # | 项 | 预估 |
|---|---|---|
| C1 | 输入(键鼠映射/指针捕获=桌面版 pointer lock/wheel) | 5–8 |
| C2 | 音频(moon_rodio 集成,声像/lowpass/变调/循环/voice 上限) | 6–10 |
| C3 | 资产加载与版本化(本地 fs) | 2–3 |
| C4 | 存档(localStorage→JSON) | 1–2 |
| C5 | WS 客户端 + net.js 协议(含插值缓冲) | 5–10 |
| | **小计** | **19–33** |

### D. 联调与收尾

| # | 项 | 预估 |
|---|---|---|
| D1 | 联机端到端(房间/钥匙/20Hz 快照/ev) | 5–8 |
| D2 | 性能对齐(合批后 draw call、阴影按需、60fps 目标) | 5–8 |
| D3 | 打包发布(Windows/Linux 产物) | 3–5 |
| | **小计** | **13–21** |

**总计:190–290 人日(中位约 240,≈11 人月)。** 与 §0 的 185–265 略有出入以本表为准(表更细)。占比:A 引擎 ~43%、B 游戏 ~38%、C 平台 ~11%、D 收尾 ~8%。

> 压缩空间的三个杠杆:① 先只做 Linux(A15 后置,−5–10);② 联机后置先出单机版(C5/D1 后置,−10–18);③ 2D overlay 管线做最小集(先矩形+文字,圆弧/罗盘降级) −3–5。全开可到 ~160–200 人日。反之,要 macOS 再 +10–15。

---

## 6. 分阶段路线图

- **阶段0|验证与选型(1–2 周)**——每项都是小实验,失败即调整规划:
  1. from_win32 surface 可行性(Windows 是硬门槛);
  2. mizchi/image 对 16 位灰度 PNG 的解码正确性(高程图 R*256+G 语义);
  3. WS 客户端选型落地:soup vs async+自实现,连上现有 server.js 跑通 join/lobby;
  4. moon_rodio 播放 engine-loop.wav 变调循环 + ogg/mp3 一致性;
  5. AI 主线程分帧真机帧率(AI 15 敌 + 渲染同跑);
  6. X11 子窗口上叠原生控件的最小反证实验(10 分钟,给 D1 定案存档);
  7. 1.7MB JSON 运行时加载的启动耗时。
- **阶段1|引擎底座(≈A1–A4,A6)**:纹理→GLB→材质分发→hemi/雾。里程碑:一张地图的地形+掩体+坦克在窗口里点亮(无阴影无特效)。
- **阶段2|逻辑内核(≈B1–B2)**:四模块直译,golden-trace 逐帧对拍全绿。里程碑:`moon test` + 轨迹零偏差。
- **阶段3|战斗可玩(≈A5,A7–A10,A12–A14 + B3–B5)**:阴影/雾/线/粒子/Sprite/Raycaster/注入点 + main/models/terrain/vehicle/combat/pickups。里程碑:单机关卡全程可玩、F3 统计可用。
- **阶段4|HUD 与外围(≈A11,B6,B7,C1–C4)**:2D overlay + 车库/大厅 libyue + 输入/音频/存档。里程碑:完整单机版。
- **阶段5|联机(C5,D1)**:WS 客户端 + 房间流程 + 快照插值。里程碑:两台桌面端 + 现有服务器对战。
- **阶段6|跨平台与发布(A15,D2–D3)**:Windows surface、性能对齐、打包。macOS 视需求后置。

依赖关系:阶段1↔2 可并行;3 依赖 1;4 依赖 3(HUD 要投影数学)与 1(A11);5 依赖 4;6 依赖 5。

---

## 7. 风险清单(按杀伤力排序)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | wgpu surface 仅 X11 趟通,from_win32 未实现 | Windows 版整个不可用 | 阶段0#1 立即验证;wgpu-mbt 本身声明 D3D12 支持,缺口只在 surface 创建层 |
| R2 | X11 子窗口层级 → 原生控件无法叠 3D 上 | HUD 架构 | 已按 GPU 自绘规划(D1),不依赖该能力 |
| R3 | three-native 早期(0.1.0)API 漂移/bug | 返工 | 以 fork/锁版本 + 回馈上游;游戏本身是很好的回归用例 |
| R4 | 阴影/粒子等新管线的 wgpu 性能未证 | 帧率 | 游戏自带三档画质+合批+按需阴影等全部降级手段,语义平移即可 |
| R5 | AI 线程模型未定 | 帧率/延迟 | 主线程分帧是已验证降级路径,不阻塞 |
| R6 | 16 位 PNG 解码生态缺口 | 高程图错误 | 服务端已有纯 JS zlib+filter 参考实现,最坏自写(~2 人日) |
| R7 | 中文字体光栅化质量 | HUD 观感 | mizchi/font 下载量 3 万+;先做最小图集验证 |
| R8 | partBoxes 1.7MB 处理不当拖垮编译 | 构建时间 | D3 已定:数据外置 JSON 运行时加载 |
| R9 | GLB 内嵌贴图/材质映射不完整 | 129 车模型观感 | 阶段1 里程碑先拿 3~5 辆代表性车(含残骸合批路径)验收再铺全量 |
| R10 | moon_rodio 音频行为差异(变调循环/精确 onended 计数) | 手感 | audio.js 语义清单化逐条对齐;必要时解码后自管 PCM 队列 |

---

## 8. 附:盘点证据索引(实现阶段的地图)

- 渲染依赖全表与行号:本次盘点 §一(GLTF 装配 models.js:24-62;合批 models.js:397-543;阴影按需 main.js:496-518;画质档 main.js:178-194;天空穹 main.js:245-254;草透明 models.js:429-443;曳光 combat.js:40-48;虚线 main.js:604-609;Raycaster main.js:551-561)。
- 浏览器 API 清单:§二(WS 消息协议 net.js/server.js:399-561;Worker 协议 ai-worker.js:106-116;WebAudio 链 audio.js:20-92;TTS audio.js:120-166;localStorage 10 键;输入 main.js:656-1009)。
- HUD 结构:§三(110 静态 id;四块 canvas:minimap/dirWidget/reloadRing/bigMap;z-index 栈)。
- 地图/资产格式:§四(map.json 字段;PNG16 两条解码路径 assets.js:37-60 与 server.js:91-117;GLB 129 个 88MB;音频清单)。
- 游戏循环与帧率技巧:§七(固定步长 60Hz;9 条帧率技巧)。
- three-native 覆盖矩阵:three-native/docs/coverage-matrix.md;嵌入示例 examples/cube3d、examples/input_diag。
- mooncakes 检索:2026-10-05 站内 API(/api-new/v0/search?kw=)实查,选型见 §2。
