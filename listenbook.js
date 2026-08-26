/**
 * 听书：粘贴超长文本，默认整篇连读；点「拆成段落」才分段。系统语音可选音色。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'arcade_listenbook_v2';
  var SEGMENT_MAX = 1400;
  var UTTERANCE_MAX = 320;
  var MERGE_MIN = 80;
  var DECOR_LINE = /^[\s=\-*_—－]{3,}$/;
  var CHAPTER_RE = /^第[一二三四五六七八九十百零0-9]+章/;
  var LOOP_MODES = ['one', 'all', 'off'];
  var LOOP_LABEL = { one: '循环：开', all: '循环：逐段', off: '循环：关' };
  var RATES = [0.85, 0.95, 1, 1.1];
  var RATE_LABEL = { '0.85': '语速：慢', '0.95': '语速：稍慢', '1': '语速：常速', '1.1': '语速：稍快' };
  var SAMPLE_LINE = '这是当前音色。用于朗读备考资料，口齿会更清楚一些。';

  var state = {
    text: '',
    segments: [],
    splitOn: false,
    index: 0,
    utterIndex: 0,
    playing: false,
    loop: 'one',
    rate: 1,
    voiceURI: '',
    bound: false
  };
  var speakGen = 0;
  var keepTimer = null;
  var persistTimer = null;
  var textTimer = null;

  function cleanForSpeech(text) {
    var lines = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');
    var out = [];
    var i;
    var s;
    for (i = 0; i < lines.length; i++) {
      s = lines[i].replace(/\s+$/g, '');
      if (DECOR_LINE.test(s)) continue;
      out.push(s);
    }
    return out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/★/g, '星标')
      .replace(/^\s+|\s+$/g, '');
  }

  function textForSpeak(text) {
    var t = cleanForSpeech(text);
    if (!t) return '';
    t = t.replace(/\n{2,}/g, '。');
    t = t.replace(/\n/g, '，');
    t = t.replace(/[，。]{2,}/g, '。');
    t = t.replace(/^[，。]+|[，。]+$/g, '');
    return t;
  }

  function isChapterTitle(line) {
    var t = String(line || '').replace(/^\s+|\s+$/g, '');
    if (!t || t.length > 48) return false;
    if (CHAPTER_RE.test(t)) return true;
    if (/^附录/.test(t)) return true;
    return false;
  }

  function shortTitle(title, fallback) {
    var t = String(title || '')
      .replace(/\s+/g, '')
      .replace(/【|】/g, '');
    if (!t) return fallback || '段落';
    return t.length > 22 ? t.slice(0, 22) : t;
  }

  function splitKeepPunct(text) {
    var raw = String(text || '').split(/([。！？；;!?\n])/);
    var out = [];
    var i;
    var p;
    for (i = 0; i < raw.length; i++) {
      p = raw[i];
      if (!p) continue;
      if (/^[。！？；;!?\n]$/.test(p) && out.length) out[out.length - 1] += p;
      else out.push(p);
    }
    return out.length ? out : [String(text || '')];
  }

  function splitLongBlock(text, maxChars) {
    var segs = [];
    var parts;
    var buf = '';
    var i;
    var p;
    if (!text) return [];
    if (text.length <= maxChars) return [text];
    parts = splitKeepPunct(text);
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (!p) continue;
      if (p.length > maxChars) {
        if (buf) {
          segs.push(buf);
          buf = '';
        }
        segs.push.apply(segs, hardSlice(p, maxChars));
        continue;
      }
      if (buf && buf.length + p.length > maxChars) {
        segs.push(buf);
        buf = p;
      } else {
        buf += p;
      }
    }
    if (buf) segs.push(buf);
    return segs;
  }

  function hardSlice(text, maxChars) {
    var out = [];
    var i;
    for (i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
    return out;
  }

  function packBodies(bodies, maxChars) {
    var packed = [];
    var buf = '';
    var i;
    var b;
    var bits;
    var j;
    function flush() {
      if (buf) packed.push(buf);
      buf = '';
    }
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      if (!b) continue;
      if (b.length > maxChars) {
        flush();
        bits = splitLongBlock(b, maxChars);
        for (j = 0; j < bits.length; j++) packed.push(bits[j]);
        continue;
      }
      if (buf && buf.length + 1 + b.length > maxChars) {
        flush();
        buf = b;
      } else {
        buf = buf ? buf + '\n' + b : b;
      }
    }
    flush();
    return packed;
  }

  function splitChapterBlocks(text) {
    var lines = String(text || '').split('\n');
    var starts = [];
    var parts = [];
    var i;
    var n;
    var j;
    var title;
    var body;
    var head;
    for (i = 0; i < lines.length; i++) {
      if (isChapterTitle(lines[i])) starts.push(i);
    }
    if (!starts.length) {
      return [{ title: '全文', body: text }];
    }
    if (starts[0] > 0) {
      head = lines.slice(0, starts[0]).join('\n').replace(/^\s+|\s+$/g, '');
      if (head) parts.push({ title: '前言', body: head });
    }
    for (n = 0; n < starts.length; n++) {
      i = starts[n];
      j = n + 1 < starts.length ? starts[n + 1] : lines.length;
      title = lines[i].replace(/^\s+|\s+$/g, '');
      body = lines.slice(i, j).join('\n').replace(/^\s+|\s+$/g, '');
      if (body) parts.push({ title: shortTitle(title, '章节'), body: body });
    }
    return parts.length ? parts : [{ title: '全文', body: text }];
  }

  function splitIntoSegments(text, maxChars) {
    var cap = maxChars == null ? SEGMENT_MAX : maxChars;
    var cleaned = cleanForSpeech(text);
    var chapters;
    var out = [];
    var c;
    var packed;
    var i;
    var title;
    var spoken;
    if (!cleaned) return [];
    chapters = splitChapterBlocks(cleaned);
    for (c = 0; c < chapters.length; c++) {
      packed = packBodies(
        chapters[c].body.split(/\n+/).map(function (s) {
          return s.replace(/^\s+|\s+$/g, '');
        }).filter(Boolean),
        cap
      );
      if (!packed.length) continue;
      title = chapters[c].title;
      if (packed.length === 1) {
        spoken = textForSpeak(packed[0]);
        out.push({
          title: title,
          body: spoken,
          charCount: spoken.length
        });
      } else {
        for (i = 0; i < packed.length; i++) {
          spoken = textForSpeak(packed[i]);
          out.push({
            title: title + '（' + (i + 1) + '/' + packed.length + '）',
            body: spoken,
            charCount: spoken.length
          });
        }
      }
    }
    mergeTinyTail(out, cap);
    return out;
  }

  function mergeTinyTail(segs, maxChars) {
    var last;
    var prev;
    if (segs.length < 2) return;
    last = segs[segs.length - 1];
    prev = segs[segs.length - 2];
    if (last.charCount >= MERGE_MIN) return;
    if (prev.charCount + last.charCount + 1 > maxChars) return;
    prev.body += last.body;
    prev.charCount = prev.charCount + last.charCount;
    segs.pop();
  }

  function splitIntoUtterances(text, maxChars) {
    var cap = maxChars == null ? UTTERANCE_MAX : maxChars;
    var t = String(text || '').replace(/^\s+|\s+$/g, '');
    if (!t) return [];
    return splitLongBlock(t, cap).filter(function (s) {
      return s.replace(/^\s+|\s+$/g, '');
    });
  }

  function wholeSegment(text) {
    var body = textForSpeak(text);
    if (!body) return [];
    return [{ title: '全文', body: body, charCount: body.length }];
  }

  function activeSegments() {
    if (state.splitOn && state.segments.length) return state.segments;
    return wholeSegment(state.text);
  }

  function scoreVoice(v) {
    var n = (String(v && v.name || '') + ' ' + String(v && v.lang || '')).toLowerCase();
    var s = 0;
    if (!n.replace(/\s/g, '')) return -999;
    if (!/zh|cmn|yue|chinese|中文|普通话|国语|粤|ting|meijia|sinji|nannan|tian/.test(n)) s -= 250;
    if (/compact/.test(n)) s -= 90;
    if (/ting-ting|tingting/.test(n) && !/enhanced|premium|siri/.test(n)) s -= 50;
    if (/enhanced|premium|neural|siri|质量/.test(n)) s += 120;
    if (/meijia|美佳|nannan|tian-tian|婷婷（增强|yu-shu/.test(n)) s += 55;
    if (/zh-cn|zh_cn|zh-hans|cmn-hans|普通话/.test(n)) s += 35;
    if (/zh-tw|zh-hk|yue|sinji|粤/.test(n)) s += 8;
    if (/male|男|yunxi|yunyang|liang|kangkang/.test(n)) s += 5;
    return s;
  }

  function listZhVoices() {
    var all;
    var i;
    var v;
    var n;
    var out = [];
    if (!ttsAvailable()) return [];
    all = window.speechSynthesis.getVoices() || [];
    for (i = 0; i < all.length; i++) {
      v = all[i];
      n = String(v.lang || '') + ' ' + String(v.name || '');
      if (!/zh|cmn|yue|chinese|中文|普通话|国语|粤|ting|meijia|sinji/i.test(n)) continue;
      out.push(v);
    }
    out.sort(function (a, b) {
      return scoreVoice(b) - scoreVoice(a);
    });
    return out;
  }

  function resolveVoice() {
    var list = listZhVoices();
    var i;
    if (!list.length) return null;
    if (state.voiceURI) {
      for (i = 0; i < list.length; i++) {
        if (list[i].voiceURI === state.voiceURI || list[i].name === state.voiceURI) return list[i];
      }
    }
    return list[0];
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('arcade_listenbook_v1');
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.text === 'string') state.text = o.text;
      if (o && LOOP_MODES.indexOf(o.loop) >= 0) state.loop = o.loop;
      if (o && RATES.indexOf(Number(o.rate)) >= 0) state.rate = Number(o.rate);
      if (o && typeof o.voiceURI === 'string') state.voiceURI = o.voiceURI;
      if (o && o.splitOn) state.splitOn = true;
      if (o && typeof o.index === 'number' && o.index >= 0) state.index = o.index;
    } catch (e) {}
  }

  function saveStore() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          text: state.text,
          loop: state.loop,
          rate: state.rate,
          voiceURI: state.voiceURI,
          splitOn: state.splitOn,
          index: state.index
        })
      );
    } catch (e) {}
  }

  function scheduleSave() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(saveStore, 400);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setSourceText(text, opts) {
    state.text = String(text || '');
    if (opts && opts.clearSplit) {
      state.splitOn = false;
      state.segments = [];
      state.index = 0;
    }
    if (state.splitOn) state.segments = splitIntoSegments(state.text);
    else state.segments = [];
    if (opts && opts.resetIndex) state.index = 0;
    if (state.index >= activeSegments().length) state.index = 0;
    state.utterIndex = 0;
    renderAll();
    scheduleSave();
  }

  function doSplit() {
    state.splitOn = true;
    state.segments = splitIntoSegments(state.text);
    state.index = 0;
    state.utterIndex = 0;
    renderAll();
    saveStore();
  }

  function clearSplit() {
    state.splitOn = false;
    state.segments = [];
    state.index = 0;
    state.utterIndex = 0;
    renderAll();
    saveStore();
  }

  function fillVoiceSelect() {
    var sel = el('lb-voice');
    var list = listZhVoices();
    var i;
    var v;
    var label;
    var html;
    var keep = state.voiceURI;
    if (!sel) return;
    html = '<option value="">自动（优先清晰女声）</option>';
    for (i = 0; i < list.length; i++) {
      v = list[i];
      label = v.name || v.voiceURI || ('音色' + (i + 1));
      if (v.lang) label += ' · ' + v.lang;
      html += '<option value="' + escapeAttr(v.voiceURI || v.name) + '">' + escapeHtml(label) + '</option>';
    }
    sel.innerHTML = html;
    sel.value = keep || '';
    if (keep && sel.value !== keep) sel.value = '';
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderAll() {
    var input = el('lb-input');
    var meta = el('lb-meta');
    var list = el('lb-list');
    var now = el('lb-now');
    var play = el('lb-play');
    var loopBtn = el('lb-loop');
    var rateBtn = el('lb-rate');
    var splitBtn = el('lb-split-btn');
    var screen = el('listenbook-screen');
    var segs = activeSegments();
    var i;
    var s;
    var html;
    if (screen) screen.classList.toggle('lb-split-on', !!state.splitOn);
    if (input && input.value !== state.text) input.value = state.text;
    if (splitBtn) splitBtn.textContent = state.splitOn ? '改回整篇' : '拆成段落';
    if (meta) {
      if (!state.text) meta.textContent = '粘贴全文后点播放即可，只有需要按章听时再点拆成段落';
      else if (state.splitOn) meta.textContent = '已拆成 ' + segs.length + ' 段 · ' + state.text.length + ' 字';
      else meta.textContent = '整篇连读 · ' + state.text.length + ' 字';
    }
    if (list) {
      html = '';
      if (state.splitOn) {
        for (i = 0; i < segs.length; i++) {
          html +=
            '<li class="lb-item' +
            (i === state.index ? ' lb-item--on' : '') +
            '" data-lb-i="' +
            i +
            '"><span class="lb-item-idx">' +
            (i + 1 < 10 ? '0' : '') +
            (i + 1) +
            '</span><span class="lb-item-main"><span class="lb-item-title"></span><span class="lb-item-len">约 ' +
            segs[i].charCount +
            ' 字</span></span></li>';
        }
      }
      list.innerHTML = html;
      if (state.splitOn) {
        for (i = 0; i < segs.length; i++) {
          list.children[i].querySelector('.lb-item-title').textContent = segs[i].title;
        }
        s = list.querySelector('.lb-item--on');
        if (s && s.scrollIntoView) {
          try {
            s.scrollIntoView({ block: 'nearest' });
          } catch (e2) {}
        }
      }
    }
    if (now) {
      now.textContent = !segs.length
        ? '先粘贴文本再播放'
        : (state.playing ? '朗读中 · ' : '') + segs[state.index].title;
    }
    if (play) play.textContent = state.playing ? '停止' : '播放';
    if (loopBtn) loopBtn.textContent = LOOP_LABEL[state.loop] || LOOP_LABEL.one;
    if (rateBtn) rateBtn.textContent = RATE_LABEL[String(state.rate)] || '语速：常速';
  }

  function ttsAvailable() {
    return typeof window !== 'undefined' && window.speechSynthesis && window.SpeechSynthesisUtterance;
  }

  function startKeepalive() {
    stopKeepalive();
    keepTimer = setInterval(function () {
      if (!state.playing || !ttsAvailable()) return;
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch (e) {}
    }, 8000);
  }

  function stopKeepalive() {
    if (keepTimer) {
      clearInterval(keepTimer);
      keepTimer = null;
    }
  }

  function stopSpeak() {
    speakGen += 1;
    state.playing = false;
    stopKeepalive();
    if (ttsAvailable()) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    renderAll();
  }

  function speakText(text, onDone, fresh) {
    var gen;
    var u;
    var voice;
    if (!ttsAvailable()) {
      if (onDone) onDone(new Error('no_tts'));
      return;
    }
    if (fresh) {
      speakGen += 1;
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    gen = speakGen;
    setTimeout(function () {
      if (gen !== speakGen) return;
      u = new window.SpeechSynthesisUtterance(text);
      voice = resolveVoice();
      u.lang = (voice && voice.lang) || 'zh-CN';
      u.rate = state.rate;
      u.pitch = 1.04;
      u.volume = 1;
      if (voice) u.voice = voice;
      u.onend = function () {
        if (gen !== speakGen) return;
        if (onDone) onDone(null);
      };
      u.onerror = function (ev) {
        var et;
        if (gen !== speakGen) return;
        et = ev && ev.error;
        if (et === 'interrupted' || et === 'canceled') return;
        if (onDone) onDone(new Error(et === 'synthesis-unavailable' ? 'no_tts' : 'tts_error'));
      };
      try {
        window.speechSynthesis.resume();
      } catch (e2) {}
      window.speechSynthesis.speak(u);
    }, fresh ? 80 : 20);
  }

  function playUtterance(fresh) {
    var segs = activeSegments();
    var utters;
    var chunk;
    if (!segs.length) {
      stopSpeak();
      return;
    }
    if (state.index < 0) state.index = 0;
    if (state.index >= segs.length) state.index = 0;
    utters = splitIntoUtterances(segs[state.index].body);
    if (!utters.length) {
      advanceAfterSegment();
      return;
    }
    if (state.utterIndex >= utters.length) {
      advanceAfterSegment();
      return;
    }
    chunk = utters[state.utterIndex];
    state.playing = true;
    startKeepalive();
    renderAll();
    speakText(chunk, function (err) {
      if (!state.playing) return;
      if (err && err.message === 'no_tts') {
        stopSpeak();
        showTtsHint();
        return;
      }
      state.utterIndex += 1;
      playUtterance(false);
    }, fresh);
  }

  function advanceAfterSegment() {
    var segs = activeSegments();
    if (state.loop === 'one') {
      state.utterIndex = 0;
      playUtterance(false);
      return;
    }
    if (state.loop === 'all' && segs.length) {
      state.index = (state.index + 1) % segs.length;
      state.utterIndex = 0;
      playUtterance(false);
      return;
    }
    stopSpeak();
  }

  function showTtsHint() {
    var meta = el('lb-meta');
    if (meta) meta.textContent = '当前浏览器不支持朗读，请用 iPhone 自带 Safari 打开';
  }

  function startPlay(index) {
    var segs;
    if (el('lb-input')) state.text = el('lb-input').value || state.text;
    segs = activeSegments();
    if (!segs.length) return;
    if (!ttsAvailable()) {
      showTtsHint();
      return;
    }
    if (typeof index === 'number') state.index = index;
    if (state.index < 0) state.index = 0;
    if (state.index >= segs.length) state.index = 0;
    state.utterIndex = 0;
    state.playing = true;
    saveStore();
    playUtterance(true);
  }

  function togglePlay() {
    if (state.playing) {
      stopSpeak();
      return;
    }
    startPlay(state.index);
  }

  function goRel(delta) {
    var segs = activeSegments();
    var n;
    if (!segs.length || !state.splitOn) return;
    n = (state.index + delta + segs.length) % segs.length;
    if (state.playing) startPlay(n);
    else {
      state.index = n;
      state.utterIndex = 0;
      saveStore();
      renderAll();
    }
  }

  function cycleLoop() {
    var i = LOOP_MODES.indexOf(state.loop);
    state.loop = LOOP_MODES[(i + 1) % LOOP_MODES.length];
    saveStore();
    renderAll();
  }

  function cycleRate() {
    var i = RATES.indexOf(state.rate);
    if (i < 0) i = 2;
    state.rate = RATES[(i + 1) % RATES.length];
    saveStore();
    renderAll();
    if (state.playing) startPlay(state.index);
  }

  function onVoiceChange() {
    var sel = el('lb-voice');
    state.voiceURI = sel ? sel.value : '';
    saveStore();
    if (state.playing) startPlay(state.index);
    else if (ttsAvailable()) speakText(SAMPLE_LINE, function () {}, true);
  }

  function bindOnce() {
    var input;
    var list;
    if (state.bound) return;
    state.bound = true;
    input = el('lb-input');
    if (input) {
      input.addEventListener('input', function () {
        if (state.playing) stopSpeak();
        clearTimeout(textTimer);
        textTimer = setTimeout(function () {
          setSourceText(input.value, {});
        }, 280);
      });
    }
    if (el('lb-split-btn')) {
      el('lb-split-btn').addEventListener('click', function () {
        if (input) state.text = input.value || state.text;
        if (state.splitOn) clearSplit();
        else doSplit();
      });
    }
    if (el('lb-clear-btn')) {
      el('lb-clear-btn').addEventListener('click', function () {
        stopSpeak();
        setSourceText('', { resetIndex: true, clearSplit: true });
      });
    }
    if (el('lb-play')) el('lb-play').addEventListener('click', togglePlay);
    if (el('lb-prev')) el('lb-prev').addEventListener('click', function () { goRel(-1); });
    if (el('lb-next')) el('lb-next').addEventListener('click', function () { goRel(1); });
    if (el('lb-loop')) el('lb-loop').addEventListener('click', cycleLoop);
    if (el('lb-rate')) el('lb-rate').addEventListener('click', cycleRate);
    if (el('lb-voice')) el('lb-voice').addEventListener('change', onVoiceChange);
    list = el('lb-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var row = e.target.closest('[data-lb-i]');
        var i;
        if (!row) return;
        i = parseInt(row.getAttribute('data-lb-i'), 10);
        if (isNaN(i)) return;
        startPlay(i);
      });
    }
    if (ttsAvailable()) {
      try {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.addEventListener('voiceschanged', function () {
          fillVoiceSelect();
        });
      } catch (e) {}
    }
  }

  function onEnter() {
    bindOnce();
    loadStore();
    fillVoiceSelect();
    setSourceText(state.text, {});
  }

  function onLeave() {
    stopSpeak();
    if (state.bound) saveStore();
  }

  global.ListenbookModule = {
    onEnter: onEnter,
    onLeave: onLeave,
    bindOnce: bindOnce,
    _test: {
      cleanForSpeech: cleanForSpeech,
      textForSpeak: textForSpeak,
      isChapterTitle: isChapterTitle,
      splitIntoSegments: splitIntoSegments,
      splitIntoUtterances: splitIntoUtterances,
      splitChapterBlocks: splitChapterBlocks,
      wholeSegment: wholeSegment,
      scoreVoice: scoreVoice,
      SEGMENT_MAX: SEGMENT_MAX,
      UTTERANCE_MAX: UTTERANCE_MAX
    }
  };
})(typeof window !== 'undefined' ? window : global);
