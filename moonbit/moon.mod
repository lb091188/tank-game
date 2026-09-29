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

name = "steel/server"

version = "0.1.0"


repository = ""

license = "Apache-2.0"

keywords = []

preferred_target = "native"

description = "steel-front moonbit-native multiplayer server (relay-compatible with server/server.js)"

import {
  "moonbitlang/async@0.22.4",
}
