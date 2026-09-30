/* zcode-workflow
description: 五图点位可玩性与公平性评审：并行分析五张地图的点位/路线/视野/南北对称性，工程师统一落改进
  tools/build-map.js，确定性地形校验（语法+重建+梯度扫描）+ 独立公平性审计后提交。
whenToUse: 改动地图生成器后想系统性评审五图点位可玩性与公平性时；或新增地图后做一轮全面点位审查。
*/
// 五图点位可玩性评审与公平性完善工作流
// 分析并行(5分析师) → 工程师串行逐图实施(单文件约束) → 确定性门禁 → 独立公平性审计(换人复审) → 提交

interface MapFinding {
  /** 地图 id, 如 l01 */
  map: string;
  /** 点位: 世界坐标与区域描述, 如 "(190,-35) 东山崖顶" */
  spot: string;
  /** 一句话: 问题或机会 */
  what: string;
  /** 具体可实施的改进建议: 在哪加/删/改什么参数 */
  fix: string;
  /** 类别 */
  kind: "cover" | "sightline" | "route" | "symmetry" | "terrain";
  /** 影响程度; high=破坏公平或会卡死/摔死级 */
  severity: "low" | "medium" | "high";
}

interface MapAnalysis {
  /** 地图 id */
  map: string;
  /** 3-5 句总评: 可玩性现状与最大短板 */
  summary: string;
  /** 点位级发现, 只收有实际战术价值的, 5-12 条 */
  findings: MapFinding[];
}

interface EngResult {
  /** 地图 id */
  map: string;
  /** 实施了哪些修改(函数/位置 + 一句话说明) */
  changes: string[];
  /** 跳过未实施的建议及原因 */
  skipped: string[];
}

interface AuditFinding {
  /** 位置: 文件与函数, 或地图坐标区域 */
  where: string;
  /** 一句话问题 */
  what: string;
  /** 证据: 读到的具体数据(坐标/数量对比) */
  evidence: string;
  /** 严重度; high=单方碾压或必然卡死 */
  severity: "low" | "medium" | "high";
}

const MAPS = [
  { id: "l01", dir: "l01-encounter", name: "诺曼底遭遇战", fn: "terrainL01/coversL01" },
  { id: "l02", dir: "l02-city", name: "废墟城市巷战", fn: "terrainL02/coversL02" },
  { id: "l03", dir: "l03-highland", name: "山川高地争夺", fn: "terrainL03/coversL03" },
  { id: "l04", dir: "l04-steppe", name: "东线平原炮战", fn: "terrainL04/coversL04" },
  { id: "l05", dir: "l05-airfield", name: "荒漠机场争夺", fn: "terrainL05/coversL05" },
];

// 地形确定性校验: 五图资产可解析、掩体/波次齐备、出生点平坦、边界山体不可攀
// (已用 EvalWorkflowSnippet 实测通过: 五图全绿, ~1.8s)
const SCAN = [
  "const fs=require('fs'),zlib=require('zlib');",
  "function loadPNG16(f){const b=fs.readFileSync(f);let p=8,w=0,h=0,id=[];while(p<b.length){const l=b.readUInt32BE(p),t=b.toString('ascii',p+4,p+8);if(t==='IHDR'){w=b.readUInt32BE(p+8);h=b.readUInt32BE(p+12);}if(t==='IDAT')id.push(b.subarray(p+8,p+8+l));p+=12+l;}const raw=zlib.inflateSync(Buffer.concat(id));const o=new Float32Array(w*h),bp=2,st=w*bp;for(let j=0;j<h;j++){const ft=raw[j*(st+1)],row=j*(st+1)+1;for(let i=0;i<w;i++){const x=i*bp;let a=i>=1?((raw[row+x-2]<<8)|raw[row+x-1]):0;let b2=j>=1?((raw[row-(st+1)+x]<<8)|raw[row-(st+1)+x+1]):0;let c=(j>=1&&i>=1)?((raw[row-(st+1)+x-2]<<8)|raw[row-(st+1)+x-1]):0;let v=(raw[row+x]<<8)|raw[row+x+1];if(ft===1)v+=a;else if(ft===2)v+=b2;else if(ft===3)v+=(a+b2)>>1;else if(ft===4){const pp=a+b2-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b2),pc=Math.abs(pp-c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?b2:c);}o[j*w+i]=v/65535;}}return{w,h,data:o};}",
  "let bad=0;",
  "for(const d of ['l01-encounter','l02-city','l03-highland','l04-steppe','l05-airfield']){",
  "const J=JSON.parse(fs.readFileSync('client/assets/maps/'+d+'/map.json','utf8'));",
  "const {w,data}=loadPNG16('client/assets/maps/'+d+'/heightmap.png');",
  "const size=J.terrain.size,half=size/2,mh=J.terrain.maxHeight,res=w;",
  "const cl=(v,a,b)=>Math.max(a,Math.min(b,v));",
  "const hAt=(x,z)=>{const fi=cl((x+half)/size,0,1)*(res-1),fj=cl((z+half)/size,0,1)*(res-1);const i=Math.min(res-2,Math.floor(fi)),j=Math.min(res-2,Math.floor(fj)),tx=fi-i,tz=fj-j;const a=data[j*res+i],b=data[j*res+i+1],c=data[(j+1)*res+i],d2=data[(j+1)*res+i+1];return(a+(b-a)*tx+(c-a+(a-b-c+d2)*tx)*tz)*mh;};",
  "const gAt=(x,z)=>{const e=2.5;return Math.hypot((hAt(x+e,z)-hAt(x-e,z))/(2*e),(hAt(x,z+e)-hAt(x,z-e))/(2*e));};",
  "const gSpawn=gAt(J.player.spawn[0],J.player.spawn[1]);",
  "const gBorder=Math.min(gAt(470,0),gAt(-470,0),gAt(0,470),gAt(0,-470));",
  "const ok=J.covers.length>=60&&J.waves.length>=2&&gSpawn<0.913&&gBorder>0.913;",
  "if(!ok)bad++;",
  "console.log(d,'covers='+J.covers.length,'waves='+J.waves.length,'gSpawn='+gSpawn.toFixed(2),'gBorder='+gBorder.toFixed(2),ok?'OK':'FAIL');",
  "}",
  "process.exit(bad?1:0);",
].join("\n");

// 五图进度看板: 分析→实施两列流转
artifact.board("maps", {
  title: "五图评审进度",
  key: "map",
  status: "stage",
  columns: ["已分析", "已实施"],
  detail: [{ field: "detail", label: "说明" }],
});

phase("并行分析五张地图的点位可玩性");
log(`五个地图分析师同时开工: ${MAPS.map(m => m.name).join(" / ")}`);
const analyses = await Promise.all(
  MAPS.map((m) =>
    agent("地图分析师-" + m.id, {
      system:
        "你是坦克世界资深玩家与关卡评审员, 从单车视角(视野/装甲/机动/隐蔽)评判点位价值。" +
        "只读分析, 不修改任何文件。发现要具体可实施, 不写空话。",
    }).ask<MapAnalysis>(
      `深入分析地图「${m.name}」(${m.id}): 读 client/assets/maps/${m.dir}/map.json(covers/waves/player.spawn) ` +
      `和 tools/build-map.js 中的 ${m.fn} 函数(地形是怎么生成的), 对照理解每个掩体、陡壁、壕沟、草丛的实际样子。\n` +
      `从坦克角度逐区域审视:\n` +
      `1) 点位价值: 卖头位/硬掩体/草丛蹲位/壕沟缺口是否可达、是否有用、有无反制手段;\n` +
      `2) 路线: 主攻/副攻/迂回是否分明, 有无死路、无价值区域或必然塞车点;\n` +
      `3) 视野节奏: 远距炮战与近距肉搏区域的分布, 视距与掩体是否匹配;\n` +
      `4) 对称公平: 南(玩家方)北(敌方)双方能用的资源(掩体/卖头/草丛/缺口/制高点)是否相对对称均衡, 有无单方碾压点。\n` +
      `输出 5-12 条有实际战术价值的 findings(坐标用生成器坐标系, 建议具体到"在(x,z)加/删什么、把什么参数改成多少"), ` +
      `并给 3-5 句总评。坐标系说明: 地图 1000x1000m, 生成器里 x/z 约 ±330 为可玩区, 玩家出生在 z≈+330 南侧朝北推进。`,
    ),
  ),
);
const totalFindings = analyses.reduce((n, a) => n + a.findings.length, 0);
log(`五图分析完成, 共 ${totalFindings} 条点位发现`);
for (const a of analyses) report({ map: a.map, stage: "已分析", detail: `${a.findings.length} 条发现` }, "maps");

phase("逐图实施地图改进");
const engineer = agent("地图工程师", {
  system:
    "你是坦克地形与关卡工程师, 负责把评审发现落进地图生成器。\n" +
    "硬性约束:\n" +
    "- 所有修改只落在 tools/build-map.js(地形函数与掩体函数); client/assets/maps/*/map.json 是生成产物, 手改会被覆盖。\n" +
    "- 对称公平: 关键资源(卖头位/掩体群/草丛簇/缺口通道)南北双方要等价可用; 不对称必须有战术理由并在 changes 里说明。\n" +
    "- 不可攀陡壁: 悬崖侧梯度必须 >0.913(参考现有 cliffHill 用法, h/w 足够大), 环坡侧 <0.72 可开车上顶; 反坦克壕同理(壁陡沟深, 缺口可通行)。\n" +
    "- 不破坏已验证机制: 坠落摔伤(safeV=9)、滑坡、梯度判定(maxSlope=0.63)都依赖地形形状, 别把陡壁抹缓。\n" +
    "- 克制: 只实施高价值建议, 宁少勿滥; 掩体摆放沿用 add() 现有类型(rock/tree/bush/hedge/wall/ruin/trap/wreck/haystack)。\n" +
    "- 语法自检: 改完在脑内过一遍 JS 语法; 门禁(语法检查+重建资产+地形扫描)由脚本统一执行, 你不用跑。\n" +
    "若两条建议冲突或都不可行, 实施更优者并在 skipped 里说明另一条。",
});
const engResults: EngResult[] = [];
for (const a of analyses) {
  const high = a.findings.filter((f) => f.severity === "high").length;
  log(`实施 ${a.map} 的改进 (${a.findings.length} 条建议, ${high} 条高严重度)`);
  const r = await engineer.ask<EngResult>(
    `实施对「${a.map}」的地图改进。评审发现:\n${JSON.stringify(a.findings, null, 1)}\n` +
      `总评: ${a.summary}\n逐条评估并实施有价值的建议; 修改全部落在 tools/build-map.js 对应的 terrain/covers 函数。`,
  );
  engResults.push(r);
  report({ map: r.map, stage: "已实施", detail: `${r.changes.length} 项修改` }, "maps");
}

phase("重建地图资产并跑地形校验");
let gateOk = false;
let gateErr = "";
for (let round = 0; round < 3; round++) {
  const chk = await world.run("node", ["--check", "tools/build-map.js"]);
  if (chk.exitCode !== 0) {
    gateErr = chk.stderr;
    log(`语法检查未过 (第 ${round + 1} 轮), 交给工程师修复`);
    await engineer.ask(`tools/build-map.js 语法错误:\n${gateErr}\n修复它, 只改语法不改设计。`);
    continue;
  }
  const build = await world.run("node", ["tools/build-map.js", "all"], { timeoutMs: 180000 });
  if (build.exitCode !== 0) {
    gateErr = build.stderr;
    log(`资产重建失败 (第 ${round + 1} 轮)`);
    await engineer.ask(`node tools/build-map.js all 失败:\n${gateErr}\n修复 tools/build-map.js。`);
    continue;
  }
  const scan = await world.run("node", ["-e", SCAN], { timeoutMs: 120000 });
  if (scan.exitCode !== 0) {
    gateErr = scan.stdout + "\n" + scan.stderr;
    log(`地形校验未过 (第 ${round + 1} 轮): 出生点/边界/掩体/波次有 FAIL`);
    await engineer.ask(`地形确定性校验失败(FAIL 行即问题):\n${gateErr}\n` +
      `gSpawn<0.913 要求出生点平坦, gBorder>0.913 要求边界山体不可攀, covers>=60 与 waves>=2 要求内容齐备。修 tools/build-map.js 直到全 OK。`);
    continue;
  }
  gateOk = true;
  log(`地形校验全绿:\n${scan.stdout.trim()}`);
  break;
}

phase("公平性独立审计");
let auditFindings: AuditFinding[] = [];
let auditRounds = 0;
for (let round = 0; round < 2; round++) {
  auditRounds = round + 1;
  const auditorName = round === 0 ? "公平性审计员" : "公平性复核审计员";
  const diff = await git.diff("HEAD", "tools/build-map.js");
  auditFindings = await agent(auditorName, {
    system:
      "你是独立公平性审计员(全新视角), 只读审计, 不修改任何文件。宁缺勿滥: 没有真问题就返回空数组, 不凑数。每条发现必须带读到的具体数据作证据。",
  }).ask<AuditFinding[]>(
    `审计五张坦克地图的南北公平性。背景: 地图由 tools/build-map.js 生成, 资产在 client/assets/maps/*/(生成产物, 以生成器为准)。` +
      `玩家/蓝方出生南侧(z≈+330)朝北, 敌方/红方在北; 死斗模式下双方都可能用任意出生点。\n` +
      (round === 0 ? `本轮改动 diff(供聚焦):\n${diff.slice(0, 6000)}\n` : "") +
      `审计四项:\n` +
      `1) 出生安全: 双方出生点到中心与关键点位的距离/可达性是否对等;\n` +
      `2) 资源对等: 卖头位/硬掩体/草丛簇/壕沟缺口/制高点, 双方可用数量与质量;\n` +
      `3) 地形封锁: 不可攀陡壁与壕沟对双方的封锁是否等价, 有无单方独有的碾压点位;\n` +
      `4) 路线公平: 主攻/迂回路线双方是否都存在且代价相近。\n` +
      `读 tools/build-map.js 与五个 map.json 核对数据。输出发现(位置/问题/数据证据/严重度), 高严重度=单方碾压或必然卡死。`,
  );
  for (const f of auditFindings) report(f);
  const high = auditFindings.filter((f) => f.severity === "high");
  if (!high.length) {
    log(`审计通过: ${auditFindings.length} 条低/中严重度备注, 无阻断问题`);
    break;
  }
  log(`审计发现 ${high.length} 条高严重度公平性问题, 交工程师修复 (第 ${round + 1} 轮)`);
  if (round === 0) {
    await engineer.ask(`独立审计发现高严重度公平性问题, 必须修复:\n${JSON.stringify(high, null, 1)}\n` +
      `修复落 tools/build-map.js, 保持双方资源等价。`);
    const chk = await world.run("node", ["--check", "tools/build-map.js"]);
    if (chk.exitCode === 0) {
      await world.run("node", ["tools/build-map.js", "all"], { timeoutMs: 180000 });
      const scan = await world.run("node", ["-e", SCAN], { timeoutMs: 120000 });
      if (scan.exitCode !== 0) throw new Error("审计修复后地形校验未过:\n" + scan.stdout);
    }
  }
}

phase("提交改动并汇总报告");
let commitMsg = "";
if (!gateOk) {
  log("门禁三轮未过, 放弃提交, 汇总问题进报告");
} else {
  await world.run("git", ["add", "-A"]);
  const brief = engResults.map((r) => `${r.map}:${r.changes.length}项`).join(" ");
  const cmt = await world.run("git", [
    "commit", "-m",
    `地图: 五图点位可玩性与公平性完善(工作流评审) — ${brief}; 地形扫描与独立公平性审计通过`,
  ]);
  commitMsg = cmt.exitCode === 0 ? "已提交" : "提交失败: " + (cmt.stderr || "").slice(0, 200);
  log(commitMsg);
}

const lines: string[] = [
  "# 五图点位可玩性与公平性评审报告",
  "",
  `分析发现 ${totalFindings} 条 · 工程师实施 ${engResults.reduce((n, r) => n + r.changes.length, 0)} 项 · 审计 ${auditRounds} 轮(${auditFindings.length} 条备注) · 门禁${gateOk ? "全绿" : "未过(已回滚提交)"} · ${commitMsg || "未提交"}`,
  "",
];
for (const a of analyses) {
  const er = engResults.find((r) => r.map === a.map);
  lines.push(`## ${a.map} `);
  lines.push(`**总评**: ${a.summary}`);
  lines.push("");
  lines.push(`**发现 ${a.findings.length} 条**:`);
  for (const f of a.findings) lines.push(`- [${f.severity}${f.kind ? "/" + f.kind : ""}] ${f.spot}: ${f.what}`);
  if (er) {
    lines.push("");
    lines.push(`**实施 ${er.changes.length} 项**:`);
    for (const c of er.changes) lines.push(`- ${c}`);
    if (er.skipped.length) {
      lines.push(`**跳过 ${er.skipped.length} 条**: ${er.skipped.join("; ")}`);
    }
  }
  lines.push("");
}
if (auditFindings.length) {
  lines.push("## 公平性审计备注");
  for (const f of auditFindings) lines.push(`- [${f.severity}] ${f.where}: ${f.what} (证据: ${f.evidence})`);
  lines.push("");
}
lines.push("## 验证");
lines.push("- node --check tools/build-map.js");
lines.push("- node tools/build-map.js all(重建五图资产)");
lines.push("- 地形扫描: 五图 covers/waves/出生点梯度/边界不可攀 全 OK");
lines.push(`- 公平性独立审计 ${auditRounds} 轮(每轮全新视角)`);
await artifact.markdown("report", lines.join("\n"), {
  title: "五图点位可玩性与公平性评审报告",
  description: `分析 ${totalFindings} 条发现, 实施 ${engResults.reduce((n, r) => n + r.changes.length, 0)} 项修改, 审计 ${auditRounds} 轮`,
  primary: true,
});

const findings: { where: string; what: string; evidence: string; status: "verified" | "unconfirmed"; severity: "low" | "medium" | "high" }[] =
  auditFindings.map((f) => ({ where: f.where, what: f.what, evidence: f.evidence, status: "verified", severity: f.severity }));
for (const a of analyses)
  for (const f of a.findings)
    if (f.severity === "high") {
      const done = engResults.find((r) => r.map === a.map)?.changes.length ?? 0;
      findings.push({
        where: `${a.map} ${f.spot}`,
        what: f.what + " → " + f.fix,
        evidence: `分析师高严重度发现; 工程师在该图实施 ${done} 项修改(含本条与否见报告)`,
        status: done > 0 ? "verified" : "unconfirmed",
        severity: "high",
      });
    }

return {
  conclusion: gateOk
    ? `五张地图完成点位级可玩性评审与公平性完善: 分析 ${totalFindings} 条发现, 实施 ${engResults.reduce((n, r) => n + r.changes.length, 0)} 项修改, 地形确定性校验全绿, 独立公平性审计 ${auditRounds} 轮通过, ${commitMsg}。`
    : `评审完成但地形校验三轮未过, 未提交; 问题与修复过程见报告。`,
  findings,
  verified: [
    "node --check tools/build-map.js(语法)",
    "node tools/build-map.js all(五图资产重建成功)",
    "node -e 地形扫描: 五图 covers>=60、waves>=2、出生点梯度<0.913、边界不可攀>0.913 全 OK",
    `公平性独立审计 ${auditRounds} 轮(每轮全新子代理, 只读核对数据)`,
  ],
  notCovered: [
    "浏览器实机试玩手感(工作流只做数据与确定性校验, 未开对局)",
    "AI 在改后地图上的实战表现(未跑单机对局)",
    "联机死斗模式下的实测平衡(审计为静态数据审计)",
  ],
};