#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ios_game · Supabase 数据库联动入口（Management API）

默认执行 migrations/ 下按文件名排序的全部 .sql，用于建表、改表、RLS 修复。
后续库结构变更：在 migrations/ 新增 002_xxx.sql，再运行本脚本即可。

凭证（勿提交仓库）:
  环境变量 SUPABASE_MANAGEMENT_TOKEN、SUPABASE_PROJECT_REF
  或 ios_game/supabase_local.env

用法:
  python supabase_migrate.py              # 执行全部迁移
  python supabase_migrate.py --dry-run    # 仅打印将执行的文件
  python supabase_migrate.py path/to.sql  # 仅执行单个 SQL 文件（兼容旧 apply_supabase_schema）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_PROJECT_REF = "qfplpzosjcvvyhcotodz"
API_TMPL = "https://api.supabase.com/v1/projects/{ref}/database/query"
SCRIPT_DIR = Path(__file__).resolve().parent
MIGRATIONS_DIR = SCRIPT_DIR / "migrations"


def load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def run_query(project_ref: str, token: str, sql: str) -> dict:
    url = API_TMPL.format(ref=project_ref)
    body = json.dumps({"query": sql}).encode("utf-8")
    req = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        },
    )
    with urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        if not raw.strip():
            return {}
        return json.loads(raw)


def collect_migration_files(single: Path | None) -> list[Path]:
    if single is not None:
        if not single.is_file():
            raise FileNotFoundError(str(single))
        return [single.resolve()]
    if not MIGRATIONS_DIR.is_dir():
        return []
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return files


def main(argv: list[str] | None = None) -> int:
    load_dotenv_file(SCRIPT_DIR / "supabase_local.env")

    parser = argparse.ArgumentParser(description="Apply Supabase SQL migrations via Management API")
    parser.add_argument(
        "sql_file",
        nargs="?",
        default=None,
        help="可选：只执行该 SQL 文件（默认执行 migrations/*.sql）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="不调用 API，只列出将执行的文件",
    )
    args = parser.parse_args(argv)

    token = os.environ.get("SUPABASE_MANAGEMENT_TOKEN", "").strip()
    project_ref = os.environ.get("SUPABASE_PROJECT_REF", DEFAULT_PROJECT_REF).strip()

    single_path = Path(args.sql_file) if args.sql_file else None
    if single_path and not single_path.is_absolute():
        single_path = (Path.cwd() / single_path).resolve()

    try:
        files = collect_migration_files(single_path)
    except FileNotFoundError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1

    if not files:
        print(f"错误: 未找到迁移文件（目录 {MIGRATIONS_DIR}）", file=sys.stderr)
        return 1

    print(f"项目 ref: {project_ref}")
    print("将执行:")
    for f in files:
        try:
            disp = str(f.relative_to(SCRIPT_DIR))
        except ValueError:
            disp = str(f)
        print(f"  - {disp}")

    if args.dry_run:
        print("(dry-run，未调用 API)")
        return 0

    if not token:
        print(
            "错误: 未设置 SUPABASE_MANAGEMENT_TOKEN。\n"
            "请在环境变量或 supabase_local.env 中配置。",
            file=sys.stderr,
        )
        return 1

    for path in files:
        sql = path.read_text(encoding="utf-8")
        if not sql.strip():
            print(f"跳过空文件: {path}", file=sys.stderr)
            continue
        print(f"\n>>> 执行: {path.name} …")
        try:
            result = run_query(project_ref, token, sql)
        except HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
            if err_body:
                print(err_body, file=sys.stderr)
            return 1
        except URLError as e:
            print(f"网络错误: {e}", file=sys.stderr)
            return 1
        if result:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"    完成: {path.name}")

    print("\n全部迁移执行完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
