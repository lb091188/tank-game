// mulberry32 直译(SPEC §4; tools/golden-trace2.js:40-48 同式)。
// 全整数运算逐位一致: UInt 乘/加天然 mod 2^32 环绕(= JS Math.imul / |0 的位型),
// `>>> 15`/`>>> 7`/`>>> 14` = UInt 逻辑右移, 末步 UInt.to_double()=无符号值精确转 f64。

///|
pub(all) struct Mulberry32 {
  mut a : UInt
}

///|
/// mulberry32(seed): `a = seed >>> 0`(Int::reinterpret_as_uint 按位重解释)
pub fn Mulberry32::new(seed : Int) -> Mulberry32 {
  { a: seed.reinterpret_as_uint(), }
}

///|
/// 每次调用(与 JS 逐句对应):
///   a = (a + 0x6D2B79F5) | 0;
///   t = Math.imul(a ^ (a >>> 15), 1 | a);
///   t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
///   return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
pub fn Mulberry32::next(self : Mulberry32) -> Double {
  // UInt 环绕加 = JS (a + K) | 0 的 32 位位型
  self.a = self.a + 0x6D2B79F5U
  // Math.imul = 32 位环绕乘法(UInt 乘法即 mod 2^32)
  let mut t = (self.a ^ (self.a >> 15)) * (self.a | 1U)
  t = (t + (t ^ (t >> 7)) * (61U | t)) ^ t
  // ((t ^ (t >>> 14)) >>> 0) / 4294967296 —— 精确除法(2 的幂), 双方逐位一致
  (t ^ (t >> 14)).to_double() / 4294967296.0
}
