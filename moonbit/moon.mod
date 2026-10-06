// Learn more about moon.mod configuration:
// https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html
//
// To add a dependency, run this command in your terminal:
//   moon add moonbitlang/x
//
// Or manually declare it in `import`, for example:
// import {
//   "moonbitlang/x@0.4.6",
// }

name = "lb091188/steel-moonbit"

version = "0.1.0"

readme = "README.mbt.md"

repository = ""

license = "Apache-2.0"

keywords = [ ]

preferred_target = "native"

description = ""

import {
  "NoahLiu/three-native@0.1.2",
  "mizchi/image@0.4.3",
  "moonbitlang/async@0.22.4",
  "Milky2018/moon_rodio@0.3.5",
  "mizchi/zlib@0.4.10",
  "NoahLiu/moonbit-libyue@0.5.10",
  "Milky2018/wgpu_mbt@0.16.2",
  "mizchi/font@0.7.4",
}
