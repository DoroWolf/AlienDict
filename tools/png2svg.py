#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""外星词典 · 字形转换器：16x16 点阵 PNG -> SVG（pixel 模式，逐墨点无损）

现有字形是纯 1-bit 点阵（alpha 只有 0/255，笔画宽恒为 1 像素），因此这里不做
任何平滑、拟合或贝塞尔化：把同一行相邻墨点合并成矩形，再把上下相邻的同宽矩形
纵向并成一根，得到与原位图完全一致、但可无限缩放且能用 CSS 换色的 <rect> 序列。

用法：
    python tools/png2svg.py --all                 # glyph/*.png -> glyph/svg/*.svg
    python tools/png2svg.py one.png first.png     # 指定若干字形
    python tools/png2svg.py --all --changed       # 只转比 SVG 新的 PNG（增量）
    python tools/png2svg.py --all --dry-run       # 只出报告，不写文件
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GLYPH_DIR = ROOT / "glyph"
DEFAULT_OUT_DIR = ROOT / "glyph" / "svg"
GRID = 16  # 设计字面框边长


def load_grid(path, threshold):
    """读 PNG，返回 (宽, 高, 0/1 点阵, 出现过的 alpha 值集合)。"""
    from PIL import Image

    img = Image.open(path).convert("RGBA")
    width, height = img.size
    pixels = img.load()
    alphas = set()
    grid = []
    for y in range(height):
        row = []
        for x in range(width):
            alpha = pixels[x, y][3]
            alphas.add(alpha)
            row.append(1 if alpha >= threshold else 0)
        grid.append(row)
    return width, height, grid, alphas


def grid_to_rects(grid):
    """点阵 -> 矩形列表 [[x, y, w, h], ...]（先按行合并，再纵向延长）。"""
    height = len(grid)
    width = len(grid[0]) if height else 0

    row_runs = []
    for y in range(height):
        runs = []
        x = 0
        while x < width:
            if grid[y][x]:
                start = x
                while x < width and grid[y][x]:
                    x += 1
                runs.append((start, x - start))
            else:
                x += 1
        row_runs.append(runs)

    rects = []
    open_runs = {}
    for y in range(height):
        current = set()
        for x, run_width in row_runs[y]:
            key = (x, run_width)
            index = open_runs.get(key)
            if index is not None and rects[index][1] + rects[index][3] == y:
                rects[index][3] += 1
            else:
                rects.append([x, y, run_width, 1])
                index = len(rects) - 1
            open_runs[key] = index
            current.add(key)
        for key in list(open_runs):
            if key not in current:
                del open_runs[key]
    return rects


def render_svg(width, height, label, rects):
    """pixel 模式 SVG：viewBox 就用点阵尺寸，1 单位 = 1 像素。"""
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"'
        ' width="{w}" height="{h}" shape-rendering="crispEdges"'
        ' role="img" aria-label="{label}">'.format(w=width, h=height, label=label)
    ]
    for x, y, w, h in rects:
        out.append(
            '<rect x="{}" y="{}" width="{}" height="{}" fill="currentColor"/>'.format(x, y, w, h)
        )
    out.append("</svg>")
    return "\n".join(out) + "\n"


def inspect(grid, alphas, threshold):
    """返回 (墨点数, bbox, 提示列表)。"""
    height = len(grid)
    width = len(grid[0]) if height else 0
    xs = [x for y in range(height) for x in range(width) if grid[y][x]]
    ys = [y for y in range(height) for x in range(width) if grid[y][x]]
    ink = len(xs)
    bbox = (min(xs), min(ys), max(xs), max(ys)) if xs else None

    notes = []
    if ink == 0:
        notes.append("空字形：没有任何墨点")
    if (width, height) != (GRID, GRID):
        notes.append("尺寸 {}x{}（设计框为 {}x{}）".format(width, height, GRID, GRID))
    if ink and alphas - {0, 255}:
        notes.append(
            "alpha 非二值（{} 级，已按阈值 {} 二值化）".format(len(alphas), threshold)
        )
    if ink:
        edges = []
        if min(xs) == 0:
            edges.append("左")
        if max(xs) == width - 1:
            edges.append("右")
        if min(ys) == 0:
            edges.append("上")
        if max(ys) == height - 1:
            edges.append("下")
        if edges:
            notes.append("墨点触及字面框{}缘（各字面框可能不统一）".format("、".join(edges)))
    return ink, bbox, notes


def convert(source, out_dir, args):
    """转换单个字形，返回 (状态, 报告文本)。状态：written / skipped / failed。"""
    if not source.exists():
        return "failed", "找不到字形文件：{}".format(source)
    try:
        width, height, grid, alphas = load_grid(source, args.threshold)
    except Exception as exc:  # 单个文件损坏不应中断整批转换
        return "failed", "{} 读取失败：{}".format(source.name, exc)

    target = out_dir / (source.stem + ".svg")
    ink, bbox, notes = inspect(grid, alphas, args.threshold)
    bbox_text = "{},{}-{},{}".format(*bbox) if bbox else "-"

    if args.changed and target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return "skipped", "{}  跳过（SVG 已是最新）".format(source.name)

    rects = grid_to_rects(grid)
    head = "{}  {}x{}  ink={}  rects={}  bbox={}".format(
        source.name, width, height, ink, len(rects), bbox_text
    )
    if args.dry_run:
        line = head + "  [dry-run]"
        for note in notes:
            line += "\n    ! " + note
        return "skipped", line

    target.write_text(render_svg(width, height, source.stem, rects), encoding="utf-8")
    shown = target.relative_to(ROOT) if target.is_relative_to(ROOT) else target
    line = head + "  -> {}".format(shown)
    for note in notes:
        line += "\n    ! " + note
    return "written", line


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="外星词典字形转换器：16x16 点阵 PNG -> SVG（pixel 模式）"
    )
    parser.add_argument("files", nargs="*", help="PNG 文件名（相对 glyph/）或路径")
    parser.add_argument("--all", action="store_true", help="转换 glyph/ 下全部 PNG")
    parser.add_argument("--glyph-dir", type=Path, default=DEFAULT_GLYPH_DIR, help="源目录")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="输出目录")
    parser.add_argument("--changed", action="store_true", help="仅当 PNG 比 SVG 新时才转换")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    parser.add_argument("--threshold", type=int, default=128, help="alpha 二值化阈值")
    parser.add_argument("--quiet", action="store_true", help="静默已写入的字形")
    args = parser.parse_args(argv)

    try:
        import PIL  # noqa: F401
    except ImportError:
        print("需要 Pillow：pip install Pillow", file=sys.stderr)
        return 2

    sources = []
    if args.all:
        sources.extend(sorted(args.glyph_dir.glob("*.png")))
    for name in args.files:
        path = Path(name)
        if not path.is_absolute():
            candidate = args.glyph_dir / path.name
            path = candidate if candidate.exists() else path
        sources.append(path)
    sources = list(dict.fromkeys(sources))  # 去重且保序

    if not sources:
        print("没有可转换的字形：请用 --all 或指定 PNG 文件名。", file=sys.stderr)
        return 2

    if not args.dry_run:
        args.out_dir.mkdir(parents=True, exist_ok=True)

    counts = {"written": 0, "skipped": 0, "failed": 0}
    for source in sources:
        status, line = convert(source, args.out_dir, args)
        counts[status] += 1
        if args.quiet and status == "written":
            continue
        print(line, file=sys.stderr if status == "failed" else sys.stdout)

    print(
        "汇总：写入 {}，跳过 {}，失败 {}（源 {} -> 输出 {}）".format(
            counts["written"],
            counts["skipped"],
            counts["failed"],
            args.glyph_dir,
            args.out_dir,
        )
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
