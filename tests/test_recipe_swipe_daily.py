#!/usr/bin/env python3
"""好孕食谱：每日推荐缓存键逻辑 + 左缘侧滑判定（与 index.html 规则对齐，纯本地）。"""
from __future__ import annotations


def local_ymd(y: int, month: int, day: int) -> str:
    return f"{y}-{month:02d}-{day:02d}"


def recommendation_should_refresh(saved_date: str | None, today: str) -> bool:
    """跨日或尚无缓存时应重新抽取今日推荐。"""
    if not saved_date:
        return True
    return saved_date != today


def edge_swipe_triggers_back(
    start_x: float,
    dx: float,
    dy: float,
    *,
    edge_px: float = 30,
    trigger_dx: float = 100,
) -> bool:
    """仅从左缘发起的、以横向为主的右滑才触发返回（防列表区误触）。"""
    if start_x >= edge_px:
        return False
    if dx <= trigger_dx:
        return False
    if dx <= abs(dy) * 0.65:
        return False
    return True


def test_midnight_cross_updates_recommendation_slot():
    assert recommendation_should_refresh("2026-05-06", "2026-05-07") is True
    assert recommendation_should_refresh("2026-05-07", "2026-05-07") is False
    assert recommendation_should_refresh(None, "2026-05-07") is True


def test_edge_swipe_only_from_left():
    assert edge_swipe_triggers_back(10, 120, 10) is True
    assert edge_swipe_triggers_back(50, 120, 10) is False
    assert edge_swipe_triggers_back(10, 80, 10) is False
    assert edge_swipe_triggers_back(10, 120, 200) is False


def normalize_suitable_months_like_js(sm: list) -> list[int]:
    """与 index.html normalizeSuitableMonths 一致：兼容 API 返回的字符串数字。"""
    if not sm:
        return []
    out: list[int] = []
    for x in sm:
        try:
            n = int(str(x).strip())
        except (TypeError, ValueError):
            continue
        out.append(n)
    return out


def test_suitable_months_string_array_from_db():
    assert normalize_suitable_months_like_js(["7", "8", "10"]) == [7, 8, 10]
    sm = normalize_suitable_months_like_js(["0", "4", "5"])
    assert 0 in sm and 4 in sm


if __name__ == "__main__":
    test_midnight_cross_updates_recommendation_slot()
    test_edge_swipe_only_from_left()
    test_suitable_months_string_array_from_db()
    print("test_recipe_swipe_daily: all passed")
