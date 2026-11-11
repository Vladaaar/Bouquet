const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup() {
  const created = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.value = ''; created.push(this); }
    appendChild(node) { this.children.push(node); }
    setCustomValidity(value) { this.validationMessage = value; }
    reportValidity() { this.reported = true; }
  }
  const document = { head: new Element('head'), createElement: tag => new Element(tag), querySelectorAll: () => [] };
  const context = vm.createContext({ console, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, DOMException, setTimeout, document });
  context.window = context;
  for (const file of ['core/bouquet.js', 'core/i18n.js', 'core/sources.js', 'modules/file_loading.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const B = context.Bouquet, loader = B.features['file-loading'];
  return { B, loader, document, created };
}
test('one global threshold: default 100 MB, inclusive boundary, zero and invalid values', () => {
  const { loader } = setup();
  assert.equal(loader.options.memoryLimitMB, 100);
  assert.equal(loader.mode({ size: 100 * 1024 * 1024 }), 'memory');
  assert.equal(loader.mode({ size: 100 * 1024 * 1024 + 1 }), 'progressive');
  for (const value of [-1, 1.5, NaN, Infinity, '', '100', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => loader.setMemoryLimitMB(value), { i18nKey: 'fileLoadingInvalidLimit' });
    assert.equal(loader.options.memoryLimitMB, 100);
  }
  loader.setMemoryLimitMB(0);
  assert.equal(loader.mode({ size: 1 }), 'progressive'); assert.equal(loader.mode({ size: 0 }), 'progressive');
});
test('memory loading reads the source once and exposes cancellable ranges to an open reader', async () => {
  const { B, loader } = setup(), reads = [];
  const source = Object.freeze({ name: 'file', size: 6, noteKey: 'rangeFallback', async read(offset, length) {
    reads.push([offset, length]); return Uint8Array.from([1, 2, 3, 4, 5, 6]).subarray(offset, offset + length);
  } });
  let cached;
  const result = await loader.open({ async open(meta) {
    assert.equal(meta.loadingMode, 'memory'); cached = meta.source;
    const part = await cached.read(2, 2), again = await cached.read(0, 1);
    assert.equal(cached.noteKey, 'rangeFallback'); return { part, again };
  } }, { source, name: 'file' });
  assert.deepEqual(Array.from(result.part), [3, 4]); assert.deepEqual(reads, [[0, 6]]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(cached.read(0, 1, { signal: controller.signal }), { name: 'AbortError' });
});
test('progressive loading leaves range requests to the parser and honors format selection', async () => {
  const { B, loader } = setup(), reads = [];
  loader.setMemoryLimitMB(0);
  const source = { size: 10000, name: 'progressive.db', async read(offset, length) { reads.push([offset, length]); return new Uint8Array(length); } };
  const reader = B.register({ id: 'ranges', kind: 'interpreter', format: 'test', loadingModes: ['memory', 'progressive'], test: () => true,
    async open(meta) { assert.equal(meta.source, source); assert.equal(meta.loadingMode, 'progressive'); return meta.source.read(100, 20); } });
  assert.equal(loader.select({ source }), reader);
  await loader.open(reader, { source }); assert.deepEqual(reads, [[100, 20]]);
});
test('zero is strict, but a positive threshold allows full-only formats even above the threshold', async () => {
  const { B, loader } = setup(); let reads = 0, parses = 0;
  const source = { size: 2 * 1024 * 1024, name: 'book.xlsx', async read() { reads++; return new Uint8Array(this.size); } };
  const reader = B.register({ kind: 'interpreter', id: 'legacy', test: () => true,
    parse({ buffer, loadingMode }) { parses++; assert.equal(buffer.byteLength, source.size); assert.equal(loadingMode, 'memory'); return {}; } });
  loader.setMemoryLimitMB(0);
  assert.throws(() => loader.select({ source, name: source.name }), { i18nKey: 'fileLoadingProgressiveUnsupported' });
  await assert.rejects(loader.open(reader, { source, name: source.name }), { i18nKey: 'fileLoadingProgressiveUnsupported' });
  assert.equal(reads, 0); assert.equal(parses, 0);
  loader.setMemoryLimitMB(1); assert.equal(loader.select({ source }), reader);
  await loader.open(reader, { source }); assert.equal(reads, 1); assert.equal(parses, 1);
});
test('full-only companion files ignore a positive threshold; zero never materializes them', async () => {
  const { loader } = setup(); let largeReads = 0;
  loader.setMemoryLimitMB(1);
  const source = { size: 1, name: 'structure', async read() { return new Uint8Array(1); } };
  const large = { size: 2 * 1024 * 1024, name: 'bank', async read() { largeReads++; return new Uint8Array(this.size); } };
  const reader = { async open({ files }) { const bank = await files[0].open(); assert.equal((await bank.read(0, bank.size)).length, large.size); } };
  await loader.open(reader, { source, files: [{ name: 'bank', open: () => large }] });
  assert.equal(largeReads, 1);
  loader.setMemoryLimitMB(0);
  await assert.rejects(loader.open(reader, { source, files: [{ name: 'bank', open: () => large }] }), { i18nKey: 'fileLoadingProgressiveUnsupported' });
  assert.equal(largeReads, 1);
});
test('the settings module has exactly one numeric control; valid changes reload once and translate', () => {
  const { B, loader, document, created } = setup(); let reloads = 0, group;
  loader.setup({ document, i18n: B.i18n, actions: { reloadFile: () => { reloads++; } },
    addGroupSettings(options) { group = options; options.mount(document.createElement('div')); } });
  const inputs = created.filter(el => el.tagName === 'input'); assert.equal(inputs.length, 1);
  const input = inputs[0]; assert.equal(input.type, 'number'); assert.equal(input.value, '100');
  assert.equal(group.group, 'file-loading'); assert.equal(group.label.ru, 'Загрузка файлов');
  assert.match(group.description.ru, /0 — всегда прогрессивная/);
  assert.match(group.description.ru, /ненулевой порог не учитывается/);
  input.value = '-1'; input.onchange(); assert.equal(loader.options.memoryLimitMB, 100); assert.equal(reloads, 0); assert.ok(input.validationMessage);
  input.value = '0'; input.onchange(); assert.equal(loader.options.memoryLimitMB, 0); assert.equal(reloads, 1); assert.equal(input.validationMessage, '');
  input.onchange(); assert.equal(reloads, 1);
  B.i18n.setLanguage('language-ru'); assert.ok(created.some(el => el.textContent === 'Загружать файлы до '));
});

test('a progressive-only format ignores a positive threshold even for a small file', async () => {
  const { B, loader } = setup(); let received;
  const source = { name: 'single-mode', size: 1, read() { throw new Error('No eager read'); } };
  const reader = B.register({ kind: 'interpreter', id: 'progressive-only', loadingModes: ['progressive'], test: () => true,
    open(meta) { received = meta; return {}; } });
  assert.equal(loader.select({ source }), reader);
  await loader.open(reader, { source });
  assert.equal(received.source, source); assert.equal(received.loadingMode, 'progressive');
});
