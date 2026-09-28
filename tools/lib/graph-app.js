/* 外星词典 · 词素关系图 · 页面脚本
 *
 * 这是一段**普通脚本**（不是 ES 模块），由 tools/morpheme_graph.mjs 原样内联进生成的
 * 单文件 HTML 里：双击就能打开，不发任何请求、不依赖任何库。
 *
 * 数据从 window.__MORPH_GRAPH__ 读（形状见 tools/morpheme_graph.mjs 里的 buildPayload）：
 *   { site, stats, glyphs, words, nodes, issues, edges }
 *
 * 图是**分层有向图**：
 *   · 层号＝这个词再往下拆几层能拆到「不再拆分」（基础词素在第 0 层，由它构成的词在第 1 层……）；
 *   · 一条边＝一条「X morpheme be A and B」声明（上一层的词是下一层词的构成词素），
 *     也就是一条要校对的声明本身。
 * 布局是 Sugiyama 那一套的简化版：先按层分组（层内按字序），再用重心法（barycenter）
 * 来回扫几遍降低连线交叉，最后每层居中摆放。
 *
 * 布局是纯函数、不碰 DOM，末尾的 init() 有 typeof document 守卫 ——
 * 于是 tools 侧的检查脚本可以用 new Function(源码) 把 layoutGraph 拿出来单独跑。
 */

const NG = { w: 136, h: 34, gapX: 14, gapY: 78, padX: 34, padY: 46 };
const ZOOM = { min: 0.05, max: 4 };
const LOD_FAR = 0.55;      // 小于这个比例：只留字形（藏文字）
const LOD_MIN = 0.26;      // 再小：连框也淡掉

const DATA = typeof window === 'undefined' ? {} : (window.__MORPH_GRAPH__ || {});

const state = {
  selected: null,
  query: '',
  hideIsolated: false,
  hideNonword: false,
  onlyIssues: false,
  focus: false,          // 只看选中词的关系网
  focusedId: null,
  tab: 'detail',
  view: { scale: 1, tx: 0, ty: 0 },
  matches: [],
  model: null,           // { byId, edges, parents, children, layout }
};

/* ── 小工具 ─────────────────────────────────────────── */

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** 文本宽度（粗略）：汉字一格、其它半格 —— Unifont 是等宽点阵，够用 */
function textUnits(text) {
  let sum = 0;
  for (const ch of String(text == null ? '' : text)) sum += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  return sum;
}

/** 超宽的标签按格数截断，加省略号（完整释义在 title 与左栏里） */
function fitLabel(text, maxUnits) {
  const source = String(text == null ? '' : text);
  if (textUnits(source) <= maxUnits) return source;
  let out = '';
  let used = 0;
  for (const ch of source) {
    const unit = ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
    if (used + unit > maxUnits - 0.7) break;
    out += ch;
    used += unit;
  }
  return `${out}…`;
}

/* ── 布局（纯函数）────────────────────────────────────── */

/**
 * @param {Array<{id:string, layer:number}>} nodes 参与绘制的节点（layer＝层号）
 * @param {Array<[string,string]>} edges [合成词, 它的一个构成词素]
 * @param {{perRow?:number}} [options] perRow＞0 时，一层超过这么多节点就折成几行
 * @returns {{place:Map<string,{x:number,y:number,w:number,h:number}>, bands:Array, width:number, height:number}}
 */
function layoutGraph(nodes, edges, options) {
  const layers = [];
  for (const node of nodes) {
    const index = Math.max(0, node.layer | 0);
    (layers[index] = layers[index] || []).push(node.id);
  }
  for (let i = 0; i < layers.length; i += 1) if (!layers[i]) layers[i] = [];

  const parents = new Map();     // 词 → 它的构成词素（上一层）
  const children = new Map();    // 词素 → 由它构成的词（下一层）
  const keep = new Set(nodes.map((node) => node.id));
  const kept = [];
  for (const [from, to] of edges) {
    if (!keep.has(from) || !keep.has(to)) continue;
    kept.push([from, to]);
    if (!parents.has(from)) parents.set(from, []);
    parents.get(from).push(to);
    if (!children.has(to)) children.set(to, []);
    children.get(to).push(from);
  }

  const pos = new Map();
  const sync = () => layers.forEach((layer) => layer.forEach((id, index) => pos.set(id, index)));
  sync();

  const sweep = (layer, neighbors) => {
    const score = new Map();
    layer.forEach((id, index) => {
      const ranks = (neighbors.get(id) || []).map((n) => pos.get(n)).filter((n) => n !== undefined);
      score.set(id, ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : index);
    });
    layer.sort((a, b) => (score.get(a) - score.get(b)) || (pos.get(a) - pos.get(b)));
  };

  for (let pass = 0; pass < 4; pass += 1) {
    for (let l = 1; l < layers.length; l += 1) { sweep(layers[l], parents); sync(); }
    for (let l = layers.length - 2; l >= 0; l -= 1) { sweep(layers[l], children); sync(); }
  }
  for (const layer of layers) layer.forEach((id, index) => pos.set(id, index));

  // 摆放：一层是一横排；perRow 时排不下就折成几行（行距比层距小，行与行之间仍属同一层）
  const opts = options || {};
  const perRow = Math.max(0, opts.perRow | 0);
  const rowGap = 16;
  const rowsOf = (layer) => {
    if (!perRow || layer.length <= perRow) return [layer.slice()];
    const rows = [];
    for (let i = 0; i < layer.length; i += perRow) rows.push(layer.slice(i, i + perRow));
    return rows;
  };
  const rowWidth = (row) => Math.max(0, row.length * (NG.w + NG.gapX) - NG.gapX);
  const widest = Math.max(1, ...layers.flatMap((layer) => rowsOf(layer).map(rowWidth)));

  const place = new Map();
  const bands = [];
  let y = NG.padY;
  let bottom = NG.padY;
  layers.forEach((layer, index) => {
    if (!layer.length) return;
    const bandTop = y;
    const rows = rowsOf(layer);
    let lastBottom = y;
    for (const row of rows) {
      const x0 = NG.padX + (widest - rowWidth(row)) / 2;
      row.forEach((id, i) => place.set(id, { x: x0 + i * (NG.w + NG.gapX), y, w: NG.w, h: NG.h }));
      lastBottom = y + NG.h;
      y += NG.h + rowGap;
    }
    bands.push({
      index, y: bandTop, bottom: lastBottom, count: layer.length, rows: rows.length, ids: layer.slice(),
    });
    bottom = Math.max(bottom, lastBottom);
    y += NG.gapY - rowGap;                    // 层与层之间多留一点空白
  });

  return {
    place,
    bands,
    edges: kept,
    width: widest + NG.padX * 2,
    height: bottom + NG.padY,
  };
}

/* ── 模型：节点、边、关系闭包 ─────────────────────────── */

function buildModel() {
  const byId = new Map((DATA.nodes || []).map((node) => [node.id, node]));
  const edges = (DATA.edges || []).filter(([from, to]) => byId.has(from) && byId.has(to));
  const parents = new Map();
  const children = new Map();
  for (const [from, to] of edges) {
    if (!parents.has(from)) parents.set(from, []);
    parents.get(from).push(to);
    if (!children.has(to)) children.set(to, []);
    children.get(to).push(from);
  }
  return { byId, edges, parents, children, layout: null };
}

/** 沿边一路走：up＝它的构成词素（祖先），down＝由它构成的词（后代） */
function closure(id, direction) {
  const map = direction === 'up' ? state.model.parents : state.model.children;
  const seen = new Set();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    for (const next of map.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function nodeHtml(node, place) {
  const glyph = node.glyph ? DATA.glyphs[node.glyph] : null;
  const size = 24;
  const title = `${node.zh}（${node.en}）· ${node.id} · 第 ${node.layer} 层`
    + (node.pending ? ' · 待补词条' : '')
    + (node.issues && node.issues.length ? `\n⚠ ${node.issues.join('；')}` : '');
  const glyphHtml = glyph
    ? `<g transform="translate(6 ${(place.h - size) / 2})">`
      + `<svg class="node__glyph" width="${size}" height="${size}" viewBox="${glyph.vb}" `
      + `shape-rendering="crispEdges" aria-hidden="true">${glyph.inner}</svg></g>`
    : `<text class="node__glyph node__none" x="${6 + size / 2}" y="${place.h / 2}" `
      + 'text-anchor="middle" dominant-baseline="central">?</text>';
  return `<g class="node ${(node.flags || []).join(' ')}" data-id="${esc(node.id)}" `
    + `transform="translate(${place.x} ${place.y})">`
    + `<rect class="node__box" width="${place.w}" height="${place.h}" rx="4"/>`
    + glyphHtml
    + `<text class="node__label" x="${6 + size + 6}" y="${place.h / 2}" `
    + `dominant-baseline="central">${esc(fitLabel(node.zh, (place.w - size - 22) / 12))}</text>`
    + `<title>${esc(title)}</title></g>`;
}

function edgeHtml(from, to, place) {
  const a = place.get(from);
  const b = place.get(to);
  if (!a || !b) return '';
  const x1 = a.x + a.w / 2;
  const y1 = a.y;
  const x2 = b.x + b.w / 2;
  const y2 = b.y + b.h;
  const k = Math.max(16, (y1 - y2) * 0.45);
  return `<path class="edge" data-from="${esc(from)}" data-to="${esc(to)}" `
    + `d="M${x1} ${y1}C${x1} ${y1 - k} ${x2} ${y2 + k} ${x2} ${y2}"/>`;
}

function passFilters(node, focusSet) {
  const flags = node.flags || [];
  if (state.hideIsolated && flags.includes('is-isolated')) return false;
  if (state.hideNonword && flags.includes('is-nonword')) return false;
  if (state.onlyIssues && !(node.issues || []).length) return false;
  if (state.focus && focusSet && !focusSet.has(node.id)) return false;
  return true;
}

/** 按当前筛选重算布局并重画 SVG（选中/搜索只加类，不必重排） */
function draw() {
  const model = state.model;
  const focusSet = state.focusedId
    ? new Set([state.focusedId, ...closure(state.focusedId, 'up'), ...closure(state.focusedId, 'down')])
    : null;
  const visible = (DATA.nodes || []).filter((node) => passFilters(node, focusSet));
  const layout = layoutGraph(visible, model.edges, { perRow: (DATA.stats && DATA.stats.perRow) || 0 });
  model.layout = layout;

  const bands = layout.bands.map((band) => {
    const count = band.count ? `${band.count} 个` : '';
    const rows = band.rows > 1 ? `（${band.rows} 行）` : '';
    return `<g class="band"><rect class="band__bg" x="0" y="${band.y - 26}" `
      + `width="${layout.width}" height="${band.bottom - band.y + 52}"/>`
      + `<text class="band__label" x="10" y="${band.y + NG.h / 2}" dominant-baseline="central">`
      + `第 ${band.index} 层 · ${count}${rows}</text></g>`;
  }).join('');

  const edges = layout.edges.map(([from, to]) => edgeHtml(from, to, layout.place)).join('');
  const nodes = visible.map((node) => {
    const place = layout.place.get(node.id);
    return place ? nodeHtml(node, place) : '';
  }).join('');

  const svg = document.getElementById('graph');
  svg.innerHTML = `<g class="viewport">${bands}${edges}${nodes}</g>`;
  state.viewport = svg.querySelector('.viewport');

  applySelection();
  applyMatches();
  applyView();
  renderCounts();
}

/* ── 视图：平移、缩放、层级细节 ───────────────────────── */

function stageSize() {
  const stage = document.getElementById('stage');
  return { w: stage.clientWidth, h: stage.clientHeight };
}

function applyView() {
  const { view, viewport } = state;
  if (viewport) viewport.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.scale})`);
  const stage = document.getElementById('stage');
  stage.classList.toggle('is-far', view.scale < LOD_FAR);
  stage.classList.toggle('is-huge', view.scale < LOD_MIN);
  const info = document.getElementById('zoom-info');
  if (info) info.textContent = `${Math.round(view.scale * 100)}%`;
}

function zoomAt(px, py, factor) {
  const view = state.view;
  const scale = clamp(view.scale * factor, ZOOM.min, ZOOM.max);
  if (scale === view.scale) return;
  view.tx = px - (px - view.tx) * (scale / view.scale);
  view.ty = py - (py - view.ty) * (scale / view.scale);
  view.scale = scale;
  applyView();
}

function zoomCenter(factor) {
  const size = stageSize();
  zoomAt(size.w / 2, size.h / 2, factor);
}

function fitView() {
  const layout = state.model.layout;
  if (!layout || !layout.place.size) return;
  const places = [...layout.place.values()];
  const minX = Math.min(...places.map((p) => p.x));
  const maxX = Math.max(...places.map((p) => p.x + p.w));
  const minY = Math.min(...places.map((p) => p.y));
  const maxY = Math.max(...places.map((p) => p.y + p.h));
  const { w, h } = stageSize();
  const scale = clamp(Math.min((w - 90) / (maxX - minX), (h - 90) / (maxY - minY)), ZOOM.min, 1.5);
  state.view.scale = scale;
  state.view.tx = w / 2 - ((minX + maxX) / 2) * scale;
  state.view.ty = h / 2 - ((minY + maxY) / 2) * scale;
  applyView();
}

function centerOn(id) {
  const place = state.model.layout && state.model.layout.place.get(id);
  if (!place) return;
  const { w, h } = stageSize();
  const scale = state.view.scale < 0.75 ? 1 : state.view.scale;
  state.view.scale = scale;
  state.view.tx = w / 2 - (place.x + place.w / 2) * scale;
  state.view.ty = h / 2 - (place.y + place.h / 2) * scale;
  applyView();
}

/* ── 选中 / 搜索的加类 ───────────────────────────────── */

function applySelection() {
  const svg = document.getElementById('graph');
  const nodes = svg.querySelectorAll('.node');
  const edges = svg.querySelectorAll('.edge');
  for (const el of nodes) el.classList.remove('is-selected', 'is-up', 'is-down', 'is-dim');
  for (const el of edges) el.classList.remove('is-on', 'is-dim');
  const id = state.selected;
  if (!id || !state.model.byId.has(id)) return;
  const up = closure(id, 'up');
  const down = closure(id, 'down');
  for (const el of nodes) {
    const nid = el.getAttribute('data-id');
    if (nid === id) el.classList.add('is-selected');
    else if (up.has(nid)) el.classList.add('is-up');
    else if (down.has(nid)) el.classList.add('is-down');
    else el.classList.add('is-dim');
  }
  for (const el of edges) {
    const from = el.getAttribute('data-from');
    const to = el.getAttribute('data-to');
    if (from === id || to === id) el.classList.add('is-on');
    else if (up.has(from) && up.has(to)) el.classList.add('is-on');
    else if (down.has(from) && (down.has(to) || to === id)) el.classList.add('is-on');
    else el.classList.add('is-dim');
  }
}

function applyMatches() {
  const svg = document.getElementById('graph');
  if (!svg) return;
  for (const el of svg.querySelectorAll('.node.is-match')) el.classList.remove('is-match');
  if (!state.matches.length) return;
  const hit = new Set(state.matches.map((node) => node.id));
  for (const el of svg.querySelectorAll('.node')) {
    if (hit.has(el.getAttribute('data-id'))) el.classList.add('is-match');
  }
}

/** 顶栏的统计：现在画了多少、匹配多少（顺带重画左栏） */
function renderCounts() {
  const model = state.model;
  const drawn = model.layout ? model.layout.place.size : 0;
  const total = (DATA.nodes || []).length;
  const info = document.getElementById('drawn-info');
  if (info) {
    info.textContent = `画出 ${drawn} / ${total} 词`
      + ` · 声明 ${model.layout ? model.layout.edges.length : 0} 条`
      + (state.matches.length ? ` · 匹配 ${state.matches.length}` : '');
  }
  renderPanel();
}

/* ── 左栏：词条详情 / 问题清单 / 匹配 ───────────────────── */

function wordChip(id) {
  const word = DATA.words[id] || { zh: id, en: '', pending: true };
  const glyph = word.glyph ? DATA.glyphs[word.glyph] : null;
  const inner = glyph
    ? `<svg class="chip__glyph" width="20" height="20" viewBox="${glyph.vb}" `
      + `shape-rendering="crispEdges" aria-hidden="true">${glyph.inner}</svg>`
    : '<span class="chip__glyph chip__none">?</span>';
  const cls = ['chip'];
  if (word.pending) cls.push('chip--pending');
  if (!state.model.byId.has(id)) cls.push('chip--ghost');
  if (id === state.selected) cls.push('chip--on');
  return `<button type="button" class="${cls.join(' ')}" data-id="${esc(id)}" `
    + `title="${esc(`${word.zh}（${word.en || '?'}）· ${id}`)}">${inner}`
    + `<span>${esc(fitLabel(word.zh, 9))}</span></button>`;
}

/** 一行原文：token 数组，"" ＝一格空白 */
function chainHtml(tokens) {
  const parts = tokens.map((token) => (
    token === '' ? '<span class="chain__space"></span>' : wordChip(token)
  ));
  return `<span class="chain">${parts.join('')}</span>`;
}

function bigGlyph(node) {
  const glyph = node.glyph ? DATA.glyphs[node.glyph] : null;
  if (!glyph) return '<span class="big-glyph big-glyph--none">?</span>';
  return `<svg class="big-glyph" viewBox="${glyph.vb}" width="48" height="48" `
    + `shape-rendering="crispEdges" aria-hidden="true">${glyph.inner}</svg>`;
}

function section(title, body) {
  return `<section class="sec"><h3 class="sec__title">${esc(title)}</h3>`
    + `<div class="sec__body">${body}</div></section>`;
}

const FLAG_TEXT = {
  'is-base': '基础词素',
  'is-nonword': '非实义词素',
  'is-pending': '待补词条',
  'is-isolated': '未写构成（也不作词素）',
  'is-explicit': '显式 morphemes 字段',
  'is-no-compose': '被当作词素但没写构成',
  'has-issue': '有问题',
};

function renderDetail() {
  const node = state.selected ? state.model.byId.get(state.selected) : null;
  const stats = DATA.stats || {};
  if (!node) {
    return '<p class="hint">点图中任一节点，看它的词条与构成关系；上面的搜索框可以按中译 / 英文 / id 找词。</p>'
      + section('这张图怎么读',
        '<ul class="tips">'
        + '<li>上层是下层的<b>构成词素</b>：每条边＝一条「X morpheme be A and B」声明。</li>'
        + '<li>层号＝这个词往下拆几层能拆到「不再拆分」。</li>'
        + '<li>选中后：<span class="k k--up">蓝</span>＝它的词素，'
        + '<span class="k k--down">绿</span>＝由它构成的词。</li>'
        + '<li>双击节点＝只看它这一片关系网（再双击一次取消）。</li>'
        + '<li>滚轮缩放、拖动平移、<code>F</code> 适应视图、<code>Esc</code> 取消选中。</li>'
        + '</ul>')
      + section('数据',
        '<ul class="tips">'
        + `<li>词条 ${stats.words || 0} 个 · 写了构成的 ${stats.composed || 0} 个`
        + ` · 直接词素 ${stats.morphemes || 0} 个 · 基础词素 ${stats.base || 0} 个</li>`
        + `<li>层分布：${esc(Object.entries(stats.layers || {})
          .map(([layer, count]) => `第 ${layer} 层 ${count}`).join(' · '))}</li>`
        + `<li>问题 ${stats.issueCount || 0} 处（见「问题」页）</li>`
        + '</ul>');
  }

  const up = closure(node.id, 'up');
  const down = closure(node.id, 'down');
  const parts = [];

  parts.push(`<div class="detail__head">${bigGlyph(node)}<div class="detail__names">`
    + `<div class="detail__zh">${esc(node.zh)}</div>`
    + `<div class="detail__en">${esc(node.en || '（缺 en）')}</div>`
    + `<div class="detail__id">${esc(node.id)} · 第 ${node.layer} 层`
    + ` · 直接词素 ${node.morphemes.length} 个 · 被 ${down.size} 个词引用</div>`
    + '</div></div>');

  const flags = (node.flags || []).filter((flag) => FLAG_TEXT[flag]);
  if (flags.length) {
    parts.push(`<div class="badges">${flags.map((flag) => (
      `<span class="badge${flag === 'has-issue' ? ' badge--bad' : ''}">${esc(FLAG_TEXT[flag])}</span>`
    )).join('')}</div>`);
  }

  if ((node.issues || []).length) {
    parts.push(section('问题', `<ul class="issues">${node.issues.map((text) => (
      `<li>${esc(text)}</li>`
    )).join('')}</ul>`));
  }

  if ((node.decls || []).length) {
    parts.push(section(`词素声明（${node.decls.length}）`, node.decls.map((decl) => {
      const text = [decl.head || '(空)', 'morpheme', 'be', ...decl.morphemes].join(' ');
      const bad = decl.head !== node.id ? ' decl--bad' : '';
      const warns = [];
      if (decl.head !== node.id) warns.push(`首词是 ${decl.head || '(空)'}`);
      if (decl.morphemes.includes(node.id)) warns.push('把自己当词素');
      return `<div class="decl${bad}">`
        + `<div class="decl__text">${esc(text)}</div>`
        + `<div class="decl__note">第 ${decl.meaning + 1} 条义项`
        + (warns.length ? ` · ⚠ ${esc(warns.join('、'))}` : '') + '</div>'
        + `<div class="line">${decl.morphemes.length
          ? decl.morphemes.map(wordChip).join('')
          : '<span class="hint">（没写词素）</span>'}</div></div>`;
    }).join('')));
  }

  if ((node.base || []).length) {
    parts.push(section(`基础词素（递归拆到 ${node.base.length} 个）`,
      node.base.map((item) => wordChip(item.id)).join('')));
  }

  if ((node.alien || []).length) {
    parts.push(section('原文（词头）', node.alien.map((line) => (
      `<div class="line">${chainHtml(line)}</div>`
    )).join('')));
  }

  if ((node.meanings || []).length) {
    const declAt = new Set((node.decls || []).map((decl) => decl.meaning));
    parts.push(section(`义项（${node.meanings.length}）`, node.meanings.map((meaning, index) => {
      if (meaning.blank) return '<div class="line line--blank">（空行）</div>';
      const lines = meaning.lines.map((line) => `<div class="line">${chainHtml(line)}</div>`).join('');
      return '<div class="meaning">'
        + (declAt.has(index) ? '<div class="meaning__tag">词素声明</div>' : '')
        + lines + `<div class="meaning__zh">${esc(meaning.zh)}</div></div>`;
    }).join('')));
  }

  if (down.size) parts.push(section(`由它构成的词（${down.size}）`, [...down].map(wordChip).join('')));
  if (up.size) parts.push(section(`往上归到（${up.size}）`, [...up].map(wordChip).join('')));
  if ((node.notes || []).length) {
    parts.push(section('提示', node.notes.map((note) => (
      `<div class="note">${note.title ? `<b>${esc(note.title)}</b>` : ''}${esc(note.text)}</div>`
    )).join('')));
  }
  return parts.join('');
}

function renderIssues() {
  const groups = DATA.issues || [];
  if (!groups.length) return '<p class="hint">没有问题。</p>';
  return groups.map((group) => section(`${group.title}（${group.items.length}）`,
    `<ul class="problems">${group.items.map((item) => (
      `<li>${item.id
        ? `<button type="button" class="linklike" data-id="${esc(item.id)}">${esc(item.id)}</button> `
        : ''}${esc(item.text)}</li>`
    )).join('')}</ul>`)).join('');
}

function renderMatches() {
  if (!state.query.trim()) return '<p class="hint">在上面输入中译 / 英文 / id 找词；回车跳到第一个匹配。</p>';
  if (!state.matches.length) return '<p class="hint">没有匹配的词。</p>';
  return section(`匹配（${state.matches.length}）`, state.matches.map((node) => (
    `<button type="button" class="hit" data-id="${esc(node.id)}">`
    + `<span class="hit__zh">${esc(node.zh)}</span>`
    + `<span class="hit__id">${esc(node.id)}</span>`
    + `<span class="hit__layers">第 ${node.layer} 层</span></button>`
  )).join(''));
}

function renderPanel() {
  const body = document.getElementById('panel-body');
  if (!body) return;
  document.getElementById('tab-detail').classList.toggle('is-on', state.tab === 'detail');
  document.getElementById('tab-issues').classList.toggle('is-on', state.tab === 'issues');
  document.getElementById('tab-matches').classList.toggle('is-on', state.tab === 'matches');
  body.innerHTML = state.tab === 'detail' ? renderDetail()
    : state.tab === 'issues' ? renderIssues() : renderMatches();
}

/* ── 选中、搜索、筛选、交互 ──────────────────────────── */

function select(id, options = {}) {
  if (!state.model.byId.has(id)) return false;
  if (state.focus && state.focusedId && !insideFocus(id)) {
    state.focus = false;                    // 选到聚焦范围外：自动退出聚焦，免得选中了却看不见
    state.focusedId = null;
    syncOptions();
  }
  state.selected = id;
  draw();                                   // 聚焦模式下可见集合会变，走同一条重画路径
  if (options.center !== false) centerOn(id);
  return true;
}

function insideFocus(id) {
  if (!state.focusedId) return true;
  return id === state.focusedId
    || closure(state.focusedId, 'up').has(id)
    || closure(state.focusedId, 'down').has(id);
}

function clearSelection() {
  if (!state.selected && !state.focus) return;
  state.selected = null;
  state.focus = false;
  state.focusedId = null;
  syncOptions();
  draw();
}

/** 双击：只看这一个词的关系网（再双击一次取消） */
function toggleFocus(id) {
  if (state.focus && state.focusedId === id) {
    state.focus = false;
    state.focusedId = null;
  } else {
    state.selected = id;
    state.focus = true;
    state.focusedId = id;
  }
  syncOptions();
  draw();
  centerOn(id);
}

function runSearch() {
  const query = state.query.trim().toLowerCase();
  if (!query) { state.matches = []; return; }
  const scoreOf = (node) => {
    const zh = String(node.zh).toLowerCase();
    const en = String(node.en).toLowerCase();
    if (zh === query || en === query || node.id === query) return 0;
    if (zh.startsWith(query)) return 1;
    if (en.startsWith(query)) return 2;
    if (node.id.startsWith(query)) return 3;
    if (zh.includes(query)) return 4;
    if (en.includes(query)) return 5;
    return node.id.includes(query) ? 6 : -1;
  };
  state.matches = DATA.nodes
    .map((node) => [node, scoreOf(node)])
    .filter(([, score]) => score >= 0)
    .sort((a, b) => (a[1] - b[1]) || (a[0].layer - b[0].layer)
      || (a[0].id < b[0].id ? -1 : a[0].id > b[0].id ? 1 : 0))
    .map(([node]) => node);
}

function syncOptions() {
  document.getElementById('opt-isolated').checked = state.hideIsolated;
  document.getElementById('opt-nonword').checked = state.hideNonword;
  document.getElementById('opt-issues').checked = state.onlyIssues;
  document.getElementById('opt-focus').checked = state.focus;
}

function bindStage() {
  const stage = document.getElementById('stage');
  let drag = null;

  stage.addEventListener('pointerdown', (event) => {
    const hit = event.target.closest && event.target.closest('.node');
    drag = {
      x: event.clientX,
      y: event.clientY,
      tx: state.view.tx,
      ty: state.view.ty,
      id: hit ? hit.getAttribute('data-id') : null,
      moved: false,
    };
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    state.view.tx = drag.tx + dx;
    state.view.ty = drag.ty + dy;
    applyView();
  });

  stage.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const { moved, id } = drag;
    drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (moved) return;
    if (id) select(id, { center: false });
    else clearSelection();
  });
  stage.addEventListener('pointercancel', () => { drag = null; });

  stage.addEventListener('dblclick', (event) => {
    const hit = event.target.closest && event.target.closest('.node');
    if (hit) toggleFocus(hit.getAttribute('data-id'));
  });

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });
}

function bindPanel() {
  document.getElementById('panel-body').addEventListener('click', (event) => {
    const hit = event.target.closest && event.target.closest('[data-id]');
    if (hit) select(hit.getAttribute('data-id'));
  });
  document.getElementById('tabs').addEventListener('click', (event) => {
    const hit = event.target.closest && event.target.closest('[data-tab]');
    if (!hit) return;
    state.tab = hit.getAttribute('data-tab');
    renderPanel();
  });
}

function bindOptions() {
  const bind = (id, key) => document.getElementById(id).addEventListener('change', (event) => {
    state[key] = event.target.checked;
    if (key === 'focus') state.focusedId = event.target.checked ? state.selected : null;
    draw();
    if (key === 'focus' && state.focus && state.selected) centerOn(state.selected);
  });
  bind('opt-isolated', 'hideIsolated');
  bind('opt-nonword', 'hideNonword');
  bind('opt-issues', 'onlyIssues');
  bind('opt-focus', 'focus');

  document.getElementById('zoom-in').addEventListener('click', () => zoomCenter(1.25));
  document.getElementById('zoom-out').addEventListener('click', () => zoomCenter(0.8));
  document.getElementById('zoom-fit').addEventListener('click', fitView);

  const input = document.getElementById('q');
  input.addEventListener('input', () => {
    state.query = input.value;
    runSearch();
    const wanted = state.query.trim() ? 'matches' : 'detail';
    if (state.tab !== wanted) state.tab = wanted;
    draw();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !state.matches.length) return;
    state.tab = 'detail';
    select(state.matches[0].id);
  });
}

function bindKeys() {
  window.addEventListener('keydown', (event) => {
    const typing = /input|textarea|select/i.test(event.target.tagName || '');
    if (event.key === 'Escape') {
      if (typing) event.target.blur();
      clearSelection();
      return;
    }
    if (typing) return;
    if (event.key === 'f' || event.key === 'F') fitView();
    else if (event.key === '+' || event.key === '=') zoomCenter(1.25);
    else if (event.key === '-') zoomCenter(0.8);
  });
}

function init() {
  state.model = buildModel();
  bindStage();
  bindPanel();
  bindOptions();
  bindKeys();
  syncOptions();
  draw();
  fitView();

  // 深链：morpheme-graph.html#accelerate 直接选中那个词
  const hash = decodeURIComponent(String((window.location && window.location.hash) || '').replace(/^#/, ''));
  if (hash) select(hash);
}

if (typeof document !== 'undefined') init();


