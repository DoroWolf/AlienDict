/* 词素关系图 · 自检（内部脚本，只读）
 *
 * 把 out/morpheme-graph.html 里的内联数据与页面脚本拿出来跑一遍：
 *   1. 内联数据（payload）自洽：节点 / 边 / 词表 / 字形 / 原文 token 对得上；
 *   2. 布局是纯函数，直接调出来断言（不重不漏、行内不重叠、层序单调、边的方向朝上）；
 *   3. 用最小 DOM 桩把页面脚本 init() 真的跑一遍，看渲染与交互有没有炸。
 *
 * 用法：node tools/morpheme_graph.mjs && node tools/_check_graph.mjs
 */
import fs from 'node:fs';

const html = fs.readFileSync('out/morpheme-graph.html', 'utf8');

/* ── 1) 内联数据 ─────────────────────────────────────────── */

const dataMatch = /<script>window\.__MORPH_GRAPH__ = ([\s\S]*?);<\/script>/.exec(html);
if (!dataMatch) throw new Error('payload: 没找到内联数据');
const data = JSON.parse(dataMatch[1]);
console.log('数据：nodes', data.nodes.length, 'edges', data.edges.length,
  'glyphs', Object.keys(data.glyphs).length, 'words', Object.keys(data.words).length,
  'issues', data.issues.reduce((sum, group) => sum + group.items.length, 0));

const ids = new Set(data.nodes.map((node) => node.id));
const layerOf = new Map(data.nodes.map((node) => [node.id, node.layer]));
for (const [from, to] of data.edges) {
  if (!ids.has(from) || !ids.has(to)) throw new Error(`payload: 边指向了不存在的节点 ${from} -> ${to}`);
  if (!(layerOf.get(from) > layerOf.get(to))) {
    throw new Error(`payload: 层号不单调 ${from}(${layerOf.get(from)}) -> ${to}(${layerOf.get(to)})`);
  }
}
let tokens = 0;
for (const node of data.nodes) {
  for (const line of [...node.alien, ...node.meanings.flatMap((meaning) => meaning.lines || [])]) {
    for (const token of line) {
      if (token === '') continue;
      tokens += 1;
      if (!data.words[token]) throw new Error(`payload: 词表里少了 token ${token}`);
      const glyph = data.words[token].glyph;
      if (glyph && !data.glyphs[glyph]) throw new Error(`payload: 字形没内联 ${glyph}`);
    }
  }
  if (node.glyph && !data.glyphs[node.glyph]) throw new Error(`payload: 节点字形没内联 ${node.id}`);
}
console.log('原文 token', tokens, '个，词表与字形齐全');

/* ── 2) 页面脚本：语法 + 布局 ────────────────────────────── */

const scripts = [...html.matchAll(/<script>\n?([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (scripts.length !== 2) throw new Error(`页面里应当正好两段内联脚本，实际 ${scripts.length} 段`);
const app = scripts[1];
const layoutApi = new Function(`${app}\nreturn { layoutGraph, fitLabel, textUnits };`)();
const { layoutGraph, fitLabel, textUnits } = layoutApi;

const layout = layoutGraph(data.nodes, data.edges, { perRow: data.stats.perRow });
if (layout.place.size !== data.nodes.length) {
  throw new Error(`布局漏了节点：${layout.place.size} / ${data.nodes.length}`);
}
for (const [id, place] of layout.place) {
  for (const key of ['x', 'y', 'w', 'h']) {
    if (!Number.isFinite(place[key])) throw new Error(`布局：${id} 的 ${key} 不是有限数`);
  }
}
for (const band of layout.bands) {
  if (band.bottom < band.y) throw new Error(`布局：第 ${band.index} 层的 band 高度不对`);
  const rows = new Map();
  for (const id of band.ids) {
    const place = layout.place.get(id);
    if (!rows.has(place.y)) rows.set(place.y, []);
    rows.get(place.y).push([id, place.x]);
  }
  for (const [y, row] of rows) {
    row.sort((a, b) => a[1] - b[1]);
    for (let i = 1; i < row.length; i += 1) {
      const w = layout.place.get(row[i][0]).w;
      if (row[i][1] - row[i - 1][1] < w) throw new Error(`布局：重叠 ${row[i - 1][0]} / ${row[i][0]}`);
    }
    if (data.stats.perRow > 0 && row.length > data.stats.perRow) {
      throw new Error(`布局：第 ${band.index} 层 y=${y} 的行超过 perRow`);
    }
  }
}
for (let i = 1; i < layout.bands.length; i += 1) {
  if (!(layout.bands[i].y > layout.bands[i - 1].bottom)) throw new Error('布局：层的上下顺序不对');
}
for (const [from, to] of layout.edges) {
  if (!(layout.place.get(from).y > layout.place.get(to).y)) {
    throw new Error(`布局：边的方向应当朝上（${from} -> ${to}）`);
  }
}
console.log('布局：', `${Math.round(layout.width)}×${Math.round(layout.height)}px ·`,
  layout.bands.map((band) => `第${band.index}层 ${band.count}（${band.rows} 行）`).join(' / '));
console.log('fitLabel("加速度") =', fitLabel('加速度', 8), '| 超长截断 =', fitLabel('一二三四五六七八九十甲乙丙', 8),
  '| textUnits("加速度") =', textUnits('加速度'));

/* ── 3) 最小 DOM 桩：够跑页面脚本的 init() ───────────────── */

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.classes = new Set();
    this.listeners = {};
    this.children = [];
    this._html = '';
    this.textContent = '';
    this.checked = false;
    this.clientWidth = 1600;
    this.clientHeight = 800;
    const self = this;
    this.classList = {
      add: (...names) => names.forEach((name) => self.classes.add(name)),
      remove: (...names) => names.forEach((name) => self.classes.delete(name)),
      contains: (name) => self.classes.has(name),
      toggle: (name, on) => (on ? self.classes.add(name) : self.classes.delete(name)),
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value); this.children = parseChildren(this._html); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] === undefined ? null : this.attrs[key]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, event) { for (const fn of this.listeners[type] || []) fn(event); }
  querySelector(sel) { return this.match(sel)[0] || null; }
  querySelectorAll(sel) { return this.match(sel); }
  closest(sel) { return matches(this, sel) ? this : null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  match(sel) {
    const parts = String(sel).split(',').map((part) => part.trim()).filter(Boolean);
    return this.children.filter((child) => parts.some((part) => matches(child, part)));
  }
}

/** 只支持 .a.b 这种选择器（页面脚本里用的就是这些） */
function matches(el, selector) {
  const parts = String(selector).split('.').filter(Boolean);
  return parts.length > 0 && parts.every((name) => el.classes.has(name));
}

/** 把 SVG 字符串里的节点 / 边 / viewport 解析成可断言的桩元素 */
function parseChildren(html) {
  const out = [];
  for (const match of html.matchAll(/<g class="([^"]*)" data-id="([^"]*)"/g)) {
    const el = new El('g');
    match[1].split(/\s+/).filter(Boolean).forEach((name) => el.classes.add(name));
    el.attrs['data-id'] = match[2];
    out.push(el);
  }
  for (const match of html.matchAll(/<path class="([^"]*)" data-from="([^"]*)" data-to="([^"]*)"/g)) {
    const el = new El('path');
    match[1].split(/\s+/).filter(Boolean).forEach((name) => el.classes.add(name));
    el.attrs['data-from'] = match[2];
    el.attrs['data-to'] = match[3];
    out.push(el);
  }
  if (html.includes('class="viewport"')) {
    const el = new El('g');
    el.classes.add('viewport');
    out.push(el);
  }
  for (const _band of html.matchAll(/<g class="band">/g)) {
    const el = new El('g');
    el.classes.add('band');
    out.push(el);
  }
  return out;
}

const elements = new Map();
const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new El('div'));
    return elements.get(id);
  },
  createElement: (tag) => new El(tag),
};
const windowStub = { __MORPH_GRAPH__: data, location: { hash: '' }, addEventListener() {} };

// 页面脚本是普通脚本：把 document / window 当参数传进去，init() 会在求值时自己跑
const ui = new Function('document', 'window',
  `${app}\nreturn { state, select, draw, runSearch, toggleFocus, clearSelection };\n`)
(documentStub, windowStub);

const graph = documentStub.getElementById('graph');
const panel = () => documentStub.getElementById('panel-body').innerHTML;
const count = (sel) => graph.querySelectorAll(sel).length;
const nodeEl = (id) => graph.querySelectorAll('.node').find((el) => el.getAttribute('data-id') === id);

/* ── 4) 初始渲染 ─────────────────────────────────────────── */

if (count('.node') !== data.nodes.length) throw new Error(`初始渲染节点数不对：${count('.node')}`);
if (count('.edge') !== data.edges.length) throw new Error(`初始渲染边数不对：${count('.edge')}`);
if (count('.band') !== layout.bands.length) throw new Error(`层带数不对：${count('.band')}`);
const drawnInfo = documentStub.getElementById('drawn-info').textContent;
if (!/画出 \d+ \/ \d+ 词/.test(drawnInfo)) throw new Error('顶栏统计没写出来');
if (!panel().includes('这张图怎么读')) throw new Error('没选中时左栏应显示说明');
if (!/^\d+%$/.test(documentStub.getElementById('zoom-info').textContent)) throw new Error('缩放比例没显示');
console.log('初始渲染：节点', count('.node'), '边', count('.edge'), '层带', count('.band'), '|', drawnInfo);

/* ── 5) 交互：选中 / 点击 / 拖动 / 搜索 / 聚焦 / 筛选 / 左栏 ── */

ui.select('acceleration');
const selected = graph.querySelectorAll('.node.is-selected');
if (selected.length !== 1 || selected[0].getAttribute('data-id') !== 'acceleration') {
  throw new Error('选中没生效');
}
const ups = count('.node.is-up');
const downs = count('.node.is-down');
const dims = count('.node.is-dim');
if (ups + downs + 1 + dims !== data.nodes.length) throw new Error('淡出的节点数对不上');
if (!panel().includes('词素声明')) throw new Error('左栏没显示词素声明');
if (!panel().includes('加速')) throw new Error('左栏没显示词素');
console.log('选中 acceleration：词素', ups, '个 · 由它构成', downs, '个 · 淡出', dims, '个');

const stage = documentStub.getElementById('stage');
const click = (target, moved) => {
  const event = { target, clientX: 10, clientY: 10, pointerId: 1 };
  stage.dispatch('pointerdown', event);
  if (moved) stage.dispatch('pointermove', { ...event, clientX: 70, clientY: 50 });
  stage.dispatch('pointerup', { ...event, clientX: moved ? 70 : 10, clientY: moved ? 50 : 10 });
};

click(nodeEl('accelerate'), false);
if (ui.state.selected !== 'accelerate') throw new Error(`点击没选中：${ui.state.selected}`);
console.log('点击节点：选中了', ui.state.selected);

const before = graph.querySelector('.viewport').getAttribute('transform');
click(nodeEl('accelerate'), true);
if (ui.state.selected !== 'accelerate') throw new Error('拖动不该改选中');
const after = graph.querySelector('.viewport').getAttribute('transform');
if (before === after || !/^translate\(/.test(after)) throw new Error(`平移没写进 transform：${before} -> ${after}`);
console.log('拖动平移：', after);

ui.state.query = '加速度';
ui.runSearch();
ui.draw();                       // 真实路径：输入框的 input 事件里就是 runSearch() + draw()
if (!ui.state.matches.length) throw new Error('搜索没命中');
if (count('.node.is-match') !== ui.state.matches.length) {
  throw new Error(`高亮的匹配数不对：${count('.node.is-match')} / ${ui.state.matches.length}`);
}
console.log('搜索「加速度」命中', ui.state.matches.length, '个：',
  ui.state.matches.map((node) => node.id).slice(0, 5).join('、'));

ui.toggleFocus('acceleration');
const focused = count('.node');
if (focused >= data.nodes.length) throw new Error('聚焦后节点数没变少');
if (!documentStub.getElementById('opt-focus').checked) throw new Error('聚焦勾选框没同步');
console.log('聚焦 acceleration：只画', focused, '个节点（共', data.nodes.length, '）');

ui.toggleFocus('acceleration');
ui.clearSelection();
if (count('.node') !== data.nodes.length) throw new Error('退出聚焦后节点数没回来');

const optIsolated = documentStub.getElementById('opt-isolated');
optIsolated.checked = true;
optIsolated.dispatch('change', { target: optIsolated });
const isolated = data.nodes.filter((node) => (node.flags || []).includes('is-isolated')).length;
if (count('.node') !== data.nodes.length - isolated) throw new Error(`隐藏未写构成后节点数不对：${count('.node')}`);
console.log('勾选「隐藏未写构成」：', count('.node'), '个（少了', isolated, '个）');

const optIssues = documentStub.getElementById('opt-issues');
optIsolated.checked = false;                 // 先把「隐藏未写构成」关掉，免得两个筛选叠在一起
optIsolated.dispatch('change', { target: optIsolated });
optIssues.checked = true;
optIssues.dispatch('change', { target: optIssues });
const withIssues = data.nodes.filter((node) => (node.issues || []).length).length;
if (count('.node') !== withIssues) throw new Error(`只看有问题：${count('.node')} / ${withIssues}`);
console.log('勾选「只看有问题」：', count('.node'), '个');

ui.state.onlyIssues = false;
ui.state.hideIsolated = false;
ui.state.tab = 'issues';
ui.draw();
if (!panel().includes('没写构成，也不作别人的词素')) throw new Error('问题页没渲染');
console.log('问题页：', panel().length, '字节');

ui.state.query = '加速度';
ui.state.tab = 'matches';
ui.runSearch();
ui.draw();
if (!panel().includes('匹配（')) throw new Error('匹配页没渲染');
if (!panel().includes('data-id="acceleration"')) throw new Error('匹配页里没有可点的词');
console.log('匹配页：', panel().length, '字节');

console.log('全部检查通过');


