<script setup>
/* 词素徽章（词条页用）：整块可点，跳到该词的词条页；还没词条的用虚线标出。 */
import ChipBody from './ChipBody.vue';

defineProps({
  chip: { type: Object, required: true },   // { id, label, href, pending, base }
});
</script>

<template>
  <a
    v-if="chip.href"
    class="chip"
    :class="{ 'chip--base': chip.base }"
    :href="chip.href"
    :title="chip.label"
    :data-spoiler-title="chip.label"
  ><ChipBody :chip="chip" /></a>

  <span v-else class="chip chip--pending" :title="chip.label"><ChipBody :chip="chip" /></span>
</template>
