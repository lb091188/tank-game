// tracesrv coop 段: golden-trace2.js runSrvsim coop 分支(670-800)的直译重放与比对。
// coop: 2 人(pz4/sherman), 房间种子 778, 波次=夹具 meta.coop.waves, 维修窗 duration=60
// (双扣折半 → 30s 实效), 7200 tick 每 80 tick 采样; 无敌时人类驶向最近落地空投。

///|
// 夹具 meta.coop.waves → WaveDef
fn parse_waves(waves_j : Json) -> Array[@srvsim.WaveDef] raise {
  let out : Array[@srvsim.WaveDef] = []
  for w in as_array(waves_j) {
    let name = get_str(w, "name")
    let enemies : Array[@srvsim.WaveEnemy] = []
    for e in get_array(w, "enemies") {
      let pos = get_array(e, "pos")
      let patrol : Array[(Double, Double)] = []
      match e {
        Object(m) =>
          match m.get("patrol") {
            Some(Array(ps)) =>
              for p in ps {
                let xy = as_array(p)
                patrol.push((as_num(xy[0]), as_num(xy[1])))
              }
            _ => ()
          }
        _ => ()
      }
      enemies.push({
        typ: get_str(e, "type"),
        pos: (as_num(pos[0]), as_num(pos[1])),
        yaw: opt_num(e, "yaw"),
        personality: match e {
          Object(m) =>
            match m.get("personality") {
              Some(String(s)) => Some(s)
              _ => None
            }
          _ => None
        },
        hold: match e {
          Object(m) =>
            match m.get("hold") {
              Some(True) => true // (Json 布尔构造子 True/False)
              _ => false
            }
          _ => false
        },
        patrol,
      })
    }
    out.push({ name, enemies, })
  }
  out
}

///|
// coopEnemies(golden-trace2.js:734-739)
fn coop_enemies(room : @srvsim.Room) -> (Int, Int, Array[(Int, String, Int)]) {
  let mut alive = 0
  let mut total = 0
  let types : Array[(Int, String, Int)] = []
  for o in room.tanks.values() {
    if o.net_id >= 100 {
      total += 1
      types.push((o.net_id, o.typ, if o.alive { 1 } else { 0 }))
      if o.alive {
        alive += 1
      }
    }
  }
  (alive, total, types)
}

///|
// coop 段重放(golden-trace2.js:671-765)
async fn run_coop(meta_inputs : Json, root : Json) -> Unit {
  boot(20261009) // SF2 = boot(同种子): 全局流从头重置
  let size = get_num(get(meta_inputs, "terrain_cfg"), "size")
  let res = get_int(get(meta_inputs, "terrain_cfg"), "resolution")
  let heights = build_heights(meta_inputs, res)
  let covers = build_covers(meta_inputs)
  let coop = get(get(root, "meta"), "coop")
  let waves = parse_waves(get(coop, "waves"))
  let repair = get(coop, "repairWaves")
  let repair_duration = get_num(repair, "duration") // 夹具显式 60(双扣折半 → 30s 实效)
  let repair_ratio = get_num(repair, "hpRatio")
  let counts : Ref[(Int, Int, Int, Int, Int)] = { val: (0, 0, 0, 0, 0), } // fire/hit/kill/aiWave/pkGet
  let log : Array[CoopLogEv] = []
  let test_fires : Ref[Int] = { val: 0, }
  let end_rows : Ref[Array[(Int, String, Int)]?] = { val: None, }
  let on_event = fn(k : String, ev : @srvsim.Ev) -> Unit {
    let (f, h, kl, aw, pk) = counts.val
    if k == "fire" {
      counts.val = (f + 1, h, kl, aw, pk)
    } else if k == "hit" {
      counts.val = (f, h + 1, kl, aw, pk)
    } else if k == "kill" {
      counts.val = (f, h, kl + 1, aw, pk)
      match ev {
        @srvsim.Ev::Kill(id, by, _, _, _) =>
          log.push({ kind: "kill", list: [], id, by, typ: "", })
        _ => ()
      }
    } else if k == "aiWave" {
      counts.val = (f, h, kl, aw + 1, pk)
      match ev {
        @srvsim.Ev::AiWave(list) =>
          log.push({ kind: "aiWave", list, id: 0, by: 0, typ: "", })
        _ => ()
      }
    } else if k == "pkGet" {
      counts.val = (f, h, kl, aw, pk + 1)
      match ev {
        @srvsim.Ev::PkGet(id, by, typ) =>
          log.push({ kind: "pkGet", list: [], id, by, typ, })
        _ => ()
      }
    }
  }
  let players : Array[@srvsim.PlayerDef] = [
    { id: 1, name: "h1", tank: "pz4", team: 0, },
    { id: 2, name: "h2", tank: "sherman", team: 0, },
  ]
  let room = @srvsim.Room::create({
    heights,
    terrain_size: size,
    terrain_res: res,
    covers_raw: covers,
    seed: 778,
    time_limit: 180.0, // (JS coop 分支 timeLimit=9999 写隐式全局, 局部保持缺省 180)
    players,
    coop: true,
    waves,
    repair_duration,
    repair_hp_ratio: repair_ratio,
    on_event,
    on_end: fn(rows) { end_rows.val = Some(rows) },
  })
  let ids = [1, 2]
  let dt = 1.0 / 60.0
  let snaps : Array[CoopSnap] = []
  for k in 0..<7200 {
    for id in ids {
      match room.tanks.get(id) {
        Some(t) =>
          if t.alive {
            room.set_input(id, coop_input(room, t)) // 首条 input 触发第 0 波
          }
        None => ()
      }
    }
    if k % 90 == 45 {
      for id in ids {
        match room.tanks.get(id) {
          Some(from) =>
            if from.alive {
              match nearest_foe(room, from) {
                Some(e) =>
                  if room.test_fire(id, e.net_id) {
                    test_fires.val += 1
                  }
                None => ()
              }
            }
          None => ()
        }
      }
    }
    room.tick(dt)
    if k % 80 == 0 {
      let s = room.snapshot()
      let (alive, total, types) = coop_enemies(room)
      let wv = match s.wv {
        Some(w) => w
        None => (0, 0, "", 0, 0) // (JS s.wv || null; coop 恒 Some)
      }
      let dt_keys : Array[Int] = []
      for key, _ in s.dt_map {
        dt_keys.push(key)
      }
      dt_keys.sort()
      let humans : Array[Array[Double]] = []
      for id in ids {
        match s.tn.get(id) {
          Some(row) => humans.push(row)
          None => die("coop snapshot humans 缺行 id=\{id}")
        }
      }
      let (f, h, kl, aw, pk) = counts.val
      snaps.push({
        k,
        st: s.st,
        wv,
        rp: match s.rp {
          Some(r) => r
          None => -1
        },
        pk: s.pk,
        dt_keys,
        humans,
        enemies_alive: alive,
        enemies_total: total,
        enemy_types: types,
        ev_fire: f,
        ev_hit: h,
        ev_kill: kl,
        ev_aiwave: aw,
        ev_pkget: pk,
        test_fires: test_fires.val,
      })
    }
  }
  let result_finished = if room.finished { 1 } else { 0 }
  let result_win = if room.win { 1 } else { 0 }
  let end_rows_final = match end_rows.val {
    Some(r) => r
    None => {
      die("coop onEnd 未触发")
      []
    }
  }
  ignore(root)
  compare_coop(snaps, log, result_finished, result_win, end_rows_final)
}

///|
// coop 段比对(coopSnapshots + coopLog + coopResult)
async fn compare_coop(
  snaps : Array[CoopSnap],
  log : Array[CoopLogEv],
  result_finished : Int,
  result_win : Int,
  end_rows : Array[(Int, String, Int)],
) -> Unit {
  let path = fixture_path()
  let s = read_file_string(path)
  let root = @json.parse(s)
  let golds = get_array(root, "coopSnapshots")
  if golds.length() != snaps.length() {
    die(
      "TRACE MISMATCH srvsim coop snapshot 条数不符: golden=\{golds.length()} 实际=\{snaps.length()}",
    )
  }
  for idx, gold in golds {
    let mine = snaps[idx]
    let k = get_int(gold, "k")
    check_int("coop", idx, k, "k", k, mine.k)
    check_int("coop", idx, k, "st", get_int(gold, "st"), mine.st)
    // wv: [波次, 波总数, 波名, 人类击杀, 累计刷出] 或 null
    match get(gold, "wv") {
      Null =>
        die(
          "TRACE MISMATCH srvsim coop snapshot[\{idx}] golden wv=null 但 coop 恒有",
        )
      _ => ()
    }
    let wv_g = as_array(get(gold, "wv"))
    check_int("coop", idx, k, "wv[0]", as_int(wv_g[0]), mine.wv.0)
    check_int("coop", idx, k, "wv[1]", as_int(wv_g[1]), mine.wv.1)
    check_str("coop", idx, k, "wv[2]", as_str(wv_g[2]), mine.wv.2)
    check_int("coop", idx, k, "wv[3]", as_int(wv_g[3]), mine.wv.3)
    check_int("coop", idx, k, "wv[4]", as_int(wv_g[4]), mine.wv.4)
    check_int("coop", idx, k, "rp", get_int(gold, "rp"), mine.rp)
    // pk
    let pk_g = get_array(gold, "pk")
    if pk_g.length() != mine.pk.length() {
      die(
        "TRACE MISMATCH srvsim coop snapshot[\{idx}] tick=\{k} field=pk 条数 expected=\{pk_g.length()} actual=\{mine.pk.length()}",
      )
    }
    for ri, row_g in pk_g {
      let cols = as_array(row_g)
      let m = mine.pk[ri]
      check_int("coop", idx, k, "pk[\{ri}][0]", as_int(cols[0]), m.0)
      check_int("coop", idx, k, "pk[\{ri}][1]", as_int(cols[1]), m.1)
      check_num("coop", idx, k, "pk[\{ri}][2]", as_num(cols[2]), m.2)
      check_num("coop", idx, k, "pk[\{ri}][3]", as_num(cols[3]), m.3)
    }
    // dtKeys
    let dt_g = get_array(gold, "dtKeys")
    if dt_g.length() != mine.dt_keys.length() {
      die("TRACE MISMATCH srvsim coop snapshot[\{idx}] dtKeys 条数不符")
    }
    for di, dj in dt_g {
      check_int("coop", idx, k, "dtKeys[\{di}]", as_int(dj), mine.dt_keys[di])
    }
    // humans
    let humans_g = get_array(gold, "humans")
    for hi, row_g in humans_g {
      let cols = as_array(row_g)
      let row_m = mine.humans[hi]
      for ci, cj in cols {
        check_num("coop", idx, k, "humans[\{hi}][\{ci}]", as_num(cj), row_m[ci])
      }
    }
    check_int(
      "coop",
      idx,
      k,
      "enemiesAlive",
      get_int(gold, "enemiesAlive"),
      mine.enemies_alive,
    )
    check_int(
      "coop",
      idx,
      k,
      "enemiesTotal",
      get_int(gold, "enemiesTotal"),
      mine.enemies_total,
    )
    let types_g = get_array(gold, "enemyTypes")
    if types_g.length() != mine.enemy_types.length() {
      die("TRACE MISMATCH srvsim coop snapshot[\{idx}] enemyTypes 条数不符")
    }
    for ti, row_g in types_g {
      let cols = as_array(row_g)
      let m = mine.enemy_types[ti]
      check_int("coop", idx, k, "enemyTypes[\{ti}][0]", as_int(cols[0]), m.0)
      check_str("coop", idx, k, "enemyTypes[\{ti}][1]", as_str(cols[1]), m.1)
      check_int("coop", idx, k, "enemyTypes[\{ti}][2]", as_int(cols[2]), m.2)
    }
    let ev = get(gold, "ev")
    check_int("coop", idx, k, "ev.fire", get_int(ev, "fire"), mine.ev_fire)
    check_int("coop", idx, k, "ev.hit", get_int(ev, "hit"), mine.ev_hit)
    check_int("coop", idx, k, "ev.kill", get_int(ev, "kill"), mine.ev_kill)
    check_int(
      "coop",
      idx,
      k,
      "ev.aiWave",
      get_int(ev, "aiWave"),
      mine.ev_aiwave,
    )
    check_int("coop", idx, k, "ev.pkGet", get_int(ev, "pkGet"), mine.ev_pkget)
    check_int(
      "coop",
      idx,
      k,
      "testFires",
      get_int(gold, "testFires"),
      mine.test_fires,
    )
  }
  // coopLog(事件流水: 条数 + 逐条全等)
  let log_g = get_array(root, "coopLog")
  if log_g.length() != log.length() {
    die(
      "TRACE MISMATCH srvsim coopLog 条数不符: golden=\{log_g.length()} 实际=\{log.length()}",
    )
  }
  for li, ev_g in log_g {
    let cols = as_array(ev_g)
    let kind = as_str(cols[0])
    let m = log[li]
    check_str("coop", -1, li, "coopLog[\{li}].kind", kind, m.kind)
    if kind == "aiWave" {
      let list_g = as_array(cols[1])
      if list_g.length() != m.list.length() {
        die("TRACE MISMATCH srvsim coopLog[\{li}] aiWave list 条数不符")
      }
      for ei, e_g in list_g {
        let pair = as_array(e_g)
        check_int(
          "coop",
          -1,
          li,
          "coopLog[\{li}].list[\{ei}].id",
          as_int(pair[0]),
          m.list[ei].0,
        )
        check_str(
          "coop",
          -1,
          li,
          "coopLog[\{li}].list[\{ei}].type",
          as_str(pair[1]),
          m.list[ei].1,
        )
      }
    } else if kind == "kill" {
      check_int("coop", -1, li, "coopLog[\{li}].id", as_int(cols[1]), m.id)
      check_int("coop", -1, li, "coopLog[\{li}].by", as_int(cols[2]), m.by)
    } else if kind == "pkGet" {
      check_int("coop", -1, li, "coopLog[\{li}].id", as_int(cols[1]), m.id)
      check_int("coop", -1, li, "coopLog[\{li}].by", as_int(cols[2]), m.by)
      check_str("coop", -1, li, "coopLog[\{li}].type", as_str(cols[3]), m.typ)
    }
  }
  // coopResult(scoreRows = onEnd 收到的 rows)
  let res = get(root, "coopResult")
  check_int(
    "coop",
    snaps.length(),
    -1,
    "coopResult.finished",
    get_int(res, "finished"),
    result_finished,
  )
  check_int(
    "coop",
    snaps.length(),
    -1,
    "coopResult.win",
    get_int(res, "win"),
    result_win,
  )
  let rows_g = get_array(res, "scoreRows")
  if rows_g.length() != end_rows.length() {
    die("TRACE MISMATCH srvsim coopResult.scoreRows 条数不符")
  }
  for ri, row_g in rows_g {
    let cols = as_array(row_g)
    let mine = end_rows[ri]
    check_int(
      "coop",
      snaps.length(),
      -1,
      "coopResult.scoreRows[\{ri}].id",
      as_int(cols[0]),
      mine.0,
    )
    check_str(
      "coop",
      snaps.length(),
      -1,
      "coopResult.scoreRows[\{ri}].name",
      as_str(cols[1]),
      mine.1,
    )
    check_int(
      "coop",
      snaps.length(),
      -1,
      "coopResult.scoreRows[\{ri}].kills",
      as_int(cols[2]),
      mine.2,
    )
  }
  println("TRACE OK srvsim coop \{snaps.length()}/\{snaps.length()}")
}
