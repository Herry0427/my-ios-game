/** 记账簿模块 smoke test（纯逻辑，不依赖 Three.js） */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var receiptPath = path.join(__dirname, '..', 'receipt.js');
var receiptCode = fs.readFileSync(receiptPath, 'utf8');
var code = receiptCode;
var sandbox = { window: {}, global: {}, console: console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
var t = sandbox.window.ReceiptModule._test;

var fails = 0;
function ok(cond, msg) {
  if (cond) console.log('OK:', msg);
  else {
    console.error('FAIL:', msg);
    fails += 1;
  }
}

ok(t.sumItems([{ qty: '5m', name: 'x', price: '¥150.00' }]) === 150, '5m 行价');
ok(t.normalizeReceiptConfig({ items: [{ qty: 2, name: 'a', price: '¥10.00' }] }).total === '¥20.00', '合计');
ok(!t.receiptConfigHasData({ items: [{ qty: 1, name: '****', price: '¥0.00' }] }), '空小票无蓝点');
ok(!t.receiptConfigHasData({ items: [{ qty: 1, name: '地铁', price: '¥0.00' }] }), '零金额无蓝点');
ok(t.receiptConfigHasData({ items: [{ qty: 1, name: '地铁', price: '¥12.60' }] }), '有金额才有蓝点');
var k1 = t.randomTerminalForDate(new Date(2026, 5, 1));
var k2 = t.randomTerminalForDate(new Date(2026, 5, 1));
ok(k1 === k2 && /^NO\.\d{3}$/.test(k1), '每日 NO.');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok(html.indexOf('btn-enter-receipt') >= 0, '大厅入口');
ok(html.indexOf('btn-force-refresh') >= 0, '大厅强制刷新');
ok(html.indexOf('forceRefreshAppCache') >= 0, '强制刷新逻辑');
ok(html.indexOf('receipt_home') >= 0, '路由');
ok(receiptCode.indexOf('nav_calendar') >= 0, '纸上日历按钮');
ok(receiptCode.indexOf('nav_ledger') >= 0, '纸上记账按钮');
ok(receiptCode.indexOf('nav_save') >= 0, '纸上保存按钮');
ok(html.indexOf('receipt-nav-bar') < 0, '无底部功能栏');
ok(html.indexOf("case 'receipt_home':") >= 0, '左滑仅首页');
ok(receiptCode.indexOf('ResizeObserver') >= 0, '容器 ResizeObserver');
ok(receiptCode.indexOf('pruneEmptyReceiptDays') >= 0, '启动清理空小票键');
ok(/window\.goToView\s*=\s*goToView/.test(html), 'goToView 暴露给 receipt 模块');

console.log(fails ? '\n共 ' + fails + ' 项失败' : '\n全部通过');
process.exit(fails ? 1 : 0);
