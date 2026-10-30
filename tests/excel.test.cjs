const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const X = require('../modules/vendor/sheetjs-0.20.3/xlsx.full.min.js');
const root = path.join(__dirname, '..');
const json = value => JSON.parse(JSON.stringify(value));
function setup({ lazy = false, load } = {}) {
  const scripts = [];
  const context = vm.createContext({ console, URL, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView,
    DOMException, AbortController, setTimeout, clearTimeout, Blob,
    document: { baseURI: 'file:///app/index.html', createElement: () => ({ remove() {} }),
      head: { appendChild(script) { scripts.push(script); load?.(script, context); } } } });
  context.window = context;
  if (!lazy) context.XLSX = X;
  for (const file of ['core/bouquet.js', 'core/i18n.js', 'core/sources.js', 'modules/search.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  // Exercise the same one-file registration mechanism as Settings -> Load plugin.
  context.Bouquet.exec(fs.readFileSync(path.join(root, 'modules/excel.js'), 'utf8'), 'excel.js');
  return { context, scripts, B: context.Bouquet, plugin: context.Bouquet.interpreters.find(p => p.id === 'excel') };
}
function fixture(bookType) {
  const book = X.utils.book_new();
  const data = [['Название', 'Цена', 'Дата', 'Итог', 'Да/нет'], ['Роза', 2.5, 45293, 6, true]];
  const sheet = X.utils.aoa_to_sheet(data);
  sheet.B2.z = '0.00'; sheet.C2.z = 'yyyy-mm-dd'; sheet.D2.f = 'B2*2';
  X.utils.book_append_sheet(book, sheet, 'Цветы');
  X.utils.book_append_sheet(book, { C5: { t: 's', v: 'Начало в C5' }, E7: { t: 's', v: 'Конец в E7' }, '!ref': 'C5:E7' }, 'Смещение');
  X.utils.book_append_sheet(book, {}, 'Пустой');
  book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };
  return X.write(book, { type: 'buffer', bookType });
}
for (const [extension, bookType] of [['xlsx', 'xlsx'], ['xls', 'biff8']]) {
  test(`${extension}: all sheets, Cyrillic, first row, formatted values, offsets and empty sheets`, async () => {
    const { plugin } = setup();
    assert.equal(plugin.test({ ext: extension }), true);
    assert.equal(plugin.test({ ext: 'csv' }), false);
    const db = await plugin.parse({ buffer: fixture(bookType), name: 'flowers.' + extension });
    assert.deepEqual(json(db.tables.map(t => t.name)), ['Цветы', 'Смещение', 'Пустой']);
    assert.deepEqual(json(db.tables[0].columns), ['A', 'B', 'C', 'D', 'E']);
    const first = await db.tables[0].read();
    assert.deepEqual(json(first.rows[0]), { n: 1, cells: ['Название', 'Цена', 'Дата', 'Итог', 'Да/нет'] });
    assert.deepEqual(json(first.rows[1].cells), ['Роза', '2.50', '2024-01-02', '6', 'TRUE']);
    assert.equal(first.total, 2);
    assert.equal(first.scanned, 2);
    assert.deepEqual(json(db.tables[1].columns), ['C', 'D', 'E']);
    const offset = await db.tables[1].read();
    assert.equal(offset.scanned, 3); // Relative to the sheet range, not Excel row 7.
    assert.deepEqual(json(offset.rows), [{ n: 5, cells: ['Начало в C5', '', ''] }, { n: 6, cells: ['', '', ''] }, { n: 7, cells: ['', '', 'Конец в E7'] }]);
    assert.deepEqual(json((await db.tables[2].read()).rows), []);
    db.close();
    await assert.rejects(db.tables[0].read(), { name: 'AbortError' });
  });
}
test('Excel pagination and column search preserve row numbers and avoid an empty final page', async () => {
  const { plugin, B } = setup();
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet(Array.from({ length: 240 }, (_, i) => ['Роза ' + i, i])), 'Данные');
  const db = await plugin.parse({ buffer: X.write(book, { type: 'buffer', bookType: 'xlsx' }), name: 'many.xlsx' });
  const table = db.tables[0];
  const first = await table.read({ limit: 100 });
  const second = await table.read({ limit: 100, cursor: first.nextCursor });
  const last = await table.read({ limit: 100, cursor: second.nextCursor });
  assert.equal(first.hasMore, true); assert.equal(second.rows[0].n, 101);
  assert.equal(last.rows.length, 40); assert.equal(last.hasMore, false);
  const match = B.features.search.compile(table, 'B:239');
  const filtered = await table.read({ limit: 1, match });
  assert.equal(filtered.rows[0].n, 240); assert.equal(filtered.hasMore, false);
  assert.equal(filtered.total, 240);
  const controller = new AbortController(); let progressed = false;
  await assert.rejects(table.read({ match: () => false, signal: controller.signal,
    onProgress() { progressed = true; controller.abort(); } }), { name: 'AbortError' });
  assert.equal(progressed, true);
});
test('an XLSX formula without a cached result is displayed as a formula, not evaluated', async () => {
  const { plugin } = setup();
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, { A1: { t: 'n', f: 'SUM(B1:C1)' }, '!ref': 'A1' }, 'Formula');
  const db = await plugin.parse({ buffer: X.write(book, { type: 'buffer', bookType: 'xlsx' }), name: 'formula.xlsx' });
  assert.equal((await db.tables[0].read()).rows[0].cells[0], '=SUM(B1:C1)');
});
test('local reader loads once, supports simultaneous opens, and can retry after a missing dependency', async () => {
  const { plugin, scripts, context } = setup({ lazy: true });
  const buffer = fixture('xlsx');
  const first = plugin.parse({ buffer, name: 'one.xlsx' });
  const second = plugin.parse({ buffer, name: 'two.xlsx' });
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'file:///app/modules/vendor/sheetjs-0.20.3/xlsx.full.min.js');
  scripts[0].onerror();
  await assert.rejects(first, /SheetJS/); await assert.rejects(second, /SheetJS/);
  const retried = plugin.parse({ buffer, name: 'three.xlsx' });
  context.XLSX = X; scripts[1].onload();
  assert.equal((await retried).tables.length, 3);
  assert.equal(scripts.length, 2);
});
test('aborting while the reader is loading stops the open without invalidating the shared reader', async () => {
  const { plugin, scripts, context } = setup({ lazy: true });
  const controller = new AbortController();
  const pending = plugin.parse({ buffer: fixture('xlsx'), name: 'cancelled.xlsx', signal: controller.signal });
  controller.abort(); context.XLSX = X; scripts[0].onload();
  await assert.rejects(pending, { name: 'AbortError' });
  const db = await plugin.parse({ buffer: fixture('biff8'), name: 'later.xls' });
  assert.equal(db.tables.length, 3); assert.equal(scripts.length, 1);
});
test('corrupt ZIP spreadsheet reports a parse error', async () => {
  const { plugin } = setup();
  await assert.rejects(plugin.parse({ buffer: Uint8Array.from([80, 75, 3, 4, 0, 0]), name: 'broken.xlsx' }));
});
