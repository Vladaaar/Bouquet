/* Bouquet · модуль csv — разбор CSV/TSV с кавычками и автоопределением разделителя */
(function () {
Bouquet.register({
  kind: 'interpreter',
  id: 'csv',
  name: 'CSV',
  priority: 20,

  test({ ext, bytes }) {
    if (['csv', 'tsv', 'tab'].includes(ext)) return true;
    if (ext && ext !== 'txt') return false;
    return Bouquet.util.isText(bytes) && /[,;\t]/.test(
      new TextDecoder().decode(bytes.subarray(0, 512))
    );
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
      columns.push(h || 'колонка ' + (i + 1));
    }
    rows.forEach(r => { while (r.length < width) r.push(''); });

    return {
      name,
      tables: [{
        name: name,
        columns,
        rows,
        note: 'разделитель «' + (delim === '\t' ? 'tab' : delim) + '»'
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
