<script setup>
/* 一个外星词的字形本身：内联 SVG（fill="currentColor"，随主题变色、任意放大不糊），
   缺 SVG 时回退到 bitmap PNG（image-rendering: pixelated）。
   属性走对象绑定：模板里直接写 :viewBox 会被编译器改成小写 viewbox，
   SVG 属性名大小写敏感，用对象绑定才能原样输出。 */
import { computed } from 'vue';

const props = defineProps({
  word: { type: Object, required: true },   // props.words 里的一条：{ label, glyph, png, … }
  glyph: { type: Object, default: null },   // { vb, inner }
});

// alt / aria-label 就是中英释义：防剧透遮住时换掉（见 useSpoiler）
const svgAttrs = computed(() => ({
  viewBox: props.glyph ? props.glyph.vb : '',
  role: 'img',
  'aria-label': props.word.label,
  'data-spoiler-label': props.word.label,
  'shape-rendering': 'crispEdges',
  focusable: 'false',
}));

const imgAttrs = computed(() => ({
  alt: props.word.label,
  'data-spoiler-label': props.word.label,
  width: 16,
  height: 16,
}));
</script>

<template>
  <svg v-if="glyph" class="gl__glyph" v-bind="svgAttrs" v-html="glyph.inner"></svg>
  <img v-else class="gl__glyph glyph--png" :src="word.png" v-bind="imgAttrs">
</template>
