/** 听书模块 smoke test（纯拆段逻辑，不依赖浏览器语音） */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var srcPath = path.join(__dirname, '..', 'listenbook.js');
var src = fs.readFileSync(srcPath, 'utf8');
var sandbox = { window: {}, global: {}, console: console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
var t = sandbox.window.ListenbookModule._test;

var fails = 0;
function ok(cond, msg) {
  if (cond) console.log('OK:', msg);
  else {
    console.error('FAIL:', msg);
    fails += 1;
  }
}

ok(t.cleanForSpeech('===\n甲\n---\n乙').indexOf('=') < 0, '去掉装饰线');
ok(t.cleanForSpeech('★重点').indexOf('星标') >= 0, '星标可读');
ok(t.isChapterTitle('第一章  考试整体结构'), '识别第X章');
ok(t.isChapterTitle('第十四章  最终背诵清单'), '识别第十四章');
ok(!t.isChapterTitle('【使用说明】'), '小标题不当章');
ok(!t.isChapterTitle('这是一段很长很长很长很长很长很长很长很长很长很长的话'), '过长行不当章');

var sample =
  '封面说明若干字。\n\n' +
  '第一章  甲\n' +
  '甲段内容。\n\n' +
  '第二章  乙\n' +
  '乙段内容。';
var ch = t.splitChapterBlocks(t.cleanForSpeech(sample));
ok(ch.length === 3 && ch[0].title === '前言' && ch[1].title.indexOf('第一章') >= 0, '前言+两章');

var segs = t.splitIntoSegments(sample, 1400);
ok(segs.length >= 2, '按章拆成多段');
ok(segs.every(function (s) { return s.body && s.charCount === s.body.length; }), '每段有正文和字数');

var longPara = Array(120).join('这是一句用来测试超长文本自动切分的话。');
ok(longPara.length > 1400, '构造超长段');
var packed = t.splitIntoSegments(longPara, 400);
ok(packed.length >= 3, '无章节时按字数切开');
ok(packed.every(function (s) { return s.charCount <= 400; }), '单段不超过上限');

var huge = Array(8001).join('背');
ok(huge.length === 8000, '8000 字输入');
var hugeSegs = t.splitIntoSegments(huge, 1400);
ok(hugeSegs.length >= 5 && hugeSegs.length <= 8, '超长全文拆成若干段');
ok(hugeSegs.every(function (s) { return s.charCount <= 1400; }), '超长全文每段不超限');
var total = hugeSegs.reduce(function (n, s) { return n + s.charCount; }, 0);
ok(total >= 7900, '切分不丢字');

var utters = t.splitIntoUtterances('甲。乙！丙？丁；戊\n己', 8);
ok(utters.length >= 2, '按句切朗读块');
ok(utters.every(function (u) { return u.length <= 8; }), '朗读块不超过上限');

var oneShot = t.splitIntoUtterances('短句。', 120);
ok(oneShot.length === 1 && oneShot[0].indexOf('短句') >= 0, '短文一整块');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok(html.indexOf('btn-enter-listenbook') >= 0, '大厅入口');
ok(html.indexOf('listenbook-screen') >= 0, '听书页面');
ok(html.indexOf("listenbook: 'listenbook-screen'") >= 0, '路由');
ok(html.indexOf("case 'listenbook':") >= 0, '左滑返回大厅');
ok(html.indexOf('listenbook.js') >= 0, '引入脚本');
ok(html.indexOf('ListenbookModule.onEnter') >= 0, '进入模块');
ok(html.indexOf('ListenbookModule.onLeave') >= 0, '离开停止朗读');
ok(src.indexOf('speechSynthesis') >= 0, '系统朗读');
ok(src.indexOf("loop: 'one'") >= 0, '默认单条循环');
ok(src.indexOf('arcade_listenbook_v3') >= 0, '本地保存多条文本');
ok(src.indexOf("list: '循环：列表'") >= 0, '可切列表循环');
ok(src.indexOf('splitOn: false') >= 0, '默认不拆段');
ok(src.indexOf('doSplit') >= 0 && src.indexOf("addEventListener('paste'") < 0, '仅按钮拆分、粘贴不自动拆');
ok(html.indexOf('id="lb-add-btn"') >= 0, '加入列表');
ok(html.indexOf('<select id="lb-voice"') < 0, '音色不是下拉框');
ok(html.indexOf('id="lb-voice"') >= 0 && html.indexOf('音色：自动') >= 0, '音色是播放同款按钮');
ok(t.previewText('  第一章考试整体结构说明') === '第一章考试整体结构说', '预览前10字');
ok(t.PREVIEW_CHARS === 10, '预览长度10');
ok(t.textForSpeak('甲\n乙').indexOf('\n') < 0, '朗读时把换行收成停顿');
ok(t.wholeSegment('abc').length === 1 && t.wholeSegment('abc')[0].title === '全文', '默认整篇一段');
ok(
  t.scoreVoice({ name: 'Meijia (Enhanced)', lang: 'zh-CN' }) >
    t.scoreVoice({ name: 'Ting-Ting', lang: 'zh-CN' }),
  '增强女声优先于发糊的婷婷压缩音'
);
ok(t.UTTERANCE_MAX >= 280, '朗读块加长减少卡顿');
ok(html.indexOf('lb-lyric-box') >= 0 && html.indexOf('lb-lyric-toggle') >= 0, '三行歌词区与文字开关');
ok(src.indexOf('lyricsOn: true') >= 0, '默认显示歌词');
(function () {
  var w = t.lyricWindow(['甲。', '乙。', '丙。', '丁。'], 1);
  ok(w.prev === '甲。' && w.cur === '乙。' && w.next === '丙。', '歌词窗口上一句当前下一句');
})();

console.log(fails ? '\n共 ' + fails + ' 项失败' : '\n全部通过');
process.exit(fails ? 1 : 0);
