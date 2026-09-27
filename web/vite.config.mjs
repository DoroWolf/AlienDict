/* 外星词典 · Vite 配置（客户端构建 + 开发服务器）
 *
 * 客户端只出一个普通脚本（IIFE，不是 ES module）：产物双击打开也不会被 CORS 拦住，
 * 页面里的数据由预渲染时内联在 HTML 里（见 tools/lib/shell.mjs、tools/build.mjs）。
 * 开发服务器由 dev-plugin.mjs 提供同一份 props（/__props__/…）并把 /w/<id>.html 指回入口。
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devProps } from './dev-plugin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: HERE,
  base: './',
  plugins: [vue(), devProps()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2018',
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.join(HERE, 'src', 'main.js'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
