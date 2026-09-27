#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性脚本：词条格式迁移（跑完即删）。

    translation: 一        ->  zh: 一          # 顶层中译改名为 zh
        en: One is a ...   ->  （整行删除）      # 义项里的英译一律去掉

只动 data/entries/*.yaml 的这两处，逐字节改写以保留各文件原有的行尾（CRLF / LF）。
顶层 `en:`（词的英文释义）不动。
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY_DIR = ROOT / "data" / "entries"

TRANSLATION_RE = re.compile(rb"(?m)^translation:")
MEANING_EN_RE = re.compile(rb"(?m)^[ \t]+en:[^\r\n]*(?:\r?\n|$)")

changed, skipped = [], []
for path in sorted(ENTRY_DIR.glob("*.yaml")):
    raw = path.read_bytes()
    new, renamed = TRANSLATION_RE.subn(b"zh:", raw)
    new, dropped = MEANING_EN_RE.subn(b"", new)
    if not renamed and not dropped:
        skipped.append(path.name)
        continue
    path.write_bytes(new)
    changed.append((path.name, renamed, dropped))

print("改了 {} 个词条（共去掉 {} 行义项英译）".format(len(changed), sum(c[2] for c in changed)))
odd = [c for c in changed if c[1] != 1]
if odd:
    print("注意：顶层 translation 出现次数不是 1 的：")
    for name, renamed, _dropped in odd:
        print("  {}  translation={}".format(name, renamed))
if skipped:
    print("没动：{}".format("、".join(skipped)))
