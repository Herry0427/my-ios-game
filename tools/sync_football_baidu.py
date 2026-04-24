#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从百度搜索结果页提取嵌入的竞彩足球卡片 JSON（\"result\":[...]），合并本地 CSV 缓存，
写入 data/football_bundle.json。无需外网（相对 ESPN）；请在可正常打开百度的网络下运行。

用法:
  python tools/sync_football_baidu.py

若返回「百度安全验证」页面，可在浏览器登录百度后复制 Cookie，再执行:
  set BAIDU_COOKIE=你的cookie
  python tools/sync_football_baidu.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from json import JSONDecoder
from urllib.parse import quote

TZ_CN = timezone(timedelta(hours=8))

LEAGUES_SPEC: list[tuple[str, str]] = [
    ("worldcup", "世界杯赛程"),
    ("epl", "英超赛程"),
    ("laliga", "西甲赛程"),
    ("bundesliga", "德甲赛程"),
    ("seriea", "意甲赛程"),
    ("ligue1", "法甲赛程"),
    ("ucl", "欧冠赛程"),
]

TITLE_FILTERS: dict[str, tuple[str, ...]] = {
    "worldcup": ("世界杯",),
    "epl": ("英超",),
    "laliga": ("西甲",),
    "bundesliga": ("德甲",),
    "seriea": ("意甲",),
    "ligue1": ("法甲", "法国甲级"),
    "ucl": ("欧冠", "欧洲冠军"),
}


def title_belongs_league(league_key: str, title: str) -> bool:
    tokens = TITLE_FILTERS.get(league_key, ())
    if league_key == "epl" and "英冠" in title:
        return False
    return any(t in title for t in tokens)


def infer_datetime_cn(month: int, day: int, hour: int, minute: int) -> datetime:
    today = date.today()
    best_delta = None
    best_y = today.year
    for y in range(today.year - 1, today.year + 2):
        try:
            dt_only = date(y, month, day)
        except ValueError:
            continue
        delta = abs((dt_only - today).days)
        if best_delta is None or delta < best_delta:
            best_delta = delta
            best_y = y
    return datetime(best_y, month, day, hour, minute, tzinfo=TZ_CN)


def extract_result_arrays(html: str) -> list[list]:
    dec = JSONDecoder()
    arrays: list[list] = []
    pos = 0
    while True:
        i = html.find('"result":', pos)
        esc = html.find('\\"result\\":', pos)
        if i < 0 and esc < 0:
            break
        if esc >= 0 and (i < 0 or esc < i):
            idx = esc + len('\\"result\\":')
        else:
            idx = i + len('"result":')
        while idx < len(html) and html[idx] in " \t\r\n":
            idx += 1
        if idx >= len(html) or html[idx] != "[":
            pos = max(i, esc) + 1
            continue
        chunk = html[idx:]
        try:
            arr, used = dec.raw_decode(chunk)
        except json.JSONDecodeError:
            pos = max(i, esc) + 1
            continue
        if isinstance(arr, list):
            arrays.append(arr)
        pos = idx + used
    return arrays


def match_id_from_card(league_key: str, title: str, home: str, away: str, card: dict) -> str:
    for key in ("recordUrl", "statusUrl", "url"):
        u = str(card.get(key) or "")
        m = re.search(r"matchId=(\d+)", u)
        if m:
            return f"sina:{m.group(1)}"
    h = hashlib.md5(f"{league_key}|{title}|{home}|{away}".encode("utf-8")).hexdigest()[:18]
    return f"md5:{h}"


def parse_title_datetime_status(title: str) -> tuple[datetime | None, bool, bool]:
    m = re.search(r"(\d{2})-(\d{2})\s+(\d{2}):(\d{2})", title)
    if not m:
        return None, False, False
    mo, d, hh, mm = (int(x) for x in m.groups())
    dt = infer_datetime_cn(mo, d, hh, mm)
    finished = "完场" in title or "终" in title or "已结束" in title
    upcoming = "未开赛" in title or "待定" in title
    if not finished and not upcoming:
        hs = re.search(r"(\d+)\s*:\s*(\d+)", title)
        if hs:
            finished = True
    return dt, finished, upcoming if upcoming else not finished


def card_to_match(league_key: str, card: dict) -> dict | None:
    title = str(card.get("title") or "")
    if not title or not title_belongs_league(league_key, title):
        return None
    host = card.get("host") if isinstance(card.get("host"), dict) else {}
    guest = card.get("guest") if isinstance(card.get("guest"), dict) else {}
    home = str(host.get("name") or "").strip()
    away = str(guest.get("name") or "").strip()
    if not home or not away:
        return None
    hs_raw = host.get("score")
    gs_raw = guest.get("score")
    hs = "" if hs_raw is None else str(hs_raw).strip()
    gs = "" if gs_raw is None else str(gs_raw).strip()

    dt, finished_guess, upcoming_guess = parse_title_datetime_status(title)
    if dt is None:
        return None

    numeric = hs.isdigit() and gs.isdigit()
    is_finished = finished_guess or numeric
    is_upcoming = not is_finished and (upcoming_guess or dt > datetime.now(TZ_CN))

    return {
        "league_key": league_key,
        "id": match_id_from_card(league_key, title, home, away, card),
        "dateISO": dt.isoformat(),
        "home": home,
        "away": away,
        "homeScore": hs if is_finished else (hs if numeric else ""),
        "awayScore": gs if is_finished else (gs if numeric else ""),
        "isFinished": bool(is_finished),
        "isUpcoming": bool(is_upcoming),
        "title": title[:200],
    }


def fetch_baidu(wd: str, cookie: str | None) -> str:
    u = f"https://www.baidu.com/s?wd={quote(wd)}&ie=utf-8"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(u, headers=headers)
    with urllib.request.urlopen(req, timeout=28) as r:
        return r.read().decode("utf-8", "replace")


def load_bundle_matches(bundle_path: str) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    if not os.path.isfile(bundle_path):
        return out
    with open(bundle_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    for lk, block in (data.get("leagues") or {}).items():
        for m in block.get("matches") or []:
            mid = m.get("id")
            if lk and mid:
                row = dict(m)
                row["league_key"] = lk
                out[(lk, str(mid))] = row
    return out


def load_csv_matches(csv_path: str) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    if not os.path.isfile(csv_path):
        return out
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return out
        for row in reader:
            lk = row.get("league_key") or ""
            mid = row.get("id") or ""
            if not lk or not mid:
                continue
            out[(lk, mid)] = {
                "league_key": lk,
                "id": mid,
                "dateISO": row.get("dateISO") or "",
                "home": row.get("home") or "",
                "away": row.get("away") or "",
                "homeScore": row.get("homeScore") or "",
                "awayScore": row.get("awayScore") or "",
                "isFinished": (row.get("isFinished") or "").lower() in ("1", "true", "yes"),
                "isUpcoming": (row.get("isUpcoming") or "").lower() in ("1", "true", "yes"),
                "title": row.get("title") or "",
            }
    return out


def write_csv(csv_path: str, matches: dict[tuple[str, str], dict]) -> None:
    fieldnames = [
        "league_key",
        "id",
        "dateISO",
        "home",
        "away",
        "homeScore",
        "awayScore",
        "isFinished",
        "isUpcoming",
        "title",
    ]
    rows = sorted(matches.values(), key=lambda x: (x["league_key"], x.get("dateISO") or "", x["id"]))
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "league_key": r["league_key"],
                    "id": r["id"],
                    "dateISO": r.get("dateISO") or "",
                    "home": r.get("home") or "",
                    "away": r.get("away") or "",
                    "homeScore": r.get("homeScore") or "",
                    "awayScore": r.get("awayScore") or "",
                    "isFinished": "true" if r.get("isFinished") else "false",
                    "isUpcoming": "true" if r.get("isUpcoming") else "false",
                    "title": (r.get("title") or "")[:500],
                }
            )


def write_bundle(bundle_path: str, matches: dict[tuple[str, str], dict]) -> None:
    leagues_out: dict[str, dict] = {k: {"matches": []} for k, _ in LEAGUES_SPEC}
    for (_lk, _mid), m in matches.items():
        lk = m["league_key"]
        if lk not in leagues_out:
            continue
        mm = {k: v for k, v in m.items() if k != "league_key"}
        leagues_out[lk]["matches"].append(mm)
    for lk in leagues_out:
        leagues_out[lk]["matches"].sort(key=lambda x: x.get("dateISO") or "")
    payload = {
        "generatedAt": datetime.now(TZ_CN).isoformat(),
        "source": "baidu_search_embed + football_raw_cache.csv",
        "leagues": leagues_out,
    }
    with open(bundle_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def run_sync(root: str) -> int:
    data_dir = os.path.join(root, "data")
    os.makedirs(data_dir, exist_ok=True)
    bundle_path = os.path.join(data_dir, "football_bundle.json")
    csv_path = os.path.join(data_dir, "football_raw_cache.csv")
    cookie = (os.environ.get("BAIDU_COOKIE") or "").strip() or None

    merged = load_bundle_matches(bundle_path)
    merged.update(load_csv_matches(csv_path))

    for league_key, wd in LEAGUES_SPEC:
        try:
            html = fetch_baidu(wd, cookie)
        except urllib.error.HTTPError as e:
            print(f"[{league_key}] HTTP {e.code}")
            time.sleep(0.4)
            continue
        except Exception as e:
            print(f"[{league_key}] fetch error: {type(e).__name__}: {e}")
            time.sleep(0.4)
            continue

        if "百度安全验证" in html or ("安全验证" in html and len(html) < 8000):
            print(f"[{league_key}] 命中验证页，跳过（可设置 BAIDU_COOKIE 后重试）")
            time.sleep(0.45)
            continue

        added = 0
        for arr in extract_result_arrays(html):
            if not isinstance(arr, list):
                continue
            for card in arr:
                if not isinstance(card, dict):
                    continue
                m = card_to_match(league_key, card)
                if not m:
                    continue
                merged[(league_key, m["id"])] = m
                added += 1
        print(f"[{league_key}] 写入 {added} 条（来自百度搜索页嵌入 JSON）")
        time.sleep(0.4)

    write_csv(csv_path, merged)
    write_bundle(bundle_path, merged)
    print(f"已更新: {bundle_path}\n已更新: {csv_path}")
    return 0


def _self_test() -> None:
    sample = r'''
    <script>window.x={"result":[{
      "title":"周六001 英超 05-10 19:30 未开赛",
      "recordUrl":"https://lottery.sina.com.cn/football/jc.shtml?matchId=9999001",
      "host":{"score":"","name":"测试主队"},
      "guest":{"score":"","name":"测试客队"}
    }]}</script>
    '''
    arrs = extract_result_arrays(sample)
    assert arrs and len(arrs[0]) == 1
    m = card_to_match("epl", arrs[0][0])
    assert m and m["home"] == "测试主队" and m["isUpcoming"]

    multi = (
        '{"result":['
        '{"title":"周六001 英超 06-10 19:30 未开赛","recordUrl":"https://x?matchId=91001",'
        '"host":{"score":"","name":"甲A"},"guest":{"score":"","name":"甲B"}},'
        '{"title":"周六002 英超 06-11 20:00 未开赛","recordUrl":"https://x?matchId=91002",'
        '"host":{"score":"","name":"乙A"},"guest":{"score":"","name":"乙B"}},'
        '{"title":"周六003 英超 06-12 21:00 完场","recordUrl":"https://x?matchId=91003",'
        '"host":{"score":"3","name":"丙A"},"guest":{"score":"1","name":"丙B"}}'
        "]}"
    )
    arrs2 = extract_result_arrays(multi)
    assert len(arrs2) == 1 and len(arrs2[0]) == 3, "应一次解析多条同联赛卡片"
    parsed = [card_to_match("epl", c) for c in arrs2[0]]
    assert len([x for x in parsed if x]) == 3
    assert parsed[2]["isFinished"] and parsed[2]["homeScore"] == "3"

    print("self_test_ok")


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--test" in sys.argv:
        _self_test()
        return 0
    return run_sync(root)


if __name__ == "__main__":
    raise SystemExit(main())
