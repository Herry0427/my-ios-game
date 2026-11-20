"""贪吃蛇模块浅色主题 + 交互回归（Playwright）。

运行：py -3 tests/test_snake_e2e.py

只读检查：不登录、不写 Supabase，仅本地静态服务 + 浏览器交互。
覆盖：浅色主题、返回按钮、开局反向首键、暂停/继续、横屏不塌陷、窄屏与桌面布局。
"""

import http.server
import json
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8810
SHOT_DIR = os.path.join(os.environ.get("TEMP", "."), "opencode")

fails = []


def ok(cond, msg):
    print(("OK: " if cond else "FAIL: ") + msg)
    if not cond:
        fails.append(msg)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass


def enter_game(page, view="snake_game"):
    page.evaluate(
        "document.getElementById('nickname-modal').classList.remove('visible');"
        "window.goToView(%s)" % json.dumps(view)
    )
    page.wait_for_timeout(450)


def box(page, selector):
    return page.evaluate(
        """(sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return {x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right};
        }""",
        selector,
    )


def main():
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    os.makedirs(SHOT_DIR, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                viewport={"width": 390, "height": 844},
                is_mobile=True,
                has_touch=True,
                device_scale_factor=2,
            )
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto("http://127.0.0.1:%d/index.html" % PORT)
            page.wait_for_function("typeof window.goToView === 'function'", timeout=60000)

            # ---------- 手机竖屏 ----------
            enter_game(page)
            ok(page.locator("#snake-screen.active").count() == 1, "进入游戏页")
            bg = page.evaluate("getComputedStyle(document.getElementById('snake-screen')).backgroundColor")
            ok(bg == "rgb(245, 247, 250)", "游戏页浅灰背景 #F5F7FA")
            ok(page.locator("#snake-game-back").count() == 1, "游戏页有返回按钮")
            ok(page.locator("#snake-pause-btn").count() == 1, "游戏页有暂停按钮")
            ok(page.locator("#snake-lobby-overlay.visible").count() == 1, "开局显示配置浮层")
            ok("皮肤" in page.inner_text("#lobby-current-loadout"), "浮层显示当前皮肤/地图")
            ok(page.locator("#lobby-diff button").count() == 3, "三个难度可选")

            cb = box(page, "#snake-canvas-box")
            pa = box(page, "#snake-play-area")
            ok(abs(cb["w"] - cb["h"]) <= 1, "竖屏画布为正方形 (%.0fx%.0f)" % (cb["w"], cb["h"]))
            ok(cb["w"] >= 300, "竖屏画布足够大 (%.0f)" % cb["w"])
            ok(cb["bottom"] <= pa["bottom"] + 1, "画布未溢出播放区")

            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_lobby.png"))

            # 开局反向首键：不应直接死亡
            page.click("#snake-btn-start")
            page.wait_for_timeout(250)
            ok(page.locator("#snake-ready-overlay.visible").count() == 1, "开始后等待首次输入")
            page.keyboard.press("ArrowLeft")
            page.wait_for_timeout(700)
            dead = page.evaluate(
                """() => ({
                  go: document.getElementById('gameover-modal').classList.contains('visible'),
                  revive: document.getElementById('revive-modal').classList.contains('visible'),
                  ready: document.getElementById('snake-ready-overlay').classList.contains('visible')
                })"""
            )
            ok(not dead["go"] and not dead["revive"], "首个反向键不会立刻自杀")
            ok(not dead["ready"], "首个方向键成功开始游戏")

            # 暂停 / 继续
            page.keyboard.press("Space")
            page.wait_for_timeout(250)
            ok(page.locator("#snake-ready-overlay.visible").count() == 1, "空格键暂停")
            ok("暂停" in page.inner_text("#snake-ready-overlay"), "暂停浮层有提示")
            ok(page.get_attribute("#snake-pause-btn", "aria-label") == "继续", "暂停后按钮变为继续")
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(250)
            ok(page.locator("#snake-ready-overlay.visible").count() == 0, "方向键继续游戏")
            ok(page.get_attribute("#snake-pause-btn", "aria-label") == "暂停", "继续后按钮恢复暂停")

            page.click("#snake-pause-btn")
            page.wait_for_timeout(200)
            ok(page.locator("#snake-ready-overlay.visible").count() == 1, "点击按钮暂停")
            page.click("#snake-pause-btn")
            page.wait_for_timeout(200)
            ok(page.locator("#snake-ready-overlay.visible").count() == 0, "再次点击按钮继续")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_playing.png"))

            # 返回模块首页
            page.click("#snake-game-back")
            page.wait_for_timeout(450)
            ok(page.locator("#snake-home-screen.active").count() == 1, "游戏页返回模块首页")
            hbg = page.evaluate("getComputedStyle(document.getElementById('snake-home-screen')).backgroundColor")
            ok(hbg == "rgb(245, 247, 250)", "模块首页浅灰背景")
            ok(page.locator(".snake-menu-card").count() == 4, "首页四个入口卡片")
            ok(page.locator(".snake-menu-card svg").count() == 4, "入口卡片使用图标")
            ok(page.locator(".wallet-cell").count() == 3, "资产区三张卡片")
            ok(page.get_attribute("#snake-home-back", "aria-label") == "返回大厅", "首页返回按钮可读")
            bb = box(page, "#snake-home-back")
            ok(abs(bb["w"] - 38) <= 1 and abs(bb["h"] - 38) <= 1, "返回按钮 38×38")
            grid = page.evaluate(
                "getComputedStyle(document.querySelector('#snake-home-screen .snake-menu-grid')).gridTemplateColumns"
            )
            ok(len(grid.split(" ")) == 2, "首页入口为两列")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_home.png"))

            # 商店 / 仓库 / 排行榜返回
            page.click("#btn-snake-shop")
            page.wait_for_timeout(400)
            ok(page.locator("#shop-screen.active").count() == 1, "进入道具商店")
            ok(page.locator("#shop-screen .eco-card").count() >= 3, "商店卡片已渲染")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_shop.png"))
            page.click("#snake-shop-back")
            page.wait_for_timeout(400)
            ok(page.locator("#snake-home-screen.active").count() == 1, "商店返回模块首页")

            page.click("#btn-snake-warehouse")
            page.wait_for_timeout(400)
            ok(page.locator("#warehouse-screen.active").count() == 1, "进入仓库")
            ok(page.locator("#warehouse-screen .eco-card").count() >= 3, "仓库卡片已渲染")
            ok(page.locator("#warehouse-screen .wh-tabs button.sel").count() == 1, "仓库默认选中皮肤页签")
            lock_bg = page.evaluate(
                "getComputedStyle(document.querySelector('#warehouse-screen .eco-card.locked .eco-lock-mask')).backgroundColor"
            )
            ok(lock_bg == "rgba(248, 250, 252, 0.72)", "锁定卡片使用浅色蒙层")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_warehouse.png"))
            page.click("#snake-warehouse-back")
            page.wait_for_timeout(400)
            ok(page.locator("#snake-home-screen.active").count() == 1, "仓库返回模块首页")

            page.click("#btn-snake-leaderboard")
            page.wait_for_timeout(500)
            ok(page.locator("#leaderboard-screen.active").count() == 1, "进入排行榜")
            try:
                page.wait_for_function(
                    "!document.getElementById('lb-list').innerText.includes('加载中')",
                    timeout=6000,
                )
            except Exception:
                pass
            lb_bg = page.evaluate(
                "getComputedStyle(document.querySelector('#leaderboard-screen .lb-list')).backgroundColor"
            )
            ok(lb_bg == "rgb(255, 255, 255)", "排行榜卡片纯白")
            strip_style = page.evaluate(
                """() => {
                  const s = getComputedStyle(document.getElementById('sync-strip'));
                  return {backgroundColor: s.backgroundColor, top: s.top};
                }"""
            )
            ok(strip_style["backgroundColor"] == "rgb(255, 255, 255)"
               and float(strip_style["top"].replace("px", "")) >= 60,
               "同步提示条下移且改浅色")
            ok(page.locator("#leaderboard-screen .lb-empty, #leaderboard-screen .lb-row").count() >= 1,
               "排行榜显示条目或空状态")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_leaderboard.png"))
            page.click("#snake-leaderboard-back")
            page.wait_for_timeout(400)
            ok(page.locator("#snake-home-screen.active").count() == 1, "排行榜返回模块首页")

            page.click("#snake-home-back")
            page.wait_for_timeout(450)
            ok(page.locator("#lobby-screen.active").count() == 1, "模块首页返回大厅")

            # ---------- 横屏 ----------
            page.set_viewport_size({"width": 844, "height": 390})
            enter_game(page)
            cb = box(page, "#snake-canvas-box")
            pa = box(page, "#snake-play-area")
            dp = box(page, "#snake-dpad")
            ok(abs(cb["w"] - cb["h"]) <= 1, "横屏画布不被压扁 (%.0fx%.0f)" % (cb["w"], cb["h"]))
            ok(cb["w"] >= 180, "横屏画布尺寸可用 (%.0f)" % cb["w"])
            ok(cb["bottom"] <= pa["bottom"] + 1, "横屏画布位于播放区内")
            ok(dp["x"] >= cb["right"] - 1, "横屏方向键位于画布右侧")
            ok(page.evaluate("document.getElementById('snake-screen').scrollHeight <= window.innerHeight + 1"),
               "横屏页面无纵向溢出")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_landscape.png"))

            # ---------- 窄屏 ----------
            page.set_viewport_size({"width": 320, "height": 568})
            enter_game(page, "snake_home")
            ok(page.evaluate("document.getElementById('snake-home-screen').scrollWidth <= 321"),
               "320 宽首页无横向溢出")
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_320.png"))

            # ---------- 桌面 ----------
            page.set_viewport_size({"width": 1280, "height": 800})
            enter_game(page)
            cb = box(page, "#snake-canvas-box")
            ok(abs(cb["w"] - cb["h"]) <= 1 and cb["w"] >= 400,
               "桌面画布为正方形且够大 (%.0f)" % cb["w"])
            page.screenshot(path=os.path.join(SHOT_DIR, "snake_theme_desktop.png"))

            # ---------- 结算 / 续命 / 宝箱 / 成就浮层 ----------
            for modal_id, shot in [
                ("gameover-modal", "snake_modal_gameover.png"),
                ("revive-modal", "snake_modal_revive.png"),
                ("crate-modal", "snake_modal_crate.png"),
                ("achv-modal", "snake_modal_achv.png"),
            ]:
                page.evaluate(
                    "(id) => document.getElementById(id).classList.add('visible')", modal_id
                )
                page.wait_for_timeout(150)
                ok(page.locator("#" + modal_id + ".visible").count() == 1, modal_id + " 可显示")
                card_bg = page.evaluate(
                    "(id) => getComputedStyle(document.querySelector('#' + id + ' .gameover-card, #' + id + ' .achv-card')).backgroundColor",
                    modal_id,
                )
                ok(card_bg == "rgb(255, 255, 255)", modal_id + " 白色卡片")
                page.screenshot(path=os.path.join(SHOT_DIR, shot))
                page.evaluate(
                    "(id) => document.getElementById(id).classList.remove('visible')", modal_id
                )
            ok(page.locator("#revive-yes").count() == 1 and page.locator("#revive-no").count() == 1,
               "续命浮层保留两个按钮")
            ok(page.locator("#crate-ok").count() == 1, "宝箱浮层保留收下按钮")
            crate_tile = page.evaluate(
                """() => {
                  const s = getComputedStyle(document.querySelector('#crate-card .item-visual-wrap'));
                  return {backgroundImage: s.backgroundImage, width: s.width};
                }"""
            )
            ok("linear-gradient" in crate_tile["backgroundImage"]
               and crate_tile["width"] == "96px",
               "宝箱图标为浅色渐变方块")
            ok(page.locator("#achv-ok").count() == 1, "成就浮层保留确认按钮")

            ok(len(errors) == 0, "无 JS 报错 %s" % (errors[:2],))
            browser.close()
    finally:
        httpd.shutdown()

    print("失败项:", len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
