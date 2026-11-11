// Renderer lifecycle checks with a minimal DOM; layout requires a real browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  class Element {
    constructor() {
      this.children = []; this.attrs = {}; this.dataset = {}; this.classes = new Set();
      this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key), contains: key => this.classes.has(key) };
    }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    addEventListener() {}
    focus() { this.focused = true; }
    set innerHTML(value) {
      this.html = value;
      if (value.includes('<table')) this.parts = { '.bq-controls': new Element(), '.bq-corner': new Element(), tbody: new Element() };
    }
    get innerHTML() { return this.html; }
    querySelector(selector) {
      return this.parts?.[selector] || (selector === '.bq-wrap' ? this.children.find(child => child.className === 'bq-wrap') : null);
    }
  }
  const app = new Element(), stage = new Element(), actions = {};
  let mutation;
  const context = vm.createContext({ console,
    document: { head: new Element(), getElementById: id => ({ app, stage })[id],
      createElement: () => new Element() },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} }
  });
  context.window = context;
  for (const file of ['core/bouquet.js', 'core/i18n.js', 'modules/table.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const B = context.Bouquet, renderer = B.renderers.find(p => p.id === 'table');
  renderer.setup({ actions, activeTab: 'explorer' });
  const render = (rows = [{ n: 101, cells: ['x'.repeat(60)] }]) => {
    renderer.render(stage, { table: { columns: ['value'] }, rows, highlight: B.util.escape });
    mutation();
    return stage.children[0].querySelector('.bq-controls').children[0];
  };
  return { B, app, stage, render, actions, mutation: () => mutation() };
}
test('table fullscreen toggles in place, keeps row indices and scroll, supports the shared exit action', () => {
  const { app, stage, render, actions } = setup(), button = render(), wrap = stage.children[0];
  wrap.scrollTop = 120; wrap.scrollLeft = 50;
  assert.match(wrap.innerHTML, /class="bq-num">101/);
  assert.match(wrap.innerHTML, /data-long="1"/);
  button.onclick();
  assert.equal(app.classList.contains('bq-fullscreen'), true);
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(stage.children[0], wrap);
  assert.equal(wrap.scrollTop, 120); assert.equal(wrap.scrollLeft, 50);
  assert.equal(actions.fullscreen(false), true);
  assert.equal(app.classList.contains('bq-fullscreen'), false);
  assert.equal(button.focused, true);
  button.onclick(); button.onclick();
  assert.equal(button.attrs['aria-pressed'], 'false');
});
test('fullscreen survives paging, view resets and empty results, including translated exit control', () => {
  const { B, app, stage, render } = setup();
  render().onclick();
  B.emit('view:reset');
  const next = render([{ n: 201, cells: ['next'] }]);
  assert.equal(next.attrs['aria-pressed'], 'true');
  assert.equal(app.classList.contains('bq-fullscreen'), true);
  B.i18n.setLanguage('language-en');
  const empty = render([]);
  assert.equal(empty.title, 'Exit full screen (Esc)');
  assert.equal(stage.children[0].children.at(-1).textContent, B.i18n.t('tableEmpty'));
  empty.onclick();
  assert.equal(app.classList.contains('bq-fullscreen'), false);
});
test('navigation, renderer replacement and read errors restore the shell', () => {
  const { B, app, stage, render, mutation } = setup();
  render().onclick(); B.emit('tab:change', { id: 'settings' });
  assert.equal(app.classList.contains('bq-fullscreen'), false);
  B.emit('tab:change', { id: 'explorer' });
  assert.equal(app.classList.contains('bq-fullscreen'), false);
  render().onclick(); stage.replaceChildren(); mutation();
  assert.equal(app.classList.contains('bq-fullscreen'), false);
  assert.equal(render().attrs['aria-pressed'], 'false');
});
test('corner pin toggles both sets of indices in place and stays independent of fullscreen', () => {
  const { app, stage, render } = setup(), fullscreenButton = render(), wrap = stage.children[0];
  const pin = wrap.querySelector('.bq-corner').children[0];
  assert.equal(pin.attrs['aria-pressed'], 'true');
  assert.equal(wrap.classList.contains('bq-unpinned'), false);
  wrap.scrollTop = 120; wrap.scrollLeft = 80;
  const body = wrap.querySelector('tbody');
  pin.onclick();
  assert.equal(pin.attrs['aria-pressed'], 'false');
  assert.equal(pin.title, 'Pin column headers and row numbers');
  assert.equal(wrap.classList.contains('bq-unpinned'), true);
  assert.equal(stage.children[0], wrap);
  assert.equal(wrap.querySelector('tbody'), body);
  assert.equal(wrap.scrollTop, 120); assert.equal(wrap.scrollLeft, 80);
  fullscreenButton.onclick();
  assert.equal(app.classList.contains('bq-fullscreen'), true);
  assert.equal(pin.attrs['aria-pressed'], 'false');
  pin.onclick();
  assert.equal(pin.attrs['aria-pressed'], 'true');
  assert.equal(wrap.classList.contains('bq-unpinned'), false);
  assert.equal(app.classList.contains('bq-fullscreen'), true);
});
test('pin selection survives pagination and empty results, with translated accessible names', () => {
  const { B, stage, render } = setup();
  render(); stage.children[0].querySelector('.bq-corner').children[0].onclick();
  B.emit('view:reset'); render([{ n: 201, cells: ['next'] }]);
  assert.equal(stage.children[0].querySelector('.bq-corner').children[0].attrs['aria-pressed'], 'false');
  B.i18n.setLanguage('language-ru'); render([]);
  const wrap = stage.children[0], pin = wrap.querySelector('.bq-corner').children[0];
  assert.equal(wrap.classList.contains('bq-unpinned'), true);
  assert.equal(pin.attrs['aria-label'], 'Закрепить шапку и номера строк');
  pin.onclick();
  assert.equal(pin.attrs['aria-label'], 'Открепить шапку и номера строк');
  render();
  assert.equal(stage.children[0].querySelector('.bq-corner').children[0].attrs['aria-pressed'], 'true');
});
