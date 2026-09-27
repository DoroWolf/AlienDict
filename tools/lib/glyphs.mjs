/* 外星词典 · 字形数据（Node 侧）
 *
 * glyph/svg/<名字>.svg（png2svg.py 产出）与 glyph/<名字>.png（回退位图）读成
 * 页面直接可用的数据：{ 名字: { vb: viewBox, inner: <rect…> } }。
 */
import fs from 'node:fs';
import path from 'node:path';
import { GLYPH_DIR, SVG_DIR } from './lexicon.mjs';

const VIEWBOX_RE = /viewBox="([^"]+)"/;
const SVG_INNER_RE = /<svg[^>]*>([\s\S]*)<\/svg>/;

function list(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(ext)).sort();
}

/** 全部内联 SVG 字形 + 有 PNG 的字形名字集合 */
export function loadGlyphs() {
  const glyphs = {};
  for (const name of list(SVG_DIR, '.svg')) {
    const text = fs.readFileSync(path.join(SVG_DIR, name), 'utf8');
    const inner = SVG_INNER_RE.exec(text);
    if (!inner) continue;                       // 坏文件忽略，同名 PNG 会顶上
    const viewBox = VIEWBOX_RE.exec(text);
    glyphs[name.replace(/\.svg$/, '')] = {
      vb: viewBox ? viewBox[1] : '0 0 16 16',
      inner: inner[1].trim(),
    };
  }
  const pngs = new Set(list(GLYPH_DIR, '.png').map((name) => name.replace(/\.png$/, '')));
  return { glyphs, pngs, svgCount: Object.keys(glyphs).length, pngCount: pngs.size };
}
