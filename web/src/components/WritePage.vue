<script setup>
/* 外星写作：上方写作栏（固定两层：上面放正在写的字、固定高度、写满了在里面滚；下面一排按钮），
   下方搜索词汇栏。写作内容是「词 / 空格 / 换行」三种单元的序列（cells），光标是单元之间的位置
   （0…cells.length）：按钮与键盘都只是在这个位置插一格、删一格或挪一下光标，没有别的状态。
   键盘：← → 移光标、Enter 换行、空格 空一格、Backspace 退格、Esc 关掉词条弹窗（焦点在搜索框里时不抢键）；
   点过字形或按钮之后焦点收回写作栏（见 focusPad），于是接着敲的空格 / 回车仍是写作栏的键。
   下方搜索按含义找词（与目录页同一套搜索词）：命中多少列多少；左键点字形＝在光标处写进去，
   右键点字形或写作栏里的某一格＝弹窗看词条（原文各义项 + 译文 + 提示，见 WordModal.vue）；
   弹窗里的字形也能点：不跳页，就在这个弹窗里换看那个词（弹窗开着时写作键先不动）。
   译文的处理与全站一致：中英释义标 data-spoiler（防剧透开着时遮住），点搜索框先过一遍剧透警告
   （搜字是按译文找词，见 useSpoiler）；只有字形（原文）的那部分从不遮挡。 */
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import GlyphNode from './GlyphNode.vue';
import WordModal from './WordModal.vue';
import { providePageData } from '../composables/usePageData.js';

const props = defineProps({
  site: { type: Object, required: true },
  total: { type: Number, required: true },
  items: { type: Array, required: true },   // 全部词：{ id, zh, en, title, search }
  words: { type: Object, required: true },
  glyphs: { type: Object, required: true },
});

// 字形数据给子组件（GlyphNode）用；本组件自己直接用 props.words
providePageData({ words: props.words, glyphs: props.glyphs });

// 页面的数据都在 props 里，别把 site / total 之类再落到 DOM 属性上
defineOptions({ inheritAttrs: false });

const spoiler = inject('alienDictSpoiler');   // 搜字前要过一遍剧透警告

/* ── 写作栏 ─────────────────────────────────────── */
const cells = ref([]);     // { kind: 'word', id } | { kind: 'space' } | { kind: 'break' }
const caret = ref(0);      // 光标：第几格之前（0 ＝ 最前，cells.length ＝ 最后）

// 写作栏＝固定两层里的上层（输入栏）：高度固定（约三行），写满了在里面滚；
// 光标一动就把它滚进视野，别让它跑到看不见的地方
const pad = ref(null);

// 点过东西之后把焦点收回写作栏：焦点若留在刚点过的按钮上，
// 接下来的空格 / 回车会被浏览器当成「再点一次那个按钮」＝又写一遍上一个字；
// 收回写作栏后，键就照旧归写作栏（preventScroll：别因为收焦点把页面滚一下）。
function focusPad() {
  const el = pad.value;
  if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
}

// 按「换行」切成若干行，并算出光标落在这一行的哪一格（0…本行格数）
const rows = computed(() => {
  const result = [];
  let row = { cells: [], caret: null };
  cells.value.forEach((cell, at) => {
    if (cell.kind === 'break') {
      if (at === caret.value) row.caret = row.cells.length;
      result.push(row);
      row = { cells: [], caret: null };
      return;
    }
    if (at === caret.value) row.caret = row.cells.length;
    row.cells.push({ cell, at, column: row.cells.length });
  });
  if (caret.value === cells.value.length) row.caret = row.cells.length;   // 光标在最末尾
  result.push(row);
  return result;
});

// 写作栏右侧显示的字数：只数写进去的字形，空格与换行不算
const wordCount = computed(() => cells.value.reduce((sum, cell) => sum + (cell.kind === 'word' ? 1 : 0), 0));

function insert(cell) {
  cells.value.splice(caret.value, 0, cell);
  caret.value += 1;
}

function move(delta) {
  caret.value = Math.min(cells.value.length, Math.max(0, caret.value + delta));
}

// 写作栏的六个按钮：key 对应下面这个表，label / title 是界面文案
const buttons = [
  { key: 'left', label: '左移', title: '光标左移一格' },
  { key: 'right', label: '右移', title: '光标右移一格' },
  { key: 'break', label: '换行', title: '在光标处另起一行' },
  { key: 'space', label: '空格', title: '在光标处空一格' },
  { key: 'backspace', label: '退格', title: '删掉光标左边那一格' },
  { key: 'clear', label: '清空', title: '清掉全部写作内容' },
];

const actions = {
  left: () => move(-1),
  right: () => move(1),
  break: () => insert({ kind: 'break' }),
  space: () => insert({ kind: 'space' }),
  backspace: () => {
    if (caret.value <= 0) return;
    cells.value.splice(caret.value - 1, 1);
    caret.value -= 1;
  },
  clear: () => {
    cells.value = [];
    caret.value = 0;
  },
};

// 按钮与键盘共用同一条路：做完这件事，再把焦点收回写作栏（见 focusPad）
function run(key) {
  actions[key]();
  focusPad();
}

function placeCaret(at) {
  caret.value = at;
  focusPad();
}

// 光标一动（或写作内容一变）就把它滚进视野，别让它跑到看不见的地方
watch([caret, () => cells.value.length], async () => {
  await nextTick();
  const el = pad.value && pad.value.querySelector('.wr__caret');
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

/* ── 搜索词汇栏 ─────────────────────────────────── */
const query = ref('');
const input = ref(null);

// 按 id 取整条词条内容（右键弹窗用）
const byId = {};
for (const item of props.items) byId[item.id] = item;

// 排序权重：一模一样最前，其次是中译开头 / 英文开头命中，最后是包含
function rank(item, text) {
  const zh = item.zh.toLowerCase();
  const en = item.en.toLowerCase();
  if (zh === text || en === text || item.id.toLowerCase() === text) return 0;
  if (zh.startsWith(text)) return 1;
  if (en.startsWith(text)) return 2;
  return 3;
}

// 命中的词全部列出来（不截断），同权重按字序
const matched = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return [];
  return props.items
    .map((item, at) => ({ item, at, rank: item.search.includes(text) ? rank(item, text) : -1 }))
    .filter((row) => row.rank >= 0)
    .sort((a, b) => (a.rank - b.rank) || (a.at - b.at))
    .map((row) => row.item);
});

const countText = computed(() => (query.value.trim()
  ? `${matched.value.length} / ${props.total}`
  : `${props.total}`));

// 只有找不到内容才提示一句
const hintText = computed(() => (query.value.trim() && !matched.value.length
  ? '没有匹配的词，换个说法试试。'
  : ''));

/* ── 右键看词条：弹窗 ───────────────────────────── */
const viewing = ref(null);   // 正在看的词 id（null ＝ 关着）

function showMeaning(id) {
  viewing.value = id;
}

function closeMeaning() {
  viewing.value = null;
}

/* ── 键盘＝那几个按钮 ─────────────────────────────
   焦点在搜索框（或别的输入控件）里时不抢键，正常打字；
   焦点在按钮上时（Tab 过来的），空格 / 回车留给按钮自己；
   鼠标点过的按钮不会留下焦点 —— 点完焦点就收回写作栏（见 focusPad）。
   Esc 只用来关词条弹窗；弹窗开着时别的键也不动写作栏（在弹窗里敲键盘不该动到背后）。 */
const KEY_ACTIONS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'break',
  ' ': 'space',
  Backspace: 'backspace',
};

function onKeydown(ev) {
  if (ev.key === 'Escape' || ev.keyCode === 27) {
    if (viewing.value) {
      ev.preventDefault();
      closeMeaning();
    }
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;      // 别抢浏览器的快捷键
  // 弹窗开着时写作键先不动：在弹窗里敲键盘不该动到背后的写作栏（Esc 已经在上面处理了）
  if (viewing.value) return;
  const el = ev.target;
  const tag = el && el.tagName ? el.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
  if (tag === 'BUTTON' && (ev.key === 'Enter' || ev.key === ' ')) return;
  const action = KEY_ACTIONS[ev.key];
  if (!action) return;
  ev.preventDefault();     // 空格别滚页、Backspace 别退回上一页
  run(action);
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

function write(id) {
  insert({ kind: 'word', id });
  focusPad();       // 写完把焦点收回写作栏，接着敲空格 / 回车才是写作栏的键
}
</script>

<template>
  <section class="hero">
    <h1 class="hero__title">外星写作</h1>
    <p class="hero__lead">
      上方写作、下方查词：输入含义找到字，左键点字形写进去，右键点字形看词条。
      键盘也能操作写作栏：← → 移光标、Enter 换行、空格 空一格、Backspace 退格、Esc 关掉词条弹窗。
    </p>
  </section>

  <!-- 上方：写作栏（固定两层：上层＝输入栏，固定高度、写满了在里面滚；下层＝按钮栏） -->
  <section class="wr" aria-label="写作栏">
    <div ref="pad" class="wr__pad" role="group" aria-label="写作内容" tabindex="0">
      <span v-for="(row, index) in rows" :key="index" class="gl wr__row">
        <template v-for="entry in row.cells" :key="entry.at">
          <span v-if="row.caret === entry.column" class="wr__caret" aria-hidden="true"></span>
          <span v-if="entry.cell.kind === 'space'" class="gl__space" aria-hidden="true"></span>
          <button
            v-else
            class="wr__cell"
            type="button"
            :title="words[entry.cell.id].label"
            :data-spoiler-title="words[entry.cell.id].label"
            @click="placeCaret(entry.at)"
            @contextmenu.prevent="showMeaning(entry.cell.id)"
          ><GlyphNode :word="words[entry.cell.id]" plain /></button>
        </template>
        <span v-if="row.caret === row.cells.length" class="wr__caret" aria-hidden="true"></span>
      </span>
    </div>

    <div class="wr__bar">
      <button
        v-for="button in buttons"
        :key="button.key"
        class="wr__btn"
        type="button"
        :title="button.title"
        @click="run(button.key)"
      >{{ button.label }}</button>
      <span class="wr__count">字数 {{ wordCount }}</span>
    </div>
  </section>

  <!-- 右键看词条：弹窗（关掉＝点背景或按 Esc；弹窗里的字形可在同一弹窗里再看那个词） -->
  <WordModal
    v-if="viewing"
    :item="byId[viewing]"
    :word="words[viewing]"
    @close="closeMeaning"
    @open="showMeaning"
  />

  <!-- 下方：搜索词汇栏 -->
  <section class="wr-search" aria-label="搜索词汇">
    <form class="search" role="search" @submit.prevent>
      <input
        ref="input"
        v-model="query"
        class="search__input"
        type="search"
        autocomplete="off"
        placeholder="输入含义，找要写的字"
        aria-label="搜索词汇"
        @focus="spoiler.askBeforeSearch()"
      >
      <span class="search__count">{{ countText }}</span>
    </form>

    <p v-if="hintText" class="wr-search__hint">{{ hintText }}</p>

    <ul v-if="matched.length" class="wr-list">
      <li v-for="item in matched" :key="item.id" class="wr-item">
        <button
          class="wr-item__btn"
          type="button"
          :title="item.title"
          :data-spoiler-title="item.title"
          @click="write(item.id)"
          @contextmenu.prevent="showMeaning(item.id)"
        >
          <span class="wr-item__glyph"><GlyphNode :word="words[item.id]" plain /></span>
          <span class="wr-item__zh" data-spoiler>{{ item.zh }}</span>
          <span v-if="item.en" class="wr-item__en" data-spoiler>{{ item.en }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
