#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""外星词典 · 字体子集化

GNU Unifont 是 16×16 点阵字体，覆盖整个 BMP（含全部汉字），但全字库 5.1 MB。
站点文字只来自 data/ 与模板，因此扫描产物即可得到精确字符集，
再用 fontTools 裁成 woff2（通常几十到几百 KB）。新增词条后重跑一遍即可。

用法：
    python tools/subset_font.py                      # 扫 site/ -> site/assets/fonts/unifont.woff2
    python tools/subset_font.py --extra "甲乙丙"      # 追加保底字符
    python tools/subset_font.py --scan dist --out dist/assets/fonts/unifont.woff2
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# fontTools 会为 Unifont 的低时间戳刷 warning，噪音太大，这里只留错误
logging.getLogger("fontTools").setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FONT = ROOT / "assets" / "fonts" / "unifont-18.0.01.otf"
DEFAULT_OUT = ROOT / "site" / "assets" / "fonts" / "unifont.woff2"
DEFAULT_SCAN = ROOT / "site"

# 保底字符：ASCII 可打印 + 常用中英标点，避免日后新增文本时缺字
SAFETY = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "，。、；：？！（）〔〕【】「」『』《》〈〉—…·～“”‘’％＋－×÷＝"
)


def collect_chars(scan_dir, extra=""):
    """汇总扫描目录下所有文本文件出现的字符 + 保底字符。"""
    chars = set(SAFETY) | set(extra)
    if scan_dir.exists():
        for pattern in ("*.html", "*.js", "*.css", "*.svg"):
            for path in scan_dir.rglob(pattern):
                chars |= set(path.read_text(encoding="utf-8", errors="ignore"))
    return {c for c in chars if c.isprintable()}


def build_subset(font_path=DEFAULT_FONT, out_path=DEFAULT_OUT, scan_dir=DEFAULT_SCAN, extra=""):
    """把字体裁成 scan_dir 里用到的字符，输出 woff2。返回统计信息。"""
    from fontTools import subset

    font_path = Path(font_path)
    out_path = Path(out_path)
    if not font_path.exists():
        raise FileNotFoundError("找不到字体文件：{}".format(font_path))

    chars = collect_chars(Path(scan_dir), extra)

    options = subset.Options()
    options.flavor = "woff2"
    options.desubroutinize = True
    # Unifont 的 OS/2 unicode range 会映射到第 123 位，而该字段只有 123 位（0–122），
    # fontTools 重算时会抛 "expected 0 <= int <= 122, found: 123"，故跳过这一步
    # （只影响 OS/2 里的 unicode range 位，对字形的正确性无影响）。
    options.prune_unicode_ranges = False
    if hasattr(options, "ignore_missing_unicodes"):
        options.ignore_missing_unicodes = True

    font = subset.load_font(str(font_path), options)
    try:
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=sorted(ord(c) for c in chars))
        subsetter.subset(font)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        subset.save_font(font, str(out_path), options)
    finally:
        font.close()

    return {
        "chars": len(chars),
        "bytes": out_path.stat().st_size,
        "source_bytes": font_path.stat().st_size,
        "out": out_path,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="外星词典字库子集化（woff2）")
    parser.add_argument("--font", type=Path, default=DEFAULT_FONT, help="源字体 .otf")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="输出 .woff2")
    parser.add_argument("--scan", type=Path, default=DEFAULT_SCAN, help="扫描目录（产物 HTML）")
    parser.add_argument("--extra", default="", help="追加保底字符")
    args = parser.parse_args(argv)

    try:
        stats = build_subset(args.font, args.out, args.scan, args.extra)
    except ImportError:
        print("需要 fontTools 与 brotli：pip install fonttools brotli", file=sys.stderr)
        return 2
    except Exception as exc:
        print("子集化失败：{}".format(exc), file=sys.stderr)
        return 1

    print(
        "子集完成：{} 字符 · {:.0f} KB -> {:.0f} KB · {}".format(
            stats["chars"],
            stats["source_bytes"] / 1024,
            stats["bytes"] / 1024,
            stats["out"],
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
