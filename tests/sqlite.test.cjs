const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
global.window = global;
for (const f of ['core/bouquet.js', 'core/i18n.js', 'core/sources.js', 'modules/sqlite.js', 'modules/sqlite_full_load.js', 'modules/search.js', 'modules/csv.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
}
const sqlite = Bouquet.interpreters.find(m => m.id === 'sqlite');
const search = Bouquet.features.search;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bouquet-test-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const fixture = path.join(dir, 'fixture.db');
execFileSync('python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute('pragma page_size=512')
c.execute('create table items(id INTEGER PRIMARY KEY, Имя text, body text, value real, raw blob)')
c.executemany('insert into items values(?,?,?,?,?)', [(i, 'Цветок '+str(i), ('needle ' if i%7==0 else '')+('x'*2000 if i==42 else 'short'), i/2, b'abc') for i in range(1,1501)])
c.execute('create table empty(a text)')
c.execute('create table keyed(id text primary key, value text) without rowid')
c.executemany('insert into keyed values(?,?)', [(str(i).zfill(4), 'value'+str(i)) for i in range(300)])
c.execute('create table "strange (table)" ("first name" text, "key" text, other integer, primary key("key", other)) without rowid')
c.executemany('insert into "strange (table)" values(?,?,?)', [('A','b',2),('B','a',1)])
c.execute('create table aliases(id INTEGER NOT NULL, name text, primary key(id))')
c.executemany('insert into aliases values(?,?)', [(-5,'negative'),(9007199254740993,'big')])
c.commit()
`, fixture]);
async function tracked(file) {
  const handle = await fs.promises.open(file);
  const stats = { bytes: 0, calls: 0 };
  return { stats, size: (await handle.stat()).size,
    async read(offset, length, { signal } = {}) {
      Bouquet.util.checkAbort(signal);
      const bytes = Buffer.alloc(length);
      const result = await handle.read(bytes, 0, length, offset);
      stats.bytes += result.bytesRead; stats.calls++;
      return bytes.subarray(0, result.bytesRead);
    }, close: () => handle.close() };
}
async function withDB(file, action) {
  const source = await tracked(file);
  let db;
  try { db = await sqlite.open({ source, name: file }); await action(db, source); }
  finally { db?.close(); await source.close(); }
}
test('lazy schema, ordered cursor traversal, overflow, rowid and empty tables', async () => {
  await withDB(fixture, async (db, source) => {
    assert.ok(source.stats.bytes < source.size / 10);
    const t = db.tables[0];
    assert.deepEqual(t.columns, ['id', 'Имя', 'body', 'value', 'raw']);
    let token = null, rows = [], result;
    do { result = await t.read({ cursor: token, limit: 37 }); rows.push(...result.rows); token = result.nextCursor; } while (result.hasMore);
    assert.equal(rows.length, 1500);
    assert.equal(result.total, 1500);
    for (let i = 0; i < rows.length; i++) { assert.equal(rows[i].n, i + 1); assert.equal(rows[i].cells[0], i + 1); }
    assert.equal(rows[41].cells[2], 'needle ' + 'x'.repeat(2000));
    assert.equal(rows[0].cells[4], '‹blob 3 Б›');
    assert.deepEqual((await db.tables[1].read()).rows, []);
    const first = await t.read({ limit: 37 });
    const second = await t.read({ cursor: first.nextCursor, limit: 37 });
    assert.deepEqual((await t.read({ cursor: first.nextCursor, limit: 37 })).rows, second.rows);
    assert.equal(first.nextCursor.n, 37); // read never mutates caller's cursor
  });
});
test('search syntax, pagination, cancellation and event loop yields', async () => {
  await withDB(fixture, async db => {
    const t = db.tables[0];
    const match = search.compile(t, 'body:needle -body:xxx');
    const expected = search.filter({ columns: t.columns, rows: [['', 'Цветок 7', 'needle'], ['', 'other', 'no']] }, 'body:needle');
    assert.deepEqual(expected, [0]);
    assert.equal(match([1, 'Цветок 7', 'needle']), true);
    let token, count = 0, result;
    do { result = await t.read({ cursor: token, limit: 23, match }); count += result.rows.length; token = result.nextCursor; } while (result.hasMore);
    assert.equal(count, 213);
    const controller = new AbortController(); let progressed = false;
    setTimeout(() => { progressed = true; controller.abort(); }, 0);
    await assert.rejects(t.read({ match: () => false, signal: controller.signal }), { name: 'AbortError' });
    assert.ok(progressed);
    const noMatches = await t.read({ match: search.compile(t, '"absent phrase"') });
    assert.equal(noMatches.hasMore, false); assert.equal(noMatches.rows.length, 0);
  });
});
test('WITHOUT ROWID index interior records are visited once', async () => {
  await withDB(fixture, async db => {
    const t = db.tables[2]; let token, rows = [], result;
    do { result = await t.read({ cursor: token, limit: 31 }); rows.push(...result.rows); token = result.nextCursor; } while (result.hasMore);
    assert.equal(rows.length, 300);
    assert.deepEqual(rows.map(r => r.cells[0]), Array.from({ length: 300 }, (_, i) => String(i).padStart(4, '0')));
    db.close(); await assert.rejects(t.read(), { name: 'AbortError' });
  });
});
test('CSV retains the array API', async () => {
  const csv = Bouquet.interpreters.find(m => m.id === 'csv');
  const result = csv.parse({ buffer: new TextEncoder().encode('name,value\na,1\nb,2').buffer, name: 'sample.csv', ext: 'csv' });
  assert.deepEqual(result.tables[0].rows, [['a', '1'], ['b', '2']]);
});
const large = path.join(__dirname, '../data/new1_Chel2006.sqlite3');
test('large local database opens lazily and first/next pages have the expected shape', { skip: !fs.existsSync(large) }, async () => {
  await withDB(large, async (db, source) => {
    assert.deepEqual(db.tables.map(t => t.columns.length), [12, 7, 4]);
    assert.ok(source.stats.bytes < 65536);
    for (const t of db.tables.slice(0, 2)) {
      const first = await t.read();
      const second = await t.read({ cursor: first.nextCursor });
      assert.equal(first.rows.length, 100); assert.equal(second.rows.length, 100);
      assert.equal(second.rows[0].n, 101);
    }
    assert.ok(source.stats.bytes < 1024 * 1024);
  });
});

test('quoted table names and composite WITHOUT ROWID storage order', async () => {
  await withDB(fixture, async db => {
    const t = db.tables[3];
    assert.deepEqual(t.columns, ['first name', 'key', 'other']);
    assert.deepEqual((await t.read()).rows.map(r => r.cells), [['B', 'a', 1], ['A', 'b', 2]]);
  });
});
test('full large database traversal has no missing or duplicated rows', { skip: !fs.existsSync(large) }, async () => {
  await withDB(large, async db => {
    const counts = [];
    for (const t of db.tables) {
      let token, count = 0, result;
      do {
        result = await t.read({ cursor: token, limit: 1000 });
        for (const row of result.rows) assert.equal(row.n, ++count);
        token = result.nextCursor;
      } while (result.hasMore);
      assert.equal(result.total, count);
      counts.push(count);
    }
    assert.deepEqual(counts, [205907, 205727, 3]);
  });
});

test('table-level INTEGER PRIMARY KEY, negative and large rowids', async () => {
  await withDB(fixture, async db => {
    assert.deepEqual((await db.tables[4].read()).rows.map(r => r.cells), [[-5, 'negative'], ['9007199254740993', 'big']]);
  });
});

test('full-load module agrees with lazy reader on SQLite fixtures', async () => {
  const full = Bouquet.interpreters.find(m => m.id === 'sqlite-full');
  const bytes = fs.readFileSync(fixture);
  const memory = full.parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name: 'fixture' });
  await withDB(fixture, async db => {
    for (let i = 0; i < db.tables.length; i++) {
      assert.deepEqual(memory.tables[i].columns, db.tables[i].columns);
      assert.deepEqual(memory.tables[i].rows, (await db.tables[i].read({ limit: 10000 })).rows.map(r => r.cells));
    }
  });
});
test('full-load module opens the 93 MiB database without argument overflow', { skip: !fs.existsSync(large) }, () => {
  const bytes = fs.readFileSync(large);
  const db = Bouquet.interpreters.find(m => m.id === 'sqlite-full').parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name: 'large' });
  assert.deepEqual(db.tables.map(t => t.rows.length), [205907, 205727, 3]);
  assert.deepEqual(db.tables.map(t => t.columns.length), [12, 7, 4]);
});

test('full-load regression: over 200,000 rows and parentheses in table name', () => {
  const file = path.join(dir, 'many-rows.db');
  execFileSync('python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute('create table "Records (test)" ("Системный номер" integer primary key, name text)')
c.executemany('insert into "Records (test)" values(?,?)', ((i,'record') for i in range(1,205908)))
c.commit()
`, file]);
  const bytes = fs.readFileSync(file);
  const db = Bouquet.interpreters.find(m => m.id === 'sqlite-full').parse({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name: 'many' });
  assert.equal(db.tables[0].rows.length, 205907);
  assert.deepEqual(db.tables[0].columns, ['Системный номер', 'name']);
  assert.equal(db.tables[0].rows.at(-1)[0], 205907);
});
