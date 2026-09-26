#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性脚本：给相关词条的 data/entries/<id>.yaml 顶部插一段 notes:（跑完即删）。"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
ENTRY_DIR = ROOT / "data" / "entries"

BASE_SEVEN = "外星人使用七进制，即满七进一。"
TIME_SCALE = "1 外星秒约等于 0.64 地球秒。外星人的星球没有类似月球的卫星。"
CHARGE_SIGN = "外星人的电荷正负规定与人类相反。"

NUMBERS = """zero one two three four five six seven fourteen twenty_one twenty_eight
thirty_five forty_two hundred thousand one_seventh two_sevenths three_sevenths four_seventh
five_sevenths six_sevenths half percent milli decimal scientific number numeral number_one
number_two number_three number_system count multiplier left_number right_number first second
third next_one previous_one positive negative""".split()

TIME = "time moment period past future alien_second alien_minute alien_hour alien_day alien_year".split()

CHARGE = "electric_charge electric_current positive negative proton electron attract repulse".split()

notes_of = {}
for word in NUMBERS:
    notes_of.setdefault(word, []).append(BASE_SEVEN)
for word in TIME:
    notes_of.setdefault(word, []).append(TIME_SCALE)
for word in CHARGE:
    notes_of.setdefault(word, []).append(CHARGE_SIGN)

by_id = {}
for path in sorted(ENTRY_DIR.glob("*.yaml")):
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    by_id[str(data.get("id") or path.stem)] = path

changed, missing = [], []
for word, notes in notes_of.items():
    path = by_id.get(word)
    if path is None:
        missing.append(word)
        continue
    raw = path.read_bytes()
    if re.search(rb"(?m)^notes:", raw):
        print("已有 notes，跳过：{}".format(path.name))
        continue
    match = re.search(rb"(?m)^(en:[^\r\n]*)(\r?\n)", raw)
    if not match:
        print("找不到 en: 行，跳过：{}".format(path.name))
        continue
    newline = match.group(2)
    block = newline.join([b"notes:"] + [("  - " + n).encode("utf-8") for n in notes]) + newline
    path.write_bytes(raw[: match.end(2)] + block + raw[match.end(2) :])
    changed.append(path.name)

print("改了 {} 个词条".format(len(changed)))
if missing:
    print("没有这些词条：{}".format("、".join(missing)))
