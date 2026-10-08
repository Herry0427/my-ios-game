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
(function () {
  var cfg = t.normalizeReceiptConfig({ items: [{ qty: 1, name: '地铁', price: '¥12.00' }] });
  cfg.items.push({ qty: 1, name: '****', price: '¥0.00' });
  ok(t.normalizeReceiptConfig(cfg).items.length === 2, '增加空行后保留一行待编辑占位');
})();
ok(!t.receiptConfigHasData({ items: [{ qty: 1, name: '****', price: '¥0.00' }] }), '空小票无蓝点');
ok(t.receiptConfigHasData({ items: [{ qty: 1, name: '地铁', price: '¥0.00' }] }), '有名称无金额仍应保存');
ok(t.receiptConfigHasData({ items: [{ qty: 1, name: '地铁', price: '¥12.60' }] }), '有金额可保存');
ok(receiptCode.indexOf('function cloudOp') >= 0, '云端操作用 Promise.resolve 包装');
(function () {
  var income = t.appendEntry(t.normalizeReceiptConfig({ items: [] }), { type: 'income', category: '服务', amount: 25, note: '工资' });
  ok(income.entries.length === 1 && t.receiptConfigHasData(income), '入账单独存储并算作当天数据');
  ok(t.sumItems(income.items) === 0, '入账不算作消费');
  var excluded = t.appendEntry(income, { type: 'excluded', category: '购物', amount: 4, note: '' });
  ok(t.sumItems(excluded.items) === 0, '不计入收支不算作消费');
  var expense = t.appendEntry(excluded, { type: 'expense', category: '餐饮', amount: 12.5, note: '' });
  ok(t.sumItems(expense.items) === 12.5 && expense.entries.length === 3, '支出显示在旧小票且保留三种分类');
  var tagged = t.appendEntry(expense, { type: 'expense', category: '娱乐', amount: 5, note: '', tags: ['彩票'] });
  ok(tagged.entries[3].tags[0] === '彩票', '账目保存勾选标签');
  ok(t.cleanTag('  彩票  ') === '彩票', '标签去掉首尾空白');
})();
var k1 = t.randomTerminalForDate(new Date(2026, 5, 1));
var k2 = t.randomTerminalForDate(new Date(2026, 5, 1));
ok(k1 === k2 && /^NO\.\d{3}$/.test(k1), '每日 NO.');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok(html.indexOf('btn-enter-receipt') >= 0, '大厅入口');
ok(html.indexOf('receipt-entry-keypad') >= 0 && html.indexOf('receipt-entry-categories') >= 0, '分类与数字键盘入口');
ok(html.indexOf('id="receipt-entry-tag-toggle"') >= 0 && html.indexOf('id="receipt-entry-tags"') >= 0, '添加标签及快捷勾选入口');
ok(/getElementById\('btn-enter-receipt'\)\.onclick\s*=\s*function\s*\(\)\s*\{\s*goToView\('receipt_entry'\)/.test(html), '记账簿入口直达记账界面');
ok(html.indexOf('id="receipt-entry-history"') >= 0 && receiptCode.indexOf("goToView('receipt_home')") >= 0, '历史小票为记账界面的附属入口');
ok(html.indexOf('btn-force-refresh') >= 0, '大厅强制刷新');
ok(html.indexOf('forceRefreshAppCache') >= 0, '强制刷新逻辑');
ok(html.indexOf('receipt_home') >= 0, '路由');
ok(receiptCode.indexOf('nav_calendar') >= 0, '纸上日历按钮');
ok(receiptCode.indexOf('nav_ledger') >= 0, '纸上记账按钮');
ok(receiptCode.indexOf('resolveHitAtClient') >= 0, '编辑页屏幕坐标点选');
ok(receiptCode.indexOf('localHitFromClient') >= 0, '纸面平面落点供拖拽');
ok(receiptCode.indexOf('PAPER_GRAVITY') >= 0, '纸张保留固定下垂效果');
ok(!/requestPermission|deviceorientation|devicemotion|receipt-gyro-prompt/i.test(receiptCode + html), '记账簿不再请求重力感应权限');
ok(receiptCode.indexOf('开源节流') >= 0, '底部文案开源节流');
ok(html.indexOf('receipt-nav-bar') < 0, '无底部功能栏');
ok(html.indexOf("case 'receipt_home':") >= 0, '左滑仅首页');
ok(receiptCode.indexOf('ResizeObserver') >= 0, '容器 ResizeObserver');
ok(receiptCode.indexOf('pruneEmptyReceiptDays') >= 0, '启动清理空小票键');
ok(receiptCode.indexOf('syncReceiptFromCloud') >= 0, '记账云端同步');
ok(receiptCode.indexOf('scheduleReceiptCloudSync') >= 0, '云端同步延后后台');
ok(receiptCode.indexOf('disposeReceiptScene') >= 0, '旧版低网格场景可重建');
ok(receiptCode.indexOf('isEditActionHit') >= 0, '编辑按钮与拖拽分流');
ok(receiptCode.indexOf('saveAndReturnHome') >= 0, '对外保存并返回');
ok(receiptCode.indexOf('editSaveHitAtClient') >= 0, '编辑页纸上保存多点命中');
ok(receiptCode.indexOf('wireInlineEditButtons') >= 0, '编辑条确定取消绑定');
ok(receiptCode.indexOf('revertInlineEdit') >= 0, '取消还原字段');
ok(receiptCode.indexOf('finishOnly === true') >= 0, '确定不把事件当 finishOnly');
ok(receiptCode.indexOf('isClientOnEditChrome') >= 0, '底部编辑条不与纸保存抢点');
ok(html.indexOf('receipt-edit-save-btn') < 0, '无额外 DOM 保存按钮');
ok(html.indexOf('编辑条须在 body 下') >= 0, '编辑条在 body 避免 canvas 挡触摸');
ok(receiptCode.indexOf('bindInlineEditBarChrome') >= 0, '编辑条阻止事件穿透 canvas');
ok(receiptCode.indexOf('startInlineEdit') >= 0, 'E2E 可测内联确定');
ok(receiptCode.indexOf('receipt_days') >= 0, 'receipt_days 表 upsert');
ok(/RECEIPT_TARGET_FILL_H/.test(receiptCode), '纸面目标高度占比');
(function () {
  var z = t.computeReceiptCameraZ(390, 700);
  var halfTan = Math.tan((40 * Math.PI / 180) / 2);
  var aspect = 390 / 700;
  var fillW = 3.84 / (2 * z * halfTan * aspect);
  var fillH = 7.68 / (2 * z * halfTan);
  ok(Math.abs(fillW - 0.94) < 0.03 || Math.abs(fillH - 0.88) < 0.03, '手机屏占比接近绿框');
})();
ok(/window\.goToView\s*=\s*goToView/.test(html), 'goToView 暴露给 receipt 模块');

// Simulate two devices and two nicknames without touching a real database.
(async function () {
  var rows = {};
  var storage = function () {
    var data = {};
    return {
      get length() { return Object.keys(data).length; },
      key: function (i) { return Object.keys(data)[i] || null; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }
    };
  };
  var client = { from: function () {
    return {
      select: function () { return { eq: function (_, owner) {
        return Promise.resolve({ data: Object.keys(rows).filter(function (k) { return k.indexOf(owner + ':') === 0; }).map(function (k) {
          return { day_key: k.split(':')[1], config: rows[k] };
        }) });
      } }; },
      upsert: function (r) { rows[r.user_id + ':' + r.day_key] = r.config; return Promise.resolve({ error: null }); },
      delete: function () { return { eq: function (_, owner) { return { eq: function (_, day) {
        delete rows[owner + ':' + day]; return Promise.resolve({ error: null });
      } }; } }; }
    };
  } };
  function device(store, name) {
    var win = { getSb: function () { return client; }, getReceiptOwnerKey: function () { return name.value; } };
    var ctx = { window: win, localStorage: store, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return win.ReceiptModule;
  }
  var firstStore = storage();
  var user = { value: '甲' };
  var first = device(firstStore, user);
  firstStore.setItem('receipt_day_2026-01-01', JSON.stringify({ items: [{ qty: 1, name: '旧账单', price: '¥9.00' }] }));
  first.refreshAccount();
  ok(!rows['甲:2026-01-01'], '旧数据不会未经确认自动上传');
  var today = first._test.dateKey(new Date());
  rows['甲:' + today] = { items: [{ qty: 1, name: '云端旧支出', price: '¥18.00' }] };
  ok(first._test.addEntryTag('彩票'), '自定义标签可立即添加');
  await first.syncReceiptFromCloud();
  ok(rows['甲:' + today].savedTags[0] === '彩票', '标签随账单同步到云端');
  ok(rows['甲:' + today].items[0].name === '云端旧支出', '新增标签不会覆盖当天已有云端账单');
  ok(first.importLegacyDays(), '旧账单可明确归属当前账号');
  await first.syncReceiptFromCloud();
  ok(!!rows['甲:2026-01-01'], '旧账单上传到云端');
  ok(!!firstStore.getItem('receipt_day_2026-01-01'), '旧账单原始数据保留');
  var secondStore = storage();
  var second = device(secondStore, { value: '甲' });
  await second.syncReceiptFromCloud();
  ok(!!secondStore.getItem('receipt_account_%E7%94%B2_2026-01-01'), '新设备同账号拉取账单');
  ok(second._test.collectSavedTags().indexOf('彩票') >= 0, '新设备同账号可快捷勾选标签');
  user.value = '乙';
  first.refreshAccount();
  await first.syncReceiptFromCloud();
  ok(!rows['乙:2026-01-01'], '切换账号不会上传甲的账单到乙');
  ok(!first.importLegacyDays(), '旧账单不能被第二个账号再次认领');
  console.log(fails ? '\n共 ' + fails + ' 项失败' : '\n全部通过');
  process.exit(fails ? 1 : 0);
})().catch(function (err) { console.error(err); process.exit(1); });
