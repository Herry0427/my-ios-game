#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 HowToCook（本地克隆）中与 pregnancy_recipes.title 匹配的菜谱 Markdown
解析为 ingredients / steps / difficulty / cooking_time / nutrition_insight，并 PATCH 到 Supabase。

前置：
  git clone https://github.com/Anduin2017/HowToCook.git ios_game/.vendor/HowToCook

用法（在 ios_game 目录）：
  python scripts/sync_howtocook_to_supabase.py --dry-run
  python scripts/sync_howtocook_to_supabase.py
  python scripts/sync_howtocook_to_supabase.py --min-ratio 0.72

许可说明：HowToCook 仓库使用 Unlicense（公有领域意图）。商用仍建议保留来源说明；
本脚本在 nutrition_insight 中追加简短参考声明。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from supabase_env_loader import load_supabase_env

HOWTO_ROOT_DEFAULT = ROOT / ".vendor" / "HowToCook"

# 数据库菜名 -> HowToCook 菜谱标题（与 md 内「# xxx的做法」一致）
TITLE_ALIASES: dict[str, str] = {
    # HowToCook 菜名与库内略有出入时可在此映射
    "西红柿山药牛腩": "西红柿牛腩",
}

AUX_HINTS = (
    "大蒜",
    "小葱",
    "大葱",
    "生姜",
    "老姜",
    "姜片",
    "蒜末",
    "蒜泥",
    "洋葱",
    "香菜",
    "小米辣",
    "干辣椒",
    "花椒",
    "淀粉",
)

CONDIMENT_HINTS = (
    "油",
    "盐",
    "酱",
    "醋",
    "糖",
    "蚝油",
    "料酒",
    "生抽",
    "老抽",
    "淀粉",
    "胡椒",
    "味精",
    "花椒",
    "八角",
    "桂皮",
    "香叶",
    "冰糖",
    "豆瓣",
    "豆豉",
    "干辣椒",
    "孜然",
    "芝麻",
    "鸡精",
)

ATTR_NOTE = (
    "【参考来源】步骤与配料改编自开源食谱 HowToCook（github.com/Anduin2017/HowToCook）；"
    "孕期个体差异大，具体禁忌请遵医嘱。"
)


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=120) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def fetch_all_recipes(base: str, anon: str) -> list[dict]:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
    }
    rows: list[dict] = []
    offset = 0
    page = 200
    while True:
        url = f"{base}/rest/v1/pregnancy_recipes?select=*&limit={page}&offset={offset}"
        code, data = http_json("GET", url, headers)
        if code != 200 or not isinstance(data, list):
            raise RuntimeError(f"GET recipes failed: {code} {data}")
        rows.extend(data)
        if len(data) < page:
            break
        offset += page
    return rows


def patch_recipe(base: str, anon: str, rid: str, body: dict) -> None:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{base}/rest/v1/pregnancy_recipes?id=eq.{quote(rid, safe='')}"
    code, data = http_json("PATCH", url, headers, body)
    if code not in (200, 204):
        raise RuntimeError(f"PATCH failed {code}: {data}")


def strip_db_suffix(title: str) -> str:
    return re.sub(r"（[^）]{1,40}）\s*$", "", title.strip())


def normalize_key(s: str) -> str:
    return re.sub(r"\s+", "", strip_db_suffix(s))


def dish_name_from_md(content: str, path: Path) -> str:
    m = re.search(r"^#\s*(.+?)的做法\s*$", content, re.MULTILINE)
    if m:
        return m.group(1).strip()
    return path.stem


def strip_md_comments(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    return text


def split_sections(md: str) -> dict[str, str]:
    md = strip_md_comments(md)
    sections: dict[str, str] = {}
    parts = re.split(r"(^##\s+[^\n]+\n)", md, flags=re.MULTILINE)
    current = "_head"
    sections[current] = parts[0] if parts else ""
    i = 1
    while i < len(parts):
        header_line = parts[i]
        title_m = re.match(r"^##\s+(.+)$", header_line.strip())
        sec_title = title_m.group(1).strip() if title_m else "unknown"
        body = parts[i + 1] if i + 1 < len(parts) else ""
        sections[sec_title] = body
        i += 2
    return sections


def extract_intro(head: str) -> str:
    lines = []
    for line in head.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("预估烹饪难度"):
            break
        if line.startswith("!["):
            continue
        lines.append(line)
    return " ".join(lines)[:400]


def parse_difficulty(text: str) -> str:
    m = re.search(r"预估烹饪难度：\s*([★]+)", text)
    if not m:
        return ""
    n = len(m.group(1))
    if n <= 2:
        return "简单"
    if n <= 4:
        return "中等"
    return "较难"


def estimate_cooking_time(text: str, step_count: int) -> str:
    m = re.search(r"(\d+)\s*[–-]?\s*(\d+)?\s*小时", text)
    if m:
        h = m.group(1)
        return f"约 {h} 小时"
    m = re.search(r"(\d+)\s*[–-]?\s*(\d+)?\s*分钟", text)
    if m:
        return f"约 {m.group(1)} 分钟"
    if step_count <= 4:
        return "约 20 分钟"
    if step_count <= 8:
        return "约 35 分钟"
    return "约 50 分钟"


def first_token(item: str) -> str:
    return item.strip().split()[0] if item.split() else item


def classify_bucket(item: str, full_line: str) -> str:
    """返回 '主料' | '辅料' | '调料'。"""
    line_n = full_line.replace(" ", "")
    tok = first_token(item)
    cond_prefixes = (
        "蚝油",
        "生抽",
        "老抽",
        "料酒",
        "食盐",
        "盐",
        "白糖",
        "冰糖",
        "食用油",
        "植物油",
        "花生油",
        "藤椒油",
        "香油",
        "芝麻油",
        "酱油",
        "豆瓣",
        "豆豉",
        "味精",
        "鸡精",
        "胡椒",
        "孜然",
        "醋",
        "米醋",
        "陈醋",
    )
    if tok.startswith(cond_prefixes):
        return "调料"
    if any(h in line_n for h in AUX_HINTS):
        return "辅料"
    for h in CONDIMENT_HINTS:
        if h in line_n and tok.startswith(h):
            return "调料"
    return "主料"


def parse_calc_and_tools(
    sections: dict[str, str],
) -> tuple[list[dict], list[dict], list[dict]]:
    """返回 主料、辅料、调料 三组 {item, amount}。"""
    raw_lines: list[str] = []
    for key in ("计算", "必备原料和工具"):
        body = sections.get(key, "")
        for line in body.splitlines():
            line = line.strip()
            if line.startswith("- "):
                raw_lines.append(line[2:].strip())
            elif line.startswith("* "):
                raw_lines.append(line[2:].strip())

    zhu: list[dict] = []
    fu: list[dict] = []
    tiao: list[dict] = []

    for raw in raw_lines:
        raw = re.sub(r"<[^>]+>", "", raw).strip()
        if not raw or raw.startswith("每次制作") or raw.startswith("每份"):
            continue
        m = re.match(r"^(.+?)\s+([\d±.\-（].*)$", raw)
        if m:
            item, amt = m.group(1).strip(), m.group(2).strip()
        else:
            item, amt = raw, ""

        bucket = classify_bucket(item, raw)
        row = {"item": item, "amount": amt or "适量"}
        if bucket == "调料":
            tiao.append(row)
        elif bucket == "辅料":
            fu.append(row)
        else:
            zhu.append(row)

    if not zhu and not fu and not tiao:
        body = sections.get("必备原料和工具", "")
        for line in body.splitlines():
            line = line.strip()
            if line.startswith("- "):
                raw = line[2:].strip()
                row = {"item": raw, "amount": "适量"}
                b = classify_bucket(raw, raw)
                if b == "调料":
                    tiao.append(row)
                elif b == "辅料":
                    fu.append(row)
                else:
                    zhu.append(row)

    return zhu, fu, tiao


def extract_timer_from_step(content: str) -> int:
    m = re.search(r"\*\*等待\s*(\d+)\s*[–-]\s*(\d+)\s*分钟", content)
    if m:
        return int(m.group(1)) * 60
    m = re.search(r"\*\*等待\s*(\d+)\s*分钟", content)
    if m:
        return int(m.group(1)) * 60
    m = re.search(r"等待\s*(\d+)\s*[–-]\s*(\d+)\s*分钟", content)
    if m:
        return int(m.group(1)) * 60
    m = re.search(r"(\d+)\s*秒", content)
    if m:
        return int(m.group(1))
    m = re.search(r"搅拌\s*(\d+)\s*分钟", content)
    if m:
        return int(m.group(1)) * 60
    return 0


def step_title_from_content(content: str) -> str:
    s = re.sub(r"<[^>]+>", "", content)
    s = s.replace("**", "").strip()
    if "：" in s[:20]:
        return s.split("：", 1)[0][:14]
    if "，" in s[:24]:
        return s.split("，", 1)[0][:14]
    return (s[:12] + "…") if len(s) > 12 else s


def parse_operation(sections: dict[str, str]) -> list[dict]:
    body = sections.get("操作", "")
    steps: list[dict] = []
    n = 0
    for line in body.splitlines():
        line = line.strip()
        if line.startswith("- "):
            content = line[2:].strip()
        elif line.startswith("* "):
            content = line[2:].strip()
        else:
            continue
        content = strip_md_comments(content)
        content = re.sub(r"<[^>]+>", "", content).strip()
        content = re.sub(r"\s+", " ", content)
        if not content:
            continue
        n += 1
        timer = extract_timer_from_step(content)
        tips = ""
        if "<!--" in line:
            cm = re.search(r"<!--\s*(.*?)\s*-->", line)
            if cm:
                tips = cm.group(1).strip()
        steps.append(
            {
                "no": n,
                "title": step_title_from_content(content),
                "content": content,
                "timer": timer,
                "tips": tips,
            }
        )
    return steps


def parse_howtocook_file(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)
    head = sections.get("_head", "")
    intro = extract_intro(head)

    zhu, fu, tiao = parse_calc_and_tools(sections)
    steps = parse_operation(sections)

    diff = parse_difficulty(text)
    ct = estimate_cooking_time(head + "\n" + sections.get("计算", ""), len(steps))

    extra = sections.get("附加内容", "").strip()
    extra_short = extra[:500] if extra else ""

    nutrition_parts = [intro] if intro else []
    if extra_short:
        nutrition_parts.append(extra_short)
    nutrition_parts.append(ATTR_NOTE)
    nutrition = " ".join(nutrition_parts)

    return {
        "ingredients": {"主料": zhu, "辅料": fu, "调料": tiao},
        "steps": steps,
        "difficulty": diff or "中等",
        "cooking_time": ct,
        "nutrition_insight": nutrition,
    }


def build_name_index(repo: Path) -> tuple[dict[str, Path], list[tuple[str, Path]]]:
    """normalized_key -> path；flat 列表用于模糊匹配。"""
    index: dict[str, Path] = {}
    flat: list[tuple[str, Path]] = []
    for md in repo.glob("dishes/**/*.md"):
        sp = str(md)
        if "template" in sp or "示例菜" in sp:
            continue
        try:
            content = md.read_text(encoding="utf-8")
        except OSError:
            continue
        name = dish_name_from_md(content, md)
        key = normalize_key(name)
        flat.append((key, md))
        if key not in index:
            index[key] = md
        stem_k = normalize_key(md.stem)
        if stem_k not in index:
            index[stem_k] = md
    return index, flat


def find_best_md(
    db_title: str,
    index: dict[str, Path],
    flat: list[tuple[str, Path]],
    min_ratio: float,
) -> tuple[Path | None, float, str]:
    raw_title = strip_db_suffix(db_title)
    if raw_title in TITLE_ALIASES:
        raw_title = TITLE_ALIASES[raw_title]
    nt = normalize_key(raw_title)

    if nt in index:
        return index[nt], 1.0, "exact"

    MIN_SUB = 4
    best_sub: tuple[int, Path, str] | None = None
    for key, path in flat:
        if len(key) < MIN_SUB:
            continue
        if key in nt:
            cand = (len(key), path, key)
            if best_sub is None or cand[0] > best_sub[0]:
                best_sub = cand
        elif len(nt) >= MIN_SUB and nt in key:
            cand = (len(nt), path, key)
            if best_sub is None or cand[0] > best_sub[0]:
                best_sub = cand

    if best_sub is not None:
        ln, path, key = best_sub
        score = ln / max(len(nt), len(key), 1)
        if score >= 0.42:
            return path, score, "substring"

    best_p: Path | None = None
    best_sc = 0.0

    for key, path in flat:
        if len(key) < MIN_SUB:
            continue
        r = SequenceMatcher(None, nt, key).ratio()
        if r <= best_sc:
            continue
        if nt and key and nt[0] != key[0]:
            continue
        lr = len(nt) / max(len(key), 1)
        if lr < 0.5 or lr > 2.0:
            continue
        best_sc = r
        best_p = path

    if best_p is not None and best_sc >= min_ratio:
        return best_p, best_sc, "fuzzy"

    return None, best_sc, "none"


def titles_compatible(nt: str, md_path: Path) -> bool:
    """防止「标题相近但不是同一道菜」误配（如金汤柠檬鲈鱼 vs 清蒸鲈鱼）。"""
    try:
        txt = md_path.read_text(encoding="utf-8")[:1500]
    except OSError:
        return False
    hk = normalize_key(dish_name_from_md(txt, md_path))
    if hk == nt:
        return True
    if len(hk) >= 4 and hk in nt:
        return True
    if len(nt) >= 4 and nt in hk:
        return True
    return SequenceMatcher(None, nt, hk).ratio() >= 0.88


def merge_patch_with_row(parsed: dict, old: dict) -> dict:
    """HowToCook 覆盖步骤与配料；若原有多一句孕期相关描述则前置保留。"""
    old_n = (old.get("nutrition_insight") or "").strip()
    base_n = parsed["nutrition_insight"]
    if old_n and len(old_n) > 15:
        if any(k in old_n for k in ("孕", "备孕", "哺乳", "叶酸", "妊娠")):
            new_n = old_n + "\n\n---\n\n" + base_n
        else:
            new_n = base_n
    else:
        new_n = base_n

    out = {
        "ingredients": parsed["ingredients"],
        "steps": parsed["steps"],
        "difficulty": parsed["difficulty"] or old.get("difficulty") or "中等",
        "cooking_time": parsed["cooking_time"] or old.get("cooking_time") or "",
        "nutrition_insight": new_n[:2000],
    }
    return out


def main() -> int:
    load_supabase_env(ROOT)
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--repo", type=Path, default=HOWTO_ROOT_DEFAULT)
    ap.add_argument(
        "--min-ratio",
        type=float,
        default=0.82,
        help="模糊匹配 SequenceMatcher 下限；同时要求首字相同、长度比 0.5–2",
    )
    args = ap.parse_args()

    base = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not base or not anon:
        print("需要 SUPABASE_URL 与 SUPABASE_ANON_KEY", file=sys.stderr)
        return 1

    repo = args.repo.resolve()
    if not (repo / "dishes").is_dir():
        print(
            f"未找到 HowToCook 仓库：{repo}\n"
            f"请执行：git clone https://github.com/Anduin2017/HowToCook.git {repo}",
            file=sys.stderr,
        )
        return 1

    index, flat = build_name_index(repo)
    rows = fetch_all_recipes(base, anon)

    matched = 0
    jobs: list[tuple[str, str, dict]] = []

    for row in rows:
        title = row.get("title") or ""
        rid = row.get("id")
        if not rid:
            continue
        md_path, score, how = find_best_md(title, index, flat, args.min_ratio)
        if md_path is None:
            continue
        raw_for_nt = strip_db_suffix(title)
        if raw_for_nt in TITLE_ALIASES:
            raw_for_nt = TITLE_ALIASES[raw_for_nt]
        nt_check = normalize_key(raw_for_nt)
        if not titles_compatible(nt_check, md_path):
            continue
        try:
            parsed = parse_howtocook_file(md_path)
        except Exception as e:
            print(f"解析失败 {md_path}: {e}", file=sys.stderr)
            continue
        if not parsed["steps"]:
            continue
        patch = merge_patch_with_row(parsed, row)
        matched += 1
        if args.dry_run:
            print(
                f"[dry-run] {title[:32]} -> {md_path.name} ({how} {score:.2f}) "
                f"steps={len(parsed['steps'])}",
                flush=True,
            )
        else:
            jobs.append((rid, title, patch))

    print(
        f"匹配成功 {matched} / {len(rows)}（其余菜名在 HowToCook 中无对应或步骤为空）",
        flush=True,
    )

    if args.dry_run:
        return 0

    ok = 0

    def _patch(item: tuple[str, str, dict]) -> tuple[str, bool, str | None]:
        rid, title, body = item
        try:
            patch_recipe(base, anon, rid, body)
            return title, True, None
        except Exception as e:
            return title, False, str(e)

    workers = min(12, max(4, len(jobs) // 15 + 4))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_patch, j) for j in jobs]
        for n, fut in enumerate(as_completed(futs), 1):
            title, success, err = fut.result()
            if not success:
                print(f"PATCH FAIL {title}: {err}", file=sys.stderr)
                return 1
            ok += 1
            if n % 30 == 0:
                print(f"Synced {n}/{len(jobs)}...", flush=True)

    print(f"Done. Updated {ok} recipes from HowToCook.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
