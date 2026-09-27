#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""词条校对（只读）：机械性检查 data/entries/*.yaml，不修改任何文件。

检查项：
  1. 词性对不上：原文写「X be <pos>」，中译却不是「<中译>是<词性>」
  2. 释义缺词头：中译里没出现词头的中译（多半是复制粘贴串了词）
  3. 词素句式首词不是本词 id（构建也会警告）
  4. zh 撞车：不同 id 用了同一个中译
  5. 文件名与 id 不一致
  6. 中译为空 / en 为空
  7. 原文引用了不存在的 id（待补词条）
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
ENTRY_DIR = ROOT / "data" / "entries"

POS_ZH = {
    "noun": "名词",
    "verb": "动词",
    "adjective": "形容词",
    "conjunction": "连词",
    "preposition": "介词",
    "numeral": "数词",
    "adverb": "副词",
    "pronoun": "代词",
}


def words(items):
    return [str(x).strip() for x in (items or []) if str(x).strip()]


def main():
    entries = {}
    order = []
    for path in sorted(ENTRY_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        eid = str(data.get("id") or path.stem)
        data["_file"] = path.name
        data["_id"] = eid
        entries[eid] = data
        order.append(eid)

    problems = defaultdict(list)

    for eid in order:
        e = entries[eid]
        zh = str(e.get("zh") or "")
        if e["_file"] != eid + ".yaml":
            problems["文件名与 id 不一致"].append("{} -> id {}".format(e["_file"], eid))
        if not zh:
            problems["zh 为空"].append(eid)
        if not str(e.get("en") or ""):
            problems["en 为空"].append(eid)

        for index, item in enumerate(e.get("meanings") or [], 1):
            if not isinstance(item, dict):
                continue
            tokens = words(item.get("alien"))
            mzh = str(item.get("zh") or "")
            if not tokens or tokens == ["\\n"]:
                continue          # 空行分隔行（额外换一行），本来就没有中译
            if not mzh:
                problems["含义缺中译"].append("{} 第 {} 条".format(eid, index))
                continue
            # 1/2：词性句
            if len(tokens) == 3 and tokens[1] == "be":
                pos = POS_ZH.get(tokens[2])
                if pos and not mzh.endswith("是" + pos):
                    problems["词性对不上"].append(
                        "{} 第 {} 条：原文 be {}，中译「{}」".format(eid, index, tokens[2], mzh)
                    )
            # 3：本词出现的含义里应带上词头中译
            if tokens and tokens[0] == eid and "of" not in tokens and zh and zh not in mzh:
                problems["中译缺词头"].append(
                    "{} 第 {} 条：「{}」（词头中译 {}）".format(eid, index, mzh, zh)
                )
            # 词素句式首词
            if len(tokens) >= 4 and tokens[1:4] == ["of", "morpheme", "be"] and tokens[0] != eid:
                problems["词素句式首词不对"].append(
                    "{} 第 {} 条：首词是 {}".format(eid, index, tokens[0])
                )

    # 4：zh 撞车
    by_zh = defaultdict(list)
    for eid in order:
        by_zh[str(entries[eid].get("zh") or "")].append(eid)
    for zh, ids in sorted(by_zh.items()):
        if len(ids) > 1:
            problems["zh 撞车"].append("{}：{}".format(zh, "、".join(ids)))

    # 7：待补 id
    pending = set()
    for eid in order:
        e = entries[eid]
        for item in e.get("meanings") or []:
            if not isinstance(item, dict):
                continue
            for token in words(item.get("alien")):
                if token.isdigit() or token.startswith("("):
                    continue
                if token not in entries:
                    pending.add(token)

    for title in (
        "文件名与 id 不一致",
        "zh 为空",
        "en 为空",
        "含义缺中译",
        "词性对不上",
        "中译缺词头",
        "词素句式首词不对",
        "zh 撞车",
    ):
        items = problems.get(title) or []
        print("[{}] {}".format(title, len(items)))
        for line in items:
            print("    " + line)
    print("[待补 id] {}".format(len(pending)))
    print("    " + "、".join(sorted(pending)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
