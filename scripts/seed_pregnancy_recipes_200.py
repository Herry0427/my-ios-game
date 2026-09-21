#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
向 pregnancy_recipes 批量插入约 200 条菜谱（100 荤 + 100 素），
标题不与库内已有重复；字段格式与 migrations/007 一致。

依赖：ios_game 下 supabase_local.env 或 .secrets/supabase.env 中的
SUPABASE_URL、SUPABASE_ANON_KEY。

用法（在 ios_game 目录）:
  python scripts/seed_pregnancy_recipes_200.py
  python scripts/seed_pregnancy_recipes_200.py --dry-run   # 只打印数量不写库
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from supabase_env_loader import load_supabase_env


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=120) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def fetch_all_titles(base: str, anon: str) -> set[str]:
    """拉取全部 title（分页）。"""
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
    }
    titles: set[str] = set()
    offset = 0
    page = 500
    while True:
        url = (
            f"{base}/rest/v1/pregnancy_recipes"
            f"?select=title&limit={page}&offset={offset}"
        )
        code, data = http_json("GET", url, headers)
        if code != 200 or not isinstance(data, list):
            raise RuntimeError(f"GET titles failed: {code} {data}")
        for row in data:
            t = (row.get("title") or "").strip()
            if t:
                titles.add(t)
        if len(data) < page:
            break
        offset += page
    return titles


def months_prep_mid_late() -> list[int]:
    return [0, 4, 5, 6, 7, 8, 9, 10]


def months_all_trimester() -> list[int]:
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]


def months_avoid_early_spicy() -> list[int]:
    return [0, 5, 6, 7, 8, 9, 10]


# ---------- 荤菜标题（组合池，易扩展） ----------
MEAT_STYLE = [
    "家常",
    "姜葱",
    "豉汁",
    "蒜香",
    "蚝油",
    "椒盐",
    "糖醋",
    "香辣",
    "葱爆",
    "酱烧",
]
MEAT_CORE = [
    "鸡腿丁",
    "鸡胸片",
    "猪里脊丝",
    "梅花肉片",
    "牛腩块",
    "排骨段",
    "鲈鱼块",
    "带鱼段",
    "鲜虾仁",
    "鱿鱼卷",
    "鸭胸片",
    "羊肉片",
]
MEAT_PAIR = ["豆角", "芦笋", "青椒", "木耳", "香菇", "莲藕", "莴笋", "豌豆"]


def iter_meat_titles() -> list[tuple[str, str]]:
    """(title, protein_kind): fish | seafood | poultry | red"""
    out: list[tuple[str, str]] = []
    fish_kw = ("鲈鱼", "带鱼")
    sea_kw = ("虾仁", "鱿鱼")
    poultry_kw = ("鸡", "鸭")
    for st in MEAT_STYLE:
        for core in MEAT_CORE:
            for pair in MEAT_PAIR:
                title = f"{st}{core}烧{pair}"
                if any(k in core for k in fish_kw):
                    kind = "fish"
                elif any(k in core for k in sea_kw):
                    kind = "seafood"
                elif any(k in core for k in poultry_kw):
                    kind = "poultry"
                else:
                    kind = "red_meat"
                out.append((title, kind))
    return out


# ---------- 素菜标题 ----------
VEG_METHOD = [
    "清炒",
    "蒜蓉",
    "白灼",
    "凉拌",
    "蚝油",
    "上汤",
    "椒盐",
    "醋溜",
    "葱油",
    "干煸",
]
VEG_CORE = [
    "菠菜",
    "菜心",
    "芦笋",
    "丝瓜",
    "冬瓜",
    "茄子",
    "豆角",
    "莲藕",
    "山药",
    "娃娃菜",
    "生菜",
    "豆苗",
]


def iter_veg_titles() -> list[str]:
    out: list[str] = []
    for vm in VEG_METHOD:
        for vc in VEG_CORE:
            out.append(f"{vm}{vc}")
    return out


def recipe_meat(title: str, kind: str, idx: int) -> dict:
    """生成一道荤菜的完整行（不含 id）。"""
    timer_short = 60 + (idx % 5) * 30
    timer_med = 180 + (idx % 4) * 60
    salt_g = 3 + (idx % 2)
    oil_ml = 12 + (idx % 5) * 2

    if kind == "fish":
        main = [
            {"item": "鲈鱼柳" if "鲈鱼" in title else "带鱼中段", "amount": "280g"},
        ]
        fu = [
            {"item": "姜丝", "amount": "12g"},
            {"item": "葱丝", "amount": "15g"},
            {"item": "红椒丝", "amount": "20g（可选）"},
        ]
        steps = [
            {
                "no": 1,
                "title": "处理主料",
                "content": "鱼块洗净擦干，少量盐抹表面腌 10 分钟；配菜切丝。",
                "timer": 600,
                "tips": "擦干再煎，皮更不易粘锅。",
            },
            {
                "no": 2,
                "title": "煎香定型",
                "content": f"平底锅薄油中火，鱼皮朝下煎至两面微黄，约 {timer_short // 60} 分钟。",
                "timer": timer_short,
                "tips": "少翻动，定型后再翻面。",
            },
            {
                "no": 3,
                "title": "焖炒入味",
                "content": "下姜葱与配菜，淋料酒，加少量热水盖盖焖 3 分钟，蚝油生抽调味收汁。",
                "timer": timer_med,
                "tips": "孕期可用蚝油减盐，起锅前尝咸淡。",
            },
        ]
        insight = (
            "鱼类提供优质蛋白与 DHA；本周搭配深色蔬菜补叶酸。"
            "海鲜过敏或医嘱限制鱼类时请替换为豆制品。"
        )
        months = months_all_trimester()
        tags = ["高蛋白", "低脂", "鱼类", "备孕推荐", "清淡"]
        cooking_time = "约 25–35 分钟"
        diff = "中等"

    elif kind == "seafood":
        main = [{"item": "鲜虾仁" if "虾仁" in title else "鱿鱼", "amount": "220g"}]
        fu = [
            {"item": "蒜末", "amount": "10g"},
            {"item": "姜片", "amount": "8g"},
        ]
        steps = [
            {
                "no": 1,
                "title": "预处理",
                "content": "虾仁挑肠线洗净吸干；或鱿鱼切花刀焯水 10 秒捞出。",
                "timer": 30,
                "tips": "焯水过久会变硬。",
            },
            {
                "no": 2,
                "title": "爆香辅料",
                "content": "热锅冷油下姜蒜煸香，转大火下主料快速翻炒。",
                "timer": 120,
                "tips": "大火快炒锁住水分。",
            },
            {
                "no": 3,
                "title": "调味出锅",
                "content": f"盐约 {salt_g}g、少量生抽，翻炒均匀淋少许香油出锅。",
                "timer": 60,
                "tips": "孕期控制总盐量，可用柠檬汁提鲜。",
            },
        ]
        insight = "海鲜提供优质蛋白与锌；对甲壳类过敏者请改用鸡肉或豆腐。"
        months = months_all_trimester()
        tags = ["高蛋白", "补锌", "快手菜", "低脂"]
        cooking_time = "约 18 分钟"
        diff = "简单"

    elif kind == "poultry":
        main = [{"item": "鸡胸肉" if "鸡胸" in title else ("鸭胸" if "鸭" in title else "鸡腿肉"), "amount": "200g"}]
        fu = [
            {"item": "葱段", "amount": "20g"},
            {"item": "姜片", "amount": "10g"},
        ]
        steps = [
            {
                "no": 1,
                "title": "切丁上浆",
                "content": "肉切丁，加料酒 5ml、淀粉 8g 抓匀腌 15 分钟。",
                "timer": 900,
                "tips": "浆薄一点更易熟透。",
            },
            {
                "no": 2,
                "title": "滑炒断生",
                "content": f"热锅 {oil_ml}ml 油，中火滑散肉丁至变色盛出。",
                "timer": 180,
                "tips": "油温不宜过高，避免外焦里生。",
            },
            {
                "no": 3,
                "title": "合炒收汁",
                "content": "余油炒香配菜，倒回肉丁，生抽调味炒匀即可。",
                "timer": 120,
                "tips": "禽肉务必全熟再食用。",
            },
        ]
        insight = "禽肉脂肪含量低于畜肉，易消化；搭配蔬菜增加膳食纤维。"
        months = months_prep_mid_late()
        tags = ["高蛋白", "低脂", "易消化", "家常菜"]
        cooking_time = "约 28 分钟"
        diff = "简单"

    else:  # red_meat
        if "里脊" in title or "里脊丝" in title:
            mitem, amt = "猪里脊", "200g"
        elif "梅花" in title:
            mitem, amt = "梅花猪肉片", "220g"
        elif "牛腩" in title:
            mitem, amt = "牛腩块", "260g"
        elif "排骨" in title:
            mitem, amt = "猪排骨", "320g"
        elif "羊肉" in title:
            mitem, amt = "羊肉片", "200g"
        else:
            mitem, amt = "猪肉块", "240g"
        main = [{"item": mitem, "amount": amt}]
        fu = [
            {"item": "大葱段", "amount": "30g"},
            {"item": "姜片", "amount": "12g"},
        ]
        steps = [
            {
                "no": 1,
                "title": "焯水去沫",
                "content": "肉切块冷水下锅，加料酒 10ml，煮沸撇沫后捞出温水冲洗。",
                "timer": 300,
                "tips": "温水冲洗肉质更松。",
            },
            {
                "no": 2,
                "title": "煸炒上色",
                "content": f"少油中火煸炒肉块至边缘焦香，下葱姜翻炒。",
                "timer": 240,
                "tips": "嗜辣者可少量干辣椒，孕早期反胃者可省略。",
            },
            {
                "no": 3,
                "title": "焖软入味",
                "content": "加热水没过食材一半，生抽老抽冰糖调味，小火焖 25–35 分钟至软烂收汁。",
                "timer": 1800,
                "tips": "红肉补铁，搭配维生素 C 蔬菜助吸收。",
            },
        ]
        insight = "红肉富含血红素铁，有助预防缺铁性贫血；适量即可，注意荤素平衡。"
        months = months_prep_mid_late()
        tags = ["补铁", "高蛋白", "家常", "备孕推荐"]
        cooking_time = "约 45–55 分钟"
        diff = "中等"

    # 把标题里的配菜融进辅料（名称取自标题）
    pair_name = title.split("烧")[-1] if "烧" in title else "配菜"
    fu.append({"item": pair_name, "amount": "120–150g"})
    tiao = [
        {"item": "食盐", "amount": f"约 {salt_g}g"},
        {"item": "植物油", "amount": f"{oil_ml}ml"},
        {"item": "生抽", "amount": "12–15ml"},
        {"item": "料酒", "amount": "10ml"},
    ]
    if "糖醋" in title or "香辣" in title:
        tiao.append({"item": "陈醋或米醋", "amount": "8ml"})
    if "香辣" in title or "椒盐" in title:
        tiao.append({"item": "干辣椒段", "amount": "2–3 根（可选）"})

    ingredients = {"主料": main, "辅料": fu, "调料": tiao}

    return {
        "title": title,
        "cooking_time": cooking_time,
        "difficulty": diff,
        "tags": tags,
        "ingredients": ingredients,
        "steps": steps,
        "nutrition_insight": insight,
        "suitable_months": months_avoid_early_spicy()
        if ("香辣" in title or "椒盐" in title)
        else months,
    }


def _veg_cook_content(title: str, veg: str, oil_ml: int) -> str:
    if "凉拌" in title:
        return (
            f"{veg}焯水或过沸水焯 30 秒沥干，加蒜末、薄盐生抽、香醋、芝麻油拌匀，装盘。"
        )
    if "白灼" in title:
        return (
            f"沸水加少许油盐，下{veg}焯烫 45–60 秒捞出沥水，淋蒸鱼豉油或薄盐生抽，撒葱丝。"
        )
    if "上汤" in title:
        return (
            f"高汤或清水烧开，下{veg}煮 2–3 分钟，盐调味，少油即可。"
        )
    if "蚝油" in title or "蒜蓉" in title:
        return (
            f"热锅少油爆香蒜末，下{veg}大火快炒 2–3 分钟至断生，蚝油与薄盐生抽调味。"
        )
    return (
        f"热锅 {oil_ml}ml 油大火翻炒{veg} 2–3 分钟，盐与少量生抽调味，保持脆嫩出锅。"
    )


def recipe_veg(title: str, idx: int) -> dict:
    """素菜：统一模板微调。"""
    veg = title.replace("清炒", "").replace("蒜蓉", "").replace("白灼", "")
    veg = veg.replace("凉拌", "").replace("蚝油", "").replace("上汤", "")
    veg = veg.replace("椒盐", "").replace("醋溜", "").replace("葱油", "").replace("干煸", "")
    veg = veg.strip() or "时蔬"
    salt_g = 2 + (idx % 2)
    oil_ml = 10 + (idx % 4)
    steps = [
        {
            "no": 1,
            "title": "洗净切配",
            "content": f"{veg}洗净切段或撕片；蒜切末备用。",
            "timer": 0,
            "tips": "流水冲洗，叶片菜可先焯水再炒更易消化。",
        },
        {
            "no": 2,
            "title": "烹制",
            "content": _veg_cook_content(title, veg, oil_ml),
            "timer": 180,
            "tips": "孕期蔬菜务必洗净做熟，慎用半生凉拌（除医嘱许可）。",
        },
        {
            "no": 3,
            "title": "装盘",
            "content": "装盘即可食用，可撒少量熟芝麻增香。",
            "timer": 0,
            "tips": "全天蔬菜目标约 400–500g，可分多餐搭配。",
        },
    ]
    main = [{"item": veg, "amount": "280–320g"}]
    fu = [{"item": "大蒜", "amount": "15g"}, {"item": "小葱", "amount": "10g"}]
    tiao = [
        {"item": "食盐", "amount": f"约 {salt_g}g"},
        {"item": "植物油", "amount": f"{oil_ml}ml"},
        {"item": "生抽（薄盐）", "amount": "8–12ml"},
    ]
    if "凉拌" in title:
        tiao.append({"item": "芝麻油", "amount": "5ml"})
        tiao.append({"item": "香醋", "amount": "6ml"})
    if "醋溜" in title:
        tiao.append({"item": "米醋", "amount": "10ml"})
        tiao.append({"item": "白糖", "amount": "4g"})

    ingredients = {"主料": main, "辅料": fu, "调料": tiao}
    tags = ["高纤维", "低脂", "富含维生素", "素菜", "孕期友好"]
    return {
        "title": title,
        "cooking_time": "约 15–22 分钟",
        "difficulty": "简单",
        "tags": tags,
        "ingredients": ingredients,
        "steps": steps,
        "nutrition_insight": (
            f"{veg}提供膳食纤维与多种维生素；素食孕妈注意搭配豆制品或坚果补蛋白。"
        ),
        "suitable_months": months_all_trimester(),
    }


def prepare_rows_fixed(existing: set[str]) -> list[dict]:
    """选取 100 荤 + 100 素，逻辑清晰可维护。"""
    used = set(existing)
    meat_rows: list[dict] = []
    mi = 0
    for title, kind in iter_meat_titles():
        if len(meat_rows) >= 100:
            break
        if title in used:
            continue
        used.add(title)
        meat_rows.append(recipe_meat(title, kind, mi))
        mi += 1

    veg_rows: list[dict] = []
    vi = 0
    for title in iter_veg_titles():
        if len(veg_rows) >= 100:
            break
        if title in used:
            continue
        used.add(title)
        veg_rows.append(recipe_veg(title, vi))
        vi += 1

    # 荤不足：后缀扩充
    extra = 1
    while len(meat_rows) < 100:
        added = False
        for title, kind in iter_meat_titles():
            if len(meat_rows) >= 100:
                break
            cand = f"{title}（孕期家常{extra}）"
            if cand in used:
                continue
            used.add(cand)
            meat_rows.append(recipe_meat(cand, kind, mi))
            mi += 1
            added = True
        if not added:
            extra += 1
        if extra > 500:
            raise RuntimeError("无法生成足够不重复的荤菜标题")

    extra_v = 1
    while len(veg_rows) < 100:
        added = False
        for title in iter_veg_titles():
            if len(veg_rows) >= 100:
                break
            cand = f"{title}（清爽版{extra_v}）"
            if cand in used:
                continue
            used.add(cand)
            veg_rows.append(recipe_veg(cand, vi))
            vi += 1
            added = True
        if not added:
            extra_v += 1
        if extra_v > 500:
            raise RuntimeError("无法生成足够不重复的素菜标题")

    return meat_rows[:100] + veg_rows[:100]


def insert_batches(base: str, anon: str, rows: list[dict], batch_size: int = 40) -> None:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{base}/rest/v1/pregnancy_recipes"
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        payload = []
        for r in chunk:
            payload.append(
                {
                    "title": r["title"],
                    "cooking_time": r["cooking_time"],
                    "difficulty": r["difficulty"],
                    "tags": r["tags"],
                    "ingredients": r["ingredients"],
                    "steps": r["steps"],
                    "nutrition_insight": r["nutrition_insight"],
                    "suitable_months": r["suitable_months"],
                }
            )
        code, data = http_json("POST", url, headers, payload)
        if code not in (200, 201):
            raise RuntimeError(f"POST batch failed {code}: {data}")
        print(f"Inserted batch {i // batch_size + 1}, rows {i + 1}-{i + len(chunk)}")


def main() -> int:
    load_supabase_env(ROOT)
    base = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只统计不写库")
    args = ap.parse_args()

    if not base or not anon:
        print("需要 SUPABASE_URL 与 SUPABASE_ANON_KEY", file=sys.stderr)
        return 1

    print("Fetching existing titles...")
    existing = fetch_all_titles(base, anon)
    print(f"Existing titles count: {len(existing)}")

    rows = prepare_rows_fixed(existing)
    print(f"Prepared rows: {len(rows)} (100 荤 + 100 素)")

    if args.dry_run:
        for i, r in enumerate(rows[:5]):
            print(json.dumps(r["title"], ensure_ascii=False))
        print("...")
        return 0

    insert_batches(base, anon, rows)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
