// netclient_test.mbt — 纯协议/插值测试(无网络; 回包形状取自 server.js 实况)
test "encode_join_与服务器协议一致" {
  inspect(
    encode_join("1234", "", "mb_test", "bt7"),
    content="{\"t\":\"join\",\"room\":\"1234\",\"name\":\"mb_test\",\"tank\":\"bt7\",\"proto\":3}",
  )
}

test "encode_create_带密码与转义" {
  inspect(
    encode_create("a\"b", "sherman", "p1"),
    content="{\"t\":\"create\",\"name\":\"a\\\"b\",\"tank\":\"sherman\",\"pass\":\"p1\",\"proto\":3}",
  )
}

test "encode_input_数值定长" {
  // net.js:90 的 5 元组: [throttle(2), steer(2), aimYaw(3), aimPitch(3), fire]
  inspect(
    encode_input(7, 1.0, -0.55, 3.14159, -0.5, true),
    content="{\"t\":\"input\",\"id\":7,\"i\":[1,-0.55,3.142,-0.5,1]}",
  )
}

test "encode_start_与_leave" {
  inspect(encode_start("l01", "dm"), content="{\"t\":\"start\",\"map\":\"l01\",\"mode\":\"dm\"}")
  inspect(encode_leave(), content="{\"t\":\"leave\"}")
}

test "fmt_num_整数不带小数点" {
  inspect(fmt_num(1.0, 2), content="1")
  inspect(fmt_num(0.0, 2), content="0")
  inspect(fmt_num(-0.0, 2), content="0")
  inspect(fmt_num(0.345, 2), content="0.35")
  inspect(fmt_num(1.2346, 3), content="1.235") // 四舍五入非半值用例(半值两侧浮点表示不定, 不考)
}

test "parse_joined_带名单" {
  // server.js:417 create 回包实况形状
  let text = "{\"t\":\"joined\",\"room\":\"4821\",\"you\":1,\"tier\":5,\"mode\":\"dm\",\"srvSimCap\":true,\"proto\":3,\"players\":[{\"id\":1,\"name\":\"mb\",\"tank\":\"sherman\",\"ready\":true,\"host\":true,\"team\":0,\"connected\":true}]}"
  match parse_server_msg(text) {
    Some(Joined(room, you, players, mode)) => {
      inspect(room, content="4821")
      inspect(you.to_string(), content="1")
      inspect(mode, content="dm")
      assert_eq(players.length(), 1)
      let p = players[0]
      inspect(p.name, content="mb")
      inspect(p.tank, content="sherman")
      assert_true(p.host)
      assert_true(p.ready)
      assert_eq(p.team, 0)
    }
    _ => fail("期望 Joined")
  }
}

test "parse_start_服务器权威标记与seed" {
  // server.js:499 start 广播(seed 为 uint32, 双精度精确)
  let text = "{\"t\":\"start\",\"map\":\"l01\",\"mode\":\"dm\",\"seed\":4294967295,\"srvSim\":true,\"players\":[{\"id\":1,\"name\":\"mb\",\"tank\":\"sherman\",\"ready\":true,\"host\":true,\"team\":0,\"connected\":true}]}"
  match parse_server_msg(text) {
    Some(Start(map, mode, seed, players, srv_sim)) => {
      inspect(map, content="l01")
      inspect(mode, content="dm")
      assert_eq(seed.reinterpret_as_uint(), 4294967295U)
      assert_true(srv_sim)
      assert_eq(players.length(), 1)
    }
    _ => fail("期望 Start")
  }
}

test "parse_snap_14字段行与计分" {
  // srv-sim.js snapshot 的 tn 行(量化后 14 字段)+ sc 计分
  let text = "{\"t\":\"snap\",\"st\":171,\"tn\":{\"1\":[103.5,45.2,12.4,0.52,0.61,0.02,8.3,900,1,0,0,0,0.031,0.012],\"100\":[220.1,-90.0,9.8,3.1,3.1,0.1,0,720,1,2.5,6.4,0,0,0]},\"sc\":{\"1\":2,\"100\":0}}"
  match parse_server_msg(text) {
    Some(Snap(st, tn, sc)) => {
      assert_eq(st, 171)
      let me = tn.get(1).unwrap()
      assert_eq(me.x, 103.5)
      assert_eq(me.z, 45.2)
      assert_eq(me.yaw, 0.52)
      assert_eq(me.tur, 0.61)
      assert_eq(me.hp, 900.0)
      assert_true(me.alive)
      assert_eq(me.body_pitch, 0.031)
      assert_eq(me.body_roll, 0.012)
      let ai = tn.get(100).unwrap()
      assert_eq(ai.reload_t, 2.5)
      assert_eq(ai.reload_total, 6.4)
      assert_eq(sc.get(1).unwrap(), 2)
      assert_eq(sc.get(100).unwrap(), 0)
    }
    _ => fail("期望 Snap")
  }
}

test "parse_snap_旧12字段行补零" {
  // proto<3 的旧行没有 12/13 位 —— 解析层兼容(bodyPitch/bodyRoll=0)
  let text = "{\"t\":\"snap\",\"st\":5,\"tn\":{\"1\":[1,2,3,0.1,0.2,0.3,4.0,500,1,1.0,2.0,3]},\"sc\":{}}"
  match parse_server_msg(text) {
    Some(Snap(_, tn, _)) => {
      let r = tn.get(1).unwrap()
      assert_eq(r.body_pitch, 0.0)
      assert_eq(r.body_roll, 0.0)
      assert_eq(r.clip_left, 3)
    }
    _ => fail("期望 Snap")
  }
}

test "parse_ev_fire与kill" {
  // server.js onEvent 线协议: fire={id,p}, kill={id,by,p}
  match parse_server_msg("{\"t\":\"ev\",\"k\":\"fire\",\"d\":{\"id\":1,\"p\":[103.5,14.5,45.2]}}") {
    Some(Ev(e)) => {
      inspect(e.kind, content="fire")
      assert_eq(e.shooter, 1)
      assert_eq(e.point.0, 103.5)
      assert_eq(e.point.2, 45.2)
    }
    _ => fail("期望 Ev")
  }
  match parse_server_msg("{\"t\":\"ev\",\"k\":\"kill\",\"d\":{\"id\":100,\"by\":1,\"p\":[220.1,10.8,-90.0]}}") {
    Some(Ev(e)) => {
      inspect(e.kind, content="kill")
      assert_eq(e.target, 100)
      assert_eq(e.shooter, 1)
    }
    _ => fail("期望 Ev")
  }
}

test "parse_err_end_left" {
  match parse_server_msg("{\"t\":\"err\",\"msg\":\"房间不存在\"}") {
    Some(Err(m)) => inspect(m, content="房间不存在")
    _ => fail("期望 Err")
  }
  match parse_server_msg(
    "{\"t\":\"end\",\"win\":false,\"scores\":[[1,\"mb\",3],[2,\"zz\",1]]}",
  ) {
    Some(End(scores)) => {
      assert_eq(scores.length(), 2)
      let (id, name, k) = scores[0]
      assert_eq(id, 1)
      inspect(name, content="mb")
      assert_eq(k, 3)
    }
    _ => fail("期望 End")
  }
  match parse_server_msg("{\"t\":\"left\"}") {
    Some(Left) => ()
    _ => fail("期望 Left")
  }
  // 未识别类型 → None(向前兼容)
  match parse_server_msg("{\"t\":\"future_thing\"}") {
    None => ()
    _ => fail("期望 None")
  }
}

test "快照缓冲_到达防坍缩单调上轴" {
  // net.js:49-55: 合批投递(now 差 <40ms)不塌成 0 间隔
  let buf = SnapBuf()
  let mk = fn(x : Double) -> Map[Int, SnapRow] {
    let m : Map[Int, SnapRow] = Map([], capacity=2)
    m[1] = {
      x,
      z: 0.0,
      y: 0.0,
      yaw: 0.0,
      tur: 0.0,
      pitch: 0.0,
      speed: 0.0,
      hp: 900.0,
      alive: true,
      reload_t: 0.0,
      reload_total: 0.0,
      clip_left: 0,
      body_pitch: 0.0,
      body_roll: 0.0,
    }
    m
  }
  buf.push(1000.0, 170, mk(0.0), Map([]))
  buf.push(1005.0, 170, mk(10.0), Map([])) // 紧邻 5ms → recvT 强推 1040
  buf.push(2000.0, 170, mk(20.0), Map([])) // 真实 995ms 间隔照抄
  // 插值时刻取两帧中点: 第一帧 k≈0(1000~1040 span, target=1060-120=940 → k 钳 0)
  match buf.interpolate(1060.0) {
    Some(p) => assert_eq(p.poses.get(1).unwrap().x, 0.0)
    None => fail("应可插值")
  }
  // 目标时刻落在第二三帧中点(k=0.5): x=lerp(10,20,0.5)=15
  match buf.interpolate(1640.0) {
    Some(p) => assert_eq(p.poses.get(1).unwrap().x, 15.0)
    None => fail("应可插值")
  }
  // 滑窗: interpolate 会把过期帧滑出(保留覆盖 target 的两帧)
  assert_eq(buf.len(), 2)
}

test "插值_角度环绕最短弧" {
  // yaw 3.10 → -3.10: 直线插值会绕远 6.0+; 环绕应走 +0.08 的短弧
  let buf = SnapBuf()
  let row = fn(yaw : Double) -> SnapRow {
    {
      x: 0.0,
      z: 0.0,
      y: 0.0,
      yaw,
      tur: 0.0,
      pitch: 0.0,
      speed: 0.0,
      hp: 100.0,
      alive: true,
      reload_t: 0.0,
      reload_total: 0.0,
      clip_left: 0,
      body_pitch: 0.0,
      body_roll: 0.0,
    }
  }
  let m1 : Map[Int, SnapRow] = Map([], capacity=2)
  m1[1] = row(3.10)
  let m2 : Map[Int, SnapRow] = Map([], capacity=2)
  m2[1] = row(-3.10)
  buf.push(10.0, 180, m1, Map([]))
  buf.push(110.0, 180, m2, Map([]))
  // 首帧 recvT=10+40(首帧也过防坍缩下限), 次帧 110; 中点 70ms → k=0.5
  // → yaw = 3.10+0.5×0.0832 ≈ 3.142(过 π 环绕, 语义等价 -π+ε)
  match buf.interpolate(190.0) {
    Some(p) => {
      let yaw = p.poses.get(1).unwrap().yaw
      // 环绕后落在 π 附近(等价 -3.141...), 不允许 |Δ|>π 的绕远值
      let d = (yaw - 3.14159).abs()
      assert_true(d < 0.01)
    }
    None => fail("应可插值")
  }
}

test "插值_新出场单位与b帧缺员" {
  // b 帧新出场的 AI(100) 直接以 b 帧姿态亮相; a 帧有而 b 帧无的以 a 帧静止
  let buf = SnapBuf()
  let row = fn(x : Double) -> SnapRow {
    {
      x,
      z: 0.0,
      y: 0.0,
      yaw: 0.0,
      tur: 0.0,
      pitch: 0.0,
      speed: 0.0,
      hp: 100.0,
      alive: true,
      reload_t: 1.5,
      reload_total: 3.5,
      clip_left: 2,
      body_pitch: 0.0,
      body_roll: 0.0,
    }
  }
  let m1 : Map[Int, SnapRow] = Map([], capacity=2)
  m1[1] = row(0.0)
  let m2 : Map[Int, SnapRow] = Map([], capacity=2)
  m2[1] = row(10.0)
  m2[100] = row(50.0)
  buf.push(0.0, 90, m1, Map([]))
  buf.push(100.0, 90, m2, Map([]))
  match buf.interpolate(220.0) {
    Some(p) => {
      assert_eq(p.poses.get(1).unwrap().x, 10.0) // k=1
      assert_eq(p.poses.get(100).unwrap().x, 50.0) // 新出场直取 b 帧
      // 装填读条取最新帧
      assert_eq(p.poses.get(1).unwrap().reload_t, 1.5)
      assert_eq(p.poses.get(1).unwrap().clip_left, 2)
      assert_eq(p.time_left, 90)
    }
    None => fail("应可插值")
  }
  // 缓冲不足两帧 → None
  let empty = SnapBuf()
  assert_eq(empty.interpolate(0.0) is None, true)
}
