# steel-front → MoonBit 桌面端全量迁移规划(规划与统计,不含实现)

> 状态:**规划稿** —— 2026-10-05 只做盘点/规划/工作量统计,不动代码。
> 目标:把本游戏全量迁移到 MoonBit 桌面端,技术栈 = **moonbit-libyue**(原生窗口与控件)+ **three-native**(three.js 的 MoonBit/WebGPU 移植),不用浏览器/WebView 混合方案。
> 依据:游戏侧逐文件依赖盘点(带行号)、three-native 覆盖矩阵与渲染器源码、mooncakes.io 生态检索(2026-10-05 实查)。

---

## 0. 结论先行

1. **可行,但工程性质是"补引擎"而非"翻译游戏"。** three-native 当前渲染能力(Basic + Lambert/Phong 直照管线)只覆盖本游戏所需渲染面的约 1/3;纹理采样、GLB 加载、阴影、雾、Line/粒子/Sprite 管线、透明混合全部缺失,需在 three-native 里补齐后游戏才搬得动。游戏逻辑层(`simcore/sim-engine/ai/srv-sim`,~3,180 行)已零 THREE/零 DOM,可对照直译,且有 `tools/golden-trace.js` 黄金轨迹可做 JS↔MoonBit 等价性验证。
2. **"局部渲染 three 画面"——可以,且已验证。** three-native `examples/cube3d` 就是标准形态:yue 窗口内放 `Container` 子区域 → `native_handle_view` 取 GtkWidget → X11 XID → `WebGPURenderer::from_xlib` 建 surface,`host.on_size_changed` 接 resize。3D 视图可以是窗口任意子矩形,与原生控件并存。**Windows 侧 2026-10-05 已实证趟通(清单 V3–V5 全过):整窗形态取顶层 HWND → `WebGPURenderer::from_hwnd` → D3D12 硬件 surface,R1 的两处缺口补丁在两仓库分支待审合并**;两条限制:① macOS 路径仍未实现(wgpu_mbt 已备 API,照 from_hwnd 模式补即可);② 原生控件**叠加在 3D 画面上方**三平台都不可行(airspace/X11 子窗口层级)。
3. **UI 架构决策(2026-10-05 复核):全自渲染。** 原生控件叠 3D 不跨平台 → 按约定不做;多窗口覆盖窗方案被否决(libyue 有 frameless/transparent/always_on_top 但**没有点击穿透 API**,FPS 视角与 HUD 按钮点击无法共存,补齐需改 yue C++ 三平台);结论:**单窗口单 wgpu surface,游戏所有画面(3D+HUD+车库+大厅+结算)全部自渲染**,libyue 降级为窗口壳/事件循环/原生模态对话框(玩家名中文输入用系统 IME 的模态框解决)。详见 §3 D1。
3. **总工作量统计:约 186~282 人日(中位 ≈234,≈11 人月,单人;A15 按 Windows 机实测校准后),其中 three-native 引擎补齐约占 45%。** 明细见 §5。
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

缺失(对照游戏需求,全部要补):纹理 GPU 上传与采样、GLTF/GLB 加载器、阴影、雾(Fog/FogExp2)、Line(基本/虚线/顶点色/加法混合)、Points 粒子、Sprite 公告板、透明排序与 depthWrite 控制、自定义着色器注入、Raycaster、Extrude+Shape/Icosahedron/Ring/Circle 几何、渲染统计出口。~~from_win32/macOS surface~~ **Windows 侧已补(`WebGPURenderer::from_hwnd`,2026-10-05 真机趟通,分支 win/from-hwnd dbe4845);macOS 后置**。

### 1.3 moonbit-libyue(本地,`moon add NoahLiu/moonbit-libyue`)

- 55 原生控件全量封装 + 57 主题化自绘组件、声明式节点树 + Signal/Store 响应式、dialog/toast/context_menu、托盘/通知/剪贴板/文件对话框;Windows/Linux/macOS(β)。
- 对本游戏:UI 层的"非 overlay"部分(车库/大厅/设置面板/结算卡)用 libyue 重写很顺;**战斗 HUD overlay 部分走 GPU 自绘**(见 §3 决策)。

---

## 2. mooncakes.io 生态依赖盘点(2026-10-05 检索,不可遗漏项)

| 需求 | 选型(版本) | 说明 | 备选 |
|---|---|---|---|
| **音频播放+解码** | **Milky2018/moon_rodio 0.3.5**(6,638 下载) | Rust rodio 的 native 移植:播放管线、源效果、**WAV/MP3/FLAC/Vorbis/MP4A 全解码**——一包覆盖游戏全部音频格式(wav/ogg/mp3)。与 three-native 同依赖 wgpu-mbt 作者生态。**Windows 实测(2026-10-05):解码层(wav looped/ogg/mp3)与 speed/looped 效果器可用;但其 MixerDeviceSink/Sink 集成层在 Windows 有双缺陷(队列不被渲染线程消费 + sleep_until_end 纯忙等,sink.mbt:344)→ 播放走 moon_cpal 原始通路 + rodio 解码/效果器 + 自管 PCM 队列(=本表下方 C2 预设,已实测 5s ogg 满速供数、mp3 帧数与元数据逐帧吻合、1.5x 循环正常)** | moon_cpal 0.11.8(设备层,WASAPI 实测健康)、CorvusCinereus/miniaudio 0.4.0、纯解码:LL728/moonvorbis、enanandesu/mp3、bw448/moon-wav |
| 声像/滤波 | moon_rodio 源效果 + 自写 biquad | 游戏 WebAudio 用法很浅:手写距离衰减+sin(relYaw) 立体声像、引擎音 lowpass、playbackRate 变调、loop——全部可在解码 PCM 上等价实现,无需 PannerNode/HRTF | moondsp(DSP 引擎) |
| **图像解码** | **mizchi/image 0.4.3**(21,374 下载) | PNG/BMP/JPEG 解码+缩放——覆盖 8 张 JPG 纹理 + 16 位灰度 PNG 高程图。**Windows 实测(2026-10-05):JPG 尺寸全对(1024×662/1024×256);但 decode_png 对 Grayscale/16 直接 raise UnsupportedFeature → 高程图走「@zlib(mizchi/zlib)+ 自写 5 种滤波反演」精确 16 位路径,实测 ~80 行、8/8 采样点与 PIL 逐位一致,不必手写 zlib** | riantr/moonbit_image、shunge/image(纯 MoonBit 六格式)、mizchi/zlib(DEFLATE,实测可用) |
| **WebSocket 客户端** | **moonbitlang/async/websocket 0.22.4(官方,主选,已核实可用)** | RFC 6455 客户端+服务端;`Conn::connect(url)` 支持 ws/wss/代理/自定义头,`send_text`/`recv()→Message(Text/Binary)`,native 目标。游戏协议是纯 JSON 文本帧(net.js `send(JSON)`),一一映射。**Windows 实测(2026-10-05,V6/V7):IOCP 后端编译+运行全通,TCP ping/pong 与连本机 server.js 的 create/joined、err JSON 往返均成功——README "only Linux/macOS" 过时,以特性清单/实测为准** | 备选:tonyfettes/soup(libsoup3);最坏自实现 RFC6455 客户端(几百行)。⚠ zdu881/webmocket 是 JS FFI 包装器,**仅浏览器目标不可用** |
| 事件循环共存 | **moonbitlang/async/external_loop_integration 0.22.4** | 官方支持把 async 嵌进外部事件循环(`set_external_event_loop`+`ExternalEventLoop`)——WS 收发跑在 yue/GTK 主循环里的官方通道,网络消息→`@yue.post_task`→游戏主线程 | 后备:async 跑独立 OS 线程+队列回投(需验证 native 线程) |
| HTTP(钥匙兑换 POST) | moonbitlang/async/http | net.js:59-67 `POST /key/redeem`,与 WS 同栈 | moonbitstack/moonhttp |
| **GLTF 解析参考** | hzfhzf89/moonbit-gltf-tools 0.1.2 | GLB 读取/校验/节点树遍历,可作 three-native GLTF 加载器的解析层参考或直接依赖 | 自写(GLB=JSON chunk+bin chunk,游戏只消费静态网格/材质/extras/顶点色/内嵌贴图,面不宽) |
| 动画参考(不需要) | mizchi/anim3d 0.6.0 | 游戏**不用**骨骼/关键帧动画,不引入 | — |
| 中文字体(2D HUD 文字用) | mizchi/font 0.7.4(30,870 下载,TTF/OTF 解析)+ 自写光栅化/图集 | 伤害数字/敌名牌/提示大量中文 | bikallem/freetype 0.5.3(纯 FreeType 兼容引擎) |
| 手柄(可选加分项) | Milky2018/gamepad 0.4.7(6,660 下载) | 网页版未用手柄;桌面版可选支持 | — |
| 本地存档 | moonbitlang/async(fs)+ JSON 文件 | localStorage 10 个键(sf_pve/sf_gfx/sf_touch/sf_tips/sf_mp_tank/sf_map/sf_name/sf_token…) → 用户配置目录一个 JSON | libyue 会话/配置能力 |
| JSON | moonbitlang/core 内建 | map.json/config 数值表解析 | — |

---

## 3. 关键架构决策

### D1. UI 架构:全自渲染(2026-10-05 三方案对比后定稿)

前置事实(libyue 本地源码核实):
- 窗口能力**有**:`Window::new_with_options(frame=false, transparent=true, no_activate=true)`、`set_always_on_top`、`set_has_shadow`(view.mbt:40-76);
- 窗口能力**无**:点击穿透/输入区域设置(grep 全库无 set_shape/input_shape 类 API);
- `native_handle_view` **Windows 返回 0**(shim/yue_mbt.cpp:581 注释:"Windows 的 NativeView 为内部 ViewImpl*,HWND 需经内部类转换,平台铺开时补")——**已于 2026-10-05 在 libyue 分支 `win/native-handle`(1a9f815)补 `yue_mbt_window_get_hwnd`/`native_handle_window` 解决:整窗渲染取顶层窗口 HWND(实测与外部 MainWindowHandle 逐位相等、IsWindow=True),清单 V3**;子区域句柄 Windows 上仍是 0(自绘 Container 无 HWND 属预期),若车库要"3D 子区域 + 原生控件并排"需另加 SubwinView 宿主。

三方案对比(判据 = 跨平台 + 实现游戏全部功能):

| 方案 | 跨平台 | 功能覆盖 | 结论 |
|---|---|---|---|
| ① 原生控件叠 3D(同窗口) | ✗ X11 子窗口层级/Win32 子 HWND/macOS 视图分层,三平台 airspace 问题,libyue 无 API | HUD overlay 全废 | **不做**(不跨平台,按约定直接排除) |
| ② 多窗口(透明覆盖窗) | 半跨:透明/frameless/置顶 libyue 三平台都有,但**点击穿透三平台都没暴露** | 致命伤:无点击穿透 → HUD 覆盖窗吃掉全部鼠标事件,FPS 相对视角(指针捕获)与 HUD 按钮点击**二选一**;焦点在两窗口间跳动,键盘(WASD)跟着焦点走;窗口移动/缩放时覆盖窗同步滞后;X11 无合成器时透明失效 | **否决**。补齐需给 yue C++ 加三套各自平台的 input-shape(XShapeInput/WS_EX_TRANSPARENT+LAYERED/ignoresMouseEvents),维护面大且体验脆 |
| ③ **全自渲染(单窗口单 surface)** | ✓ 渲染 100% 走 wgpu,平台相关只剩 surface 创建(3D 本来就必须做);无任何叠加/穿透/焦点问题 | HUD/车库/大厅/结算全在同一 surface 上画:准星 NDC 投影数学原样搬(hud.js:54-61,注意 WebGPU z∈[0,1] 与 Y 翻转);特效与 HUD 同管线混合;唯一弱项=自绘文本框的系统 IME,而全游戏只有一处文本输入(玩家名,中文) → 用 libyue 原生**模态对话框**(独立窗口,非叠加,自带系统 IME,三平台等价)解决 | **采纳** |

定稿架构:**libyue 只做窗口壳/事件循环/模态对话框/托盘(可选);游戏全部画面自渲染**。游戏画面仍走 cube3d 的嵌入形态(Container 占满窗口 → 句柄 → surface),只是窗口里不再摆任何游戏用原生控件。输入由 host Container 的鼠标/滚轮事件(input_diag 已验证)+窗口键盘事件承载,FPS 视角用绝对位移差分(网页版本就有 >300px 跳变丢弃与虚拟光标模式的等价逻辑 main.js:482-488,892-967),指针捕获 API 若需要后续作为 libyue 小增量。
代价:A11 的 2D overlay 管线扩成"2D overlay + 基础自绘控件层"(按钮/列表/面板/文字排版/九宫格),车库/大厅从"libyue 重写"改为"自绘控件组装"——两处工作量互有消长,总账 +5~10 人日(见 §5)。

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
| A11 | 2D overlay 管线 + 基础自绘控件层(正交+图元+文字图集+按钮/列表/面板/排版,支撑 D1 全自渲染) | 14–20 |
| A12 | Raycaster | 3–5 |
| A13 | 几何补齐(Extrude+Shape/Icosahedron/Ring/Circle) | 4–6 |
| A14 | 统计/画质档/上下文销毁重建 | 3–5 |
| A15 | from_win32 surface(**实测校准:2026-10-05 Windows 机已从零做完——`from_hwnd` 构造器 ~60 行照 from_xlib 仿写 + GetModuleHandleW 一行 + adapter 优先 D3D12 回退,含 WM_SIZE 时序坑调试半天内端到端跑通,见清单 V4**) | 1–2 |
| | **小计** | **79–121** |

### B. 游戏本体

| # | 项 | 预估 |
|---|---|---|
| B1 | 逻辑内核直译(3,180 行)+ 黄金轨迹对拍验收 | 15–20 |
| B2 | config 拆分与数据外置(1.7MB→JSON) | 3–5 |
| B3 | main(场景/相机/输入/主循环/波次) 2,092 行重写 | 15–20 |
| B4 | models(装配/掩体/合批/碰撞表) | 10–15 |
| B5 | terrain + vehicle + combat + pickups 表现层 | 10–14 |
| B6 | 战斗 HUD(2D overlay 重写,四块 canvas 语义平移) | 12–18 |
| B7 | 车库/大厅/结算(自绘控件组装,534 行 CSS/DOM + 630 行 js;玩家名输入走原生模态框) | 8–12 |
| | **小计** | **75–107** |

### C. 平台层

| # | 项 | 预估 |
|---|---|---|
| C1 | 输入(键鼠映射/指针捕获=桌面版 pointer lock/wheel) | 5–8 |
| C2 | 音频(moon_rodio 集成,声像/lowpass/变调/循环/voice 上限) | 6–10 |
| C3 | 资产加载与版本化(本地 fs) | 2–3 |
| C4 | 存档(localStorage→JSON) | 1–2 |
| C5 | WS 客户端(官方 async/websocket 现成)+ net.js 协议(含插值缓冲) | 4–8 |
| | **小计** | **19–33** |

### D. 联调与收尾

| # | 项 | 预估 |
|---|---|---|
| D1 | 联机端到端(房间/钥匙/20Hz 快照/ev) | 5–8 |
| D2 | 性能对齐(合批后 draw call、阴影按需、60fps 目标) | 5–8 |
| D3 | 打包发布(Windows/Linux 产物) | 3–5 |
| | **小计** | **13–21** |

**总计:186–282 人日(中位约 234,≈11 人月;A15 按 Windows 机实测 5–10→1–2 校准,其余不变)。** 注:A11 扩入自绘控件层 +4~5、B7 改自绘 −2~3、C5 用官方 ws −1~2,总账与首版基本持平。占比:A 引擎 ~45%、B 游戏 ~36%、C 平台 ~10%、D 收尾 ~8%。

> 压缩空间的三个杠杆:① 先只做 Linux(A15 已实测仅 1–2 人日,后置收益缩水为 −1–2);② 联机后置先出单机版(C5/D1 后置,−10–18);③ 2D overlay 管线做最小集(先矩形+文字,圆弧/罗盘降级) −3–5。全开可到 ~155–245 人日。反之,要 macOS 再 +10–15。

---

## 6. 分阶段路线图

- **阶段0|验证与选型(1–2 周)**——每项都是小实验,失败即调整规划。**Windows 专项(V1–V5/V6/V7 等)已于 2026-10-05 在 Windows 机逐项实证完毕、11/11 PASS → [Windows验证清单.md](Windows验证清单.md)(含逐项证据);据此更新:**
  1. ~~**Windows 3D 嵌入链路**~~ **✅ 关闭(R1 撤销)**:shim `yue_mbt_window_get_hwnd` + three-mbt `from_hwnd`/cube3d_win 均已真机趟通,补丁在两仓库分支待审合并;新增两个 Windows 时序坑记录(WM_SIZE 同步 reconfigure 被拒、Window 级 on_wheel 错位强转),实现阶段直接按 cube3d_win 的模式写;
  2. ~~mizchi/image 16 位灰度~~ **✅ 关闭(结论=不支持)**:decode_png 对 Grayscale/16 直接 raise UnsupportedFeature → 迁移侧走「@zlib + 自写反滤波」精确 16 位路径(实测 ~80 行,8/8 采样点与 PIL 逐位一致),不必手写整条 zlib;
  3. ~~**官方 async/websocket 连通实验**~~ **✅ 关闭(R1b 撤销)**:Windows IOCP 实测可用,TCP echo 与 websocket JSON 往返全通;`external_loop_integration` 嵌 yue 主循环仍未真机验证(联机阶段5 前补测即可,有独立线程+post_task 回投兜底);
  4. ~~moon_rodio~~ **✅ 关闭(结论=解码/效果层可用,Sink 集成层 Windows 有双缺陷)**:三格式解码元数据全对、speed/looped 效果器可用;rodio 的 MixerDeviceSink/Sink 在 Windows 不被渲染线程消费且 sleep_until_end 纯忙等(moon_rodio sink.mbt:344)→ **按规划 C2 预设走「moon_cpal 原始通路 + rodio 解码/效果器 + 自管 PCM 队列」**(绕过层实测 5s ogg 满速 455 回调、mp3 帧数与元数据精确吻合、1.5x 循环 3s 满速供数);
  5. AI 主线程分帧真机帧率(AI 15 敌 + 渲染同跑)——未测(不在 Windows 清单,属阶段3 联调);
  6. X11 子窗口上叠原生控件的最小反证实验(10 分钟,给 D1 定案存档;结论已按"不可行"规划,实验仅留证据);
  7. 1.7MB JSON 运行时加载的启动耗时。
- **阶段1|引擎底座(≈A1–A4,A6)**:纹理→GLB→材质分发→hemi/雾。里程碑:一张地图的地形+掩体+坦克在窗口里点亮(无阴影无特效)。
- **阶段2|逻辑内核(≈B1–B2)**:四模块直译,golden-trace 逐帧对拍全绿。里程碑:`moon test` + 轨迹零偏差。
- **阶段3|战斗可玩(≈A5,A7–A10,A12–A14 + B3–B5)**:阴影/雾/线/粒子/Sprite/Raycaster/注入点 + main/models/terrain/vehicle/combat/pickups。里程碑:单机关卡全程可玩、F3 统计可用。
- **阶段4|HUD 与外围(≈A11,B6,B7,C1–C4)**:2D overlay + 车库/大厅 libyue + 输入/音频/存档。里程碑:完整单机版。
- **阶段5|联机(C5,D1)**:WS 客户端 + 房间流程 + 快照插值。里程碑:两台桌面端 + 现有服务器对战。
- **阶段6|跨平台与发布(A15,D2–D3)**:~~Windows surface~~(已随阶段0 实测完成,分支待合并)、性能对齐、打包。macOS 视需求后置。

依赖关系:阶段1↔2 可并行;3 依赖 1;4 依赖 3(HUD 要投影数学)与 1(A11);5 依赖 4;6 依赖 5。

---

## 7. 风险清单(按杀伤力排序)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | Windows 3D 嵌入两处缺口:libyue `native_handle_view` 返回 0 + three-native 无 from_hwnd | Windows 版整个不可用 | **已实证解决(2026-10-05 Windows 机,清单 V1–V5 全过 → [Windows验证清单.md](Windows验证清单.md)):** ① shim 补 `yue_mbt_window_get_hwnd`(顶层窗口 HWND,实测自报句柄==外部 MainWindowHandle 逐位相等、IsWindow=True)——libyue 分支 `win/native-handle` 1a9f815;② three-native 补 `WebGPURenderer::from_hwnd`(内部 create_surface_windows_hwnd + adapter 优先 D3D12)+ `examples/cube3d_win` 端到端(yue 窗口→HWND→D3D12 硬件 surface→旋转立方体,截图像素取证,15s 干净退出)——three-mbt 分支 `win/from-hwnd` dbe4845;两分支**未推 main,审阅合并后即可发版**;⚠ 实测出的两个 Windows 时序坑已随分支记录:WM_SIZE 同步栈内 configure 被拒(须 post_task 延出)、Window 级 on_wheel 错位强转收不到(滚轮挂容器) |
| R1b | async 在 Windows 的实况不明(IOCP 特性勾选 vs README"仅 Linux/macOS") | 联机功能 Windows 缺席 | **已实测撤销(2026-10-05,清单 V6/V7 全过):** async 0.22.4 的 IOCP 后端(iocp.c/io_windows.c)在 MSVC 编译通过且 TCP ping/pong 全往返,websocket 连本机 server.js create/joined+err 完整 JSON 往返——**Windows 支持为真,README "only Linux/macOS" 过时**;小坑:本机核心(moonc 0.10.12)无 `eprintln`,async 包内 6 处调用需等价替换(上游随新核心重写); Soup 备选路线无需启用 |
| R2 | 原生控件无法叠 3D 上(三平台 airspace) | HUD 架构 | 已按**全自渲染**规划(D1 三方案对比定稿),不再依赖任何叠加能力;多窗口方案因 libyue 无点击穿透 API 否决 |
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
- libyue 窗口能力核实(2026-10-05,本地源码):`Window::new_with_options(frame/transparent/no_activate)`、`set_always_on_top`(yue/view.mbt:40-76);无点击穿透/输入区域 API(全库 grep);`native_handle_view` Windows 返回 0(shim/yue_mbt.cpp:581)→ **同日已补 `yue_mbt_window_get_hwnd`(分支 1a9f815,清单 V3)**;prebuild Windows 跨模块消费相对路径 LNK1104 已修(分支 facc2d0)。
- moonbitlang/async 0.22.4 核实(2026-10-05,mooncakes 文档 + **Windows 真机**):`websocket` 包 = RFC 6455 client/server,`Conn::connect/send_text/recv(Message Text|Binary)/ping/send_close`,native 目标;`external_loop_integration` 包 = `set_external_event_loop` 官方外部事件循环嵌入;**Windows IOCP 实测可用(V6/V7 全过),README "仅 Linux/macOS" 过时**。
- Windows 机实证全记录:**[Windows验证清单.md](Windows验证清单.md)(2026-10-05,11/11 PASS,含命令/输出/像素取证)**;改动分支:moonbit-libyue `win/native-handle`(3 提交)、three-mbt `win/from-hwnd`(1 提交),均未推 main。
- mooncakes 检索:2026-10-05 站内 API(/api-new/v0/search?kw=)实查,选型见 §2。
