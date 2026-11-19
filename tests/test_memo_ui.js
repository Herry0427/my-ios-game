/**
 * 备忘清单页面浅色卡片风格 smoke test（纯结构，不启动浏览器）
 *
 * 运行：node tests/test_memo_ui.js
 */
var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

var fails = 0;
function ok(cond, msg) {
  if (cond) console.log('OK:', msg);
  else {
    console.error('FAIL:', msg);
    fails += 1;
  }
}

function ruleBody(selector) {
  var start = html.indexOf(selector + ' {');
  if (start < 0) return '';
  return html.slice(start, html.indexOf('}', start));
}

var memoStart = html.indexOf('<section id="memo-screen"');
var memo = html.slice(memoStart, html.indexOf('</section>', memoStart));
var cssStart = html.indexOf('/* —— 备孕备忘清单 memo-screen');
var css = html.slice(cssStart, html.indexOf('.ui-swipe-hint', cssStart));

ok(memoStart >= 0, '备忘页面存在');
ok(/id="memo-back"[\s\S]{0,220}goToView|memoBack\.onclick[\s\S]{0,120}goToView\('lobby'\)/.test(html), '返回按钮绑定大厅');
ok(memo.indexOf('class="memo-back"') >= 0 && memo.indexOf('<svg ') >= 0, '左上角为圆角图标返回按钮');
ok(memo.indexOf('href="#"') < 0 && memo.indexOf('onclick=') < 0, '返回按钮不依赖内联跳转');
ok(memo.indexOf('>备忘清单<') >= 0, '标题为备忘清单');

ok(/background:\s*#F5F7FA/.test(ruleBody('#memo-screen.screen')), '页面浅灰背景');
ok(/color:\s*#1E293B/.test(ruleBody('#memo-screen.screen')), '主文字深灰黑');
ok(/\.memo-section-label\s*\{[^}]*color:\s*#64748B/.test(css), '分组标题中灰');
ok(css.indexOf('#6366F1') >= 0, '使用蓝紫强调色');

ok(memo.indexOf('memo-divider-line') < 0, '删除已完成横线分隔');
ok(memo.indexOf('只保留48小时') < 0 && memo.indexOf('48 小时后自动清理') >= 0, '改为低调时限提示');
ok(memo.indexOf('memo-swipe-hint-bar') < 0 && memo.indexOf('ARCADE HUB') < 0, '删除底部内部提示文字');
ok(memo.indexOf('需 SB_KEY 同步') < 0 && memo.indexOf('SB_KEY') < 0, '不再暴露同步配置信息');

ok(/border-radius:\s*14px/.test(ruleBody('#memo-screen .memo-row')), '待办卡片 14px 圆角');
ok(/background:\s*#FFFFFF/.test(ruleBody('#memo-screen .memo-row')), '待办卡片纯白');
ok(/box-shadow:/.test(ruleBody('#memo-screen .memo-row')), '待办卡片微阴影');
ok(/border-radius:\s*50%/.test(ruleBody('#memo-screen .memo-check')), '圆形复选框');
ok(/text-decoration:\s*line-through/.test(ruleBody('#memo-screen .memo-row.memo-done .memo-text')), '已完成删除线');
ok(/::before/.test(css) && css.indexOf("content: '📝'") >= 0, '空状态柔和图标');

ok(/max-width:\s*760px/.test(ruleBody('#memo-screen .memo-list-scroll')), '桌面端列表限宽 760px');
ok(/max-width:\s*760px/.test(ruleBody('#memo-screen .memo-bottom-bar')), '桌面端胶囊栏限宽 760px');
ok(/border-radius:\s*22px/.test(ruleBody('#memo-screen .memo-bottom-bar')), '底部胶囊栏圆角');
ok(/backdrop-filter:\s*blur\(14px\)/.test(ruleBody('#memo-screen .memo-bottom-bar')), '底部胶囊毛玻璃');
ok(/background:\s*#F1F5F9/.test(ruleBody('#memo-screen .memo-bar-input')), '输入框浅灰底');
ok(/border-radius:\s*14px/.test(ruleBody('#memo-screen .memo-bar-input')), '输入框 14px 圆角');
ok(/background:\s*#6366F1/.test(ruleBody('#memo-screen .memo-bar-add')), '发送按钮高亮蓝紫');
ok(memo.indexOf('memo-bar-date-face') >= 0 && memo.indexOf('<rect x="4" y="5"') >= 0, '日期按钮使用 SVG 图标');

['memo-list-scroll', 'memo-list-active', 'memo-list-done', 'memo-footer-fixed', 'memo-bottom-bar', 'memo-input-hitbox', 'memo-input', 'memo-due', 'memo-add-btn', 'memo-compose-hint', 'memo-toast'].forEach(function (id) {
  ok(memo.indexOf('id="' + id + '"') >= 0, '保留 id: ' + id);
});

ok(css.indexOf('#00ff88') < 0 && css.indexOf('rgba(18, 26, 40') < 0, '已移除黑底荧光绿样式');

if (fails) {
  console.error('\n共 ' + fails + ' 项失败');
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
