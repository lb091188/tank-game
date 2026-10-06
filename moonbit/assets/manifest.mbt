// manifest.mbt — 资产清单: GLB 模型(文件名→引擎类型名)与地图(id→目录)。
// 对齐 client/js/assets.js:86-108 的 MODEL_FILES 与 client/js/config.js:1337-1343 的 CFG.maps,
// 由 assets.js 源机械提取生成, 勿手改条目(与 JS 侧漂移时以 JS 为准重新生成)。

///|
/// 模型清单: 文件名(assets/models/<名>.glb, 同 assets.js MODEL_FILES 的键) → 引擎类型名
/// (同值, SF.CFG.vehicles 的车型键; models.js makeTank(type) 即按它取 SF.Assets.models[type])。
pub let model_files : Map[String, String] = Map::from_array([
  ("m4-sherman", "sherman"),
  ("m4a3e8", "sherman76"),
  ("m4a3e2-jumbo", "jumbo"),
  ("m18-hellcat", "hellcat"),
  ("enemy-medium", "medium"),
  ("enemy-td", "td"),
  ("enemy-heavy", "heavy"),
  ("pz3", "pz3"),
  ("pz4", "pz4"),
  ("panther", "panther"),
  ("tiger1", "tiger1"),
  ("stug3", "stug3"),
  ("jagdpanther", "jagdpanther"),
  ("ru251", "ru251"),
  ("bt7", "bt7"),
  ("t34", "t34"),
  ("t3485", "t3485"),
  ("kv1", "kv1"),
  ("kv2", "kv2"),
  ("is2", "is2"),
  ("su85", "su85"),
  ("su100", "su100"),
  ("isu152", "isu152"),
  ("m3lee", "m3lee"),
  ("m10", "m10"),
  ("m36", "m36"),
  ("matilda", "matilda"),
  ("cromwell", "cromwell"),
  ("firefly", "firefly"),
  ("churchill7", "churchill7"),
  ("b1bis", "b1bis"),
  ("somua", "somua"),
  ("chiha", "chiha"),
  ("chinu", "chinu"),
  ("tiger2", "tiger2"),
  ("ferdinand", "ferdinand"),
  ("is3", "is3"),
  ("t44", "t44"),
  ("m26", "m26"),
  ("t26e4", "t26e4"),
  ("t29", "t29"),
  ("centurion", "centurion"),
  ("chiri", "chiri"),
  ("type62", "type62"),
  ("type59", "type59"),
  ("wz111", "wz111"),
  ("amx13", "amx13"),
  ("amx50100", "amx50100"),
  ("lorr40t", "lorr40t"),
  ("wespe", "wespe"),
  ("hummel", "hummel"),
  ("m7priest", "m7priest"),
  ("su26", "su26"),
  ("m5stuart", "m5stuart"),
  ("m24chaffee", "m24chaffee"),
  ("m41walker", "m41walker"),
  ("t1heavy", "t1heavy"),
  ("m103", "m103"),
  ("t30", "t30"),
  ("t28", "t28"),
  ("m46patton", "m46patton"),
  ("m48patton", "m48patton"),
  ("m60", "m60"),
  ("m1abrams", "m1abrams"),
  ("m1a2", "m1a2"),
  ("pz2", "pz2"),
  ("pz38t", "pz38t"),
  ("hetzer", "hetzer"),
  ("jgdpz4", "jgdpz4"),
  ("nashorn", "nashorn"),
  ("jagdtiger", "jagdtiger"),
  ("leopard1", "leopard1"),
  ("leopard2", "leopard2"),
  ("leopard2a7", "leopard2a7"),
  ("maus", "maus"),
  ("t26", "t26"),
  ("t70", "t70"),
  ("t28ru", "t28ru"),
  ("kv85", "kv85"),
  ("is", "is"),
  ("su76", "su76"),
  ("su152", "su152"),
  ("is7", "is7"),
  ("t10", "t10"),
  ("t54", "t54"),
  ("t62", "t62"),
  ("t90a", "t90a"),
  ("t80u", "t80u"),
  ("obj268", "obj268"),
  ("t14armata", "t14armata"),
  ("t90m", "t90m"),
  ("vickersmed", "vickersmed"),
  ("valentine", "valentine"),
  ("crusader", "crusader"),
  ("churchill1", "churchill1"),
  ("comet", "comet"),
  ("blackprince", "blackprince"),
  ("conqueror", "conqueror"),
  ("chieftain", "chieftain"),
  ("challenger2", "challenger2"),
  ("vickersmbt", "vickersmbt"),
  ("tortoise", "tortoise"),
  ("ft", "ft"),
  ("elc", "elc"),
  ("bdr", "bdr"),
  ("arl44", "arl44"),
  ("amx50120", "amx50120"),
  ("amx50b", "amx50b"),
  ("batchat", "batchat"),
  ("leclerc", "leclerc"),
  ("hago", "hago"),
  ("chihe", "chihe"),
  ("chito", "chito"),
  ("type61", "type61"),
  ("stb1", "stb1"),
  ("type74", "type74"),
  ("type90", "type90"),
  ("type10", "type10"),
  ("oi", "oi"),
  ("type63", "type63"),
  ("type69", "type69"),
  ("type96", "type96"),
  ("type99", "type99"),
  ("type99a", "type99a"),
  ("merkava3", "merkava3"),
  ("merkava4", "merkava4"),
  ("strv103", "strv103"),
  ("strv122", "strv122"),
  ("k2", "k2"),
])

///|
/// 地图清单: config.js:1337-1343 CFG.maps 的 { id, dir, name, desc }。
pub(all) struct MapEntry {
  id : String // CFG.maps id, 如 "l01"(ensureMap 的入参口径)
  dir : String // assets/maps/<dir>/ 目录名
  name : String
  desc : String
}

///|
pub let maps_manifest : Array[MapEntry] = [
  {
    id: "l01",
    dir: "l01-encounter",
    name: "诺曼底 · 遭遇战",
    desc: "树篱田野与村庄, 三路推进",
  },
  {
    id: "l02",
    dir: "l02-city",
    name: "废墟 · 城市巷战",
    desc: "街区废墟, 近距肉搏",
  },
  {
    id: "l03",
    dir: "l03-highland",
    name: "山川 · 高地争夺",
    desc: "峡谷隘口, 制高点对决",
  },
  {
    id: "l04",
    dir: "l04-steppe",
    name: "东线 · 平原炮战",
    desc: "开阔麦田与反坦克壕, 远距对决",
  },
  {
    id: "l05",
    dir: "l05-airfield",
    name: "荒漠 · 机场争夺",
    desc: "沙地跑道与机堡, 快节奏冲锋",
  },
  {
    id: "l06",
    dir: "l06-winter",
    name: "冬境 · 河谷争夺",
    desc: "冰河走廊与谷壁高地, 唯一登顶路对决",
  },
]

///|
/// 类型名 → 文件名(assets.js:109 的 fileOf 反查表)。
pub fn file_of_type(typ : String) -> String? {
  for f, t in model_files {
    if t == typ {
      return Some(f)
    }
  }
  None
}

///|
/// 资产 URL(JS 侧口径, 如 "assets/models/pz4.glb")在仓库内的相对路径前缀:
/// 测试/运行进程的 cwd 可能是 仓根 / moonbit/ 模块根 / assets/ 包目录,
/// 逐一探测(同 tracecheck main.mbt:396 的多 cwd 兜底套路)。
pub let client_prefixes : Array[String] = [
  "client/", "../client/", "../../client/",
]

///|
/// partboxes.json 在模块根(moonbit/partboxes.json), cwd 候选同理。
pub let partboxes_candidates : Array[String] = [
  "partboxes.json", "../partboxes.json", "../../partboxes.json", "moonbit/partboxes.json",
]

///|
/// 解析仓库内文件路径: 返回第一个真实存在的候选, 全不存在返回 None。
pub async fn resolve_rel(candidates : Array[String]) -> String? {
  for p in candidates {
    if @fs.exists(p) {
      return Some(p)
    }
  }
  None
}

///|
/// 解析 client/ 资产 URL(JS 侧 "assets/...") → 磁盘路径。
pub async fn resolve_client(url : String) -> String {
  let candidates = client_prefixes.map(fn(p) { p + url })
  match resolve_rel(candidates) {
    Some(p) => p
    None =>
      raise Failure(
        "资产文件缺失: \{url}(候选前缀 client/ ../client/ ../../client/ 均未命中)",
      )
  }
}
