<script setup>
/* 原文里的一个词：有词条的就可点跳到它自己的解释页；
   没有词条的（待补）只显示字形、用虚线标记；连字形都没有就画一个问号方框。
   nested=false 用于「整块已经是链接」的场合（目录卡片、词头）；
   plain=true 用于只作装饰的场合（词素徽章里的字形）。 */
import { computed } from 'vue';
import GlyphFigure from './GlyphFigure.vue';
import { usePageData } from '../composables/usePageData.js';

const props = defineProps({
  word: { type: Object, required: true },
  nested: { type: Boolean, default: true },
  plain: { type: Boolean, default: false },
});

const pageData = usePageData();
const glyph = computed(() => (props.word.glyph ? pageData.glyphs[props.word.glyph] : null));
</script>

<template>
  <span v-if="word.missing" class="gl__none" :title="`缺字形：${word.key}`">?</span>

  <a
    v-else-if="!plain && nested && word.href"
    class="gl__link"
    :href="word.href"
    :title="word.label"
    :data-spoiler-title="word.label"
  ><GlyphFigure :word="word" :glyph="glyph" /></a>

  <span
    v-else-if="word.pending"
    class="gl__pending"
    :title="`待补词条：${word.key}`"
  ><GlyphFigure :word="word" :glyph="glyph" /></span>

  <span
    v-else
    class="gl__word"
    :title="word.label"
    :data-spoiler-title="word.label"
  ><GlyphFigure :word="word" :glyph="glyph" /></span>
</template>
