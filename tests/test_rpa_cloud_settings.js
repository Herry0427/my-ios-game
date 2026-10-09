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
  ['rpa-url', 'rpa-frame', 'rpa-hint', 'btn-enter-rpa', 'rpa-back', 'rpa-connect', 'rpa-open', 'rpa-alert-dot', 'rpa-enable-badge', 'rpa-push-status'].forEach(id => {
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
  const badges = [];
  const registrations = [];
  const pushKey = Buffer.alloc(65);
  let activeSubscription = null;
  const registration = { pushManager: {
    getSubscription: async () => activeSubscription,
    subscribe: async () => (activeSubscription = { endpoint: 'https://web.push.apple.com/test', options: { applicationServerKey: new Uint8Array(pushKey), }, keys: { p256dh: 'a', auth: 'b' } })
  } };
  const ctx = {
    navigator: { setAppBadge: async n => { badges.push(n); }, clearAppBadge: async () => { badges.push(0); },
      serviceWorker: { register: async path => { registrations.push(path); return registration; }, getRegistration: async () => registrations.length ? registration : null } }, 
    Notification: { permission: 'default', requestPermission: async function () { this.permission = 'granted'; return 'granted'; } },
    document: { getElementById: id => elements[id], visibilityState: 'visible', addEventListener: () => {} }, localStorage: store,
    getNickname: () => nick.value, getSb: () => client, goToView: () => {},
    window: { open: () => {}, matchMedia: () => ({ matches: true }), Notification: true, PushManager: true }, URL, console, currentView: 'rpa', setInterval: () => {}, atob, Uint8Array,
    fetch: async () => ({ ok: true, json: async () => ({ latest_id: 0 }) })
  };
  vm.createContext(ctx);
  vm.runInContext('var rpaUrlInput = document.getElementById(\'rpa-url\');' + snippet, ctx);
  return { elements, values, ctx, badges, registrations };
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
  assert.strictEqual(alertDevice.badges.at(-1), 1, 'unread errors set the home screen badge');
  alertDevice.elements['btn-enter-rpa'].onclick();
  assert(alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'opening RPA does not clear unread dot before dashboard loads');
  alertDevice.ctx.currentView = 'rpa';
  alertDevice.elements['rpa-frame'].listeners.load();
  assert(!alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'loaded dashboard marks errors seen');
  assert.strictEqual(alertDevice.badges.at(-1), 0, 'seen errors clear the home screen badge');
  alertDevice.ctx.currentView = 'lobby';
  alertDevice.ctx.fetch = async () => ({ ok: true, json: async () => ({ latest_id: 12 }) });
  await alertDevice.ctx.checkRpaAlerts();
  assert(alertDevice.elements['rpa-alert-dot'].classList.contains('visible'));
  alertDevice.elements['btn-enter-rpa'].onclick();
  assert(!alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 're-entering cached dashboard clears unread dot without another iframe load');
  assert.strictEqual(alertDevice.badges.at(-1), 0, 're-entering clears desktop badge too');
  alertDevice.ctx.currentView = 'rpa';
  await alertDevice.ctx.checkRpaAlerts();
  assert(!alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'fetch after re-entry cannot restore viewed dot');
  alertDevice.ctx.currentView = 'lobby';
  alertDevice.ctx.fetch = async () => ({ ok: true, json: async () => ({ latest_id: 13 }) });
  await alertDevice.ctx.checkRpaAlerts();
  assert(alertDevice.elements['rpa-alert-dot'].classList.contains('visible'), 'subsequent error reactivates red dot');
  assert.strictEqual(alertDevice.badges.at(-1), 1, 'subsequent errors restore the home screen badge');
  alertDevice.ctx.fetch = async (url, options) => {
    if (String(url).endsWith('/api/push-key')) return { ok: true, json: async () => ({ public_key: Buffer.alloc(65).toString('base64url') }) };
    if (String(url).endsWith('/api/push-subscribe') && options.method === 'POST') return { ok: true };
    return { ok: true, json: async () => ({ latest_id: 11 }) };
  };
  await alertDevice.elements['rpa-enable-badge'].onclick();
  assert.deepStrictEqual(alertDevice.registrations, ['./rpa-sw.js']);
  assert(alertDevice.elements['rpa-hint'].textContent.includes('后台推送已开启'));
  await alertDevice.ctx.refreshRpaPushStatus();
  assert(alertDevice.elements['rpa-push-status'].textContent.includes('已自动恢复'));
  assert.strictEqual(alertDevice.values['rpa_push_owner_%E7%94%B2'], 'https://example.org/new');
  alertDevice.ctx.fetch = async () => { throw new Error('offline'); };
  await alertDevice.ctx.refreshRpaPushStatus();
  assert(alertDevice.elements['rpa-push-status'].textContent.includes('未确认'), 'offline cannot claim active');
  console.log('RPA cloud settings and unread alert dot: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
