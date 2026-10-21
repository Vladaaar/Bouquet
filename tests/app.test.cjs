// Controller integration tests use a minimal DOM; these are not visual browser tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); }
  throw new Error('Timed out');
}
function setup({ fetch = async () => ({ ok: false }), withSearch = true } = {}) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.className = ''; this.attrs = {};
      this.classList = { contains: value => this.className.split(' ').includes(value), toggle() {}, add() {}, remove() {} }; }
    replaceChildren(...children) { this.children = children; }
    appendChild(child) { this.children.push(child); }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    focus() {} click() { if (!this.disabled) this.onclick?.(); }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const body = new Element();
  const context = vm.createContext({ console, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, DOMException, AbortController, setTimeout, clearTimeout,
    document: { body, head: new Element(), querySelector: () => el('bar'), getElementById: el, createElement: () => new Element() }, addEventListener() {}, scrollTo() {}, fetch });
  context.window = context;
  for (const f of ['core/bouquet.js', 'core/sources.js', ...(withSearch ? ['modules/search.js'] : [])]) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context);
  const views = [];
  context.Bouquet.register({ kind: 'renderer', id: 'capture', priority: 100, test: () => true, render: (_, view) => views.push(view) });
  for (const f of ['modules/themes.js', 'core/ui.js', 'core/app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context);
  const choose = (name = 'test.lazy', size) => {
    const file = Object.assign(new Blob(['data']), { name });
    if (size != null) Object.defineProperty(file, 'size', { value: size });
    el('pickFile').onchange({ target: { files: [file], value: name } });
  };
  const submit = () => el('searchForm').onsubmit({ preventDefault() {} });
  return { el, context, views, choose, submit };
}
test('async UI pagination, table reset, progress, cancellation and latest-query wins', async () => {
  const { el, context, views, choose, submit } = setup();
  let closed = 0;
  context.Bouquet.register({ kind: 'interpreter', id: 'lazy', priority: 100, name: 'Lazy', test: () => true,
    async open() { return { tables: [0, 1].map(i => ({ name: 'table' + i, columns: ['value'],
      async read({ cursor, match, signal, onProgress }) {
        const offset = cursor || 0;
        if (match?.(['slow'])) {
          onProgress({ scanned: 128, found: 1, rows: [{ n: 1, cells: ['slow'] }] });
          await delay(80);
        } else await delay(3);
        context.Bouquet.util.checkAbort(signal);
        const rows = Array.from({ length: 101 }, (_, n) => ({ n: n + 1, cells: [String(n)] })).filter(r => !match || match(r.cells));
        return { rows: rows.slice(offset, offset + 100), hasMore: offset + 100 < rows.length,
          nextCursor: offset + 100, total: match ? undefined : 101 };
      }
    })), close() { closed++; } }; }
  });
  choose(); await until(() => el('chip').dataset.state === 'go');
  await until(() => views.length === 1);
  assert.equal(views.at(-1).rows.length, 100);
  el('next').click(); await until(() => views.at(-1).page === 1);
  assert.equal(views.at(-1).rows[0].n, 101);
  el('prev').click(); await until(() => views.at(-1).page === 0);
  el('tableSelect').value = '1'; el('tableSelect').onchange(); await until(() => views.at(-1).table.name === 'table1');
  choose('other.lazy'); await until(() => views.at(-1).table.name === 'table0' && closed === 1);
  el('q').value = 'slow'; submit(); await until(() => views.at(-1).rows[0]?.cells[0] === 'slow');
  el('q').value = '99'; submit(); await until(() => views.at(-1).query === '99');
  await delay(100);
  assert.equal(views.at(-1).query, '99');
  assert.equal(views.at(-1).rows[0].cells[0], '99');
  assert.equal(el('chip').dataset.state, 'go');
});
test('legacy parsers receive complete buffers and newest open wins', async () => {
  const { el, context, views, choose, submit } = setup();
  context.Bouquet.register({ kind: 'interpreter', id: 'legacy', priority: 100, name: 'Legacy', test: () => true,
    async parse({ buffer, name }) { assert.equal(buffer.byteLength, 4); if (name === 'slow.txt') await delay(80);
      return { tables: [{ name, columns: ['name'], rows: [[name]] }] }; }
  });
  choose('slow.txt'); await delay(5); choose('new.txt');
  await until(() => el('chip').dataset.state === 'go'); submit();
  await until(() => views.length > 0); await delay(100);
  assert.equal(views.at(-1).table.name, 'new.txt');
  assert.equal(views.at(-1).total, 1);
});

test('SQLite auto mode boundary, manual toggle, query/table preservation and new-file reset', async () => {
  const { el, context, views, choose, submit } = setup();
  const opened = [];
  const dataset = () => ({ tables: [0, 1].map(i => ({ name: 't' + i, columns: ['name'], rows: [['value']] })) });
  for (const mode of ['progressive', 'memory']) {
    context.Bouquet.register({ kind: 'interpreter', id: mode, name: 'SQLite', priority: 100,
      format: 'sqlite', loadingMode: mode, test: () => true,
      async open() { opened.push(mode); await delay(1); return dataset(); }
    });
  }
  choose('boundary.db', 100 * 1024 * 1024);
  await until(() => !el('progressive').disabled);
  assert.equal(opened.at(-1), 'memory'); assert.equal(el('progressive').checked, false);
  assert.equal(el('tableSelect').hidden, false);
  submit(); await until(() => views.length > 0);
  el('tableSelect').value = '1'; el('tableSelect').onchange();
  el('q').value = 'value'; submit(); await until(() => views.at(-1).query === 'value');
  el('progressive').checked = true; el('progressive').onchange();
  await until(() => !el('progressive').disabled && opened.at(-1) === 'progressive');
  assert.equal(views.at(-1).query, 'value'); assert.equal(views.at(-1).table.name, 't1');
  choose('small.db', 100); await until(() => !el('progressive').disabled);
  assert.equal(opened.at(-1), 'memory');
  choose('large.db', 100 * 1024 * 1024 + 1); await until(() => !el('progressive').disabled);
  assert.equal(opened.at(-1), 'progressive'); assert.equal(el('progressive').checked, true);
  el('progressive').checked = false; el('progressive').onchange();
  await until(() => !el('progressive').disabled && opened.at(-1) === 'memory');
  assert.equal(el('progressive').checked, false);
});


test('empty state, immediate preview, persistent tabs and sidebar collapse', async () => {
  const { el, context, views, choose, submit } = setup();
  const ui = context.Bouquet.ui;
  assert.equal(ui.activeTab, 'explorer');
  assert.equal(el('emptyState').hidden, false);
  assert.equal(el('fileContent').hidden, true);
  context.Bouquet.register({ kind: 'interpreter', id: 'many', name: 'Many', priority: 100,
    test: () => true, parse: () => ({ tables: [{ name: 'rows', columns: ['value'],
      rows: Array.from({ length: 220 }, (_, n) => ['match ' + n]) }] }) });
  choose(); await until(() => views.length > 0);
  assert.equal(el('emptyState').hidden, true);
  assert.equal(views.at(-1).rows.length, 100);
  el('q').value = 'match'; submit(); await until(() => views.at(-1).query === 'match');
  el('next').click(); await until(() => views.at(-1).page === 1);
  el('stage').scrollTop = 80;
  const count = views.length, view = views.at(-1);
  ui.selectTab('settings');
  assert.equal(el('explorerPanel').hidden, true);
  assert.equal(el('settingsPanel').hidden, false);
  ui.selectTab('plugins'); ui.selectTab('explorer');
  el('sidebarToggle').click();
  assert.equal(el('sidebarToggle').attrs['aria-expanded'], 'false');
  el('sidebarToggle').click();
  assert.equal(el('sidebarToggle').attrs['aria-expanded'], 'true');
  assert.equal(views.length, count);
  assert.equal(views.at(-1), view);
  assert.equal(el('q').value, 'match');
  assert.equal(el('stage').scrollTop, 80);
});

test('plugins extend the live interface and theme loading preserves the current view', async () => {
  const { el, context, views, choose } = setup();
  const B = context.Bouquet, ui = B.ui;
  choose('file.txt'); await until(() => views.length > 0);
  let mounts = 0;
  B.register({ kind: 'plugin', id: 'extra', setup(api) {
    api.elements.toolbar.setAttribute('data-custom', 'yes');
    api.addTab({ id: 'extra', label: 'Extra', mount(panel) { mounts++; panel.textContent = 'Kept'; } });
  } });
  ui.selectTab('extra'); ui.selectTab('explorer'); ui.selectTab('extra');
  assert.equal(mounts, 1);
  assert.equal(el('bar').attrs['data-custom'], 'yes');
  const count = views.length;
  const file = { name: 'theme.js', text: async () => `Bouquet.register({kind:'plugin',category:'theme',id:'custom-theme',name:'Custom',css:':root{--iris:red}'})` };
  el('pickModule').onchange({ target: { files: [file], value: file.name } });
  await until(() => B.plugins.some(p => p.id === 'custom-theme'));
  ui.setTheme('custom-theme');
  assert.equal(ui.theme, 'custom-theme');
  assert.equal(el('themeSelect').value, 'custom-theme');
  assert.equal(views.length, count);
  assert.equal(ui.activeTab, 'extra');
  assert.throws(() => B.register({ kind: 'plugin', id: 'extra' }), /уже подключён/);
});


test('switching tabs during a read keeps the request and renders the result in its existing panel', async () => {
  const { el, context, views, choose } = setup();
  let release, calls = 0, readSignal;
  context.Bouquet.register({ kind: 'interpreter', id: 'pending', priority: 100, test: () => true,
    open: () => ({ tables: [{ name: 'pending', columns: ['value'],
      async read({ signal }) {
        calls++; readSignal = signal;
        await new Promise(resolve => { release = resolve; });
        return { rows: [{ n: 1, cells: ['done'] }], hasMore: false };
      }
    }] }) });
  choose(); await until(() => release);
  context.Bouquet.ui.selectTab('settings');
  assert.equal(readSignal.aborted, false);
  release(); await until(() => views.length > 0);
  assert.equal(el('explorerPanel').hidden, true);
  context.Bouquet.ui.selectTab('explorer');
  assert.equal(calls, 1);
  assert.equal(views.at(-1).rows[0].cells[0], 'done');
});

test('unavailable manifest files return to upload and manual preview works without search plugin', async () => {
  let attempts = 0;
  const { el, views, choose } = setup({ withSearch: false, fetch: async url => {
    if (url === 'bouquet.files.json') return { ok: true, json: async () => ({ files: ['missing.txt', 'missing2.txt'] }) };
    attempts++; throw new Error('Unavailable');
  } });
  await until(() => attempts === 2 && el('emptyState').hidden === false);
  assert.equal(el('fileContent').hidden, true);
  assert.equal(el('searchForm').hidden, true);
  views.length = 0;
  choose('manual.txt'); await until(() => views.length > 0);
  assert.equal(el('emptyState').hidden, true);
  assert.equal(views.at(-1).rows[0].cells[0], 'data');
});
