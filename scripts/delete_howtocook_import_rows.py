#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
删除 pregnancy_recipes 中 tags 含「HowToCook」的行（由 import_howtocook_pregnancy.py 插入）。

用法（在 ios_game 目录）:
  python scripts/delete_howtocook_import_rows.py
  python scripts/delete_howtocook_import_rows.py --dry-run

说明：曾用 --test 插入且插入前按同名删过旧行的菜，删掉 HowToCook 行后该菜名将空缺，
需从迁移/SQL 或备份补回；本脚本不自动恢复。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=120) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def fetch_all_ids_tags(base: str, anon: str) -> list[dict]:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
    }
    rows: list[dict] = []
    offset = 0
    page = 500
    while True:
        url = (
            f"{base}/rest/v1/pregnancy_recipes"
            f"?select=id,title,tags&limit={page}&offset={offset}"
        )
        code, data = http_json("GET", url, headers)
        if code != 200 or not isinstance(data, list):
            raise RuntimeError(f"GET failed: {code} {data}")
        rows.extend(data)
        if len(data) < page:
            break
        offset += page
    return rows


def delete_howtocook_tagged_batch(base: str, anon: str) -> None:
    """tags 数组包含 HowToCook 的一次性删除（PostgREST cs）。"""
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{base}/rest/v1/pregnancy_recipes?tags=cs.%7BHowToCook%7D"
    code, data = http_json("DELETE", url, headers)
    if code not in (200, 204):
        raise RuntimeError(f"DELETE batch failed {code}: {data}")


def main() -> int:
    from supabase_env_loader import load_supabase_env

    load_supabase_env(ROOT)
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    if not base or not anon:
        print("需要 SUPABASE_URL 与 SUPABASE_ANON_KEY", file=sys.stderr)
        return 1

    rows = fetch_all_ids_tags(base, anon)
    to_del = []
    for r in rows:
        tags = r.get("tags")
        if isinstance(tags, list) and "HowToCook" in tags:
            to_del.append(r)

    print(f"Total rows: {len(rows)}; HowToCook-tagged: {len(to_del)}", flush=True)
    if args.dry_run:
        for r in to_del:
            print(f"  would delete: {r.get('title')}", flush=True)
        return 0

    delete_howtocook_tagged_batch(base, anon)
    print(f"Deleted (batch) rows with tags cs {{HowToCook}}.", flush=True)

    rows2 = fetch_all_ids_tags(base, anon)
    print(f"Remaining rows: {len(rows2)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
