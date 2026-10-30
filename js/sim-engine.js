// sim-engine.js — 纯数值车辆模拟核心(阶段1: 从 vehicle.js/combat.js 提取, 服务端权威化的前置件)
//
// 硬约束: 零 THREE / 零 DOM / 零 Node API —— window 垫片写法与 simcore.js:1-5 同款,
// 浏览器主线程 / DedicatedWorker / Node(new Function('window',src) 或 vm 沙箱, server.js:46-61 先例)三处可跑。
// 内容 = vehicle.js update()(行驶/自动挡/转向/车车碰撞/掩体碰撞/地形贴合/坠落摔伤) + 瞄准约束 +
//        开炮(散布/弹夹/装填) + 炮弹数值积分(combat.js SF.Shells 物理循环) + 事件产出。
// 阶段2 起: 弹-车命中判定 OBB 化 —— probeTankOBB 用部位盒表(SF.CFG.partBoxes, 由
//   build-models.js --part-boxes 生成, 每部位在父空间的 AABB+枢轴)做 3D 线段-OBB 求交
//   (Util.rayObb 是 2D XZ slab, 无 pitch 轴/面法线/命中点, 不合装甲判定用 —— 新写 rayOBB3D),
//   炮塔盒随 turretYaw、炮管盒随 gunPitch 复合变换; 输出最近命中 {t, 命中点, 面法线, zone, armor},
//   浏览器 combat.js 与无头台共用同一实现(服务器可判伤, 零 THREE)。
// 位级等价: 瞄准换算的四元数逐式复刻 vendored three.min.js(r128)的
//   Quaternion.setFromEuler('YXZ')/conjugate(该版本 invert() 即 conjugate())/Vector3.applyQuaternion;
//   散布/积分/碰撞逐行移植, Math.random 掷骰次序与旧实现一一对应 —— tools/golden-trace.js 对账。
// env 约定(updateTank): { terrain: {heightAt,slopeAhead,gradAt,half}, coversList, tanks, time,
//   emit?(ev,data), onMoved?(t,dt), takeRam?(target,shooter,dmg) } —— 由薄壳(vehicle.js)或无头台注入。
window.SF = window.SF || {};
SF.SimEngine = (() => {

  /* ---------- 瞄准换算: 世界瞄准方向 → 车体局部系(与 vehicle.js 旧 THREE 链路位级一致) ---------- */
  function aimToLocal(dx, dy, dz, pitch, yaw, roll) {
    // HULL_Q = Quaternion.setFromEuler(Euler(-pitch, yaw, roll, 'YXZ')).invert()
    // r128 的 invert() 即 conjugate(x/y/z 取反, w 不变), 已核对 vendored 源
    const hx = -pitch, hy = yaw, hz = roll;
    const c1 = Math.cos(hx / 2), c2 = Math.cos(hy / 2), c3 = Math.cos(hz / 2);
    const s1 = Math.sin(hx / 2), s2 = Math.sin(hy / 2), s3 = Math.sin(hz / 2);
    const qx = -(s1 * c2 * c3 + c1 * s2 * s3);
    const qy = -(c1 * s2 * c3 - s1 * c2 * s3);
    const qz = -(c1 * c2 * s3 - s1 * s2 * c3);
    const qw = c1 * c2 * c3 + s1 * s2 * s3;
    // Vector3.applyQuaternion 逐式(q*v 后再乘 q 共轭, r128 min 源同式同序)
    const ix = qw * dx + qy * dz - qz * dy;
    const iy = qw * dy + qz * dx - qx * dz;
    const iz = qw * dz + qx * dy - qy * dx;
    const iw = -qx * dx - qy * dy - qz * dz;
    return {
      x: ix * qw + iw * (-qx) + iy * (-qz) - iz * (-qy),
      y: iy * qw + iw * (-qy) + iz * (-qx) - ix * (-qz),
      z: iz * qw + iw * (-qz) + ix * (-qy) - iy * (-qx)
    };
  }

  /* ---------- 撞击质量估算(吨): vehicle.js _mass 移植(车型密度 × 车体投影面积, 谢尔曼=1) ---------- */
  function massOf(spec) {
    const DENS = { LT: 14, MT: 32, HT: 48, TD: 34, SPG: 24 };
    return (DENS[spec.cls] || 32) * (spec.sample.l * spec.sample.w) / (3.05 * 1.45);
  }

  /* ---------- 掩体碰撞: 车体 OBB vs 掩体圆/OBB SAT 推出(models.js CoverField.collideTank 逐行移植)
     单一实现两处引用: vehicle/引擎与 models.js 均走这里(主线程 CoverField 保留委托薄壳) ---------- */
  function collideTank(t, list) {
    let nx = t.x, nz = t.z;
    const S = t.spec, hw = S.sample.w, hl = S.sample.l;
    const circ = Math.hypot(hw, hl);                     // 车体外接半径(快速剔除必须用真值, 否则会漏检)
    const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
    for (const c of list) {
      if (!c.blocksMove) continue;
      const dx0 = nx - c.x, dz0 = nz - c.z, rr = c.r + circ;
      if (dx0 * dx0 + dz0 * dz0 > rr * rr) continue;
      if (c.shape === 'box') {
        const push = SF.Util.obbPushOut({ x: nx, z: nz, yaw: t.yaw, hx: hw, hz: hl }, c);
        if (push) { nx += push[0]; nz += push[1]; }
      } else {
        // 圆掩体 vs 车体 OBB: 掩体圆心变换到车体局部系求最近点, 按穿透深度推出
        const rx = c.x - nx, rz = c.z - nz;               // 车体→掩体圆心(世界系)
        let lx = cs * rx - sn * rz, lz = sn * rx + cs * rz;   // 掩体圆心在车体局部系
        const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hl, Math.min(hl, lz));
        let ddx = lx - qx, ddz = lz - qz;                 // 最近点→圆心(车体局部系)
        let d = Math.hypot(ddx, ddz);
        if (d < 1e-6) {   // 圆心陷入车体(几乎不发生): 沿圆心→车心方向退出一个半径
          const bx = nx - c.x, bz = nz - c.z, bl = Math.hypot(bx, bz) || 1;
          nx += bx / bl * (c.r + hl); nz += bz / bl * (c.r + hl);
          continue;
        }
        if (d < c.r) {
          const k = (c.r - d) / d;
          const px2 = -ddx * k, pz2 = -ddz * k;           // 车体沿"圆心→最近点"反方向推出
          nx += cs * px2 + sn * pz2; nz += -sn * px2 + cs * pz2;
        }
      }
    }
    return [nx, nz];
  }

  /* ---------- 车辆逐帧数值更新(vehicle.js update 的行驶/碰撞/地形/坠落/瞄准/装填段移植) ----------
     t: 车辆状态宿主(字段即状态, 与旧 SF.Tank 同形 → 全代码库零改动可读); input: {throttle,steer,
     aimYaw,aimPitch,fire,holdTurret?}; env 见文件头。alive 检查由调用方(薄壳)负责(残骸表现侧处理)。 */
  function updateTank(t, input, dt, env) {
    const U = SF.Util, CFG = SF.CFG, S = t.spec, T = env.terrain;
    const emit = env.emit || ((ev, d) => SF.Bus.emit(ev, d));
    const yaw0 = t.yaw;   // 车体本帧转前朝向(右键锁定时炮塔随车体走, 见瞄准段)

    for (const k in t.modules) t.modules[k] = Math.max(0, t.modules[k] - dt);

    /* --- 行驶(惯性/迟滞/滑行) --- */
    const trackBroken = t.modules.track > 0;
    // 极速: 发动机损毁 ×slow(=旧 effectiveMaxSpeed 原式)
    const maxF = t.modules.engine > 0 ? S.maxSpeed * CFG.armor.modules.engine.slow : S.maxSpeed;
    const maxR = maxF * S.reverseRatio;
    const slope = T.slopeAhead(t.x, t.z, t.yaw, 4);
    // slopeAhead 是弧度角: 用 sin 换算重力分量做动力惩罚(角度比混用曾导致 17° 坡就损失 42% 动力)
    const slopeK = U.clamp(1 - Math.sin(Math.abs(slope)) * 0.85, 0.35, 1);
    const uphill = (input.throttle > 0 && t.speed >= 0) || (input.throttle < 0 && t.speed <= 0);

    if (trackBroken) {
      t.speed = U.moveToward(t.speed, 0, 6 * dt);             // 断带: 瘫痪
    } else {
      // 只挡"沿行进方向往高处去"且超极限: 陡壁墙(梯度模) 或 连续陡坡(方向坡度);
      // 倒车脱离/顺坡向下永远放行 —— 否则车头抵崖会上不去也退不出(卡死)
      let blocked = false;
      if (uphill) {
        const mv = input.throttle > 0 ? 1 : -1;
        // 陡壁墙: 行进方向前方 3.5m 地面是"向高处去的不可攀陡壁"(梯度模判定, 之字迂回骗不过;
        // 只挡往高处开 —— 倒车脱离/顺坡向下永远放行, 否则车头抵崖卡死)
        if (T.gradAt) {
          const ax = t.x + Math.sin(t.yaw) * 3.5 * mv, az = t.z + Math.cos(t.yaw) * 3.5 * mv;
          if (!(T.heightAt(ax, az) <= T.heightAt(t.x, t.z) + 0.15) &&
            T.gradAt(ax, az) > Math.tan(CFG.sim.maxSlope) * 1.25) blocked = true;
        }
        if (slope * mv > CFG.sim.maxSlope) blocked = true;
      }
      if (blocked) t.speed = U.moveToward(t.speed, 0, 8 * dt);   // 陡坡/陡壁爬不上去
      else {
      /* --- 自动变速箱(实车手感): 前进 D1/D2/D3 + 倒车 R1/R2 + 空挡 N(仅初始) ---
         每挡限速(D1≈42% / D2≈72% / D3=100% 极速; 倒挡 R1≈58%), 低挡扭力大;
         踩住油门逐级升挡(升挡 0.15s 扭矩中断的顿挫感), 减速/刹停自动回落(升/降阈值留滞回带防拉锯);
         前后换向: 立即切入新方向最高挡 + 1s 最大扭矩窗口(换挡全部冻结)——无逐挡顿挫、全速域授权;
         挡向不符时制动 + 新方向全扭矩一起反拽(WoT 式跟手), 速度过零即纯反向扭矩 —— 卖头骗炮的核心节奏 */
      const GB = CFG.sim.gearbox;
      if (t.shiftT > 0) t.shiftT -= dt;
      if (t.flipT > 0) t.flipT -= dt;
      const gDir = t.gear[0], gIdx = t.gear === 'N' ? -1 : +t.gear[1] - 1;
      const caps = gDir === 'R' ? GB.rev : GB.fwd, tq = gDir === 'R' ? GB.torqueR : GB.torqueF;
      const top = gDir === 'R' ? maxR : maxF;
      // 降挡: 速度掉到下一低挡上限×0.93 以下(停稳一路回落到 1 挡); 换向窗口内冻结
      if (t.flipT <= 0 && gIdx > 0 && Math.abs(t.speed) < top * caps[gIdx - 1] * 0.93)
        t.gear = gDir + gIdx;   // 'D'+2 → 'D2' (gIdx=2 → 第2挡)
      const want = input.throttle > 0.05 ? 'D' : input.throttle < -0.05 ? 'R' : gDir;
      if (t.gear !== 'N' && want !== gDir) {
        t.gear = want === 'R' ? 'R' + GB.rev.length : 'D' + GB.fwd.length;   // 换向直接切最高挡
        t.shiftT = 0; t.flipT = 1.0;
      }
      if (t.gear === 'N') {
        t.speed = U.moveToward(t.speed, 0, S.brake * dt);     // 空挡带刹滑停
        if (t.shiftT <= 0) t.gear = want === 'R' ? 'R1' : 'D1';
      } else if (input.throttle > 0) {
        if (gDir !== 'D' || t.speed < -0.3) {
          // 换向/向后溜: 制动 + 新方向全扭矩反拽(WoT 式跟手——反向动力直接参与杀前冲动量, 减速近乎翻倍)
          const pull = S.accel * (gDir !== 'D' ? GB.torqueR[0] : GB.torqueF[0]);
          t.speed = U.moveToward(t.speed, 0, (S.brake + pull) * dt);
        } else {
          const cap = top * caps[gIdx];
          if (t.speed > cap * 0.985 && gIdx < caps.length - 1) { t.gear = gDir + (gIdx + 2); t.shiftT = GB.pause; }   // 升挡顿挫
          const a = S.accel * (t.flipT > 0 ? tq[0] : tq[gIdx]) * (t.shiftT > 0 ? 0.25 : 1) * (uphill ? slopeK : 1)
            * U.clamp(1.15 - Math.abs(t.speed) / (top + 0.01) * 0.5, 0.4, 1);
          t.speed = Math.min(cap * input.throttle, t.speed + a * dt);
        }
      } else if (input.throttle < 0) {
        if (gDir !== 'R' || t.speed > 0.3) {
          // 换向/向前冲: 同上镜像——倒挡扭矩参与杀前冲动量(骗炮回缩的核心手感)
          const pull = S.accel * (gDir !== 'R' ? GB.torqueF[0] : GB.torqueR[0]);
          t.speed = U.moveToward(t.speed, 0, (S.brake + pull) * dt);
        } else {
          const cap = top * caps[gIdx];
          if (t.speed < -cap * 0.985 && gIdx < caps.length - 1) { t.gear = gDir + (gIdx + 2); t.shiftT = GB.pause; }
          const a = S.accel * (t.flipT > 0 ? tq[0] : tq[gIdx]) * (t.shiftT > 0 ? 0.25 : 1);
          t.speed = Math.max(-cap, t.speed - a * dt);
        }
      } else {
        t.speed = U.moveToward(t.speed, 0, S.coastDrag * dt); // 松手滑行
      }
      }
    }

    /* --- 车体回转(可原地转向; 断带严重削弱) --- */
    const steerAuth = trackBroken ? 0.25 : 1;
    const yawRate = S.hullTraverse * input.steer * steerAuth * U.clamp(1 - Math.abs(t.speed) / (maxF * 2), 0.55, 1);
    t.yaw += yawRate * dt;
    t.lastYawRate = yawRate;
    // 转向掉速(WoT): 急转履带侧滑损耗动量, 持续满舵明显掉速; 原地转向速度≈0不受影响
    if (Math.abs(t.speed) > 0.5) t.speed -= t.speed * Math.abs(input.steer) * 0.4 * dt;

    /* --- 位移与碰撞 --- */
    t.x += Math.sin(t.yaw) * t.speed * dt;
    t.z += Math.cos(t.yaw) * t.speed * dt;
    t.x = U.clamp(t.x, -T.half + 16, T.half - 16);
    t.z = U.clamp(t.z, -T.half + 16, T.half - 16);
    // 掩体碰撞: 车体 OBB(真实长宽) vs 掩体 SAT 推出; 真正迎面顶撞才掉速(斜擦/狗斗贴靠不受罚)
    const cx0 = t.x, cz0 = t.z;
    [t.x, t.z] = collideTank(t, env.coversList);
    if (t.x !== cx0 || t.z !== cz0) {
      const px2 = t.x - cx0, pz2 = t.z - cz0, pl = Math.hypot(px2, pz2) || 1;
      const cosv = (Math.sin(t.yaw) * px2 + Math.cos(t.yaw) * pz2) / pl;   // 车头 vs 推出方向(纯方向, 不含速度)
      if (cosv < -0.5 && Math.abs(t.speed) > 1) t.speed *= 0.3;            // 迎面 60° 锥内才算顶撞
    }
    // 车车碰撞: 含残骸(击毁的车也是实体); 车体 OBB 互推, 顶撞掉速
    // 快速剔除用真外接半径(hypot(半宽,半长)), 用小了会漏检头尾相触
    const me = { x: t.x, z: t.z, yaw: t.yaw, hx: S.sample.w, hz: S.sample.l };
    const myCirc = Math.hypot(S.sample.w, S.sample.l);
    for (const o of env.tanks) {
      if (o === t) continue;
      const dx0 = t.x - o.x, dz0 = t.z - o.z;
      const rr = myCirc + Math.hypot(o.spec.sample.w, o.spec.sample.l);
      if (dx0 * dx0 + dz0 * dz0 > rr * rr) continue;
      const push = U.obbPushOut(me, { x: o.x, z: o.z, yaw: o.yaw, hx: o.spec.sample.w, hz: o.spec.sample.l });
      if (push) {
        me.x += push[0]; me.z += push[1];
        const plen = Math.hypot(push[0], push[1]) || 1;
        // 撞击逼近速度要先于顶撞掉速取值(掉速会把冲量砍到阈值下, 高速对撞变轻碰)
        const nvx = Math.sin(t.yaw) * t.speed, nvz = Math.cos(t.yaw) * t.speed;
        const ovx = Math.sin(o.yaw) * o.speed, ovz = Math.cos(o.yaw) * o.speed;
        const closing = -((nvx - ovx) * push[0] / plen + (nvz - ovz) * push[1] / plen);
        const cosv = (Math.sin(t.yaw) * push[0] + Math.cos(t.yaw) * push[1]) / plen;
        if (cosv < -0.5 && Math.abs(t.speed) > 1) t.speed *= 0.4;
        // 撞击伤害(WoT): 高速互撞双方掉血, 逼近速度平方×质量占比, 重车占便宜(残骸不伤人)
        if (o.team !== t.team && o.alive && env.time - (t._ramT || -9) > 0.5) {
          t._ramT = o._ramT = env.time;   // 双方共冷却, 一次接触只结算一回
          const m1 = massOf(S), m2 = massOf(o.spec), e = closing * closing * 0.55;
          const ram = env.takeRam || ((target, shooter, dmg) => target.takeRam(shooter, dmg));
          ram(t, o, Math.round(e * m2 / (m1 + m2)));
          ram(o, t, Math.round(e * m1 / (m1 + m2)));
        }
      }
    }
    t.x = me.x; t.z = me.z;

    /* --- 陡坡滑落(悬崖手感): 站在超过爬坡极限的坡面上履带抓不住 ---
       沿下坡方向缓慢滑移(越陡越快, 封顶 ~4.5m/s, "上不去但滑得下来"), 滑坡中动力卸载;
       高速冲出崖沿则进入坠落(见下段), 贴着陡壁再也不会上不去下不来 */
    if (T.gradAt && t.y - T.heightAt(t.x, t.z) < 1) {
      const gLim = Math.tan(CFG.sim.maxSlope) * 1.02;
      const gHere = T.gradAt(t.x, t.z);
      if (gHere > gLim) {
        const e2 = 2;
        const gx = (T.heightAt(t.x + e2, t.z) - T.heightAt(t.x - e2, t.z)) / (2 * e2);
        const gz = (T.heightAt(t.x, t.z + e2) - T.heightAt(t.x, t.z - e2)) / (2 * e2);
        const gl = Math.hypot(gx, gz) || 1;
        const slide = Math.min(4.5, (gHere - gLim) * 5.5) * dt;
        t.x -= gx / gl * slide; t.z -= gz / gl * slide;
        t.x = U.clamp(t.x, -T.half + 16, T.half - 16);
        t.z = U.clamp(t.z, -T.half + 16, T.half - 16);
        t.speed *= Math.max(0, 1 - dt * 2.2);
      }
    }

    /* --- 地形贴合(履带四角采样 → 俯仰/侧倾/高度; 全部平滑防颠簸) ---
       车体局部系: 前进+Z, 左舷+X(经 yaw 旋转后: 左舷方向 = (cos yaw, -sin yaw)) */
    const s = Math.sin(t.yaw), c = Math.cos(t.yaw);
    const SL = S.sample.l, SW = S.sample.w;
    const hF = T.heightAt(t.x + s * SL, t.z + c * SL), hB = T.heightAt(t.x - s * SL, t.z - c * SL);
    const hL = T.heightAt(t.x + c * SW, t.z - s * SW), hR = T.heightAt(t.x - c * SW, t.z + s * SW);
    const hC = T.heightAt(t.x, t.z);
    const targetY = Math.max(hC, (hF + hB + hL + hR) / 4);   // 凹: 骑在四角上; 凸: 撑在中心上
    const tPitch = Math.atan2(hF - hB, 2 * SL), tRoll = Math.atan2(hL - hR, 2 * SW);
    if (!t._yInit) { t._yInit = true; t.y = targetY; t.pitch = tPitch; t.roll = tRoll; }  // 出生直接贴地, 不从地里升起
    const sm = 1 - Math.exp(-12 * dt);
    /* --- 坠落(WoT 坠崖): 地面离脚 >1.2m(冲出坡沿/陡壁) → 自由落体替代贴地平滑,
       落地按冲击速度摔伤; 阈值 1.2m 让最快车速下最大坡的贴地滞后(~1m)不误判悬空 --- */
    const gap = t.y - targetY;
    if (gap > 1.2) {
      t._fallV = (t._fallV || 0) + 9.8 * 2 * dt;   // 重力(2× 补贴: 半拍落地手感, 不做真弹跳)
      t.y -= t._fallV * dt;
      t.pitch = U.lerp(t.pitch, -Math.min(0.5, t._fallV * 0.06), sm);   // 车头下扎
      if (t.y <= targetY) {   // 落地结算
        const v = t._fallV;
        t.y = targetY; t._fallV = 0;
        const F = CFG.sim.fall;
        if (v > F.safeV && t.alive) {
          const dmg = Math.round((v - F.safeV) * (v - F.safeV) * F.k);
          t.modules.track = Math.max(t.modules.track, F.trackV > 0 && v > F.trackV && Math.random() < F.trackChance ? 6 : 0);   // 重摔可能断带
          t.hp -= dmg;
          if (t.hp <= 0) { t.hp = 0; t.alive = false; emit('destroyed', { tank: t, shooter: null }); }
          emit('hit', { target: t, shooter: null, point: { x: t.x, y: t.y + 1, z: t.z }, zone: 'fall', dmg, kind: 'fall', module: v > F.trackV ? 'track' : null });
        }
      }
    } else { t._fallV = 0; t.y = U.lerp(t.y, targetY, sm); }
    t.pitch = U.lerp(t.pitch, tPitch, sm); t.roll = U.lerp(t.roll, tRoll, sm);

    // 履带滚动/纹理相位(表现侧钩子, 与旧 animateTracks 在 update 内的位置一致)
    if (env.onMoved) env.onMoved(t, dt);

    /* --- 炮塔/火炮瞄准(WoT 式完整版): 世界瞄准方向 → 车体局部系(含俯仰+横滚) ---
       俯仰与回转限制都相对车体: 上坡压缩/下坡扩大世界俯角, 侧坡横滚时侧向瞄准自动补偿 */
    const cp = Math.cos(input.aimPitch || 0), sp2 = Math.sin(input.aimPitch || 0);
    const local = aimToLocal(Math.sin(input.aimYaw) * cp, sp2, Math.cos(input.aimYaw) * cp, t.pitch, t.yaw, t.roll);
    const localYaw = Math.atan2(local.x, local.z);
    const localElev = Math.atan2(local.y, Math.hypot(local.x, local.z));
    if (input.holdTurret) {
      // 右键锁定: 炮塔转角相对车体保持不变(车体转动炮塔跟着走, 世界朝向一起变), 俯仰同样锁住
      t.turretYaw += t.yaw - yaw0;
      t.lastTurretRate = 0;
    } else if (t.parts.noTurret) {
      // 固定战斗室(WoT 式): 火炮在 ±gunArc 射界内横向伺服; 超界由引擎/玩家自动转车体对准
      const arc = (S.gunArc !== undefined) ? S.gunArc : 10 * Math.PI / 180;
      const layYaw = U.clamp(localYaw, -arc, arc);
      // 当前炮向先钳回车体±射界: 车体快速回转时伺服滞后, 炮管会被甩到车体后方(开炮也朝后打)
      t.turretYaw = t.yaw + U.clamp(U.angDiff(t.yaw, t.turretYaw), -arc, arc);
      const before = t.turretYaw;
      t.turretYaw = U.angMoveToward(t.turretYaw, t.yaw + layYaw, Math.max(S.turretTraverse, 0.4) * dt);
      t.lastTurretRate = U.angDiff(before, t.turretYaw) / dt;
    } else {
      const before = t.turretYaw;
      // 分车炮塔转速: 转向期间恒伺服 —— 目标角(车体系)随车体转动而移动, 炮塔以本车
      // turretTraverse(rad/s)的相对角速度持续追赶, 故炮塔世界转速=车体转速±turretTraverse:
      // 快炮塔车(50°/s ru251)转弯中基本保持自由瞄准, 慢炮塔车(18°/s)被车体转动明显拖拽;
      // lastTurretRate 与散布 turK(下方)在转向中也自动真实化(旧版锁死期恒 0)。
      // 旧版 |steer|>0.15 即刚体随动使 spec.turretTraverse 在转向期完全失效("所有车转弯一样"), 已废;
      // 仅 turretHullLock 车(config: t30/maus 18、kv2/oi 20°/s ≤20°/s 重炮塔)保留旧二值分支
      // (转向时刚体随动/松舵伺服, 静止瞄准行为与改动前逐位一致)
      if (S.turretHullLock && Math.abs(input.steer) > 0.15 && Math.abs(t.lastYawRate) > 0.05) {
        t.turretYaw += t.yaw - yaw0;
      } else {
        t.turretYaw = U.angMoveToward(t.turretYaw, t.yaw + localYaw, S.turretTraverse * dt);
      }
      t.lastTurretRate = U.angDiff(before, t.turretYaw) / dt;
    }
    if (!input.holdTurret)
      t.gunPitch = U.moveToward(t.gunPitch, U.clamp(localElev, S.gunDepression, S.gunElevation), 1.2 * dt);

    /* --- 缩圈/扩圈 --- */
    const D = S.dispersion;
    const moveK = Math.abs(t.speed) / S.maxSpeed * D.move;
    const turnK = Math.min(1, Math.abs(t.lastYawRate) / S.hullTraverse) * D.hullTurn;
    const turK = Math.min(1, Math.abs(t.lastTurretRate) / Math.max(S.turretTraverse, 0.01)) * D.turretTurn;
    const target = U.clamp(D.base * (1 + moveK + turnK + turK), D.base, D.max);
    t.disp += (target - t.disp) * (1 - Math.exp(-dt * 2.2 / D.aimTime));

    /* --- 装填 --- */
    const wasLoading = t.reloadT > 0;
    t.reloadT = Math.max(0, t.reloadT - dt);
    if (wasLoading && t.reloadT === 0) emit('reloaded', { tank: t });

    // 开炮由薄壳在 update 返回后按同位序调用 fire()(散布/弹夹/装填数值段在本模块, 见 fire)
  }

  /* ---------- 开炮数值段(vehicle.js fire 的弹夹/装填/扩圈 + combat.js spawn 的散布偏转) ----------
     pos/dir 由调用方给出(浏览器=表现侧 muzzleWorld/gunDir 的 GLB 世界位姿, 无头=确定性脚本位姿);
     pos/dir 原样随 fire 事件透出(muzzleWorld/gunDir 每次返回新向量, 无别名风险, 旧版此处 .clone() 防御)。 */
  function fire(t, world, pos, dir, emit) {
    if (!t.alive || t.reloadT > 0) return false;
    const CFG = SF.CFG, S = t.spec;
    emit = emit || ((ev, d) => SF.Bus.emit(ev, d));
    const field = (world.shells && world.shells.field) || world.shells;   // 浏览器=SF.Shells 壳内弹场; 无头=纯弹场直挂
    if (field.capped) return false;   // 阶段5 弹量上限(满员开火预算缓解): 拒发时不消耗装填/不出事件, 弹位空出即自动补发
    const al = S.gun.autoloader;
    const rack = t.modules.ammo > 0 ? (CFG.armor.modules.ammo.reloadMult || 1) : 1;   // 弹药架受损: 装填永久变慢
    if (al) {
      if (t.clipLeft > 1) { t.clipLeft--; t.reloadT = al.intra * rack; t.clipPhase = 'intra'; }
      else { t.clipLeft = al.clip; t.reloadT = al.long * rack; t.clipPhase = 'long'; }   // 打完最后一发 → 整夹长装填
    } else t.reloadT = S.gun.reload * rack;
    t.reloadTotal = t.reloadT;
    t.stats.shots++;
    let disp = t.disp;
    if (t.modules.gun > 0) disp *= CFG.armor.modules.gun.dispPenalty;
    t.disp = Math.min(S.dispersion.max, S.dispersion.base + S.dispersion.fire); // 开炮瞬间扩圈
    field.spawn(t, pos, dir, disp);
    emit('fire', { tank: t, pos, dir });
    return true;
  }

  /* ---------- 炮弹数值积分(combat.js SF.Shells 物理循环移植; 表现/命中判定经 hooks 注入) ----------
     hooks: { onCreate?(sh), onFlight?(sh), onImpact(kind,p), onPlayerMiss?(p), onNearMiss?(sh),
             onKill?(sh), probeTank(sh,tk,ox,oy,oz,dx,dy,dz,segLen)→{distance,point,normal,zone,armor}|null,
             onHitTank(sh,tk,hit,segDir), onExplode(sh,p,directTank,directArmor) }
     update 的 env: { heightAt, coversBlocked(ox,oz,oy,dx,dz,len,dy), tanks, playerPos, playerTeam } */
  function makeShells(hooks, maxShells) {
    const cap = maxShells || 96;   // 预算缓解(阶段5): 满员开火场景的弹量上限(0.05s×20弹×OBB 108盒的粗算上界内), 超限拒发最旧弹已由 4s 生命兜底
    return {
      list: [],
      get capped() { return this.list.filter(s2 => s2.active).length >= cap; },
      spawn(owner, pos, dir, dispM) {
        if (this.capped) return null;
        // 散布: 圆内随机偏转(米@100m → 弧度近似) —— 与旧 combat.js spawn 同式同掷骰次序
        const ang = (dispM / 100) * Math.sqrt(Math.random());
        const rot = Math.random() * Math.PI * 2;
        // right = dir × (0,1,0) 归一; up = right × dir 归一(纯数域复刻 THREE crossVectors/normalize)
        let rx = -dir.z, ry = 0, rz = dir.x;
        const rl = Math.sqrt(rx * rx + rz * rz) || 1; rx /= rl; rz /= rl;
        let ux = -rz * dir.y, uy = rz * dir.x - rx * dir.z, uz = rx * dir.y;
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; ux /= ul; uy /= ul; uz /= ul;
        const ca = Math.cos(rot) * ang, sa = Math.sin(rot) * ang;
        let dx = dir.x + rx * ca + ux * sa, dy = dir.y + ry * ca + uy * sa, dz = dir.z + rz * ca + uz * sa;
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        const spec = owner.spec.gun;
        const sh = {
          active: true, owner, team: owner.team,
          pos: { x: pos.x, y: pos.y, z: pos.z },
          vel: { x: dx * spec.speed, y: dy * spec.speed, z: dz * spec.speed },
          pen: spec.pen, dmg: spec.dmg, cal: spec.cal || 75, life: spec.life || 4, tracer: null,
          grav: spec.grav || SF.CFG.sim.shellGravity,    // 火炮 HE 用大重力打高抛弧线
          splash: spec.splash || 0, _dispAtFire: dispM
        };
        this.list.push(sh);
        if (globalThis.__shellTrace && globalThis.__shellTrace.length < 40) globalThis.__shellTrace.push({ k: 'spawn', owner: owner.netId || 0, spd: +spec.speed.toFixed(0) });
        if (hooks.onCreate) hooks.onCreate(sh);   // 表现侧: 拖尾申请(可把 pos/vel 换成 THREE 向量, 引擎只读写分量)
        return sh;
      },
      update(dt, env) {
        for (const sh of this.list) {
          if (!sh.active) continue;
          sh.life -= dt;
          if (sh.life <= 0) { sh.active = false; if (hooks.onKill) hooks.onKill(sh); continue; }

          // 分段积分: 先按旧速度推进, 再加重力(与旧实现同序, 弹道逐位一致)
          const sx = sh.pos.x, sy = sh.pos.y, sz = sh.pos.z;
          const nx = sx + sh.vel.x * dt, ny = sy + sh.vel.y * dt, nz = sz + sh.vel.z * dt;
          sh.vel.y -= sh.grav * dt;
          const segx = nx - sx, segy = ny - sy, segz = nz - sz;
          const segLen = Math.sqrt(segx * segx + segy * segy + segz * segz);
          const il = segLen || 1;
          const dx = segx / il, dy = segy / il, dz = segz / il;

          // --- 收集最近命中 ---
          let hitT = Infinity, hitType = null, hitData = null;

          // 地形(沿段采样)
          const steps = Math.max(1, Math.ceil(segLen / 2));
          for (let i = 1; i <= steps; i++) {
            const tt = i / steps;
            const px = sx + segx * tt, py = sy + segy * tt, pz = sz + segz * tt;
            if (py <= env.heightAt(px, pz)) { if (tt < hitT) { hitT = tt; hitType = 'ground'; } break; }
          }

          // 掩体
          const coverT = env.coversBlocked(sx, sz, sy, dx, dz, segLen, dy);
          if (coverT >= 0 && coverT / segLen < hitT) { hitT = coverT / segLen; hitType = 'cover'; }

          // 坦克部位(先粗筛包围球: 线段上离圆心最近点 ≤3.6m 才进精确判定);
          // 精确命中经注入回调(阶段1 浏览器=GLB 部位网格, 阶段2 换引擎 OBB); 残骸同样挡弹
          if (globalThis.__shellTrace && globalThis.__shellTrace.length < 60 && !globalThis.__envDumped) {
            globalThis.__envDumped = true;
            globalThis.__shellTrace.push({ k: 'env', n: env.tanks.length, ids: env.tanks.map(x => x.netId) });
          }
          for (const tk of env.tanks) {
            if (tk.team === sh.team) continue;
            const cy = tk.y + 1.5;   // = 旧 tk.pos3 的 y 分量
            const ocx = tk.x - sx, ocy = cy - sy, ocz = tk.z - sz;
            const proj = Math.max(0, Math.min(segLen, ocx * dx + ocy * dy + ocz * dz));
            const qx = sx + dx * proj - tk.x, qy = sy + dy * proj - cy, qz = sz + dz * proj - tk.z;
            const missDist = Math.sqrt(qx * qx + qy * qy + qz * qz);
            if (globalThis.__shellTrace && globalThis.__shellTrace.length < 60)
              globalThis.__shellTrace.push({ k: 'coarse', tk: tk.netId, miss: +missDist.toFixed(1), shY: +sy.toFixed(1), segLen: +segLen.toFixed(1) });
            if (missDist > 3.6) continue;
            const hit = hooks.probeTank(sh, tk, sx, sy, sz, dx, dy, dz, segLen);
            if (globalThis.__shellTrace && globalThis.__shellTrace.length < 60)
              globalThis.__shellTrace.push({ k: 'probe', tk: tk.netId, r: hit ? (hit.zone + '@' + (+hit.distance.toFixed(1))) : 'null' });
            if (hit && hit.distance / segLen < hitT) {
              hitT = hit.distance / segLen; hitType = 'tank'; hitData = { tank: tk, hit };
            }
          }

          // --- 处理命中 ---
          if (hitType) {
            const off = hitT * segLen - 0.05;
            const p = { x: sx + dx * off, y: sy + dy * off, z: sz + dz * off };
            const wreck = hitType === 'tank' && !hitData.tank.alive;   // 打中残骸: 弹丸被吸收, 不结算伤害
            if (hitType === 'tank' && !sh.splash && !wreck) {
              hooks.onHitTank(sh, hitData.tank, hitData.hit, { x: dx, y: dy, z: dz });
            } else {
              hooks.onImpact(hitType === 'ground' ? 'ground' : 'cover', p);
              if (sh.owner.isPlayer && !sh.splash && !wreck && hooks.onPlayerMiss) hooks.onPlayerMiss(p);   // 打飞了也要有反馈
            }
            if (sh.splash)
              hooks.onExplode(sh, p, (hitType === 'tank' && !wreck) ? hitData.tank : null,
                hitType === 'tank' && hitData.hit ? (hitData.hit.armor || 0) : 0);
            sh.active = false;
            if (hooks.onKill) hooks.onKill(sh);
            continue;
          }

          // 敌方炮弹飞近 → 炮口来向指示(一次性)
          if (env.playerPos && sh.team !== env.playerTeam && !sh.warned) {
            const dPlayer = Math.hypot(sx - env.playerPos.x, sz - env.playerPos.z);
            if (dPlayer < 45) { sh.warned = true; if (hooks.onNearMiss) hooks.onNearMiss(sh); }
          }
          sh.pos.x = nx; sh.pos.y = ny; sh.pos.z = nz;
          if (hooks.onFlight) hooks.onFlight(sh);
        }
        this.list = this.list.filter(s => s.active);
      }
    };
  }

  /* ---------- 阶段2: 3D 线段-OBB 求交与部位判定(零 THREE, 服务器可用) ---------- */

  // 旋转基(列向量约定: local = Rᵀ·world): 用三条局部轴在世界系的方向表示
  // YXZ 欧拉 = RY·RX·RZ(与表现层 rotation.set(-pitch,yaw,roll,'YXZ') 同约定)
  function axesYXZ(pitch, yaw, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    const cz = Math.cos(roll), sz = Math.sin(roll);
    // R = RY·RX·RZ
    return {
      // 局部 X 轴 = RY·RX·RZ · (1,0,0)
      ex: { x: cy * cz + sy * sx * sz, y: cx * sz, z: -sy * cz + cy * sx * sz },
      // 局部 Y 轴 = RY·RX·RZ · (0,1,0)
      ey: { x: -cy * sz + sy * sx * cz, y: cx * cz, z: sy * sz + cy * sx * cz },
      // 局部 Z 轴 = RY·RX·RZ · (0,0,1)
      ez: { x: sy * cx, y: -sx, z: cy * cx }
    };
  }
  function axesRY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { ex: { x: c, y: 0, z: -s }, ey: { x: 0, y: 1, z: 0 }, ez: { x: s, y: 0, z: c } };
  }
  function axesRX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { ex: { x: 1, y: 0, z: 0 }, ey: { x: 0, y: c, z: s }, ez: { x: 0, y: -s, z: c } };
  }
  function mulAxes(A, B) {   // R = A·B: 列向量 = A·(B 的列)
    const col = (v) => ({ x: A.ex.x * v.x + A.ey.x * v.y + A.ez.x * v.z,
                          y: A.ex.y * v.x + A.ey.y * v.y + A.ez.y * v.z,
                          z: A.ex.z * v.x + A.ey.z * v.y + A.ez.z * v.z });
    return { ex: col(B.ex), ey: col(B.ey), ez: col(B.ez) };
  }
  function axesQuat(q) {   // 四元数 [x,y,z,w] → 局部轴基(与 THREE.Quaternion 旋转同一约定)
    const [x, y, z, w] = q;
    return {
      ex: { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) },
      ey: { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) },
      ez: { x: 2 * (x * z + y * w), y: 2 * (y * z - x * w), z: 1 - 2 * (x * x + y * y) }
    };
  }
  const dot3 = (a, b) => {
    const v = Array.isArray(b) ? { x: b[0], y: b[1], z: b[2] } : b;
    return a.x * v.x + a.y * v.y + a.z * v.z;
  };

  /* 3D 线段 vs OBB(slab 法): o+线段dir·t ∈ [0,len], 返回 {t, point, normal} 或 null。
     box: {C:{x,y,z} 世界中心, R:局部轴基, h:[hx,hy,hz]}。normal=命中面法线(世界系, 朝外来弹)。 */
  function rayOBB3D(ox, oy, oz, dx, dy, dz, len, C, R, h) {
    const px = ox - C.x, py = oy - C.y, pz = oz - C.z;
    const lo = [dot3({ x: px, y: py, z: pz }, R.ex), dot3({ x: px, y: py, z: pz }, R.ey), dot3({ x: px, y: py, z: pz }, R.ez)];
    const ld = [dot3({ x: dx, y: dy, z: dz }, R.ex), dot3({ x: dx, y: dy, z: dz }, R.ey), dot3({ x: dx, y: dy, z: dz }, R.ez)];
    let tmin = -Infinity, tmax = Infinity, axMin = 0, sgMin = 1;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(ld[a]) < 1e-9) { if (lo[a] < -h[a] || lo[a] > h[a]) return null; continue; }
      const inv = 1 / ld[a];
      let t1 = (-h[a] - lo[a]) * inv, t2 = (h[a] - lo[a]) * inv, sg = -1;
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; sg = 1; }
      if (t1 > tmin) { tmin = t1; axMin = a; sgMin = sg; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0 || tmin > len) return null;
    const t = Math.max(tmin, 0);   // 起点在盒内(几乎不发生): 钳到段首
    const axis = [R.ex, R.ey, R.ez][axMin], n = sgMin * (tmin < 0 ? -1 : 1);
    return { t, point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t },
      normal: { x: axis.x * n, y: axis.y * n, z: axis.z * n } };
  }

  /* 坦克部位 OBB 探针: 组合 车体(YXZ: -pitch/yaw/roll) → 炮塔(+turretYaw) → 火炮(+gunPitch)
     三级变换, 对 partBoxes 表逐盒求交, 取最近。返回 {distance, point, normal, zone, armor} | null。
     表缺失车型(理论上 129 型全覆盖)退 3 盒兜底(tracks/hullSide/turretFront, spec.sample 包络)。 */
  function tankOBBFrames(t) {
    const hull = axesYXZ(t.pitch, t.yaw, t.roll);
    const base = { x: t.x, y: t.y, z: t.z };
    const at = (R, off) => ({ x: base.x + dot3(R.ex, off) , y: base.y + dot3(R.ey, off), z: base.z + dot3(R.ez, off) });
    const f = { hull: { base, R: hull }, turret: null, gun: null };
    const tb = SF.CFG.partBoxes[t.type];
    const tp = (tb && tb.turretPivot) || [0, 1.5, 0];
    f.turret = { base: at(hull, tp), R: mulAxes(hull, axesRY(U_angDiff(t.yaw, t.turretYaw))) };
    const gp = (tb && tb.gunPivot) || [0, 0.4, 1];
    const gpParent = (tb && tb.gunParent) || 'turret';
    const gpBase = gpParent === 'turret' ? f.turret : f.hull;
    f.gun = { base: { x: gpBase.base.x + dot3(gpBase.R.ex, gp), y: gpBase.base.y + dot3(gpBase.R.ey, gp), z: gpBase.base.z + dot3(gpBase.R.ez, gp) },
      R: mulAxes(gpBase.R, axesRX(-t.gunPitch)) };
    return f;
  }
  function U_angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
  function probeTankOBB(t, ox, oy, oz, dx, dy, dz, segLen) {
    const tb = SF.CFG.partBoxes && SF.CFG.partBoxes[t.type];
    let boxes = tb && tb.zones;
    if (!boxes) {   // 兜底: spec.sample 包络三盒(表覆盖全部 129 型, 此路径仅防御未知/半成品车)
      const S = t.spec.sample, box = (z, armor, cy, hh, p) => ({ z, armor, c: [0, cy, 0], h: [S.w, hh, S.l], p });
      boxes = [box('tracks', 20, 0.45, 0.5, 'root'), box('hullSide', 30, 1.0, 0.55, 'root'), box('turretFront', 40, 1.7, 0.35, 'turret')];
      t._obbFallback = { turretPivot: [0, 1.5, 0], gunPivot: [0, 0.4, 1], gunParent: 'turret' };
    }
    const f = tankOBBFrames(t);
    const spaces = { root: f.hull, turret: f.turret, gun: f.gun };
    let best = null;
    // 逐盒粗距早退(阶段5 性能): 盒中心到炮线起点距离 > 盒外接半径 + 线长 + 2m 安全余量 → 精测必空, 跳过
    // (满员开火场景 108 盒/车 × 弹数的 OBB 精测是 tick 最大头, 该早退不改变命中结果)
    for (const z of boxes) {
      const sp = spaces[z.p] || f.hull;
      const C = { x: sp.base.x + dot3(sp.R.ex, z.c), y: sp.base.y + dot3(sp.R.ey, z.c), z: sp.base.z + dot3(sp.R.ez, z.c) };
      const rr = Math.hypot(z.h[0], z.h[1], z.h[2]);
      const cd = Math.hypot(C.x - ox, C.y - oy, C.z - oz);
      if (cd - rr > segLen + 2) continue;
      const R = z.q ? mulAxes(sp.R, axesQuat(z.q)) : sp.R;
      const hit = rayOBB3D(ox, oy, oz, dx, dy, dz, segLen, C, R, z.h);
      if (hit && (!best || hit.t < best.t))
        best = { distance: hit.t, point: hit.point, normal: hit.normal, zone: z.z, armor: z.armor };
    }
    return best;
  }

  return { updateTank, fire, makeShells, collideTank, massOf, aimToLocal, probeTankOBB, rayOBB3D, tankOBBFrames };
})();
