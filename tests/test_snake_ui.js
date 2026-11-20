/**
 * 贪吃蛇模块 · 浅色卡片主题 + 交互修复 smoke test（纯结构，不启动浏览器）
 *
 * 运行：node tests/test_snake_ui.js
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

function block(startMarker, endMarker) {
  var s = html.indexOf(startMarker);
  if (s < 0) return '';
  var e = html.indexOf(endMarker, s);
  return html.slice(s, e < 0 ? undefined : e);
}

var theme = block('/* ========== 贪吃蛇 · 浅色卡片主题', '/* 横屏：画布左、方向键右');
var landscape = block('@media (orientation: landscape) and (max-height: 560px)', '  </style>');

ok(theme.length > 0, '存在贪吃蛇浅色主题样式块');
ok(/#snake-home-screen\.screen[\s\S]{0,200}background:\s*#F5F7FA/.test(theme), '模块首页浅灰背景');
ok(/#snake-screen\.screen[\s\S]{0,200}background:\s*#F5F7FA/.test(theme), '游戏页浅灰背景');
ok(/#shop-screen\.screen[\s\S]{0,120}#warehouse-screen\.screen/.test(theme), '商店与仓库共用浅色主题');
ok(/color:\s*#1E293B/.test(theme), '主文字深灰黑');
ok(/#snake-home-screen \.snake-menu-grid[\s\S]{0,160}grid-template-columns:\s*repeat\(2/.test(theme), '首页入口 2 列卡片');
ok(/box-shadow:\s*0 4px 16px/.test(ruleBody('#snake-home-screen .snake-menu-card')), '入口卡片微阴影');
ok(/#shop-screen \.eco-card[\s\S]{0,200}background:\s*#FFFFFF/.test(theme), '商店卡片纯白');
ok(/#leaderboard-screen \.lb-list[\s\S]{0,200}border-radius:\s*16px/.test(theme), '排行榜白色圆角卡片');
ok(/\.hub-modal-btn--primary\s*\{[^}]*background:\s*#168557/.test(theme), '浮层主按钮沿用绿色');
ok(/\.gameover-card[\s\S]{0,260}background:\s*#FFFFFF/.test(theme), '结算浮层改白色卡片');

ok(landscape.length > 0, '存在横屏媒体查询');
ok(/grid-template-areas:\s*[\s\S]{0,80}"play dpad"/.test(landscape), '横屏画布与方向键分栏');
ok(/aspect|min-height:\s*0/.test(landscape), '横屏解除方向键最小高度挤压');

var layout = block('function layoutSnakeScreen()', 'var sbClient');
ok(layout.indexOf('Math.max(200') < 0, '画布不再强制 200px 下限');
ok(/Math\.max\(96, Math\.min\(s, 560\)\)/.test(layout), '小屏画布允许缩到 96px');

var begin = block('function beginPlay(dx, dy)', 'function setDir(dx, dy)');
ok(/dir\.x === -dx && dir\.y === -dy/.test(begin), '首键反向时沿当前方向开局');

var pause = block('function pauseSnake()', 'function rebuildSnakeForRevive()');
ok(/phase = 'paused'/.test(pause), '暂停写入 paused 状态');
ok(/classList\.add\('visible'\)/.test(pause), '暂停显示继续提示层');
ok(/function resumeSnake/.test(html) && /requestAnimationFrame\(loop\)/.test(pause), '继续恢复主循环');
ok(/e\.key === ' ' \|\| e\.key === 'p'/.test(html), '空格 / P 可暂停');

var backMap = block("['snake-home-back', 'lobby']", 'var snakePauseBtn');
[
  ['snake-home-back', 'lobby'],
  ['snake-shop-back', 'snake_home'],
  ['snake-warehouse-back', 'snake_home'],
  ['snake-leaderboard-back', 'snake_home'],
  ['snake-game-back', 'snake_home'],
  ['go-home', 'snake_home']
].forEach(function (pair) {
  ok(
    backMap.indexOf("['" + pair[0] + "', '" + pair[1] + "']") >= 0,
    '返回按钮 ' + pair[0] + ' → ' + pair[1]
  );
});

var memoMarkup = block('<section id="snake-screen"', '</section>');
ok(memoMarkup.indexOf('id="snake-pause-btn"') >= 0, '游戏顶栏含暂停按钮');
ok(memoMarkup.indexOf('id="snake-game-back"') >= 0, '游戏顶栏含返回按钮');

['snake-home-screen', 'shop-screen', 'warehouse-screen', 'leaderboard-screen', 'snake-screen'].forEach(function (id) {
  ok(html.indexOf('<section id="' + id + '"') >= 0, '保留页面: ' + id);
});
['cloud-high', 'hub-coins', 'hub-calabash', 'hub-crates', 'wallet-strip', 'supabase-hint',
  'btn-snake-game', 'btn-snake-warehouse', 'btn-snake-shop', 'btn-snake-leaderboard',
  'shop-wallet-display', 'wh-crates-h', 'wh-tabs', 'lb-list', 'snake-live-score',
  'snake-lobby-overlay', 'lobby-current-loadout', 'lobby-diff', 'snake-btn-start',
  'snake-ready-overlay', 'snake-dpad', 'snake-canvas-box', 'snake-canvas',
  'gameover-modal', 'go-score-display', 'go-record-msg', 'go-sync-msg', 'go-replay', 'go-home',
  'revive-modal', 'revive-yes', 'revive-no', 'crate-modal', 'crate-ok', 'achv-modal', 'achv-ok'
].forEach(function (id) {
  ok(html.indexOf('id="' + id + '"') >= 0, '保留 id: ' + id);
});

ok(html.indexOf('ghostTrail.forEach') >= 0, '幽灵皮肤渲染拖尾');
ok(html.indexOf('embers.forEach') >= 0, '烈焰皮肤渲染火星');
ok(html.indexOf('style="color:var(--neon-magenta)"') < 0, '成就文案不再使用霓虹色');

ok(html.indexOf('🪙') < 0, '蛇币不再使用 emoji 占位');
ok(html.indexOf('var COIN_SVG') >= 0, '商店价格使用矢量蛇币图标');
ok(html.indexOf("COIN_SVG.replace('class=\"coin-ico\"', 'class=\"coin-ico coin-ico--lg\"')") >= 0,
  '宝箱蛇币奖励使用矢量图标');
ok(/\.coin-ico--lg\s*\{[^}]*width:\s*34px/.test(html), '宝箱蛇币图标有放大样式');
ok(html.indexOf('class="wallet-ico"') >= 0 && html.indexOf('<svg viewBox="0 0 24 24" aria-hidden="true"><circle') >= 0,
  '资产卡使用矢量图标');
ok(/\.eco-card\.locked \.eco-lock-mask[\s\S]{0,200}background: rgba\(248, 250, 252, 0\.72\)/.test(theme),
  '锁定卡片改为浅色蒙层');
ok(/#crate-card \.item-visual-wrap[\s\S]{0,260}background: linear-gradient/.test(theme),
  '宝箱图标改为浅色方块');
ok(/body:has\(#snake-home-screen\.active\) \.sync-strip/.test(theme), '同步提示条适配浅色页面');

if (fails) {
  console.error('\n共 ' + fails + ' 项失败');
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
