<script setup>
/* 页头：站名（回目录）+ 防剧透状态（开着时译文遮住，点一下切换；内置功能，见 useSpoiler） */
import { inject } from 'vue';

defineProps({
  title: { type: String, required: true },
  root: { type: String, default: '' },
});

const spoiler = inject('alienDictSpoiler');
</script>

<template>
  <header class="bar">
    <a class="bar__home" :href="`${root}index.html`">{{ title }}</a>
    <button
      class="bar__spoiler"
      type="button"
      :aria-pressed="spoiler.pressed"
      title="防剧透：译文默认遮住，点一下切换"
      @click="spoiler.toggle"
    >{{ spoiler.label }}</button>
  </header>
</template>
