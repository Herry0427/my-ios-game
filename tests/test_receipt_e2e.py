"""记账簿纸面按钮 E2E（Playwright + 本地静态服务）。"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8772
fails = 0


def ok(cond, msg):
    global fails
    if cond:
        print("OK:", msg)
    else:
        print("FAIL:", msg, file=sys.stderr)
        fails += 1


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass


def start_server():
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def wait_receipt_home(page):
    page.wait_for_function(
        "window.ReceiptModule && typeof window.goToView === 'function'",
        timeout=60000,
    )
    page.evaluate(
        """
        () => {
          const modal = document.getElementById('nickname-modal');
          if (modal) modal.classList.remove('visible');
          window.goToView('receipt_home');
        }
        """
    )
    page.wait_for_selector("#receipt-home-screen.active")
    page.wait_for_selector("#receipt-home-canvas canvas", timeout=15000)
    page.wait_for_timeout(1000)


def tap_paper_nav(page, mode_key, side):
    pt = page.evaluate(
        "(args) => ReceiptModule._test.paperNavClientPoint(args.mode, args.side)",
        {"mode": mode_key, "side": side},
    )
    if not pt:
        raise RuntimeError("paperNavClientPoint missing: " + mode_key + " " + side)
    page.mouse.click(pt["x"], pt["y"])


def run_flow(page, label):
    wait_receipt_home(page)
    ok(page.evaluate("typeof window.goToView === 'function'"), label + " · goToView 存在")

    tap_paper_nav(page, "home", "calendar")
    page.wait_for_timeout(500)
    ok(
        page.evaluate(
            "document.getElementById('receipt-calendar-screen').classList.contains('active')"
        ),
        label + " · 点日历 → 日历页",
    )

    page.evaluate("window.goToView('receipt_home')")
    page.wait_for_selector("#receipt-home-screen.active")
    page.wait_for_timeout(600)

    tap_paper_nav(page, "home", "ledger")
    page.wait_for_timeout(500)
    ok(
        page.evaluate(
            "document.getElementById('receipt-edit-screen').classList.contains('active')"
        ),
        label + " · 点记账 → 编辑页",
    )

    page.wait_for_selector("#receipt-edit-canvas canvas", timeout=15000)
    page.wait_for_timeout(400)
    tap_paper_nav(page, "edit", "save")
    page.wait_for_timeout(500)
    ok(
        page.evaluate(
            "document.getElementById('receipt-home-screen').classList.contains('active')"
        ),
        label + " · 点保存 → 回首页",
    )


def main():
    httpd = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            page_desktop = browser.new_page(viewport={"width": 1280, "height": 720})
            page_desktop.goto(
                f"http://127.0.0.1:{PORT}/index.html",
                wait_until="networkidle",
                timeout=60000,
            )
            run_flow(page_desktop, "桌面")

            page_mobile = browser.new_page(
                viewport={"width": 390, "height": 844},
                is_mobile=True,
                has_touch=True,
            )
            page_mobile.goto(
                f"http://127.0.0.1:{PORT}/index.html",
                wait_until="networkidle",
                timeout=60000,
            )
            run_flow(page_mobile, "手机")

            browser.close()
    finally:
        httpd.shutdown()

    if fails:
        print("\n共", fails, "项失败", file=sys.stderr)
        sys.exit(1)
    print("\nE2E 全部通过")


if __name__ == "__main__":
    main()
