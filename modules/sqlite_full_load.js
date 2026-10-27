/* Bouquet · модуль sqlite — чтение файла SQLite 3 напрямую, без зависимостей и сети.
   Разбирает заголовок, b-дерево страниц, формат записи и страницы переполнения. */
(function () {
  const MAGIC = 'SQLite format 3\u0000';

  Bouquet.register({
    kind: 'interpreter',
    id: 'sqlite-full',
    format: 'sqlite', loadingMode: 'memory',
    name: 'SQLite',
    priority: 30,

    test({ ext, bytes }) {
      if (bytes && bytes.length > 16) {
        for (let i = 0; i < 16; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
        return true;
      }
      return ['db', 'sqlite', 'sqlite3', 'db3'].includes(ext);
    },

    parse({ buffer, name }) {
      return read(buffer, name);
    }
  });

  function read(buffer, name) {
    const b = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    for (let i = 0; i < 16; i++) {
      if (b[i] !== MAGIC.charCodeAt(i)) throw Bouquet.i18n.error('это не файл SQLite 3');
    }
    let pageSize = dv.getUint16(16);
    if (pageSize === 1) pageSize = 65536;
    const usable = pageSize - b[20];
    const enc = dv.getUint32(56) || 1;
    const decoder = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');

    const pageOffset = n => {
      const off = (n - 1) * pageSize;
      if (n < 1 || off + 1 > b.length) throw Bouquet.i18n.error('страница {page} за границей файла', { page: n });
      return off;
    };

    /* ---- varint ---- */
    function varint(p, o) {
      let v = 0n;
      for (let i = 0; i < 8; i++) {
        const byte = p[o + i];
        if (byte & 0x80) v = (v << 7n) | BigInt(byte & 0x7f);
        else return [(v << 7n) | BigInt(byte), i + 1];
      }
      return [(v << 8n) | BigInt(p[o + 8]), 9];
    }

    function readInt(p, o, len) {
      let v = 0n;
      for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(p[o + i]);
      const bits = BigInt(len * 8);
      if (v >> (bits - 1n)) v -= 1n << bits;               /* дополнительный код */
      return (v >= -9007199254740991n && v <= 9007199254740991n) ? Number(v) : v.toString();
    }

    /* ---- полезная нагрузка ячейки с учётом переполнения ---- */
    function payload(start, len, isTableLeaf) {
      const maxLocal = isTableLeaf ? usable - 35 : ((usable - 12) * 64 / 255 | 0) - 23;
      const minLocal = ((usable - 12) * 32 / 255 | 0) - 23;
      let local = len;
      if (len > maxLocal) {
        local = minLocal + ((len - minLocal) % (usable - 4));
        if (local > maxLocal) local = minLocal;
      }
      if (local === len) return b.subarray(start, start + len);

      const out = new Uint8Array(len);
      out.set(b.subarray(start, start + local), 0);
      let filled = local;
      let next = dv.getUint32(start + local);
      let guard = 0;
      while (next > 0 && filled < len && guard++ < 1e6) {
        const off = pageOffset(next);
        const take = Math.min(usable - 4, len - filled);
        out.set(b.subarray(off + 4, off + 4 + take), filled);
        filled += take;
        next = dv.getUint32(off);
      }
      return out;
    }

    /* ---- запись: заголовок с serial types + тело ---- */
    function record(p) {
      const [hsize, n] = varint(p, 0);
      const hs = Number(hsize);
      let ho = n, bo = hs;
      const vals = [];
      const SIZE = [0, 1, 2, 3, 4, 6, 8];
      while (ho < hs && bo <= p.length) {
        const [st, k] = varint(p, ho); ho += k;
        const t = Number(st);
        let v;
        if (t === 0) v = null;
        else if (t >= 1 && t <= 6) { v = readInt(p, bo, SIZE[t]); bo += SIZE[t]; }
        else if (t === 7) { v = new DataView(p.buffer, p.byteOffset + bo, 8).getFloat64(0); bo += 8; }
        else if (t === 8) v = 0;
        else if (t === 9) v = 1;
        else if (t >= 12 && t % 2 === 0) { const l = (t - 12) / 2; v = '‹blob ' + l + ' Б›'; bo += l; }
        else { const l = (t - 13) / 2; v = decoder.decode(p.subarray(bo, bo + l)); bo += l; }
        vals.push(v);
      }
      return vals;
    }

    /* ---- обход b-дерева ---- */
    function walk(pageNo, out, seen, limit) {
      if (out.length >= limit) return;
      if (seen.has(pageNo)) return;
      seen.add(pageNo);
      const off = pageOffset(pageNo);
      const hdr = pageNo === 1 ? 100 : 0;
      const type = b[off + hdr];
      const cells = dv.getUint16(off + hdr + 3);
      const interior = type === 2 || type === 5;
      const ptrs = off + hdr + (interior ? 12 : 8);

      for (let i = 0; i < cells; i++) {
        if (out.length >= limit) return;
        const cell = off + dv.getUint16(ptrs + i * 2);
        if (type === 13) {                                  /* лист таблицы */
          const [len, a] = varint(b, cell);
          const [rowid, c] = varint(b, cell + a);
          out.push({ rowid: safeRowid(rowid), values: record(payload(cell + a + c, Number(len), true)) });
        } else if (type === 5) {                            /* узел таблицы */
          walk(dv.getUint32(cell), out, seen, limit);
        } else if (type === 10) {                           /* лист индекса (WITHOUT ROWID) */
          const [len, a] = varint(b, cell);
          out.push({ rowid: null, values: record(payload(cell + a, Number(len), false)) });
        } else if (type === 2) {                            /* узел индекса */
          walk(dv.getUint32(cell), out, seen, limit);
          const [len, a] = varint(b, cell + 4);
          out.push({ rowid: null, values: record(payload(cell + 4 + a, Number(len), false)) });
        } else return;                                      /* неизвестный тип страницы */
      }
      if (interior) walk(dv.getUint32(off + hdr + 8), out, seen, limit);
    }

    function rowsOf(root, limit) {
      const out = [];
      walk(root, out, new Set(), limit ?? Infinity);
      return out;
    }

    /* ---- sqlite_master ---- */
    const master = rowsOf(1).map(r => ({
      type: r.values[0], name: r.values[1], tbl: r.values[2],
      root: Number(r.values[3]) || 0, sql: r.values[4] || ''
    }));

    const tables = [];
    for (const m of master) {
      if (m.type !== 'table' || !m.root) continue;
      if (/^sqlite_/.test(m.name)) continue;
      const spec = columnsOf(m.sql);
      const data = rowsOf(m.root);
      const width = data.reduce((width, row) => Math.max(width, row.values.length), Math.max(spec.names.length, 1));
      const columns = [];
      for (let i = 0; i < width; i++) columns.push(spec.names[i] || Bouquet.i18n.t('data.column', { index: i + 1 }));
      tables.push({
        name: m.name, schemaSQL: m.sql,
        columns,
        rows: data.map(r => {
          const v = spec.order ? spec.order.reduce((out, col, i) => { out[col] = r.values[i]; return out; }, []) : r.values.slice(0, width);
          while (v.length < width) v.push(null);
          if (spec.rowidCol >= 0 && v[spec.rowidCol] == null && r.rowid != null) v[spec.rowidCol] = r.rowid;
          return v;
        })
      });
    }

    const views = master.filter(m => m.type === 'view').map(m => m.name);
    if (!tables.length) {
      return {
        name,
        tables: [Bouquet.util.messageTable('databaseNoTables', { views: () => views.length ? '\n' + Bouquet.i18n.t('viewsUnsupported', { names: views.join(', ') }) : '' }, 'empty')]
      };
    }
    return { name, tables };
  }

  function safeRowid(value) {
    const signed = BigInt.asIntN(64, value);
    return signed >= -9007199254740991n && signed <= 9007199254740991n ? Number(signed) : signed.toString();
  }
  // Split SQL only outside quoted identifiers, strings and nested expressions.
  function splitSQL(text, delimiter) {
    const parts = []; let start = 0, depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) {
          if (text[i + 1] === quote) i++;
          else quote = null;
        }
        continue;
      }
      if ('"\'`['.includes(c)) { quote = c === '[' ? ']' : c; continue; }
      if (c === delimiter && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
      if (c === '(') depth++;
      if (c === ')') depth--;
    }
    parts.push(text.slice(start));
    return parts;
  }
  function identifier(part) {
    const match = /^(?:"((?:""|[^"])*)"|'((?:''|[^'])*)'|`((?:``|[^`])*)`|\[([^\]]*)\]|([^\s(),]+))/.exec(part.trim());
    if (!match) return null;
    return { name: (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]).replace(/""/g, '"').replace(/''/g, "'").replace(/``/g, '`'), rest: part.trim().slice(match[0].length).trim() };
  }
  function columnsOf(sql) {
    const res = { names: [], rowidCol: -1, order: null };
    const before = splitSQL(sql, '(')[0];
    const open = before.length, close = sql.lastIndexOf(')');
    if (open >= sql.length || close < open) return res;
    const parts = splitSQL(sql.slice(open + 1, close), ',');
    let primary = [];
    const integerColumns = new Set(), descendingKeys = new Set();
    for (let part of parts) {
      part = part.trim();
      if (/^constraint\s/i.test(part)) part = identifier(part.replace(/^constraint\s+/i, ''))?.rest || '';
      if (/^primary\s+key\s*\(/i.test(part)) {
        const body = part.slice(part.indexOf('(') + 1, part.lastIndexOf(')'));
        primary = splitSQL(body, ',').map(p => identifier(p)?.name);
        continue;
      }
      if (/^(?:unique\s*\(|check\s*\(|foreign\s+key\b)/i.test(part)) continue;
      const col = identifier(part);
      if (!col) continue;
      const index = res.names.length;
      if (/^integer(?=\s+(?:constraint|primary|not|null|unique|check|default|collate|references|generated)\b|$)/i.test(col.rest)) integerColumns.add(index);
      if (/\bprimary\s+key\s+desc\b/i.test(col.rest)) descendingKeys.add(index);
      if (/\bprimary\s+key\b/i.test(col.rest)) {
        primary = [col.name];
      }
      res.names.push(col.name);
    }
    if (primary.length === 1) {
      const index = res.names.findIndex(n => n.toLowerCase() === primary[0]?.toLowerCase());
      if (integerColumns.has(index) && !descendingKeys.has(index)) res.rowidCol = index;
    }
    if (/\bwithout\s+rowid\b/i.test(sql.slice(close + 1))) {
      res.rowidCol = -1;
      const keys = primary.map(name => res.names.findIndex(n => n.toLowerCase() === name?.toLowerCase())).filter(i => i >= 0);
      res.order = [...keys, ...res.names.map((_, i) => i).filter(i => !keys.includes(i))];
    }
    return res;
  }
})();
