#!/usr/bin/env python3
"""与 index.html 一致的孕期推算逻辑自测（纯本地，无网络）。"""
from __future__ import annotations

from datetime import date
import math


def days_since_lmp(lmp: str, today: str) -> int:
    return (date.fromisoformat(today) - date.fromisoformat(lmp)).days


def test_lmp_to_mar30_week8_day1():
    """场景：今天 2026-03-30，lmp 2026-02-01 → 第 8 周 1 天。"""
    d = days_since_lmp("2026-02-01", "2026-03-30")
    assert d == 57
    assert d // 7 == 8
    assert d % 7 == 1


def test_obstetric_month_20_weeks():
    """约 20 周 → 140 天 → ceil(140/28)=5 孕月（与前端 obstetricMonth 一致）。"""
    d = 20 * 7
    assert d == 140
    assert min(10, max(1, math.ceil(d / 28))) == 5


def test_lmp_half_year_ago_late_pregnancy_bucket():
    """末次月经约半年前（示例 2025-11-07 → 今天 2026-05-07）→ 约第 7 孕月（孕晚期 7–8 月菜谱适用）。"""
    lmp = date(2025, 11, 7)
    today = date(2026, 5, 7)
    d = (today - lmp).days
    assert d == 181
    om = min(10, max(1, math.ceil(d / 28)))
    assert om == 7


if __name__ == "__main__":
    test_lmp_to_mar30_week8_day1()
    test_obstetric_month_20_weeks()
    test_lmp_half_year_ago_late_pregnancy_bucket()
    print("test_pregnancy_logic: all passed")
