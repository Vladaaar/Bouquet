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
      if (value.includes('<table')) this.parts = { '.bq-controls': new Element(), tbody: new Element() };
    }
    get innerHTML() { return this.html; }
    querySelector(selector) {
      return this.parts?.[selector] || (selector === '.bq-wrap' ? this.children.find(child => child.className === 'bq-wrap') : null);
    }
  }
  const app = new Element(), stage = new Element(), keys = {};
  let mutation;
  const context = vm.createContext({ console,
    document: { head: new Element(), getElementById: id => ({ app, stage })[id],
      createElement: () => new Element(), addEventListener: (type, fn) => { keys[type] = fn; } },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} }
  });
  context.window = context;
  for (const file of ['core/bouquet.js', 'core/i18n.js', 'modules/table.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const B = context.Bouquet, renderer = B.renderers.find(p => p.id === 'table');
  renderer.setup();
  const render = (rows = [{ n: 101, cells: ['x'.repeat(60)] }]) => {
    renderer.render(stage, { table: { columns: ['value'] }, rows, highlight: B.util.escape });
    mutation();
    return stage.children[0].querySelector('.bq-controls').children[0];
  };
  return { B, app, stage, render, mutation: () => mutation(), key(key) {
    const event = { key, target: { tagName: 'BUTTON' }, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    keys.keydown(event); return event;
  } };
}
test('table fullscreen toggles in place, keeps row indices and scroll, exits with Escape', () => {
  const { app, stage, render, key } = setup(), button = render(), wrap = stage.children[0];
  wrap.scrollTop = 120; wrap.scrollLeft = 50;
  assert.match(wrap.innerHTML, /class="bq-num">101/);
  assert.match(wrap.innerHTML, /data-long="1"/);
  button.onclick();
  assert.equal(app.classList.contains('bq-fullscreen'), true);
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(stage.children[0], wrap);
  assert.equal(wrap.scrollTop, 120); assert.equal(wrap.scrollLeft, 50);
  assert.equal(key('/').stopped, true);
  assert.equal(key('Escape').prevented, true);
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
