# Windows 验证清单(steel-front MoonBit 桌面迁移 · 阶段0 Windows 专项)

> 用途:《MoonBit桌面端全量迁移规划》中 R1/R1b 的 Windows 未定项在此逐项实证。**验证环境:Windows 机,本清单自包含**;每项跑完把结果填进文末模板,带回后更新规划(风险表/阶段0/工作量)。
> 排序即优先级:V1–V5 = 3D 嵌入链路(核心),V6–V7 = 联机,V8–V9 = 音频/图像,V10 可选。
> 标注【零改动】的项不需要动任何源码;V3/V4 需要打两个小补丁——这本来就是规划里认定的"Windows 铺开要补的两件事",补丁草图已给出。
>
> **2026-10-05 Windows 机实证完成:P1–P2、V1–V10 全部执行,11/11 项 PASS(V8 带架构备注)。** 逐项证据见文末「实证详录」,汇总表见「回填模板」。改动分支(未推 main,待审):
> - moonbit-libyue `win/native-handle`(基于 c5e17b3):`9d11d45` 标记 sysmonitor Linux 专属;`1a9f815` 新增 `yue_mbt_window_get_hwnd`(V3);`facc2d0` 修 prebuild Windows 跨模块消费 LNK1104
> - three-mbt `win/from-hwnd`(基于 c290ca4):`dbe4845` 新增 `WebGPURenderer::from_hwnd` + `examples/cube3d_win`(V4/V5)

## 前置准备

- **P1 环境**:Windows 10/11 x64;Visual Studio 2022 Build Tools(工作负载"使用 C++ 的桌面开发",含 MSVC + Windows SDK);Git;MoonBit 工具链(moonbitlang.com 下载,`moonc ≥ 0.10.14`,`moon version --all` 验证)。
- **P1 记录**(回填时必填):Windows 版本 / MSVC 版本 / GPU 型号(独显 or 核显)+ 驱动版本。
- **P2 零编译冒烟【零改动,5 分钟】**:下载 moonbit-libyue releases 的 `bin-windows-x64.zip`,解压跑里面任一 exe。目的:先证明 libyue GUI 本体在这台机器没问题,再谈编译。
- **P3 源码**:`git clone` moonbit-libyue 与 three-native(或 fork);Windows 上的改动建议在这两份源码里做。

## V1 libyue 源码编译与示例运行【高,近乎零改动】

- 目的:验证 Windows 编译链(shim C++ + 预编译 yue 原生库拉取)。
- 步骤:进 moonbit-libyue,按 README/scripts 走(`python scripts/prepare.py` → `prebuild.py`,会拉预编译原生库;遇阻看 scripts/vendor_native.py),然后 `moon run examples/<hello 或 showcase>`。
- 通过标准:窗口正常出现,无缺 DLL / 链接错误。
- 失败记录:报错全文 + 缺失的 dll 名(prebuild 产物没到位最常见)。

## V2 wgpu_mbt D3D12 后端冒烟【高,零改动】

- 目的:验证 wgpu 在这台机器的 GPU 上走 D3D12。
- 步骤:新建 hello 工程,`moon add Milky2018/wgpu_mbt@0.16.2`(与 three-native 同版本);main 里 `@wgpu_mbt.require_native()` → 建 Instance → `request_adapter_*` → 打印 adapter 信息/backend。
- 通过标准:拿到 adapter 且 backend 为 D3D12(或至少列出 WARP 软件适配器)。
- 备注:无独显用 WARP 也算过,但记录清楚是硬件还是 WARP(影响后续性能预期)。

## V3 顶层窗口 HWND 暴露【高,小补丁】

- 背景(已在 Linux 侧源码查明的两个事实):①moonbit-libyue 的 `native_handle_view` 在 Windows 直接 `return 0`(shim/yue_mbt.cpp:581,作者留的 TODO,注释"HWND 需经内部类转换");②**Windows 上 Container 是无窗口视图**(yue/nativeui/win/container_win.h:17,`ContainerImpl : public ViewImpl`,GDI+ 画在父窗口上,自己没有 HWND)——所以正确路径不是给 Container 挖句柄,而是取**顶层窗口的 HWND**:`WindowImpl : public Win32Window`(nativeui/win/window_win.h:23),HWND 就在 Win32Window 基类里。
- 步骤:
  1. 【零改动先证实现状】MoonBit 侧对任一控件调 `@yue.native_handle_view`,打印返回值——预期 0,证实 TODO 存在;
  2. 给 shim 加一个 `yue_mbt_window_get_hwnd`(OS_WIN 分支:从 yue Window 的 C++ 对象转到 `nu::WindowImpl`,返回其 Win32Window 基类的 HWND;参照同文件里 `yue_mbt_view_get_native_handle` 的 `CastToView` 写法找 Window 的转换入口),头文件 shim/include/yue_mbt.h 加声明,MoonBit 侧加 extern "c" 绑定;
  3. 重编(同 V1 流程),打印句柄并用 `IsWindow()` 验证。
- 通过标准:句柄非 0 且 IsWindow 为真。
- 备注:全自渲染架构下(规划 D1)游戏窗口里只有 3D,没有别的原生控件,**整窗渲染正好用窗口 HWND**,不需要子区域句柄;如果后续车库想"3D 子区域 + 原生控件并排",Windows 上才需要另加 SubwinView 宿主控件(先不管)。

## V4 three-native `from_hwnd` + cube3d Windows 版【高,小补丁,端到端核心】

- 目的:跑通"yue 窗口 → HWND → wgpu surface → 渲染"全链路,这是 Windows 版的生死项。
- 背景:wgpu_mbt 0.16.2 **已封装** Windows surface API(无需验证存在性,直接用):`Instance::create_surface_windows_hwnd`(wgpu_instance.mbt:504)、`surface_descriptor_windows_hwnd_new`(wgpu_surface.mbt:70)。
- 步骤:three-native 的 `renderers/renderer.mbt` 仿照 `from_xlib`(renderer.mbt:36)加一个 `WebGPURenderer::from_hwnd(hwnd : UInt64, width, height)`,内部调上面的 API;复制 `examples/cube3d` 为 `cube3d_win`,XID 路径换 V3 的 HWND。
- 通过标准:窗口出现旋转的青色立方体;**拉伸/最大化窗口画面跟随且不消失**(resize→surface 重配链路);15s 自动退出无崩溃;深度正确(立方面相互遮挡正常)。
- 失败记录:卡在哪一步(adapter/surface configure/首帧 present)、D3D12 调试层报错原文。

## V5 渲染循环运行时的输入事件【高,近乎零改动】

- 背景:Linux 上曾出现"渲染循环跑起来后 GTK 事件失效",专门做了 input_diag 示例排查;Windows 必须同等验证(游戏输入全押在这上面)。
- 步骤:在 V4 的 cube3d_win 里给 host(或整窗渲染时给 window)挂 `on_mouse_down` / `on_wheel` 计数器,渲染运行中连点 10 次、滚 5 次,观察计数与控制台输出。
- 通过标准:事件全部到达,计数与操作一致。
- 备注:若失败,对照 three-native `examples/input_diag` 的三模式(render/surface/frame)在 Windows 上各跑一遍,记录哪种模式丢事件——Linux 上调研结论可参考 docs/research/wgpu-mbt-assessment.md。

## V6 moonbitlang/async 基础实况【高,零改动,裁决 R1b 矛盾】

- 背景:async 0.22.4 的特性清单勾了"Windows support (IOCP)"但 README 正文写"only supports native/LLVM backends on Linux/MacOS",官方文档自相矛盾,只能实测。
- 步骤:`moon add moonbitlang/async@0.22.4`;跑 async 仓库 examples 里最小的例子(sleep/timer + 一个 TCP socket echo)的 Windows 等价物。
- 通过标准:能编译、能跑、echo 正常。
- 失败记录:编译错还是运行错、原文。失败不致命——规划里 WS 备选是独立线程 + 队列回投,或 soup;单机模式完全不受影响。

## V7 async/websocket 连真实服务器【中高,零改动】

- 步骤:`moon add` websocket 包;客户端连现网 `ws://<游戏服务器>:8342/`,按 net.js:56 的门禁格式发一条 JSON(如 `{"t":"join","room":"xxxx","pw":"","name":"win_test","tank":"bt7","proto":2}`),收一条回包打印。
- 通过标准:收到服务器 JSON 回包(joined/lobby/err 任意一种都算链路通,err 说明协议层已通)。
- 备注:不方便连公网就在 Windows 本机 `node server/server.js` 起一份连 localhost。

## V8 moon_rodio 三格式播放【中,零改动】

- 步骤:`moon add Milky2018/moon_rodio@0.3.5`;播放三个游戏内文件:`audio/engine-loop.wav`(loop=true + playbackRate 1.5 变调)、`cannon.ogg`、`audio/voice/` 任一 `v_*.mp3`。
- 通过标准:三格式都出声;循环无缝;变调生效(音调明显升高)。
- 备注:失败则记录哪个格式/哪个环节(解码 or 设备打开);备选路线是 moon_cpal + 纯解码包(moonvorbis/mp3/moon-wav),规划 §2 已列。

## V9 mizchi/image 高程图与纹理解码【中,零改动】

- 步骤:`moon add mizchi/image@0.4.3`;解码 `client/assets/maps/l01-encounter/heightmap.png`(288×288、16 位灰度),打印 4 个采样点的 16 位值;解码 `textures/asphalt.jpg`、`textures/rust.jpg` 打印尺寸。
- **期望值(Linux 本机 PIL 实测,2026-10-05,直接对数字)**:

| 采样点(x,y) | l01-encounter | l06-winter |
|---|---|---|
| (0,0) | 60129 | 57966 |
| (143,143) | 6706 | 4946 |
| (287,287) | 60243 | 57864 |
| (100,50) | 23949 | 6892 |

  JPG 尺寸:asphalt = 1024×662,rust = 1024×256。
- 通过标准:PNG 尺寸 288×288 且采样值等于上表;JPG 尺寸一致。
- 备注(重要语义):若解码库只吐 8 位,记录实际值——网页版浏览器 canvas 本身也是 8 位近似(JS 拿到的是 `≈(v>>8)*257`,与真值差 < 0.15 米高度,地形语义可接受)。所以"精确 16 位"和"浏览器等价近似"都算过,但**必须记录是哪种**,决定迁移侧用哪条语义(对应规划 §4.2 的"PNG16 两条路径")。

## V10 手柄(可选,低)【零改动】

- `moon add Milky2018/gamepad@0.4.7`,插手柄枚举设备。网页版未用手柄,此项纯加分,失败不影响。

## 回填模板(验证完填这张表带回来)

| 项 | 结果 PASS/FAIL | 现象/报错(关键行) | 备注 |
|---|---|---|---|
| P2 预编译包冒烟 | **PASS** | bin-v0.5.3 `hello.exe` 启动,PID 存活,可见顶层窗口(HWND 263290),无缺 DLL | WebView2Loader.dll 随包 |
| V1 libyue 编译+示例 | **PASS** | CMake+MSVC 编 shim → `moon run examples/hello` 窗口出现(用户目击正常关闭);`moon test yue` 66/66 | 全树 `moon test` 挂在 examples/sysmonitor(StringView::exact_view 核心漂移,该示例 Linux 专属),已在 libyue 分支标记;首次跑 prepare.py 必须 vcvars64(CMakeLists.txt:69 检查 INCLUDE) |
| V2 wgpu D3D12 adapter | **PASS** | `backend=4(D3D12) device=Intel(R) Iris(R) Xe Graphics adapter_type=2(IntegratedGPU)`;WARP 也拿到(Microsoft Basic Render Driver, adapter_type=3 CPU);默认枚举报 Vulkan | **硬件适配器**(非 WARP);坑:wgpu-native 静态库从 GitHub 拉,gfx-rs/wgpu-native v29.0.1.1 sha256 校验,间歇网络需重试 |
| V3 HWND 暴露 | **PASS** | 现状:`native_handle_view(container)=0`、`(window.view)=0`(TODO 证实);补丁后:`native_handle_window(window)=1048930`,外部 PowerShell 同进程 MainWindowHandle=1048930 **逐位相等**,Win32 `IsWindow()=True` | 补丁 = shim `yue_mbt_window_get_hwnd`(CastTo<nu::Window>→GetNative()->hwnd())+ ffi/view.mbt `native_handle_window`;libyue 分支 1a9f815 |
| V4 from_hwnd cube3d | **PASS** | `hwnd` 自报==驱动外部读数逐位一致;`backend=4(D3D12) vendor=27.20.100.8439`;首帧截图像素取证青色立方体 4168 像素;**最大化后 21638 像素、包围盒随窗口放大**(resize 跟随不消失);15s 自动退出无崩溃 | three-mbt 分支 dbe4845;**Windows 时序坑:WM_SIZE 同步栈内 configure_default 被拒("window is in use"/ResizeBuffers 无效调用 → wgpu-native Rust panic abort,MoonBit catch 接不住)→ resize 必须 post_task 延出窗口过程 + pending 期跳帧** |
| V5 渲染中输入事件 | **PASS** | 渲染循环运行中合成输入:**clicks=10/10、wheels=5/5 逐条一致**(PostMessage 直投消息队列驱动),15s 退出时计数汇报 | **坑:Window 级 on_wheel 在 Windows 收不到**(shim yue_mbt.cpp:2679 Windows 分支 CastToView 错位强转——Window 与 View 是 Responder 兄弟类,wheel_hook 是 ViewImpl 内部件;Linux 同族 bug 已按类名分派修过)→ 滚轮挂 Container(真 View);on_mouse_down 挂 Window/容器均可 |
| V6 async 基础 | **PASS** | async 0.22.4 TCP ping/pong(内嵌 server + 7 客户端)全往返,干净终止;**IOCP 后端(iocp.c/io_windows.c)MSVC 编译通过且运行正常** | R1b 裁决:**Windows 支持为真,README "only Linux/macOS" 过时**;小坑:本机核心(moonc 0.10.12)无 `eprintln`,async 内部 6 处调用需 shim(仓库分支待随新核心重写) |
| V7 websocket 连服务器 | **PASS** | 连本机 `node server/server.js`:`{"t":"create",...}` → `{"t":"joined","room":"4111",...,"proto":2}`;坏房号 join → `{"t":"err","msg":"房间不存在"}`;服务器侧日志 `[房间7713] 创建 by win_test` | 官方 async/websocket 完整 JSON 文本帧往返;服务器日志交叉印证 |
| V8 rodio 三格式 | **PASS**(带架构备注) | 解码层:wav looped/ogg(ch=2,48k,3.58s)/mp3(ch=1,44.1k,0.784s)元数据全对;**组合层实测:cannon.ogg 455 回调/240240 帧(5s@48k 满速)、mp3 34848 帧=0.79s 与元数据精确到帧 drained=true、engine-loop 1.5x 变调循环 3s 墙钟 143616/144000 帧满速供数** | **moon_rodio 0.3.5 的 MixerDeviceSink/Sink 集成层 Windows 双缺陷**(0.11.8/0.3.5 实测):① `Sink::sleep_until_end` 纯忙等(moon_rodio sink.mbt:344-354 空循环体,100% 单核);② Sink 队列在 Windows 不被渲染线程消费(pos 恒 0/empty 恒 false,无错误回调)——**但 moon_cpal WASAPI 层健康**(作者 cmd/wasapi_stream_smoke 全过,output callbacks=93)→ **游戏音频走「cpal 原始通路(build_output_stream)+ rodio 解码/效果器」自管 PCM 队列**,与规划 §2 预设的"解码 PCM 上等价实现"完全一致,C2 工作量不变 |
| V9 image 高程/纹理 | **PASS** | asphalt/rust 尺寸 1024×662、1024×256 全 MATCH;**decode_png 直吃 16 位灰度 raise `UnsupportedFeature: unsupported color type/bit depth: Grayscale/16`**;@zlib+自写 5 种滤波 PNG16 路径:**8/8 采样点与 Linux PIL 期望逐位相等**(l01: 60129/6706/60243/23949,l06: 57966/4946/57864/6892) | 语义钉死(规划 §4.2"PNG16 两条路径"):mizchi/image 走不了 16 位 → **迁移侧用「@zlib + 自写反滤波」精确 16 位路径,约 80 行**,真机已验;Python 预演交叉验证逐位一致 |
| V10 gamepad(可选) | **PASS** | `Gil::new_native()` 构建成功,枚举 `gamepads connected: 0`(本机未插手柄),API 健康 | 纯加分项 |

环境:Windows 版本 **Win10 专业版 22H2(10.0.19045 Build 19045)** / MSVC **VS2022 BuildTools 17.14.37628.2(MSVC 19.44, SDK 10.0.26100)** / GPU **Intel Iris Xe Graphics(核显,AdapterRAM 1GB)** / 驱动 **27.20.100.8439** / MoonBit **moon 0.1.20260904 (moonc v0.10.12+1634b282e)**。

**总体结论栏**:Windows 3D 链路(V1–V5)全过 → **规划 R1 撤销、阶段0#1 关闭、Windows 排期确立**(补丁已在分支,审阅合并即收口);async(V6/V7)过 → **R1b 撤销**(README 表述过时,以实测为准);V8 需按"自管 PCM 队列"架构落地(规划本就如此预设);V9 确定 PNG16 走自写滤波路径。

## 实证详录(2026-10-05,命令与输出关键行)

### P1/P2

- P2:下载 release `bin-v0.5.3/bin-windows-x64.zip` → 解压得 `hello.exe/hello-themed.exe/showcase.exe/WebView2Loader.dll`;后台启动 hello.exe,PowerShell 按 PID 枚举:`PID=4340 alive=True`,可见顶层窗口 `Hwnd=263290`;无缺 DLL 对话框。
- V1 编译:`call vcvars64.bat && python scripts/prepare.py` → `yue_mbt.vcxproj -> build\yue_mbt.lib` + `预构建库就位:build/yue_prebuilt.lib` + `prepare 完成`;`moon run examples/hello` 窗口正常(用户目击关闭,进程干净退出);`moon test yue` → `Total tests: 66, passed: 66, failed: 0`。

### V2(冒烟工程 moon add Milky2018/wgpu_mbt@0.16.2)

- 关键输出:`[forced-D3D12] backend=4(D3D12) vendor=27.20.100.8439 device=Intel(R) Iris(R) Xe Graphics adapter_type=2(IntegratedGPU) vendor_id=32902 device_id=39497 limits.max_texture_dimension_2d=16384`;`[D3D12-fallback(WARP)] device=Microsoft Basic Render Driver adapter_type=3(CPU)`;`[default-enumeration] backend=6(Vulkan)`。
- wgpu-native 静态库下载(1 次性,缓存 `%LOCALAPPDATA%\wgpu_mbt\cache\wgpu-native\v29.0.1.1\`):`wgpu-windows-x86_64-msvc-release.zip` sha256 `7e67d744…f78132` 校验通过;期间 GitHub 间歇 5xx/重置,断点续传重试后成功。

### V3(libyue 分支 win/native-handle)

- 现状探针(examples/probe-hwnd):`platform=windows` / `native_handle_view(container) = 0` / `native_handle_view(window.view) = 0` / 补丁后 `native_handle_window(window) = 1048930`。
- 外部核对(独立进程按 PID 读 + user32.IsWindow):`MainWindowHandle=1048930 IsWindow(1048930) = True`,与应用自报逐位相等。
- 实现要点:`CastTo<nu::Window>`(类名校验,yue_mbt_internal.h:60)→ `w->GetNative()->hwnd()`(Win32Window 基类,与 shim MouseEventScreenPoint 的 yue_mbt.cpp:2526 同路);非 Windows 平台委托 `yue_mbt_view_get_native_handle`。踩坑:块注释里写 `GtkWidget*/NSView*` 的 `*/` 会提前终结注释(MSVC 报"0x3002 不允许在标识符中")。

### V4/V5(three-mbt 分支 win/from-hwnd)

- `WebGPURenderer::from_hwnd(hwnd, w, h)`:`create_surface_windows_hwnd(GetModuleHandleW(NULL), hwnd)` → adapter 优先 `backend_type_u32=D3D12`,失败回退默认枚举;余下与 from_xlib 同构(configure/双管线/深度附着)。
- cube3d_win 文件日志(每行 fflush 落盘,moon 原生 stdout 重定向下全缓冲、崩溃即丢,证据链必须走文件):
  ```
  cube3d_win: hwnd=132510
  cube3d_win: 渲染器就绪 backend=4(4=D3D12 6=Vulkan) vendor=27.20.100.8439
  cube3d_win: 渲染循环启动
  cube3d_win: mouse_down #1 … #10
  cube3d_win: wheel #1 … #5
  cube3d_win: 15s 自动退出 clicks=10 wheels=5
  ```
- hwnd 交叉验证:应用 FindWindowA 自报 1049174 / 2229322 / 132510(三轮),与 PowerShell `$p.MainWindowHandle` 逐位相等。
- 截图像素取证(全屏 PNG 扫描 #2dd4bf±28 与 #101822±12):`render: cyan=(6,0,726,510,4168)`,`maximized: cyan=(672,273,1221,738,21638)` —— 立方体随窗口最大化放大重绘,深度/剔除正常无花屏。
- resize 崩溃修复前原貌(wgpu-native Rust panic,栈顶):`ResizeBuffers failed: …(0x887A0001)` → `surface configuration failed: window is in use` → `wgpuSurfaceConfigure: Validation Error … Invalid surface` → `fatal runtime error: Rust panics must be rethrown, aborting`;修法=on_size_changed 只置 pending 标志并 post_task 重配,pending 期帧循环跳渲染。
- V5 驱动方式:PostMessage 直投(WM_LBUTTONDOWN/UP ×10、WM_MOUSEWHEEL +120 ×5)——不抢焦点不碰光标;此前 SetForegroundWindow+mouse_event 方案会与真机前台竞争(测试机同时有人在用),PostMessage 与真实输入在 WndProc 层等价。

### V6/V7(工程 winval/async-smoke)

- V6:`moon add moonbitlang/async@0.22.4`,拷官方 examples/tcp_ping_pong(native)直跑,7 客户端 ping/pong 全往返 + `server terminate: ServerTerminate` 干净收尾;C 层编译清单含 `iocp.c/io_windows.c`(Windows IOCP 路径真实存在)。
- V7:`@websocket.Conn::connect("ws://127.0.0.1:8342/")` → send_text create → recv Text:`{"t":"joined","room":"4111","you":2,"players":[…],"tier":3,"mode":"dm","srvSimCap":true,"proto":2}`;join 房号 "ZZZZ" → `{"t":"err","msg":"房间不存在"}`;send_close 干净断开。服务器(node server/server.js 8342 --open)日志 `[房间7713] 创建 by win_test (1/4 房)`。

### V8(工程 winval/rodio-smoke)

- 排障链:`Sink::sleep_until_end` 100% 单核不返回(moon_rodio sink.mbt:344-354 `while !signal.is_done() {}` 空循环体)→ 改 50ms 轮询 `sink.empty()` 仍 `drained=false` 且 `get_pos()` 恒 0(挂 error callback 亦无输出)→ 跑 moon_cpal 自带 `cmd/wasapi_stream_smoke` **全过**(`output stream ok (callbacks=93)`、`fixed output stream ok`、input ok)→ 结论:缺陷在 rodio 集成层,cpal WASAPI 通路可用。
- 绕过版终验(cp 原始通路 `Device::build_output_stream` + `stream.play()`,回调里 rodio `Decoder::next()` 拉样本、F32LE 写帧):
  ```
  [cannon.ogg] callbacks=455 frames=240240 drained=false      (5s 墙钟满速供数, 48k)
  [v_reload1.mp3] callbacks=273 frames=34848 drained=true     (34848/44100=0.79s ≈ 元数据 0.7837s, 逐帧吻合)
  [engine-loop 1.5x] callbacks=272 frames=143616(expect≈144000) drained=false  (looped 源持续供数 + speed(1.5) 生效)
  ```
- 工程量注:绕过层即规划 C2 的"解码 PCM 自管队列", 无新增架构成本;rodio 的 Decoder/speed/looped 效果器全部直接可用。

### V9(工程 winval/image-smoke)

```
asphalt w/h: 1024/662 MATCH;rust w/h: 1024/256 MATCH(jpeg 输出 RGBA8: 2711552B/1048576B)
decode_png(16bit gray) raised as expected: UnsupportedFeature: unsupported color type/bit depth: Grayscale/16
l01 (0,0)=60129 (143,143)=6706 (287,287)=60243 (100,50)=23949 — 8/8 MATCH
l06 (0,0)=57966 (143,143)=4946 (287,287)=57864 (100,50)=6892  — 8/8 MATCH
```
- PNG16 路径实现:IDAT 拼chunk → `@zlib.zlib_decompress` → 自写 5 种滤波反演(bpp=2)→ 大端 (hi<<8|lo);与 Python PIL 预演逐位一致。

### V10

`Gil::new_native()` → `gamepads connected: 0`(未插手柄),构建/运行无错。

### 环境级坑记录(与清单项正交但影响复跑)

1. **wgpu_mbt 0.16.2 prebuild 需 GitHub**:拉 `gfx-rs/wgpu-native v29.0.1.1` 静态库,缓存于 `%LOCALAPPDATA%\wgpu_mbt\cache\`;网络间歇(本机实测 api.github.com 通但 github.com 反复 reset)用断点续传重试即可,资产 sha256 钉死。
2. **libyue prebuild.py Windows 相对路径**:`build/yue_mbt.lib` 假定链接 cwd=libyue 模块根,跨模块消费(mooncakes 用户)时 cwd=消费方根 → LNK1104;已修(路径干净用绝对路径,含引号/空格回退相对),libyue 分支 facc2d0。
3. **本机 moon 核心 API 漂移两处**(moonc 0.10.12):`StringView::exact_view` 移除(sysmonitor 示例挂)、`eprintln` 移除(async 包内 6 处);前者已标记 Linux 专属,后者运行时等价替换为 println。
4. **moon run 包装器 0xC0000005**:cube3d_win 经 `moon run` 起会在渲染初始化前偶发崩溃(直跑 `_build` 下同位 exe 不复现);证据链一律直跑 exe + 文件日志,moon run 问题另案。

