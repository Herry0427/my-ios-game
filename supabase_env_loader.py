#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从本机私密文件加载 SUPABASE_*，供 supabase_migrate.py、tests 使用。

读取顺序（后者覆盖前者，便于把真密钥只放在 .secrets）：
  1) <ios_game>/supabase_local.env
  2) <ios_game>/.secrets/supabase.env
  3) 环境变量 SUPABASE_ENV_FILE 指向的任意路径（若设置）

以上路径均在 ios_game/.gitignore 中忽略，不会被 git push 到 GitHub。
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv(path: Path, *, override: bool) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and (override or k not in os.environ):
            os.environ[k] = v


def load_supabase_env(script_dir: Path) -> None:
    """script_dir 一般为 ios_game 目录（supabase_migrate.py 所在目录）。"""
    base = script_dir.resolve()
    _load_dotenv(base / "supabase_local.env", override=False)
    _load_dotenv(base / ".secrets" / "supabase.env", override=True)
    extra = os.environ.get("SUPABASE_ENV_FILE", "").strip()
    if extra:
        _load_dotenv(Path(extra).expanduser().resolve(), override=True)
