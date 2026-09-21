#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 pregnancy_recipes：总行数、重复 title、迁移基准菜是否存在。"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from supabase_env_loader import load_supabase_env

MIGRATION_TITLES = (
    "山药滋补红烧牛腩",
    "西红柿山药牛腩",
    "金汤柠檬鲈鱼",
    "坚果腰果虾仁",
    "腐竹黑木耳烧肉",
    "板栗红枣炖乌鸡",
)

HOWTO_TEST_TITLES = (
    "蚝油生菜",
    "西红柿炒鸡蛋",
    "清蒸鲈鱼",
    "宫保鸡丁",
    "凉拌黄瓜",
    "手撕包菜",
    "麻婆豆腐",
    "白灼虾",
    "虎皮青椒",
)


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=120) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def fetch_titles(base: str, anon: str) -> list[str]:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
    }
    titles: list[str] = []
    offset = 0
    page = 500
    while True:
        url = (
            f"{base}/rest/v1/pregnancy_recipes"
            f"?select=title&limit={page}&offset={offset}"
        )
        code, data = http_json("GET", url, headers)
        if code != 200 or not isinstance(data, list):
            raise RuntimeError(f"GET failed {code}")
        for row in data:
            t = (row.get("title") or "").strip()
            if t:
                titles.append(t)
        if len(data) < page:
            break
        offset += page
    return titles


def main() -> int:
    load_supabase_env(ROOT)
    base = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not base or not anon:
        print("缺少 SUPABASE_URL / SUPABASE_ANON_KEY", file=sys.stderr)
        return 1

    titles = fetch_titles(base, anon)
    n = len(titles)
    ctr = Counter(titles)
    dups = [t for t, c in ctr.items() if c > 1]

    print(f"总行数（title 条）: {n}")
    print(f"唯一 title 数: {len(ctr)}")
    if dups:
        print(f"重复 title（{len(dups)} 个）:")
        for t in sorted(dups):
            print(f"  ×{ctr[t]}  {t}")
    else:
        print("重复 title: 无")

    missing_mig = [t for t in MIGRATION_TITLES if t not in ctr]
    if missing_mig:
        print("\n【迁移基准菜缺失】以下应在 007/008 中存在:")
        for t in missing_mig:
            print(f"  MISSING {t}")
    else:
        print("\n迁移基准菜（6 道）: 全部存在 OK")

    # HowToCook 测试插入用过的菜名：删除后不应再带 HowToCook 标签；是否还应留在「原 306」取决于种子是否含同名
    still_test_named = [t for t in HOWTO_TEST_TITLES if t in ctr]
    print(f"\n曾与 HowToCook 测试同名的菜（当前库中仍有该行）: {len(still_test_named)} 道")
    for t in still_test_named:
        print(f"  · {t}")

    return 1 if missing_mig or dups else 0


if __name__ == "__main__":
    sys.exit(main())
