<script setup>
/* 目录页：标题 + 搜索 + 按词素找词（筛选）+ 全部词条卡片 + 待补词条。
   搜索框的筛选与词素筛选可叠加；选中的词素写进 URL 深链 index.html#m=<词素 id>。
   遮着时点搜索框先过一遍剧透警告（搜字是按译文找词），见 useSpoiler。 */
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import CardGrid from './CardGrid.vue';
import MorphPanel from './MorphPanel.vue';
import PendingSection from './PendingSection.vue';
import { providePageData } from '../composables/usePageData.js';

const props = defineProps({
  site: { type: Object, required: true },
  total: { type: Number, required: true },
  cards: { type: Array, required: true },
  morph: { type: Object, required: true },
  pending: { type: Array, default: () => [] },
  words: { type: Object, required: true },
  glyphs: { type: Object, required: true },
});

providePageData({ words: props.words, glyphs: props.glyphs });

// 页面的数据都在 props 里，别把 root / site 之类再落到 DOM 属性上
defineOptions({ inheritAttrs: false });

const spoiler = inject('alienDictSpoiler');   // 搜字前要过一遍剧透警告

const query = ref('');
const active = ref(null);        // 选中的词素
const panelOpen = ref(false);    // 「按词素找词」这栏的折叠状态
const input = ref(null);

// 每个词素由哪些词构成：构建时就写在徽章的 words 里（含该词素自己），运行时无需再取数据
const wordsOf = {};
const infoOf = {};
for (const group of props.morph.columns) {
  for (const chip of group.chips) {
    wordsOf[chip.id] = chip.words;
    infoOf[chip.id] = { zh: props.words[chip.id].zh, count: chip.words.length };
  }
}

// 显示中的卡片：搜索词命中的 + 含所选中词素的
const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  const allow = active.value ? new Set(wordsOf[active.value] || []) : null;
  const shown = new Set();
  for (const card of props.cards) {
    if (text && !card.search.includes(text)) continue;
    if (allow && !allow.has(card.id)) continue;
    shown.add(card.id);
  }
  return shown;
});

const count = computed(() => (query.value.trim() || active.value
  ? `${visible.value.size} / ${props.total}`
  : String(props.total)));

const stateText = computed(() => (active.value
  ? `词素：${infoOf[active.value].zh}（${infoOf[active.value].count} 个词）`
  : ''));

function hashMorpheme() {
  const matched = /^#m=(.+)$/.exec(location.hash || '');
  const id = matched ? decodeURIComponent(matched[1]) : null;
  return id && wordsOf[id] ? id : null;    // 不认识的词素就当没选
}

function syncHash(id) {
  try {
    history.replaceState(null, '', id
      ? `#m=${encodeURIComponent(id)}`
      : location.pathname + location.search);
  } catch (err) {
    location.hash = id ? `m=${encodeURIComponent(id)}` : '';
  }
}

function setActive(id) {
  active.value = id || null;
  if (active.value) panelOpen.value = true;   // 选中词素时把这一栏展开（之后开合随用户）
  syncHash(active.value);
}

// 徽章点一下＝筛选，再点一次＝取消
function toggleMorpheme(id) {
  setActive(active.value === id ? null : id);
}

function clear() {
  setActive(null);
  if (input.value) input.value.focus();
}

function onHash() {
  active.value = hashMorpheme();
  if (active.value) panelOpen.value = true;
}

onMounted(() => {
  onHash();   // 深链 index.html#m=<词素 id> 直接进筛选态
  window.addEventListener('hashchange', onHash);
});
onUnmounted(() => window.removeEventListener('hashchange', onHash));
</script>

<template>
  <section class="hero">
    <h1 class="hero__title">{{ site.title }}</h1>
    <p v-if="site.description" class="hero__lead">{{ site.description }}</p>
  </section>

  <form class="search" role="search" @submit.prevent>
    <input
      ref="input"
      v-model="query"
      class="search__input"
      type="search"
      autocomplete="off"
      placeholder="搜索词汇"
      aria-label="搜字"
      @focus="spoiler.askBeforeSearch()"
    >
    <span class="search__count">{{ count }}</span>
  </form>

  <MorphPanel
    v-if="morph.total"
    :morph="morph"
    :active="active"
    :open="panelOpen"
    :state-text="stateText"
    @select="toggleMorpheme($event)"
    @clear="clear"
    @toggle-open="panelOpen = $event"
  />

  <CardGrid :cards="cards" :visible="visible" />

  <PendingSection v-if="pending.length" :pending="pending" />
</template>
