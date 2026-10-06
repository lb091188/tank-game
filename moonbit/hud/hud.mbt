// hud.mbt — HUD 元素装配与每帧刷新。渲染通道映射:
//   准星          LineSegments + line_basic(线拓扑, basic 族 uniform)
//   血条/装填矩形  Mesh + basic(纯色不透明, 无贴图路径) —— 同平面层叠会
//                 z-fight, 逐层 +4mm 向相机蹭(plane() 朝 +z, 相机看 +z 面)
//   文字          单节点公告板(sprite 材质)多字形四边形, geometry 重建 +
//                 invalidate_mesh 重传; 逐行独立材质 → 击杀播报逐行渐隐
// 屏幕坐标约定: 虚视口 vw×vh 像素、原点左上、y 向下; 换算到相机局部
//   lx = (x - vw/2)·px2m, ly = (vh/2 - y)·px2m, lz = -plane_d(+layer·步距)。
//   px2m = 2·plane_d·tan(fov/2)/vh —— fov/视口与 gameapp 的相机同一参数。

///|
/// HUD 层深度: 基准面到相机距离(m); 近平面 0.3, 层步距 4mm
pub(all) struct HudView {
  vw : Double
  vh : Double
  fov_deg : Double
  plane_d : Double
  px2m : Double
}

///|
/// 由视口/视场角推导换算口径(与 gameapp 的 PerspectiveCamera 同参数)
pub fn HudView::new(vw : Int, vh : Int, fov_deg : Double) -> HudView {
  let plane_d = 0.5
  let px2m = 2.0 *
    plane_d *
    @math.tan(fov_deg * @math.PI / 180.0 / 2.0) /
    vh.to_double()
  { vw: vw.to_double(), vh: vh.to_double(), fov_deg, plane_d, px2m, }
}

///|
/// 屏幕 px → 相机局部米(x 右, y 上, 层深取基准面)
fn HudView::px_local(
  self : HudView,
  x : Double,
  y : Double,
) -> (Double, Double) {
  ((x - self.vw / 2.0) * self.px2m, (self.vh / 2.0 - y) * self.px2m)
}

///|
/// 层 z(基准面 -plane_d, 每层向相机 +4mm; HUD 只用个位数层, 远离近平面)
fn HudView::layer_z(self : HudView, layer : Int) -> Double {
  -self.plane_d + layer.to_double() * 0.004
}

///|
/// 层的实际到眼距离(px→米换算要按它算, 否则位置/字号带 3% 级比例差)
fn HudView::dist_at(self : HudView, layer : Int) -> Double {
  self.plane_d - layer.to_double() * 0.004
}

///|
/// 指定层的像素→米系数
fn HudView::px2m_at(self : HudView, layer : Int) -> Double {
  self.px2m * self.dist_at(layer) / self.plane_d
}

///|
/// 击杀播报单条
struct FeedItem {
  killer : String
  victim : String
  /// 击杀方是否玩家方(着色: 绿=玩家方, 红=敌方)
  ally : Bool
  /// 推入时刻(s, sim 时钟)
  t : Double
}

///|
/// 击杀播报行池项(节点+材质成对, 文本脏检查)
struct FeedRow {
  obj : @core.Object3D
  mat : @core.Material
  mut text : String
  mut opacity : Double
}

///|
/// HUD 聚合根
pub struct Hud {
  view : HudView
  atlas : @fontatlas.FontAtlas
  /// 相机锁定根(每帧对齐相机位姿)
  root : @core.Object3D
  crosshair : @core.Object3D
  panel_bg : @core.Object3D
  hp_bg : @core.Object3D
  hp_fill : @core.Object3D
  hp_mat : @core.Material
  rl_bg : @core.Object3D
  rl_fill : @core.Object3D
  rl_mat : @core.Material
  panel_text : @core.Object3D
  feed_rows : Array[FeedRow]
  mut feed : Array[FeedItem]
  /// 渲染器(后置绑定, invalidate 动态几何用; 未绑前静默跳过)
  mut renderer : @renderers.WebGPURenderer?
  // ---- 脏检查状态 ----
  mut hp_w : Double
  mut rl_w : Double
  mut panel_text_s : String
  max_feed : Int
}

///|
/// 常色(HUD 配色: 半亮绿/琥珀/红/暗底)
let col_green : @math3d.Color = { r: 0.36, g: 0.90, b: 0.40, }

///|
let col_amber : @math3d.Color = { r: 0.95, g: 0.72, b: 0.20, }

///|
let col_red : @math3d.Color = { r: 0.92, g: 0.28, b: 0.24, }

///|
let col_cyan : @math3d.Color = { r: 0.30, g: 0.80, b: 1.00, }

///|
/// 相机可见的四边形几何(尺寸=米)。绕序实证(见验收记录): 本引擎
/// back-cull 的生效面相对观察者是屏面 CW —— core plane() 的 CCW 朝向
/// 在相机正对时被剔除(basic/lit 同), 故索引取 plane() 的翻转序;
/// 公告板/线管线不剔除, 不受此口径影响。
fn hud_quad_geometry(w : Double, h : Double) -> @core.BufferGeometry {
  let x = w / 2.0
  let y = h / 2.0
  {
    positions: [-x, -y, 0.0, x, -y, 0.0, x, y, 0.0, -x, y, 0.0],
    normals: [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
    uvs: [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0],
    colors: [],
    indices: [0, 2, 1, 0, 3, 2],
  }
}

///|
/// 更新一个矩形节点的几何(屏幕 px 矩形 + 层号 → 相机局部米平面)
fn hud_set_rect(
  hud : Hud,
  node : @core.Object3D,
  mat : @core.Material,
  x : Double,
  y : Double,
  w : Double,
  h : Double,
  layer : Int,
) -> Unit {
  let (lx, ly) = hud.view.px_local(x, y)
  let (rx, ry) = hud.view.px_local(x + w, y + h)
  let geo = hud_quad_geometry(rx - lx, ry - ly)
  node.position = @math3d.Vector3::new(
    (lx + rx) / 2.0,
    (ly + ry) / 2.0,
    hud.view.layer_z(layer),
  )
  node.mesh = Some({
    geometry: geo,
    material: mat,
    cast_shadow: false,
    receive_shadow: false,
    topology: 0,
  })
  hud.invalidate(node.id)
}

///|
/// 文本四边形几何: spans = (文本, 基线原点 px)。逐字形吐 4 顶点(相机局部
/// 米, 相对屏幕中心)+ 图集 UV(v0=位图首行, 纹理按行上传无翻转), 双三角索引。
/// 返回空几何(无可画字形)时调用方把节点藏起来。

///|
/// 文字统一放的层(比矩形高层 —— sprite 深度测试只读不写, 必须比
/// 它覆盖到的矩形更靠近相机才能盖上去)
const LAYER_TEXT : Int = 4

///|
fn hud_text_geometry(
  hud : Hud,
  spans : Array[(String, Double, Double)],
) -> @core.BufferGeometry {
  let positions : Array[Double] = []
  let uvs : Array[Double] = []
  let indices : Array[UInt] = []
  let half_w = hud.view.vw / 2.0
  let half_h = hud.view.vh / 2.0
  let k = hud.view.px2m_at(LAYER_TEXT)
  for span in spans {
    hud.atlas.layout(span.0, span.1, span.2, fn(x, y, w, h, u0, v0, u1, v1) {
      let b = positions.length() / 3
      // 顶点序 左上/右上/右下/左下(y 翻转到向上)
      positions.push((x - half_w) * k)
      positions.push((half_h - y) * k)
      positions.push(0.0)
      positions.push((x + w - half_w) * k)
      positions.push((half_h - y) * k)
      positions.push(0.0)
      positions.push((x + w - half_w) * k)
      positions.push((half_h - y - h) * k)
      positions.push(0.0)
      positions.push((x - half_w) * k)
      positions.push((half_h - y - h) * k)
      positions.push(0.0)
      uvs.push(u0)
      uvs.push(v0)
      uvs.push(u1)
      uvs.push(v0)
      uvs.push(u1)
      uvs.push(v1)
      uvs.push(u0)
      uvs.push(v1)
      indices.push(b.reinterpret_as_uint())
      indices.push((b + 1).reinterpret_as_uint())
      indices.push((b + 2).reinterpret_as_uint())
      indices.push(b.reinterpret_as_uint())
      indices.push((b + 2).reinterpret_as_uint())
      indices.push((b + 3).reinterpret_as_uint())
    })
  }
  { positions, normals: [], uvs, colors: [], indices, }
}

///|
/// 重建一个文本节点(无字形 → 藏节点)
fn hud_set_text(
  hud : Hud,
  node : @core.Object3D,
  mat : @core.Material,
  spans : Array[(String, Double, Double)],
) -> Unit {
  let geo = hud_text_geometry(hud, spans)
  node.visible = geo.index_count() > 0
  node.mesh = Some({
    geometry: geo,
    material: mat,
    cast_shadow: false,
    receive_shadow: false,
    topology: 0,
  })
  hud.invalidate(node.id)
}

///|
fn Hud::invalidate(self : Hud, node_id : UInt64) -> Unit {
  match self.renderer {
    Some(r) => r.invalidate_mesh(node_id)
    None => ()
  }
}

///|
/// 组装 HUD(挂 scene; 渲染器后置 attach_renderer)。
/// 虚视口/fov 与 gameapp 相机一致(800×600, 55°)。
pub fn Hud::new(
  scene : @core.Scene,
  atlas : @fontatlas.FontAtlas,
  vw : Int,
  vh : Int,
  fov_deg : Double,
) -> Hud {
  let view = HudView::new(vw, vh, fov_deg)
  let root = @core.Object3D::new()
  root.name = "hud_root"
  scene.add(root)
  // ---- 中心准星: 4 段带开口十字(线条) ----
  let cx = vw.to_double() / 2.0
  let cy = vh.to_double() / 2.0
  let half = 17.0
  let gap = 7.0
  let xmat = @core.Material::line_basic({ r: 0.85, g: 0.96, b: 0.85, })
  let xp : Array[Double] = []
  fn seg(x0 : Double, y0 : Double, x1 : Double, y1 : Double) -> Unit {
    let (ax, ay) = view.px_local(x0, y0)
    let (bx, by) = view.px_local(x1, y1)
    xp.push(ax)
    xp.push(ay)
    xp.push(view.layer_z(0))
    xp.push(bx)
    xp.push(by)
    xp.push(view.layer_z(0))
  }

  seg(cx - half, cy, cx - gap, cy)
  seg(cx + gap, cy, cx + half, cy)
  seg(cx, cy - half, cx, cy - gap)
  seg(cx, cy + gap, cx, cy + half)
  let crosshair = @core.LineSegments::from_positions(xp, xmat)
  crosshair.name = "hud_crosshair"
  root.add(crosshair)
  let panel_mat = @core.Material::basic({ r: 0.05, g: 0.07, b: 0.05, })
  let panel_bg = @core.Mesh::new(@core.BufferGeometry::empty(), panel_mat)
  root.add(panel_bg)
  let hp_bg_mat = @core.Material::basic({ r: 0.16, g: 0.20, b: 0.16, })
  let hp_bg = @core.Mesh::new(@core.BufferGeometry::empty(), hp_bg_mat)
  root.add(hp_bg)
  let hp_mat = @core.Material::basic(col_green)
  let hp_fill = @core.Mesh::new(@core.BufferGeometry::empty(), hp_mat)
  root.add(hp_fill)
  let rl_bg_mat = @core.Material::basic({ r: 0.13, g: 0.14, b: 0.16, })
  let rl_bg = @core.Mesh::new(@core.BufferGeometry::empty(), rl_bg_mat)
  root.add(rl_bg)
  let rl_mat = @core.Material::basic(col_green)
  let rl_fill = @core.Mesh::new(@core.BufferGeometry::empty(), rl_mat)
  root.add(rl_fill)
  // ---- 面板文字(公告板 sprite 材质, 图集纹理; 节点=屏幕中心, 字形偏移在几何里) ----
  let pt_mat = @core.Material::sprite(@math3d.Color::white())
  pt_mat.map = Some(atlas.texture)
  let panel_text = @core.Mesh::new(@core.BufferGeometry::empty(), pt_mat)
  panel_text.position = @math3d.Vector3::new(0.0, 0.0, view.layer_z(LAYER_TEXT))
  panel_text.mesh.unwrap().cast_shadow = false
  panel_text.mesh.unwrap().receive_shadow = false
  panel_text.visible = false
  root.add(panel_text)
  // ---- 击杀播报行池(5 行) ----
  let feed_rows : Array[FeedRow] = []
  for _i in 0..<5 {
    let m = @core.Material::sprite(@math3d.Color::white())
    m.map = Some(atlas.texture)
    let o = @core.Mesh::new(@core.BufferGeometry::empty(), m)
    o.position = @math3d.Vector3::new(0.0, 0.0, view.layer_z(LAYER_TEXT))
    o.mesh.unwrap().cast_shadow = false
    o.mesh.unwrap().receive_shadow = false
    o.visible = false
    root.add(o)
    feed_rows.push({ obj: o, mat: m, text: "", opacity: 0.0, })
  }
  let hud : Hud = {
    view,
    atlas,
    root,
    crosshair,
    panel_bg,
    hp_bg,
    hp_fill,
    hp_mat,
    rl_bg,
    rl_fill,
    rl_mat,
    panel_text,
    feed_rows,
    feed: [],
    renderer: None,
    hp_w: -1.0,
    rl_w: -1.0,
    panel_text_s: "",
    max_feed: 6,
  }
  // 静态矩形一次成型
  hud_set_rect(hud, panel_bg, panel_mat, 12.0, 512.0, 280.0, 78.0, 1)
  hud_set_rect(hud, hp_bg, hp_bg_mat, 16.0, 540.0, 256.0, 13.0, 2)
  hud_set_rect(hud, rl_bg, rl_bg_mat, 16.0, 558.0, 256.0, 5.0, 2)
  hud
}

///|
/// 渲染器后置绑定(动态几何失效要经它)
pub fn Hud::attach_renderer(self : Hud, r : @renderers.WebGPURenderer) -> Unit {
  self.renderer = Some(r)
}

///|
/// 击杀播报推入(killer/victim 已是展示名, 如 "YOU"/"TIGER1")
pub fn Hud::push_kill(
  self : Hud,
  killer : String,
  victim : String,
  killer_is_ally : Bool,
  now : Double,
) -> Unit {
  self.feed.push({ killer, victim, ally: killer_is_ally, t: now, })
  if self.feed.length() > self.max_feed {
    ignore(self.feed.remove(0))
  }
}

///|
/// 播报条目寿命(秒): 3.5s 全显, 4.5s 内线性渐隐, 之后剔除
fn feed_opacity(now : Double, t : Double) -> Double {
  let age = now - t
  if age <= 3.5 {
    1.0
  } else if age < 4.5 {
    1.0 - (age - 3.5)
  } else {
    0.0
  }
}

///|
/// 血条颜色按余量分段(>50% 绿, >25% 琥珀, 其余红)
fn hp_color(frac : Double) -> @math3d.Color {
  if frac > 0.5 {
    col_green
  } else if frac > 0.25 {
    col_amber
  } else {
    col_red
  }
}

///|
/// 每帧刷新(渲染前调): 根对齐相机 + 数值条脏检查 + 文本/播报重建。
///   hp/hp_max    本车血量
///   reload_t     装填剩余(s; ≤0 即装填完毕)
///   reload_total 装填总时长(s)
///   pen          弹药数字(穿深)
///   tank_label   本车名(如 "SHERMAN")
///   now          sim 时钟(s, 与 push_kill 同源)
pub fn Hud::update(
  self : Hud,
  cam : @core.PerspectiveCamera,
  hp : Double,
  hp_max : Double,
  reload_t : Double,
  reload_total : Double,
  pen : Int,
  tank_label : String,
  now : Double,
) -> Unit {
  // ① 根对齐相机(相机无父, 局部位姿即世界位姿; look_at 每帧先刷新)
  self.root.position = cam.obj.position
  self.root.rotation = cam.obj.rotation
  // ② 血条: 宽度=余量比例×256px, 颜色分段(>0.5px 才重建)
  let frac = if hp_max > 0.0 { clamp01v(hp / hp_max) } else { 0.0 }
  let w = 256.0 * frac
  if (w - self.hp_w).abs() > 0.5 {
    self.hp_w = w
    self.hp_mat.color = hp_color(frac)
    hud_set_rect(
      self,
      self.hp_fill,
      self.hp_mat,
      16.0,
      540.0,
      w.max(0.0),
      13.0,
      3,
    )
  }
  // ③ 装填条: 装填中青色按进度, 完毕绿色拉满
  let reloading = reload_t > 0.0
  let rfrac = if reloading && reload_total > 0.0 {
    clamp01v(1.0 - reload_t / reload_total)
  } else {
    1.0
  }
  let rw = 256.0 * rfrac
  if (rw - self.rl_w).abs() > 0.5 {
    self.rl_w = rw
    self.rl_mat.color = if reloading { col_cyan } else { col_green }
    hud_set_rect(
      self,
      self.rl_fill,
      self.rl_mat,
      16.0,
      558.0,
      rw.max(0.0),
      5.0,
      3,
    )
  }
  // ④ 面板文字两行: 车名+血量 / 弹药+装填态(文本变化才重建)
  let hp_now = @math.ceil(hp).to_int().to_string()
  let hp_max_s = @math.ceil(hp_max).to_int().to_string()
  let rl_s = if reloading { fmt1(reload_t) + "s" } else { "READY" }
  let line1 = "\{tank_label}  HP \{hp_now}/\{hp_max_s}"
  let line2 = "AP \{pen} » \{rl_s}"
  let sig = line1 + "|" + line2
  if sig != self.panel_text_s {
    self.panel_text_s = sig
    hud_set_text(
      self,
      self.panel_text,
      self.panel_text.mesh.unwrap().material,
      [(line1, 16.0, 532.0), (line2, 16.0, 582.0)],
    )
  }
  // ⑤ 击杀播报: 剔除过期 → 逐行右对齐顶部下排(新条目在上, 即"滚动")
  let keep : Array[FeedItem] = []
  for it in self.feed {
    if feed_opacity(now, it.t) > 0.0 {
      keep.push(it)
    }
  }
  self.feed = keep
  for i, row in self.feed_rows {
    if i < self.feed.length() {
      let it = self.feed[i]
      let text = "\{it.killer} » \{it.victim}"
      let op = feed_opacity(now, it.t)
      if text != row.text || (op - row.opacity).abs() > 0.02 {
        row.text = text
        row.opacity = op
        row.mat.opacity = op
        row.mat.color = if it.ally {
          { r: 0.55, g: 1.00, b: 0.55, }
        } else {
          { r: 1.00, g: 0.45, b: 0.40, }
        }
        // 右对齐: 右缘距边 12px
        let tw = self.atlas.measure(text)
        hud_set_text(self, row.obj, row.mat, [
          (text, self.view.vw - 12.0 - tw, 20.0 + i.to_double() * 22.0),
        ])
      }
    } else if row.obj.visible {
      row.obj.visible = false
      row.text = ""
      row.opacity = 0.0
    }
  }
}

///|
/// Double 一位小数(JS toFixed(1) 口径: 先四舍五入到 0.1 再最短打印)
fn fmt1(v : Double) -> String {
  (@math.round(v * 10.0) / 10.0).to_string()
}

///|
/// 钳到 [0,1](core Double 无 clamp)
fn clamp01v(v : Double) -> Double {
  if v < 0.0 {
    0.0
  } else if v > 1.0 {
    1.0
  } else {
    v
  }
}
