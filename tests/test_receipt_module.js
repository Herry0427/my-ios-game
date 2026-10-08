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
ok(t.receiptConfigHasData({ tagActions: [{ tag: '彩票', time: 1, deleted: true }] }), '只删除标签的日期也能同步');
ok(t.calculateEntryAmount('2+3*4') === 14 && t.calculateEntryAmount('8/2-1') === 3, '四则运算遵循先乘除后加减');
ok(t.calculateEntryAmount('0.1+0.2') === 0.3 && t.calculateEntryAmount('10/4') === 2.5, '小数计算精确到分');
ok(t.calculateEntryAmount('1/0') === null && t.calculateEntryAmount('1+') === null && t.calculateEntryAmount('1..2') === null, '无效算式与除零不能保存');
ok(t.calculateEntryAmount('1-2') === null && t.calculateEntryAmount('999999999+1') === null, '非正数及超限金额不能保存');
t.entryDraft.amount = '';
'12+3*4='.split('').forEach(t.inputEntryAmount);
ok(t.entryDraft.amount === '24', '按等号显示计算结果');
t.inputEntryAmount('back');
ok(t.entryDraft.amount === '2', '计算结果可退格继续输入');
t.inputEntryAmount('+'); t.inputEntryAmount('5');
ok(t.calculateEntryAmount(t.entryDraft.amount) === 7, '计算后可继续运算');
t.entryDraft.amount = '';
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
ok(/src="receipt\.js\?v=[^"]+"/.test(html), '记账脚本带版本号，手机不会混用旧缓存');
ok(receiptCode.indexOf('if (calendarBack) calendarBack.onclick') >= 0, '日历返回按钮缺失不阻断手机记账入口');
ok(html.indexOf('receipt-entry-keypad') >= 0 && html.indexOf('receipt-entry-categories') >= 0, '分类与数字键盘入口');
['+', '-', '*', '/', '='].forEach(function (key) { ok(html.indexOf('data-key="' + key + '"') >= 0, '运算键 ' + key + ' 在页面'); });
ok(html.indexOf('id="receipt-entry-tag-delete"') >= 0, '删除标签按钮在页面');
ok(html.indexOf('id="btn-enter-rpa"') >= 0 && html.indexOf('id="rpa-frame"') >= 0, '手机主页可打开 RPA 看板模块');
ok(html.includes('id="receipt-entry-day-total"') && receiptCode.includes('entryDayExpenseTotal'), '日期左侧显示当日支出合计');
(function () {
  var ctx = { window: { getReceiptOwnerKey: function () { return 'summary'; } }, global: {}, console: console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  var x = ctx.window.ReceiptModule._test;
  var cfg = x.appendEntry(x.normalizeReceiptConfig({ items: [{ qty: 1, name: '旧小票', price: '¥5.00' }] }), { type: 'expense', category: '餐饮', amount: 12.5, note: '' });
  cfg = x.appendEntry(cfg, { type: 'income', category: '工资', amount: 100, note: '' });
  cfg = x.appendEntry(cfg, { type: 'excluded', category: '其他', amount: 20, note: '' });
  ok(x.sumItems(cfg.items) === 17.5, '当日支出含旧小票与快速记账，不计入账或排除项');
})();
ok(html.includes("from('rpa_dashboard_settings')") && html.includes('rpaLocalKey(owner)'), 'RPA 地址按账号云端保存与读取');
ok(html.includes('<span>RPA 报错流程</span>') && !html.includes('<span>R</span>PA'), 'RPA 模块标题不露出 HTML 残片');
ok(/#rpa-frame\s*\{[^}]*max-width:\s*430px/.test(html), '嵌入看板保持手机宽度以启用简化布局');
ok(receiptCode.includes("['工资', '💰']") && receiptCode.includes("['节日福利', '🎁']"), '入账提供工资和节日福利标签');
ok(/<input id="receipt-entry-note"[^>]*hidden>/.test(html) && !html.includes('<in</button>put'), '备注输入框是有效 HTML，不会露出源码');
ok(/data-key="back"[^>]*>⌫<\/button>/.test(html) && !html.includes('</button></button>'), '退格及保存按钮标签正确闭合');
var keypadMarkup = html.match(/<div class="receipt-entry-keypad" id="receipt-entry-keypad">([\s\S]*?)<\/div>/);
ok(!!keypadMarkup && !keypadMarkup[1].replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, '').trim(), '数字键盘按钮之间不能露出源码文字');
ok(html.indexOf('id="receipt-entry-tag-toggle"') >= 0 && html.indexOf('id="receipt-entry-tags"') < 0 && receiptCode.indexOf('receipt-entry-custom-tag') >= 0, '新增标签在上方类别网格快捷勾选');
ok(/getElementById\('btn-enter-receipt'\)\.onclick\s*=\s*function\s*\(\)\s*\{\s*goToView\('receipt_entry'\)/.test(html), '记账簿入口直达记账界面');
ok(html.indexOf('id="receipt-entry-history"') < 0 && html.indexOf('id="receipt-entry-date"') >= 0, '日期是日历唯一入口');
ok(receiptCode.indexOf("global.goToView('receipt_calendar')") >= 0 && receiptCode.indexOf("global.goToView('receipt_home')") >= 0, '点击日期进入日历并能查看当天小票');
ok(html.indexOf('id="receipt-calendar-back"') >= 0, '日历可以返回记账界面');
ok(html.indexOf('id="receipt-home-canvas"') < 0 && html.indexOf('id="receipt-day-entries"') >= 0, '单日账目只显示一处明细');
ok(html.indexOf('id="receipt-open-legacy"') >= 0, '旧小票编辑入口保留');
ok(receiptCode.indexOf("if (!entryDraft.category) { alert('请选择一个标签'); return false; }") >= 0, '没选标签无法提交');
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
    var win = { getSb: function () { return client; }, getReceiptOwnerKey: function () { return name.value; }, confirm: function () { return true; } };
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
  ok(first._test.entryDraft.category === '', '进入记账时不默认选中标签');
  ok(first._test.addEntryTag('彩票'), '自定义标签可立即添加');
  ok(first._test.entryDraft.category === '彩票', '添加后立即选中新标签');
  first._test.selectEntryCategory('餐饮');
  ok(first._test.entryDraft.category === '餐饮', '点击另一标签只保留当前选择');
  first._test.selectEntryCategory('彩票');
  ok(first._test.entryDraft.category === '彩票', '再次选择自定义标签不会多选');
  await first.syncReceiptFromCloud();
  ok(rows['甲:' + today].savedTags[0] === '彩票', '标签随账单同步到云端');
  ok(rows['甲:' + today].items[0].name === '云端旧支出', '新增标签不会覆盖当天已有云端账单');
  var quick = first._test.appendEntry(first._test.normalizeReceiptConfig({ items: [] }), { type: 'expense', category: '餐饮', amount: 40, note: '', tags: ['⛽️加油'] });
  quick = first._test.appendEntry(quick, { type: 'expense', category: '⛽️加油', amount: 40, note: '', tags: [] });
  ok(first._test.findQuickExpenseIndex(quick, quick.items[0]) === 0 && first._test.findQuickExpenseIndex(quick, quick.items[1]) === 1, '同金额但不同类别的支出正确匹配');
  var repeat = first._test.appendEntry(first._test.normalizeReceiptConfig({ items: [] }), { type: 'expense', category: '餐饮', amount: 12, note: '' });
  repeat = first._test.appendEntry(repeat, { type: 'expense', category: '餐饮', amount: 12, note: '' });
  ok(first._test.findQuickExpenseIndex(repeat, repeat.items[0]) === 0 && first._test.findQuickExpenseIndex(repeat, repeat.items[1]) === 1, '同类别同金额的重复支出按一对一匹配');
  firstStore.setItem('receipt_account_%E7%94%B2_' + today, JSON.stringify(quick));
  ok(first._test.removeDayEntry('entry', 0), '单日明细删除指定支出');
  var afterDelete = JSON.parse(firstStore.getItem('receipt_account_%E7%94%B2_' + today));
  ok(afterDelete.entries.length === 1 && afterDelete.entries[0].category === '⛽️加油' && afterDelete.items.filter(function (item) { return item.name === '餐饮'; }).length === 0, '删除不会误删相同金额的另一条账目');
  await first.syncReceiptFromCloud();
  ok(rows['甲:' + today].entries.length === 1 && rows['甲:' + today].entries[0].category === '⛽️加油', '删除结果同步到云端而不会被旧云端数据覆盖');
  ok(first._test.removeDayEntry('item', 0), '旧小票删除匹配的快速记账支出');
  afterDelete = JSON.parse(firstStore.getItem('receipt_account_%E7%94%B2_' + today));
  ok(!afterDelete || afterDelete.entries.length === 0 && !afterDelete.items.some(function (item) { return item.name === '⛽️加油'; }), '删旧小票时不会让快速记账明细残留');
  await first.syncReceiptFromCloud();
  ok(!rows['甲:' + today] || !rows['甲:' + today].entries.length, '第二次删除同步后不会复活');
  rows['甲:' + today] = { items: [{ qty: 1, name: '云端旧支出', price: '¥18.00' }] };
  firstStore.removeItem('receipt_account_%E7%94%B2_' + today);
  firstStore.setItem('receipt_account_%E7%94%B2_2026-01-02', JSON.stringify({ entries: [{ type: 'expense', category: '彩票', amount: 8, tags: ['彩票'] }], savedTags: ['彩票'] }));
  ok(first._test.deleteEntryTag() === true, '确认后可删除选中的自定义标签');
  ok(first._test.entryDraft.category === '' && first._test.collectSavedTags().indexOf('彩票') < 0, '删除后不再勾选且历史标签不会回流');
  ok(first._test.deleteEntryTag() === false, '未选中时不会删除标签');
  first._test.selectEntryCategory('餐饮');
  ok(first._test.deleteEntryTag() === false, '内置类别不可删除');
  await first.syncReceiptFromCloud();
  ok(rows['甲:' + today].items[0].name === '云端旧支出', '删除标签不会覆盖当天云端账单');
  ok(first._test.collectSavedTags().indexOf('彩票') < 0, '同步后删除标签不复活');
  ok(JSON.parse(firstStore.getItem('receipt_account_%E7%94%B2_2026-01-02')).entries[0].tags[0] === '彩票', '删除快捷标签不修改历史账目');
  ok(first.importLegacyDays(), '旧账单可明确归属当前账号');
  await first.syncReceiptFromCloud();
  ok(!!rows['甲:2026-01-01'], '旧账单上传到云端');
  ok(!!firstStore.getItem('receipt_day_2026-01-01'), '旧账单原始数据保留');
  var secondStore = storage();
  var second = device(secondStore, { value: '甲' });
  await second.syncReceiptFromCloud();
  ok(!!secondStore.getItem('receipt_account_%E7%94%B2_2026-01-01'), '新设备同账号拉取账单');
  ok(second._test.collectSavedTags().indexOf('彩票') < 0, '新设备同账号删除的标签不会复活');
  ok(second._test.addEntryTag('彩票'), '删除的标签可重新添加');
  await second.syncReceiptFromCloud();
  await first.syncReceiptFromCloud();
  ok(first._test.collectSavedTags().indexOf('彩票') >= 0, '重新添加的标签跨设备可见');
  user.value = '乙';
  first.refreshAccount();
  await first.syncReceiptFromCloud();
  ok(!rows['乙:2026-01-01'], '切换账号不会上传甲的账单到乙');
  ok(!first.importLegacyDays(), '旧账单不能被第二个账号再次认领');
  console.log(fails ? '\n共 ' + fails + ' 项失败' : '\n全部通过');
  process.exit(fails ? 1 : 0);
})().catch(function (err) { console.error(err); process.exit(1); });
