<script setup>
/* 提示：这个词的上下文说明（世界设定、换算关系等），直接写在 data/entries/<id>.yaml 的 notes: 里；
   内容是中文说明＝译文性质，故随防剧透一起遮（原文＝字形不遮）。 */
defineProps({
  notes: { type: Array, default: () => [] },   // [{ title, text }]
});
</script>

<template>
  <section v-if="notes.length" class="notes">
    <h2 class="notes__h">提示</h2>
    <ul class="notes__list">
      <li v-for="(note, index) in notes" :key="index" class="note">
        <span v-if="note.title" class="note__title" data-spoiler>{{ note.title }}</span>
        <span class="note__text" data-spoiler>{{ note.text }}</span>
      </li>
    </ul>
  </section>
</template>
