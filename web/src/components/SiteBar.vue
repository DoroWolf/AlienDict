<script setup>
/* 页头：站名（回目录）+ 目录 / 写作 两个入口 + 防剧透状态
   （开着时译文遮住，点一下切换；内置功能，见 useSpoiler）。
   链接都用 root 前缀：目录页 root=""，词条页与写作页 root="../"。 */
import { inject } from 'vue';

defineProps({
  title: { type: String, required: true },
  root: { type: String, default: '' },
});

const spoiler = inject('alienDictSpoiler');
</script>

<template>
  <header class="bar">
    <div class="bar__left">
      <a class="bar__home" :href="`${root}index.html`">{{ title }}</a>
      <nav class="bar__nav" aria-label="站点导航">
        <a class="bar__link" :href="`${root}index.html`">目录</a>
        <a class="bar__link" :href="`${root}write.html`">写作</a>
      </nav>
    </div>
    <button
      class="bar__spoiler"
      type="button"
      :aria-pressed="spoiler.pressed"
      title="防剧透：译文默认遮住，点一下切换"
      @click="spoiler.toggle"
    >{{ spoiler.label }}</button>
  </header>
</template>
