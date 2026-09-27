<script setup>
/* 词条页底部导航：上一词 / 目录 / 下一词（词名是译文，遮着但点得动：
   data-spoiler-direct＝被遮住时也直接跳转，不弹剧透警告、不揭开） */
defineProps({
  prev: { type: Object, default: null },
  next: { type: Object, default: null },
  root: { type: String, default: '../' },
});
</script>

<template>
  <nav class="nav">
    <a v-if="prev" class="nav__link" data-spoiler data-spoiler-direct :href="prev.href">← {{ prev.zh }}</a>
    <span v-else class="nav__off">←</span>

    <a class="nav__link nav__link--home" :href="`${root}index.html`">目录</a>

    <a v-if="next" class="nav__link" data-spoiler data-spoiler-direct :href="next.href">{{ next.zh }} →</a>
    <span v-else class="nav__off">→</span>
  </nav>
</template>
