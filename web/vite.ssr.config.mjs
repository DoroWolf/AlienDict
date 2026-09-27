/* 外星词典 · Vite 服务端构建（预渲染用）
 *
 * 把 web/src/entry-server.js 打成一个 Node 模块（vue 走 node_modules），
 * 由 tools/build.mjs 导入后逐页渲染静态 HTML。
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: HERE,
  plugins: [vue()],
  build: {
    ssr: path.join(HERE, 'src', 'entry-server.js'),
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node18',
    rollupOptions: {
      output: { entryFileNames: 'entry-server.js' },
    },
  },
});
