/* 外星词典 · 数据层（Node 侧）
 *
 * 把 data/entries/*.yaml + data/lexicon.yaml 读成结构化词条，并推导词素索引。
 * 语义：
 *   · 原文写法：列表元素即一个词，元素 "" ＝一个空格；字符串里空格等价；"\n" ＝额外换一行。
 *   · 词与词之间不会自动补任何符号；每个词都是实义词（括号、数字都没有特殊含义）。
 *   · 词素句式「X morpheme be A and B」/「X morpheme be A」＝ X 由词素 A、B 构成
 *     （旧写法「X of morpheme be A and B」里的 `morpheme be` 同样命中）。
 *   · 基础词素：「X be base morpheme」，或整行以「X of morpheme be」收尾。
 *   · 「X be_not word」＝不是词（符号，如横线、角的形状），归入「非实义词素」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录 */
export const ROOT = path.resolve(HERE, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const ENTRY_DIR = path.join(DATA_DIR, 'entries');
export const LEXICON_FILE = path.join(DATA_DIR, 'lexicon.yaml');
export const GLYPH_DIR = path.join(ROOT, 'glyph');
export const SVG_DIR = path.join(GLYPH_DIR, 'svg');
export const DEFAULT_OUT = path.join(ROOT, 'site');

/** 空格 token：原文里的空位，空一个字符大小（元素 "" 与字符串里的空格都是它） */
export const SPACE = { space: true };

/** 词素句式标记：「X morpheme be A and B」/「X morpheme be A」＝ X 由词素 A、B 构成
 *  （旧写法「X of morpheme be A and B」里的 `morpheme be` 同样命中，故老数据不用改） */
const MORPHEME_MARK = ['morpheme', 'be'];
/** 基础词素句式：旧写法「X be base morpheme」 */
const BASE_MARK = ['base', 'morpheme'];
/** 基础词素句式（新写法）：整行以「X of morpheme be」收尾，后面不跟词素 */
const BASE_TAIL = ['of', 'morpheme', 'be'];
/** 非词句式：「X be_not word」＝ X 不是词（符号，如横线、角的形状） */
const NONWORD_MARK = ['be_not', 'word'];
/** 词素之间的连接词：不算词素 */
const CONNECTORS = ['and', 'or'];

/** 目录页「按词素找词」的两栏：实义词素 / 非实义词素（原文写明「X 不是词」的符号） */
export const MORPHEME_COLUMNS = [
  { key: 'content', title: '实义词素' },
  { key: 'function', title: '非实义词素' },
];

/** 一行原文 → token 列表：词是 { id }，空格是 SPACE */
export function scanLine(text) {
  const tokens = [];
  for (const chunk of text.match(/\s+|\S+/g) || []) {
    if (/^\s+$/.test(chunk)) {
      for (let i = 0; i < chunk.length; i += 1) tokens.push(SPACE);
      continue;
    }
    tokens.push({ id: chunk });
  }
  return tokens;
}

/** 原文 → 「行 → token」两层列表；空行（额外换一行）保留成空列表。
 *
 *  显式换行（`\n`）只是另起一行，行首不补空格；放不下时浏览器自动折行的那一行，
 *  行首要空一个单位 —— 那是排版层的事（见 web/src/styles/app.css 里的 .gl：
 *  整行左内边距留一格，再用负缩进把第一行拉回去）。
 */
export function parseAlien(value) {
  if (value === null || value === undefined) return [];
  const elements = typeof value === 'string' || typeof value === 'number' ? [value] : value;
  const lines = [[]];
  for (const element of elements) {
    const text = String(element).replace(/\r\n|\r/g, '\n').replace(/\t/g, ' ');
    if (!text) {
      lines[lines.length - 1].push(SPACE);   // 空元素＝一个空格
      continue;
    }
    text.split('\n').forEach((chunk, index) => {
      if (index) lines.push([]);             // 换行＝额外换一行
      lines[lines.length - 1].push(...scanLine(chunk));
    });
  }
  while (lines.length && !lines[0].length) lines.shift();
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

/** 含义是否只是一次「额外换一行」（即空行分隔行，无原文、无译文） */

function normalizeNotes(entry, warnings) {
  const value = entry.notes;
  if (value === null || value === undefined || value === '') return [];
  const items = typeof value === 'string' || (typeof value === 'object' && !Array.isArray(value))
    ? [value]
    : value;
  const result = [];
  items.forEach((item, index) => {
    let title = '';
    let text = '';
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      title = String(item.title || '');
      text = String(item.text || item.zh || '');
    } else if (['string', 'number', 'boolean'].includes(typeof item)) {
      text = String(item);
    } else {
      warnings.push(`${entry.file}：第 ${index + 1} 条提示格式不对（应为一段文字或 title/text 映射）`);
      return;
    }
    if (!text.trim()) {
      warnings.push(`${entry.file}：第 ${index + 1} 条提示是空的`);
      return;
    }
    result.push({ title, text });
  });
  return result;
}

function normalizeMeanings(entry, warnings) {
  const result = [];
  (entry.meanings || []).forEach((item, index) => {
    if (isBreakOnly(item)) {
      result.push({ alien: [], zh: '', blank: true });
      return;
    }
    if (typeof item === 'string') {
      result.push({ alien: [], zh: item, blank: false });
      return;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const zh = String(item.zh || '');
      if (!zh) warnings.push(`${entry.file}：第 ${index + 1} 条含义缺 zh`);
      result.push({ alien: parseAlien(item.alien), zh, blank: false });
      return;
    }
    warnings.push(`${entry.file}：第 ${index + 1} 条含义格式不对（应为字符串或 alien/zh 映射）`);
  });
  return result;
}

/** 中英释义：中文（英文），缺一边时只给有的那边 */
export function gloss(entry) {
  if (!entry) return '';
  const zh = String(entry.zh || '');
  const en = String(entry.en || '');
  return zh && en ? `${zh}（${en}）` : zh || en || entry.id;
}

/** 站点级设定：标题 / 描述 / 语言 */
export function readLexicon() {
  const raw = YAML.parse(fs.readFileSync(LEXICON_FILE, 'utf8')) || {};
  return {
    title: raw.title || '外星词典',
    description: raw.description || '',
    lang: raw.lang || 'zh-CN',
  };
}

/** 读 data/entries/*.yaml → { id: entry }（顺带收集警告） */
export function loadEntries(warnings = []) {
  const entries = {};
  const files = fs.readdirSync(ENTRY_DIR).filter((name) => name.endsWith('.yaml')).sort();
  for (const name of files) {
    const raw = YAML.parse(fs.readFileSync(path.join(ENTRY_DIR, name), 'utf8')) || {};
    const id = String(raw.id || name.replace(/\.yaml$/, ''));
    if (entries[id]) throw new Error(`词条 id 重复：${id}（${name}）`);
    const entry = {
      id,
      file: name,
      // 字形文件名与 id / 英文释义解耦：缺省同名，需要时用 glyph 单独指定
      glyph: String(raw.glyph || id),
      zh: String(raw.zh || id),
      en: String(raw.en || ''),
      order: raw.order,
      morphemes: raw.morphemes,
    };
    if (!entry.en) warnings.push(`${name}：缺 en（英文释义）`);
    entry.alien = parseAlien(raw.alien);
    if (!entry.alien.length) entry.alien = [[{ id, link: true }]];
    entry.notes = normalizeNotes({ ...raw, file: name }, warnings);
    entry.meanings = normalizeMeanings({ ...raw, file: name }, warnings);
    checkMorphemeLines(entry, warnings);
    entries[id] = entry;
  }
  if (!Object.keys(entries).length) throw new Error(`没有词条：${ENTRY_DIR} 下没有 *.yaml`);

  const seen = {};
  for (const entry of Object.values(entries)) {
    if (Number.isInteger(entry.order)) {
      (seen[entry.order] = seen[entry.order] || []).push(entry.id);
    } else if (entry.order !== null && entry.order !== undefined) {
      warnings.push(`${entry.file}：order 不是整数（${entry.order}）`);
    }
  }
  for (const [order, ids] of Object.entries(seen)) {
    if (ids.length > 1) warnings.push(`字序 ${order} 被多个词条占用：${ids.join('、')}`);
  }
  return entries;
}

function isBreakOnly(item) {
  if (typeof item === 'string') return !item.trim();
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (item.zh) return false;
  return item.alien !== null && item.alien !== undefined && !parseAlien(item.alien).length;
}

/** 按字序排（没写 order 的按 id 排在后面） */
export function sortEntries(entries) {
  return Object.values(entries).sort((a, b) => {
    const ao = Number.isInteger(a.order) ? 0 : 1;
    const bo = Number.isInteger(b.order) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (ao === 0 && a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 原文 → 每行的词 id 列表（丢掉空格 token） */
export function wordsOf(lines) {
  return lines.map((line) => line.filter((t) => !t.space).map((t) => t.id));
}

/** 词素声明：把原文里的「X morpheme be A and B」逐句解析出来（校对工具用）。
 *  head＝句式首词（正常应等于本词 id），morphemes＝标记之后的词（去掉连接词 and/or），
 *  words＝整行词，meaning/line＝出自第几条含义的第几行。morphemesOf 只取词素名，这里连句式一起给。 */
export function morphemeDeclarations(entry) {
  const result = [];
  entry.meanings.forEach((meaning, index) => {
    wordsOf(meaning.alien).forEach((words, line) => {
      const at = words.findIndex((word, i) => word === MORPHEME_MARK[0] && words[i + 1] === MORPHEME_MARK[1]);
      if (at < 0) return;
      result.push({
        meaning: index,
        line,
        head: words[0] || '',
        words,
        morphemes: words.slice(at + MORPHEME_MARK.length).filter((word) => !CONNECTORS.includes(word)),
      });
    });
  });
  return result;
}

/** 该词由哪些词素构成（句式「X morpheme be A and B」；也可用 morphemes: [...] 显式指定） */
export function morphemesOf(entry) {
  const explicit = entry.morphemes;
  if (explicit !== null && explicit !== undefined) {
    const list = typeof explicit === 'string' ? [explicit] : explicit;
    return list.map((w) => String(w).trim()).filter(Boolean);
  }
  const result = [];
  for (const declaration of morphemeDeclarations(entry)) {
    for (const token of declaration.morphemes) {
      if (token === entry.id || result.includes(token)) continue;
      result.push(token);
    }
  }
  return result;
}

function endsWith(words, tail) {
  if (words.length < tail.length) return false;
  return tail.every((word, index) => words[words.length - tail.length + index] === word);
}

/** 基础词素：「X be base morpheme」或「X of morpheme be」（后面不跟词素） */
export function isBaseMorpheme(entry) {
  return entry.meanings.some((meaning) => wordsOf(meaning.alien)
    .some((words) => endsWith(words, BASE_MARK) || endsWith(words, BASE_TAIL)));
}

/** 「X be_not word」＝不是词（符号，如横线、角的形状） */
export function isNonword(entry) {
  return entry.meanings.some((meaning) => wordsOf(meaning.alien).some((words) => endsWith(words, NONWORD_MARK)));
}

/** 本词最终由哪些基础词素构成 → [{ id, via, label }]（via＝经由哪个词素拆出来的） */
export function baseMorphemesOf(entry, entries) {
  const result = [];
  const seen = new Set();

  function walk(word, via, path) {
    const sub = entries[word];
    const inner = sub ? morphemesOf(sub) : [];
    if (!sub || isBaseMorpheme(sub) || !inner.length || path.has(word)) {
      if (!seen.has(word)) {
        seen.add(word);
        result.push({ id: word, via });
      }
      return;
    }
    const deeper = [...via, word];
    const nextPath = new Set(path).add(word);
    for (const child of inner) walk(child, deeper, nextPath);
  }

  for (const morpheme of morphemesOf(entry)) walk(morpheme, [], new Set([entry.id]));
  return result;
}

/** 基础词素 → 最终由它构成的词（按字序），「按词素找词」的反向索引 */
export function morphemeIndex(ordered, entries) {
  const index = new Map();
  for (const entry of ordered) {
    for (const { id: morpheme } of baseMorphemesOf(entry, entries)) {
      if (!index.has(morpheme)) index.set(morpheme, []);
      const words = index.get(morpheme);
      if (!words.includes(entry.id)) words.push(entry.id);
    }
  }
  return index;
}

/** 原文里引用到、但没有对应词条的词 id（「待补词条」） */
export function collectPending(entries) {
  const pending = [];
  for (const entry of Object.values(entries)) {
    const lines = [...entry.alien, ...entry.meanings.flatMap((meaning) => meaning.alien)];
    for (const line of lines) {
      for (const token of line) {
        if (token.space) continue;
        if (entries[token.id] || pending.includes(token.id)) continue;
        pending.push(token.id);
      }
    }
  }
  return pending;
}

/** 词素句式的首词应当是本词 id（写错多半是复制粘贴） */
export function checkMorphemeLines(entry, warnings = []) {
  entry.meanings.forEach((meaning, index) => {
    for (const words of wordsOf(meaning.alien)) {
      const at = words.findIndex((word, i) => word === MORPHEME_MARK[0] && words[i + 1] === MORPHEME_MARK[1]);
      if (at <= 0) continue;                      // 没有词素句式，或标记就在行首
      if (words[0] === entry.id) continue;
      warnings.push(`${entry.file}：第 ${index + 1} 条含义的词素句式首词是 ${words[0]}，应为 ${entry.id}`);
    }
  });
  return warnings;
}

