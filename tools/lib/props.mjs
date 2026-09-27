/* 外星词典 · 页面数据（Node 侧）
 *
 * 把数据层（lexicon.mjs + glyphs.mjs）整理成「Vue 组件直接渲染」的 props：
 * 页面只带自己用得到的字形数据，客户端水合时读的就是这份 props（构建时同时给
 * 预渲染与页面内联，见 tools/build.mjs）。
 */
import { readLexicon, loadEntries, sortEntries, morphemeIndex, collectPending, baseMorphemesOf, gloss,
  isBaseMorpheme, isNonword, MORPHEME_COLUMNS } from './lexicon.mjs';
import { loadGlyphs } from './glyphs.mjs';

/** 读全部数据（词条 / 词素索引 / 待补词条 / 字形），一次构建只做一次 */
export function loadSite() {
  const warnings = [];
  const site = readLexicon();
  const entries = loadEntries(warnings);
  const ordered = sortEntries(entries);
  const pending = collectPending(entries);
  const morphs = morphemeIndex(ordered, entries);
  const { glyphs, pngs, svgCount, pngCount } = loadGlyphs();
  return { site, entries, ordered, pending, morphs, glyphs, pngs, svgCount, pngCount, warnings };
}

/** 每页各自收集用到的词与字形（页面只内联自己需要的那点数据） */
function makeCtx(data, root) {
  return { data, root, words: {}, glyphs: {} };
}

/** 一个词（原文里的 token / 词素徽章）在本页的引用：字形、释义、链接 */
function wordRef(ctx, id) {
  if (ctx.words[id]) return;
  const entry = ctx.data.entries[id];
  const glyphName = entry ? entry.glyph : id;
  const svg = ctx.data.glyphs[glyphName];
  const png = !svg && ctx.data.pngs.has(glyphName);
  if (svg) ctx.glyphs[glyphName] = svg;
  ctx.words[id] = {
    key: id,
    label: entry ? gloss(entry) : id,                       // 中英释义（工具提示 / 读屏文案）
    zh: entry ? entry.zh : id,
    href: entry ? `${ctx.root}w/${id}.html` : null,         // 没有词条的词：只显示字形
    pending: !entry,
    glyph: svg ? glyphName : null,
    png: png ? `${ctx.root}assets/glyph/${glyphName}.png` : null,
    missing: !svg && !png,                                  // 连字形文件都还没有
  };
}

/** 原文的行 → props（顺带登记每行用到的词与字形） */
function linesOf(ctx, lines) {
  for (const line of lines) {
    for (const token of line) if (!token.space) wordRef(ctx, token.id);
  }
  return lines;
}

/** 基础词素徽章的文案：释义 + 「经由 …」 */
function morphemeLabel(ctx, id, via = []) {
  const entry = ctx.data.entries[id];
  let label = entry ? gloss(entry) : `待补词条：${id}`;
  if (via.length) {
    label += ` · 经由 ${via.map((word) => {
      const parent = ctx.data.entries[word];
      return parent ? gloss(parent) : word;
    }).join('、')}`;
  }
  return label;
}

/** 词素徽章：{ id, label, href, pending, base }（可见文字只有中译，不带英文） */
function chip(ctx, id, via = []) {
  const entry = ctx.data.entries[id];
  wordRef(ctx, id);
  return {
    id,
    label: morphemeLabel(ctx, id, via),
    href: entry ? `${ctx.root}w/${id}.html` : null,
    pending: !entry,
    base: !!entry && isBaseMorpheme(entry),
  };
}

/** 目录页「按词素找词」的两栏：实义词素 / 非实义词素；每栏内部词多的在前，其次按字序 */
function morphemeColumns(data, ctx) {
  const order = new Map(data.ordered.map((entry, index) => [entry.id, index]));
  const buckets = { content: [], function: [] };
  for (const [morpheme, derived] of data.morphs) {
    const words = [...derived];
    if (data.entries[morpheme] && !words.includes(morpheme)) words.push(morpheme);
    const entry = data.entries[morpheme];
    const key = entry && isNonword(entry) ? 'function' : 'content';
    buckets[key].push({
      ...chip(ctx, morpheme),
      count: words.length,
      words,                       // 徽章上的数字＝含此词素的词数（含它自己）
    });
  }
  const rank = (id) => (order.has(id) ? order.get(id) : data.ordered.length);
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => (b.count - a.count)
      || (rank(a.id) - rank(b.id))
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return MORPHEME_COLUMNS.map(({ key, title }) => ({
    key,
    title,
    lead: '',
    chips: buckets[key],
  }));
}

/** 目录页 props */
export function buildIndexProps(data, options = {}) {
  const root = options.root ?? '';
  const ctx = makeCtx(data, root);
  const cards = data.ordered.map((entry) => {
    linesOf(ctx, entry.alien);
    return {
      id: entry.id,
      zh: entry.zh,
      en: entry.en,
      title: gloss(entry),
      href: `${root}w/${entry.id}.html`,
      search: `${entry.zh} ${entry.en} ${entry.id}`.toLowerCase(),
      lines: entry.alien,
    };
  });
  return {
    page: 'index',
    root,
    site: data.site,
    total: data.ordered.length,
    cards,
    morph: { total: data.morphs.size, columns: morphemeColumns(data, ctx) },
    pending: data.pending,
    words: ctx.words,
    glyphs: ctx.glyphs,
  };
}

/** 义项 → props：原文各行与译文各行一一对应；blank ＝空行分隔行
 *  （顺带登记原文里用到的词与字形，写作页的词条弹窗也用这一份） */
function meaningsOf(ctx, entry) {
  return entry.meanings.map((meaning) => {
    if (meaning.blank) return { blank: true };
    linesOf(ctx, meaning.alien);
    return { lines: meaning.alien, zh: meaning.zh };
  });
}

/** 写作页 props：全部词（按含义搜的搜索词 + 整条词条内容，供右键弹窗）+ 全部字形 */
export function buildWriteProps(data, options = {}) {
  const root = options.root ?? '';
  const ctx = makeCtx(data, root);
  const items = data.ordered.map((entry) => {
    wordRef(ctx, entry.id);
    return {
      id: entry.id,
      zh: entry.zh,
      en: entry.en,
      title: gloss(entry),
      search: `${entry.zh} ${entry.en} ${entry.id}`.toLowerCase(),   // 与目录页同一套搜索词
      meanings: meaningsOf(ctx, entry),   // 右键弹窗里的「词典内容及其翻译」
      notes: entry.notes,
    };
  });
  return {
    page: 'write',
    root,
    site: data.site,
    total: items.length,
    items,
    words: ctx.words,
    glyphs: ctx.glyphs,
  };
}

/** 词条页 props（没有这个词条时返回 null） */
export function buildEntryProps(data, id, options = {}) {
  const root = options.root ?? '../';
  const entry = data.entries[id];
  if (!entry) return null;
  const ctx = makeCtx(data, root);
  linesOf(ctx, entry.alien);

  // 义项：原文各行与译文各行一一对应；blank ＝空行分隔行
  const meanings = meaningsOf(ctx, entry);

  const index = data.ordered.findIndex((item) => item.id === id);
  const neighbor = (item) => (item ? { id: item.id, zh: item.zh, href: `${root}w/${item.id}.html` } : null);
  const morphBase = baseMorphemesOf(entry, data.entries).map(({ id: word, via }) => chip(ctx, word, via));

  return {
    page: 'entry',
    root,
    site: data.site,
    entry: {
      id: entry.id,
      zh: entry.zh,
      en: entry.en,
      title: `${entry.zh}${entry.en ? ` ${entry.en}` : ''} · ${data.site.title}`,
      description: `${entry.zh}${entry.en ? `（${entry.en}）` : ''} —— ${data.site.description}`,
      glyph: entry.glyph,
    },
    headLines: entry.alien,
    meanings,
    notes: entry.notes,
    morph: {
      morphemes: morphBase,
      base: isBaseMorpheme(entry),
      derived: (data.morphs.get(entry.id) || []).map((word) => chip(ctx, word)),
    },
    prev: index > 0 ? neighbor(data.ordered[index - 1]) : null,
    next: index + 1 < data.ordered.length ? neighbor(data.ordered[index + 1]) : null,
    words: ctx.words,
    glyphs: ctx.glyphs,
  };
}

/** 路由 → props（预渲染与 dev server 共用） */
export function propsForRoute(data, routePath) {
  const clean = String(routePath || '/').split('?')[0].split('#')[0];
  const entry = /\/w\/(.+)\.html$/.exec(clean);
  if (entry) return buildEntryProps(data, decodeURIComponent(entry[1]));
  if (/\/write\.html$/.test(clean)) return buildWriteProps(data, { root: '' });
  return buildIndexProps(data, { root: '' });
}
