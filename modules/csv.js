/* Bouquet · модуль csv — разбор CSV/TSV с кавычками и автоопределением разделителя */
(function () {
Bouquet.register({
  kind: 'interpreter',
  id: 'csv',
  name: 'CSV',
  priority: 20,
  loadingModes: ['memory', 'progressive'],

  test({ ext, bytes }) {
    if (['csv', 'tsv', 'tab'].includes(ext)) return true;
    if (ext && ext !== 'txt') return false;
    return Bouquet.util.isText(bytes) && /[,;\t]/.test(
      new TextDecoder().decode(bytes.subarray(0, 512))
    );
  },

  async open({ source, name, ext, signal }) {
    const U = Bouquet.util, stream = await U.textSource(source, signal);
    const delim = ext === 'tsv' || ext === 'tab' ? '\t' : sniff(await stream.sample(signal));
    const decode = record => parse(record.text, delim)[0] || [''];
    const header = (await stream.records(stream.start, delim, signal).next()).value;
    const names = decode(header), blank = cells => cells.every(value => value === '');
    if (blank(names)) {
      let found = false, seen = 0;
      if (!header.eof) for await (const record of stream.records(header.next, delim, signal)) {
        if (!blank(decode(record))) { found = true; break; }
        if (++seen % 128 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); U.checkAbort(signal); }
      }
      if (!found) { stream.close(); return { name, tables: [] }; }
    }
    const columns = [], columnKeys = [];
    function widen(width) {
      while (columns.length < width) {
        const i = columns.length, value = (names[i] || '').trim();
        columns.push(value || Bouquet.i18n.t('data.column', { index: i + 1 })); columnKeys.push(value ? null : 'data.column');
      }
    }
    widen(names.length);
    let closed = false, knownNonemptyOffset = -1, lastDataNumber = 0;
    return { name, tables: [{ name, columns, columnKeys, noteKey: 'delimiter', noteParams: { value: delim === '\t' ? 'tab' : delim },
      get note() { return Bouquet.i18n.t('delimiter', this.noteParams); },
      async read({ cursor, limit = 100, match, signal, onProgress } = {}) {
        U.checkAbort(signal); if (closed) throw new DOMException(Bouquet.i18n.t('Источник закрыт'), 'AbortError');
        if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw Bouquet.i18n.error('размер порции должен быть от 1 до 10000');
        const rows = [], pending = []; let n = cursor?.n || 1, pendingWidth = 0;
        const result = (hasMore, nextCursor = null, scanned = n - 1) => {
          for (const row of rows) while (row.cells.length < columns.length) row.cells.push('');
          return { rows, hasMore, nextCursor, scanned, ...(hasMore ? {} : { total: lastDataNumber }) };
        };
        const take = row => {
          widen(row.cells.length);
          if (rows.length === limit) return result(true, { offset: row.offset, n: row.n }, row.n - 1);
          rows.push({ n: row.n, cells: row.cells });
        };
        if (header.eof) return result(false, null, 0);
        for await (const record of stream.records(cursor?.offset ?? header.next, delim, signal)) {
          const cells = decode(record), empty = blank(cells), row = { cells, n, offset: record.start };
          if (empty && record.start >= knownNonemptyOffset) {
            // Keep only a page of potential interior blanks, not an unbounded tail.
            pendingWidth = Math.max(pendingWidth, cells.length);
            if (pending.length <= limit - rows.length && (!match || match(cells))) pending.push(row);
          } else {
            if (!empty) {
              knownNonemptyOffset = Math.max(knownNonemptyOffset, record.start); lastDataNumber = Math.max(lastDataNumber, n);
              if (pendingWidth) widen(pendingWidth);
              for (const waiting of pending) { const done = take(waiting); if (done) return done; }
              pending.length = 0; pendingWidth = 0;
            }
            widen(cells.length);
            if (!match || match(cells)) { const done = take(row); if (done) return done; }
          }
          if (n++ % 128 === 0) {
            onProgress?.({ scanned: pending[0]?.n ? pending[0].n - 1 : n - 1, found: rows.length, rows: rows.slice() });
            await new Promise(resolve => setTimeout(resolve, 0)); U.checkAbort(signal);
          }
        }
        return result(false);
      }
    }], close() { closed = true; stream.close(); } };
  },

  parse({ buffer, name, ext }) {
    const text = Bouquet.util.decode(buffer).replace(/\r\n?/g, '\n');
    const delim = ext === 'tsv' || ext === 'tab' ? '\t' : sniff(text);
    const rows = parse(text, delim);
    while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop();
    if (!rows.length) return { name, tables: [] };

    const header = rows.shift();
    const width = rows.reduce((m, r) => Math.max(m, r.length), header.length);
    const columns = [];
    for (let i = 0; i < width; i++) {
      const h = (header[i] || '').trim();
      columns.push(h || Bouquet.i18n.t('data.column', { index: i + 1 }));
    }
    rows.forEach(r => { while (r.length < width) r.push(''); });

    return {
      name,
      tables: [{
        name: name,
        columns, columnKeys: columns.map((_, i) => (header[i] || '').trim() ? null : 'data.column'),
        rows, noteKey: 'delimiter', noteParams: { value: delim === '\t' ? 'tab' : delim },
        get note() { return Bouquet.i18n.t('delimiter', { value: delim === '\t' ? 'tab' : delim }); }
      }]
    };
  }
});

/* разделитель = тот, что чаще всего встречается вне кавычек в первых строках */
function sniff(text) {
  const sample = text.split('\n').slice(0, 5).join('\n');
  const best = [',', ';', '\t', '|'].map(d => {
    let n = 0, quoted = false;
    for (let i = 0; i < sample.length; i++) {
      const c = sample[i];
      if (c === '"') quoted = !quoted;
      else if (c === d && !quoted) n++;
    }
    return { d, n };
  }).sort((a, b) => b.n - a.n)[0];
  return best.n ? best.d : ',';
}

/* RFC 4180: кавычки, "" внутри поля, переносы строк внутри поля */
function parse(text, d) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') { quoted = true; continue; }
    if (c === d) { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
})();
