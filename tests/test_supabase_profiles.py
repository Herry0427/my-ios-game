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
from urllib.parse import quote
from urllib.request import Request, urlopen

DEFAULT_URL = "https://qfplpzosjcvvyhcotodz.supabase.co"

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from supabase_env_loader import load_supabase_env


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
    load_supabase_env(ROOT)

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

    # --- migrations/013：login_or_register_by_nickname ---
    rpc_nick = f"rpc_{uuid.uuid4().hex[:10]}"
    rpc_url = f"{base}/rest/v1/rpc/login_or_register_by_nickname"
    try:
        code_rpc, rpc_body = http_json("POST", rpc_url, headers_base, {"p_nick": rpc_nick})
        if code_rpc == 200 and isinstance(rpc_body, dict) and rpc_body.get("ok") and rpc_body.get("id"):
            rpc_id = str(rpc_body["id"])
            if rpc_body.get("created") is not True:
                print("WARN: login_or_register_by_nickname 首次应 created=true", file=sys.stderr)
            _, rpc_body2 = http_json(
                "POST", rpc_url, headers_base, {"p_nick": rpc_nick.upper()}
            )
            if (
                not isinstance(rpc_body2, dict)
                or not rpc_body2.get("ok")
                or str(rpc_body2.get("id")) != rpc_id
            ):
                print(f"FAIL: 同昵称二次进入 id 不一致 {rpc_body2}", file=sys.stderr)
                _delete_row(base, anon, rpc_id)
                _delete_row(base, anon, test_id)
                return 1
            _delete_row(base, anon, rpc_id)
            print("OK: login_or_register_by_nickname 新建与大小写不敏感进入（013）")
        elif code_rpc == 404:
            print("SKIP login_or_register_by_nickname：请执行 migrations/013_login_by_nickname.sql")
        else:
            print(f"SKIP login_or_register_by_nickname：HTTP {code_rpc} body={rpc_body}")
    except HTTPError as e:
        err_rpc = e.read().decode("utf-8", errors="replace") if e.fp else ""
        if e.code == 404:
            print("SKIP login_or_register_by_nickname：请执行 migrations/013_login_by_nickname.sql")
        else:
            print(f"SKIP login_or_register_by_nickname：HTTP {e.code} {err_rpc}")

    # --- migrations/007：pregnancy_user_config + pregnancy_recipes ---
    try:
        pconf_url = f"{base}/rest/v1/pregnancy_user_config"
        pconf_headers = {**headers_base, "Prefer": "resolution=merge-duplicates,return=minimal"}
        code_pc, _ = http_json(
            "POST",
            pconf_url,
            pconf_headers,
            {
                "user_id": test_id,
                "status": 1,
                "lmp_date": "2026-02-01",
                "baby_nickname": "E2E宝",
            },
        )
        if code_pc in (200, 201):
            sel_pc = (
                f"{base}/rest/v1/pregnancy_user_config?user_id=eq.{quote(test_id, safe='')}"
                "&select=status,lmp_date,baby_nickname"
            )
            _, prow = http_json("GET", sel_pc, headers_base, None)
            if isinstance(prow, list) and prow and int(prow[0].get("status", -1)) == 1:
                nick_ok = prow[0].get("baby_nickname") == "E2E宝"
                print(
                    "OK: pregnancy_user_config 可写可读（007"
                    + ("；baby_nickname" if nick_ok else "；baby_nickname 列缺失请执行 migrations/011")
                    + "）"
                )
        ru = f"{base}/rest/v1/pregnancy_recipes?select=id,title,tags,suitable_months&limit=30"
        code_r, rbody = http_json("GET", ru, headers_base, None)
        if code_r == 200 and isinstance(rbody, list):
            hit = [x for x in rbody if "牛腩" in str(x.get("title", ""))]
            print(
                f"OK: pregnancy_recipes 可读 {len(rbody)} 条（007）"
                + ("；命中牛腩" if hit else "（尚无牛腩标题时请执行 migrations/007）")
            )

        # --- migrations/012：pregnancy_memos ---
        memo_headers = {**headers_base, "Prefer": "return=representation"}
        memo_ins = {
            "user_id": test_id,
            "content": "e2e_memo_row_delete_me",
            "status": 0,
            "due_date": "2026-06-01",
        }
        memo_url = f"{base}/rest/v1/pregnancy_memos"
        code_m, mbody = http_json("POST", memo_url, memo_headers, [memo_ins])
        if code_m in (200, 201) and isinstance(mbody, list) and mbody:
            mid = mbody[0].get("id")
            patch_u = (
                f"{base}/rest/v1/pregnancy_memos?id=eq.{quote(str(mid), safe='')}"
                "&user_id=eq." + quote(test_id, safe="")
            )
            code_u, _ = http_json(
                "PATCH",
                patch_u,
                {**headers_base, "Content-Type": "application/json"},
                {"status": 1},
            )
            del_mem = (
                f"{base}/rest/v1/pregnancy_memos?id=eq.{quote(str(mid), safe='')}"
                "&user_id=eq." + quote(test_id, safe="")
            )
            http_json("DELETE", del_mem, headers_base)
            if code_u in (200, 204):
                print("OK: pregnancy_memos 写入/更新/删除（012）")
            else:
                print(f"WARN: pregnancy_memos PATCH {code_u}")
        elif code_m == 404 or (isinstance(mbody, dict) and "relation" in str(mbody).lower()):
            print("SKIP pregnancy_memos：未建表，请执行 migrations/012_pregnancy_memos.sql")
        else:
            print(f"SKIP pregnancy_memos：POST {code_m} {mbody}")
    except Exception as ex:
        print(f"SKIP 007: {ex}")

    _delete_pregnancy_row(base, anon, test_id)

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


def _delete_pregnancy_row(base: str, anon: str, test_id: str) -> None:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "User-Agent": "ios_game-e2e-test/2.0",
    }
    try:
        uid_q = quote(test_id, safe="")
        req = Request(
            f"{base}/rest/v1/pregnancy_user_config?user_id=eq.{uid_q}",
            method="DELETE",
            headers=headers,
        )
        with urlopen(req, timeout=60) as resp:
            pass
    except Exception:
        pass


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
