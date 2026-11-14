// Controller integration tests use a minimal DOM; these are not visual browser tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const crumbs = el => el('breadcrumbList').children.map(item => item.children[0]);
const current = el => crumbs(el).at(-1);
const pathLabel = el => crumbs(el).map(node => node.textContent).join(' / ');
const back = el => crumbs(el).filter(node => node.onclick).at(-1).click();
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); }
  throw new Error('Timed out');
}
function setup({ fetch = async () => ({ ok: false }), withSearch = true, withHistory = false, dark = false } = {}) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.className = ''; this.attrs = {};
      this.classList = { contains: value => this.className.split(' ').includes(value), toggle() {}, add() {}, remove() {} }; }
    replaceChildren(...children) { this.children = children; }
    appendChild(child) { this.children.push(child); }
    insertBefore(child, reference) { const index = this.children.indexOf(reference); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    setCustomValidity(text) { this.validationMessage = text; }
    reportValidity() { return !this.validationMessage; }
    focus() {} click() { if (!this.disabled) this.onclick?.(); }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  el('settingsTabs').hidden = true;
  const body = new Element();
  let mediaChange;
  const media = { matches: dark, addEventListener: (_, callback) => { mediaChange = callback; } };
  const listeners = new Map(), entries = [null]; let historyIndex = 0;
  const history = {
    get state() { return entries[historyIndex]; },
    pushState(state) { entries.splice(++historyIndex); entries.push(state); },
    replaceState(state) { entries[historyIndex] = state; },
    go(delta) { const next = historyIndex + delta; if (next < 0 || next >= entries.length) return;
      setTimeout(() => { historyIndex = next; listeners.get('popstate')?.({ state: entries[next] }); }, 0); },
    back() { this.go(-1); }, forward() { this.go(1); }
  };
  const context = vm.createContext({ navigator: { languages: ['ru-RU'] }, console, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, DOMException, AbortController, setTimeout, clearTimeout,
    document: { body, head: new Element(), querySelector: () => el('bar'), getElementById: el, createElement: () => new Element() },
    ...(withHistory ? { history } : {}), matchMedia: () => media, addEventListener: (type, callback) => listeners.set(type, callback), scrollTo() {}, fetch });
  context.window = context;
  for (const f of ['core/bouquet.js', 'core/i18n.js', 'core/sources.js', 'core/files.js', 'core/navigation.js', ...(withSearch ? ['modules/search.js'] : [])]) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context);
  const views = [];
  context.Bouquet.register({ kind: 'renderer', id: 'capture', priority: 100, test: () => true, render: (_, view) => views.push(view) });
  for (const f of ['modules/themes.js', 'modules/theme_contrast.js', 'modules/theme_settings.js', 'modules/file_loading.js', 'core/ui.js', 'core/app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context);
  const choose = (name = 'test.lazy', size) => {
    const file = Object.assign(new Blob(['data']), { name });
    if (size != null) Object.defineProperty(file, 'size', { value: size });
    el('pickFile').onchange({ target: { files: [file], value: name } });
  };
  const select = i => el('stage').children[0].children[1].children[i].children[0].click();
  const submit = () => el('searchForm').onsubmit({ preventDefault() {} });
  return { el, context, views, choose, submit, select, history, systemTheme(value) { media.matches = value; mediaChange?.(); } };
}
test('async UI pagination, table reset, progress, cancellation and latest-query wins', async () => {
  const { el, context, views, choose, submit, select } = setup();
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
  choose(); await until(() => el('stage').children.length > 0);
  assert.equal(views.length, 0); // Multi-table sources wait for an explicit choice.
  select(0); await until(() => views.length === 1);
  assert.equal(views.at(-1).rows.length, 100);
  el('next').click(); await until(() => views.at(-1).page === 1);
  assert.equal(views.at(-1).rows[0].n, 101);
  el('prev').click(); await until(() => views.at(-1).page === 0);
  back(el); select(1); await until(() => views.at(-1).table.name === 'table1');
  choose('other.lazy'); await until(() => el('stage').children.length > 0 && closed === 1);
  select(0); await until(() => views.at(-1).table.name === 'table0');
  el('q').value = 'slow'; submit(); await until(() => views.at(-1).rows[0]?.cells[0] === 'slow');
  el('q').value = '99'; submit(); await until(() => views.at(-1).query === '99');
  await delay(100);
  assert.equal(views.at(-1).query, '99');
  assert.equal(views.at(-1).rows[0].cells[0], '99');
  assert.equal(el('fileState').dataset.state, 'go');
});
test('legacy parsers receive complete buffers and newest open wins', async () => {
  const { el, context, views, choose, submit, select } = setup();
  context.Bouquet.register({ kind: 'interpreter', id: 'legacy', priority: 100, name: 'Legacy', test: () => true,
    async parse({ buffer, name }) { assert.equal(buffer.byteLength, 4); if (name === 'slow.txt') await delay(80);
      return { tables: [{ name, columns: ['name'], rows: [[name]] }] }; }
  });
  choose('slow.txt'); await delay(5); choose('new.txt');
  await until(() => el('fileState').dataset.state === 'go'); submit();
  await until(() => views.length > 0); await delay(100);
  assert.equal(views.at(-1).table.name, 'new.txt');
  assert.equal(views.at(-1).total, 1);
});

test('global file-loading threshold includes the boundary and reopens the current file preserving its query/table', async () => {
  const { el, context, views, choose, submit } = setup();
  const opened = [], B = context.Bouquet, loader = B.features['file-loading'];
  B.register({ kind: 'interpreter', id: 'policy-sqlite', format: 'sqlite', loadingModes: ['memory', 'progressive'], priority: 100,
    test: () => true, open({ loadingMode }) { opened.push(loadingMode); return { tables: [{ name: 'records', columns: ['value'],
      rows: Array.from({ length: 101 }, (_, n) => ['keep ' + n]) }] }; } });
  choose('boundary.db', 100 * 1024 * 1024); await until(() => views.length > 0);
  assert.equal(opened.at(-1), 'memory');
  el('q').value = 'keep'; submit(); await until(() => views.at(-1).query === 'keep');
  el('next').click(); await until(() => views.at(-1).page === 1);
  loader.setMemoryLimitMB(99); await until(() => opened.length === 2 && views.at(-1).page === 0);
  assert.equal(opened.at(-1), 'progressive'); assert.equal(views.at(-1).query, 'keep');
  assert.equal(views.at(-1).table.name, 'records');
  choose('small.db', 10); await until(() => opened.length === 3); assert.equal(opened.at(-1), 'memory');
  choose('large.db', 100 * 1024 * 1024 + 1); await until(() => opened.length === 4);
  assert.equal(opened.at(-1), 'progressive');
  loader.setMemoryLimitMB(200); await until(() => opened.length === 5); assert.equal(opened.at(-1), 'memory');
});

test('header navigation preserves preview, query, pagination and scroll', async () => {
  const { el, context, views, choose, submit, select } = setup();
  const ui = context.Bouquet.ui;
  assert.equal(ui.activeTab, 'explorer');
  assert.equal(el('emptyState').hidden, false);
  assert.equal(el('fileContent').hidden, true);
  assert.equal(el('breadcrumbs').hidden, true);
  assert.equal(el('settingsTabs').hidden, true);
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
  el('settingsButton').click();
  assert.equal(el('explorerPanel').hidden, true);
  assert.equal(el('settingsPanel').hidden, false);
  ui.selectTab('plugins');
  assert.equal(ui.activeTab, 'settings');
  assert.equal(el('settingsPanel').hidden, false);
  assert.ok(el('pluginList').children.length > 0);
  assert.equal(el('settingsButton').attrs['aria-current'], 'page');
  el('homeButton').click();
  assert.equal(ui.activeTab, 'explorer');
  assert.equal(current(el)?.textContent, 'test.lazy');
  assert.equal(el('breadcrumbs').hidden, false);
  assert.equal(el('settingsButton').attrs['aria-current'], undefined);
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
  assert.equal(el('settingsTabs').hidden, false);
  el('settingsTabs').children[0].click();
  assert.equal(ui.activeTab, 'extra');
  ui.selectTab('explorer'); ui.selectTab('extra');
  assert.equal(mounts, 1);
  assert.equal(el('bar').attrs['data-custom'], 'yes');
  const count = views.length;
  const file = { name: 'theme.js', text: async () => `Bouquet.register({kind:'plugin',category:'theme',id:'custom-theme',name:'Custom',css:':root{--iris:red}'})` };
  el('pickModule').onchange({ target: { files: [file], value: file.name } });
  await until(() => B.plugins.some(p => p.id === 'custom-theme'));
  ui.setTheme('custom-theme');
  assert.equal(ui.theme, 'custom-theme');
  const themeCard = el('themeList').children.find(card => card.dataset.plugin === 'custom-theme');
  assert.equal(themeCard.children[2].checked, true);
  assert.equal(el('pluginList').children.some(card => card.dataset.plugin === 'custom-theme'), false);
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

test('folder files are listed without reading, selection is lazy, and back keeps the folder', async () => {
  const { el, context, views, select } = setup();
  const files = ['folder/nested/b.txt', 'folder/a.txt'].map(name =>
    Object.assign(new Blob([name]), { name: name.split('/').pop(), webkitRelativePath: name }));
  context.Bouquet.ui.actions.openFiles(files, { folder: true });
  assert.equal(current(el)?.textContent, 'folder');
  assert.equal(views.length, 0);
  assert.equal(el('searchForm').hidden, true);
  assert.equal(el('stage').children[0].children[1].children[0].children[0].textContent, 'nested');
  context.Bouquet.ui.selectTab('settings'); context.Bouquet.ui.selectTab('explorer');
  assert.equal(views.length, 0);
  select(0); select(0); await until(() => views.length === 1);
  assert.equal(views[0].rows[0].cells[0], 'folder/nested/b.txt');
  back(el);
  assert.equal(current(el)?.textContent, 'nested');
  back(el);
  assert.equal(current(el)?.textContent, 'folder');
  assert.equal(context.Bouquet.ui.currentView, null);
  select(1); await until(() => views.length === 2);
  assert.equal(views[1].rows[0].cells[0], 'folder/a.txt');
});

test('returning to the table list aborts a pending read and ignores its stale result', async () => {
  const { el, context, views, choose, select } = setup();
  let release, signal;
  context.Bouquet.register({ kind: 'interpreter', id: 'delayed-tables', priority: 100, test: () => true,
    open: () => ({ tables: [{ name: 'slow', columns: ['value'], async read(args) {
      signal = args.signal; await new Promise(resolve => { release = resolve; });
      return { rows: [{ n: 1, cells: ['stale'] }], hasMore: false };
    } }, { name: 'ready', columns: ['value'], rows: [['fresh']] }] }) });
  choose(); await until(() => el('stage').children.length);
  select(0); await until(() => release);
  back(el);
  assert.equal(signal.aborted, true);
  select(1); await until(() => views.length === 1);
  release(); await delay(10);
  assert.equal(views.length, 1);
  assert.equal(views[0].rows[0].cells[0], 'fresh');
});

test('folder JavaScript stays data, empty folders show a note, and a single file opens directly', async () => {
  const { el, context, views, select } = setup();
  const files = ['a.js', 'b.txt'].map(name => Object.assign(new Blob(['throw new Error("Do not execute")']), { name }));
  context.Bouquet.ui.actions.openFiles(files);
  select(0); await until(() => views.length === 1);
  assert.equal(current(el)?.textContent, 'a.js');
  assert.equal(context.Bouquet.ui.activeTab, 'explorer');
  context.Bouquet.ui.actions.openFiles([], { folder: true });
  assert.equal(el('stage').children[0].children[1].textContent, 'В папке нет файлов');
  assert.equal(el('searchForm').hidden, true);
  context.Bouquet.ui.actions.openFiles([files[1]]);
  await until(() => views.length === 2);
  assert.equal(current(el)?.textContent, 'b.txt');
});

test('manifest lists only accessible sources and defers parsing until selection', async () => {
  const { el, views, select } = setup({ fetch: async url => {
    if (url === 'bouquet.files.json') return { ok: true, json: async () => ({ files: ['one.txt', 'missing.txt', 'two.txt'] }) };
    if (url === 'missing.txt') throw new Error('Unavailable');
    return { ok: true, status: 200, blob: async () => new Blob([url]) };
  } });
  await until(() => current(el)?.textContent === 'Файлы проекта');
  assert.equal(views.length, 0);
  assert.equal(el('stage').children[0].children[1].children.length, 2);
  select(1); await until(() => views.length === 1);
  assert.equal(views[0].rows[0].cells[0], 'two.txt');
});

test('manual folder selection wins over a pending manifest response', async () => {
  let release;
  const { el, context } = setup({ fetch: () => new Promise(resolve => { release = resolve; }) });
  context.Bouquet.ui.actions.openFiles([
    Object.assign(new Blob(['local']), { name: 'local.txt', webkitRelativePath: 'local/local.txt' })
  ], { folder: true });
  await until(() => pathLabel(el) === 'local / local.txt');
  release({ ok: true, json: async () => ({ files: ['remote.txt'] }) });
  await delay(10);
  assert.equal(pathLabel(el), 'local / local.txt');
});

test('dropped folders traverse all directory batches including nested folders', async () => {
  const { context } = setup();
  const file = name => ({ isFile: true, name, file(resolve) { resolve(Object.assign(new Blob([name]), { name })); } });
  const directory = (name, batches) => ({ isDirectory: true, name,
    createReader() { let i = 0; return { readEntries(resolve) { resolve(batches[i++] || []); } }; } });
  const nested = directory('nested', [[file('b.txt')]]);
  const root = directory('root', [[file('a.txt')], [nested], [file('c.txt')]]);
  const entries = await context.Bouquet.util.dropEntries([{ entry: root }]);
  assert.equal(entries.map(entry => entry.name).join(','), 'root/a.txt,root/c.txt,root/nested/b.txt');
});

test('opening a picker preserves the current source and pending reads until a new selection', async () => {
  const { el, context, views, choose } = setup();
  let release, signal, closed = 0, picked = 0;
  el('pickFile').onclick = () => { picked++; };
  context.Bouquet.register({ kind: 'interpreter', id: 'open-pending', priority: 100, test: () => true,
    open: () => ({ close() { closed++; }, tables: [{ name: 'pending', columns: ['value'], async read(args) {
      signal = args.signal; await new Promise(resolve => { release = resolve; });
      return { rows: [{ n: 1, cells: ['kept'] }], hasMore: false };
    } }] }) });
  choose(); await until(() => release);
  el('openFile').click();
  assert.equal(picked, 1);
  assert.equal(closed, 0);
  assert.equal(signal.aborted, false);
  assert.equal(el('emptyState').hidden, true);
  assert.equal(el('fileContent').hidden, false);
  release(); await until(() => views.length);
  assert.equal(views[0].rows[0].cells[0], 'kept');
});

test('status summary contains only found, scanned and known total in that order', async () => {
  const { el, views, choose, submit } = setup();
  choose('test.txt'); await until(() => views.length);
  assert.equal(el('dataSummary').textContent, 'Найдено: 1 · Просмотрено строк: 1 · Всего строк: 1');
  assert.equal(el('fileState').dataset.state, 'go');
  el('q').value = 'absent'; submit(); await until(() => views.at(-1).query === 'absent');
  assert.equal(el('dataSummary').textContent, 'Найдено: 0 · Просмотрено строк: 1 · Всего строк: 1');
  let picked = 0; el('pickFile').onclick = () => { picked++; };
  current(el).click();
  assert.equal(picked, 0);
  el('openFile').click();
  assert.equal(picked, 1);
  assert.equal(el('fileContent').hidden, false);
  assert.equal(el('dataSummary').textContent, 'Найдено: 0 · Просмотрено строк: 1 · Всего строк: 1');
});

test('settings replace the file path and actions, and close restores the exact explorer view', async () => {
  const { el, views, choose } = setup();
  choose('file.txt'); await until(() => views.length);
  const previous = views[0];
  el('settingsButton').click();
  assert.equal(pathLabel(el), 'Настройки');
  assert.equal(el('openFile').hidden, true);
  assert.equal(el('settingsButton').hidden, true);
  assert.equal(el('backLevel').hidden, false);
  el('backLevel').click();
  assert.equal(pathLabel(el), 'file.txt');
  assert.equal(el('openFile').hidden, false);
  assert.equal(el('backLevel').hidden, false);
  assert.equal(views.length, 1);
  assert.equal(views[0], previous);
});

test('multiple picked files create a path whose parents navigate and current element is inert', async () => {
  const { el, context, views, select } = setup();
  context.Bouquet.register({ kind: 'interpreter', id: 'path-tables', priority: 100, test: () => true,
    parse: () => ({ tables: [{ name: 'first', columns: ['value'], rows: [['one']] },
      { name: 'second', columns: ['value'], rows: [['two']] }] }) });
  const files = ['one.db', 'two.db'].map(name => Object.assign(new Blob(['data']), { name }));
  el('pickFile').onchange({ target: { files, value: '' } });
  assert.equal(pathLabel(el), 'Выбранные файлы');
  assert.equal(views.length, 0);
  select(0); await until(() => crumbs(el).length === 2 && el('stage').children.length > 0);
  assert.equal(pathLabel(el), 'Выбранные файлы / one.db');
  assert.equal(current(el).onclick, undefined);
  select(1); await until(() => views.length);
  assert.equal(pathLabel(el), 'Выбранные файлы / one.db / second');
  assert.equal(current(el).onclick, undefined);
  crumbs(el)[1].click();
  assert.equal(pathLabel(el), 'Выбранные файлы / one.db');
  crumbs(el)[0].click();
  assert.equal(pathLabel(el), 'Выбранные файлы');
  assert.equal(el('searchForm').hidden, true);
});

test('language cards preserve data, pagination, query, scroll and renderer DOM', async () => {
  const { el, context, views, choose, submit } = setup();
  const B = context.Bouquet, ui = B.ui;
  B.register({ kind: 'interpreter', id: 'language-rows', priority: 100, test: () => true,
    parse: () => ({ tables: [{ name: 'Original table', columns: ['Оригинальная колонка'],
      rows: Array.from({ length: 220 }, (_, n) => ['match ' + n]) }] }) });
  choose('Оригинальный файл.txt'); await until(() => views.length);
  el('q').value = 'match'; submit(); await until(() => views.at(-1).query === 'match');
  el('next').click(); await until(() => views.at(-1).page === 1);
  el('stage').scrollTop = 80;
  const view = views.at(-1), count = views.length;
  ui.selectTab('settings');
  const english = el('languageList').children.find(card => card.dataset.plugin === 'language-en');
  english.children[2].click();
  assert.equal(ui.language, 'language-en');
  assert.equal(pathLabel(el), 'Settings');
  assert.match(el('dataSummary').textContent, /Found: 220.*Rows scanned: 220.*Total rows: 220/);
  assert.equal(views.length, count);
  assert.equal(views.at(-1), view);
  assert.equal(view.table.columns[0], 'Оригинальная колонка');
  assert.equal(el('stage').scrollTop, 80);
  assert.equal(el('q').value, 'match');
  assert.equal(el('pos').textContent, '2 / 3');
  el('backLevel').click();
  assert.equal(pathLabel(el), 'Оригинальный файл.txt');
  ui.setLanguage('language-ru');
  assert.match(el('dataSummary').textContent, /Найдено: 220.*Просмотрено строк: 220.*Всего строк: 220/);
  assert.equal(views.length, count);
  assert.equal(el('languageList').children.length, 2);
  assert.equal(el('themeList').children.length, 2);
  assert.equal(el('pluginList').children.some(card => B.plugins.find(plugin => plugin.id === card.dataset.plugin)?.category === 'language'), false);
  assert.equal(el('pluginList').children.some(card => card.dataset.plugin === 'theme-default'), false);
});

test('language changes during an asynchronous read keep the same request and localize the result', async () => {
  const { el, context, views, choose } = setup();
  let release, signal, calls = 0;
  context.Bouquet.register({ kind: 'interpreter', id: 'language-pending', priority: 100, test: () => true,
    open: () => ({ tables: [{ name: 'pending', columns: ['value'], async read(args) {
      calls++; signal = args.signal; args.onProgress({ scanned: 128, found: 0 });
      await new Promise(resolve => { release = resolve; });
      return { rows: [{ n: 1, cells: ['kept'] }], total: 1, hasMore: false };
    } }] }) });
  choose(); await until(() => release);
  assert.match(decodeURIComponent(el('favicon').href), /⏳/);
  context.Bouquet.ui.setLanguage('language-en');
  assert.equal(signal.aborted, false);
  assert.equal(calls, 1);
  release(); await until(() => views.length);
  assert.match(decodeURIComponent(el('favicon').href), /💐/);
  assert.equal(el('dataSummary').textContent, 'Found: 1 · Rows scanned: 128 · Total rows: 1');
  assert.equal(views[0].rows[0].cells[0], 'kept');
});

test('external language packages load as plugins, use English fallback, and do not reread data', async () => {
  const { el, context, views, choose } = setup();
  const B = context.Bouquet;
  choose('file.txt'); await until(() => views.length);
  const count = views.length;
  const file = { name: 'fr.js', text: async () => `Bouquet.register({kind:'plugin',category:'language',id:'language-fr',name:'Français',locale:'fr',messages:{settings:'Paramètres',open:'Ouvrir',rows:{one:'{count} ligne',other:'{count} lignes'}}})` };
  el('pickModule').onchange({ target: { files: [file], value: file.name } });
  await until(() => B.plugins.some(p => p.id === 'language-fr'));
  B.ui.selectTab('settings');
  el('languageList').children.find(card => card.dataset.plugin === 'language-fr').children[2].click();
  assert.equal(pathLabel(el), 'Paramètres');
  assert.equal(B.i18n.t('open'), 'Ouvrir');
  assert.equal(B.i18n.t('search'), 'Search in file');
  assert.equal(B.i18n.t('rows', { count: 2 }), '2 lignes');
  assert.equal(views.length, count);
  assert.throws(() => B.ui.setLanguage('missing-language'), /Language is not loaded/);
  assert.equal(B.ui.language, 'language-fr');
});

test('built-in translation dictionaries cover the same keys and support Russian and English plurals', () => {
  const { context } = setup();
  const B = context.Bouquet, I = B.i18n;
  const languages = B.plugins.filter(plugin => plugin.category === 'language');
  assert.deepEqual(Object.keys(languages[0].messages).sort(), Object.keys(languages[1].messages).sort());
  assert.equal(I.t('rows', { count: 1 }), '1 строка');
  assert.equal(I.t('rows', { count: 2 }), '2 строки');
  assert.equal(I.t('rows', { count: 5 }), '5 строк');
  assert.equal(I.t('rows', { count: 21 }), '21 строка');
  I.setLanguage('language-en');
  assert.equal(I.t('rows', { count: 1 }), '1 row');
  assert.equal(I.t('rows', { count: 5 }), '5 rows');
  assert.equal(I.errorText(I.error('это не файл SQLite 3')), 'This is not a SQLite 3 file');
});

test('invalid language plugins are rejected before registration and leave the active language unchanged', () => {
  const { context } = setup();
  const B = context.Bouquet, before = B.plugins.length;
  for (const values of [{ locale: 'invalid_tag', messages: {} }, { locale: 'fr' }, { locale: 'fr', messages: [] }]) {
    assert.throws(() => B.register({ kind: 'plugin', category: 'language', id: 'invalid-language', ...values }), /Языковому пакету/);
    assert.equal(B.plugins.length, before);
    assert.equal(B.ui.language, 'language-ru');
  }
});

function cronosFiles(folder = '', count = 8) {
  const { fixture } = require('./fixtures/cronos.cjs');
  const data = fixture({ count });
  data['CroIndex.dat'] = data['CroBank.dat']; data['CroIndex.tad'] = data['CroBank.tad'];
  return Object.entries(data).map(([name, bytes]) => Object.assign(new Blob([bytes]), {
    name, webkitRelativePath: folder ? folder + '/' + name : ''
  }));
}
function addCronos(context) {
  context.DecompressionStream = DecompressionStream;
  context.Bouquet.exec(fs.readFileSync(path.join(__dirname, '../modules/cronos.js'), 'utf8'), 'cronos.js');
}
test('six Cronos components open one database immediately and retain all companion sources', async () => {
  const { el, context, views } = setup(); addCronos(context);
  el('pickFile').onchange({ target: { files: cronosFiles(), value: '' } });
  await until(() => views.length);
  assert.equal(views.length, 1);
  assert.equal(views[0].rows.length, 8);
  assert.equal(current(el).textContent, 'Table');
  assert.ok(pathLabel(el).includes('CronosPro'));
  assert.equal(views[0].rows[0].cells[1], 'row0');
});
test('twelve Cronos components form two database entries and stay isolated on navigation', async () => {
  const { el, context, views, select } = setup(); addCronos(context);
  el('pickFile').onchange({ target: { files: [...cronosFiles('Alpha', 3), ...cronosFiles('Beta', 8)], value: '' } });
  const items = () => el('stage').children[0].children[1].children;
  assert.equal(items().length, 2);
  assert.equal(items()[0].children[0].textContent, 'Alpha');
  assert.equal(items()[1].children[0].textContent, 'Beta');
  assert.equal(views.length, 0);
  select(1); await until(() => views.length);
  assert.equal(views[0].rows.length, 8);
  assert.equal(current(el).textContent, 'Table');
  crumbs(el)[0].click();
  assert.equal(items().length, 2);
  select(0); await until(() => views.length === 2);
  assert.equal(views[1].rows.length, 3);
});
test('database grouping preserves independent files and updates when the plugin is loaded later', async () => {
  const { el, context, views, select } = setup();
  const text = Object.assign(new Blob(['notes']), { name: 'notes.txt' });
  el('pickFile').onchange({ target: { files: [...cronosFiles('Bank'), text], value: '' } });
  assert.equal(el('stage').children[0].children[1].children.length, 2);
  addCronos(context);
  const items = el('stage').children[0].children[1].children;
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].textContent, 'Bank');
  assert.equal(items[1].children[0].textContent, 'notes.txt');
  select(1); await until(() => views.length);
  assert.equal(views[0].rows[0].cells[0], 'notes');
});
test('loading the Cronos plugin later auto-opens a sole grouped database', async () => {
  const { el, context, views } = setup();
  el('pickFile').onchange({ target: { files: cronosFiles('Bank'), value: '' } });
  addCronos(context); await until(() => views.length);
  assert.equal(views.length, 1);
  assert.equal(current(el).textContent, 'Table');
  assert.ok(pathLabel(el).includes('Bank'));
});

test('scan counters update without matches, keep language during reading and retain explicit errors', async () => {
  const { el, context, choose, submit, views } = setup();
  let finish, reads = 0;
  context.Bouquet.register({ kind: 'interpreter', id: 'scanned', priority: 100, test: () => true,
    open() { return { tables: [{ name: 'hidden name', columns: ['column'], async read({ match, onProgress }) {
      reads++;
      if (!match) return { rows: [{ n: 1, cells: ['value'] }], hasMore: true, nextCursor: 1, scanned: 1 };
      if (match(['error'])) throw new Error('Read failed explicitly');
      onProgress({ scanned: 128, found: 0, rows: [] });
      await new Promise(resolve => { finish = resolve; });
      return { rows: [], hasMore: false, scanned: 300, total: 300 };
    } }] }; }
  });
  choose(); await until(() => views.length);
  assert.equal(el('dataSummary').textContent, 'Найдено: ≥ 1 · Просмотрено строк: 1');
  el('q').value = 'missing'; submit(); await until(() => finish);
  assert.equal(el('dataSummary').textContent, 'Найдено: ≥ 0 · Просмотрено строк: 128');
  context.Bouquet.ui.setLanguage('language-en');
  assert.equal(el('dataSummary').textContent, 'Found: ≥ 0 · Rows scanned: 128');
  assert.equal(reads, 2);
  finish(); await until(() => views.at(-1).query === 'missing');
  assert.equal(el('dataSummary').textContent, 'Found: 0 · Rows scanned: 300 · Total rows: 300');
  assert.equal(el('status').hidden, true);
  el('q').value = 'error'; submit(); await until(() => el('status').textContent.includes('Read failed explicitly'));
  assert.equal(el('status').hidden, false);
});

test('Hello example mounts once when loaded, translates and returns to the preserved viewer', async () => {
  const { el, context, choose, views } = setup();
  choose('hello.txt'); await until(() => views.length);
  const previous = views[0];
  context.Bouquet.exec(fs.readFileSync(path.join(__dirname, '../modules/hello.js'), 'utf8'), 'hello.js');
  assert.equal(context.Bouquet.plugins.find(p => p.id === 'hello').uiError, undefined);
  const panel = el('workspace').children.at(-1);
  assert.equal(panel.children[0].textContent, 'Привет, Bouquet!');
  context.Bouquet.ui.selectTab('hello');
  assert.equal(panel.hidden, false);
  context.Bouquet.ui.setLanguage('language-en');
  assert.equal(panel.children[0].textContent, 'Hello, Bouquet!');
  assert.equal(panel.children[2].textContent, 'Return to explorer');
  panel.children[2].click();
  assert.equal(context.Bouquet.ui.activeTab, 'explorer');
  assert.equal(panel.hidden, true);
  assert.equal(views.length, 1);
  assert.equal(context.Bouquet.ui.currentView.view, previous);
  context.Bouquet.ui.selectTab('hello');
  assert.equal(el('workspace').children.at(-1), panel);
  assert.equal(panel.children.length, 3);
});

test('cross and browser history follow every folder, database and table level including automatic opening', async () => {
  const {el, context, views, select, history} = setup({withHistory:true});
  let parses = 0;
  context.Bouquet.register({id:'hierarchy',kind:'interpreter',format:'sqlite',priority:100,test:({ext})=>ext==='db',
    open() {parses++;return {tables:[{name:'records',columns:['id'],rows:[[1]]}]};}});
  const files=['root/child/deep/base.db','root/note.txt'].map(name=>Object.assign(new Blob(['data']),{name:name.split('/').at(-1),webkitRelativePath:name}));
  context.Bouquet.ui.actions.openFiles(files,{folder:true});
  select(0);select(0);select(0);await until(()=>views.length===1);
  assert.equal(pathLabel(el),'root / child / deep / base.db / records');
  const saved=context.Bouquet.ui.currentView;
  el('settingsButton').click();history.back();await until(()=>context.Bouquet.ui.activeTab==='explorer');
  assert.equal(context.Bouquet.ui.currentView,saved);
  assert.equal(parses,1);
  el('backLevel').click();await until(()=>current(el).textContent==='base.db');
  assert.equal(el('stage').children[0].children[1].children.length,1); // A sole table still has a database parent.
  history.back();await until(()=>current(el).textContent==='deep');
  el('backLevel').click();await until(()=>current(el).textContent==='child');
  history.back();await until(()=>current(el).textContent==='root');
  el('backLevel').click();await until(()=>el('emptyState').hidden===false);
  assert.equal(el('backLevel').hidden,true);
  for (const label of ['root','child','deep','base.db','records']) {
    history.forward();await until(()=>current(el)?.textContent===label);
  }
  await until(()=>views.length===2);
  assert.equal(parses,2); // Forward can reopen a closed database from its in-memory File.
  assert.equal(views.at(-1).table.name,'records');
});

test('closing settings during a pending read preserves the request and uploader settings return to uploader', async () => {
  const {el,context,choose,views,history}=setup({withHistory:true});
  el('settingsButton').click();el('backLevel').click();await until(()=>context.Bouquet.ui.activeTab==='explorer');
  assert.equal(el('emptyState').hidden,false);
  let finish,signal;
  context.Bouquet.register({id:'pending-history',kind:'interpreter',priority:100,test:()=>true,
    open:()=>({tables:[{name:'data',columns:['id'],read:async args=>{
      signal=args.signal;await new Promise(resolve=>{finish=resolve;});return {rows:[{n:1,cells:[1]}],hasMore:false};
    }}]})});
  choose();await until(()=>finish);el('settingsButton').click();history.back();await until(()=>context.Bouquet.ui.activeTab==='explorer');
  assert.equal(signal.aborted,false);finish();await until(()=>views.length);
  el('backLevel').click();await until(()=>el('emptyState').hidden===false);
  assert.equal(el('favicon').dataset.icon,'💐');
});

test('a grouped Cronos database in a child folder keeps all directory parents', async () => {
  const {el,context,views,select}=setup();addCronos(context);
  const note=Object.assign(new Blob(['note']),{name:'note.txt',webkitRelativePath:'root/note.txt'});
  context.Bouquet.ui.actions.openFiles([...cronosFiles('root/child/Bank'),note],{folder:true});
  select(0);select(0);await until(()=>views.length);
  assert.equal(pathLabel(el),'root / child / Bank / Table');
  el('backLevel').click();assert.equal(current(el).textContent,'Bank');
  el('backLevel').click();assert.equal(pathLabel(el),'root / child');
  assert.equal(el('stage').children[0].children[1].children[0].children[0].textContent,'Bank');
  el('backLevel').click();assert.equal(pathLabel(el),'root');
});

test('format alternatives are exclusive, preserve query/table, and settings plugins can configure them', async () => {
  const {el,context,choose,views,select,submit}=setup();
  const B=context.Bouquet,opened=[];
  for (const id of ['first','second']) B.register({id,kind:'interpreter',format:'example',priority:id==='first'?100:90,test:()=>true,
    open(){opened.push(id);return {tables:['a','b'].map(name=>({name,columns:['value'],rows:[['value '+(B.plugins.find(p=>p.id===id).options?.suffix||id)]]}))};}});
  choose();await until(()=>el('stage').children.length);select(1);await until(()=>views.length);
  el('q').value='value';submit();await until(()=>views.at(-1).query==='value');
  B.selectPlugin('format:example','second');await until(()=>opened.at(-1)==='second' && views.at(-1).rows[0].cells[0]==='value second');
  assert.equal(views.at(-1).query,'value');assert.equal(views.at(-1).table.name,'b');
  assert.equal(B.pluginEnabled(B.plugins.find(p=>p.id==='first')),false);
  assert.equal(B.activePlugin('format:example'),'second');
  const count=opened.length;
  B.setPluginOptions('first',{suffix:'inactive'});assert.equal(opened.length,count);
  B.exec(`Bouquet.register({id:'example-settings',kind:'plugin',category:'settings',targetGroup:'format:example',
    setup(ui){ui.addGroupSettings({group:'format:example',mount(panel){const button=document.createElement('button');
      button.textContent='Configure';button.onclick=()=>ui.setPluginOptions('second',{suffix:'configured'});panel.appendChild(button);}});}});`,'example-settings.js');
  const group=el('formatGroups').children.find(node=>node.dataset.group==='format:example');
  const controls=group.children[1].children[0];controls.children[0].click();
  await until(()=>views.at(-1).rows[0].cells[0]==='value configured');
  assert.equal(el('pluginList').children.some(card=>card.dataset.plugin==='example-settings'),false);
  assert.equal(el('pluginList').children.some(card=>['first','second'].includes(card.dataset.plugin)),false);
  assert.equal(group.children[2].children.filter(card=>card.children[2].checked).length,1);
  B.ui.setLanguage('language-en');assert.equal(group.children[1].children[0],controls);
  choose('another.db');await until(()=>opened.length===count+2);
  assert.equal(opened.at(-1),'second');
});

test('appearance follows OS only in System and leaves the current data untouched', async () => {
  const {el,context,choose,views,systemTheme}=setup({dark:true});
  const B=context.Bouquet,ui=B.ui;
  const style=context.document.head.children.find(node=>node.id==='bouquet-theme');
  assert.equal(ui.appearance,'system');assert.equal(ui.theme,'theme-default');assert.match(style.textContent,/#131519/);
  const control=el('themeSettings').children[0];
  choose('data.txt');await until(()=>views.length);const view=ui.currentView;
  ui.setAppearance('light');assert.match(style.textContent,/#ede7d8/);
  systemTheme(false);systemTheme(true);assert.match(style.textContent,/#ede7d8/);
  ui.setAppearance('system');assert.match(style.textContent,/#131519/);
  systemTheme(false);assert.match(style.textContent,/#ede7d8/);
  ui.selectPlugin('theme','theme-contrast');
  assert.equal(ui.theme,'theme-contrast');assert.match(style.textContent,/--canvas:#fff;--surface:#fff/);
  systemTheme(true);assert.match(style.textContent,/--canvas:#171717/);
  ui.setAppearance('light');assert.match(style.textContent,/--canvas:#fff;--surface:#fff/);
  assert.equal(ui.currentView,view);assert.equal(views.length,1);
  ui.selectPlugin('theme','theme-default');assert.doesNotMatch(style.textContent,/--contrast-/);
  B.register({id:'theme-alternative',kind:'plugin',category:'theme',name:'Alternative',states:{light:':root{--iris:red}',dark:':root{--iris:blue}'}});
  ui.selectPlugin('theme','theme-alternative');assert.match(style.textContent,/red/);
  ui.setAppearance('dark');assert.match(style.textContent,/blue/);
  assert.equal(ui.currentView,view);assert.equal(views.length,1);
  assert.equal(el('themeSettings').children[0],control);
  assert.equal(el('themeList').children.length,3);
  assert.equal(el('themeList').children.filter(card=>card.children[2].checked).length,1);
  assert.equal(el('pluginList').children.some(card=>card.dataset.plugin==='theme-settings'),false);
});

test('first/last page actions jump directly for in-memory results and respect filtering', async () => {
  const { context, choose, views, el, submit } = setup();
  context.Bouquet.register({ kind: 'interpreter', id: 'edges', priority: 100, test: () => true,
    parse() { return { tables: [{ name: 'rows', columns: ['value'], rows: Array.from({ length: 351 }, (_, n) => [String(n)]) }] }; } });
  choose(); await until(() => views.length > 0);
  await context.Bouquet.ui.actions.lastPage();
  assert.equal(views.at(-1).page, 3); assert.equal(views.at(-1).rows.length, 51);
  await context.Bouquet.ui.actions.firstPage(); assert.equal(views.at(-1).page, 0);
  el('q').value = '350'; submit(); await until(() => views.at(-1).query === '350');
  await context.Bouquet.ui.actions.lastPage(); assert.equal(views.at(-1).page, 0);
  assert.equal(views.at(-1).rows[0].cells[0], '350');
});
test('last page discovers lazy cursors, reuses known cursors and Home interrupts traversal', async () => {
  const { context, choose, views } = setup();
  let reads = 0, total = 351;
  context.Bouquet.register({ kind: 'interpreter', id: 'lazy-edges', priority: 100, test: () => true,
    async open() { return { tables: [{ name: 'rows', columns: ['value'],
      async read({ cursor, limit, signal }) {
        reads++; await delay(2); context.Bouquet.util.checkAbort(signal);
        const from = cursor || 0, end = Math.min(total, from + limit);
        return { rows: Array.from({ length: end - from }, (_, n) => ({ n: from + n + 1, cells: [String(from + n)] })),
          nextCursor: end, hasMore: end < total };
      } }] }; } });
  choose(); await until(() => views.length > 0);
  const actions = context.Bouquet.ui.actions;
  await actions.lastPage(); assert.equal(views.at(-1).page, 3); assert.equal(reads, 4);
  await actions.firstPage(); const before = reads;
  await actions.lastPage(); assert.equal(views.at(-1).page, 3); assert.equal(reads, before + 1);
  total = 2000; choose('fresh.lazy'); await until(() => views.at(-1).page === 0 && views.at(-1).hasMore);
  const traversal = actions.lastPage(); await until(() => views.at(-1).page === 1);
  await actions.firstPage(); await traversal; await delay(15);
  assert.equal(views.at(-1).page, 0);
});

test('group settings own localized descriptions without duplicate plugin cards, and footer groups stay last', () => {
  const { context, el } = setup(), B = context.Bouquet;
  const themeDescription = el('themesPanel').children.find(node => node.className === 'group-description');
  assert.ok(themeDescription); assert.match(themeDescription.textContent, /Темы/);
  const loading = el('formatGroups').children.find(node => node.dataset.group === 'file-loading');
  const loadingDescription = loading.children.find(node => node.className === 'group-description');
  assert.equal(loadingDescription, undefined);
  assert.equal(el('pluginList').children.some(card => ['theme-settings', 'file-loading'].includes(card.dataset.plugin)), false);
  let mounts = 0;
  B.register({ kind: 'plugin', category: 'settings', id: 'test-footer', targetGroup: 'test-footer', setup(ui) {
    ui.addGroupSettings({ group: 'test-footer', position: 'last', label: { ru: 'Справка', en: 'Help' }, description: { ru: 'Описание', en: 'Description' },
      mount(panel) { mounts++; panel.appendChild(context.document.createElement('table')); } });
  } });
  const section = el('settingsExtras').children.at(-1), controls = section.children[2].children[0];
  assert.equal(section.children[0].textContent, 'Справка'); assert.equal(section.children[1].textContent, 'Описание');
  B.ui.setLanguage('language-en');
  assert.match(themeDescription.textContent, /Themes/);
  assert.equal(section.children[0].textContent, 'Help'); assert.equal(section.children[1].textContent, 'Description');
  assert.equal(section.children[2].children[0], controls); assert.equal(mounts, 1);
  assert.equal(el('pluginList').children.some(card => card.dataset.plugin === 'test-footer'), false);
  assert.equal(B.plugins.find(plugin => plugin.id === 'test-footer').uiError, undefined);
});
test('section breadcrumbs use semantic labels even when button titles include keyboard hints', () => {
  const { context, el } = setup(), ui = context.Bouquet.ui;
  el('settingsButton').title = 'Настройки (Cmd + ,)';
  el('settingsButton').click();
  assert.equal(ui.activeLabel, 'Настройки'); assert.equal(pathLabel(el), 'Настройки');
  ui.setLanguage('language-en');
  el('settingsButton').title = 'Settings (Cmd + ,)'; ui.selectTab('explorer'); ui.selectTab('settings');
  assert.equal(ui.activeLabel, 'Settings'); assert.equal(pathLabel(el), 'Settings');
});
