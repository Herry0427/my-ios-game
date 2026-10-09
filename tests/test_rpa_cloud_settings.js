const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const snippet = html.split('  var rpaUrlInput = document.getElementById(\'rpa-url\');')[1].split('  document.getElementById(\'btn-enter-memo\')')[0];
assert(snippet, 'RPA settings script exists');
const rows = {};
function device(nick, legacy) {
  const values = {};
  if (legacy) values.rpa_dashboard_url = legacy;
  const elements = {};
  ['rpa-url', 'rpa-frame', 'rpa-hint', 'btn-enter-rpa', 'rpa-back', 'rpa-connect', 'rpa-open', 'rpa-alert-dot'].forEach(id => {
    const classes = new Set();
    elements[id] = {
      value: '', textContent: '', src: '', onclick: null, listeners: {},
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
      addEventListener(name, cb) { this.listeners[name] = cb; },
      getAttribute(name) { return name === 'src' ? this.src : null; },
      removeAttribute(name) { if (name === 'src') this.src = ''; }
    };
  });
  const store = {
    getItem: key => values[key] || null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: key => { delete values[key]; }
  };
  const client = { from(table) {
    assert.strictEqual(table, 'rpa_dashboard_settings');
    return {
      select() { return { eq: (_, owner) => ({ maybeSingle: async () => ({ data: rows[owner] || null, error: null }) }) }; },
      async upsert(row) { rows[row.user_id] = { dashboard_url: row.dashboard_url }; return { error: null }; }
    };
  } };
  const ctx = {
    document: { getElementById: id => elements[id], visibilityState: 'visible', addEventListener: () => {} }, localStorage: store,
    getNickname: () => nick.value, getSb: () => client, goToView: () => {},
    window: { open: () => {} }, URL, console, currentView: 'rpa', setInterval: () => {},
    fetch: async () => ({ ok: true, json: async () => ({ latest_id: 0 }) })
  };
  vm.createContext(ctx);
  vm.runInContext('var rpaUrlInput = document.getElementById(\'rpa-url\');' + snippet, ctx);
  return { elements, values, ctx };
}
(async () => {
  const nick = { value: '甲' };
  const a = device(nick, 'https://example.org/view');
  await a.ctx.loadRpaDashboardUrl();
  assert.strictEqual(rows['甲'].dashboard_url, 'https://example.org/view');
  assert(!a.values.rpa_dashboard_url, 'old unscoped key removed only after cloud save');
  const b = device({ value: '甲' });
  await b.ctx.loadRpaDashboardUrl();
  assert.strictEqual(b.elements['rpa-url'].value, 'https://example.org/view');
  assert.strictEqual(b.elements['rpa-frame'].src, 'https://example.org/view');
  b.elements['rpa-url'].value = 'https://example.org/new';
  await b.elements['rpa-connect'].onclick();
  await a.ctx.loadRpaDashboardUrl();
  assert.strictEqual(a.elements['rpa-url'].value, 'https://example.org/new');
  const other = device({ value: '乙' });
  await other.ctx.loadRpaDashboardUrl();
  assert.strictEqual(other.elements['rpa-url'].value, '');
  const alertDevice = device({ value: '甲' });
  alertDevice.ctx.currentView = 'lobby';
  await alertDevice.ctx.loadRpaDashboardUrl();
  alertDevice.ctx.fetch = async () => ({ ok: true, json: async () => ({ latest_id: 10 }) });
  await alertDevice.ctx.checkRpaAlerts();
  assert(alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'new error shows red dot');
  alertDevice.elements['btn-enter-rpa'].onclick();
  assert(alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'opening RPA does not clear unread dot before dashboard loads');
  alertDevice.ctx.currentView = 'rpa';
  alertDevice.elements['rpa-frame'].listeners.load();
  assert(!alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'loaded dashboard marks errors seen');
  alertDevice.ctx.currentView = 'lobby';
  alertDevice.ctx.fetch = async () => ({ ok: true, json: async () => ({ latest_id: 11 }) });
  await alertDevice.ctx.checkRpaAlerts();
  assert(alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'subsequent error reactivates red dot');
  console.log('RPA cloud settings and unread alert dot: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
