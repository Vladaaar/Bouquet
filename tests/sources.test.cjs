const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
global.window = global;
for (const file of ['bouquet', 'i18n']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../core/' + file + '.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../core/sources.js'), 'utf8'));
const U = Bouquet.util;
test('Blob source reads only the requested slice and honours cancellation', async () => {
  const source = U.blobSource(new Blob(['abcdef']));
  assert.equal(new TextDecoder().decode(await source.read(2, 3)), 'cde');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(source.read(0, 2, { signal: controller.signal }), { name: 'AbortError' });
});
test('HTTP Range, initial cache, fallback and changed-file rejection', async () => {
  const original = global.fetch;
  const data = Uint8Array.from({ length: 10000 }, (_, i) => i % 251);
  let requests = 0, changed = false;
  try {
    global.fetch = async (_, options) => {
      requests++;
      if (changed) return new Response(data);
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
      return new Response(data.slice(start, end + 1), { status: 206, headers: {
        'Content-Range': `bytes ${start}-${end}/${data.length}`, ETag: '"v1"'
      } });
    };
    const source = await U.urlSource('data/test.db');
    assert.equal(source.size, data.length);
    assert.deepEqual(await source.read(10, 100), data.slice(10, 110));
    assert.equal(requests, 1);
    assert.deepEqual(await source.read(4096, 512), data.slice(4096, 4608));
    assert.equal(requests, 2);
    changed = true;
    await assert.rejects(source.read(8192, 512), /изменился/);
    const fallback = await U.urlSource('data/test.db');
    assert.match(fallback.note, /целиком/);
    assert.deepEqual(await fallback.read(4096, 512), data.slice(4096, 4608));
  } finally { global.fetch = original; }
});
