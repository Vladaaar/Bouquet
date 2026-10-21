const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
function setup() {
  const ctx = vm.createContext({ console, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView,
    DOMException, AbortController, setTimeout, clearTimeout });
  ctx.window = ctx;
  for (const file of ['core/bouquet.js', 'core/sources.js', 'modules/sqlite.js', 'modules/sqlite_full_load.js', 'modules/links.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
  }
  return ctx.Bouquet;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bouquet-links-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, 'links.db');
execFileSync('python3', ['-c', `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript('''
CREATE TABLE parents(id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE children(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents, note TEXT DEFAULT 'REFERENCES fake(id)');
CREATE TABLE "key (parent)" ("a key" TEXT COLLATE NOCASE, b INTEGER, label TEXT, PRIMARY KEY("a key", b)) WITHOUT ROWID;
CREATE TABLE pair_child(a TEXT, b INTEGER, CONSTRAINT "a ref" FOREIGN KEY(a,b) REFERENCES "key (parent)");
CREATE TABLE text_parent(id TEXT PRIMARY KEY);
CREATE TABLE text_child(id TEXT REFERENCES text_parent(id));
CREATE TABLE self_ref(id INTEGER PRIMARY KEY, parent INTEGER REFERENCES self_ref(id));
INSERT INTO parents VALUES(1, '<script>alert(1)</script>'),(2, 'Other');
INSERT INTO "key (parent)" VALUES('ABC', 2, 'Compound');
INSERT INTO pair_child VALUES('abc',2),('abc',3), (NULL,2);
INSERT INTO text_parent VALUES('');
INSERT INTO text_child VALUES(''),(NULL);
INSERT INTO self_ref VALUES(1,NULL),(2,1);
''')
c.executemany('INSERT INTO children VALUES(?,?,?)', [(i,1,'child '+str(i)) for i in range(1,131)])
c.execute('INSERT INTO children VALUES(131,999,?)', ('orphan',))
c.commit()
`, file]);
async function database(B, mode) {
  const buffer = fs.readFileSync(file);
  const source = B.util.blobSource(new Blob([buffer]), 'links.db');
  if (mode === 'progressive') return B.interpreters.find(p => p.id === 'sqlite').open({ source, name: 'links.db' });
  return B.interpreters.find(p => p.id === 'sqlite-full').parse({ buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), name: 'links.db' });
}
for (const mode of ['memory', 'progressive']) test(`declared links in ${mode}: forward, reverse, compound, null, orphan and pagination`, async () => {
  const B = setup(), links = B.features.links, db = await database(B, mode);
  const table = name => db.tables.find(t => t.name === name);
  assert.ok(table('children').schemaSQL.includes('REFERENCES'));
  assert.equal(links.relations(db).length, 4);
  const outgoing = links.neighbors(db, table('children'), [1, 1, 'child'], 1);
  assert.equal(outgoing.length, 1);
  const parent = await links.read(outgoing[0]);
  assert.equal(parent.rows[0].cells[1], '<script>alert(1)</script>');
  const incoming = links.neighbors(db, table('parents'), [1, 'Parent'], 0)[0];
  let cursor = null, all = [], result;
  do { result = await links.read(incoming, { cursor }); all.push(...result.rows); cursor = result.nextCursor; } while (result.hasMore);
  assert.equal(all.length, 130);
  assert.equal(new Set(all.map(r => r.cells[0])).size, 130);
  const compound = links.neighbors(db, table('pair_child'), ['abc', 2], 0)[0];
  assert.equal((await links.read(compound)).rows[0].cells[2], 'Compound');
  const reverseCompound = links.neighbors(db, table('key (parent)'), ['ABC', 2, 'Compound'], 1)[0];
  assert.equal((await links.read(reverseCompound)).rows.length, 1);
  assert.equal(links.neighbors(db, table('pair_child'), [null, 2], 1).length, 0);
  const empty = links.neighbors(db, table('text_parent'), [''], 0)[0];
  assert.equal((await links.read(empty)).rows.length, 1); // SQL NULL must not equal empty text.
  const orphan = links.neighbors(db, table('children'), [131, 999, 'orphan'], 1)[0];
  assert.equal((await links.read(orphan)).rows.length, 0);
  assert.equal(links.neighbors(db, table('parents'), [1, 'name'], 1).length, 0);
  assert.equal(links.neighbors(db, table('self_ref'), [1, null], 0).length, 1);
  db.close?.();
});
test('schema parser ignores quoted keywords, expressions and comments; respects explicit target columns', () => {
  const B = setup(), links = B.features.links;
  const sql = `CREATE TABLE "odd(table)" (
    "REFERENCES" TEXT DEFAULT 'REFERENCES missing(id)',
    a INTEGER CHECK(a IN (1,2)), b TEXT,
    -- REFERENCES nope(id)
    CONSTRAINT "foreign key" FOREIGN KEY(a,b) REFERENCES "target, table"("key one", "key two")
  )`;
  const parsed = links.schema(sql);
  assert.equal(parsed.foreign.length, 1);
  assert.equal(parsed.foreign[0].table, 'target, table');
  assert.equal(parsed.foreign[0].target.join('|'), 'key one|key two');
  assert.equal(parsed.foreign[0].source.join('|'), 'a|b');
  assert.equal(links.relations({ tables: [{ name: 'ordinary', columns: ['user_id'], rows: [[1]] }] }).length, 0);
});
test('lookup yields and can be cancelled without touching main-table cursors', async () => {
  const B = setup(), links = B.features.links;
  const controller = new AbortController();
  const link = { table: { rows: Array.from({ length: 10000 }, (_, n) => [n]) },
    columns: [0], values: [-1], comparison: [{}] };
  await assert.rejects(links.read(link, { signal: controller.signal, onProgress: () => controller.abort() }), { name: 'AbortError' });
  const db = await database(B, 'progressive');
  const children = db.tables.find(t => t.name === 'children');
  const first = await children.read({ limit: 2 });
  const parent = db.tables.find(t => t.name === 'parents');
  await links.read(links.neighbors(db, parent, [1, 'Parent'], 0)[0]);
  const next = await children.read({ cursor: first.nextCursor, limit: 2 });
  assert.equal(next.rows[0].cells[0], 3);
  db.close();
});

// UI contract test: no browser dependency, rendering is verified as DOM nodes, not HTML.
test('cell icon opens safe record drawer; rerender and close abort stale reads', async () => {
  const B = setup(), links = B.features.links;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; this.attrs = {}; this.isConnected = true; }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.append(item); }
    prepend(item) { this.children.unshift(item); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(k,v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(name, cb) { this.events[name] = cb; }
    querySelector() { return null; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { this.focused = true; }
  }
  const root = new Element('main'), head = new Element('head');
  const cell = new Element('td'); cell.dataset = { bqRow: '1', bqColumn: '1' };
  const host = { querySelectorAll: () => [cell] };
  const parent = { name: 'p', columns: ['id', 'name'], schemaSQL: 'CREATE TABLE p(id INTEGER PRIMARY KEY, name TEXT)', rows: [[1, '<img onerror=evil()>']] };
  const child = { name: 'c', columns: ['id','parent'], schemaSQL: 'CREATE TABLE c(id INTEGER, parent INTEGER REFERENCES p)' };
  const ui = { root, activeTab: 'explorer', document: { head, createElement: tag => new Element(tag) },
    currentView: { host, view: { dataset: { tables: [parent, child] }, table: child, rows: [{ n: 1, cells: [2,1] }] } } };
  links.setup(ui);
  const button = cell.children[0];
  assert.equal(button.attrs['aria-haspopup'], 'dialog');
  let stopped = false;
  button.onclick({ stopPropagation() { stopped = true; } });
  await new Promise(resolve => setTimeout(resolve, 5));
  const drawer = root.children[0];
  let keyStopped = false; drawer.events.keydown({ stopPropagation() { keyStopped = true; } });
  assert.equal(keyStopped, true);
  assert.equal(stopped, true); assert.equal(drawer.open, true);
  const section = drawer.children[1], record = section.children[3].children[0];
  assert.equal(record.children[3].textContent, '<img onerror=evil()>');
  assert.equal(record.children[3].innerHTML, undefined);
  B.emit('view:reset'); assert.equal(drawer.open, false);
  let pendingSignal, release;
  parent.read = ({ signal }) => { pendingSignal = signal; return new Promise(resolve => { release = resolve; }); };
  button.onclick({ stopPropagation() {} });
  assert.equal(drawer.open, true);
  drawer.events.cancel({ preventDefault() {} });
  assert.equal(pendingSignal.aborted, true);
  release({ rows: [{ n: 1, cells: [1, 'stale'] }], hasMore: false });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(drawer.open, false);
});
