/* 外星词典 · 客户端入口
 *
 * 产物里的每个页面都由预渲染（tools/build.mjs）生成，数据内联在页面里
 * （window.__ALIEN_DICT_PROPS__），这里做的是「水合」——把静态 HTML 接上 Vue 的交互。
 * 开发时（vite dev）没有内联数据，改为向 dev server 取同一份 props 后纯客户端渲染。
 */
import { createApp, createSSRApp } from 'vue';
import App from './App.vue';
import './styles/app.css';

const el = document.getElementById('app');
const props = window.__ALIEN_DICT_PROPS__;

if (props) {
  createSSRApp(App, props).mount(el);
} else {
  const path = location.pathname.endsWith('.html') ? location.pathname : '/index.html';
  fetch(`/__props__${path}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status} ${res.statusText}`))))
    .then((data) => createApp(App, data).mount(el))
    .catch((err) => {
      el.textContent = `开发数据加载失败：${err.message}（先跑 npm run build，或用 npm run dev 打开）`;
    });
}
