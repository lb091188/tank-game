# Windows 验证清单(steel-front MoonBit 桌面迁移 · 阶段0 Windows 专项)

> 用途:《MoonBit桌面端全量迁移规划》中 R1/R1b 的 Windows 未定项在此逐项实证。**验证环境:Windows 机,本清单自包含**;每项跑完把结果填进文末模板,带回后更新规划(风险表/阶段0/工作量)。
> 排序即优先级:V1–V5 = 3D 嵌入链路(核心),V6–V7 = 联机,V8–V9 = 音频/图像,V10 可选。
> 标注【零改动】的项不需要动任何源码;V3/V4 需要打两个小补丁——这本来就是规划里认定的"Windows 铺开要补的两件事",补丁草图已给出。

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
| P2 预编译包冒烟 | | | |
| V1 libyue 编译+示例 | | | |
| V2 wgpu D3D12 adapter | | | 硬件 / WARP |
| V3 HWND 暴露 | | | 返回值、IsWindow |
| V4 from_hwnd cube3d | | | resize 是否正常 |
| V5 渲染中输入事件 | | | 计数是否一致 |
| V6 async 基础 | | | R1b 裁决依据 |
| V7 websocket 连服务器 | | | 回包 JSON |
| V8 rodio 三格式 | | | 哪个格式挂 |
| V9 image 高程/纹理 | | | 16 位精确 or 8 位近似 |
| V10 gamepad(可选) | | | |

环境:Windows 版本 ____ / MSVC ____ / GPU ____ / 驱动 ____ / MoonBit ____。

**总体结论栏**:Windows 3D 链路(V1–V5)全过 → 规划 R1 撤销、阶段0#1 关闭、Windows 排期确立;async(V6/V7)过 → R1b 撤销;部分失败 → 按各项备注的备选路线改规划。
