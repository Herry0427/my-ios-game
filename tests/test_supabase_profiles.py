#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
profiles 表集成测试（与 PWA 相同的 PostgREST / anon 权限）。
流程：upsert 测试行 → GET 校验 → DELETE 清理。

成功：打印 OK 并以 0 退出。
跳过：既无 anon 也无 Management Token 时打印 SKIP 并以 0 退出（完全未配环境）。
失败：HTTP/RLS 等错误以 1 退出。
配置错误：已填 SUPABASE_MANAGEMENT_TOKEN 但未填 SUPABASE_ANON_KEY 时以 2 退出（二者不可互相替代，见下方说明）。

用法（在仓库根或 ios_game 下）:
  python ios_game/tests/test_supabase_profiles.py
  cd ios_game && python tests/test_supabase_profiles.py
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


def http_json(method: str, url: str, headers: dict, body: dict | None = None) -> tuple[int, dict | list | None]:
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
        lines = [
            "未设置 SUPABASE_ANON_KEY（与 Management Token 是两把不同的钥匙）。",
            "",
            "  · index.html / PWA / 本脚本：必须用 Dashboard → Project Settings → API 里的",
            "    「anon」或「anon public」JWT（一长串 eyJ...）。",
            "  · python supabase_migrate.py：用的是 Account Access Token（ often sbp_...）",
            "    只能调 Management API 跑迁移，不能代替浏览器里的 anon。",
            "",
            "请在 ios_game/supabase_local.env 增加一行：",
            "  SUPABASE_ANON_KEY=eyJ...",
        ]
        print("\n".join(lines))
        if mgmt:
            print(
                "\n*** 检测到你已配置 SUPABASE_MANAGEMENT_TOKEN，但未配置 SUPABASE_ANON_KEY。"
                "\n*** 因此会出现：迁移能跑、但网页永远不写入 profiles —— 这不是业务逻辑 bug。\n",
                file=sys.stderr,
            )
            return 2
        print("\nSKIP（未配置任何密钥，退出码 0）")
        return 0

    test_id = f"e2e_myarcade_{uuid.uuid4().hex[:12]}"
    nickname = "E2E_TEST"
    high_score = 999001

    headers_base = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "ios_game-e2e-test/1.0",
    }

    # 1) Upsert（与前端一致：冲突按 id 合并）
    upsert_headers = {
        **headers_base,
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    payload = {
        "id": test_id,
        "nickname": nickname,
        "highScore": high_score,
    }
    upsert_url = f"{base}/rest/v1/profiles"
    try:
        code, body = http_json("POST", upsert_url, upsert_headers, [payload])
    except HTTPError as e:
        err = e.read().decode("utf-8", errors="replace") if e.fp else ""
        print(f"FAIL: upsert HTTP {e.code}\n{err}", file=sys.stderr)
        return 1
    except URLError as e:
        print(f"FAIL: network {e}", file=sys.stderr)
        return 1

    if code not in (200, 201):
        print(f"FAIL: upsert unexpected status {code} body={body}", file=sys.stderr)
        return 1

    # 2) Select
    sel_url = f"{base}/rest/v1/profiles?id=eq.{test_id}&select=id,nickname,highScore"
    try:
        code2, rows = http_json("GET", sel_url, headers_base, None)
    except HTTPError as e:
        err = e.read().decode("utf-8", errors="replace") if e.fp else ""
        print(f"FAIL: select HTTP {e.code}\n{err}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1

    if code2 != 200 or not isinstance(rows, list) or len(rows) != 1:
        print(f"FAIL: select expected 1 row, got {code2} {rows}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1

    row = rows[0]
    got_hs = row.get("highScore")
    if number_or_zero(got_hs) != high_score:
        print(f"FAIL: highScore mismatch want {high_score} got {got_hs}", file=sys.stderr)
        _delete_row(base, anon, test_id)
        return 1

    # 3) Delete 测试数据
    del_ok = _delete_row(base, anon, test_id)
    if not del_ok:
        print(f"WARN: 清理测试行失败，请手动删除 id={test_id}", file=sys.stderr)
        return 1

    # 4) 确认已删除
    try:
        _, rows2 = http_json("GET", sel_url, headers_base, None)
    except Exception as e:
        print(f"FAIL: verify delete GET {e}", file=sys.stderr)
        return 1
    if isinstance(rows2, list) and len(rows2) != 0:
        print(f"FAIL: row still exists after delete: {rows2}", file=sys.stderr)
        return 1

    print(f"OK: profiles anon upsert/select/delete 通过（测试 id 已删除） test_id={test_id}")
    return 0


def number_or_zero(v) -> int:
    try:
        n = int(v)
        return n
    except (TypeError, ValueError):
        return 0


def _delete_row(base: str, anon: str, test_id: str) -> bool:
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Accept": "application/json",
        "User-Agent": "ios_game-e2e-test/1.0",
    }
    del_url = f"{base}/rest/v1/profiles?id=eq.{test_id}"
    try:
        req = Request(del_url, method="DELETE", headers=headers)
        with urlopen(req, timeout=60) as resp:
            return 200 <= resp.getcode() < 300
    except Exception:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
