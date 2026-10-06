// v8math.mbt — 与 V8 逐位一致的数学内核(Math.sin/cos/atan/atan2/asin/acos/exp/hypot)。
// 代码主体复制自 moonbitlang/core/math 的 fdlibm 纯 MoonBit 移植(trig_double_nonjs.mbt /
// trig_double_sincos_non_native_or_js.mbt / exp_double_nonjs.mbt / utils.mbt, Apache-2.0,
// 版权 2026 International Digital Economy Academy), 目的: native 后端的 @math.sin 等走
// C libm(glibc), 与 V8 的 fdlibm 在个别输入上相差 1ulp; 直译硬门禁(SPEC §5 + toFixed
// 0.1 网格 + 部位盒命中这类离散判定)要求逐位一致, 故自带 fdlibm 内核。
// hypot 为 fdlibm e_hypot 算法移植(V8 Math.hypot ≠ sqrt(x²+y²), 实测 38% 输入不一致)。

///|
fn v8_abs(x : Double) -> Double {
  x.abs()
}

///|
let two_over_pi : ReadOnlyArray[Int] = [
  0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041,
  0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C,
  0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
  0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F,
  0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D,
  0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
  0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
  0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA, 0x73A8C9,
  0x60E27B, 0xC08C6B,
]

///|
let pi_over_2 : ReadOnlyArray[Double] = [
  1.57079625129699707031e+00, // 0x3FF921FB, 0x40000000 */
   7.54978941586159635335e-08, // 0x3E74442D, 0x00000000 */
   5.39030252995776476554e-15, // 0x3CF84698, 0x80000000 */
   3.28200341580791294123e-22, // 0x3B78CC51, 0x60000000 */
   1.27065575308067607349e-29, // 0x39F01B83, 0x80000000 */
   1.22933308981111328932e-36, // 0x387A2520, 0x40000000 */
   2.73370053816464559624e-44, // 0x36E38222, 0x80000000 */
   2.16741683877804819444e-51, // 0x3569F31D, 0x00000000 */
]

///|
let npio2_hw : ReadOnlyArray[Int] = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB,
  0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB,
  0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C,
  0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB,
  0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
]

///|
const PI_OVER_4 : Double = 0.785398163397448309616

///|
const PIO2_1 : Double = 1.5707963267341256e+00 // 0x3FF921FB, 0x54400000 */

///|
const PIO2_1T : Double = 6.0771005065061922e-11 // 0x3DD0B461, 0x1A600000 */

///|
const PIO2_2 : Double = 6.0771005063039660e-11 // 0x3DD0B461, 0x1A600000 */

///|
const PIO2_2T : Double = 2.0222662487959506e-21 // 0x3BA3198A, 0x2E037073 */

///|
const PIO2_3 : Double = 2.0222662487111665e-21 // 0x3BA3198A, 0x2E037073 */

///|
const PIO2_3T : Double = 8.4784276603688996e-32 // 0x397B839A, 0x252049C1 */

///|
const INV_PIO2 : Double = 6.3661977236758138e-01 // 0x3FE45F30, 0x6DC9C883 */

///|
const HALF : Double = 0.5

///|
const TWO24 : Double = 16777216.0 // 0x41700000, 0x00000000 */

///|
fn set_low_word(d : Double, v : UInt) -> Double {
  let bits : UInt64 = d.reinterpret_as_uint64()
  let bits = bits & 0xFFFF_FFFF_0000_0000
  let bits = bits | v.to_uint64()
  bits.reinterpret_as_double()
}

///|
fn set_high_word(d : Double, v : UInt) -> Double {
  let bits : UInt64 = d.reinterpret_as_uint64()
  let bits = bits & 0x0000_0000_FFFF_FFFF
  let bits = bits | (v.to_uint64() << 32)
  bits.reinterpret_as_double()
}

///|
fn get_high_word(x : Double) -> UInt {
  (x.reinterpret_as_uint64() >> 32).to_uint()
}

///|
fn get_low_word(x : Double) -> UInt {
  x.reinterpret_as_uint64().to_uint()
}

///|
pub fn tan(x : Double) -> Double {
  if x.is_inf() || x.is_nan() {
    return 0.0 / 0.0 * 1.0
  }
  let y = Array::make(2, 0.0)
  let z = 0.0
  if x.abs() <= PI_OVER_4 {
    __kernal_tan(x, z, 1)
  } else {
    let n = rem_pio2(x, y)
    __kernal_tan(y[0], y[1], 1 - ((n & 1) << 1))
  }
}

///|
pub fn asin(x : Double) -> Double {
  let huge = 1.0e+300
  let pio4_hi = 7.85398163397448278999e-01
  let pio2_hi = 1.57079632679489655800
  let pio2_lo = 6.12323399573676603587e-17
  let ps0 = 1.66666666666666657415e-01
  let ps1 = -3.25565818622400915405e-01
  let ps2 = 2.01212532134862925881e-01
  let ps3 = -4.00555345006794114027e-02
  let ps4 = 7.91534994289814532176e-04
  let ps5 = 3.47933107596021167570e-05
  let qs1 = -2.40339491173441421878e+00
  let qs2 = 2.02094576023350569471e+00
  let qs3 = -6.88283971605453293030e-01
  let qs4 = 7.70381505559019352791e-02
  let ix = get_high_word(x).reinterpret_as_int() & 0x7fffffff
  let absx = x.abs()
  if absx >= 1.0 {
    if absx == 1.0 {
      return x * pio2_hi + x * pio2_lo
    } else {
      return 0.0 / 0.0 * 1.0
    }
  } else if absx < 0.5 {
    if ix < 0x3e400000 {
      if huge + x > 1.0 {
        return x
      }
    } else {
      let t = x * x
      let p = t *
        (ps0 + t * (ps1 + t * (ps2 + t * (ps3 + t * (ps4 + t * ps5)))))
      let q = 1.0 + t * (qs1 + t * (qs2 + t * (qs3 + t * qs4)))
      let w = p / q
      return x + x * w
    }
  }
  let w = 1.0 - absx
  let t = w * 0.5
  let p = t * (ps0 + t * (ps1 + t * (ps2 + t * (ps3 + t * (ps4 + t * ps5)))))
  let q = 1.0 + t * (qs1 + t * (qs2 + t * (qs3 + t * qs4)))
  let s = t.sqrt()
  if ix >= 0x3FEF3333 {
    let w = p / q
    let t = pio2_hi - (2.0 * (s + s * w) - pio2_lo)
    return if x > 0.0 { t } else { -t }
  } else {
    let mut w = s
    w = set_low_word(w, 0)
    let c = (t - w * w) / (s + w)
    let r = p / q
    let p = 2.0 * s * r - (pio2_lo - 2.0 * c)
    let q = pio4_hi - 2.0 * w
    let t = pio4_hi - (p - q)
    return if x > 0.0 { t } else { -t }
  }
}

///|
pub fn acos(x : Double) -> Double {
  let one : Double = 1.0
  let pi : Double = 3.14159265358979311600
  let pio2_hi : Double = 1.57079632679489655800
  let pio2_lo : Double = 6.12323399573676603587e-17
  let ps0 : Double = 1.66666666666666657415e-01
  let ps1 : Double = -3.25565818622400915405e-01
  let ps2 : Double = 2.01212532134862925881e-01
  let ps3 : Double = -4.00555345006794114027e-02
  let ps4 : Double = 7.91534994289814532176e-04
  let ps5 : Double = 3.47933107596021167570e-05
  let qs1 : Double = -2.40339491173441421878e+00
  let qs2 : Double = 2.02094576023350569471e+00
  let qs3 : Double = -6.88283971605453293030e-01
  let qs4 : Double = 7.70381505559019352791e-02
  let ix = get_high_word(x).reinterpret_as_int() & 0x7fffffff
  let absx = x.abs()
  if absx >= 1.0 {
    if absx == 1.0 {
      if x > 0 {
        return 0.0
      } else {
        return pi + 2.0 * pio2_lo
      }
    }
    return 0.0 / 0.0 * 1.0
  }
  if absx < 0.5 {
    if ix <= 0x3c600000 {
      return pio2_hi + pio2_lo
    }
    let z = x * x
    let p = z * (ps0 + z * (ps1 + z * (ps2 + z * (ps3 + z * (ps4 + z * ps5)))))
    let q = one + z * (qs1 + z * (qs2 + z * (qs3 + z * qs4)))
    let r = p / q
    pio2_hi - (x - (pio2_lo - x * r))
  } else if x < 0 {
    let z = (one + x) * 0.5
    let p = z * (ps0 + z * (ps1 + z * (ps2 + z * (ps3 + z * (ps4 + z * ps5)))))
    let q = one + z * (qs1 + z * (qs2 + z * (qs3 + z * qs4)))
    let s = z.sqrt()
    let r = p / q
    let w = r * s - pio2_lo
    pi - 2.0 * (s + w)
  } else {
    let z = (one - x) * 0.5
    let s = z.sqrt()
    let df = s
    let c = (z - df * df) / (s + df)
    let p = z * (ps0 + z * (ps1 + z * (ps2 + z * (ps3 + z * (ps4 + z * ps5)))))
    let q = one + z * (qs1 + z * (qs2 + z * (qs3 + z * qs4)))
    let r = p / q
    let w = r * s + c
    2.0 * (df + w)
  }
}

///|
pub fn atan(x : Double) -> Double {
  if x.is_nan() || x == 0.0 {
    return x
  }
  let atan_hi : ReadOnlyArray[Double] = [
    4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01,
    1.57079632679489655800e+00,
  ]
  let atan_lo : ReadOnlyArray[Double] = [
    2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
    6.12323399573676603587e-17,
  ]
  let a_t : ReadOnlyArray[Double] = [
    3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
    -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
    6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
    -3.65315727442169155270e-02, 1.62858201153657823623e-02,
  ]
  let one = 1.0
  let huge = 1.0e300
  let ix = get_high_word(x).reinterpret_as_int() & 0x7fffffff
  let mut id = 0
  let mut z = 0.0
  let mut w = 0.0
  let mut x = x
  let x_is_neg = x < 0.0
  if ix >= 0x44100000 {
    if x > 0 {
      return atan_hi[3] + atan_lo[3]
    } else {
      return -atan_hi[3] - atan_lo[3]
    }
  }
  if ix < 0x3fdc0000 {
    if ix < 0x3e200000 {
      if huge + x > one {
        return x
      }
    }
    id = -1
  } else {
    x = x.abs()
    if ix < 0x3ff30000 {
      if ix < 0x3fe60000 {
        id = 0
        x = (2.0 * x - one) / (2.0 + x)
      } else {
        id = 1
        x = (x - one) / (x + one)
      }
    } else if ix < 0x40038000 {
      id = 2
      x = (x - 1.5) / (one + 1.5 * x)
    } else {
      id = 3
      x = -1.0 / x
    }
  }
  z = x * x
  w = z * z
  let s1 = z *
    (
      a_t[0] +
      w * (a_t[2] + w * (a_t[4] + w * (a_t[6] + w * (a_t[8] + w * a_t[10]))))
    )
  let s2 = w *
    (a_t[1] + w * (a_t[3] + w * (a_t[5] + w * (a_t[7] + w * a_t[9]))))
  if id < 0 {
    x - x * (s1 + s2)
  } else {
    z = atan_hi[id] - (x * (s1 + s2) - atan_lo[id] - x)
    if x_is_neg {
      -z
    } else {
      z
    }
  }
}

///|
pub fn atan2(y : Double, x : Double) -> Double {
  if x.is_nan() || y.is_nan() {
    return 0.0 / 0.0 * 1.0
  }
  let tiny = 1.0e-300
  let zero = 0.0
  let pi_o_4 = 7.8539816339744827900E-01
  let pi_o_2 = 1.5707963267948965580E+00
  let pi = 3.1415926535897931160E+00
  let pi_lo = 1.2246467991473531772E-16
  let hx = get_high_word(x).reinterpret_as_int()
  let hy = get_high_word(y).reinterpret_as_int()
  let ix = hx & 0x7fffffff
  let iy = hy & 0x7fffffff
  if x == 1.0 {
    return atan(y)
  }
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2)
  if y == 0 {
    match m {
      0 | 1 => return y
      2 => return pi + tiny
      _ => return -pi - tiny
    }
  }
  if x == 0 {
    return if hy < 0 { -pi_o_2 - tiny } else { pi_o_2 + tiny }
  }
  if x.is_inf() {
    if y.is_inf() {
      match m {
        0 => return pi_o_4 + tiny
        1 => return -pi_o_4 - tiny
        2 => return 3.0 * pi_o_4 + tiny
        _ => return -3.0 * pi_o_4 - tiny
      }
    } else {
      match m {
        0 => return zero
        1 => return -zero
        2 => return pi + tiny
        _ => return -pi - tiny
      }
    }
  }
  if y.is_inf() {
    return if hy < 0 { -pi_o_2 - tiny } else { pi_o_2 + tiny }
  }
  let k = (iy - ix) >> 20
  let z = if k > 60 {
    pi_o_2 + 0.5 * pi_lo
  } else if hx < 0 && k < -60 {
    0.0
  } else {
    atan(v8_abs(y / x))
  }
  match m {
    0 => z
    1 => -z
    2 => pi - (z - pi_lo)
    _ => z - pi_lo - pi
  }
}

///|
fn rem_pio2(x : Double, y : Array[Double]) -> Int {
  let hx = get_high_word(x).reinterpret_as_int()
  let ix : Int = hx & 0x7fffffff
  let mut z = 0.0
  if ix <= 0x3fe921fb {
    y[0] = x
    y[1] = 0.0
    return 0
  }
  if ix < 0x4002d97c {
    if hx > 0 {
      z = x - PIO2_1
      if ix != 0x3ff921fb {
        y[0] = z - PIO2_1T
        y[1] = z - y[0] - PIO2_1T
      } else {
        z -= PIO2_2
        y[0] = z - PIO2_2T
        y[1] = z - y[0] - PIO2_2T
      }
      return 1
    } else {
      z = x + PIO2_1
      if ix != 0x3ff921fb {
        y[0] = z + PIO2_1T
        y[1] = z - y[0] + PIO2_1T
      } else {
        let z = z + PIO2_2
        y[0] = z + PIO2_2T
        y[1] = z - y[0] + PIO2_2T
      }
      return -1
    }
  }
  if ix <= 0x413921fb {
    let t = x.abs()
    let n = (t * INV_PIO2 + HALF).to_int()
    let fn_ = n.to_double()
    let mut r = t - fn_ * PIO2_1
    let mut w = fn_ * PIO2_1T
    if n < 32 && ix != npio2_hw[n - 1] {
      y[0] = r - w
    } else {
      let j = ix >> 20
      y[0] = r - w
      let i = j - ((get_high_word(y[0]) >> 20).reinterpret_as_int() & 0x7ff)
      if i > 16 {
        let t = r
        w = fn_ * PIO2_2
        r = t - w
        w = fn_ * PIO2_2T - (t - r - w)
        y[0] = r - w
        let i = j - ((get_high_word(y[0]) >> 20).reinterpret_as_int() & 0x7ff)
        if i > 49 {
          let t = r
          w = fn_ * PIO2_3
          r = t - w
          w = fn_ * PIO2_3T - (t - r - w)
          y[0] = r - w
        }
      }
    }
    y[1] = r - y[0] - w
    if hx > 0 {
      return n
    } else {
      y[0] = -y[0]
      y[1] = -y[1]
      return -n
    }
  }

  if ix >= 0x7ff00000 {
    y[0] = x - x
    y[1] = y[0]
    return 0
  }

  z = set_low_word(z, get_low_word(x))
  let e0 = (ix >> 20) - 1046
  z = set_high_word(z, (ix - (e0 << 20)).reinterpret_as_uint())
  let tx = [0.0, 0.0, 0.0]
  for i in 0..<2 {
    tx[i] = z.to_int().to_double()
    z = (z - tx[i]) * TWO24
  }
  tx[2] = z
  let mut nx = 3
  while tx[nx - 1] == 0.0 {
    nx -= 1
  }
  let n = __kernel_rem_pio2(tx, y, e0, nx, 2)
  if hx > 0 {
    n
  } else {
    y[0] = -y[0]
    y[1] = -y[1]
    -n
  }
}

///|
fn __kernel_rem_pio2(
  x : Array[Double],
  y : Array[Double],
  e0 : Int,
  nx : Int,
  prec : Int,
) -> Int {
  let init_jk : ReadOnlyArray[Int] = [2, 3, 4, 6]
  let two24 : Double = 16777216.0
  let twon24 : Double = 5.96046447753906250000e-08

  let mut jz : Int = 0
  let mut jx : Int = 0
  let mut jv : Int = 0
  let mut jp : Int = 0
  let mut jk : Int = 0
  let mut carry : Int = 0
  let mut n : Int = 0
  let iq : Array[Int] = Array::make(20, 0)
  let mut i : Int = 0
  let mut j : Int = 0
  let mut k : Int = 0
  let mut m : Int = 0
  let mut q0 : Int = 0
  let mut ih : Int = 0
  let mut z : Double = 0
  let mut fw : Double = 0
  let f : Array[Double] = Array::make(20, 0.0)
  let fq : Array[Double] = Array::make(20, 0.0)
  let q : Array[Double] = Array::make(20, 0.0)

  jk = init_jk[prec]
  jp = jk

  jx = nx - 1
  jv = (e0 - 3) / 24
  if jv < 0 {
    jv = 0
  }
  q0 = e0 - 24 * (jv + 1)

  j = jv - jx
  m = jx + jk
  i = 0
  while i <= m {
    f[i] = if j < 0 { 0.0 } else { two_over_pi[j].to_double() }
    i += 1
    j += 1
  }

  i = 0
  while i <= jk {
    j = 0
    fw = 0.0
    while j <= jx {
      fw += x[j] * f[jx + i - j]
      j += 1
    }
    q[i] = fw
    i += 1
  }
  jz = jk

  let mut recompute = true
  while recompute {
    recompute = false

    i = 0
    j = jz
    z = q[jz]
    while j > 0 {
      fw = (twon24 * z).floor()
      iq[i] = (z - two24 * fw).to_int()
      z = q[j - 1] + fw
      i += 1
      j -= 1
    }

    z = scalbn(z, q0)
    z -= 8.0 * (z * 0.125).floor()
    n = z.to_int()
    z -= n.to_double()
    ih = 0
    if q0 > 0 {
      i = iq[jz - 1] >> (24 - q0)
      n += i
      iq[jz - 1] -= i << (24 - q0)
      ih = iq[jz - 1] >> (23 - q0)
    } else if q0 == 0 {
      ih = iq[jz - 1] >> 23
    } else if z >= 0.5 {
      ih = 2
    }
    if ih > 0 {
      n += 1
      carry = 0
      i = 0
      while i < jz {
        j = iq[i]
        if carry == 0 {
          if j != 0 {
            carry = 1
            iq[i] = 0x1000000 - j
          }
        } else {
          iq[i] = 0xffffff - j
        }
        i += 1
      }
      if q0 > 0 {
        match q0 {
          1 => iq[jz - 1] = iq[jz - 1] & 0x7fffff
          2 => iq[jz - 1] = iq[jz - 1] & 0x3fffff
          _ => ()
        }
      }
      if ih == 2 {
        z = 1.0 - z
        if carry != 0 {
          z -= scalbn(1.0, q0)
        }
      }
    }

    if z == 0.0 {
      j = 0
      i = jz - 1
      while i >= jk {
        j = j | iq[i]
        i -= 1
      }
      if j == 0 {
        k = 1
        while iq[jk - k] == 0 {
          k += 1
        }
        i = jz + 1
        while i <= jz + k {
          f[jx + i] = two_over_pi[jv + i].to_double()
          j = 0
          fw = 0.0
          while j <= jx {
            fw += x[j] * f[jx + i - j]
            j += 1
          }
          q[i] = fw
          i += 1
        }
        jz += k
        recompute = true
        continue
      }
    }

    if z == 0.0 {
      jz -= 1
      q0 -= 24
      while iq[jz] == 0 {
        jz -= 1
        q0 -= 24
      }
    } else {
      z = scalbn(z, -q0)
      if z >= two24 {
        fw = (twon24 * z).floor()
        iq[jz] = (z - two24 * fw).to_int()
        jz += 1
        q0 += 24
        iq[jz] = fw.to_int()
      } else {
        iq[jz] = z.to_int()
      }
    }

    fw = scalbn(1.0, q0)
    i = jz
    while i >= 0 {
      q[i] = fw * iq[i].to_double()
      fw *= twon24
      i -= 1
    }

    i = jz
    while i >= 0 {
      fw = 0.0
      k = 0
      while k <= jp && k <= jz - i {
        fw += pi_over_2[k] * q[i + k]
        k += 1
      }
      fq[jz - i] = fw
      i -= 1
    }

    match prec {
      0 => {
        fw = 0.0
        i = jz
        while i >= 0 {
          fw += fq[i]
          i -= 1
        }
        y[0] = if ih == 0 { fw } else { -fw }
      }
      1 | 2 => {
        fw = 0.0
        i = jz
        while i >= 0 {
          fw += fq[i]
          i -= 1
        }
        y[0] = if ih == 0 { fw } else { -fw }
        fw = fq[0] - fw
        i = 1
        while i <= jz {
          fw += fq[i]
          i += 1
        }
        y[1] = if ih == 0 { fw } else { -fw }
      }
      3 => {
        i = jz
        while i > 0 {
          fw = fq[i - 1] + fq[i]
          fq[i] += fq[i - 1] - fw
          fq[i - 1] = fw
          i -= 1
        }
        i = jz
        while i > 1 {
          fw = fq[i - 1] + fq[i]
          fq[i] += fq[i - 1] - fw
          fq[i - 1] = fw
          i -= 1
        }
        fw = 0.0
        i = jz
        while i >= 2 {
          fw += fq[i]
          i -= 1
        }
        if ih == 0 {
          y[0] = fq[0]
          y[1] = fq[1]
          y[2] = fw
        } else {
          y[0] = -fq[0]
          y[1] = -fq[1]
          y[2] = -fw
        }
      }
      _ => ()
    }
  }
  n & 7
}

///|
fn __kernel_sin(x : Double, y : Double, iy : Int) -> Double {
  let s1 = -1.66666666666666324348e-01
  let s2 = 8.33333333332248946124e-03
  let s3 = -1.98412698298579493134e-04
  let s4 = 2.75573137070700676789e-06
  let s5 = -2.50507602534068634195e-08
  let s6 = 1.58969099521155010221e-10
  let mut z = 0.0
  let mut r = 0.0
  let mut v = 0.0
  let ix = get_high_word(x) & 0x7fffffff
  if ix < 0x3e400000 {
    if x.to_int() == 0 {
      return x
    }
  }
  z = x * x
  v = z * x
  r = s2 + z * (s3 + z * (s4 + z * (s5 + z * s6)))
  if iy == 0 {
    x + v * (s1 + z * r)
  } else {
    x - (z * (0.5 * y - v * r) - y - v * s1)
  }
}

///|
fn __kernel_cos(x : Double, y : Double) -> Double {
  let one = 1.00000000000000000000e+00
  let c1 = 4.16666666666666019037e-02
  let c2 = -1.38888888888741095749e-03
  let c3 = 2.48015872894767294178e-05
  let c4 = -2.75573143513906633035e-07
  let c5 = 2.08757232129817482790e-09
  let c6 = -1.13596475577881948265e-11
  let mut a = 0.0
  let mut hz = 0.0
  let mut z = 0.0
  let mut r = 0.0
  let mut qx = 0.0
  let ix = get_high_word(x) & 0x7fffffff
  if ix < 0x3e400000 {
    if x.to_int() == 0 {
      return one
    }
  }
  z = x * x
  r = z * (c1 + z * (c2 + z * (c3 + z * (c4 + z * (c5 + z * c6)))))
  if ix < 0x3fd33333 {
    return one - (0.5 * z - (z * r - x * y))
  } else {
    if ix > 0x3fe90000 {
      qx = 0.28125
    } else {
      qx = ((ix - 0x00200000).to_uint64() << 32).reinterpret_as_double()
    }
    hz = 0.5 * z - qx
    a = one - qx
    return a - (hz - (z * r - x * y))
  }
}

///|
fn __kernal_tan(x : Double, y : Double, iy : Int) -> Double {
  let one = 1.0
  let pio4 = 7.85398163397448278999e-01
  let pio4lo = 3.06161699786838301793e-17
  let mut x = x
  let mut y = y
  let mut z = 0.0
  let mut r = 0.0
  let mut v = 0.0
  let mut w = 0.0
  let mut s = 0.0
  let t : ReadOnlyArray[Double] = [
    3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02,
    2.18694882948595424599e-02, 8.86323982359930005737e-03, 3.59207910759131235356e-03,
    1.45620945432529025516e-03, 5.88041240820264096874e-04, 2.46463134818469906812e-04,
    7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
    2.59073051863633712884e-05, 1.00000000000000000000e+00, 7.85398163397448278999e-01,
    3.06161699786838301793e-17,
  ]
  let hx = get_high_word(x).reinterpret_as_int()
  let ix = hx & 0x7fffffff
  if ix < 0x3e300000 {
    if x.to_int() == 0 {
      if (ix | get_low_word(x).reinterpret_as_int() | (iy + 1)) == 0 {
        return one / x.abs()
      } else if iy == 1 {
        return x
      } else {
        w = x + y
        z = w
        z = set_low_word(z, 0)
        v = y - (z - x)
        let a = -one / w
        let mut t = a
        t = set_low_word(t, 0)
        s = one + t * z
        return t + a * (s + t * v)
      }
    }
  }
  if ix >= 0x3fe59428 {
    if hx < 0 {
      x = -x
      y = -y
    }
    z = pio4 - x
    w = pio4lo - y
    x = z + w
    y = 0.0
  }
  z = x * x
  w = z * z
  r = t[1] + w * (t[3] + w * (t[5] + w * (t[7] + w * (t[9] + w * t[11]))))
  v = z *
    (t[2] + w * (t[4] + w * (t[6] + w * (t[8] + w * (t[10] + w * t[12])))))
  s = z * x
  r = y + z * (s * (r + v) + y)
  r += t[0] * s
  w = x + r
  if ix >= 0x3fe59428 {
    v = iy.to_double()
    return (1 - ((hx >> 30) & 2)).to_double() *
      (v - 2.0 * (x - (w * w / (w + v) - r)))
  }
  if iy == 1 {
    w
  } else {
    z = w
    z = set_low_word(z, 0)
    v = r - (z - x)
    let a = -1.0 / w
    let mut t = a
    t = set_low_word(t, 0)
    s = 1.0 + t * z
    t + a * (s + t * v)
  }
}

///|
pub fn sin(x : Double) -> Double {
  if x.is_inf() || x.is_nan() {
    return 0.0 / 0.0 * 1.0
  }
  let y = [0.0, 0.0]
  let z = 0.0
  if x.abs() <= PI_OVER_4 {
    return __kernel_sin(x, z, 0)
  } else {
    let n = rem_pio2(x, y)
    match n & 3 {
      0 => __kernel_sin(y[0], y[1], 1)
      1 => __kernel_cos(y[0], y[1])
      2 => -__kernel_sin(y[0], y[1], 1)
      _ => -__kernel_cos(y[0], y[1])
    }
  }
}

///|
pub fn cos(x : Double) -> Double {
  if x.is_inf() || x.is_nan() {
    return 0.0 / 0.0 * 1.0
  }
  let y = [0.0, 0.0]
  let z = 0.0
  if x.abs() <= PI_OVER_4 {
    return __kernel_cos(x, z)
  } else {
    let n = rem_pio2(x, y)
    match n & 3 {
      0 => __kernel_cos(y[0], y[1])
      1 => -__kernel_sin(y[0], y[1], 1)
      2 => -__kernel_cos(y[0], y[1])
      _ => __kernel_sin(y[0], y[1], 1)
    }
  }
}

///|
pub fn exp(x : Double) -> Double {
  fn get_high_word(x : Double) -> UInt {
    (x.reinterpret_as_uint64() >> 32).to_uint()
  }

  fn get_low_word(x : Double) -> UInt {
    x.reinterpret_as_uint64().to_uint()
  }

  fn insert_words(ix0 : UInt64, ix1 : UInt64) -> Double {
    let mut bits : UInt64 = 0
    bits = bits | (ix0 << 32)
    bits = bits | ix1
    bits.reinterpret_as_double()
  }

  let ori_x = x
  let mut x = x
  let one = 1.0
  let halF : ReadOnlyArray[Double] = [0.5, -0.5]
  let o_threshold = 7.09782712893383973096e+02
  let u_threshold = -7.45133219101941108420e+02
  let ln2HI : ReadOnlyArray[Double] = [
    6.93147180369123816490e-01, -6.93147180369123816490e-01,
  ]
  let ln2LO : ReadOnlyArray[Double] = [
    1.90821492927058770002e-10, -1.90821492927058770002e-10,
  ]
  let invln2 = 1.44269504088896338700e+00
  let p1 = 1.66666666666666019037e-01
  let p2 = -2.77777777770155933842e-03
  let p3 = 6.61375632143793436117e-05
  let p4 = -1.65339022054652515390e-06
  let p5 = 4.13813679705723846039e-08
  let e = 2.718281828459045
  let mut hi = 0.0
  let mut lo = 0.0
  let huge = 1.0e+300
  let twom1000 = 9.33263618503218878990e-302
  let two1023 = 8.988465674311579539e307
  let mut k : Int = 0
  let mut hx : UInt = get_high_word(ori_x)
  let xsb : Int = ((hx >> 31) & 1).reinterpret_as_int()
  hx = hx & 0x7FFFFFFF
  if hx >= 0x40862E42 {
    if hx >= 0x7FF00000 {
      let lx : UInt = get_low_word(ori_x)
      if ((hx & 0xFFFFF) | lx) != 0 {
        return ori_x + ori_x
      } else if xsb == 0 {
        return ori_x
      } else {
        return 0.0
      }
    }
    if ori_x > o_threshold {
      return huge * huge
    }
    if ori_x < u_threshold {
      return twom1000 * twom1000
    }
  }
  if hx > 0x3FD62E42 {
    if hx < 0x3FF0A2B2 {
      if ori_x == 1.0 {
        return e
      }
      hi = ori_x - ln2HI[xsb]
      lo = ln2LO[xsb]
      k = 1 - xsb - xsb
    } else {
      k = (invln2 * ori_x + halF[xsb]).to_int()
      let t = k.to_double()
      hi = ori_x - t * ln2HI[0]
      lo = t * ln2LO[0]
    }
    x = hi - lo
  } else if hx < 0x3E300000 {
    if huge + x > one {
      return one + x
    }
  } else {
    k = 0
  }
  let t = x * x
  let twopk = if k >= -1021 {
    insert_words(
      (0x3FF00000 + (k.reinterpret_as_uint() << 20).reinterpret_as_int())
      .to_int64()
      .reinterpret_as_uint64(),
      0,
    )
  } else {
    insert_words(
      0x3FF00000UL + ((k + 1000).reinterpret_as_uint() << 20).to_uint64(),
      0,
    )
  }
  let c = x - t * (p1 + t * (p2 + t * (p3 + t * (p4 + t * p5))))
  if k == 0 {
    return one - (x * c / (c - 2.0) - x)
  }
  let y = one - (lo - x * c / (2.0 - c) - hi)
  if k >= -1021 {
    if k == 1024 {
      return y * 2.0 * two1023
    } else {
      return y * twopk
    }
  } else {
    return y * twopk * twom1000
  }
}

///|
pub fn expm1(x : Double) -> Double {
  if x.is_nan() {
    return 0.0 / 0.0 * 1.0
  }
  let o_threshold = 7.09782712893383973096e+02
  if x > o_threshold {
    return @double.infinity
  }
  if x.is_inf() {
    return -1.0
  }
  let huge = 1.0e+300
  let tiny = 1.0e-300
  let ln2_hi = 6.93147180369123816490e-01
  let ln2_lo = 1.90821492927058770002e-10
  let invln2 = 1.44269504088896338700e+00
  let q1 = -3.33333333333331316428e-02
  let q2 = 1.58730158725481460165e-03
  let q3 = -7.93650757867487942473e-05
  let q4 = 4.00821782732936239552e-06
  let q5 = -2.01099218183624371326e-07
  let mut x = x
  let mut hx = get_high_word(x)
  let xsb : Int = (hx & 0x80000000).reinterpret_as_int()
  let mut y : Double = if xsb == 0 { x } else { -x }
  hx = hx & 0x7fffffff
  if hx >= 0x4043687A {
    if xsb != 0 {
      if x + tiny < 0.0 {
        return tiny - 1.0
      }
    }
  }
  let mut hi = 0.0
  let mut lo = 0.0
  let mut k = 0
  let mut c = 0.0
  let mut t = 0.0
  if hx > 0x3fd62e42 {
    if hx < 0x3FF0A2B2 {
      hi = if xsb == 0 { x - ln2_hi } else { x + ln2_hi }
      lo = if xsb == 0 { ln2_lo } else { -ln2_lo }
      k = if xsb == 0 { 1 } else { -1 }
    } else {
      k = (invln2 * x + (if xsb == 0 { 0.5 } else { -0.5 })).to_int()
      t = k.to_double()
      hi = x - t * ln2_hi
      lo = t * ln2_lo
    }
    x = hi - lo
    c = hi - x - lo
  } else if hx < 0x3c900000 {
    t = huge + x
    return x - (t - (huge + x))
  } else {
    k = 0
  }
  let hfx : Double = 0.5 * x
  let hxs : Double = x * hfx
  let r1 : Double = 1.0 +
    hxs * (q1 + hxs * (q2 + hxs * (q3 + hxs * (q4 + hxs * q5))))
  let t : Double = 3.0 - r1 * hfx
  let e : Double = hxs * ((r1 - t) / (6.0 - x * t))
  if k == 0 {
    return x - (x * e - hxs)
  } else {
    let e : Double = x * (e - c) - c
    let e : Double = e - hxs
    if k == -1 {
      return 0.5 * (x - e) - 0.5
    }
    if k == 1 {
      return if x < -0.25 {
        -2.0 * (e - (x + 0.5))
      } else {
        1.0 + 2.0 * (x - e)
      }
    }
    if k <= -2 || k > 56 {
      y = 1.0 - (e - x)
      y = set_high_word(y, get_high_word(y) + (k << 20).reinterpret_as_uint())
      return y - 1.0
    }
    let mut t : Double = 1.0
    if k < 20 {
      t = set_high_word(0, (0x3ff00000 - (0x200000 >> k)).reinterpret_as_uint())
      y = t - (e - x)
      y = set_high_word(y, get_high_word(y) + (k << 20).reinterpret_as_uint())
    } else {
      t = set_high_word(0, ((0x3ff - k) << 20).reinterpret_as_uint())
      y = x - (e + t) + 1.0
      y = set_high_word(y, get_high_word(y) + (k << 20).reinterpret_as_uint())
    }
  }
  y
}

///|
pub fn scalbn(x : Double, exp : Int) -> Double {
  let mut n = exp
  let mut y : Double = x
  if n > 1023 {
    y *= 0x1.0p1023
    n -= 1023
    if n > 1023 {
      y *= 0x1.0p1023
      n -= 1023
      if n > 1023 {
        n = 1023
      }
    }
  } else if n < -1022 {
    y *= 0x1.0p-1022 * 0x1.0p53
    n += 1022 - 53
    if n < -1022 {
      y *= 0x1.0p-1022 * 0x1.0p53
      n += 1022 - 53
      if n < -1022 {
        n = -1022
      }
    }
  }
  let ui = (0x3ff + n).to_uint64() << 52
  return y * ui.reinterpret_as_double()
}

///|
pub fn scalbnf(y : Float, exp : Int) -> Float {
  let mut y = y
  let mut n = exp
  if n > 127 {
    y *= (0x1.0p127 : Float)
    n -= 127
    if n > 127 {
      y *= (0x1.0p127 : Float)
      n -= 127
      if n > 127 {
        n = 127
      }
    }
  } else if n < -126 {
    y *= (0x1.0p-126 : Float) * 0x1.0p24
    n += 126 - 24
    if n < -126 {
      y *= (0x1.0p-126 : Float) * 0x1.0p24
      n += 126 - 24
      if n < -126 {
        n = -126
      }
    }
  }
  let u = (0x7f + n) << 23
  return y * Float::reinterpret_from_int(u)
}

///|
test "scalbn" {
  inspect(scalbn(1.5, 2), content="6")
  inspect(scalbn(2.0, -1), content="1")
  inspect(scalbn(3.0, 0), content="3")
  inspect(scalbn(1.0, 1024), content="Infinity")
  inspect(scalbn(1.0, -1023), content="1.1125369292536007e-308")
  inspect(scalbn(1.0, 2047), content="Infinity")
  inspect(scalbn(1.0, -1992), content="0")
  inspect(scalbn(1.0, 3070), content="Infinity")
  inspect(scalbn(1.0, -2961), content="0")
  inspect(scalbn(@double.infinity, 10), content="Infinity")
  inspect(scalbn(@double.not_a_number, 10), content="NaN")
  inspect(scalbn(0.0, 10), content="0")
}

///|
/// fdlibm e_hypot 精确移植(V8 ieee754::Hypot 同源)
pub fn v8_hypot(x : Double, y : Double) -> Double {
  if x.is_inf() || y.is_inf() {
    return inf()
  }
  if x.is_nan() || y.is_nan() {
    return 0.0 / 0.0 * 1.0
  }
  let mut x = x.abs()
  let mut y = y.abs()
  let hx = (x.reinterpret_as_uint64() >> 32).to_int()
  let hy = (y.reinterpret_as_uint64() >> 32).to_int()
  let mut ha = hx & 0x7FFFFFFF
  let mut hb = hy & 0x7FFFFFFF
  if hb > ha {
    let t = x
    x = y
    y = t
    let t2 = ha
    ha = hb
    hb = t2
  }
  if ha >= 0x00100000 {
    if ha == 0x7FF00000 {
      return x + y // inf(本链不触发)
    }
  } else {
    // 子正规(本链数值域不触发; 照抄 fdlibm 路径的等价缩放)
    let lx = x.reinterpret_as_uint64().to_int()
    let ly = y.reinterpret_as_uint64().to_int()
    if (ha | lx | ly) == 0 {
      return x
    }
    if (hb | ly | lx) == 0 {
      return y
    }
    x *= 1152921504606846976.0 // 2^60
    y *= 1152921504606846976.0
    ha = (x.reinterpret_as_uint64() >> 32).to_int() & 0x7FFFFFFF
  }
  let mut k = (ha >> 20) - 0x3FE
  let mut a = x
  let mut b = y
  if k > 0 {
    let hax = ha - (k << 20)
    a = set_high_word(a, hax.reinterpret_as_uint())
    let hbx = ((b.reinterpret_as_uint64() >> 32).to_int() & 0x7FFFFFFF) +
      (k << 20)
    b = set_high_word(b, hbx.reinterpret_as_uint())
  } else {
    k = k + 1022
    let hax = (get_high_word(a).to_int() & 0x7FFFFFFF) + (k << 20)
    a = set_high_word(a, hax.reinterpret_as_uint())
    let hbx = ((b.reinterpret_as_uint64() >> 32).to_int() & 0x7FFFFFFF) -
      (k << 20)
    b = set_high_word(b, hbx.reinterpret_as_uint())
  }
  let w = a - b
  let res = if w > b {
    let t1 = set_low_word(a, 0)
    let t2 = a - t1
    (t1 * t1 - (b * -b - t2 * (t1 + t2))).sqrt()
  } else {
    let a2 = a + a
    let y1 = set_low_word(b, 0)
    let y2 = b - y1
    let t1 = set_low_word(a2, 0)
    let t2 = a2 - t1
    (t1 * y1 - (w * -w - (t1 * y2 + t2 * b))).sqrt()
  }
  if k != 0 {
    let mut t1 = 1.0
    t1 = set_high_word(t1, (0x3FF00000 + (k << 20)).reinterpret_as_uint())
    t1 * res
  } else {
    res
  }
}

///|
/// v8_ 别名(与 V8 Math.* 同源 fdlibm; 供内核直译统一调用)
pub fn v8_sin(x : Double) -> Double {
  sin(x)
}

///|
pub fn v8_cos(x : Double) -> Double {
  cos(x)
}

///|
pub fn v8_atan2(y : Double, x : Double) -> Double {
  atan2(y, x)
}

///|
pub fn v8_atan(x : Double) -> Double {
  atan(x)
}

///|
pub fn v8_asin(x : Double) -> Double {
  asin(x)
}

///|
pub fn v8_acos(x : Double) -> Double {
  acos(x)
}

///|
pub fn v8_exp(x : Double) -> Double {
  exp(x)
}

///|
/// glibc acos(正确舍入; V8 Math.acos 与其逐位一致 — fdlibm acos 在 3.5% 输入上差 1ulp,
/// 实测本机 glibc acos 与 node/V8 在 10 万随机样本逐位一致)
extern "C" fn c_acos(x : Double) -> Double = "acos"

///|
pub fn v8_acos2(x : Double) -> Double {
  c_acos(x)
}

///|
/// tan(0.63) 的 V8 值(JS Math.tan(CFG.sim.maxSlope), 本链 tan 仅此常量实参)
pub let v8_tan_max_slope : Double = 0.7291147292409691

///|
/// V8 Math.pow(base, 整数层数)(本链指数恒 0..2; V8 对这些整数指数与连乘逐位一致,
/// node 实测 pow(b,0)=1/pow(b,1)=b/pow(b,2)=b*b 逐位相等)
pub fn v8_pow(base : Double, lv : Int) -> Double {
  if lv == 0 {
    1.0
  } else if lv == 1 {
    base
  } else {
    base * base
  }
}
