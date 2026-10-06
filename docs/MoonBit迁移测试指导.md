# MoonBit 迁移成果·测试指导

适用范围：马拉松（2026-10-06）交付的全部成果 —— three-native `f0f0933`（已推送）与 steel-front `66c588f`（moonbit/ 全套，未推送）。文中每条核心命令都已在本机实跑核验。

---

## 0. 前置与两条铁律

- 环境：`moon` 在 PATH（`~/.moon/bin`，v0.1.20260920）；GUI 用例需要 `DISPLAY`（X11）；联机需要 `node`（v22，`node_modules` 已就绪）。
- **铁律一：绝不在 `steel-front/moonbit/` 里跑 `moon fmt` 或 `moon info`。** 该模块经 `moon.work` workspace 连着本地 three-native，这两个命令会连坐改写 three-native 源码（本次 three-native 工作树 75 个文件的格式化噪声就是这么来的）。
- **铁律二：moon 默认目标是 wasm，native-only 包（audio / gameapp / trace* 等）会被静默排除。** 测试要两个目标都跑（命令见下）。
- three-native 工作树当前带格式化噪声（`///|`→`///`）与 26 个未跟踪 `.mbti`，不影响测试；要还原干净：
  ```bash
  git -C /home/lkyh/ownCode/three-native checkout -- . && git -C /home/lkyh/ownCode/three-native clean -f '*.mbti'
  ```

---

## 1. 自动化测试（不用看画面，看退出码与输出）

### 1.1 three-native（渲染引擎回归，214 用例）
```bash
cd /home/lkyh/ownCode/three-native && moon test
```
判定：全绿，0 failed。

### 1.2 steel-moonbit（游戏模块，双目标）
```bash
cd /home/lkyh/ownCode/steel-front/moonbit
moon test                     # wasm 面
moon test --target native     # native 面（含 audio 12 例，勿漏）
```

### 1.3 黄金轨迹四路（内核与 JS 逐位一致的核心证据）★必跑
```bash
cd /home/lkyh/ownCode/steel-front/moonbit
moon run tracecheck   --target native    # 期望: TRACE OK simcore 120/120
moon run traceengine  --target native    # 期望: TRACE OK simengine N/N
moon run traceai      --target native    # 期望: TRACE OK ai 150/150
moon run tracesrv     --target native    # 期望: 两行 TRACE OK srvsim dm 92/92 + coop 90/90
```
判定：打印 `TRACE OK` 且退出码 0；出现任何 `MISMATCH`（字段/期望/实际/tick）即失败。
注意：`tracesrv` 里 dm 判伤"取首个命中盒"的语义是**有意复刻**上游 `sim-engine.js:592` 的缺陷（best 存的 distance 字段致 `best.t` 恒 undefined）——修了它反而会 MISMATCH，属夹具口径不是移植错误。

### 1.4 夹具确定性复核（可选）
```bash
cd /home/lkyh/ownCode/steel-front
node tools/golden-trace2.js > /tmp/g1.json && node tools/golden-trace2.js > /tmp/g2.json && diff /tmp/g1.json /tmp/g2.json
node tools/golden-trace2.js --check    # 与仓内基线比对
```
判定：diff 为空、`--check` 退出码 0。

---

## 2. 渲染示例人工验收（弹真窗口，自动退出）

统一在 `/home/lkyh/ownCode/three-native` 下 `moon run examples/<名称>`，看画面是否与 `steel-front/docs/` 同名验收图一致、控制台无 validation error：

| 命令 | 应看到 |
|---|---|
| `moon run examples/map_lightup` | 高度图地形+草地平铺+贴地坦克+雾（对照 `docs/map_lightup_阶段1里程碑.png`） |
| `moon run examples/pbr_check` | 并排两箱：Lambert 无高光 vs Phong 有高光簇 |
| `moon run examples/shadow_test` | 箱子/坦克在地面投影，影区明显偏暗 |
| `moon run examples/lines_test` | 灰蓝网格+琥珀三角+红→青动态折线（末端点每帧在动） |
| `moon run examples/sprite_test` | 暖色圆盘精灵 + 200 粒子喷泉，始终正面对相机 |
| `moon run examples/glb_viewer` | bt7 坦克转台 |
| `moon run examples/textured_plane` | 草地纹理 repeat 平铺 |
| `INPUT_TEST_BACKEND=yue moon run examples/input_test` | 默认后端：WASD 移箱子、左键拖拽转相机、滚轮缩放、ESC 退 |

`input_test` 后端说明：`yue`（默认）走宿主窗口事件；`x11` 是独立 X 连接真 XI2 泵，**仅在独立进程可用**（GTK 宿主进程内第二 X 连接收不到事件，是已记录的环境限制，不是回归）。

---

## 3. 原生客户端 gameapp

统一在 `/home/lkyh/ownCode/steel-front/moonbit` 下，所有开关走环境变量：

```bash
# 冒烟（30 帧即退）
GAMEAPP_FRAMES=30 moon run gameapp --target native        # 期望 rc=0

# 手动玩（大帧数预算，WASD 驾驶/瞄准开火；Ctrl-C 结束）
GAMEAPP_FRAMES=100000 moon run gameapp --target native

# 自动战斗演示（自动瞄准开火，看 tracer/爆炸/炮口火光）
GAMEAPP_DEMO=1 GAMEAPP_FRAMES=600 moon run gameapp --target native
```
对照图：`docs/gameapp_场景装配.png`、`docs/gameapp_驾驶验收_before/after.png`、`docs/战斗闭环验收.png`、`docs/HUD_自渲染验收.png`。
**本机无声是已知项**（moon_cpal 0.11.8 ALSA 后端经 PipeWire 打开即 errno -77，代码层不可修），不是回归；换机/上游修复前如此。

---

## 4. 联机（本机对打）★推荐亲手跑一次

```bash
# 终端 1：起服（--open 免建房令牌；也可用 STEEL_OPEN=1，端口默认 8342）
cd /home/lkyh/ownCode/steel-front && node server/server.js 8342 --open > /tmp/srv.log 2>&1 &

# 终端 2：原生客户端进房开战
cd moonbit && GAMEAPP_MP=ws://127.0.0.1:8342 GAMEAPP_FRAMES=5000 moon run gameapp --target native
```
判定（两边都有证据）：
- `/tmp/srv.log` 出现完整周期：`[房间NNNN] 创建 by moon-native` → `开战 l01 (dm/srvSim) 红1/蓝0 — moon-native(sherman)` → `离开`；
- 客户端窗口 HUD 状态行出现 `SNAP » SRV 房号`（快照计数在涨），画面里 sherman 行驶、炮口有火光。

可调项：`GAMEAPP_MP_ROOM=<房号>`（加入指定房）、`GAMEAPP_MP_TANK=<车型>`、`GAMEAPP_MP_NAME`、`GAMEAPP_MP_MAP=l01`、`GAMEAPP_MP_MANUAL`（手动模式）。
**双客户端对打**：第二个客户端用 `GAMEAPP_MP_ROOM=<第一个房号>`，且必须在开战前加入（开战后服务器拒 join；join 路径已实现有单测，尚未实机验证——验通请顺手回填规划稿）。

---

## 5. 已知预期失败/噪声（见到不算回归）

| 现象 | 说明 |
|---|---|
| `moon run audio_smoke --target native` 本机 rc=1 | 设计如此：真设备出声被 moon_cpal ALSA 缺陷阻断，smoke 按约以非零退出并打印诊断 |
| gameapp 退出时 `Gtk-CRITICAL gtk_main_quit assertion` | 退出路径已知无害噪声 |
| `GAMEAPP_MP_TANK` 切到 m4-sherman / m4a3e8 / m4a3e2-jumbo / stug3 / enemy-medium / enemy-td / enemy-heavy 会崩 | 这 7 个 GLB 内嵌 dataURI 贴图，three-native load_glb 尚不支持（默认 sherman 不在列） |
| `Gtk-Message: Failed to load colorreload-gtk-module` | 环境噪音 |

---

## 6. Windows 复验（下次上 Windows 机）

1. 双仓 `moon test` 双目标；
2. `examples/cube3d_win`（from_hwnd/D3D12 路径）；
3. **V11 原生客户端联机端到端**（Windows验证清单.md 已加待验行，步骤即本文 §4）；
4. moon_rodio WASAPI 真机出声（本机被 ALSA 缺陷挡住的那条链路）。

---

## 7. 测试之外的收尾待办

- three-native 工作树噪声清理（§0 命令，动手前确认无需保留）；
- steel-front：两份已跟踪文档（规划稿/验证清单）更新仍在工作树未入库；分支**领先 1 落后 4**（落后的是远端既有提交），push 前先处理；
- e2e 三项补验（X 已恢复，随时可做）：xdotool 开火的 shot/hit 取证、3 张截图补齐、`/usr/bin/time -v` 峰值 RSS。
