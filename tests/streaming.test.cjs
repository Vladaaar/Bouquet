const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup() {
  const context = vm.createContext({ console, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, DOMException, AbortController, setTimeout });
  context.window = context;
  for (const file of ['core/bouquet.js', 'core/i18n.js', 'core/sources.js', 'modules/file_loading.js', 'modules/csv.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return context.Bouquet;
}
function source(bytes) {
  const reads = [];
  return { name: 'fixture', size: bytes.length, reads,
    async read(offset, length, { signal } = {}) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      reads.push([offset, length]); return bytes.subarray(offset, offset + length);
    } };
}
function encoded(text, encoding) {
  if (encoding === 'utf8') return Buffer.from(text);
  if (encoding === 'utf8bom') return Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)]);
  const bytes = Buffer.from(text, 'utf16le');
  if (encoding === 'utf16be') bytes.swap16();
  return Buffer.concat([Buffer.from(encoding === 'utf16be' ? [254, 255] : [255, 254]), bytes]);
}
async function collect(table, limit = 2, match) {
  const rows = []; let cursor, result;
  do {
    result = await table.read({ cursor, limit, match }); rows.push(...result.rows); cursor = result.nextCursor;
    assert.ok(rows.length < 100000, 'Cursors must advance');
  } while (result.hasMore);
  return { rows, result };
}
const json = value => JSON.parse(JSON.stringify(value));
for (const encoding of ['utf8', 'utf8bom', 'utf16le', 'utf16be']) {
  test('text streaming preserves Unicode, CR/LF, trailing lines, byte cursors: ' + encoding, async () => {
    const B = setup(), reader = B.interpreters.find(p => p.id === 'core-text');
    const text = 'Начало🙂\r\n' + 'a'.repeat(65510) + '🪻\n\uFEFFстрока\rпоследняя\n';
    const raw = source(encoded(text, encoding)), db = await reader.open({ source: raw, name: 'text' });
    const first = await db.tables[0].read({ limit: 2 });
    const second = await db.tables[0].read({ cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(json((await db.tables[0].read({ cursor: first.nextCursor, limit: 2 })).rows), json(second.rows));
    const all = await collect(db.tables[0]);
    assert.deepEqual(json(all.rows.map(r => r.cells[0])), text.replace(/\r\n?/g, '\n').split('\n'));
    assert.deepEqual(json(all.rows.map(r => r.n)), [1, 2, 3, 4, 5]);
    const filtered = await collect(db.tables[0], 1, cells => cells[0].includes('строка'));
    assert.equal(filtered.rows[0].n, 3);
    db.close(); await assert.rejects(db.tables[0].read(), { name: 'AbortError' });
  });
  test('CSV streaming handles escaped quotes, multiline fields, blank tails and wider rows: ' + encoding, async () => {
    const B = setup(), reader = B.interpreters.find(p => p.id === 'csv');
    const text = 'имя,значение\r\n"a""b","строка\r\nвнутри"\r\n' + 'x'.repeat(65500) + ',"🙂"\n,,\nlast,value,extra\n,,\n\n';
    const bytes = encoded(text, encoding), old = reader.parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name: 'data.csv', ext: 'csv' });
    const db = await reader.open({ source: source(bytes), name: 'data.csv', ext: 'csv' });
    const all = await collect(db.tables[0], 1);
    const width = db.tables[0].columns.length;
    const canonical = all.rows.map(row => Array.from({ length: width }, (_, i) => row.cells[i] ?? ''));
    assert.deepEqual(json(canonical), json(old.tables[0].rows));
    assert.deepEqual(json(db.tables[0].columns), json(old.tables[0].columns));
    assert.equal(all.result.total, 4);
    db.close(); await assert.rejects(db.tables[0].read(), { name: 'AbortError' });
  });
}
test('large text and CSV return their first page without materializing the remaining file', async () => {
  const B = setup(), loader = B.features['file-loading']; loader.setMemoryLimitMB(0);
  for (const [name, text] of [['data.txt', 'ordinary line\n'.repeat(100000)], ['data.csv', 'name,value\n' + 'row,42\n'.repeat(200000)]]) {
    const raw = source(Buffer.from(text)), meta = { source: raw, name, ext: name.split('.').at(-1) };
    const db = await loader.open(loader.select(meta), meta);
    const first = await db.tables[0].read({ limit: 10 });
    assert.equal(first.rows.length, 10); assert.equal(first.hasMore, true);
    assert.ok(raw.reads.reduce((sum, r) => sum + r[1], 0) < raw.size / 4);
    assert.ok(raw.reads.every(([, length]) => length <= 65536)); db.close();
  }
});
test('CSV keeps interior blanks, drops arbitrary blank tails, handles header-only/empty files and filtering', async () => {
  const B = setup(), csv = B.interpreters.find(p => p.id === 'csv');
  for (const text of ['', '\n\n', '""', 'a,b', 'a,b\n', '\na,b\n', 'a,b\n1,2\n' + ',\n'.repeat(400) + '3,4\n' + ',\n'.repeat(300)]) {
    const bytes = Buffer.from(text), old = csv.parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name: 'x.csv', ext: 'csv' });
    const db = await csv.open({ source: source(bytes), name: 'x.csv', ext: 'csv' });
    assert.equal(db.tables.length, old.tables.length);
    if (db.tables.length) {
      const all = await collect(db.tables[0], 17);
      assert.deepEqual(json(all.rows.map(r => r.cells)), json(old.tables[0].rows));
      const filtered = await collect(db.tables[0], 1, cells => cells[0] === '3');
      assert.equal(filtered.rows.length, old.tables[0].rows.filter(cells => cells[0] === '3').length);
    }
    db.close?.();
  }
});
test('streaming readers yield progress, abort searches and reject invalid limits', async () => {
  const B = setup();
  for (const [id, text] of [['core-text', 'line\n'.repeat(1000)], ['csv', 'a,b\n' + 'one,two\n'.repeat(1000)]]) {
    const reader = B.interpreters.find(p => p.id === id), db = await reader.open({ source: source(Buffer.from(text)), name: 'fixture', ext: 'csv' });
    const controller = new AbortController(); let progress = false;
    await assert.rejects(db.tables[0].read({ match: () => false, signal: controller.signal, onProgress() { progress = true; controller.abort(); } }), { name: 'AbortError' });
    assert.equal(progress, true); await assert.rejects(db.tables[0].read({ limit: 0 })); db.close();
  }
});

test('TSV quoted escapes and CRLF survive exact byte-block boundaries', async () => {
  const B = setup(), csv = B.interpreters.find(p => p.id === 'csv');
  for (const delimiter of [',', '\t']) for (const boundary of [65534, 65535, 65536, 65537]) {
    const header = 'a' + delimiter + 'b\n';
    const text = header + '"' + 'x'.repeat(boundary - header.length - 1) + '""\r\ny"' + delimiter + 'z\r\nlast' + delimiter + 'row\r\n';
    const bytes = Buffer.from(text), ext = delimiter === '\t' ? 'tsv' : 'csv';
    const old = csv.parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name: 'x', ext });
    const db = await csv.open({ source: source(bytes), name: 'x', ext });
    assert.deepEqual(json((await collect(db.tables[0], 1)).rows.map(r => r.cells)), json(old.tables[0].rows)); db.close();
  }
});

test('generated CSV pages and searches agree with the full-parser reference', async () => {
  const B = setup(), csv = B.interpreters.find(p => p.id === 'csv');
  let seed = 731;
  const pick = values => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return values[seed % values.length]; };
  const field = value => '"' + value.replace(/"/g, '""') + '"';
  for (let iteration = 0; iteration < 30; iteration++) {
    const text = 'a,b,c\n' + Array.from({ length: 30 }, () => Array.from({ length: pick([1,2,3,4]) }, () => field(pick(['', 'x', '🙂', 'a,b', 'a"b', 'a\nb']))).join(',')).join('\n');
    const bytes = Buffer.from(text), old = csv.parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name: 'x', ext: 'csv' });
    const db = await csv.open({ source: source(bytes), name: 'x', ext: 'csv' });
    for (const match of [undefined, cells => cells[0] === 'x']) {
      const all = await collect(db.tables[0], pick([1,2,7]), match);
      const actual = all.rows.map(r => Array.from({ length: old.tables[0].columns.length }, (_, i) => r.cells[i] ?? ''));
      assert.deepEqual(json(actual), json(old.tables[0].rows.filter(cells => !match || match(cells))));
    }
    db.close();
  }
});
