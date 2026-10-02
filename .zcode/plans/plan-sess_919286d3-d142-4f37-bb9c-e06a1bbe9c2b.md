# 新增高机动侦察轻坦：Ru 251（DE·VIII级轻坦）

选 **Ru 251**（史实西德 VIII 级轻坦，80km/h 级侦察车）：它是"跑得快、转弯快、有特色"的标准答案，定位全场速度/机动天花板 + 最佳视野的侦察车，与现有最快车拉开明显身位（地狱猫 72km/h、BT-7 转向 48°/s）。四项全场第一就是它的特色：极速、车体回转、炮塔回转、视距。

## 数值设计（config.js vehicles.ru251）

| 项 | Ru 251 | 现全场最快参照 | 说明 |
|---|---|---|---|
| 极速 | 22.22 m/s (80km/h) | 地狱猫 20.0 (72km/h) | 五挡自动变速箱按极速百分比跟随，无需另配 |
| 车体回转 | 55°/s | BT-7 48°/s | 转弯快的主诉求 |
| 炮塔回转 | 50°/s | 62式 44°/s | |
| 加速/刹车 | 7.5 / 11 | BT-7 6.0 | 起步窜 |
| 血量 | 1100 | — | VIII 轻坦身板，别碰重坦炮 |
| 90mm 炮 | 穿深 175 / 单发 200 / 装填 6.5s / 弹速 900 | 59式 175/250 | 够用不越权 |
| 俯角 | -10° | — | 跑图蹭坡卖头 |
| 扩圈 | base 0.36 / 缩圈 1.8s / 行进 1.4 | — | 行进射击好手，侦察风味 |
| 视距 VIEW | 400m | 62式/AMX13 390 | 全场最佳，点亮定位 |
| 弹径 CAL | 90mm | — | 过穿规则用 |

reverseRatio 0.45、coastDrag 6.0、sample l2.7/w1.25（紧凑车体）。隐蔽走 LT 类 0.16 自动注入。

## 模型（tools/build-models.js ROSTER）

低矮流线侦察车造型（对齐史实 Kanonenjagdpanzer 底盘衍生）：
```
{ type: 'ru251', nation: 'GER', hw: 1.35, wheels: 6, wr: 0.40, tl: 6.2, th: 0.8,
  hull: { l: 6.0, w: 2.7, h: 0.85, y: 1.15 }, gl: 1.6, ga: 0.35, gl2: 3.6, gr: 0.07,
  armor: { glacis: 30, lower: 25, side: 16, rear: 16, top: 10, turretFront: 25, turretSide: 16, turretRear: 16, mantlet: 40 },
  turret: { kind: 'box', w: 1.7, l: 1.9, th: 0.6, bustle: true, roundFront: true } }
```
薄甲（轻坦）、全车最低矮的车体之一、小圆角炮塔。插在 GER 块 jagdpanther 之后；`node tools/build-models.js` 程序化生成 ru251.glb（ROSTER 自动进 TANKS 列表）。

## 改动文件清单

1. **tools/build-models.js** — ROSTER 加 ru251 条目，重建生成 `client/assets/models/ru251.glb`（用 git status 验证其余 ~50 个 GLB 字节不变，确认生成器确定性）。
2. **client/js/assets.js:86-95** — MODEL_FILES 加 `ru251: 'ru251'`。
3. **client/js/config.js** — 三处：`vehicles.ru251` 条目（GER 组 jagdpanther 后）；CAL 表加 `ru251: 90`；VIEW 表加 `ru251: 400`；车库 sel 数组（config.js:597-601）'jagdpanther' 后插 'ru251'（不进 sel 车库看不到）。

## 不需要动的（探查确认）

- 敌方波次：五图 wave def 均无 LT 车型，不会突然刷出（coop 预载池多载一个模型无害）；想让某图敌人开它需另行改 build-map.js 波次，本轮不做。
- 联机：车型字符串随房间名单下发、各端懒加载 GLB，协议零改动（双方同代码版本即可）。
- 音效/特效：与车型无绑定，自动复用。

## 验证

1. `node --check` config/assets/build-models；`node tools/build-models.js` 后 git status 应只有 ru251.glb 新增。
2. 浏览器实测：起本地服 → 车库出现 "Ru 251 / DE·VIII级轻坦" 卡片（极速 80 km/h 描述）→ 选它出击 l05（平原最适合跑）→ 按住 W 直线冲刺，控制台读 `player.speed` 应逼近 22.2 m/s、HUD ~79km/h；连按 A/D 验证转向手感；截图；零控制台报错。
3. 回归：换回谢尔曼出击一次确认车辆系统无扰动。

## 提交

一次提交：`车辆: 新增 Ru 251(DE·VIII级轻坦) — 全场最快(80km/h)最灵活(55°/s车体回转)最佳视野(400m)的侦察车 …`