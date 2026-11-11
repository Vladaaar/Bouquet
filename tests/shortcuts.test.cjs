const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup(platform = 'Linux') {
  const calls = [], nodes = new Map(), listeners = {};
  let panel, group, observer, doc;
  class Element {
    constructor(tag = 'button') {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.events = {}; this.hidden = false; this.disabled = false; this.isConnected = true;
      this.classes = new Set(); this.classList = { contains: key => this.classes.has(key), toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key) };
    }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    addEventListener(key, fn) { this.events[key] = fn; }
    focus() { doc.activeElement = this; }
    blur() { doc.activeElement = doc.body; }
    click() { this.onclick?.(); }
    scrollIntoView() { calls.push('help-scroll'); }
    scrollBy(move) { calls.push(['scroll', move]); }
    matches(selector) { return this === content && selector.includes('.bq-wrap'); }
    closest() { return null; }
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element(id === 'q' ? 'input' : 'button')); return nodes.get(id); };
  const content = new Element('div'), pin = new Element(), fullscreen = new Element(), root = new Element('div'), stage = new Element('div');
  stage.querySelector = selector => selector === '.bq-fullscreen-button' ? fullscreen : selector === '.bq-index-pin' ? pin : content;
  pin.setAttribute('data-i18n-title', 'tableUnpinIndices');
  pin.onclick = () => { calls.push('pin'); const key = pin.getAttribute('data-i18n-title') === 'tableUnpinIndices' ? 'tablePinIndices' : 'tableUnpinIndices'; pin.setAttribute('data-i18n-title', key); };
  doc = { body: new Element('body'), documentElement: new Element('html'), head: new Element('head'), getElementById: $,
    createElement: tag => new Element(tag),
    querySelector: () => doc.modalOpen ? {} : null, querySelectorAll: () => [], addEventListener: (key, fn) => { listeners[key] = fn; } };
  doc.activeElement = doc.body;
  const context = vm.createContext({ console, document: doc, navigator: { platform, languages: ['en-US'] },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} } });
  context.window = context;
  for (const file of ['core/bouquet.js', 'core/i18n.js', 'modules/shortcuts.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const B = context.Bouquet;
  const ui = { document: doc, root, i18n: B.i18n, elements: { stage, header: new Element('header') }, activeTab: 'explorer', currentView: {},
    actions: { chooseFiles: () => calls.push('open'), firstPage: () => calls.push('first'), lastPage: () => calls.push('last'),
      fullscreen(value) { const next = value ?? !root.classList.contains('bq-fullscreen');
        if (next === root.classList.contains('bq-fullscreen')) return false;
        root.classList.toggle('bq-fullscreen', next); calls.push(['fullscreen', next]);
        fullscreen.setAttribute('data-i18n-title', next ? 'tableExitFullscreen' : 'tableFullscreen'); return true; } },
    addGroupSettings(options) { group = options; panel = new Element('div'); panel.className = 'group-settings'; options.mount(panel); return panel; },
    selectTab(id) { ui.activeTab = id; calls.push(id); B.emit('tab:change', { id }); } };
  for (const [id, action] of [['backLevel', 'close'], ['prev', 'previous'], ['next', 'next']]) $(id).onclick = () => calls.push(action);
  B.features.shortcuts.setup(ui);
  function key(key, extras = {}) {
    const event = { key, target: doc.activeElement, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extras };
    listeners.keydown(event);
    return event;
  }
  return { B, ui, doc, $, calls, key, content, pin, fullscreen, panel, group, hints: () => observer() };
}
test('O/W/F/Escape, brackets, Home/End and physical keys work without browser modifier collisions', () => {
  const { key, calls } = setup();
  for (const [value, extra] of [['o'], ['ц', { code: 'KeyW' }], ['f'], ['Escape'], ['з', { code: 'KeyP' }], ['['], [']'], ['Home'], ['End']]) {
    assert.equal(key(value, extra).defaultPrevented, true);
  }
  assert.deepEqual(calls, ['open', 'close', ['fullscreen', true], ['fullscreen', false], 'pin', 'previous', 'next', 'first', 'last']);
  calls.length = 0;
  key('o', { ctrlKey: true }); key('w', { metaKey: true }); key('f', { altKey: true });
  key('o', { repeat: true }); key('o', { isComposing: true }); key('o', { defaultPrevented: true });
  assert.equal(calls.length, 0);
});
test('typing and focused controls keep their keys; settings combo works from search on Mac and Windows', () => {
  for (const [platform, modifier, hint] of [['MacIntel', 'metaKey', 'Cmd + ,'], ['macOS', 'metaKey', 'Cmd + ,'], ['Win32', 'ctrlKey', 'Ctrl + ,']]) {
    const { doc, $, key, calls } = setup(platform);
    $('q').focus(); for (const value of ['o', 'w', 'f', 'p', '/', '?', '[', ']', 'Home', 'End', 'ArrowRight']) key(value);
    assert.equal(calls.length, 0);
    assert.equal(key(',', { [modifier]: true, code: 'Comma' }).defaultPrevented, true);
    assert.deepEqual(calls, ['settings']); assert.match($('settingsButton').title, new RegExp(hint.replace('+', '\\+')));
    key('Escape'); assert.equal(doc.activeElement, doc.body);
  }
});
test('slash focuses visible search; arrows scroll both axes without changing pages and respect control/cell focus', () => {
  const { key, doc, $, calls, ui } = setup();
  key('/'); assert.equal(doc.activeElement, $('q')); key('Escape');
  for (const value of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(key(value).defaultPrevented, true);
  assert.deepEqual(calls.map(([type, move]) => [type, move.left ?? move.top]), [['scroll', -48], ['scroll', 48], ['scroll', -48], ['scroll', 48]]);
  calls.length = 0; $('next').focus(); key('ArrowRight'); assert.equal(calls.length, 0);
  doc.activeElement = { tagName: 'TD' }; key('ArrowRight'); assert.equal(calls.length, 0);
  doc.activeElement = doc.body; ui.actions.fullscreen(true); key('/'); assert.equal(doc.activeElement, doc.body);
  ui.actions.fullscreen(false); $('searchForm').hidden = true; key('/'); assert.equal(doc.activeElement, doc.body);
});
test('help opens the final Settings block without a separate button or modal; foreign dialogs keep their keys', () => {
  const { key, panel, group, ui, doc, B, calls } = setup();
  assert.equal(B.features.shortcuts.category, 'settings');
  assert.equal(group.position, 'last'); assert.equal(group.group, 'shortcuts');
  assert.equal(ui.elements.header.children.length, 0);
  assert.equal(ui.root.children.length, 0);
  key('?'); assert.equal(ui.activeTab, 'settings');
  assert.deepEqual(calls, ['settings', 'help-scroll']);
  assert.equal(doc.activeElement, panel);
  assert.equal(panel.children[0].children[0].children.length, 11);
  B.i18n.setLanguage('language-ru');
  assert.equal(panel.children[0].children[0].children[3].children[1].textContent, 'Закрепить или открепить шапку и номера строк');
  calls.length = 0; key('p'); assert.equal(calls.length, 0);
  key('w'); assert.deepEqual(calls, ['close']);
  calls.length = 0; doc.modalOpen = true;
  key('o'); key('f'); key('p'); key('?'); assert.equal(calls.length, 0);
});
test('button titles follow language, fullscreen and navigation state, with accessible shortcut metadata', () => {
  const { B, $, pin, fullscreen, ui, hints, calls, key } = setup();
  assert.equal($('openFile').title, 'Open (O)'); assert.equal($('prev').title, 'Previous ([)');
  assert.equal($('openFile').getAttribute('aria-keyshortcuts'), 'O');
  assert.equal(pin.title, 'Unpin column headers and row numbers (P)');
  key('p'); hints(); assert.equal(pin.title, 'Pin column headers and row numbers (P)');
  assert.equal(pin.getAttribute('aria-keyshortcuts'), 'P');
  ui.actions.fullscreen(true); hints();
  assert.equal(fullscreen.title, 'Exit full screen (F / Esc)');
  B.i18n.setLanguage('language-ru'); assert.equal($('openFile').title, 'Открыть (O)');
  $('backLevel').setAttribute('data-i18n-title', 'back'); hints(); assert.equal($('backLevel').title, 'Вернуться к просмотру (W)');
  hints(); assert.equal($('backLevel').title, 'Вернуться к просмотру (W)');
  calls.length = 0; $('backLevel').hidden = true; $('next').disabled = true;
  key('w'); key(']'); assert.equal(calls.length, 0);
});
