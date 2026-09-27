/* 外星词典 · 防剧透的「早于首帧」引导脚本
 *
 * 防剧透是内置的：页面默认遮住译文，只有浏览器里明确记着「关」时才不遮。
 * 这段脚本由页面外壳（tools/lib/shell.mjs）与开发入口（web/index.html）共用，
 * 在 <head> 里同步执行 —— 早于首帧就把类加上、把标签页标题里的译文换掉，译文不会先闪一下。
 * 没有 JS 时不会加这个类 ＝ 内容照常可读（不会把站点锁死）。
 */
export const SPOILER_STATE_KEY = 'alien-dict-spoiler';   // on / off

export const SPOILER_BOOT = `(function () {
  var off = false;
  try { off = localStorage.getItem('${SPOILER_STATE_KEY}') === 'off'; } catch (err) {}
  if (off) return;
  var root = document.documentElement;
  root.className += ' spoiler-on';
  var masked = root.getAttribute('data-masked-title');   // 标签页标题里也带着译文
  if (masked) document.title = masked;
})();`;
