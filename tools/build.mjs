#!/usr/bin/env node
/* 外星词典 · 站点构建
 *
 *   data/entries/*.yaml + glyph/ + web/（Vue 组件） → site/
 *
 * 一个词一页：词头左＝放大的外星字形（原文），右＝中英释义（译文）；正文同样是
 * 「原文在上、译文在下」两栏。页面由 Vue 组件在构建时预渲染成静态 HTML（客户端再水合），
 * 每个页面只内联自己用到的数据，产物纯静态、双击可开、没有 JS 也能读。
 *
 * 前置：先跑 vite 的两个构建（npm run build 会按顺序做）
 *   vite build -c web/vite.config.mjs      → web/dist/client（app.js / app.css）
 *   vite build -c web/vite.ssr.config.mjs  → web/dist/server（预渲染用的 Vue SSR 入口）
 *
 * 用法：
 *   node tools/build.mjs
 *   node tools/build.mjs --only one        # 只重建某个词条的页面
 *   node tools/build.mjs --no-font         # 跳过字库子集化（改数据时快）
 *   node tools/build.mjs --clean           # 先清空输出目录
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, DEFAULT_OUT, isBaseMorpheme, isNonword, morphemesOf } from './lib/lexicon.mjs';
import { loadSite, buildIndexProps, buildEntryProps, buildWriteProps } from './lib/props.mjs';
import { renderShell } from './lib/shell.mjs';

const WEB_DIR = path.join(ROOT, 'web');
const CLIENT_DIR = path.join(WEB_DIR, 'dist', 'client');
const SERVER_ENTRY = path.join(WEB_DIR, 'dist', 'server', 'entry-server.js');
const STATIC_DIR = path.join(WEB_DIR, 'static');
const GLYPH_DIR = path.join(ROOT, 'glyph');

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, only: null, clean: false, font: true, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = path.resolve(argv[++i]);
    else if (arg === '--only') {
      args.only = new Set();
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.only.add(argv[++i]);
    } else if (arg === '--clean') args.clean = true;
    else if (arg === '--no-font') args.font = false;
    else if (arg === '--quiet') args.quiet = true;
    else throw new Error(`不认识的参数：${arg}`);
  }
  return args;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest);
    else copyFile(src, dest);
  }
}

async function build({ out, only, clean, font, quiet }) {
  const warnings = [];
  if (!fs.existsSync(SERVER_ENTRY)) throw new Error(`缺少预渲染入口 ${SERVER_ENTRY}：先跑 npm run build:ssr`);
  if (!fs.existsSync(path.join(CLIENT_DIR, 'app.js'))) {
    throw new Error(`缺少客户端产物 ${CLIENT_DIR}/app.js：先跑 npm run build:client`);
  }

  const data = loadSite();
  warnings.push(...data.warnings);
  const { render } = await import(pathToFileURL(SERVER_ENTRY).href);

  if (clean && fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'w'), { recursive: true });
  const assets = path.join(out, 'assets');
  fs.mkdirSync(path.join(assets, 'glyph'), { recursive: true });

  // 客户端脚本与样式：样式改名成 style.css（页面里固定引用 assets/style.css）
  copyFile(path.join(CLIENT_DIR, 'app.js'), path.join(assets, 'app.js'));
  copyFile(path.join(CLIENT_DIR, 'app.css'), path.join(assets, 'style.css'));
  copyDir(STATIC_DIR, assets);                                   // fonts.css 等原样拷贝
  const pngs = fs.existsSync(GLYPH_DIR)
    ? fs.readdirSync(GLYPH_DIR).filter((name) => name.endsWith('.png'))
    : [];
  for (const name of pngs) copyFile(path.join(GLYPH_DIR, name), path.join(assets, 'glyph', name));

  const expected = new Set(['index.html', 'write.html', 'assets/app.js', 'assets/style.css']);
  for (const name of fs.readdirSync(STATIC_DIR)) expected.add(`assets/${name}`);
  for (const name of pngs) expected.add(`assets/glyph/${name}`);

  // 页面外壳：标题与描述按页取（写作页没有词条，用固定文案）
  const shell = (props, appHtml) => renderShell({
    siteTitle: props.site.title,
    lang: props.site.lang,
    root: props.root,
    props,
    body: appHtml,
    ...(props.page === 'entry'
      ? { title: props.entry.title, description: props.entry.description }
      : props.page === 'write'
        ? {
          title: `外星写作 · ${props.site.title}`,
          description: `输入含义找到外星词，左键点字形写进写作栏。${props.site.description}`,
        }
        : { title: props.site.title, description: props.site.description }),
  });

  const written = [];

  // 词条页：一词一页
  for (const entry of data.ordered) {
    if (only && !only.has(entry.id)) continue;
    const props = buildEntryProps(data, entry.id, { root: '../' });
    const html = shell(props, await render(props));
    fs.writeFileSync(path.join(out, 'w', `${entry.id}.html`), html, 'utf8');
    expected.add(`w/${entry.id}.html`);
    written.push(entry.id);
  }

  // 目录页
  if (!only) {
    const props = buildIndexProps(data, { root: '' });
    const html = shell(props, await render(props));
    fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
  }

  // 写作页（整站唯一一页：全部词与字形都带上了，按含义搜索与写作都用它）
  if (!only) {
    const props = buildWriteProps(data, { root: '' });
    const html = shell(props, await render(props));
    fs.writeFileSync(path.join(out, 'write.html'), html, 'utf8');
    written.push('write.html');
  }

  // 字库（子集化出来的 unifont.woff2）：不管这轮是重建还是留着，它都是本站产物，
  // 先写进白名单 —— 子集化跑在下面的清理之后，不先登记就会被当成多余产物删掉
  const subsetFont = path.join(assets, 'fonts', 'unifont.woff2');
  expected.add('assets/fonts/unifont.woff2');

  // 清理多余产物：不整目录删除（Windows 下文件被占用会让全量删除中断），只删本轮没写到的
  const removed = [];
  if (!only) {
    for (const file of walk(out)) {
      const rel = path.relative(out, file).split(path.sep).join('/');
      if (expected.has(rel)) continue;
      try {
        fs.rmSync(file);
        removed.push(rel);
      } catch (err) {
        warnings.push(`无法删除多余产物 ${rel}：${err.message}`);
      }
    }
  }

  // 字库子集化：扫描刚写出的产物，把 5 MB 的 Unifont 裁成站点实际用到的字符
  let fontStats = null;
  if (font) {
    const result = spawnSync('python', [
      path.join(ROOT, 'tools', 'subset_font.py'),
      '--scan', out,
      '--out', subsetFont,
    ], { cwd: ROOT, encoding: 'utf8' });
    if (result.status === 0) {
      fontStats = { bytes: fs.statSync(subsetFont).size, source: fs.statSync(fontSourcePath()).size };
    } else {
      const detail = (result.stderr || result.stdout || '').trim().split('\n').pop();
      warnings.push(`字库子集化失败：${detail}`);
    }
  } else if (!fs.existsSync(subsetFont)) {
    warnings.push('--no-font 且无既存 unifont.woff2，文字将回退系统等宽字体');
  }

  if (!quiet) report({ data, out, written, removed, warnings, fontStats, only });
  return warnings;
}

function report({ data, out, written, removed, warnings, fontStats, only }) {
  const { entries, ordered, morphs, pending, svgCount, pngCount } = data;
  if (!only) {
    console.log(`[词条] ${ordered.length} 个（字序已定 ${ordered.filter((e) => Number.isInteger(e.order)).length}）`);
    if (pending.length) console.log(`[待补] ${pending.length} 个 id 被原文引用但无词条：${pending.join('、')}`);
    const nonword = [...morphs.keys()].filter((name) => entries[name] && isNonword(entries[name])).length;
    console.log(`[词素] ${morphs.size} 个词素（实义 ${morphs.size - nonword} / 非实义 ${nonword}），`
      + `${ordered.filter((entry) => morphemesOf(entry).length).length} / ${ordered.length} 个词写明了构成词素`);
    const base = ordered.filter((entry) => isBaseMorpheme(entry)).length;
    if (base) console.log(`[基础词素] ${base} 个（写明了「X be base morpheme」或整行以「X of morpheme be」收尾）`);
    const noted = ordered.filter((entry) => entry.notes.length);
    if (noted.length) {
      console.log(`[提示] ${noted.reduce((sum, entry) => sum + entry.notes.length, 0)} 条提示，`
        + `挂在 ${noted.length} / ${ordered.length} 个词条上`);
    }
    console.log(`[字形] SVG ${svgCount} / PNG ${pngCount}`);
    if (svgCount < pngCount) {
      console.log(`       ! ${pngCount - svgCount} 个字形尚未转 SVG（python tools/png2svg.py --all）`);
    }
  }
  if (fontStats) {
    console.log(`[字库] unifont.woff2 ${(fontStats.bytes / 1024).toFixed(0)} KB`
      + `（源字体 ${(fontStats.source / 1024 / 1024).toFixed(1)} MB）`);
  }
  for (const warning of warnings) console.log(`[警告] ${warning}`);
  if (removed.length) {
    const shown = removed.slice(0, 5).join('、') + (removed.length > 5 ? '…' : '');
    console.log(`[清理] 删除多余产物 ${removed.length} 个：${shown}`);
  }
  console.log(`[输出] ${out} —— ${written.length} 页${only ? '' : ' + 目录/写作'}`);
}

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) yield* walk(file);
    else yield file;
  }
}

function fontSourcePath() {
  const dir = path.join(ROOT, 'assets', 'fonts');
  const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((file) => /^unifont.*\.otf$/.test(file)) : null;
  return name ? path.join(dir, name) : '';
}

// 入口：构建失败就打印一行原因并以非零状态退出
build(parseArgs(process.argv.slice(2))).catch((err) => {
  console.error(`[失败] ${err.message}`);
  process.exit(1);
});

