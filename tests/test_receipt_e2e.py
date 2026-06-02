"""记账簿纸面按钮 E2E（Playwright + 本地静态服务）。默认不跑，避免占用 CPU。"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8772
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


def tap_canvas_pointer(page, canvas_selector, pt):
    page.evaluate(
        """
        (args) => {
          const el = document.querySelector(args.sel);
          if (!el) return;
          const base = {
            bubbles: true,
            cancelable: true,
            clientX: args.x,
            clientY: args.y,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
          };
          el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, { buttons: 1 })));
          el.dispatchEvent(
            new PointerEvent(
              'pointermove',
              Object.assign({}, base, {
                clientX: args.x + 1,
                clientY: args.y + 1,
                buttons: 1,
              })
            )
          );
          el.dispatchEvent(
            new PointerEvent('pointerup', Object.assign({}, base, { buttons: 0 }))
          );
        }
        """,
        {"sel": canvas_selector, "x": pt["x"], "y": pt["y"]},
    )


def drag_canvas_pointer(page, canvas_selector, start, end, steps=8):
    page.evaluate(
        """
        (args) => {
          const el = document.querySelector(args.sel);
          if (!el) return;
          const base = {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
          };
          el.dispatchEvent(
            new PointerEvent(
              'pointerdown',
              Object.assign({}, base, {
                clientX: args.x0,
                clientY: args.y0,
                buttons: 1,
              })
            )
          );
        }
        """,
        {"sel": canvas_selector, "x0": start["x"], "y0": start["y"]},
    )
    for i in range(1, steps + 1):
        t = i / steps
        x = start["x"] + (end["x"] - start["x"]) * t
        y = start["y"] + (end["y"] - start["y"]) * t
        page.evaluate(
            """
            (args) => {
              const el = document.querySelector(args.sel);
              if (!el) return;
              el.dispatchEvent(
                new PointerEvent('pointermove', {
                  bubbles: true,
                  cancelable: true,
                  clientX: args.x,
                  clientY: args.y,
                  pointerId: 1,
                  pointerType: 'touch',
                  isPrimary: true,
                  button: 0,
                  buttons: 1,
                })
              );
            }
            """,
            {"sel": canvas_selector, "x": x, "y": y},
        )
        page.wait_for_timeout(40)
    page.evaluate(
        """
        (args) => {
          const el = document.querySelector(args.sel);
          if (!el) return;
          el.dispatchEvent(
            new PointerEvent('pointerup', {
              bubbles: true,
              cancelable: true,
              clientX: args.x,
              clientY: args.y,
              pointerId: 1,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: 0,
            })
          );
        }
        """,
        {"sel": canvas_selector, "x": end["x"], "y": end["y"]},
    )


def tap_paper_nav(page, mode_key, side):
    pt = page.evaluate(
        "(args) => ReceiptModule._test.paperNavClientPoint(args.mode, args.side)",
        {"mode": mode_key, "side": side},
    )
    if not pt:
        raise RuntimeError("paperNavClientPoint missing: " + mode_key + " " + side)
    sel = {
        "home": "#receipt-home-canvas canvas",
        "calendar": "#receipt-calendar-canvas canvas",
        "edit": "#receipt-edit-canvas canvas",
    }.get(mode_key, "#receipt-home-canvas canvas")
    tap_canvas_pointer(page, sel, pt)


def run_flow(page, label):
    wait_receipt_home(page)
    ok(page.evaluate("typeof window.goToView === 'function'"), label + " · goToView 存在")

    center = page.evaluate("() => ReceiptModule._test.paperCenterClientPoint('home')")
    ok(center is not None, label + " · 首页纸面中心可定位")
    if center:
        y0 = page.evaluate("() => ReceiptModule._test.sceneParticleY('home')")
        drag_canvas_pointer(
            page,
            "#receipt-home-canvas canvas",
            center,
            {"x": center["x"] + 60, "y": center["y"] + 85},
        )
        page.wait_for_timeout(500)
        y1 = page.evaluate("() => ReceiptModule._test.sceneParticleY('home')")
        ok(
            y0 is not None and y1 is not None and abs(y1 - y0) > 0.002,
            label + " · 首页纸面可拖拽下垂",
        )

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

    page.wait_for_selector("#receipt-edit-canvas canvas", state="attached", timeout=20000)
    page.wait_for_timeout(700)

    count_before = page.evaluate("() => ReceiptModule._test.editItemCount()")
    add_pt = page.evaluate("() => ReceiptModule._test.paperRegionClientPoint('edit', 'add')")
    ok(add_pt is not None, label + " · 编辑页增加一行区域可定位")
    if add_pt:
        ok(
            page.evaluate(
                f"() => ReceiptModule._test.probeEditHitAt({add_pt['x']}, {add_pt['y']})?.id === 'add'"
            ),
            label + " · 增加一行落点射线命中",
        )
        tap_canvas_pointer(page, "#receipt-edit-canvas canvas", add_pt)
        page.wait_for_timeout(500)
        ok(
            page.evaluate(
                f"() => ReceiptModule._test.editItemCount() > {count_before}"
            ),
            label + " · 点增加一行可响应",
        )

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
