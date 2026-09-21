#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从本地 HowToCook 克隆解析菜谱，补全 pregnancy_recipes 所需字段（含 tags、suitable_months、
孕期友好版 nutrition_insight），写入 Supabase。

测试（插入 5 道「HowToCook 原文含图」的菜，导入前去掉步骤/Markdown 图片语法）：
  python scripts/import_howtocook_pregnancy.py --test

全量（会先 DELETE 全部 pregnancy_recipes 再批量插入，慎用）：
  python scripts/import_howtocook_pregnancy.py --full-replace

依赖：.vendor/HowToCook、SUPABASE_URL、SUPABASE_ANON_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import sync_howtocook_to_supabase as htc  # noqa: E402

HOWTO_ROOT = ROOT / ".vendor" / "HowToCook"

DISCLAIMER = "个体差异、妊娠合并症及医嘱优先；以下为膳食搭配参考，非医疗结论。"

MONTHS_ALL = list(range(0, 11))
MONTHS_NO_EARLY_NAUSEA = [0, 5, 6, 7, 8, 9, 10]
MONTHS_MILD_EARLY = [0, 4, 5, 6, 7, 8, 9, 10]

# 五道在仓库 md 中含 ![…](…) 图片语法的菜谱（用于验证去图后 steps 序号与排版）
TEST_REL_PATHS = [
    "dishes/aquatic/清蒸鲈鱼/清蒸鲈鱼.md",
    "dishes/vegetable_dish/手撕包菜/手撕包菜.md",
    "dishes/meat_dish/麻婆豆腐/麻婆豆腐.md",
    "dishes/aquatic/白灼虾/白灼虾.md",
    "dishes/vegetable_dish/虎皮青椒/虎皮青椒.md",
]

# Markdown / HTML 图片
_IMG_MD = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_IMG_HTML = re.compile(r"<img\b[^>]*>", re.IGNORECASE)


def strip_image_tokens(text: str) -> str:
    if not text:
        return ""
    text = _IMG_MD.sub("", text)
    text = _IMG_HTML.sub("", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_images_from_steps(steps: list[dict]) -> list[dict]:
    """去掉步骤里的图片 Markdown；若某步仅剩空壳则删除该步，并重新编号 no。"""
    out: list[dict] = []
    for s in steps:
        if not isinstance(s, dict):
            continue
        cleaned = strip_image_tokens(str(s.get("content", "")))
        if not cleaned:
            continue
        row = {
            "no": 0,
            "title": htc.step_title_from_content(cleaned),
            "content": cleaned,
            "timer": int(s.get("timer") or 0),
            "tips": (s.get("tips") or "").strip(),
        }
        out.append(row)
    for i, s in enumerate(out, 1):
        s["no"] = i
    return out

TOP_FOLDER_TAGS: dict[str, str] = {
    "vegetable_dish": "素菜",
    "meat_dish": "荤菜",
    "aquatic": "水产",
    "soup": "汤羹",
    "staple": "主食",
    "breakfast": "早餐",
    "semi-finished": "半成品加工",
    "condiment": "酱料",
    "dessert": "甜品",
    "drink": "饮品",
}

SPICY_KW = (
    "辣椒",
    "干辣椒",
    "小米辣",
    "花椒",
    "麻椒",
    "红油",
    "麻辣",
    "火锅底料",
    "豆瓣酱",
    "剁椒",
    "泡椒",
    "辣子",
)
RAW_RISK_KW = ("刺身", "生腌", "半熟", "溏心", "醉虾", "醉蟹")
ALCOHOL_HEAVY_KW = ("白酒", "米酒饮", "大量啤酒")


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=180) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def category_label(path: Path) -> str:
    try:
        rel = path.relative_to(HOWTO_ROOT / "dishes")
        top = rel.parts[0] if rel.parts else ""
    except ValueError:
        top = ""
    return TOP_FOLDER_TAGS.get(top, "家常菜")


def scan_blob(title: str, ingredients: dict, steps: list) -> str:
    parts = [title, json.dumps(ingredients, ensure_ascii=False)]
    for s in steps:
        if isinstance(s, dict):
            parts.append(str(s.get("content", "")))
    return "".join(parts)


def infer_pregnancy_meta(path: Path, title: str, ingredients: dict, steps: list[dict]) -> dict:
    """tags、suitable_months、nutrition 补充段。"""
    blob = scan_blob(title, ingredients, steps)
    cat = category_label(path)

    tags: list[str] = ["HowToCook", "家常菜", cat]

    spicy = any(k in blob for k in SPICY_KW) or "辣" in title
    raw_risk = any(k in blob for k in RAW_RISK_KW)
    alcohol = any(k in blob for k in ALCOHOL_HEAVY_KW)
    liangban = "凉拌" in title or "凉拌" in blob[:800]
    steam_braise = any(x in blob for x in ("蒸", "炖", "煮", "白灼", "焖")) and not spicy

    if spicy:
        tags.extend(["辛辣", "重口味"])
    else:
        tags.append("清淡")

    if any(x in blob for x in ("鸡蛋", "鸡胸", "虾仁", "鱼", "牛肉", "瘦肉", "排骨")):
        tags.append("高蛋白")
    if any(x in blob for x in ("猪肝", "牛肉", "红枣", "菠菜", "木耳")):
        tags.append("补铁参考")
    if any(x in blob for x in ("鲈鱼", "鲑", "三文鱼", "带鱼", "虾", "鳕")):
        tags.append("鱼类/DHA参考")

    tags = list(dict.fromkeys(tags))[:12]

    # suitable_months（保守启发式）
    months = MONTHS_ALL.copy()
    if spicy:
        months = MONTHS_NO_EARLY_NAUSEA.copy()
    elif raw_risk or alcohol:
        months = MONTHS_MILD_EARLY.copy()
    elif liangban:
        months = MONTHS_MILD_EARLY.copy()
    elif steam_braise and cat in ("素菜", "水产", "荤菜"):
        months = MONTHS_ALL.copy()

    hint_parts = [DISCLAIMER]
    if cat == "水产" or "鱼" in title or "虾" in title:
        hint_parts.append(
            "鱼类与海鲜可提供优质蛋白与部分 ω-3；注意新鲜、熟透与适量，汞含量较高的大型掠食鱼类请遵循权威指南限量。"
        )
    if "牛" in blob or "猪肝" in blob or "木耳" in blob:
        hint_parts.append(
            "血红素铁来源可与富含维生素 C 的蔬菜（如甜椒、西兰花）同餐，有助于铁吸收。"
        )
    if spicy:
        hint_parts.append(
            "辛辣刺激较强：早孕反应明显时可减量或暂缓；痔疮或胃食管反流加重时请酌情。"
        )
    if liangban:
        hint_parts.append(
            "凉拌菜注重食材清洗与餐具卫生；胃肠敏感期可调低辣度或改为温拌。"
        )
    if cat == "素菜":
        hint_parts.append("多样蔬菜有助于膳食纤维与叶酸摄入；注意与足量优质蛋白搭配。")

    nutrition_extra = "\n".join(hint_parts)

    return {
        "tags": tags,
        "suitable_months": months,
        "nutrition_extra": nutrition_extra,
    }


def build_row(path: Path) -> dict[str, Any]:
    parsed = htc.parse_howtocook_file(path)
    text = path.read_text(encoding="utf-8")
    title = htc.dish_name_from_md(text, path)
    steps_clean = strip_images_from_steps(parsed["steps"])
    meta = infer_pregnancy_meta(path, title, parsed["ingredients"], steps_clean)

    nutrition = strip_image_tokens((parsed.get("nutrition_insight") or "").strip())
    nutrition = (
        f"{nutrition}\n\n【孕期膳食提示】\n{meta['nutrition_extra']}"
    ).strip()[:2000]

    return {
        "title": title,
        "cooking_time": parsed["cooking_time"],
        "difficulty": parsed["difficulty"],
        "tags": meta["tags"],
        "ingredients": parsed["ingredients"],
        "steps": steps_clean,
        "nutrition_insight": nutrition,
        "suitable_months": meta["suitable_months"],
    }


def insert_rows(base: str, anon: str, rows: list[dict]) -> None:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{base}/rest/v1/pregnancy_recipes"
    batch = 40
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        code, data = http_json("POST", url, headers, chunk)
        if code not in (200, 201):
            raise RuntimeError(f"POST failed {code}: {data}")


def delete_rows_by_titles(base: str, anon: str, titles: list[str]) -> None:
    """按 title 精确删除，避免测试重复插入同名多行。"""
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }
    for t in titles:
        url = f"{base}/rest/v1/pregnancy_recipes?title=eq.{quote(t, safe='')}"
        code, _ = http_json("DELETE", url, headers)
        if code not in (200, 204):
            print(f"WARN delete title={t!r} code={code}", file=sys.stderr)


def delete_all_recipes(base: str, anon: str) -> None:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{base}/rest/v1/pregnancy_recipes?id=neq.00000000-0000-0000-0000-000000000000"
    code, data = http_json("DELETE", url, headers)
    if code not in (200, 204):
        raise RuntimeError(f"DELETE failed {code}: {data}")


def collect_all_md_paths(repo: Path) -> list[Path]:
    out: list[Path] = []
    for md in repo.glob("dishes/**/*.md"):
        s = str(md)
        if "template" in s or "示例菜" in s:
            continue
        try:
            if md.read_text(encoding="utf-8")[:200].strip():
                pass
        except OSError:
            continue
        out.append(md)
    return sorted(out, key=lambda p: str(p))


def main() -> int:
    sys.path.insert(0, str(ROOT))
    from supabase_env_loader import load_supabase_env

    load_supabase_env(ROOT)

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--test",
        action="store_true",
        help="仅插入 5 道测试菜谱（不删库）",
    )
    ap.add_argument(
        "--full-replace",
        action="store_true",
        help="删除 pregnancy_recipes 全部行后导入 HowToCook 全部菜谱",
    )
    args = ap.parse_args()

    base = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not base or not anon:
        print("需要 SUPABASE_URL 与 SUPABASE_ANON_KEY", file=sys.stderr)
        return 1

    if not (HOWTO_ROOT / "dishes").is_dir():
        print(f"未找到 {HOWTO_ROOT}，请先 git clone HowToCook", file=sys.stderr)
        return 1

    if args.full_replace:
        paths = collect_all_md_paths(HOWTO_ROOT)
        rows = []
        for p in paths:
            try:
                row = build_row(p)
                if row["steps"]:
                    rows.append(row)
            except Exception as e:
                print(f"SKIP {p}: {e}", file=sys.stderr)
        print(f"Prepared {len(rows)} recipes from HowToCook.", flush=True)
        print("Deleting existing pregnancy_recipes...", flush=True)
        delete_all_recipes(base, anon)
        print(f"Inserting {len(rows)} rows...", flush=True)
        insert_rows(base, anon, rows)
        print("Done full replace.", flush=True)
        return 0

    if args.test:
        rows = []
        titles_del: list[str] = []
        for rel in TEST_REL_PATHS:
            p = HOWTO_ROOT / rel
            if not p.is_file():
                print(f"Missing file: {p}", file=sys.stderr)
                return 1
            row = build_row(p)
            if not row["steps"]:
                print(f"No steps in {p}", file=sys.stderr)
                return 1
            titles_del.append(row["title"])
            rows.append(row)
            print(
                f"OK build: {row['title']} steps={len(row['steps'])} (after image strip)",
                flush=True,
            )
        print("Deleting existing rows with same titles (if any)...", flush=True)
        delete_rows_by_titles(base, anon, titles_del)
        insert_rows(base, anon, rows)
        print(f"Inserted {len(rows)} test recipes.", flush=True)
        return 0

    print("请使用 --test 或 --full-replace", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
