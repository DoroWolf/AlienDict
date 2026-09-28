#!/usr/bin/env node
/* 外星词典 · 词素关系图（内部校对工具）
 *
 * 把 data/entries/*.yaml 里推导出来的「谁由哪些词素构成」画成一张**分层图**，
 * 产出一个自包含的单文件 HTML（内联字形 SVG 与脚本，双击就能开、离线可用）。
 * 纯内部工具：不接进 site/、不进构建流程，产物默认落在 out/（已在 .gitignore 里）。
 *
 * 语义全部复用 tools/lib/lexicon.mjs（与站点同一套推导），不另起炉灶：
 *   · 一条边＝原文里一条「X morpheme be A and B」声明；
 *   · 层号＝这个词往下拆几层能拆到「不再拆分」（基础词素在第 0 层）；
 *   · 顺手把校对要看的地方汇总成「问题」：词素声明首词不对、把自己当词素、
 *     引用了不存在的 id、待补词条、zh/en 缺失、没写构成、显式 morphemes 字段……
 *
 * 用法：
 *   node tools/morpheme_graph.mjs                    # → out/morpheme-graph.html
 *   node tools/morpheme_graph.mjs --out d:/graph.html
 *   node tools/morpheme_graph.mjs --per-row 60        # 一层一行最多 60 个（默认 32，0＝不折行）
 *   node tools/morpheme_graph.mjs --font ../site/assets/fonts/unifont.woff2
 *   node tools/morpheme_graph.mjs --quiet
 *
 * 文件里从上到下是：工具函数 → 页面组装（esc / 字库 / 外壳 / 报告 / main）
 * → 数据整理（buildPayload：节点 / 边 / 问题清单）→ 入口调用（末尾的 main()）。
 * 函数声明会提升，所以顺序只是阅读顺序；main() 在文件末尾、所有 const 就绪之后才调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, gloss, morphemesOf, morphemeDeclarations, baseMorphemesOf, isBaseMorpheme, isNonword,
} from './lib/lexicon.mjs';
import { loadSite } from './lib/props.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, 'lib');
const DEFAULT_OUT = path.join(ROOT, 'out', 'morpheme-graph.html');

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, font: null, quiet: false, perRow: 32 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = path.resolve(argv[++i]);
    else if (arg === '--font') args.font = argv[++i];
    else if (arg === '--per-row') args.perRow = Number.parseInt(argv[++i], 10) || 0;
    else if (arg === '--quiet') args.quiet = true;
    else throw new Error(`不认识的参数：${arg}`);
  }
  return args;
}

/** 原文的一行 → token 字符串数组（"" ＝一格空白），与站点渲染原文的口径一致 */
function tokensOf(lines) {
  return lines.map((line) => line.map((token) => (token.space ? '' : token.id)));
}

/** 层号：往下拆几层能拆到「不再拆分」（有环时把环剪断并记下来） */
function computeLayers(ids, direct) {
  const depth = new Map();
  const cycles = new Set();
  const walk = (id, path) => {
    if (depth.has(id)) return depth.get(id);
    if (path.has(id)) {
      cycles.add(id);
      return 0;
    }
    const next = new Set(path).add(id);
    let level = 0;
    for (const morpheme of direct.get(id) || []) level = Math.max(level, walk(morpheme, next) + 1);
    depth.set(id, level);
    return level;
  };
  for (const id of ids) walk(id, new Set());
  return { depth, cycles };
}

/* ── 组装页面 ─────────────────────────────────────────── */

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 站点子集化出来的 Unifont 直接引过来（没找到就回退系统等宽字体） */
function fontFaceFor(outFile, custom) {
  const file = custom ? path.resolve(custom) : path.join(ROOT, 'site', 'assets', 'fonts', 'unifont.woff2');
  if (!fs.existsSync(file)) return { css: '', file: null };
  const url = path.relative(path.dirname(outFile), file).split(path.sep).join('/');
  return {
    file,
    css: '@font-face {\n  font-family: "Unifont";\n'
      + '  src: local("GNU Unifont"), local("Unifont"), url("' + url + '") format("woff2");\n'
      + '  font-display: swap;\n}\n',
  };
}

function renderPage(payload, css, app, fontCss) {
  const { site, stats } = payload;
  const inline = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>词素关系图 · ${esc(site.title)}</title>
<style>
${fontCss}${css}
</style>
</head>
<body>
<header class="bar">
  <div class="bar__title">词素关系图 · 校对用
    <span class="bar__sub">${stats.words} 词 · ${stats.composed} 个写了构成 · ${stats.edges} 条声明
      · 更新 ${esc(payload.generated)}</span>
  </div>
  <div class="bar__tools">
    <input id="q" type="search" placeholder="找词：中译 / 英文 / id（回车跳第一个）" autocomplete="off">
    <span><button type="button" id="zoom-out">−</button>
      <span class="bar__info" id="zoom-info">100%</span>
      <button type="button" id="zoom-in">+</button></span>
    <button type="button" id="zoom-fit">适应 (F)</button>
    <label><input type="checkbox" id="opt-isolated">隐藏未写构成</label>
    <label><input type="checkbox" id="opt-nonword">隐藏非实义</label>
    <label><input type="checkbox" id="opt-issues">只看有问题</label>
    <label><input type="checkbox" id="opt-focus">只看选中网络</label>
    <span class="bar__info" id="drawn-info"></span>
  </div>
</header>
<div class="wrap">
  <aside class="side">
    <div id="tabs">
      <button type="button" data-tab="detail" id="tab-detail" class="is-on">词条</button>
      <button type="button" data-tab="issues" id="tab-issues">问题 ${stats.issueCount}</button>
      <button type="button" data-tab="matches" id="tab-matches">匹配</button>
    </div>
    <div id="panel-body"></div>
  </aside>
  <div class="stage" id="stage">
    <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="legend">
      <span><i class="l-base"></i>基础词素</span>
      <span><i class="l-pending"></i>待补词条</span>
      <span><i class="l-isolated"></i>未写构成</span>
      <span><i class="l-issue"></i>有问题</span>
      <span><i class="l-up"></i>它的词素</span>
      <span><i class="l-down"></i>由它构成的词</span>
      <span>滚轮缩放 · 拖动平移 · 单击选中 · 双击只看这一片</span>
    </div>
  </div>
</div>
<script>window.__MORPH_GRAPH__ = ${inline};</script>
<script>
${app}
</script>
</body>
</html>
`;
}

function report(payload, out, bytes, font) {
  const { stats } = payload;
  console.log(`[词条] ${stats.words} 个（写了构成 ${stats.composed}）`);
  console.log(`[词素] 直接引用 ${stats.morphemes} 个 · 基础词素 ${stats.base} 个 · 声明 ${stats.edges} 条`);
  console.log(`[分层] ${Object.entries(stats.layers).map(([layer, count]) => `第 ${layer} 层 ${count}`).join(' · ')}`);
  console.log(`[排布] 每层一行最多 ${stats.perRow || '不限'} 个节点，超出折行（--per-row 调整）`);
  console.log(`[问题] ${payload.issues.length} 组共 ${stats.issueCount} 处`);
  for (const group of payload.issues) {
    const shown = group.items.slice(0, 6).map((item) => item.id || '—').join('、');
    console.log(`        ${group.title}：${group.items.length}（${shown}${group.items.length > 6 ? '…' : ''}）`);
  }
  console.log(`[字库] ${font.file
    ? `引用 ${path.relative(ROOT, font.file)}（相对产物路径）`
    : '没找到 unifont.woff2：正文回退系统等宽字体（先跑一次 npm run build 更好看）'}`);
  console.log(`[输出] ${path.relative(ROOT, out)}（${(bytes / 1024 / 1024).toFixed(2)} MB，双击就能开）`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = loadSite();
  for (const warning of data.warnings) console.log(`[警告] ${warning}`);
  const payload = buildPayload(data, { perRow: args.perRow });
  const css = fs.readFileSync(path.join(LIB, 'graph.css'), 'utf8');
  const app = fs.readFileSync(path.join(LIB, 'graph-app.js'), 'utf8');
  const font = fontFaceFor(args.out, args.font);
  const html = renderPage(payload, css, app, font.css);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, html);
  if (!args.quiet) report(payload, args.out, Buffer.byteLength(html), font);
  return 0;
}

/* ── 数据：词条 → 节点 / 边 / 问题清单 ─────────────────── */

/** 问题分组在「问题」页里的先后顺序（越靠前越像真错了） */
const GROUP_ORDER = [
  'decl-head', 'self-morpheme', 'cycle', 'no-compose', 'isolated',
  'pending-morph', 'pending-token', 'missing-zh', 'missing-en',
  'missing-meaning-zh', 'missing-glyph', 'explicit',
];

function buildPayload(data, options = {}) {
  const entryIds = new Set(data.ordered.map((entry) => entry.id));
  const direct = new Map();      // 词 → 它的构成词素
  const derived = new Map();     // 词素 → 由它构成的词
  for (const entry of data.ordered) {
    const list = morphemesOf(entry);
    direct.set(entry.id, list);
    for (const morpheme of list) {
      if (!derived.has(morpheme)) derived.set(morpheme, []);
      const words = derived.get(morpheme);
      if (!words.includes(entry.id)) words.push(entry.id);
    }
  }
  const pendingMorphemes = [...derived.keys()].filter((id) => !entryIds.has(id));
  const nodeIds = [...data.ordered.map((entry) => entry.id), ...pendingMorphemes];
  const { depth, cycles } = computeLayers(nodeIds, direct);

  const groups = new Map();
  const addIssue = (key, title, id, text) => {
    if (!groups.has(key)) groups.set(key, { key, title, items: [] });
    groups.get(key).items.push({ id, text });
  };

  const words = {};
  const glyphNames = new Set();
  const noteWord = (id) => {
    if (words[id]) return;
    const entry = data.entries[id];
    const glyphName = entry ? entry.glyph : id;
    const hasGlyph = !!data.glyphs[glyphName];
    if (hasGlyph) glyphNames.add(glyphName);
    words[id] = {
      zh: entry ? entry.zh : id,
      en: entry ? entry.en : '',
      glyph: hasGlyph ? glyphName : null,
      pending: !entry,
      base: !!entry && isBaseMorpheme(entry),
    };
  };

  const nodes = nodeIds.map((id) => {
    const entry = data.entries[id];
    const morphemes = direct.get(id) || [];
    const users = derived.get(id) || [];
    const flags = [];
    const issues = [];

    if (!entry) flags.push('is-pending');
    if (entry && isBaseMorpheme(entry)) flags.push('is-base');
    if (entry && isNonword(entry)) flags.push('is-nonword');
    if (entry && entry.morphemes !== null && entry.morphemes !== undefined) flags.push('is-explicit');
    if (!morphemes.length && !users.length) flags.push('is-isolated');
    if (!morphemes.length && users.length && entry && !isBaseMorpheme(entry) && !isNonword(entry)) {
      flags.push('is-no-compose');
    }

    if (!entry) {
      issues.push('原文引用了它，但没有对应词条（待补词条）');
      addIssue('pending-morph', '被当作词素但没有词条', id, '别人的构成里用到它，但它自己还没有词条');
    } else {
      if (!entry.en) {
        issues.push('缺 en（英文释义）');
        addIssue('missing-en', '缺 en（英文释义）', id, gloss(entry));
      }
      if (entry.zh === entry.id) {
        issues.push('zh 与 id 相同（可能没写中译）');
        addIssue('missing-zh', 'zh 与 id 相同（可能没写中译）', id, '');
      }
      const glyphName = entry.glyph;
      if (!data.glyphs[glyphName] && !data.pngs.has(glyphName)) {
        issues.push(`字形文件缺失（glyph/${glyphName}.svg / .png）`);
        addIssue('missing-glyph', '字形文件缺失', id, `${gloss(entry)}：缺少 glyph/${glyphName}`);
      }
      entry.meanings.forEach((meaning, index) => {
        if (meaning.blank || !meaning.alien.length || meaning.zh) return;
        issues.push(`第 ${index + 1} 条义项缺中译`);
        addIssue('missing-meaning-zh', '义项缺中译', id, `第 ${index + 1} 条`);
      });
      if (flags.includes('is-no-compose')) {
        issues.push('被别的词当作词素，但自己没写构成');
        addIssue('no-compose', '被当作词素但没写构成', id, '没写「X be base morpheme」，也没有词素句');
      }
      if (flags.includes('is-isolated')) {
        issues.push('没写构成，也没有别的词把它当词素');
        addIssue('isolated', '没写构成，也不作别人的词素', id, '');
      }
      if (flags.includes('is-explicit')) {
        addIssue('explicit', '用 morphemes 字段显式指定（复核一下）', id,
          `morphemes: ${JSON.stringify(entry.morphemes)}`);
      }
    }

    const decls = entry ? morphemeDeclarations(entry) : [];
    for (const decl of decls) {
      if (decl.head !== id) {
        issues.push(`词素声明首词是 ${decl.head || '(空)'}，应为 ${id}`);
        addIssue('decl-head', '词素声明首词不是本词 id', id,
          `第 ${decl.meaning + 1} 条义项：首词 ${decl.head || '(空)'}`);
      }
      if (decl.morphemes.includes(id)) {
        issues.push('词素声明里把自己当词素（会被忽略）');
        addIssue('self-morpheme', '词素声明里把自己当词素', id, `第 ${decl.meaning + 1} 条义项`);
      }
    }

    if (issues.length) flags.push('has-issue');
    noteWord(id);
    for (const morpheme of morphemes) noteWord(morpheme);

    return {
      id,
      zh: entry ? entry.zh : id,
      en: entry ? entry.en : '',
      layer: depth.get(id) || 0,
      glyph: data.glyphs[entry ? entry.glyph : id] ? (entry ? entry.glyph : id) : null,
      pending: !entry,
      flags,
      issues,
      morphemes,
      derived: users,
      base: entry ? baseMorphemesOf(entry, data.entries).map((item) => ({ id: item.id, via: item.via })) : [],
      alien: entry ? tokensOf(entry.alien) : [],
      meanings: entry ? entry.meanings.map((meaning) => (meaning.blank
        ? { blank: true }
        : { lines: tokensOf(meaning.alien), zh: meaning.zh })) : [],
      decls: decls.map((decl) => ({
        head: decl.head,
        morphemes: decl.morphemes,
        meaning: decl.meaning,
        words: decl.words,
      })),
      notes: entry ? entry.notes : [],
    };
  });

  // 原文里出现过的 token 与待补词条也要进 words（左栏的原文字形链要渲染它们）
  for (const entry of data.ordered) {
    for (const line of [...entry.alien, ...entry.meanings.flatMap((meaning) => meaning.alien)]) {
      for (const token of line) if (!token.space) noteWord(token.id);
    }
  }
  for (const id of data.pending) noteWord(id);

  for (const id of cycles) addIssue('cycle', '词素关系成环', id, '沿着词素一路往下拆会绕回自己');

  const asMorpheme = new Set(pendingMorphemes);
  for (const id of data.pending) {
    if (asMorpheme.has(id)) continue;
    addIssue('pending-token', '原文用到但没有词条的词', id, '');
  }

  const glyphs = {};
  for (const name of glyphNames) glyphs[name] = data.glyphs[name];

  const edges = [];
  const layerCount = {};
  for (const node of nodes) {
    layerCount[node.layer] = (layerCount[node.layer] || 0) + 1;
    for (const morpheme of node.morphemes) edges.push([node.id, morpheme]);
  }

  const issues = [...groups.values()]
    .sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key));

  return {
    site: data.site,
    generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    stats: {
      words: data.ordered.length,
      composed: data.ordered.filter((entry) => morphemesOf(entry).length).length,
      morphemes: new Set([...direct.values()].flat()).size,
      base: data.ordered.filter((entry) => isBaseMorpheme(entry)).length,
      layers: layerCount,
      edges: edges.length,
      perRow: options.perRow || 0,
      issueCount: issues.reduce((sum, group) => sum + group.items.length, 0),
    },
    glyphs,
    words,
    nodes,
    edges,
    issues,
  };
}

/* ── 入口 ─────────────────────────────────────────────── */

try {
  process.exitCode = main();
} catch (err) {
  console.error(`[失败] ${err.message}`);
  process.exitCode = 1;
}


