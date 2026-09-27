/* 外星词典 · 开发服务器插件
 *
 * `npm run dev` 时让浏览器里的页面与预渲染产物完全一样：
 *   /__props__/index.html   目录页
 *   /__props__/w/<id>.html  词条页
 *   /w/<id>.html            指回 index.html（纯客户端渲染，路由由页面自己读）
 *   head 里的防剧透引导脚本按同一份源码塞进去（web/index.html 里留了 <!-- alien-dict:spoiler-boot -->）
 * 顺带把字形 PNG 与子集字库指到仓库里的真实文件，开发时和产物一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GLYPH_DIR, DEFAULT_OUT } from '../tools/lib/lexicon.mjs';
import { loadSite, propsForRoute } from '../tools/lib/props.mjs';
import { SPOILER_BOOT } from './src/composables/spoilerBoot.mjs';

const BOOT_MARK = '<!-- alien-dict:spoiler-boot -->';

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader('Content-Type', type || 'application/json; charset=utf-8');
  res.end(body);
}

export function devProps() {
  let cache = null;
  const data = () => {
    if (!cache) {
      cache = loadSite();
      console.log(`[dev] 词条 ${cache.ordered.length} · 词素 ${cache.morphs.size} · 待补 ${cache.pending.length}`);
    }
    return cache;
  };

  return {
    name: 'alien-dict-dev-props',
    apply: 'serve',

    transformIndexHtml(html) {
      return html.replace(BOOT_MARK, `<script>\n${SPOILER_BOOT}\n</script>`);
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = String(req.url || '/').split('?')[0];

        if (url.startsWith('/__props__/')) {
          const props = propsForRoute(data(), url.replace('/__props__', ''));
          if (!props) return send(res, 404, JSON.stringify({ error: '没有这个词条' }));
          return send(res, 200, JSON.stringify(props));
        }

        if (url.startsWith('/assets/glyph/')) {
          const file = path.join(GLYPH_DIR, path.basename(url));
          if (fs.existsSync(file)) {
            res.setHeader('Content-Type', 'image/png');
            return res.end(fs.readFileSync(file));
          }
          return next();
        }

        if (url === '/assets/fonts/unifont.woff2') {
          const file = path.join(DEFAULT_OUT, 'assets', 'fonts', 'unifont.woff2');
          if (fs.existsSync(file)) {
            res.setHeader('Content-Type', 'font/woff2');
            return res.end(fs.readFileSync(file));
          }
          return next();
        }

        if (url.startsWith('/w/') && url.endsWith('.html')) {     // 一词一页在开发时也是同一个入口
          return server.transformIndexHtml(url, fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8'))
            .then((html) => send(res, 200, html, 'text/html; charset=utf-8'))
            .catch(next);
        }

        return next();
      });
    },
  };
}
