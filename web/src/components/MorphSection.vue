<script setup>
/* 词条页的「词素」区块：本词最终由哪些基础词素构成（点徽章跳词条）
   + 含此词素的词（按词素找词的入口）。 */
import Chip from './Chip.vue';

defineProps({
  morph: { type: Object, required: true },   // { morphemes, base, derived }
  entryId: { type: String, required: true },
  root: { type: String, default: '../' },
});
</script>

<template>
  <section class="morph">
    <h2 class="morph__h">词素</h2>

    <div v-if="morph.morphemes.length" class="morph__row">
      <span class="morph__label">由这些词素构成</span>
      <div class="chips">
        <Chip v-for="chip in morph.morphemes" :key="chip.id" :chip="chip" />
      </div>
    </div>
    <p v-else-if="morph.base" class="morph__base">基础词素</p>

    <details v-if="morph.derived.length" class="morph__more" :open="morph.derived.length <= 12">
      <summary class="morph__label">
        <span class="morph__arrow closed" aria-hidden="true">▸</span>
        <span class="morph__arrow open" aria-hidden="true">▾</span>
        含此词素的词（{{ morph.derived.length }}）
        <span class="morph__fold closed">展开</span>
        <span class="morph__fold open">折叠</span>
      </summary>
      <div class="chips">
        <Chip v-for="chip in morph.derived" :key="chip.id" :chip="chip" />
      </div>
      <p class="morph__find"><a :href="`${root}index.html#m=${entryId}`">在目录里按词素找 →</a></p>
    </details>
  </section>
</template>
