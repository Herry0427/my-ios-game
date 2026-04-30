#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""兼容入口：请优先使用 supabase_migrate.py（执行 migrations/ 下全部 SQL）。"""

import sys
from pathlib import Path

# 同目录执行，避免包路径问题
_root = Path(__file__).resolve().parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from supabase_migrate import main

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
