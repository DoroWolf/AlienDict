/* 外星词典 · 页面外壳
 *
 * 预渲染出来的每个 HTML 都由这里拼出来：head（标题/描述 + 防剧透的早于首帧脚本）
 * + 页头 + Vue 预渲染出来的正文 + 客户端水合用的 app.js。
 * 脚本用普通 <script>（不是 module）并以相对路径引用，产物双击就能打开。
 *
 * 防剧透是内置功能（不再有开关配置）：`.spoiler-on` 这个类默认就加上，
 * 由 localStorage 里的状态决定要不要加（见下），点页头开关或揭某一处都只是改这个状态。
 */
import { SPOILER_BOOT } from '../../web/src/composables/spoilerBoot.mjs';

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @vue/server-renderer 渲染 <svg> 上用 v-bind 传的属性时不做大小写还原
 * （ssrRenderAttrs 没带 tag，于是走了 key.toLowerCase()），`viewBox` 会变成 `viewbox`。
 * 只替换自家字形 SVG 里那一处：文本节点里的 `<` 早被转义成 &lt;，不会误伤词条内容。
 */
function fixSvgAttrCase(html) {
  return html.replace(/<svg class="gl__glyph" viewbox=/g, '<svg class="gl__glyph" viewBox=');
}

/**
 * @param {object} o
 * @param {string} o.siteTitle 站点名（页头左侧）
 * @param {string} o.lang
 * @param {string} o.title    <title>（词条页标题里带译文）
 * @param {string} o.description
 * @param {string} o.root     相对前缀（目录页 ""，词条页 "../"）
 * @param {object} o.props    这一页的数据（客户端水合用，内联在页面里）
 * @param {string} o.body     Vue 预渲染出来的正文
 */
export function renderShell({ siteTitle, lang, title, description, root, props, body }) {
  // 内联数据：`<` 转义掉，免得文本里出现 </script> 把脚本截断
  const inline = JSON.stringify(props).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" data-page-title="${esc(title)}" data-masked-title="${esc(siteTitle)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${root}assets/fonts.css">
<link rel="stylesheet" href="${root}assets/style.css">
<script>
${SPOILER_BOOT}
</script>
</head>
<body>
<div id="app">${fixSvgAttrCase(body)}</div>
<script>window.__ALIEN_DICT_PROPS__ = ${inline};</script>
<script src="${root}assets/app.js" defer></script>
</body>
</html>
`;
}
