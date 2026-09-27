<script setup>
/* 目录页底部的「待补词条」：原文引用到、但还没有 data/entries/<id>.yaml 的词 id */
defineProps({
  pending: { type: Array, required: true },
});
</script>

<template>
  <section class="pending">
    <h2 class="pending__h">待补词条</h2>
    <p class="pending__lead">
      下列 id 被原文引用，但还没有 <code>data/entries/&lt;id&gt;.yaml</code>，故不可点击。
    </p>
    <ul class="pending__list">
      <li v-for="id in pending" :key="id">{{ id }}</li>
    </ul>
  </section>
</template>
