<script setup>
/* 剧透警告弹窗：点被遮住的译文、或点开关关掉防剧透时先弹它（文案与焦点由 useSpoiler 接管） */
import { inject, nextTick, ref, watch } from 'vue';

const spoiler = inject('alienDictSpoiler');
const cancelBtn = ref(null);

// 焦点默认落在「再想想」上，回车不会误揭
watch(() => spoiler.modalOpen, (open) => {
  if (open) nextTick(() => cancelBtn.value && cancelBtn.value.focus());
});
</script>

<template>
  <div
    class="modal"
    id="spoiler-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="spoiler-modal-title"
    aria-describedby="spoiler-modal-text"
    :hidden="!spoiler.modalOpen"
  >
    <div class="modal__backdrop" data-modal-close @click="spoiler.cancel"></div>
    <div class="modal__box">
      <h2 class="modal__title" id="spoiler-modal-title">剧透警告</h2>
      <p class="modal__text" id="spoiler-modal-text">{{ spoiler.modalText }}</p>
      <div class="modal__actions">
        <button ref="cancelBtn" class="modal__btn" type="button" @click="spoiler.cancel">再想想</button>
        <button class="modal__btn modal__btn--primary" type="button" @click="spoiler.confirm">确定</button>
      </div>
    </div>
  </div>
</template>
