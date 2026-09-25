/* 外星词典 · 防剧透
 *
 * 默认开启：译文（中文释义、英文释义、词素徽章上的文字、前后导航的词名、以及带释义的提示）
 * 先遮住，点一下要先过一道「剧透警告」弹窗才揭开；原文＝外星字形从不遮挡。
 * 关掉开关＝全站显示译文（同样先过警告），状态记在 localStorage: alien-dict-spoiler = on / off。
 *
 * 约定（写在 templates/*.j2 与 tools/build.py 里）：
 *   data-spoiler        —— 要遮的文本节点：点它弹警告，确认后加 .is-revealed 揭开
 *   data-spoiler-title  —— title 里含释义的元素：遮住时换成一句提示，揭开后换回原话
 *   data-spoiler-label  —— 字形上的 aria-label / alt 含释义：同样换成提示（读屏也别剧透）
 * 遮挡与否只由 <html class="spoiler-on"> 决定；早于首帧的加类在 base.html.j2 的内联脚本里完成，
 * 这样译文不会先闪一下。没有 JS 时不会加这个类 ＝ 内容照常可读（不会把站点锁住）；
 * data/lexicon.yaml 里写 spoiler: false 则整套开关与弹窗都不输出。
 */
(function () {
  'use strict';

  var KEY = 'alien-dict-spoiler';                 // on / off
  var HINT = '防剧透：已隐藏释义，点一下显示';
  var HINT_LABEL = '防剧透：字形（释义已隐藏）';
  var TEXT_ONE = '这一处是外星词的译文（中文与英文释义）。确定要看吗？';
  var TEXT_ALL = '关闭防剧透后，全站的译文都会显示出来。确定要看吗？';

  var root = document.documentElement;
  var toggle = document.getElementById('spoiler-toggle');
  var modal = document.getElementById('spoiler-modal');
  var modalText = document.getElementById('spoiler-modal-text');
  var confirmBtn = document.getElementById('spoiler-confirm');
  var cancelBtn = document.getElementById('spoiler-cancel');
  var pendingAction = null;
  var lastFocus = null;
  /* 词条页的 <title> 里带着译文（如「一 one · 外星词典」）：遮住时只留末段的站点名 */
  var fullTitle = document.title;
  var titleParts = fullTitle.split(' · ');
  var siteTitle = titleParts[titleParts.length - 1];

  function isOn() {
    return root.classList.contains('spoiler-on');
  }

  function revealed(el) {
    return el.classList.contains('is-revealed');
  }

  /* title 里带释义的元素：遮住时只给一句提示，揭开（或关掉防剧透）后换回真文案 */
  function syncTitles() {
    var nodes = document.querySelectorAll('[data-spoiler-title]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (isOn() && !revealed(el)) {
        el.title = HINT;
      } else {
        el.title = el.getAttribute('data-spoiler-title');
      }
    }
  }

  /* 字形上的 aria-label / alt 同理（svg 用 aria-label，回退位图用 alt） */
  function syncLabels() {
    var nodes = document.querySelectorAll('[data-spoiler-label]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = isOn() && !revealed(el) ? HINT_LABEL : el.getAttribute('data-spoiler-label');
      if (el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', text);
      } else {
        el.alt = text;
      }
    }
  }

  function syncToggle() {
    if (!toggle) return;
    var on = isOn();
    toggle.textContent = on ? '防剧透：开' : '防剧透：关';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function syncDocTitle() {
    document.title = isOn() ? siteTitle : fullTitle;
  }

  function remember(on) {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch (err) {
      /* 隐私模式 / 禁用存储：忽略，本次会话照常生效 */
    }
  }

  function setOn(on, persist) {
    root.classList.toggle('spoiler-on', on);
    if (on) {   // 重新开启：一切回到遮住状态
      var nodes = document.querySelectorAll('[data-spoiler].is-revealed');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.remove('is-revealed');
      }
    }
    if (persist) remember(on);
    syncToggle();
    syncTitles();
    syncLabels();
    syncDocTitle();
  }

  /* ── 剧透警告弹窗 ───────────────────────────────── */
  function openModal(text, action) {
    if (!modal) {                  // 没有弹窗（不该发生）就直接放行，别把功能卡死
      if (action) action();
      return;
    }
    pendingAction = action;
    lastFocus = document.activeElement;
    if (modalText) modalText.textContent = text;
    modal.hidden = false;
    root.classList.add('modal-open');
    if (cancelBtn) cancelBtn.focus();   // 焦点默认落在「再想想」上，回车不会误揭
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    pendingAction = null;
    root.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (modal) {
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var action = pendingAction;
        closeModal();
        if (action) action();
      });
    }
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal || ev.target.hasAttribute('data-modal-close')) closeModal();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' || ev.keyCode === 27) closeModal();
    });
  }

  /* ── 点被遮住的译文：先警告，确认后只揭开这一处 ── */
  document.addEventListener('click', function (ev) {
    if (!isOn() || !ev.target || !ev.target.closest) return;
    var el = ev.target.closest('[data-spoiler]');
    if (!el || revealed(el)) return;
    ev.preventDefault();          // 卡片 / 徽章 / 前后导航本身就是链接：先别跳走
    ev.stopPropagation();
    openModal(TEXT_ONE, function () {
      el.classList.add('is-revealed');
      syncTitles();
      syncLabels();
    });
  }, true);                       // 捕获阶段拦下，先于链接默认行为与其他脚本

  /* ── 开关：开着时点它＝关掉（全站显示译文，先过警告）；关着时点它＝立刻开回来 ── */
  if (toggle) {
    toggle.addEventListener('click', function () {
      if (!isOn()) {
        setOn(true, true);
        return;
      }
      openModal(TEXT_ALL, function () {
        setOn(false, true);
      });
    });
  }

  syncToggle();
  syncTitles();
  syncLabels();
  syncDocTitle();
})();
