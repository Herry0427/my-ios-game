#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
profiles 表集成测试（PostgREST / anon），含 unlockedSkins、currentSkin、bigint highScore。
流程：upsert 测试行 → GET 校验数组与字段 → DELETE。

退出码：0 成功或完全 SKIP；1 HTTP/校验失败；2 仅有 Management Token 无 anon。
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_URL = "https://qfplpzosjcvvyhcotodz.supabase.co"

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "supabase_local.env"


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def http_json(method: str, url: str, headers: dict, body=None) -> tuple[int, dict | list | None]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, method=method, headers=headers)
    with urlopen(req, timeout=60) as resp:
        code = resp.getcode()
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return code, None
        return code, json.loads(raw)


def main() -> int:
    load_dotenv(ENV_FILE)

    base = (os.environ.get("SUPABASE_URL") or DEFAULT_URL).rstrip("/")
    anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    mgmt = (os.environ.get("SUPABASE_MANAGEMENT_TOKEN") or "").strip()

    if not anon:
        print(
            "未设置 SUPABASE_ANON_KEY（Publishable 或 legacy anon JWT）。\n"
            "Dashboard → Project Settings → API。"
        )
        if mgmt:
            print(
                "\n*** 已配置 SUPABASE_MANAGEMENT_TOKEN 但未配置 SUPABASE_ANON_KEY。\n",
                file=sys.stderr,
            )
            return 2
        print("\nSKIP（退出 0）")
        return 0

    test_id = f"e2e_myarcade_{uuid.uuid4().hex[:12]}"
    unique_nick = f"E2E_{test_id[:10]}"
    payload_min = {
        "id": test_id,
        "nickname": unique_nick,
        "highScore": 999001,
        "unlockedSkins": ["default", "ghost"],
        "currentSkin": "ghost",
    }
    payload_row = {
        **payload_min,
        "coins": 120,
        "calabashCount": 1,
        "crates": 2,
        "unlockedMaps": ["classic", "forest"],
        "currentMap": "forest",
    }

    headers_base = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "ios_game-e2e-test/2.0",
    }
    upsert_headers = {**headers_base, "Prefer": "resolution=merge-duplicates,return=representation"}

    upsert_url = f"{base}/rest/v1/profiles"
    economy_ok = True
    try:
        code, body = http_json("POST", upsert_url, upsert_headers, [payload_row])
    except HTTPError as e:
        err = e.read().decode("utf-8", errors="replace") if e.fp else ""
        if e.code == 400 and ("calabashCount" in err or "coins" in err or "schema cache" in err):
            print(
                "WARN: 远程库尚未应用 migrations/004_warehouse_economy.sql，"
                "回退基础字段测试。请运行: python supabase_migrate.py",
                file=sys.stderr,
            )
            economy_ok = False
            try:
                code, body = http_json("POST", upsert_url, upsert_headers, [payload_min])
            except HTTPError as e2:
                err2 = e2.read().decode("utf-8", errors="replace") if e2.fp else ""
                print(f"FAIL: upsert HTTP {e2.code}\n{err2}", file=sys.stderr)
                return 1
        else:
            print(f"FAIL: upsert HTTP {e.code}\n{err}", file=sys.stderr)
            return 1
    except URLError as e:
        print(f"FAIL: network {e}", file=sys.stderr)
        return 1

    if code not in (200, 201):
        print(f"FAIL: upsert status {code} body={body}", file=sys.stderr)
        return 1

    sel_fields = (
        "id,nickname,highScore,unlockedSkins,currentSkin,coins,calabashCount,crates,unlockedMaps,currentMap"
        if economy_ok
        else "id,nickname,highScore,unlockedSkins,currentSkin"
    )
    sel = f"{base}/rest/v1/profiles?id=eq.{test_id}&select={sel_fields}"
    try:
        code2, rows = http_json("GET", sel, headers_base, None)
    except HTTPError as e:
        err = e.read().decode("utf-8", errors="replace") if e.fp else ""
        print(f"FAIL: select HTTP {e.code}\n{err}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1

    if code2 != 200 or not isinstance(rows, list) or len(rows) != 1:
        print(f"FAIL: select rows {code2} {rows}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1

    row = rows[0]
    if int(row.get("highScore", 0)) != 999001:
        print(f"FAIL: highScore {row.get('highScore')}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1
    skins = row.get("unlockedSkins")
    if not isinstance(skins, list) or "ghost" not in skins:
        print(f"FAIL: unlockedSkins {skins}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1
    if row.get("currentSkin") != "ghost":
        print(f"FAIL: currentSkin {row.get('currentSkin')}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1
    if economy_ok:
        if int(row.get("coins", -1)) != 120:
            print(f"FAIL: coins {row.get('coins')}", file=sys.stderr)
            _delete_row(base, anon, test_id)
            return 1
        if int(row.get("calabashCount", -1)) != 1:
            print(f"FAIL: calabashCount {row.get('calabashCount')}", file=sys.stderr)
            _delete_row(base, anon, test_id)
            return 1
        if int(row.get("crates", -1)) != 2:
            print(f"FAIL: crates {row.get('crates')}", file=sys.stderr)
            _delete_row(base, anon, test_id)
            return 1
        maps = row.get("unlockedMaps")
        if not isinstance(maps, list) or "forest" not in maps:
            print(f"FAIL: unlockedMaps {maps}", file=sys.stderr)
            _delete_row(base, anon, test_id)
            return 1
        if row.get("currentMap") != "forest":
            print(f"FAIL: currentMap {row.get('currentMap')}", file=sys.stderr)
            _delete_row(base, anon, test_id)
            return 1

    if not _delete_row(base, anon, test_id):
        print(f"WARN: delete failed id={test_id}", file=sys.stderr)
        return 1

    _, rows2 = http_json("GET", sel, headers_base, None)
    if isinstance(rows2, list) and len(rows2) != 0:
        print(f"FAIL: still exists {rows2}", file=sys.stderr)
        return 1

    print(
        f"OK: profiles 通过 test_id={test_id}"
        + ("（含 004 经济字段）" if economy_ok else "（基础字段；请应用 004 以测蛇币/宝箱）")
    )
    return 0


def _delete_row(base: str, anon: str, test_id: str) -> bool:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "User-Agent": "ios_game-e2e-test/2.0",
    }
    try:
        req = Request(f"{base}/rest/v1/profiles?id=eq.{test_id}", method="DELETE", headers=headers)
        with urlopen(req, timeout=60) as resp:
            return 200 <= resp.getcode() < 300
    except Exception:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
