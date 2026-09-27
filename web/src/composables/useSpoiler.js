/* 外星词典 · 防剧透（内置功能）
 *
 * 译文（中文释义、英文释义、词素徽章上的文字、前后导航的词名、带释义的提示与读屏文案）
 * 默认就遮住，点一下要先过一道「剧透警告」弹窗才揭开；原文＝外星字形从不遮挡。
 * 没有开关配置：状态记在浏览器 localStorage（alien-dict-spoiler = on / off），
 * 页头那个按钮只是这个状态的显示与切换。
 *
 * 约定（写在组件与 tools/lib/props.mjs 里）：
 *   data-spoiler        —— 要遮的文本节点：点它弹警告，确认后加 .is-revealed 揭开
 *   data-spoiler-direct —— 遮着也直接点得动（左右词条链接）：点击直接跳转，不弹警告、不揭开
 *   data-spoiler-title  —— title 里含释义的元素：遮住时换成一句提示，揭开后换回原话
 *   data-spoiler-label  —— 字形上的 aria-label / alt 含释义：同样换成提示（读屏也别剧透）
 * 遮挡与否只由 <html class="spoiler-on"> 决定；早于首帧的加类在页面外壳的内联脚本里完成
 * （见 tools/lib/shell.mjs 与 composables/spoilerBoot.mjs），译文不会先闪一下。
 * 没有 JS 时不会加这个类 ＝ 内容照常可读（不会把站点锁死）。
 * 服务端与首帧都渲染成「开」，挂载后再按 localStorage 校准，保证水合前后一致。
 */
import { onMounted, onUnmounted, reactive } from 'vue';
import { SPOILER_STATE_KEY } from './spoilerBoot.mjs';

const HINT = '防剧透：已隐藏释义';
const TEXT_ONE = '此处是可能导致游戏剧透的内容。确定吗？';
const TEXT_ALL = '关闭防剧透后，全站的译文都会显示。强烈建议首先通关游戏。确定吗？';
const TEXT_SEARCH = '搜索词汇可能会导致游戏剧透。确定吗？';

export function useSpoiler() {
  const state = reactive({
    on: true,                 // 遮住（开）/ 显示（关）
    label: '防剧透：开',
    pressed: 'true',
    modalOpen: false,
    modalText: TEXT_ONE,
    toggle,
    askBeforeSearch,
    confirm,
    cancel,
  });

  let pendingAction = null;
  let lastFocus = null;
  let searchAsked = false;    // 搜字那一次警告，问过就不再重复（状态一变重新算）

  function isRevealed(el) {
    return el.classList.contains('is-revealed');
  }

  function syncToggle() {
    state.label = state.on ? '防剧透：开' : '防剧透：关';
    state.pressed = state.on ? 'true' : 'false';
  }

  /** title 里带释义的元素：遮住时只给一句提示，揭开（或关掉防剧透）后换回真文案 */
  function syncTitles() {
    document.querySelectorAll('[data-spoiler-title]').forEach((el) => {
      el.title = state.on && !isRevealed(el) ? HINT : el.getAttribute('data-spoiler-title');
    });
  }

  /** 字形上的 aria-label / alt 同理（svg 用 aria-label，回退位图用 alt） */
  function syncLabels() {
    document.querySelectorAll('[data-spoiler-label]').forEach((el) => {
      const text = state.on && !isRevealed(el) ? HINT : el.getAttribute('data-spoiler-label');
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
      else el.alt = text;
    });
  }

  /** 标签页标题也带着译文：遮着时只留站点名（早于首帧那一段已在 spoilerBoot 里换过） */
  function syncPageTitle() {
    const root = document.documentElement;
    const full = root.getAttribute('data-page-title');
    const masked = root.getAttribute('data-masked-title');
    if (full && masked) document.title = state.on ? masked : full;
  }

  function apply() {
    document.documentElement.classList.toggle('spoiler-on', state.on);
    if (state.on) {   // 重新开启：一切回到遮住状态
      document.querySelectorAll('[data-spoiler].is-revealed').forEach((el) => el.classList.remove('is-revealed'));
    }
    syncToggle();
    syncTitles();
    syncLabels();
    syncPageTitle();
  }

  function remember(on) {
    try {
      localStorage.setItem(SPOILER_STATE_KEY, on ? 'on' : 'off');
    } catch (err) {
      /* 隐私模式 / 禁用存储：忽略，本次会话照常生效 */
    }
  }

  function setOn(on, persist) {
    state.on = Boolean(on);
    searchAsked = false;      // 遮 / 显示 一变，下次搜字重新问一遍
    if (persist) remember(state.on);
    apply();
  }

  /* ── 剧透警告弹窗 ───────────────────────────────── */
  function openModal(text, action) {
    pendingAction = action;
    lastFocus = document.activeElement;
    state.modalText = text;
    state.modalOpen = true;
    document.documentElement.classList.add('modal-open');
  }

  function cancel() {
    if (!state.modalOpen) return;
    state.modalOpen = false;
    pendingAction = null;
    document.documentElement.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function confirm() {
    const action = pendingAction;
    cancel();
    if (action) action();
  }

  /* ── 页头按钮：遮着时点它＝关掉（全站确定，先过警告）；关着时点它＝立刻开回来 ── */
  function toggle() {
    if (!state.on) {
      setOn(true, true);
      return;
    }
    openModal(TEXT_ALL, () => setOn(false, true));
  }

  /* ── 搜字：遮着时先过一遍警告（搜字是按译文找词，得先看得见译文） ── */
  function askBeforeSearch() {
    if (!state.on || searchAsked) return;
    searchAsked = true;   // 问过一次就不再打断；遮 / 显示 状态一变会重新置位
    openModal(TEXT_SEARCH, () => setOn(false, true));
  }

  /* ── 点被遮住的译文：先警告，确认后只揭开这一处 ── */
  function onClick(ev) {
    if (!state.on || !ev.target || !ev.target.closest) return;
    const el = ev.target.closest('[data-spoiler]');
    if (!el || isRevealed(el)) return;
    if (el.closest('[data-spoiler-direct]')) return;   // 左右词条链接：遮着也直接跳转
    ev.preventDefault();          // 卡片 / 徽章本身就是链接：先别跳走
    ev.stopPropagation();
    openModal(TEXT_ONE, () => {
      el.classList.add('is-revealed');
      syncTitles();
      syncLabels();
    });
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape' || ev.keyCode === 27) cancel();
  }

  onMounted(() => {
    try {
      state.on = localStorage.getItem(SPOILER_STATE_KEY) !== 'off';
    } catch (err) {
      /* 读不到就按默认「遮住」 */
    }
    apply();
    document.addEventListener('click', onClick, true);   // 捕获阶段拦下，先于链接默认行为
    document.addEventListener('keydown', onKeydown);
  });

  onUnmounted(() => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeydown);
  });

  return state;
}
