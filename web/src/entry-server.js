/* 外星词典 · 预渲染入口
 *
 * tools/build.mjs 逐页调用 render(props)，把同一套 Vue 组件渲染成静态 HTML；
 * 客户端用同一份 props 水合（web/src/main.js）。
 */
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import App from './App.vue';

export function render(props) {
  return renderToString(createSSRApp(App, props));
}
