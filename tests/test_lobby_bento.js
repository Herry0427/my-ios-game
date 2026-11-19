/**
 * 大厅 Bento Grid 首页 smoke test（纯结构，不启动浏览器）
 *
 * 运行：node tests/test_lobby_bento.js
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

var lobby = html.slice(html.indexOf('<section id="lobby-screen"'), html.indexOf('</section>', html.indexOf('<section id="lobby-screen"')));

function ruleBody(selector) {
  var start = html.indexOf(selector + ' {');
  if (start < 0) return '';
  return html.slice(start, html.indexOf('}', start));
}

ok(lobby.indexOf('Hi, <span id="lobby-display-name">') >= 0, '欢迎栏显示 Hi, 昵称');
ok(lobby.indexOf('我的私人空间') >= 0, '欢迎栏副标题');
ok(/\.lobby-welcome\s*\{[^}]*text-align:\s*left/.test(html), '欢迎栏左对齐');

var welcomeStart = lobby.indexOf('class="lobby-welcome"');
var welcomeEnd = lobby.indexOf('</header>', welcomeStart);
var welcome = lobby.slice(welcomeStart, welcomeEnd);
var actionsStart = welcome.indexOf('class="lobby-actions"');
ok(welcomeStart >= 0 && actionsStart >= 0, '顶部欢迎栏包含操作按钮区');
ok(welcome.slice(actionsStart).indexOf('class="lobby-action-btn btn-force-refresh" id="btn-force-refresh"') >= 0, '顶部保留强制刷新按钮');
ok(welcome.slice(actionsStart).indexOf('class="lobby-action-btn btn-logout-switch" id="btn-logout-switch"') >= 0, '顶部保留退出登录按钮');
ok(welcome.slice(actionsStart).indexOf('title="强制刷新缓存并拉新代码"') >= 0, '刷新按钮 title 提示');
ok(welcome.slice(actionsStart).indexOf('title="退出登录 / 切换账号"') >= 0, '账号按钮 title 提示');
ok((welcome.slice(actionsStart).match(/<svg /g) || []).length === 2, '两个顶部按钮均为 SVG 图标');
ok(lobby.indexOf('lobby-footer') < 0, '底部文字按钮已移除');

var ids = ['btn-enter-receipt', 'btn-enter-memo', 'btn-enter-recipes', 'btn-enter-rpa', 'btn-enter-listenbook', 'btn-enter-snake'];
var positions = ids.map(function (id) { return lobby.indexOf('id="' + id + '"'); });
ok(positions.every(function (p) { return p >= 0; }), '六个入口按钮齐全');
ok(positions[0] >= 0 && positions.every(function (p, i) { return i === 0 || p > positions[i - 1]; }), '记账簿排在首位');
ok((lobby.match(/class="tile-btn/g) || []).length === 6, '大厅恰好六张入口卡片');
ok((lobby.match(/class="tile-icon"/g) || []).length === 6, '每张卡片都有图标');
ok((lobby.match(/<svg /g) || []).length >= 6, '图标使用 SVG');
ok((lobby.match(/class="tile-title"/g) || []).length === 6, '每张卡片都有主标题');
ok((lobby.match(/class="tile-sub"/g) || []).length === 6, '每张卡片都有副标题');

ok(html.indexOf('background: #F5F7FA') >= 0, '页面背景 #F5F7FA');
ok(/border-radius:\s*16px/.test(ruleBody('#lobby-screen .tile-btn')), '卡片圆角 16px');
ok(/repeat\(2,/.test(ruleBody('#lobby-screen .lobby-tile-grid')), '入口采用两列网格');
ok(/gap:\s*12px/.test(ruleBody('#lobby-screen .lobby-tile-grid')), '网格间距 12px');
ok(/grid-auto-rows:\s*120px/.test(ruleBody('#lobby-screen .lobby-tile-grid')), '卡片高度紧凑 120px');
ok(/overflow:\s*hidden/.test(ruleBody('#lobby-screen.screen')), '大厅不出现滚动条');
ok(/justify-content:\s*space-between/.test(ruleBody('.lobby-inner')), '内容纵向撑满首屏');
ok(/\.lobby-action-btn\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/.test(html), '顶部图标按钮 36×36');
ok(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]{0,220}translateY\(-3px\)/.test(html), '桌面悬停上浮');
ok(/#lobby-screen \.tile-btn:active\s*\{\s*transform:\s*scale\(0\.97\)/.test(html), '点击缩放反馈');
ok(/#lobby-screen \.lobby-footer/.test(html) === false, '旧底栏样式已清理');
ok(html.indexOf('forceRefreshAppCache') >= 0 && html.indexOf('clearArcadeSession()') >= 0, '刷新与退出逻辑保留');
ok(html.indexOf("btn.textContent = '正在清缓存并拉新") < 0, '刷新时不再覆盖图标');

var modalStart = html.indexOf('<div id="nickname-modal"');
var modal = html.slice(modalStart, html.indexOf('</div>', html.indexOf('nickname-actions', modalStart)));
ok(modalStart >= 0 && modal.indexOf('id="nickname-modal-title">登录<') >= 0, '登录弹窗只保留简洁标题');
ok(modal.indexOf('placeholder="请输入用户名"') >= 0, '输入框使用通用占位文案');
ok(modal.indexOf('Herry') < 0 && modal.indexOf('老婆') < 0 && html.indexOf('已有档案则进入') < 0, '无隐私示例与多余提示');
ok(modal.indexOf('autocomplete="off"') >= 0, '关闭历史用户名自动填充');
ok(modal.indexOf('id="nickname-input"') >= 0 && modal.indexOf('id="nickname-confirm"') >= 0, '登录控件 id 保持不变');
ok(/backdrop-filter:\s*blur\(6px\)/.test(ruleBody('#nickname-modal.modal-root')), '遮罩使用毛玻璃模糊');
ok(/#FFFFFF/.test(ruleBody('#nickname-modal .modal-pixel')) && /border-radius:\s*20px/.test(ruleBody('#nickname-modal .modal-pixel')), '弹窗为白色 20px 圆角');
ok(/background:\s*#F4F6F9/.test(ruleBody('#nickname-modal .modal-pixel input')), '输入框浅灰底色');
ok(/border-color:\s*#168557/.test(ruleBody('#nickname-modal .modal-pixel input:focus')), '聚焦显示绿色边框');
ok(/background:\s*#168557/.test(ruleBody('#nickname-modal .modal-pixel button')), '进入按钮为首页绿色');
ok(/nickInput\.value = ''/.test(ruleBody('function clearArcadeSession()')), '退出后清空用户名输入框');

ok(lobby.indexOf('btn-logout-switch') >= 0 && lobby.indexOf('btn-force-refresh') >= 0, '保留退出登录与强制刷新');

if (fails) {
  console.error('\n共 ' + fails + ' 项失败');
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
