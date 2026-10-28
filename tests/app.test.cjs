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
  el('settingsTabs').hidden = true;
  const body = new Element();
  const context = vm.createContext({ console, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, DOMException, AbortController, setTimeout, clearTimeout,
    document: { body, head: new Element(), querySelector: () => el('bar'), getElementById: el, createElement: () => new Element() }, addEventListener() {}, scrollTo() {}, fetch });
  context.window = context;
  for (const f of ['core/bouquet.js', 'core/i18n.js', 'core/sources.js', 'core/files.js', ...(withSearch ? ['modules/search.js'] : [])]) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context);
  const views = [];
  context.Bouquet.register({ kind: 'renderer', id: 'capture', priority: 100, test: () => true, render: (_, view) => views.push(view) });
  for (const f of ['modules/themes.js', 'core/ui.js', 'core/app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context);
  const choose = (name = 'test.lazy', size) => {
    const file = Object.assign(new Blob(['data']), { name });
    if (size != null) Object.defineProperty(file, 'size', { value: size });
    el('pickFile').onchange({ target: { files: [file], value: name } });
  };
  const select = i => el('stage').children[0].children[1].children[i].children[0].click();
  const submit = () => el('searchForm').onsubmit({ preventDefault() {} });
  return { el, context, views, choose, submit, select };
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

test('SQLite auto mode boundary, manual toggle, query/table preservation and new-file reset', async () => {
  const { el, context, views, choose, submit, select } = setup();
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
  assert.equal(views.length, 0);
  select(1); await until(() => views.length > 0);
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
  assert.equal(themeCard.children[2].disabled, true);
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
  assert.equal(el('stage').children[0].children[1].children[0].children[0].textContent, 'folder/a.txt');
  context.Bouquet.ui.selectTab('settings'); context.Bouquet.ui.selectTab('explorer');
  assert.equal(views.length, 0);
  select(1); await until(() => views.length === 1);
  assert.equal(views[0].rows[0].cells[0], 'folder/nested/b.txt');
  back(el);
  assert.equal(current(el)?.textContent, 'folder');
  assert.equal(context.Bouquet.ui.currentView, null);
  select(0); await until(() => views.length === 2);
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

test('one status summary reports totals and matches alongside file state', async () => {
  const { el, views, choose, submit } = setup();
  choose('test.txt'); await until(() => views.length);
  assert.equal(el('dataSummary').textContent, '1 строка · 1 кол.');
  assert.equal(el('fileState').dataset.state, 'go');
  el('q').value = 'absent'; submit(); await until(() => views.at(-1).query === 'absent');
  assert.equal(el('dataSummary').textContent, '1 строка · 1 кол. · найдено 0');
  let picked = 0; el('pickFile').onclick = () => { picked++; };
  current(el).click();
  assert.equal(picked, 0);
  el('openFile').click();
  assert.equal(picked, 1);
  assert.equal(el('fileContent').hidden, false);
  assert.equal(el('dataSummary').textContent, '1 строка · 1 кол. · найдено 0');
});

test('settings replace the file path and actions, and close restores the exact explorer view', async () => {
  const { el, views, choose } = setup();
  choose('file.txt'); await until(() => views.length);
  const previous = views[0];
  el('settingsButton').click();
  assert.equal(pathLabel(el), 'Настройки');
  assert.equal(el('openFile').hidden, true);
  assert.equal(el('settingsButton').hidden, true);
  assert.equal(el('closeSettings').hidden, false);
  el('closeSettings').click();
  assert.equal(pathLabel(el), 'file.txt');
  assert.equal(el('openFile').hidden, false);
  assert.equal(el('closeSettings').hidden, true);
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
  assert.match(el('dataSummary').textContent, /220 rows.*220 found/);
  assert.equal(views.length, count);
  assert.equal(views.at(-1), view);
  assert.equal(view.table.columns[0], 'Оригинальная колонка');
  assert.equal(el('stage').scrollTop, 80);
  assert.equal(el('q').value, 'match');
  assert.equal(el('pos').textContent, '2 / 3');
  el('closeSettings').click();
  assert.equal(pathLabel(el), 'Оригинальный файл.txt');
  ui.setLanguage('language-ru');
  assert.match(el('dataSummary').textContent, /220 строк.*найдено 220/);
  assert.equal(views.length, count);
  assert.equal(el('languageList').children.length, 2);
  assert.equal(el('themeList').children.length, 3);
  assert.equal(el('pluginList').children.some(card => ['language', 'theme'].includes(B.plugins.find(plugin => plugin.id === card.dataset.plugin)?.category)), false);
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
  context.Bouquet.ui.setLanguage('language-en');
  assert.equal(signal.aborted, false);
  assert.equal(calls, 1);
  release(); await until(() => views.length);
  assert.equal(el('dataSummary').textContent, '1 row · 1 col.');
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
  assert.equal(current(el).textContent, 'CronosPro');
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
  assert.equal(current(el).textContent, 'Beta');
  crumbs(el).find(node => node.dataset.level === 'files').click();
  assert.equal(items().length, 2);
  select(0); await until(() => views.length === 2);
  assert.equal(views[1].rows.length, 3);
});
test('database grouping preserves independent files and updates when the plugin is loaded later', async () => {
  const { el, context, views, select } = setup();
  const text = Object.assign(new Blob(['notes']), { name: 'notes.txt' });
  el('pickFile').onchange({ target: { files: [...cronosFiles('Bank'), text], value: '' } });
  assert.equal(el('stage').children[0].children[1].children.length, 7);
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
  assert.equal(current(el).textContent, 'Bank');
});
