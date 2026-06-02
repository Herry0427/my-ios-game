/**
 * 记账簿 · 3D 小票模块（单页一张票，逻辑对齐 py/小票，独立维护）
 */
(function (global) {
  'use strict';

  var TEX_W = 512;
  var TEX_H = 1024;
  var DRAG_THRESHOLD = 10;
  var STORAGE_PREFIX = 'receipt_day_';
  var PAPER_W = 3.84;
  var PAPER_H = 7.68;
  var CAMERA_Z = 10.5;
  var CAMERA_Y = -0.35;

  var EMPTY_TEMPLATE = {
    autoTotal: true,
    title: '*** 今天消费 ***',
    showDate: true,
    items: [
      { qty: 2, name: '****', price: '¥0.00' },
      { qty: 1, name: '****', price: '¥0.00' }
    ],
    footer: ['谢谢惠顾！']
  };

  var state = {
    selectedDate: new Date(),
    calYear: 0,
    calMonth: 0,
    currentCfg: null,
    editSelection: null,
    editBuffer: '',
    datesWithData: {}
  };

  var scenes = { home: null, calendar: null, edit: null };
  var bound = false;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function pad3(n) {
    if (n < 10) return '00' + n;
    if (n < 100) return '0' + n;
    return String(n);
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function randomTerminalForDate(d) {
    var s = dateKey(d);
    var h = 0;
    var i;
    for (i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return 'NO.' + pad3(Math.abs(h) % 1000);
  }

  function parseQty(qty) {
    var s = String(qty).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    return 1;
  }

  function parsePrice(text) {
    if (!text) return 0;
    var num = parseFloat(String(text).replace(/[^0-9.\-]/g, ''));
    return isNaN(num) ? 0 : num;
  }

  function detectCurrency(items) {
    var i;
    for (i = 0; i < items.length; i++) {
      var price = String(items[i].price || '');
      if (price.indexOf('¥') >= 0 || price.indexOf('￥') >= 0) return '¥';
    }
    return '$';
  }

  function formatMoney(value, currency) {
    currency = currency || '$';
    return currency + value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function sumItems(items) {
    var total = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      total += parseQty(items[i].qty) * parsePrice(items[i].price);
    }
    return Math.round(total * 100) / 100;
  }

  function normalizeReceiptConfig(raw) {
    var cfg = JSON.parse(JSON.stringify(EMPTY_TEMPLATE));
    var key;
    raw = raw || {};
    for (key in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) cfg[key] = raw[key];
    }
    if (!cfg.items || !cfg.items.length) cfg.items = [{ qty: 1, name: '****', price: '¥0.00' }];
    if (raw.autoTotal !== false) {
      if (!cfg.currency) cfg.currency = detectCurrency(cfg.items);
      var subtotalNum = sumItems(cfg.items);
      cfg.subtotal = formatMoney(subtotalNum, cfg.currency);
      cfg.total = cfg.subtotal;
    }
    if (!cfg.footer || !cfg.footer.length) cfg.footer = ['谢谢惠顾！'];
    return cfg;
  }

  function freshDayConfig(d) {
    var raw = JSON.parse(JSON.stringify(EMPTY_TEMPLATE));
    raw.terminal = randomTerminalForDate(d);
    return normalizeReceiptConfig(raw);
  }

  function scanDatesWithData() {
    var map = {};
    var i;
    var key;
    for (i = 0; i < localStorage.length; i++) {
      key = localStorage.key(i);
      if (key && key.indexOf(STORAGE_PREFIX) === 0) {
        map[key.slice(STORAGE_PREFIX.length)] = true;
      }
    }
    state.datesWithData = map;
  }

  function sumMonthTotal(year, month) {
    var total = 0;
    var currency = null;
    var count = 0;
    var i;
    var key;
    var dk;
    var parts;
    for (i = 0; i < localStorage.length; i++) {
      key = localStorage.key(i);
      if (!key || key.indexOf(STORAGE_PREFIX) !== 0) continue;
      dk = key.slice(STORAGE_PREFIX.length);
      parts = dk.split('-');
      if (parts.length !== 3) continue;
      if (parseInt(parts[0], 10) !== year || parseInt(parts[1], 10) !== month + 1) continue;
      try {
        var raw = JSON.parse(localStorage.getItem(key));
        var cfg = normalizeReceiptConfig(raw);
        total += sumItems(cfg.items);
        if (!currency) currency = cfg.currency;
        count += 1;
      } catch (e) {}
    }
    return { total: Math.round(total * 100) / 100, currency: currency || '¥', count: count };
  }

  function loadDayConfig(d) {
    var key = dateKey(d);
    var raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw) {
      try {
        return normalizeReceiptConfig(JSON.parse(raw));
      } catch (e) {}
    }
    return freshDayConfig(d);
  }

  function saveCurrentDay() {
    var key = dateKey(state.selectedDate);
    if (!state.currentCfg.terminal) state.currentCfg.terminal = randomTerminalForDate(state.selectedDate);
    localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({
        title: state.currentCfg.title,
        terminal: state.currentCfg.terminal,
        items: state.currentCfg.items,
        footer: state.currentCfg.footer
      })
    );
    state.datesWithData[key] = true;
  }

  function seedTodayIfNeeded() {
    var today = new Date();
    var key = dateKey(today);
    if (localStorage.getItem(STORAGE_PREFIX + key)) return;
    var seed = freshDayConfig(today);
    localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({
        title: seed.title,
        terminal: seed.terminal,
        items: seed.items,
        footer: seed.footer
      })
    );
    state.datesWithData[key] = true;
  }

  function drawPaperFrame(ctx) {
    ctx.fillStyle = '#faf9f5';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = '#e0ded9';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, TEX_W - 20, TEX_H - 20);
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(10, 30);
    ctx.lineTo(TEX_W - 10, 30);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function createReceiptTexture(cfg, displayDate) {
    var canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    var ctx = canvas.getContext('2d');
    drawPaperFrame(ctx);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.title, TEX_W / 2, 80);
    ctx.font = '16px monospace';
    ctx.fillText(cfg.terminal, TEX_W / 2, 110);
    if (cfg.showDate !== false) {
      ctx.fillText(displayDate.toLocaleString(), TEX_W / 2, 130);
    }
    ctx.beginPath();
    ctx.moveTo(30, 160);
    ctx.lineTo(TEX_W - 30, 160);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = 'bold 18px monospace';
    var y = 200;
    cfg.items.forEach(function (item) {
      ctx.fillStyle = '#111';
      ctx.fillText(item.qty + 'x ' + item.name, 30, y);
      ctx.textAlign = 'right';
      ctx.fillText(item.price, TEX_W - 30, y);
      ctx.textAlign = 'left';
      y += 40;
    });
    y += 20;
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(TEX_W - 30, y);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.stroke();
    y += 40;
    ctx.font = 'bold 22px monospace';
    ctx.fillText('SUBTOTAL', 30, y);
    ctx.textAlign = 'right';
    ctx.fillText(cfg.subtotal, TEX_W - 30, y);
    y += 45;
    ctx.fillStyle = '#ff3333';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL: ' + cfg.total, 30, y);
    y += 70;
    ctx.fillStyle = '#111';
    var barcodeX = 80;
    var barcodeHeight = 60;
    ctx.fillRect(barcodeX, y, TEX_W - barcodeX * 2, barcodeHeight);
    ctx.fillStyle = '#faf9f5';
    var bx = barcodeX + 10;
    while (bx < TEX_W - barcodeX - 10) {
      var w = Math.random() * 8 + 2;
      ctx.fillRect(bx, y, w, barcodeHeight);
      bx += w + Math.random() * 10 + 3;
    }
    y += barcodeHeight + 40;
    ctx.fillStyle = '#666';
    ctx.font = 'italic 16px monospace';
    ctx.textAlign = 'center';
    cfg.footer.forEach(function (line, index) {
      ctx.fillText(line, TEX_W / 2, y + index * 25);
    });
    return new THREE.CanvasTexture(canvas);
  }

  function buildCalendarTexture() {
    var canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    var ctx = canvas.getContext('2d');
    var regions = [];
    drawPaperFrame(ctx);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('日 历', TEX_W / 2, 70);
    regions.push({ id: 'prev', x: 0, y: 50, w: 210, h: 110 });
    regions.push({ id: 'next', x: TEX_W - 210, y: 50, w: 210, h: 110 });
    ctx.font = 'bold 32px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText('<', 105, 118);
    ctx.fillText('>', TEX_W - 105, 118);
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#111';
    ctx.fillText(state.calYear + '年' + (state.calMonth + 1) + '月', TEX_W / 2, 115);
    var week = ['日', '一', '二', '三', '四', '五', '六'];
    var y = 150;
    var colW = (TEX_W - 60) / 7;
    var i;
    for (i = 0; i < 7; i++) {
      var x = 30 + i * colW + colW / 2;
      ctx.font = '16px monospace';
      ctx.fillStyle = i === 0 || i === 6 ? '#c44' : '#333';
      ctx.fillText(week[i], x, y);
    }
    var first = new Date(state.calYear, state.calMonth, 1);
    var startWeek = first.getDay();
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    y = 185;
    var cellH = 52;
    var day;
    for (day = 1; day <= daysInMonth; day++) {
      var idx = startWeek + day - 1;
      var row = Math.floor(idx / 7);
      var col = idx % 7;
      var cellW = colW - 4;
      var cellX = 32 + col * colW;
      var cellY = y + row * cellH;
      var d = new Date(state.calYear, state.calMonth, day);
      var dk = dateKey(d);
      var selected = sameDay(d, state.selectedDate);
      var hasData = !!state.datesWithData[dk];
      if (selected) {
        ctx.fillStyle = '#4e6ef2';
        ctx.fillRect(cellX, cellY, cellW, cellH - 6);
      }
      ctx.fillStyle = selected ? '#fff' : '#111';
      ctx.font = selected ? 'bold 20px monospace' : '18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(day), cellX + cellW / 2, cellY + 32);
      if (hasData && !selected) {
        ctx.fillStyle = '#4e6ef2';
        ctx.beginPath();
        ctx.arc(cellX + cellW / 2, cellY + 44, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      regions.push({ id: 'day', day: day, x: cellX, y: cellY, w: cellW, h: cellH - 6 });
    }
    var lastRow = Math.floor((startWeek + daysInMonth - 1) / 7);
    var gridBottom = y + (lastRow + 1) * cellH + 10;
    var monthSum = sumMonthTotal(state.calYear, state.calMonth);
    var summaryY = gridBottom + 36;
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, gridBottom);
    ctx.lineTo(TEX_W - 40, gridBottom);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.font = '18px monospace';
    ctx.fillText('当月汇总', TEX_W / 2, summaryY);
    ctx.fillStyle = '#c33';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(formatMoney(monthSum.total, monthSum.currency), TEX_W / 2, summaryY + 44);
    ctx.fillStyle = monthSum.count ? '#888' : '#aaa';
    ctx.font = '14px monospace';
    ctx.fillText(
      monthSum.count ? '共 ' + monthSum.count + ' 天有小票' : '本月暂无小票',
      TEX_W / 2,
      summaryY + 72
    );
    return { texture: new THREE.CanvasTexture(canvas), regions: regions };
  }

  function buildEditorTexture() {
    var canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    var ctx = canvas.getContext('2d');
    var regions = [];
    var cfg = state.currentCfg;
    var sel = state.editSelection;
    drawPaperFrame(ctx);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('小票编辑', TEX_W / 2, 70);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#555';
    ctx.fillText(dateKey(state.selectedDate), TEX_W / 2, 98);
    var y = 130;
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText('数量', 30, y);
    ctx.fillText('名称', 100, y);
    ctx.textAlign = 'right';
    ctx.fillText('单价', TEX_W - 30, y);
    ctx.textAlign = 'left';
    y += 18;
    var rowH = 56;
    var i;
    for (i = 0; i < cfg.items.length; i++) {
      var item = cfg.items[i];
      var rowY = y + i * rowH;
      var highlight = sel && sel.index === i && sel.field === 'qty';
      if (highlight) {
        ctx.fillStyle = '#fff3bf';
        ctx.fillRect(26, rowY, 52, 40);
      }
      regions.push({ id: 'field', field: 'qty', index: i, x: 26, y: rowY, w: 52, h: 40 });
      ctx.fillStyle = '#111';
      ctx.font = '17px monospace';
      var text = highlight ? state.editBuffer + '|' : String(item.qty);
      ctx.fillText(text, 30, rowY + 26);
      highlight = sel && sel.index === i && sel.field === 'name';
      if (highlight) {
        ctx.fillStyle = '#fff3bf';
        ctx.fillRect(82, rowY, 250, 40);
      }
      regions.push({ id: 'field', field: 'name', index: i, x: 82, y: rowY, w: 250, h: 40 });
      text = highlight ? state.editBuffer + '|' : item.name;
      ctx.fillText(text.length > 16 ? text.slice(0, 15) + '…' : text, 86, rowY + 26);
      highlight = sel && sel.index === i && sel.field === 'price';
      if (highlight) {
        ctx.fillStyle = '#fff3bf';
        ctx.fillRect(340, rowY, 100, 40);
      }
      regions.push({ id: 'field', field: 'price', index: i, x: 340, y: rowY, w: 100, h: 40 });
      ctx.textAlign = 'right';
      text = highlight ? state.editBuffer + '|' : item.price;
      ctx.fillText(text, TEX_W - 86, rowY + 26);
      ctx.textAlign = 'left';
      regions.push({ id: 'del', index: i, x: 448, y: rowY + 6, w: 40, h: 36 });
      ctx.fillStyle = '#c44';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('−', 468, rowY + 30);
      ctx.textAlign = 'left';
    }
    y += cfg.items.length * rowH + 16;
    regions.push({ id: 'add', x: 30, y: y, w: TEX_W - 60, h: 44 });
    ctx.fillStyle = '#666';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+ 增加一行', TEX_W / 2, y + 28);
    y += 60;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#333';
    ctx.font = '16px monospace';
    ctx.fillText('小计 ' + cfg.subtotal, 30, y);
    ctx.fillStyle = '#c33';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('合计 ' + cfg.total, 30, y + 28);
    return { texture: new THREE.CanvasTexture(canvas), regions: regions };
  }

  function PhysicsPaper(width, height, segmentsX, segmentsY) {
    this.width = width;
    this.height = height;
    this.nx = segmentsX;
    this.ny = segmentsY;
    this.particles = [];
    this.constraints = [];
    var j;
    var i;
    for (j = 0; j <= this.ny; j++) {
      for (i = 0; i <= this.nx; i++) {
        var x = (i / this.nx - 0.5) * this.width;
        var y = (0.5 - j / this.ny) * this.height;
        this.particles.push({
          pos: new THREE.Vector3(x, y, 0),
          oldPos: new THREE.Vector3(x, y, 0),
          acc: new THREE.Vector3(0, 0, 0),
          fixed: j === 0
        });
      }
    }
    var self = this;
    function getIndex(a, b) {
      return b * (self.nx + 1) + a;
    }
    for (j = 0; j <= this.ny; j++) {
      for (i = 0; i <= this.nx; i++) {
        var p1 = getIndex(i, j);
        if (i < this.nx) this.addConstraint(p1, getIndex(i + 1, j));
        if (j < this.ny) this.addConstraint(p1, getIndex(i, j + 1));
        if (i < this.nx && j < this.ny) {
          this.addConstraint(p1, getIndex(i + 1, j + 1));
          this.addConstraint(getIndex(i + 1, j), getIndex(i, j + 1));
        }
        if (i < this.nx - 1) this.addConstraint(p1, getIndex(i + 2, j), 1.2);
        if (j < this.ny - 1) this.addConstraint(p1, getIndex(i, j + 2), 1.2);
      }
    }
  }

  PhysicsPaper.prototype.addConstraint = function (p1, p2, stiffness) {
    if (stiffness === undefined) stiffness = 1;
    this.constraints.push({
      p1: p1,
      p2: p2,
      dist: this.particles[p1].pos.distanceTo(this.particles[p2].pos),
      stiffness: stiffness
    });
  };

  PhysicsPaper.prototype.update = function (dt, dragIndex, dragPos) {
    var damping = 0.985;
    var gravity = new THREE.Vector3(0, -9.8, 0);
    var wind = new THREE.Vector3(0, 0, Math.sin(Date.now() * 0.002) * 0.3);
    var i;
    var k;
    var p;
    for (i = 0; i < this.particles.length; i++) {
      p = this.particles[i];
      if (p.fixed) continue;
      var temp = p.pos.clone();
      p.acc.copy(gravity).add(wind);
      p.pos.addScaledVector(p.pos.clone().sub(p.oldPos), damping);
      p.pos.addScaledVector(p.acc, dt * dt);
      p.oldPos.copy(temp);
      p.acc.set(0, 0, 0);
    }
    if (dragIndex !== -1 && !this.particles[dragIndex].fixed) {
      this.particles[dragIndex].pos.copy(dragPos);
    }
    for (k = 0; k < 6; k++) {
      for (i = 0; i < this.constraints.length; i++) {
        var c = this.constraints[i];
        var p1 = this.particles[c.p1];
        var p2 = this.particles[c.p2];
        var delta = p2.pos.clone().sub(p1.pos);
        var currentDist = delta.length();
        if (currentDist === 0) continue;
        var diff = (c.dist - currentDist) / currentDist;
        var correction = delta.multiplyScalar(diff * 0.5 * c.stiffness);
        if (!p1.fixed) p1.pos.sub(correction);
        if (!p2.fixed) p2.pos.add(correction);
      }
    }
  };

  function uvToCanvas(uv) {
    return { x: uv.x * TEX_W, y: (1 - uv.y) * TEX_H };
  }

  function hitRegion(regions, cx, cy) {
    var i;
    for (i = regions.length - 1; i >= 0; i--) {
      var r = regions[i];
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r;
    }
    return null;
  }

  function dayFromCalendarPoint(pt) {
    var colW = (TEX_W - 60) / 7;
    var col = Math.floor((pt.x - 32) / colW);
    var row = Math.floor((pt.y - 185) / 52);
    if (col < 0 || col > 6 || row < 0 || row > 5) return null;
    var first = new Date(state.calYear, state.calMonth, 1);
    var day = row * 7 + col - first.getDay() + 1;
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    if (day < 1 || day > daysInMonth) return null;
    return day;
  }

  function resolveCalendarHit(pt, regions) {
    var hit = hitRegion(regions, pt.x, pt.y);
    if (hit) return hit;
    if (pt.y >= 45 && pt.y <= 165) {
      if (pt.x < 220) return { id: 'prev' };
      if (pt.x > TEX_W - 220) return { id: 'next' };
    }
    var day = dayFromCalendarPoint(pt);
    if (day !== null) return { id: 'day', day: day };
    return null;
  }

  function ReceiptPaperView(containerEl, mode, opts) {
    this.container = containerEl;
    this.mode = mode;
    this.opts = opts || {};
    this.running = false;
    this.rafId = null;
    this.hitRegions = [];
    this.grabIndex = -1;
    this.pointer = { down: false, x: 0, y: 0, dragging: false, uv: null, hitPoint: null, interactive: false };
    this.dragTargetPos = new THREE.Vector3();
    this.dragPlane = new THREE.Plane();
    this.cameraDir = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this._onResize = this.onResize.bind(this);
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onPointerCancel = this.resetPointer.bind(this);
  }

  ReceiptPaperView.prototype.ensureScene = function () {
    if (this.renderer) return;
    var w = this.container.clientWidth || window.innerWidth;
    var h = this.container.clientHeight || window.innerHeight;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe5e5e5);
    this.scene.fog = new THREE.FogExp2(0xe5e5e5, 0.06);
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.camera.position.set(0, CAMERA_Y, CAMERA_Z);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    var dirLight = new THREE.DirectionalLight(0xfffdfa, 0.85);
    dirLight.position.set(5, 5, 8);
    dirLight.castShadow = true;
    this.scene.add(dirLight);
    var fill = new THREE.DirectionalLight(0xddeeff, 0.35);
    fill.position.set(-5, -2, 2);
    this.scene.add(fill);
    var wall = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0xe5e5e5, roughness: 0.9 })
    );
    wall.position.z = -1.2;
    wall.receiveShadow = true;
    this.scene.add(wall);
    var segX = this.mode === 'receipt' ? 14 : 10;
    var segY = this.mode === 'receipt' ? 28 : 22;
    this.physics = new PhysicsPaper(PAPER_W, PAPER_H, segX, segY);
    this.geometry = new THREE.PlaneGeometry(PAPER_W, PAPER_H, segX, segY);
    this.material = new THREE.MeshStandardMaterial({
      map: null,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this.hanger = new THREE.Mesh(
      new THREE.BoxGeometry(PAPER_W + 0.12, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.8 })
    );
    this.hanger.position.set(0, PAPER_H / 2, 0.02);
    this.scene.add(this.hanger);
    this.clock = new THREE.Clock();
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this._onPointerCancel);
    window.addEventListener('resize', this._onResize);
  };

  ReceiptPaperView.prototype.setTexture = function (texture, regions) {
    if (this.material.map) this.material.map.dispose();
    this.material.map = texture;
    this.material.map.anisotropy = 8;
    this.material.map.needsUpdate = true;
    if (regions) this.hitRegions = regions;
  };

  ReceiptPaperView.prototype.refresh = function () {
    if (this.mode === 'receipt') {
      state.currentCfg = normalizeReceiptConfig(state.currentCfg);
      this.setTexture(createReceiptTexture(state.currentCfg, state.selectedDate));
    } else if (this.mode === 'calendar') {
      var cal = buildCalendarTexture();
      this.setTexture(cal.texture, cal.regions);
    } else {
      state.currentCfg = normalizeReceiptConfig(state.currentCfg);
      var ed = buildEditorTexture();
      this.setTexture(ed.texture, ed.regions);
    }
  };

  ReceiptPaperView.prototype.onResize = function () {
    if (!this.renderer) return;
    var w = this.container.clientWidth || window.innerWidth;
    var h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  ReceiptPaperView.prototype.setMouse = function (e) {
    var rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
  };

  ReceiptPaperView.prototype.pick = function () {
    var hits = this.raycaster.intersectObject(this.mesh);
    return hits.length ? hits[0] : null;
  };

  ReceiptPaperView.prototype.resetPointer = function () {
    this.grabIndex = -1;
    this.pointer.down = false;
    this.pointer.dragging = false;
    this.pointer.interactive = false;
  };

  ReceiptPaperView.prototype.onPointerDown = function (e) {
    if (e.button !== 0) return;
    this.setMouse(e);
    var hit = this.pick();
    if (!hit) return;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch (err) {}
    this.pointer.down = true;
    this.pointer.dragging = false;
    this.pointer.interactive = false;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.uv = hit.uv;
    this.pointer.hitPoint = hit.point.clone();
    if (this.mode !== 'receipt') {
      var pt = uvToCanvas(hit.uv);
      if (this.mode === 'calendar') {
        if (resolveCalendarHit(pt, this.hitRegions)) this.pointer.interactive = true;
      } else if (hitRegion(this.hitRegions, pt.x, pt.y)) {
        this.pointer.interactive = true;
      }
    }
  };

  ReceiptPaperView.prototype.onPointerMove = function (e) {
    if (!this.pointer.down) return;
    if (this.pointer.interactive) return;
    var dx = e.clientX - this.pointer.x;
    var dy = e.clientY - this.pointer.y;
    if (!this.pointer.dragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
      this.pointer.dragging = true;
      this.grabIndex = -1;
      var minDist = Infinity;
      var localHit = this.mesh.worldToLocal(this.pointer.hitPoint.clone());
      var i;
      for (i = 0; i < this.physics.particles.length; i++) {
        var p = this.physics.particles[i];
        if (p.fixed) continue;
        var d = p.pos.distanceTo(localHit);
        if (d < minDist) {
          minDist = d;
          this.grabIndex = i;
        }
      }
      if (this.grabIndex !== -1) {
        this.camera.getWorldDirection(this.cameraDir);
        var worldAnchor = this.physics.particles[this.grabIndex].pos.clone();
        this.mesh.localToWorld(worldAnchor);
        this.dragPlane.setFromNormalAndCoplanarPoint(this.cameraDir.clone().negate(), worldAnchor);
      }
    }
    if (this.pointer.dragging && this.grabIndex !== -1) {
      this.setMouse(e);
      var worldPt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dragPlane, worldPt)) {
        var local = this.mesh.worldToLocal(worldPt.clone());
        local.z = THREE.MathUtils.clamp(local.z, -3, 3);
        this.dragTargetPos.copy(local);
      }
    }
  };

  ReceiptPaperView.prototype.onPointerUp = function (e) {
    if (e.button !== 0) return;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch (err) {}
    if (this.pointer.down && !this.pointer.dragging && this.pointer.uv) {
      this.setMouse(e);
      var hit = this.pick();
      var uv = hit ? hit.uv : this.pointer.uv;
      if (uv) {
        var pt = uvToCanvas(uv);
        if (this.mode === 'calendar') {
          var calHit = resolveCalendarHit(pt, this.hitRegions);
          if (calHit) this.handleCalendarHit(calHit);
        } else if (this.mode === 'edit') {
          var edHit = hitRegion(this.hitRegions, pt.x, pt.y);
          if (edHit) this.handleEditorHit(edHit);
        }
      }
    }
    this.resetPointer();
  };

  ReceiptPaperView.prototype.handleCalendarHit = function (hit) {
    if (hit.id === 'prev') {
      state.calMonth -= 1;
      if (state.calMonth < 0) {
        state.calMonth = 11;
        state.calYear -= 1;
      }
      this.refresh();
    } else if (hit.id === 'next') {
      state.calMonth += 1;
      if (state.calMonth > 11) {
        state.calMonth = 0;
        state.calYear += 1;
      }
      this.refresh();
    } else if (hit.id === 'day') {
      selectDate(new Date(state.calYear, state.calMonth, hit.day));
      if (global.goToView) global.goToView('receipt_home');
    }
  };

  ReceiptPaperView.prototype.handleEditorHit = function (hit) {
    if (hit.id === 'add') {
      state.currentCfg.items.push({
        qty: 1,
        name: '****',
        price: state.currentCfg.currency === '¥' ? '¥0.00' : '$0.00'
      });
      state.currentCfg = normalizeReceiptConfig(state.currentCfg);
      saveCurrentDay();
      this.refresh();
      beginEdit('name', state.currentCfg.items.length - 1);
    } else if (hit.id === 'del') {
      if (state.currentCfg.items.length > 1) {
        state.currentCfg.items.splice(hit.index, 1);
        state.currentCfg = normalizeReceiptConfig(state.currentCfg);
        saveCurrentDay();
        clearEditSelection();
        this.refresh();
      }
    } else if (hit.id === 'field') {
      beginEdit(hit.field, hit.index);
    }
  };

  ReceiptPaperView.prototype.start = function () {
    this.ensureScene();
    this.refresh();
    if (this.running) return;
    this.running = true;
    var self = this;
    function tick() {
      if (!self.running) return;
      self.rafId = requestAnimationFrame(tick);
      var dt = Math.min(self.clock.getDelta(), 0.025);
      var dragIdx = -1;
      var dragPos = new THREE.Vector3();
      if (self.pointer.down && self.pointer.dragging && self.grabIndex !== -1) {
        dragIdx = self.grabIndex;
        dragPos = self.dragTargetPos;
      }
      self.physics.update(dt, dragIdx, dragPos);
      var posAttr = self.geometry.attributes.position;
      var j;
      for (j = 0; j < self.physics.particles.length; j++) {
        posAttr.setXYZ(j, self.physics.particles[j].pos.x, self.physics.particles[j].pos.y, self.physics.particles[j].pos.z);
      }
      posAttr.needsUpdate = true;
      self.geometry.computeVertexNormals();
      self.renderer.render(self.scene, self.camera);
    }
    tick();
  };

  ReceiptPaperView.prototype.stop = function () {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resetPointer();
  };

  function getScene(key, containerId, mode) {
    if (!scenes[key]) {
      var el = document.getElementById(containerId);
      if (!el) return null;
      scenes[key] = new ReceiptPaperView(el, mode);
    }
    return scenes[key];
  }

  function stopAllScenes() {
    var k;
    for (k in scenes) {
      if (scenes[k]) scenes[k].stop();
    }
  }

  function selectDate(d) {
    state.selectedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    state.calYear = state.selectedDate.getFullYear();
    state.calMonth = state.selectedDate.getMonth();
    state.currentCfg = loadDayConfig(state.selectedDate);
    clearEditSelection();
    scanDatesWithData();
  }

  function clearEditSelection() {
    state.editSelection = null;
    state.editBuffer = '';
    var bar = document.getElementById('receipt-edit-bar');
    var input = document.getElementById('receipt-edit-input');
    if (bar) bar.classList.remove('show');
    if (input) input.value = '';
  }

  function defaultEditValue(field, value) {
    var v = String(value);
    if (field === 'name' && v === '****') return '';
    if (field === 'price' && (v === '$0.00' || v === '¥0.00' || v === '0.00')) return '';
    return v;
  }

  function fieldLabel(field) {
    if (field === 'qty') return '数量';
    if (field === 'name') return '名称';
    return '单价';
  }

  function beginEdit(field, index) {
    var item = state.currentCfg.items[index];
    if (!item) return;
    state.editSelection = { field: field, index: index };
    state.editBuffer = defaultEditValue(field, item[field]);
    var bar = document.getElementById('receipt-edit-bar');
    var label = document.getElementById('receipt-edit-label');
    var input = document.getElementById('receipt-edit-input');
    if (label) label.textContent = fieldLabel(field);
    if (input) {
      input.value = state.editBuffer;
      setTimeout(function () {
        input.focus();
        input.select();
      }, 0);
    }
    if (bar) bar.classList.add('show');
    if (scenes.edit) scenes.edit.refresh();
  }

  function commitInlineEdit() {
    if (!state.editSelection) return;
    var sel = state.editSelection;
    var item = state.currentCfg.items[sel.index];
    var input = document.getElementById('receipt-edit-input');
    var val = input ? input.value : state.editBuffer;
    state.editBuffer = val;
    if (sel.field === 'qty') {
      var q = parseFloat(val);
      item.qty = isNaN(q) ? val : q;
    } else if (sel.field === 'price') {
      item.price = val || (state.currentCfg.currency === '¥' ? '¥0.00' : '$0.00');
    } else {
      item.name = val || '****';
    }
    state.currentCfg = normalizeReceiptConfig(state.currentCfg);
    saveCurrentDay();
    var savedField = sel.field;
    var savedIndex = sel.index;
    clearEditSelection();
    if (scenes.edit) scenes.edit.refresh();
    if (savedField === 'name') beginEdit('price', savedIndex);
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    var btnCal = document.getElementById('receipt-btn-calendar');
    var btnEdit = document.getElementById('receipt-btn-ledger');
    var btnSave = document.getElementById('receipt-btn-save');
    if (btnCal) {
      btnCal.onclick = function () {
        if (global.goToView) global.goToView('receipt_calendar');
      };
    }
    if (btnEdit) {
      btnEdit.onclick = function () {
        if (global.goToView) global.goToView('receipt_edit');
      };
    }
    if (btnSave) {
      btnSave.onclick = function () {
        if (state.editSelection) commitInlineEdit();
        state.currentCfg = normalizeReceiptConfig(state.currentCfg);
        saveCurrentDay();
        clearEditSelection();
        if (global.goToView) global.goToView('receipt_home');
      };
    }
    var input = document.getElementById('receipt-edit-input');
    if (input) {
      input.addEventListener('input', function () {
        if (!state.editSelection) return;
        state.editBuffer = input.value;
        if (scenes.edit) scenes.edit.refresh();
      });
      input.addEventListener('keydown', function (e) {
        if (!state.editSelection) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commitInlineEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearEditSelection();
          if (scenes.edit) scenes.edit.refresh();
        }
      });
    }
    var inlineSave = document.getElementById('receipt-edit-inline-save');
    if (inlineSave) inlineSave.onclick = commitInlineEdit;
    var inlineCancel = document.getElementById('receipt-edit-inline-cancel');
    if (inlineCancel) {
      inlineCancel.onclick = function () {
        clearEditSelection();
        if (scenes.edit) scenes.edit.refresh();
      };
    }
  }

  function ensureState() {
    seedTodayIfNeeded();
    scanDatesWithData();
    state.calYear = state.selectedDate.getFullYear();
    state.calMonth = state.selectedDate.getMonth();
    state.currentCfg = loadDayConfig(state.selectedDate);
  }

  global.ReceiptModule = {
    bindOnce: bindOnce,
    ensureState: ensureState,
    onEnterHome: function () {
      bindOnce();
      ensureState();
      stopAllScenes();
      var s = getScene('home', 'receipt-home-canvas', 'receipt');
      if (s) {
        s.start();
        setTimeout(function () {
          s.onResize();
        }, 50);
      }
    },
    onEnterCalendar: function () {
      bindOnce();
      ensureState();
      stopAllScenes();
      var s = getScene('calendar', 'receipt-calendar-canvas', 'calendar');
      if (s) {
        s.start();
        setTimeout(function () {
          s.onResize();
        }, 50);
      }
    },
    onEnterEdit: function () {
      bindOnce();
      ensureState();
      stopAllScenes();
      var s = getScene('edit', 'receipt-edit-canvas', 'edit');
      if (s) {
        s.start();
        setTimeout(function () {
          s.onResize();
        }, 50);
      }
    },
    onLeaveAll: function () {
      stopAllScenes();
      clearEditSelection();
    },
    _test: {
      normalizeReceiptConfig: normalizeReceiptConfig,
      sumItems: sumItems,
      randomTerminalForDate: randomTerminalForDate,
      dateKey: dateKey
    }
  };
})(typeof window !== 'undefined' ? window : global);
