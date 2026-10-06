# 待办：three-native 补充项 + 跨机交接（2026-10-06 晚）

> 本文件由 2026-10-06 指针锁定功能的收尾产生。当时状态：three-native 已发
> **0.1.2**（含 PointerLock 全套机制 + `last_grab_status` 诊断），steel-front
> 已引用 0.1.2，gameapp 锁定为默认行为。接手电脑按下面顺序处理即可。

---

## 一、下一版 three-native（0.1.3 或 0.2.0）建议内容

按"对游戏的价值"排序，人日口径摘自规划稿 §5：

| 优先 | 项 | 内容与验收 | 口径 |
|---|---|---|---|
| ★1 | **dataURI 内嵌贴图 GLB** | `loaders/gltf.mbt` 支持 buffer→贴图，解锁 7 个 dataURI 车型（m4-sherman/m4a3e8/m4a3e2-jumbo/stug3/enemy-medium/enemy-td/enemy-heavy）。验收：`GAMEAPP_MP_TANK=m4-sherman GAMEAPP_FRAMES=600` 进图不崩、模型贴图正确（对照 client 页面同车型） | 小，预计半天 |
| ★2 | A12 Raycaster | 点击拾取/瞄准指示地基；纯数学可 wbtest 无头测 | 3–5 |
| ★3 | A9 透明排序+状态控制 | depthWrite/Test/blending —— 炮口闪光/曳光/烟的合成正确性 | 3–5 |
| 4 | A10 着色器注入点 | 天空穹（现在背景纯色+雾）/轮廓壳/草透明 | 5–8 |
| 5 | A14 统计/画质档/上下文销毁重建 | F3 统计、切窗恢复 | 3–5 |
| 6 | A11 2D overlay+自绘控件层 | 菜单/车库/计分板，规划最大单项 | 14–20 |
| 7 | Windows 指针锁定 | ClipCursor+重定中心；C 桩已留 no-op 位（input/native_x11.c 的 `sf_x11_grab_pointer` Windows 段）。建议配 Windows验证清单 复验一起做 | 小，需 Win 机 |

发版流程（0.1.2 已验证过一遍）：bump `moon.mod` → `moon test` → commit → push → `moon publish` → 本仓 `moonbit/moon.mod` 升引 → `moon update && moon install`。

## 二、gameapp 指针锁定行为口径（已实现，改前先读）

- **默认开**：`GAMEAPP_MOUSELOCK` 未设=开；`0`=显式关（值感知，`c_atoi`）。
  DEMO 自动演示与 MP 自动巡航**不锁**（不吞鼠标）；MP 手动需 `GAMEAPP_MP_MANUAL=1`。
- **激活即锁**：窗口聚焦连续 3 tick → 自动锁定（XGrabPointer+隐形光标+confine+回中）。
  点击同样触发（请求制）。
- **重试制**：抓捕失败是瞬态（按钮按住的隐式抓捕=AlreadyGrabbed(1)、切换动画中=
  NotViewable(3)），约 2s（120 tick）内 tick 持续重试；错误码经
  `PointerLock::last_grab_status()` 透出。失败**不**永久抑制。
- **ESC 只解锁**（不退游戏）；解锁后进入抑制期，失焦一次后重新武装（切走再切回即自动重锁）。
- **失焦自动释放**：EWMH `_NET_ACTIVE_WINDOW` 判定（Mutter 的 XGetInputFocus 在
  独立辅助窗口上，祖先链比对会误判 —— 0.1.1 真机实证）；无 EWMH 回退焦点+父链上溯。
- 锁定期事件流不可用（core grab 抑制宿主 XI2 投递），差分与 LMB 状态走
  `XQueryPointer` 轮询（60Hz tick），勿改回事件驱动。
- 帧数默认：未设 `GAMEAPP_FRAMES` = 1,000,000 帧（手动玩语义）；验收脚本一律显式设。

## 三、跨机环境注意（换电脑必读）

1. **moonbit/moon.work 不入库**：members 里的 three-native 是绝对路径，各机自改本地副本（本仓唯一约定：该文件改动永不 commit）。
2. moon 工具链需 ≥ **0.1.20260920**（0.1.20260904 无 `StringView::exact_view`，编译不过）。
3. 无 sudo 的 Linux 机：moon_cpal 链接要 alsa/jack 头文件 —— `apt download libasound2-dev libjack-jackd2-dev` 后 `dpkg -x` 解包，`CPATH`/`LIBRARY_PATH` 指过去（注意 dev 包里的 .so 是悬空软链，要重指到系统运行库）。
4. three-native 四个示例（map_lightup/glb_viewer/shadow_test/textured_plane）硬编码源机路径 `/home/lkyh/ownCode/steel-front` —— 换机要么软链同路径，要么 LD_PRELOAD 路径重映射垫片（本次用的方案，脚本在源机 /tmp，**顺手改成资产根环境变量更好**，可作 0.1.3 附带项）。
5. 铁律不变：steel-front/moonbit 里**绝不** `moon fmt`/`moon info`；测试双目标都跑；gameapp 必须 `--target native`。
6. 玩法快速体验（本机启动器在 ~/.local/bin/steel-local，他机可用裸命令）：`moon run gameapp --target native`（默认锁定+无限帧）。

## 四、本仓未提交内容处理记录（2026-10-06）

- 本次提交：`moonbit/gameapp/main.mbt`、`moonbit/gameapp/mp.mbt`、
  `moonbit/gameapp/moon.pkg`、`moonbit/moon.mod`（→0.1.2）、本文件。
- **不提交**：`moonbit/moon.work`（本机路径）。
