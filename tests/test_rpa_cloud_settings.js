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
  ['rpa-url', 'rpa-frame', 'rpa-hint', 'btn-enter-rpa', 'rpa-back', 'rpa-connect', 'rpa-open'].forEach(id => {
    elements[id] = { value: '', textContent: '', src: '', onclick: null, removeAttribute(name) { if (name === 'src') this.src = ''; } };
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
    document: { getElementById: id => elements[id] }, localStorage: store,
    getNickname: () => nick.value, getSb: () => client, goToView: () => {},
    window: { open: () => {} }, URL, console, currentView: 'rpa'
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
  console.log('RPA address migration, cross-device update, and account isolation: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
