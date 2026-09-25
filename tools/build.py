#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""外星词典 · 站点构建器

    data/entries/*.yaml + glyph/ + templates/ + assets/fonts/  ->  site/

一个词一页：词头左＝放大的外星字形（原文），右＝中英释义（译文）；义项同样是
「原文｜译文」两栏。字形为内联 SVG（随主题变色），文字使用 GNU Unifont（自动子集化为 woff2）。

原文写法（字符串或列表皆可）：列表元素即一个词，元素 `""`＝空一个字符大小的空格（字符串里
的空格等价）；`\n`＝换一行（分行渲染）；整个词被括号框住（如 `(be)`）＝该词不跳转（虚词等），
纯数字 token 同样不跳转。词与词之间不会自动补任何符号。

用法：
    python tools/build.py
    python tools/build.py --only one
    python tools/build.py --no-font        # 跳过字库子集化（改数据时用，快）
    python tools/build.py --clean
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

try:
    import yaml
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    from markupsafe import Markup, escape
except ImportError as exc:  # pragma: no cover
    sys.exit("缺少依赖 {}：pip install pyyaml jinja2".format(exc.name))

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ENTRY_DIR = DATA_DIR / "entries"
LEXICON_FILE = DATA_DIR / "lexicon.yaml"
GLYPH_DIR = ROOT / "glyph"
SVG_DIR = GLYPH_DIR / "svg"
TEMPLATE_DIR = ROOT / "templates"
STATIC_DIR = TEMPLATE_DIR / "static"
FONT_DIR = ROOT / "assets" / "fonts"
DEFAULT_OUT = ROOT / "site"

VIEWBOX_RE = re.compile(r'viewBox="([^"]+)"')
SVG_INNER_RE = re.compile(r"<svg[^>]*>(.*)</svg>", re.S)

# 纯数字 token：数字不是正式词，出现在原文里也不跳转
NUMBER_RE = re.compile(r"^\d+$")

# 括号（半角/全角）：整个词被括号框住时（如 "(be)"）只显示字形、不跳转；空括号 () 等同于一个空格。
# 只认「整词被框住」，id 里自带括号的词（如 right_(direction)）才不会被拆成两个词。
PAREN_TOKEN_RE = re.compile(r"^[（(]([^（()）]*)[）)]$")

# 空格 token：原文里的空位，空一个字符大小（元素 "" 与字符串里的空格都是它）
SPACE = ""

# 词素句式：「X of morpheme be A and B」＝ X 由词素 A、B 构成（X＝本词 id）
MORPHEME_MARK = ("of", "morpheme", "be")

# 基础词素句式：「X be base morpheme」＝ X 是基础词素
BASE_MARK = ("base", "morpheme")

# 词素之间的连接词：不算词素
CONNECTORS = ("and", "or")

# 代码里动态拼出的提示文案：这些字不会出现在 data/ 里，但可能渲染到页面上，
# 需一并喂给字库子集化，避免届时时缺字
UI_TEXT = (
    "缺字形待补词条原文译文目录含义翻译不作正式词，：（）【】"
    "按词素找词清除个由构成含此在里基础不可再分点只看它再取消展开折叠经由"
)


def load_lexicon():
    data = yaml.safe_load(LEXICON_FILE.read_text(encoding="utf-8")) or {}
    for key, default in (("title", "外星词典"), ("description", ""), ("lang", "zh-CN")):
        data.setdefault(key, default)
    return data


def is_number(word_id):
    """纯数字不是正式词：原文里出现时只显示字形、不跳转。"""
    return NUMBER_RE.match(word_id) is not None


def scan_line(text):
    """一行原文 → token 列表：词是 (id, 是否可点)，空格是 SPACE。

    · 空格＝一个字符大小的空位（连着几个空格就是几个空位，元素 "" 也算一个）
    · 整个词被括号框住时（如 "(be)"）只显示字形、不跳转（虚词等）
    · 空括号 () 等同于一个空位；id 内部自带括号（如 right_(direction)）照旧算一个词
    · 词与词之间不会自动补任何符号
    """
    tokens = []
    for chunk in re.findall(r"\s+|\S+", text):
        if chunk.isspace():
            tokens.extend([SPACE] * len(chunk))
            continue
        wrapped = PAREN_TOKEN_RE.match(chunk)
        if wrapped:  # 整词被括号框住：只显示字形、不跳转
            inner = wrapped.group(1).strip()
            tokens.append((inner, False) if inner else SPACE)
            continue
        tokens.append((chunk, True))
    return tokens


def parse_alien(value):
    """原文 → 「行 → token」两层列表；空行（额外换一行）保留成空列表。

    写法（等价，可混用）：
        alien: ["one", "", "two", "and", "three"]   # 列表：元素即一个词，"" ＝一个空格
        alien: "one two and three"                  # 字符串：空格＝一个字符大小的空格
        alien: ["one", "", "\\n", "two"]              # 元素 "\\n" ＝额外换一行
    词与词之间不会自动补任何符号；要空一格就写元素 ""（或字符串里写空格）。
    """
    if value is None:
        return []
    elements = [value] if isinstance(value, (str, int)) else list(value)
    lines = [[]]
    for element in elements:
        text = str(element).replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
        if not text:
            lines[-1].append(SPACE)  # 空元素＝一个空格
            continue
        for index, chunk in enumerate(text.split("\n")):
            if index:
                lines.append([])
            lines[-1].extend(scan_line(chunk))
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return lines


def is_break_only(item):
    """含义是否只是一次「额外换一行」（即空行分隔行，无原文、无译文）。"""
    if isinstance(item, str):
        return not item.strip()
    if not isinstance(item, dict):
        return False
    if item.get("zh") or item.get("translation") or item.get("en") or item.get("english"):
        return False
    return item.get("alien") is not None and not parse_alien(item.get("alien"))


def load_entries(warnings):
    """读 data/entries/*.yaml。字段只有 id / glyph / translation / en / alien / meanings / order。"""
    entries = {}
    for path in sorted(ENTRY_DIR.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        eid = str(raw.get("id") or path.stem)
        if eid in entries:
            raise SystemExit("词条 id 重复：{}（{}）".format(eid, path.name))
        raw["id"] = eid
        raw["file"] = path.name
        # 字形文件名与 id / 英文释义解耦：缺省同名，需要时用 glyph 单独指定
        raw["glyph"] = str(raw.get("glyph") or eid)
        raw["translation"] = str(raw.get("translation") or eid)
        raw["en"] = str(raw.get("en") or "")
        if not raw["en"]:
            warnings.append("{}：缺 en（英文释义）".format(path.name))
        raw["alien"] = parse_alien(raw.get("alien")) or [[(eid, True)]]
        raw["meanings"] = normalize_meanings(raw, warnings)
        check_morpheme_lines(raw, warnings)
        entries[eid] = raw

    if not entries:
        raise SystemExit("没有词条：{} 下没有 *.yaml".format(ENTRY_DIR))

    seen = {}
    for entry in entries.values():
        order = entry.get("order")
        if isinstance(order, int):
            seen.setdefault(order, []).append(entry["id"])
        elif order is not None:
            warnings.append("{}：order 不是整数（{}）".format(entry["file"], order))
    for order, ids in sorted(seen.items()):
        if len(ids) > 1:
            warnings.append("字序 {} 被多个词条占用：{}".format(order, "、".join(ids)))
    return entries


def normalize_meanings(entry, warnings):
    """含义统一成 [{'alien': [[token...]], 'zh': '…', 'en': '…', 'blank': 是否空行分隔行}]；

    允许直接写字符串，也允许写一条只有 alien: "\\n" 的空行分隔行（额外换一行）。
    """
    result = []
    for index, item in enumerate(entry.get("meanings") or [], 1):
        if is_break_only(item):
            result.append({"alien": [], "zh": "", "en": "", "blank": True})
            continue
        if isinstance(item, str):
            result.append({"alien": [], "zh": item, "en": "", "blank": False})
        elif isinstance(item, dict):
            zh = str(item.get("zh") or item.get("translation") or "")
            en = str(item.get("en") or item.get("english") or "")
            if not zh and not en:
                warnings.append("{}：第 {} 条含义缺 zh/en".format(entry["file"], index))
            result.append(
                {"alien": parse_alien(item.get("alien")), "zh": zh, "en": en, "blank": False}
            )
        else:
            warnings.append(
                "{}：第 {} 条含义格式不对（应为字符串或 alien/zh/en 映射）".format(entry["file"], index)
            )
    return result


def sort_entries(entries):
    def key(entry):
        order = entry.get("order")
        return (0, order, entry["id"]) if isinstance(order, int) else (1, 0, entry["id"])

    return sorted(entries.values(), key=key)


def iter_alien_tokens(entry):
    """词条里所有原文 token（词头原文 + 各条含义的原文）：(词 id, 是否可点)。"""
    for lines in [entry["alien"]] + [m["alien"] for m in entry["meanings"]]:
        for line in lines:
            for token in line:
                if token != SPACE:
                    yield token


def words_of(lines):
    """原文 → 每行的词 id 列表（丢掉空格 token）。"""
    return [[t[0] for t in line if t != SPACE] for line in lines]


def morphemes_of(entry):
    """该词由哪些词素构成（「按词素找词」的正向关系）。

    数据里用句式「X of morpheme be A and B」表达（X＝本词）；也允许词条里直接写
    `morphemes: [a, b]` 显式指定（显式优先，便于句式写不下的场合）。连接词 and/or
    与本词自身不算词素。
    """
    explicit = entry.get("morphemes")
    if explicit is not None:
        if isinstance(explicit, str):
            explicit = [explicit]
        return [str(w).strip() for w in explicit if str(w).strip()]

    result = []
    for meaning in entry["meanings"]:
        for words in words_of(meaning["alien"]):
            for index in range(len(words) - 2):
                if tuple(words[index : index + 3]) != MORPHEME_MARK:
                    continue
                for token in words[index + 3 :]:
                    if token in CONNECTORS or token == entry["id"] or token in result:
                        continue
                    result.append(token)
                break
    return result


def base_morphemes_of(entry, entries):
    """本词最终由哪些基础词素构成。

    从原文直接写明的词素（morphemes_of）出发，遇到本身还能再拆的词素就往里继续拆，
    直到「基础词素」（原文里 `X be base morpheme`）或拆不动的（还没词条 / 没写明构成，
    如 (符号名)、待补词条）。返回 [(词素 id, 经由 id 列表)]：经由＝它是从哪个词素拆出来的，
    用来在提示里标一句「经由…」。
    """
    result = []
    seen = set()

    def walk(word, via, path):
        sub = entries.get(word)
        inner = morphemes_of(sub) if sub else []
        if not sub or is_base_morpheme(sub) or not inner or word in path:
            if word not in seen:      # 拆到基础词素或拆不动：就留它
                seen.add(word)
                result.append((word, via))
            return
        deeper = via + [word]
        for child in inner:
            walk(child, deeper, path | {word})

    for morpheme in morphemes_of(entry):
        walk(morpheme, [], frozenset([entry["id"]]))
    return result


def is_base_morpheme(entry):
    """「X be base morpheme」＝基础词素。"""
    for meaning in entry["meanings"]:
        for words in words_of(meaning["alien"]):
            if len(words) >= 2 and tuple(words[-2:]) == BASE_MARK:
                return True
    return False


def check_morpheme_lines(entry, warnings):
    """词素句式的首词应当是本词 id（写错多半是复制粘贴）。"""
    for index, meaning in enumerate(entry["meanings"], 1):
        for words in words_of(meaning["alien"]):
            if tuple(words[1:4]) == MORPHEME_MARK and words[0] != entry["id"]:
                warnings.append(
                    "{}：第 {} 条含义的词素句式首词是 {}，应为 {}".format(
                        entry["file"], index, words[0], entry["id"]
                    )
                )


def morpheme_index(ordered, entries):
    """基础词素 → 最终由它构成的词（按字序），用于「按词素找词」的反向索引。

    键是拆到底的基础词素（拆不动的符号/待补词素照旧算一份），值是所有（间接）用到它的词。
    """
    index = {}
    for entry in ordered:
        for morpheme, _via in base_morphemes_of(entry, entries):
            words = index.setdefault(morpheme, [])
            if entry["id"] not in words:
                words.append(entry["id"])
    return index


def collect_pending(entries):
    """原文里引用到、但没有对应词条的正式词 id。

    括号框住的词（虚词等）与纯数字不作正式词，不算待补。
    """
    pending = []
    for entry in entries.values():
        for word_id, link in iter_alien_tokens(entry):
            if not link or word_id in entries or is_number(word_id) or word_id in pending:
                continue
            pending.append(word_id)
    return pending


def gloss(entry):
    """中英释义：中文（英文），缺一边时只给有的那边。"""
    zh = str(entry.get("translation") or "")
    en = str(entry.get("en") or "")
    if zh and en:
        return "{}（{}）".format(zh, en)
    return zh or en or entry["id"]


def glyph_node(word_id, entries, root, link=True, nested=True, plain=False):
    """一个外星词的字形。

    link   —— 这个 token 本身是否可点跳转（括号框住的词、纯数字＝不可点）
    nested —— 是否允许在此生成 <a>（目录卡片整块已是链接，传 False）
    plain  —— 只作装饰（如词素徽章里的字形）：不生成 <a>，也不用「不作正式词」的提示
    """
    entry = entries.get(word_id)
    label = gloss(entry) if entry else word_id
    name = str(entry["glyph"]) if entry else word_id
    svg_path = SVG_DIR / (name + ".svg")
    png_path = GLYPH_DIR / (name + ".png")

    if svg_path.exists():
        text = svg_path.read_text(encoding="utf-8")
        viewbox = VIEWBOX_RE.search(text)
        inner = SVG_INNER_RE.search(text)
        glyph = (
            '<svg class="gl__glyph" viewBox="{}" role="img" aria-label="{}"'
            ' shape-rendering="crispEdges" focusable="false">{}</svg>'.format(
                viewbox.group(1) if viewbox else "0 0 16 16",
                escape(label),
                inner.group(1).strip() if inner else "",
            )
        )
    elif png_path.exists():
        glyph = (
            '<img class="gl__glyph glyph--png" src="{}assets/glyph/{}" alt="{}"'
            ' width="16" height="16">'.format(root, png_path.name, escape(label))
        )
    else:
        return Markup('<span class="gl__none" title="缺字形：{}">?</span>'.format(escape(word_id)))

    if plain:
        if entry:
            return Markup(
                '<span class="gl__word" title="{}">{}</span>'.format(escape(label), glyph)
            )
        return Markup(
            '<span class="gl__pending" title="待补词条：{}">{}</span>'.format(escape(word_id), glyph)
        )
    if entry and link and nested and not is_number(word_id):
        return Markup(
            '<a class="gl__link" href="{}w/{}.html" title="{}">{}</a>'.format(
                root, word_id, escape(label), glyph
            )
        )
    if is_number(word_id) or not link:
        # 虚词（原文里用括号框住）与数字：字形照常显示，不跳转
        return Markup(
            '<span class="gl__nonlink" title="不作正式词，不跳转：{}">{}</span>'.format(
                escape(label), glyph
            )
        )
    if entry:
        return Markup('<span class="gl__word" title="{}">{}</span>'.format(escape(label), glyph))
    return Markup('<span class="gl__pending" title="待补词条：{}">{}</span>'.format(escape(word_id), glyph))


def render_alien(lines, entries, root, link=True, nested=True, css="gl"):
    """原文：每个元素一行（空行＝额外换一行）；词间不补符号，空格 token 空一个字符大小。"""
    rendered = []
    for line in lines:
        if not line:
            rendered.append('<span class="{} gl--blank" aria-hidden="true"></span>'.format(css))
            continue
        parts = []
        for token in line:
            if token == SPACE:
                parts.append('<span class="gl__space" aria-hidden="true"></span>')
                continue
            word_id, word_link = token
            parts.append(str(glyph_node(word_id, entries, root, word_link and link, nested)))
        rendered.append('<span class="{}">{}</span>'.format(css, "".join(parts)))
    return Markup('<span class="gl-lines">{}</span>'.format("".join(rendered)))


def chip_body(word_id, entries, root, count=None):
    """词素徽章的内容：小字形 + 中译（+ 灰英文 + 派生词数）。"""
    entry = entries.get(word_id)
    glyph = glyph_node(word_id, entries, root, link=False, nested=False, plain=True)
    zh = escape(str(entry["translation"])) if entry else escape(word_id)
    body = '<span class="chip__glyph">{}</span><span class="chip__zh">{}</span>'.format(glyph, zh)
    if entry and entry["en"]:
        body += '<span class="chip__en">{}</span>'.format(escape(str(entry["en"])))
    if count is not None:
        body += '<span class="chip__n">{}</span>'.format(int(count))
    return body


def chip_node(word_id, entries, root, count=None, via=None):
    """词素徽章（链接版）：整块可点，跳到该词的词条页；还没词条的用虚线标出。

    via —— 这个基础词素是从哪个词素拆出来的（拆解链），只写进提示里。
    """
    entry = entries.get(word_id)
    label = gloss(entry) if entry else "待补词条：{}".format(word_id)
    if via:
        label += " · 经由 {}".format("、".join(gloss(entries.get(w)) if entries.get(w) else w for w in via))
    if entry:
        return Markup(
            '<a class="chip" href="{}w/{}.html" title="{}">{}</a>'.format(
                root,
                word_id,
                escape(label),
                chip_body(word_id, entries, root, count),
            )
        )
    return Markup(
        '<span class="chip chip--pending" title="{}">{}</span>'.format(
            escape(label), chip_body(word_id, entries, root, count)
        )
    )


def morpheme_button(word_id, entries, root, words):
    """目录页的词素按钮：点一下只看由它构成的词（数据放在 data-* 上，JS 无需再取数据）。"""
    entry = entries.get(word_id)
    label = gloss(entry) if entry else "待补词条：{}".format(word_id)
    return Markup(
        '<button class="chip chip--morph{}{}" type="button" data-morpheme="{}" data-words="{}"'
        ' data-zh="{}" aria-pressed="false" title="{}">{}</button>'.format(
            " chip--pending" if not entry else "",
            " chip--base" if entry and is_base_morpheme(entry) else "",
            escape(word_id),
            escape(" ".join(words)),
            escape(str(entry["translation"]) if entry else word_id),
            escape(label),
            chip_body(word_id, entries, root, len(words)),
        )
    )


def morph_context(entry, entries, morphs, root):
    """词条页「词素」区块：本词最终由哪些基础词素构成 + 含此词素的词。"""
    return {
        "morphemes": [
            {"id": word, "chip": chip_node(word, entries, root, via=via)}
            for word, via in base_morphemes_of(entry, entries)
        ],
        "derived": [
            {"id": word, "chip": chip_node(word, entries, root)}
            for word in morphs.get(entry["id"], [])
        ],
        "base": is_base_morpheme(entry),
    }


def morpheme_groups(ordered, entries, morphs, root):
    """目录页「按词素找词」的一组词素：徽章（按钮）＝筛选开关。

    徽章上的数字＝含此词素的词数，由它（间接）构成的词 + 它自己（有词条时）；
    词素自己的词条页就从筛选结果里的那张卡片进，不再单独给一个「词条」链接。
    词多的在前，其次按字序。
    """
    order = {entry["id"]: index for index, entry in enumerate(ordered)}
    items = []
    for mor, derived in morphs.items():
        words = list(derived)
        if mor in entries and mor not in words:
            words.append(mor)      # 词素自己也是一个含此词素的词
        items.append((mor, words))
    items.sort(key=lambda pair: (-len(pair[1]), order.get(pair[0], len(ordered)), pair[0]))
    return [
        {
            "id": mor,
            "count": len(words),
            "button": morpheme_button(mor, entries, root, words),
        }
        for mor, words in items
    ]


def build(out_dir, only=None, quiet=False, clean=False, font=True):
    warnings = []
    lexicon = load_lexicon()
    entries = load_entries(warnings)
    ordered = sort_entries(entries)
    pending = collect_pending(entries)
    morphs = morpheme_index(ordered, entries)

    svg_count = len(list(SVG_DIR.glob("*.svg")))
    png_count = len(list(GLYPH_DIR.glob("*.png")))

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )

    total = len(ordered)

    # 就地更新产物：不用 rmtree 全删（Windows 下有一个文件被占用就会中断在中途）
    if clean and out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "w").mkdir(parents=True, exist_ok=True)
    assets = out_dir / "assets"
    (assets / "glyph").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(STATIC_DIR / "style.css", assets / "style.css")
    for png in sorted(GLYPH_DIR.glob("*.png")):
        shutil.copyfile(png, assets / "glyph" / png.name)

    expected = {"index.html", "assets/style.css", "assets/search-index.js"}
    expected |= {"assets/glyph/{}".format(p.name) for p in GLYPH_DIR.glob("*.png")}

    written = []
    for index, entry in enumerate(ordered):
        eid = entry["id"]
        if only and eid not in only:
            continue
        meanings = [
            {
                "alien": render_alien(m["alien"], entries, "../") if m["alien"] else None,
                "zh": m["zh"],
                "en": m["en"],
                "blank": m["blank"],
            }
            for m in entry["meanings"]
        ]
        html = env.get_template("entry.html.j2").render(
            site=lexicon,
            entry=entry,
            root="../",
            alien_head=render_alien(entry["alien"], entries, "../", nested=False, css="gl gl--lg"),
            meanings=meanings,
            morph=morph_context(entry, entries, morphs, "../"),
            prev=ordered[index - 1] if index > 0 else None,
            next=ordered[index + 1] if index + 1 < total else None,
        )
        (out_dir / "w" / "{}.html".format(eid)).write_text(html, encoding="utf-8")
        expected.add("w/{}.html".format(eid))
        written.append(eid)

    # 目录页卡片：整块已是链接，字形链本身不再嵌套链接
    cards = {
        entry["id"]: render_alien(entry["alien"], entries, "", nested=False)
        for entry in ordered
    }
    index_html = env.get_template("index.html.j2").render(
        site=lexicon,
        ordered=ordered,
        root="",
        cards=cards,
        pending=pending,
        total=total,
        morphemes=morpheme_groups(ordered, entries, morphs, ""),
        morpheme_total=len(morphs),
    )
    (out_dir / "index.html").write_text(index_html, encoding="utf-8")

    items = [
        {
            "id": entry["id"],
            "zh": str(entry["translation"]),
            "en": str(entry["en"]),
            "gloss": gloss(entry),
            "url": "w/{}.html".format(entry["id"]),
        }
        for entry in ordered
    ]
    (assets / "search-index.js").write_text(
        "window.LEXICON = " + json.dumps(items, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )

    # 字库子集化：扫描刚生成的 HTML，把 5 MB 的 Unifont 裁成站点实际用到的字符
    font_stats = None
    if font:
        try:
            from subset_font import build_subset

            sources = sorted(FONT_DIR.glob("unifont*.otf"))
            if not sources:
                raise FileNotFoundError("{} 下找不到 unifont*.otf".format(FONT_DIR))
            font_stats = build_subset(
                font_path=sources[0],
                out_path=assets / "fonts" / "unifont.woff2",
                scan_dir=out_dir,
                extra=UI_TEXT,
            )
            expected.add("assets/fonts/unifont.woff2")
        except ImportError:
            warnings.append("未装 fontTools/brotli，跳过字库子集化（文字将回退系统等宽字体）")
        except Exception as exc:
            warnings.append("字库子集化失败：{}".format(exc))
    elif not (assets / "fonts" / "unifont.woff2").exists():
        warnings.append("--no-font 且无既存 unifont.woff2，文字将回退系统等宽字体")
    else:
        # 跳过子集化也要保住既有的字库，别让它被当成多余产物清掉
        expected.add("assets/fonts/unifont.woff2")

    removed = []
    if not only:
        for path in sorted(out_dir.rglob("*")):
            if path.is_dir():
                continue
            rel = path.relative_to(out_dir).as_posix()
            if rel in expected:
                continue
            try:
                path.unlink()
                removed.append(rel)
            except OSError as exc:
                warnings.append("无法删除多余产物 {}：{}".format(rel, exc))

    if not quiet:
        print(
            "[词条] {} 个（字序已定 {}）".format(
                total, sum(1 for e in ordered if isinstance(e.get("order"), int))
            )
        )
        if pending:
            print("[待补] {} 个 id 被原文引用但无词条：{}".format(len(pending), "、".join(pending)))
        covered = sum(1 for entry in ordered if morphemes_of(entry))
        print(
            "[词素] {} 个词素，{} / {} 个词写明了构成词素".format(len(morphs), covered, total)
        )
        print("[字形] SVG {} / PNG {}".format(svg_count, png_count))
        if svg_count < png_count:
            print("       ! {} 个字形尚未转 SVG（python tools/png2svg.py --all）".format(png_count - svg_count))
        if font_stats:
            print(
                "[字库] unifont.woff2 {:.0f} KB（{} 字符，源字体 {:.1f} MB）".format(
                    font_stats["bytes"] / 1024,
                    font_stats["chars"],
                    font_stats["source_bytes"] / 1024 / 1024,
                )
            )
        for warning in warnings:
            print("[警告] {}".format(warning))
        if removed:
            shown = "、".join(removed[:5]) + ("…" if len(removed) > 5 else "")
            print("[清理] 删除多余产物 {} 个：{}".format(len(removed), shown))
        print("[输出] {} —— {} 页 + 目录".format(out_dir, len(written)))
    return warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description="外星词典站点构建器")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="输出目录")
    parser.add_argument("--only", nargs="+", metavar="ID", help="只重建指定词条的页面")
    parser.add_argument("--clean", action="store_true", help="先清空输出目录再构建")
    parser.add_argument("--no-font", action="store_true", help="跳过字库子集化（改数据时更快）")
    parser.add_argument("--quiet", action="store_true", help="静默")
    args = parser.parse_args(argv)

    if args.only:
        known = {path.stem for path in ENTRY_DIR.glob("*.yaml")}
        unknown = [eid for eid in args.only if eid not in known]
        if unknown:
            sys.exit("没有这些词条：{}".format("、".join(unknown)))
        args.only = set(args.only)

    build(args.out, args.only, args.quiet, args.clean, not args.no_font)
    return 0


if __name__ == "__main__":
    sys.exit(main())
