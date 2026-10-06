// interp.mbt — 快照缓冲插值(client/js/net.js:8-125 直译):
//   SNAP_MIN_GAP=40 防坍缩(相邻快照 recvT 单调上轴, 消 20Hz 投递合批伪影)
//   interpolate(120ms 延迟)在两帧间线性插值, 角度字段走环绕最短弧,
//   hp/alive/装填读条取最新帧(不需插值)。

///|
/// 到达时刻防坍缩下限(ms): 低于此间隔的两包视为投递伪影(net.js:13)
pub const SNAP_MIN_GAP : Int = 40

///|
/// 带接收时间轴的单帧快照(net.js snaps[] 的 {recvT, data})
struct TimedSnap {
  recv_t : Double // ms(单调时钟)
  st : Int
  tn : Map[Int, SnapRow]
  sc : Map[Int, Int]
}

///|
/// 插值后的单姿态(net.js interpolate 的 out[id]; 装填/血量最新帧取值)
pub(all) struct Pose {
  pub x : Double
  pub z : Double
  pub y : Double
  pub yaw : Double
  pub tur : Double
  pub pitch : Double
  pub speed : Double
  pub hp : Double
  pub alive : Bool
  pub reload_t : Double
  pub reload_total : Double
  pub clip_left : Int
  pub body_pitch : Double
  pub body_roll : Double
}

///|
/// 插值结果(net.js interpolate 返回值: poses + 房间态)
pub(all) struct Poses {
  pub poses : Map[Int, Pose]
  pub time_left : Int
  pub scores : Map[Int, Int]
}

///|
/// 快照缓冲(net.js snaps[] + push/interpolate; 事件循环线程顺序访问)
pub struct SnapBuf {
  snaps : Array[TimedSnap]
}

///|
pub fn SnapBuf::SnapBuf() -> SnapBuf { { snaps: [] } }

///|
/// 清空(重开局/断线; net.js resetSnaps)
pub fn SnapBuf::reset(self : SnapBuf) -> Unit {
  self.snaps.clear()
}

///|
/// 已收帧数(验收取证用)
pub fn SnapBuf::len(self : SnapBuf) -> Int {
  self.snaps.length()
}

///|
/// 入一帧(net.js:49-55): recvT 按 上一帧+SNAP_MIN_GAP 单调上轴 —— 突发合批
/// 时插值时间轴最多提前一拍, 换 span 恒 ≥ SNAP_MIN_GAP 无硬跳台阶
pub fn SnapBuf::push(
  self : SnapBuf,
  now_ms : Double,
  st : Int,
  tn : Map[Int, SnapRow],
  sc : Map[Int, Int],
) -> Unit {
  let last = if self.snaps.length() > 0 {
    self.snaps[self.snaps.length() - 1].recv_t
  } else {
    0.0
  }
  let recv_t = if now_ms > last + SNAP_MIN_GAP.to_double() {
    now_ms
  } else {
    last + SNAP_MIN_GAP.to_double()
  }
  self.snaps.push({ recv_t, st, tn, sc })
}

///|
fn lerp(a : Double, b : Double, k : Double) -> Double {
  a + (b - a) * k
}

///|
fn clamp(v : Double, lo : Double, hi : Double) -> Double {
  if v < lo {
    lo
  } else if v > hi {
    hi
  } else {
    v
  }
}

///|
/// 角度插值(环绕最短弧; net.js interpolate 的 dy 修正)
fn lerp_angle(a : Double, b : Double, k : Double) -> Double {
  let mut d = b - a
  if d > @math.PI {
    d -= @math.PI * 2.0
  }
  if d < -@math.PI {
    d += @math.PI * 2.0
  }
  a + d * k
}

///|
/// 插值取 now-delay 时刻各车姿态(net.js:98-123 直译, delay 默认 120ms):
/// 缓冲不足两帧返回 None; 过期帧滑出(保留 2 帧滑动窗)
pub fn SnapBuf::interpolate(
  self : SnapBuf,
  now_ms : Double,
  delay~ : Double = 120.0,
) -> Poses? {
  if self.snaps.length() < 2 {
    return None
  }
  let target = now_ms - delay
  while self.snaps.length() > 2 &&
        self.snaps[1].recv_t < target {
    ignore(self.snaps.remove(0))
  }
  let a = self.snaps[0]
  let b = self.snaps[1]
  let span = 1.0.max(b.recv_t - a.recv_t)
  let k = clamp((target - a.recv_t) / span, 0.0, 1.0)
  let out : Map[Int, Pose] = Map([], capacity=16)
  // id 并集(b 帧新出场/退场都以 a 帧兜底; net.js Set([...keys]) 同式)
  for id, _pa in a.tn {
    let pa = _pa
    let pb = b.tn.get(id)
    let pbv = match pb {
      Some(r) => r
      None => pa
    }
    out[id] = {
      x: lerp(pa.x, pbv.x, k),
      z: lerp(pa.z, pbv.z, k),
      y: lerp(pa.y, pbv.y, k),
      yaw: lerp_angle(pa.yaw, pbv.yaw, k),
      tur: lerp_angle(pa.tur, pbv.tur, k),
      pitch: lerp(pa.pitch, pbv.pitch, k),
      speed: lerp(pa.speed, pbv.speed, k),
      hp: pbv.hp, // 装填状态/血量取最新帧(不需插值)
      alive: pbv.alive,
      reload_t: pbv.reload_t,
      reload_total: pbv.reload_total,
      clip_left: pbv.clip_left,
      body_pitch: lerp(pa.body_pitch, pbv.body_pitch, k),
      body_roll: lerp(pa.body_roll, pbv.body_roll, k),
    }
  }
  for id, pbv in b.tn {
    if a.tn.get(id) is None {
      out[id] = {
        x: pbv.x,
        z: pbv.z,
        y: pbv.y,
        yaw: pbv.yaw,
        tur: pbv.tur,
        pitch: pbv.pitch,
        speed: pbv.speed,
        hp: pbv.hp,
        alive: pbv.alive,
        reload_t: pbv.reload_t,
        reload_total: pbv.reload_total,
        clip_left: pbv.clip_left,
        body_pitch: pbv.body_pitch,
        body_roll: pbv.body_roll,
      }
    }
  }
  Some({ poses: out, time_left: b.st, scores: b.sc })
}
