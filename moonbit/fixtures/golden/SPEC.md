# 黄金轨迹夹具规范(JS → MoonBit 直译比对基准)

生成工具: `tools/golden-trace2.js`(仓根相对路径; `node tools/golden-trace2.js` 重新生成, `node tools/golden-trace2.js --check` 只验不写)。
被比对内核(全部纯逻辑, 零 DOM / 零 THREE): `client/js/simcore.js`(SF.Sim)、`client/js/sim-engine.js`(SF.SimEngine)、`client/js/ai.js`(SF.AI)、`client/js/srv-sim.js`(SF.SrvSim), 以及它们共同依赖的 `client/js/config.js`(SF.Util / SF.CFG / SF.Bus)。
夹具版本种子基址 `20261006`(独立于 ai-bench 的 20261004 与 golden-trace/sim-headless 的 20261005)。

## 1. 文件与内容

| 文件 | 被测内核 | 加载序(boot) | snapshot 数 | 场景种子 |
|---|---|---|---|---|
| `simcore.json` | SF.Sim 纯函数(高程/通视/坡度/遮挡/寻掩/隐蔽) | simcore → config | 120 | 20261006(无随机消费) |
| `simengine.json` | SF.SimEngine 行驶/碰撞/坠落/装填/开炮/弹道 | simcore → config → sim-engine | 90 | 20261007 |
| `ai.json` | SF.AI FSM 感知/导航/开火纪律(双 AI 对抗) | simcore → config → sim-engine → ai | 150 | 20261008 |
| `srvsim.json` | SF.SrvSim 权威房(dm 段 + coop 段) | simcore → config → sim-engine → ai → srv-sim | 92 + 90 | 20261009(全局), 房间种子 777(dm)/778(coop) |

每份 JSON 顶层结构:

```json
{
  "meta": {
    "name": "...", "generator": "tools/golden-trace2.js",
    "seed": <场景全局 Math.random 种子>, "seed_note": "...",
    "source": "client/js/xxx.js", "loads": ["以 new Function('window',src)(globalThis) 依次装载的内核文件"],
    "map": "l04-steppe | l01-encounter", "dt": 0.016666666666666666,
    "ticks": <tick 总数>, "sampleEvery": <采样间隔 tick>, "snapshots": <条数>,
    "inputs": { <地图输入数据, 见 §3> },
    "input_script": ["逐条文字描述的脚本化输入(与工具内实现一一对应)"],
    "fields": { <各字段语义说明> }
  },
  "snapshots": [ ... ],          // 见各夹具 meta.fields
  "events":   [ ["fire", t, netId, px,py,pz, dx,dy,dz], ... ],   // simengine/ai: 全量事件流水(量化后)
  // srvsim.json 另有:
  "coopSnapshots": [ ... ], "coopLog": [ ... ],
  "result": { "finished": 0|1, "win": 0|1, "scoreRows": [[id,name,kills],...] },
  "coopResult": { ... }
}
```

各 snapshot 的精确字段见各夹具 `meta.fields` 与 `meta.input_script`; srvsim 的 `tnRows` 是 `SF.SrvSim.snapshot().tn` 的 14 字段行原样(`srv-sim.js:517-524` 内部已 toFixed 量化), 列序 `[x, z, y, yaw, turretYaw, gunPitch, speed, hp(round), alive, reloadT, reloadTotal, clipLeft, pitch, roll]`。

## 2. 量化与哨兵

- 所有浮点数值经 `q6(v) = Math.round(v * 1e6) / 1e6` 量化到 **1e-6 网格**(除 srvsim `tnRows` 用房内自带的 toFixed 量化, 粒度更粗, 同样逐字段全等可比)。
- `NaN` 视为生成失败(工具硬错退出, 夹具中不会出现)。
- `±Infinity` 只出现在模块毁伤字段(`mod.track/engine/gun/ammo`), 统一编码为哨兵 **`-1`**; MoonBit 侧读到 `-1` 应还原为"永久毁伤"态(直译时即 `Infinity`)。
- 布尔 → `0/1`; 枚举字符串(`gear=D1/D2/D3/R1/R2/N`、`clipPhase=intra/long/single`、AI `state=patrol/alert/combat/retreat`)参与**全等**比对。
- 角度字段(yaw/turretYaw 等)**不取模**: 直译的累加路径会保留累计值(可超 ±π), 比对的是量化后的原值。

## 3. 输入数据(内嵌于每份 meta.inputs, 夹具自包含, 不依赖运行时读地图文件)

- `terrain_cfg`: `{size:1000, resolution:288, maxHeight:70}`(map.json terrain 原样)。
- `heights_u16_le_b64`: heightmap.png 解滤波后的原始 16bit 采样值, `Uint16Array(288×288)` 行主序(`j*res+i`), Little-Endian 字节序的 base64。
- **高程重建公式(必须逐位复刻, 两级 f32 舍入)**:
  ```
  d = f32(v / 65535.0)          // 第一级: ai-bench loadPNG16 的中间 Float32Array
  h = f32(d * maxHeight)        // 第二级: loadTerrain 写入目标 Float32Array
  ```
  即 MoonBit 侧 `heights[i] = ((v / 65535.0).to_f32() * 70.0).to_f32()`(先除、f32 舍入、再乘、再 f32 舍入)。跳过任一级舍入会在长程积分(坠落/弹道)里放大出 >1e-6 的偏差。
- `covers_raw`: map.json covers 数组原样(coverCol 的输入)。coverCol 移植样例: `client/js/srv-sim.js:23-45`、`tools/ai-bench.js:216-238`(纯 switch, 无随机)。
- `covers_note`/`heights_u16_layout`: 布局说明。

## 4. PRNG 复现方案(确定性核心)

JS 侧唯一随机源是替换后的全局 `Math.random`; 定义(各工具同式, `tools/golden-trace2.js` 内 `mulberry32`):

```
a = seed >>> 0
每次调用:
  a = (a + 0x6D2B79F5) | 0
  t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  返回 ((t ^ (t >>> 14)) >>> 0) / 4294967296
```

MoonBit 复现要点(全整数运算, 可逐位一致):
- `Math.imul(x, y)` = 32 位环绕乘法: `(x * y) 低 32 位`, MoonBit 用 `Int` 乘后截断(或 `(x*y) & 0xFFFFFFFF` 语义的 wrap); `| 0` / `>>> 0` = 32 位补码/无符号重解释。
- 除以 4294967296 得 `Double` ∈ [0,1) —— 精确除法, 双方可逐位一致。
- **注入时机**: 工具在每次 `boot()` 装载任何内核脚本**之前** `Math.random = mulberry32(seed)`, 场景每遍重跑同样重置 —— 消费流从"脚本加载后第一次掷骰"起算。MoonBit 侧等价做法: 一个可注入的全局 RNG 状态, 在"构造任何内核对象之前"初始化为对应种子。
- **消费次序即规范**: 夹具的数值轨迹隐含了每一颗骰子的次序(构造函数掷骰 → 事件路径掷骰 → …)。直译必须保持与 JS 相同的调用次序, 任何一处次序颠倒都会从该点起整段漂移 —— 这正是夹具要抓的直译走样。
- **srv-sim 房间内部还有一条独立流**: `SF.SrvSim.create` 内部 `mulberry32(opts.seed)`(srv-sim.js:76-89)用于出生池洗牌, 与全局流并行, 互不影响; dm 段房间种子 777、coop 段 778。
- 全局流的消费点清单(便于对账): simengine=开炮散布 2 骰/发(`makeShells.spawn` 的 `sqrt(random())` 与 `random()*2π`)、摔伤断带掷(`v > trackV && random() < trackChance`)、判伤穿深/伤害/弹药架/发动机掷; ai=AI 构造(合围扇区/感知相位/换位时钟)、无线电与听声误差、搜剿点、换位脉冲、绕侧掷、以及上述弹/判伤骰; srvsim=重生取点 `rebuild`、判伤/散布骰、coop 波次生成(数量/抖动/挑车 `pickTierTank` 的 `for..in CFG.vehicles` 次序=源码插入序)与空投(时机/落点/类型权重)。

## 5. 判定标准(硬门禁)

MoonBit 侧实现四内核直译后, 用同一夹具 JSON 驱动自身实现, **逐 snapshot、逐字段**比对:

1. snapshot 条数与每条的字段集合必须与夹具一致(数量不等 = 直接 FAIL)。
2. 数值字段: `|moonbit - golden| <= 1e-6`(绝对差; 双方都已是 1e-6 量化值, 理想直译应逐字段全等, 1e-6 是浮点余量)。
3. 字符串/整型字段(gear/clipPhase/state/id/计数): 必须全等。
4. `events` 流水(coopLog 同): 条数与逐字段一致(容差同上)。
5. srvsim `result`/`coopResult`: finished/win/scoreRows 全等。
6. 任一字段超差即 FAIL, 报告须含 fixture 名 + snapshot 下标 + 字段路径 + 双方值 —— 不允许放宽断言或跳过子集。

建议伪代码:

```
for (snapIdx, golden) in fixtures[name].snapshots:
    mine = my_snapshots[snapIdx]
    for field in fields_of(name):
        if is_string(field):  assert mine[field] == golden[field]
        else:                 assert abs(mine[field] - golden[field]) <= 1e-6
```

## 6. 场景与已知行为(直译须同构, 缺陷也要复刻)

- **simengine**: 主车 pz4(netId=1)+partner stug3(netId=2), l04-steppe, 1800 tick, 每 20 tick 采样。脚本阶段: 直行升挡→转向掉速→倒车换向→追击(车车互推+撞击伤害, 实测 ram=2 双向)→交战对射; 注入: k=1200 悬空 targetY+12.5m(原地, 姿态归零), k∈[1200,1260) 全局 **dt=0.1**(60Hz 下 `fallV·dt` 跨不过剩余 gap 带, 落地结算数学上不可达 —— golden-trace.js:150-154 同款原理; 11.5~12.5m 落差在 dt=0.1 的第 11 步命中"tick 起点 gap>1.2 且 fv·dt 一步跨过"带, 实测摔伤 631 + 概率断带掷中), k=1350 断带、k=1500 发动机∞、k=1650 弹药架∞。判伤走 `probeTankOBB` + srv-sim 同款结算。
- **ai**: 双 pz4 对抗(A=sniper netId=1, B=flanker netId=2, 出生 (-380,-380)/(-330,-380)), 各持交换目标池的世界视图(地形/掩体/坦克表共享), 5s 原地重生, 3600 tick 每 24 tick 采样。FSM 四态/点亮/反应延迟/开火窗口/停车即射/摆角全部走到(实测 destroyed=1)。
- **srvsim dm**: 2v2(pz4/sherman vs stug3/tiger1), 房间种子 777, timeLimit=30s, 1830 tick(>1800: 让 timeLeft 浮点累减确切过零 → finish(false)); 每 90 tick 对 id∈{1,3} 调 `api.testFire`(确定性调试钩子: 移至敌 25m 点射)。
- **srvsim coop**: 2 人(pz4/sherman), 房间种子 778, 波次=map.json l04 两波, 维修窗 duration 显式传 60(见下), 7200 tick 每 80 tick 采样; 无敌时人类驶向最近落地空投(引 pkGet/pkApply), 首条 setInput 触发第 0 波。
- **上游已知缺陷(夹具原样记录, MoonBit 直译必须同构; 若"顺手修好", 对账即报分歧 —— 属直译走样, 不是修复)**:
  1. `srv-sim.js:241 makeJudge(dispatch)` 按值捕获的是 `:178` 的基础事件出口, `:278` 的全功能版(kill→计分+重生队列)只挂在外层变量上 —— **dm 的 shell/ram 击杀不加分、不重生**(onEvent 计数照走; 夹具中 `ev.kill>0` 而 `sc` 恒 0、被击毁车 `alive` 恒 0 即此)。
  2. coop 波间维修倒计时**双扣**: `tick()`(srv-sim.js:507)与 `checkWaveCoop()`(srv-sim.js:370)各扣一次 `repairT` —— 实际窗=duration/2(夹具传 60 换 30s 实效; commit 53d043f 已知遗留)。
  3. coop 分支 `timeLimit = 9999`(srv-sim.js:573)写的是**未声明的隐式全局**(非局部 `timeLeft`)—— 快照 `st` 恒为 create 的默认 180。

## 7. 复现与门禁命令

```bash
node tools/golden-trace2.js            # 生成/覆盖 4 份 JSON(每场景进程内双跑逐字节互验)
node tools/golden-trace2.js --check    # 重算并与盘上夹具逐字节比对(门禁; 退出码 0=一致)
```

工具零 npm 依赖(fs/path/zlib 内置); 生成耗时 ~1s。任何内核 JS 的直译若改变行为, `--check` 不受影响(它只验 JS 基线自身), 真正的比对发生在 MoonBit 测试读取夹具时(见 §5); 内核 JS 改动后须重跑生成并同步重录。
