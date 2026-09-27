/* 字形渲染用的页面级数据：{ words: { 词 id → 字形/释义/链接 }, glyphs: { 字形名 → { vb, inner } } }
 * 由页面组件（IndexPage / EntryPage）provide，字形组件靠 usePageData() 取用，
 * 免得一路透传；预渲染与客户端用的是同一份 props，水合前后一致。 */
import { inject, provide } from 'vue';

export function providePageData(data) {
  provide('alienDictPageData', data);
}

export function usePageData() {
  return inject('alienDictPageData');
}
