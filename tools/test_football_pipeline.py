#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地验证：百度解析自测、football_bundle.json 结构、CSV 可读性。"""
from __future__ import annotations

import csv
import json
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BUNDLE = os.path.join(DATA, "football_bundle.json")
CSV_PATH = os.path.join(DATA, "football_raw_cache.csv")
CONFIG = os.path.join(ROOT, "config.js")
NO_NODE_TXT = os.path.join(ROOT, "serverless", "NO_NODE_DASHBOARD_DEPLOY.txt")
DEPLOY_PS1 = os.path.join(ROOT, "serverless", "deploy_worker.ps1")
SYNC = os.path.join(ROOT, "tools", "sync_football_baidu.py")

EXPECTED_LEAGUES = (
    "worldcup",
    "epl",
    "laliga",
    "bundesliga",
    "seriea",
    "ligue1",
    "ucl",
)
MATCH_KEYS = frozenset({"id", "dateISO", "home", "away", "homeScore", "awayScore", "isFinished", "isUpcoming"})


class TestFootballPipeline(unittest.TestCase):
    def test_config_js_present(self) -> None:
        self.assertTrue(os.path.isfile(CONFIG), f"missing {CONFIG}")
        with open(CONFIG, encoding="utf-8") as f:
            body = f.read()
        self.assertIn("__IOS_GAME_FOOTBALL_REMOTE__", body)

    def test_serverless_deploy_assets(self) -> None:
        self.assertTrue(os.path.isfile(NO_NODE_TXT), f"missing {NO_NODE_TXT}")
        self.assertTrue(os.path.isfile(DEPLOY_PS1), f"missing {DEPLOY_PS1}")
        with open(DEPLOY_PS1, encoding="utf-8") as f:
            ps = f.read()
        self.assertNotIn('Write-Host "[ERROR]', ps, "PS must not use double-quoted [ERROR] strings")
        self.assertIn("Try-InstallNodeWithWinget", ps)
        self.assertIn("workersDevAccountSub", ps)

    def test_sync_script_self_test_exits_zero(self) -> None:
        r = subprocess.run([sys.executable, SYNC, "--test"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)
        self.assertIn("self_test_ok", r.stdout)

    def test_bundle_json_schema(self) -> None:
        self.assertTrue(os.path.isfile(BUNDLE), f"missing {BUNDLE}")
        with open(BUNDLE, encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("leagues", data)
        leagues = data["leagues"]
        for key in EXPECTED_LEAGUES:
            self.assertIn(key, leagues, f"missing league {key}")
            self.assertIsInstance(leagues[key].get("matches"), list)
            for i, m in enumerate(leagues[key]["matches"]):
                self.assertIsInstance(m, dict, f"{key}[{i}]")
                missing = MATCH_KEYS - m.keys()
                self.assertFalse(missing, f"{key}[{i}] missing {missing}")
                self.assertTrue(str(m.get("id", "")).strip(), f"{key}[{i}] empty id")

    def test_csv_readable(self) -> None:
        if not os.path.isfile(CSV_PATH):
            return
        with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        for row in rows:
            self.assertIn(row.get("league_key", ""), EXPECTED_LEAGUES)
            self.assertTrue(row.get("id"))

    def test_static_server_serves_bundle(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            time.sleep(1.0)
            url = f"http://127.0.0.1:{port}/data/football_bundle.json"
            with urllib.request.urlopen(url, timeout=12) as resp:
                self.assertEqual(resp.status, 200)
                body = resp.read().decode("utf-8")
            data = json.loads(body)
            self.assertIn("leagues", data)
        except urllib.error.URLError as e:
            self.fail(f"HTTP fetch failed: {e}")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    unittest.main(verbosity=2)
