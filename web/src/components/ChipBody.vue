<script setup>
/* 词素徽章的内容：小字形 + 中译（+ 派生词数）。
   中译是译文：标 data-spoiler，防剧透开着时遮住（字形＝原文不遮）。
   徽章上不显示英文释义（英文只在「词条页/卡片」等处出现）。 */
import GlyphNode from './GlyphNode.vue';
import { usePageData } from '../composables/usePageData.js';

defineProps({
  chip: { type: Object, required: true },   // { id, pending, … }
  count: { type: Number, default: null },   // 徽章上的数字＝含此词素的词数
});

const pageData = usePageData();
</script>

<template>
  <span class="chip__glyph"><GlyphNode :word="pageData.words[chip.id]" plain /></span>
  <span class="chip__zh" :data-spoiler="chip.pending ? null : ''">{{ pageData.words[chip.id].zh }}</span>
  <span v-if="count !== null" class="chip__n">{{ count }}</span>
</template>
