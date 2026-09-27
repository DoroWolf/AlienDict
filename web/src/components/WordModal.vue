<script setup>
/* 词条弹窗（写作页右键看词条）：字形 + 中英释义 + 各义项（原文在上、译文在下）+ 提示。
   弹窗里只有词条本身，不放别的按钮（不回词条页、不留「关闭」）：
   关掉按 Esc 或点背景，由写作页的键盘处理与这里的 backdrop 收口；
   词条原文里的字形可以点：不跳页，而是把词 id 报上去（emit open），
   由写作页换一份内容 —— 就在这个弹窗里继续看别的词。
   译文照旧标 data-spoiler（防剧透开着时遮住，点一下先过剧透警告再揭开），字形（原文）不遮。 */
import { onMounted, onUnmounted, ref, watch } from 'vue';
import GlyphChain from './GlyphChain.vue';
import GlyphNode from './GlyphNode.vue';

const props = defineProps({
  item: { type: Object, required: true },   // 词条内容：{ id, zh, en, meanings, notes }
  word: { type: Object, required: true },   // 字形引用：props.words[item.id]
});

defineEmits(['close', 'open']);

// 打开时把焦点收进弹窗（Esc 关得掉，Tab 也不会跑到背后去），并锁住背后的滚动（见 styles 里的 html.modal-open）
const box = ref(null);

onMounted(() => {
  if (box.value) box.value.focus();
  document.documentElement.classList.add('modal-open');
});

onUnmounted(() => document.documentElement.classList.remove('modal-open'));

// 在弹窗里又点开一个词：内容换了，把新词条从头看起
watch(() => props.item.id, () => {
  if (box.value) box.value.scrollTop = 0;
});
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="wr-modal-title">
    <div class="modal__backdrop" @click="$emit('close')"></div>
    <div ref="box" class="modal__box wr-modal" tabindex="-1">
      <header class="wr-modal__head">
        <span class="wr-modal__glyph"><GlyphNode :word="word" plain /></span>
        <span class="wr-modal__gloss" data-spoiler>
          <span id="wr-modal-title" class="wr-modal__zh">{{ item.zh }}</span>
          <span v-if="item.en" class="wr-modal__en">{{ item.en }}</span>
        </span>
      </header>

      <div v-if="item.meanings.length" class="wr-modal__text">
        <!-- 上：原文（外星字形，逐行） -->
        <div class="text__alien">
          <template v-for="(meaning, index) in item.meanings" :key="index">
            <span v-if="meaning.blank" class="gl gl--blank" aria-hidden="true"></span>
            <GlyphChain v-else :lines="meaning.lines" popup @open="$emit('open', $event)" />
          </template>
        </div>
        <!-- 下：译文（与原文逐行对应） -->
        <h3 class="text__label">翻译</h3>
        <div class="text__zh" data-spoiler>
          <template v-for="(meaning, index) in item.meanings" :key="index">
            <span v-if="meaning.blank" class="line line--blank" aria-hidden="true"></span>
            <span v-else class="line"><template v-if="meaning.zh">{{ meaning.zh }}</template><span v-else class="dash">—</span></span>
          </template>
        </div>
      </div>
      <p v-else class="empty">（含义待补）</p>

      <div v-if="item.notes.length" class="wr-modal__notes">
        <h3 class="text__label">提示</h3>
        <ul class="notes__list">
          <li v-for="(note, index) in item.notes" :key="index" class="note">
            <span v-if="note.title" class="note__title">{{ note.title }}</span>
            <span class="note__text" data-spoiler>{{ note.text }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
