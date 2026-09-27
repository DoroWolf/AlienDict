<script setup>
/* 目录页「按词素找词」：两栏徽章（实义 / 非实义），可折叠；
   徽章＝筛选开关，筛选与深链由 IndexPage 管。 */
import MorphChip from './MorphChip.vue';

defineProps({
  morph: { type: Object, required: true },   // { total, columns: [{ key, title, lead, chips }] }
  active: { type: String, default: null },
  open: { type: Boolean, default: false },
  stateText: { type: String, default: '' },
});

defineEmits(['select', 'clear', 'toggle-open']);
</script>

<template>
  <details
    id="morphemes"
    class="morphemes"
    :open="open"
    @toggle="$emit('toggle-open', $event.target.open)"
  >
    <summary class="morphemes__h">
      <span class="morphemes__arrow closed" aria-hidden="true">▸</span>
      <span class="morphemes__arrow open" aria-hidden="true">▾</span>
      <span class="morphemes__title">按词素找词</span>
      <span class="morphemes__n">{{ morph.total }} 个词素</span>
      <span class="morphemes__fold closed">展开</span>
      <span class="morphemes__fold open">折叠</span>
    </summary>

    <p class="morphemes__lead">点一个词素，只看含此词素的词，再点一次取消。</p>

    <!-- 分两栏（上下排列）：上＝实义词素，下＝非实义词素（原文写明「X 不是词」的符号） -->
    <div class="morphemes__cols">
      <section
        v-for="group in morph.columns"
        :key="group.key"
        class="morphemes__col"
        :class="`morphemes__col--${group.key}`"
      >
        <h3 class="morphemes__colh">{{ group.title }}<span class="morphemes__n">{{ group.chips.length }}</span></h3>
        <p v-if="group.lead" class="morphemes__collead">{{ group.lead }}</p>
        <div class="chips">
          <MorphChip
            v-for="chip in group.chips"
            :key="chip.id"
            :chip="chip"
            :active="active === chip.id"
            @select="$emit('select', $event)"
          />
        </div>
      </section>
    </div>

    <p v-if="active" class="morphemes__state">
      <span data-spoiler>{{ stateText }}</span>
      <button class="morphemes__clear" type="button" @click="$emit('clear')">清除</button>
    </p>
  </details>
</template>
