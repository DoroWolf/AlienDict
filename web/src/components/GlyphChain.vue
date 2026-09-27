<script setup>
/* 外星原文：一个词一个字形，词间不补任何符号（要空一格就在数据里写空格元素 ""）；
   一行就是一个 .gl，换行/空行都恰好占一格高（--gl-line 由 css 决定）。
   popup=true：字形点了不跳页，把词 id 报上去（写作页弹窗里再看一个词，见 GlyphNode）。 */
import GlyphNode from './GlyphNode.vue';
import { usePageData } from '../composables/usePageData.js';

defineProps({
  lines: { type: Array, required: true },   // [[token…], …]：token 是 { id } 或 { space: true }
  css: { type: String, default: 'gl' },     // 'gl'（正文/卡片）或 'gl gl--lg'（词头放大）
  nested: { type: Boolean, default: true }, // 是否允许词内生成链接
  popup: { type: Boolean, default: false }, // 词不跳页、而是 emit open（写作页弹窗用）
});

defineEmits(['open']);

const pageData = usePageData();
</script>

<template>
  <span class="gl-lines">
    <template v-for="(line, index) in lines" :key="index">
      <span v-if="!line.length" :class="[css, 'gl--blank']" aria-hidden="true"></span>
      <span v-else :class="css">
        <template v-for="(token, at) in line" :key="at">
          <span v-if="token.space" class="gl__space" aria-hidden="true"></span>
          <GlyphNode
            v-else
            :word="pageData.words[token.id]"
            :nested="nested"
            :popup="popup"
            @open="$emit('open', $event)"
          />
        </template>
      </span>
    </template>
  </span>
</template>
