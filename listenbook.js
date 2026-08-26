/**
 * 听书：粘贴超长文本 → 智能分段 → 系统朗读循环背诵（Web Speech，不导出文件）
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'arcade_listenbook_v1';
  var SEGMENT_MAX = 1400;
  var UTTERANCE_MAX = 120;
  var MERGE_MIN = 80;
  var DECOR_LINE = /^[\s=\-*_—－]{3,}$/;
  var CHAPTER_RE = /^第[一二三四五六七八九十百零0-9]+章/;
  var LOOP_MODES = ['one', 'all', 'off'];
  var LOOP_LABEL = { one: '循环：单段', all: '循环：全部', off: '循环：关' };
  var RATES = [0.75, 0.9, 1, 1.15];
  var RATE_LABEL = { '0.75': '语速：很慢', '0.9': '语速：慢', '1': '语速：常速', '1.15': '语速：快' };

  var state = {
    text: '',
    segments: [],
    index: 0,
    utterIndex: 0,
    playing: false,
    loop: 'one',
    rate: 0.9,
    bound: false
  };
  var speakGen = 0;
  var keepTimer = null;
  var persistTimer = null;
  var splitTimer = null;

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
        out.push({ title: title, body: packed[0], charCount: packed[0].length });
      } else {
        for (i = 0; i < packed.length; i++) {
          out.push({
            title: title + '（' + (i + 1) + '/' + packed.length + '）',
            body: packed[i],
            charCount: packed[i].length
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
    prev.body += '\n' + last.body;
    prev.charCount = prev.body.length;
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

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o.text === 'string') state.text = o.text;
      if (o && LOOP_MODES.indexOf(o.loop) >= 0) state.loop = o.loop;
      if (o && RATES.indexOf(Number(o.rate)) >= 0) state.rate = Number(o.rate);
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

  function applyText(text, opts) {
    state.text = String(text || '');
    state.segments = splitIntoSegments(state.text);
    if (!state.segments.length) state.index = 0;
    else if (state.index >= state.segments.length) state.index = 0;
    if (opts && opts.resetIndex) state.index = 0;
    state.utterIndex = 0;
    renderAll();
    scheduleSave();
  }

  function renderAll() {
    var input = el('lb-input');
    var meta = el('lb-meta');
    var list = el('lb-list');
    var now = el('lb-now');
    var play = el('lb-play');
    var loopBtn = el('lb-loop');
    var rateBtn = el('lb-rate');
    var i;
    var s;
    var html;
    if (input && input.value !== state.text) input.value = state.text;
    if (meta) {
      meta.textContent = state.segments.length
        ? '共 ' + state.segments.length + ' 段 · ' + state.text.length + ' 字'
        : '粘贴全文后自动分段，越长越好背';
    }
    if (list) {
      html = '';
      for (i = 0; i < state.segments.length; i++) {
        s = state.segments[i];
        html +=
          '<li class="lb-item' +
          (i === state.index ? ' lb-item--on' : '') +
          '" data-lb-i="' +
          i +
          '"><span class="lb-item-idx">' +
          (i + 1 < 10 ? '0' : '') +
          (i + 1) +
          '</span><span class="lb-item-main"><span class="lb-item-title"></span><span class="lb-item-len">约 ' +
          s.charCount +
          ' 字</span></span></li>';
      }
      list.innerHTML = html;
      for (i = 0; i < state.segments.length; i++) {
        list.children[i].querySelector('.lb-item-title').textContent = state.segments[i].title;
      }
      s = list.querySelector('.lb-item--on');
      if (s && s.scrollIntoView) {
        try {
          s.scrollIntoView({ block: 'nearest' });
        } catch (e2) {}
      }
    }
    if (now) {
      now.textContent = state.segments.length
        ? (state.playing ? '朗读中 · ' : '') + state.segments[state.index].title
        : '还没有段落';
    }
    if (play) play.textContent = state.playing ? '停止' : '播放';
    if (loopBtn) loopBtn.textContent = LOOP_LABEL[state.loop] || LOOP_LABEL.one;
    if (rateBtn) rateBtn.textContent = RATE_LABEL[String(state.rate)] || '语速：慢';
  }

  function ttsAvailable() {
    return typeof window !== 'undefined' && window.speechSynthesis && window.SpeechSynthesisUtterance;
  }

  function pickZhVoice() {
    var voices;
    var i;
    var v;
    var n;
    if (!ttsAvailable()) return null;
    voices = window.speechSynthesis.getVoices() || [];
    for (i = 0; i < voices.length; i++) {
      v = voices[i];
      n = String(v.lang || '') + ' ' + String(v.name || '');
      if (/zh-CN|zh_CN|zh-Hans|cmn-Hans|Tingting|Ting-Ting|Meijia|Sinji|普通话|中文/i.test(n)) return v;
    }
    for (i = 0; i < voices.length; i++) {
      if (/^zh/i.test(voices[i].lang || '')) return voices[i];
    }
    return null;
  }

  function startKeepalive() {
    stopKeepalive();
    keepTimer = setInterval(function () {
      if (!state.playing || !ttsAvailable()) return;
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch (e) {}
    }, 4000);
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

  function speakText(text, onDone) {
    var gen = ++speakGen;
    var u;
    var voice;
    if (!ttsAvailable()) {
      if (onDone) onDone(new Error('no_tts'));
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
    setTimeout(function () {
      if (gen !== speakGen) return;
      u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = state.rate;
      u.pitch = 1;
      voice = pickZhVoice();
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
    }, 50);
  }

  function playUtterance() {
    var segs = state.segments;
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
      playUtterance();
    });
  }

  function advanceAfterSegment() {
    if (state.loop === 'one') {
      state.utterIndex = 0;
      playUtterance();
      return;
    }
    if (state.loop === 'all') {
      state.index = (state.index + 1) % state.segments.length;
      state.utterIndex = 0;
      playUtterance();
      return;
    }
    stopSpeak();
  }

  function showTtsHint() {
    var meta = el('lb-meta');
    if (meta) meta.textContent = '当前浏览器不支持朗读，请用 iPhone 自带 Safari 打开';
  }

  function startPlay(index) {
    if (!state.segments.length) applyText(state.text || (el('lb-input') && el('lb-input').value) || '');
    if (!state.segments.length) return;
    if (!ttsAvailable()) {
      showTtsHint();
      return;
    }
    if (typeof index === 'number') state.index = index;
    if (state.index < 0) state.index = 0;
    if (state.index >= state.segments.length) state.index = 0;
    state.utterIndex = 0;
    state.playing = true;
    saveStore();
    playUtterance();
  }

  function togglePlay() {
    if (state.playing) {
      stopSpeak();
      return;
    }
    startPlay(state.index);
  }

  function goRel(delta) {
    if (!state.segments.length) return;
    var n = (state.index + delta + state.segments.length) % state.segments.length;
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
    if (i < 0) i = 1;
    state.rate = RATES[(i + 1) % RATES.length];
    saveStore();
    renderAll();
    if (state.playing) startPlay(state.index);
  }

  function bindOnce() {
    var input;
    var list;
    if (state.bound) return;
    state.bound = true;
    input = el('lb-input');
    if (input) {
      input.addEventListener('paste', function () {
        setTimeout(function () {
          applyText(input.value, { resetIndex: true });
        }, 0);
      });
      input.addEventListener('input', function () {
        if (state.playing) stopSpeak();
        clearTimeout(splitTimer);
        splitTimer = setTimeout(function () {
          applyText(input.value, {});
        }, 280);
      });
    }
    if (el('lb-split-btn')) {
      el('lb-split-btn').addEventListener('click', function () {
        applyText((input && input.value) || state.text, { resetIndex: true });
      });
    }
    if (el('lb-clear-btn')) {
      el('lb-clear-btn').addEventListener('click', function () {
        stopSpeak();
        applyText('', { resetIndex: true });
      });
    }
    if (el('lb-play')) el('lb-play').addEventListener('click', togglePlay);
    if (el('lb-prev')) el('lb-prev').addEventListener('click', function () { goRel(-1); });
    if (el('lb-next')) el('lb-next').addEventListener('click', function () { goRel(1); });
    if (el('lb-loop')) el('lb-loop').addEventListener('click', cycleLoop);
    if (el('lb-rate')) el('lb-rate').addEventListener('click', cycleRate);
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
          pickZhVoice();
        });
      } catch (e) {}
    }
  }

  function onEnter() {
    bindOnce();
    loadStore();
    applyText(state.text, {});
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
      isChapterTitle: isChapterTitle,
      splitIntoSegments: splitIntoSegments,
      splitIntoUtterances: splitIntoUtterances,
      splitChapterBlocks: splitChapterBlocks,
      SEGMENT_MAX: SEGMENT_MAX,
      UTTERANCE_MAX: UTTERANCE_MAX
    }
  };
})(typeof window !== 'undefined' ? window : global);
