// simengine 直译的对照单测: 参考值全部由 node(V8)对本仓 JS 源逐式计算得出
// (client/js/sim-engine.js + client/js/config.js 同式装载后调用), 覆盖全局 RNG 注入次序、
// aimToLocal、massOf、rayOBB3D、probeTankOBB 兜底三盒、collideTank、弹场 spawn 掷骰次序。

///|
fn test_tank() -> Tank {
  let spec = vehicle_spec("pz4").unwrap()
  {
    tag: 1,
    typ: "pz4",
    spec,
    x: 0.0,
    z: 0.0,
    y: 0.0,
    yaw: 0.3,
    speed: 0.0,
    last_yaw_rate: 0.0,
    last_turret_rate: 0.0,
    turret_yaw: 0.5,
    gun_pitch: 0.03,
    pitch: 0.05,
    roll: -0.02,
    track_offset: 0.0,
    gear: "D1",
    shift_t: 0.0,
    flip_t: 0.0,
    y_init: false,
    fall_v: 0.0,
    ram_t: -9.0,
    hp: 720.0,
    alive: true,
    reload_t: 1.0,
    reload_total: 1.0,
    clip_left: 0,
    clip_phase: "single",
    disp: 2.4,
    mod_track: 0.0,
    mod_engine: 0.0,
    mod_gun: 0.0,
    mod_ammo: 0.0,
    no_turret: false,
    obb_fallback: false,
    team: 0,
    net_id: 1,
    is_player: false,
    st_shots: 0,
    st_hits: 0,
    st_pens: 0,
    st_dmg_dealt: 0.0,
    last_fire_t: -99.0,
  }
}

///|
// ---- 全局 RNG 注入: node 端 mulberry32(20261007)(夹具种子)前 4 掷 ----
test "set_rng/rand reproduce JS Math.random stream" {
  set_rng(20261007)
  assert_eq(rand(), 0.96206839405931532)
  assert_eq(rand(), 0.42478258069604635)
  assert_eq(rand(), 0.05143698165193200)
  assert_eq(rand(), 0.59829832217656076)
}

///|
// ---- aimToLocal: node 端 SF.SimEngine.aimToLocal(0.3,-0.2,0.5, 0.1,0.2,0.3) ----
// 半角三角函数 V8(fdlibm 系)与 glibc libm 有 ≤数 ulp 差异(实测 x 分量 3 ulp ≈ 4e-18),
// 这里留 1e-15 余量; 夹具比对走 q6 + 1e-6 容差(SPEC §5.2), 该量级不构成影响。
test "aim_to_local matches JS reference" {
  let r = aim_to_local(0.3, -0.2, 0.5, 0.1, 0.2, 0.3)
  assert_true((r.x - 0.11096547114089844).abs() < 1.0e-15)
  assert_true((r.y - -0.30006727913041836).abs() < 1.0e-15)
  assert_true((r.z - 0.5269215237677672).abs() < 1.0e-15)
}

///|
// ---- massOf: node 端 DENS.MT×(3.05×1.5)/(3.05×1.45) 等 ----
test "mass_of matches JS reference" {
  assert_eq(mass_of(vehicle_spec("pz4").unwrap()), 33.10344827586207)
  assert_eq(mass_of(vehicle_spec("stug3").unwrap()), 35.17241379310345)
}

///|
// ---- rayOBB3D 轴对齐盒(纯四则, 应逐位一致):
//      origin(0,2,0) dir(0,0,1) len 50, C=(0,1,5) 恒等基 h=(1.5,1,3) → t=2, 法线 (0,0,-1) ----
test "ray_obb_3d axis-aligned hit and miss" {
  let identity : Axes = {
    ex: { x: 1.0, y: 0.0, z: 0.0, },
    ey: { x: 0.0, y: 1.0, z: 0.0, },
    ez: { x: 0.0, y: 0.0, z: 1.0, },
  }
  let hit = ray_obb_3d(
    0.0,
    2.0,
    0.0,
    0.0,
    0.0,
    1.0,
    50.0,
    { x: 0.0, y: 1.0, z: 5.0, },
    identity,
    (1.5, 1.0, 3.0),
  ).unwrap()
  assert_eq(hit.t, 2.0)
  assert_eq(hit.point.x, 0.0)
  assert_eq(hit.point.y, 2.0)
  assert_eq(hit.point.z, 2.0)
  assert_eq(hit.normal.x, 0.0)
  assert_eq(hit.normal.y, 0.0)
  assert_eq(hit.normal.z, -1.0)
  // 平行轴 slab 外 → None(JS null)
  assert_true(
    ray_obb_3d(
      0.0,
      3.0,
      0.0,
      0.0,
      0.0,
      1.0,
      50.0,
      { x: 0.0, y: 1.0, z: 5.0, },
      identity,
      (1.5, 1.0, 3.0),
    )
    is None,
  )
}

///|
// ---- probeTankOBB 兜底三盒: 无 partBoxes 表 → hullSide 命中(轴对齐纯四则) ----
test "probe_tank_obb fallback boxes" {
  let t = test_tank()
  t.yaw = 0.0
  t.pitch = 0.0
  t.roll = 0.0
  t.turret_yaw = 0.0
  t.gun_pitch = 0.0
  assert_true(!t.obb_fallback)
  let hit = probe_tank_obb(None, t, -10.0, 1.0, 0.0, 1.0, 0.0, 0.0, 30.0).unwrap()
  assert_eq(hit.zone, "hullSide")
  assert_eq(hit.distance, 8.5)
  assert_eq(hit.armor, 30.0)
  assert_eq(hit.normal.x, -1.0)
  // JS 侧同时写 t._obbFallback 标记
  assert_true(t.obb_fallback)
}

///|
// ---- collideTank: node 端 wall 掩体(3.5×0.35 @yaw 0.4, 圆心(2,0)) vs pz4 @(0,0) yaw 0.1
//      → [-1.140302546074238, -2.697069147602468](含 cos/sin/hypot, 留 ulp 余量) ----
test "collide_tank matches JS reference" {
  let t = test_tank()
  t.yaw = 0.1
  let wall : @simcore.Cover = {
    typ: "wall",
    blocks_move: true,
    blocks_shells: true,
    blocks_spot: false,
    x: 2.0,
    z: 0.0,
    r: 3.517412883338559,
    h: 3.1,
    shape: "box",
    yaw: 0.4,
    hx: 3.5,
    hz: 0.35,
  }
  let list : @simcore.CoverList = { items: [wall], bushes: None, }
  let (nx, nz) = collide_tank(t, list)
  assert_true((nx - -1.140302546074238).abs() < 1.0e-9)
  assert_true((nz - -2.697069147602468).abs() < 1.0e-9)
}

///|
// ---- Shells::spawn 掷骰次序与弹体字段: node 端 mulberry32(20261007) 同序前 2 骰
//      (sqrt(random()) 与 random()*2π) → vel=(3.449633263834328, 1.763616012546655, 789.9904997459814);
//      pz4 gun 无 cal/life/grav/splash → || 75 / 4 / CFG.sim.shellGravity / 0 ----
test "Shells::spawn dice order and fields match JS" {
  set_rng(20261007)
  let hooks = Hooks::make(on_create=fn(_sh) { () })
  let field = Shells::make(hooks)
  let t = test_tank()
  let sh = field
    .spawn(t, { x: 1.0, y: 2.0, z: 3.0, }, { x: 0.0, y: 0.0, z: 1.0, }, 0.5)
    .unwrap()
  assert_eq(sh.vel.x, 3.449633263834328)
  assert_eq(sh.vel.y, 1.763616012546655)
  assert_eq(sh.vel.z, 789.9904997459814)
  assert_eq(sh.pen, 106.0)
  assert_eq(sh.dmg, 110.0)
  assert_eq(sh.cal, 75.0)
  assert_eq(sh.life, 4.0)
  assert_eq(sh.grav, 3.2)
  assert_eq(sh.splash, 0.0)
  assert_eq(sh.team, 0)
  assert_true(sh.active)
}
