<script setup>
/* 页面骨架：页头 + 正文 + 剧透警告弹窗；正文按 props.page 选目录页或词条页。
   props 是构建时算好的一整份页面数据（tools/lib/props.mjs），这里原样传给页面组件，
   客户端水合用的是同一份（页面里内联的 window.__ALIEN_DICT_PROPS__）。
   防剧透是内置的（没有开关配置），状态记在 localStorage，见 useSpoiler。 */
import { provide } from 'vue';
import SiteBar from './components/SiteBar.vue';
import IndexPage from './components/IndexPage.vue';
import EntryPage from './components/EntryPage.vue';
import SpoilerModal from './components/SpoilerModal.vue';
import { useSpoiler } from './composables/useSpoiler.js';

const props = defineProps([
  // 页面骨架
  'page', 'site', 'root',
  // 目录页：全部词条卡片 + 词素索引 + 待补词条
  'total', 'cards', 'morph', 'pending',
  // 词条页：词头 / 义项 / 提示 / 词素 / 前后导航
  'entry', 'headLines', 'meanings', 'notes', 'prev', 'next',
  // 两个页面都要：本页用到的词引用与字形
  'words', 'glyphs',
]);

// 数据全部走 props，别把 page 之类再落到 DOM 属性上
defineOptions({ inheritAttrs: false });

const spoiler = useSpoiler();
provide('alienDictSpoiler', spoiler);
</script>

<template>
  <SiteBar :title="site.title" :root="root" />
  <main class="page">
    <IndexPage v-if="page === 'index'" v-bind="props" />
    <EntryPage v-else v-bind="props" />
  </main>
  <SpoilerModal />
</template>
