<script setup>
/* 目录页的卡片墙：整块是链接，字形链本身不再嵌套链接（nested=false）。
   筛选只是把不该显示的卡片标上 hidden（不动 DOM 顺序）。 */
import GlyphChain from './GlyphChain.vue';

defineProps({
  cards: { type: Array, required: true },
  visible: { type: Object, required: true },   // Set：当前显示的卡片 id
});
</script>

<template>
  <ul class="grid">
    <li
      v-for="card in cards"
      :id="`card-${card.id}`"
      :key="card.id"
      class="card"
      :hidden="!visible.has(card.id)"
    >
      <a
        class="card__link"
        :href="card.href"
        :title="card.title"
        :data-spoiler-title="card.title"
      >
        <span class="card__glyph"><GlyphChain :lines="card.lines" :nested="false" /></span>
        <span class="card__zh" data-spoiler>{{ card.zh }}</span>
        <span v-if="card.en" class="card__en" data-spoiler>{{ card.en }}</span>
      </a>
    </li>
  </ul>
</template>
