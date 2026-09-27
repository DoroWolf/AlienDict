<script setup>
/* 词条页：词头（左＝放大的字形，右＝中英释义）→ 正文（上＝原文整块，下＝译文整块）
   → 提示（notes）→ 词素 → 上一词 / 目录 / 下一词。 */
import { ref } from 'vue';
import GlyphChain from './GlyphChain.vue';
import MorphSection from './MorphSection.vue';
import NotesSection from './NotesSection.vue';
import EntryNav from './EntryNav.vue';
import { providePageData } from '../composables/usePageData.js';

const props = defineProps({
  entry: { type: Object, required: true },
  root: { type: String, default: '../' },
  headLines: { type: Array, required: true },
  meanings: { type: Array, required: true },
  notes: { type: Array, default: () => [] },
  morph: { type: Object, required: true },
  prev: { type: Object, default: null },
  next: { type: Object, default: null },
  words: { type: Object, required: true },
  glyphs: { type: Object, required: true },
});

providePageData({ words: props.words, glyphs: props.glyphs });

// 页面的数据都在 props 里，别把 page / site 之类再落到 DOM 属性上
defineOptions({ inheritAttrs: false });

// 「含此词素的词」超过 12 个时默认收起（与折叠头里的展开/折叠文案配套）
const derivedOpen = ref(props.morph.derived.length <= 12);
</script>

<template>
  <article class="entry">
    <header class="head">
      <div class="head__alien"><GlyphChain :lines="headLines" :nested="false" css="gl gl--lg" /></div>
      <div class="head__gloss" data-spoiler>
        <h1 class="head__zh">{{ entry.zh }}</h1>
        <p v-if="entry.en" class="head__en">{{ entry.en }}</p>
      </div>
    </header>

    <div v-if="meanings.length" class="text">
      <!-- 上方：原文——所有义项的原文行聚成一块（多行就在一起） -->
      <div class="text__alien">
        <template v-for="(meaning, index) in meanings" :key="index">
          <span v-if="meaning.blank" class="gl gl--blank" aria-hidden="true"></span>
          <GlyphChain v-else :lines="meaning.lines" />
        </template>
      </div>
      <!-- 下方：译文——与原文逐行对应，聚成一块 -->
      <h2 class="text__label">翻译</h2>
      <div class="text__zh" data-spoiler>
        <template v-for="(meaning, index) in meanings" :key="index">
          <span v-if="meaning.blank" class="line line--blank" aria-hidden="true"></span>
          <span v-else class="line"><template v-if="meaning.zh">{{ meaning.zh }}</template><span v-else class="dash">—</span></span>
        </template>
      </div>
    </div>
    <p v-else class="empty">（含义待补）</p>

    <NotesSection :notes="notes" />

    <MorphSection v-if="morph.morphemes.length || morph.derived.length || morph.base" :morph="morph" :entry-id="entry.id" :root="root" />

    <EntryNav :prev="prev" :next="next" :root="root" />
  </article>
</template>
