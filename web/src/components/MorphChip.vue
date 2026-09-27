<script setup>
/* 目录页「按词素找词」的徽章＝筛选开关：点一下只看含此词素的词，再点一次取消。
   文案与词表都在 props 里（构建时算好），过滤由 IndexPage 负责。
   防剧透：徽章上的字形区点一下就直接筛选；被遮住的中译点一下先揭开（跟其它译文一个规矩），
   揭开之后再点就是筛选。 */
import ChipBody from './ChipBody.vue';

defineProps({
  chip: { type: Object, required: true },   // { id, label, pending, base, count, words }
  active: { type: Boolean, default: false },
});

defineEmits(['select']);
</script>

<template>
  <button
    class="chip chip--morph"
    :class="{ 'chip--pending': chip.pending, 'chip--base': chip.base, 'is-active': active }"
    type="button"
    :data-morpheme="chip.id"
    :aria-pressed="active ? 'true' : 'false'"
    :title="chip.label"
    :data-spoiler-title="chip.pending ? null : chip.label"
    @click="$emit('select', chip.id)"
  ><ChipBody :chip="chip" :count="chip.count" /></button>
</template>
