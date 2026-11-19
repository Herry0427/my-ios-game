"""记账簿底部五个入口与明细/图表/账单/我的页面冒烟 E2E。

默认不跑；设置 RUN_RECEIPT_E2E=1 后运行：
    py -3 tests/test_receipt_tabs_e2e.py
"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8777
fails = 0

if __name__ == "__main__" and os.environ.get("RUN_RECEIPT_E2E") != "1":
    print("跳过 E2E（需设置 RUN_RECEIPT_E2E=1 才启动 Chromium）")
    sys.exit(0)


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


def main():
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{PORT}/index.html")
            page.wait_for_function("window.ReceiptModule && typeof window.goToView === 'function'", timeout=60000)
            page.evaluate(
                """() => {
                  const modal = document.getElementById('nickname-modal');
                  if (modal) modal.classList.remove('visible');
                  localStorage.setItem('myArcadeHub_nickname', 'E2E');
                  window.getReceiptOwnerKey = function () { return 'e2e_tabs'; };
                  localStorage.setItem('receipt_account_e2e_tabs_2026-11-18', JSON.stringify({
                    autoTotal: true, currency: '¥',
                    items: [{ qty: 1, name: '餐饮 · 午饭', price: '¥25.00' }],
                    entries: [{ type: 'expense', category: '餐饮', amount: 25, note: '午饭', tags: [] }],
                    savedTags: []
                  }));
                  localStorage.setItem('receipt_account_e2e_tabs_2026-11-19', JSON.stringify({
                    autoTotal: true, currency: '¥',
                    items: [],
                    entries: [{ type: 'income', category: '工资', amount: 100, note: '', tags: [] }],
                    savedTags: []
                  }));
                  window.goToView('receipt_list');
                }"""
            )
            page.wait_for_selector("#receipt-list-screen.active")
            page.wait_for_timeout(300)

            ok(page.locator("#receipt-tabbar.visible").count() == 1, "明细页显示底部导航")
            ok(page.locator("#receipt-tabbar [data-receipt-tab]").count() == 5, "底部有五个入口")
            ok(page.locator("#receipt-list-income").inner_text() == "100.00", "明细收入合计")
            ok(page.locator("#receipt-list-expense").inner_text() == "25.00", "明细支出合计")
            ok(page.locator("#receipt-list-days .receipt-list-row").count() == 2, "明细按账目列出")

            page.click("#receipt-tabbar [data-receipt-tab=chart]")
            page.wait_for_selector("#receipt-chart-screen.active")
            ok(page.locator("#receipt-chart-total").inner_text() == "25.00", "图表默认支出汇总")
            ok(page.locator("#receipt-chart-bars .receipt-bar-col").count() == 7, "图表周视图七根柱")
            ok("餐饮" in page.locator("#receipt-chart-ranking").inner_text(), "支出排行榜")
            page.click("#receipt-chart-type [data-chart-type=income]")
            ok(page.locator("#receipt-chart-total").inner_text() == "100.00", "切换收入汇总")

            page.click("#receipt-tabbar [data-receipt-tab=bills]")
            page.wait_for_selector("#receipt-bills-screen.active")
            ok(page.locator("#receipt-bills-income").inner_text() == "100.00", "账单年收入")
            ok(page.locator("#receipt-bills-expense").inner_text() == "25.00", "账单年支出")
            ok(page.locator("#receipt-bills-balance").inner_text() == "75.00", "账单年结余")
            ok(page.locator("#receipt-bills-table .receipt-bills-row").count() == 13, "账单十二个月")

            page.click("#receipt-tabbar [data-receipt-tab=mine]")
            page.wait_for_selector("#receipt-mine-screen.active")
            ok(page.locator("#receipt-mine-name").inner_text() == "E2E", "我的显示昵称")
            ok(page.locator("#receipt-mine-legacy").count() == 1, "我的保留旧账导入")

            page.click("#receipt-tabbar [data-receipt-tab=entry]")
            page.wait_for_selector("#receipt-entry-screen.active")
            ok(page.locator("#receipt-tabbar.visible").count() == 0, "记账页隐藏底部导航")
            page.fill("#receipt-entry-amount", "12.5")
            page.locator("#receipt-entry-categories .receipt-entry-category").first.click()
            page.evaluate("document.getElementById('receipt-entry-save').click()")
            page.wait_for_selector("#receipt-list-screen.active")
            page.wait_for_timeout(300)
            ok(page.locator("#receipt-list-expense").inner_text() == "37.50", "保存后回到明细并更新支出")

            page.click("#receipt-tabbar [data-receipt-tab=entry]")
            page.wait_for_selector("#receipt-entry-screen.active")
            page.focus("#receipt-entry-amount")
            page.evaluate(
                """() => {
                  const vv = window.visualViewport;
                  if (vv) {
                    Object.defineProperty(vv, 'height', { configurable: true, get: () => 430 });
                    vv.dispatchEvent(new Event('resize'));
                  }
                }"""
            )
            page.wait_for_timeout(200)
            ok(page.evaluate("document.getElementById('receipt-entry-screen').classList.contains('keyboard-open')"), "金额聚焦启用键盘布局")
            box = page.locator("#receipt-entry-save").bounding_box()
            ok(box is not None and box["y"] + box["height"] <= 430, "键盘弹出后保存按钮仍可见")
            ok(not errors, "无页面 JS 异常" + ("" if not errors else ": " + " | ".join(errors)))
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
    print("失败项:", fails)
    raise SystemExit(1 if fails else 0)
