/* Bouquet · SQLite: lazy page reader, no dependencies or SQL engine. */
(function () {
  const MAGIC = 'SQLite format 3\u0000';
  Bouquet.register({
    kind: 'interpreter', id: 'sqlite', name: 'SQLite', priority: 30,
    format: 'sqlite', loadingMode: 'progressive',
    test({ ext, bytes }) {
      if (bytes && bytes.length >= 16) return Array.from(MAGIC).every((c, i) => bytes[i] === c.charCodeAt(0));
      return ['db', 'sqlite', 'sqlite3', 'db3'].includes(ext);
    },
    open: openDatabase,
    // Compatibility for callers which still provide a complete buffer.
    async parse({ buffer, name, signal }) {
      return openDatabase({ source: Bouquet.util.blobSource(new Blob([buffer]), name), name, signal });
    }
  });

  async function openDatabase({ source, name, signal }) {
    const U = Bouquet.util;
    const header = await source.read(0, 100, { signal });
    if (header.length < 100 || !Array.from(MAGIC).every((c, i) => header[i] === c.charCodeAt(0))) {
      throw Bouquet.i18n.error('это не файл SQLite 3');
    }
    const hd = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let pageSize = hd.getUint16(16);
    if (pageSize === 1) pageSize = 65536;
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) throw Bouquet.i18n.error('неверный размер страницы');
    const usable = pageSize - header[20];
    if (usable < 480) throw Bouquet.i18n.error('неверный размер полезной страницы');
    const enc = hd.getUint32(56) || 1;
    const decoder = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
    const cache = new Map();
    const maxPages = Math.max(1, Math.floor(4 * 1024 * 1024 / pageSize));
    let closed = false;
    function check(signal) {
      U.checkAbort(signal);
      if (closed) throw new DOMException(Bouquet.i18n.t('Источник закрыт'), 'AbortError');
    }
    async function page(n, signal) {
      check(signal);
      if (!Number.isInteger(n) || n < 1 || n * pageSize > source.size) throw Bouquet.i18n.error('страница за границей файла: {page}', { page: n });
      let bytes = cache.get(n);
      if (bytes) cache.delete(n);
      else bytes = await source.read((n - 1) * pageSize, pageSize, { signal });
      check(signal);
      if (bytes.length !== pageSize) throw Bouquet.i18n.error('неполная страница: {page}', { page: n });
      cache.set(n, bytes);
      if (cache.size > maxPages) cache.delete(cache.keys().next().value);
      return bytes;
    }
    const uint32 = (p, offset) => new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(offset);
    async function payload(p, start, len, tableLeaf, signal) {
      // A single giant value must not defeat the bounded page cache.
      if (!Number.isSafeInteger(len) || len < 0 || len > 64 * 1024 * 1024) throw Bouquet.i18n.error('запись превышает лимит 64 МиБ');
      const maxLocal = tableLeaf ? usable - 35 : ((usable - 12) * 64 / 255 | 0) - 23;
      const minLocal = ((usable - 12) * 32 / 255 | 0) - 23;
      let local = len;
      if (len > maxLocal) {
        local = minLocal + ((len - minLocal) % (usable - 4));
        if (local > maxLocal) local = minLocal;
      }
      if (start + local + (local < len ? 4 : 0) > usable) throw Bouquet.i18n.error('повреждённая ячейка');
      if (local === len) return p.subarray(start, start + len);
      const out = new Uint8Array(len);
      out.set(p.subarray(start, start + local));
      let filled = local, next = uint32(p, start + local);
      const seen = new Set();
      while (filled < len) {
        if (!next || seen.has(next)) throw Bouquet.i18n.error('повреждённая цепочка переполнения');
        seen.add(next);
        const overflow = await page(next, signal);
        const take = Math.min(usable - 4, len - filled);
        out.set(overflow.subarray(4, 4 + take), filled);
        filled += take;
        next = uint32(overflow, 0);
      }
      return out;
    }
    /* ---- varint ---- */
    function varint(p, o) {
      let v = 0n;
      for (let i = 0; i < 8; i++) {
        if (o + i >= p.length) throw Bouquet.i18n.error('неполный varint');
        const byte = p[o + i];
        if (byte & 0x80) v = (v << 7n) | BigInt(byte & 0x7f);
        else return [(v << 7n) | BigInt(byte), i + 1];
      }
      if (o + 8 >= p.length) throw Bouquet.i18n.error('неполный varint');
      return [(v << 8n) | BigInt(p[o + 8]), 9];
    }

    function readInt(p, o, len) {
      let v = 0n;
      for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(p[o + i]);
      const bits = BigInt(len * 8);
      if (v >> (bits - 1n)) v -= 1n << bits;               /* дополнительный код */
      return (v >= -9007199254740991n && v <= 9007199254740991n) ? Number(v) : v.toString();
    }

    /* ---- запись: заголовок с serial types + тело ---- */
    function record(p) {
      const [hsize, n] = varint(p, 0);
      const hs = Number(hsize);
      if (hs < n || hs > p.length) throw Bouquet.i18n.error('повреждённый заголовок записи');
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
        else if (t === 10 || t === 11) throw Bouquet.i18n.error('зарезервированный тип записи');
        else if (t >= 12 && t % 2 === 0) { const l = (t - 12) / 2; v = '‹blob ' + l + ' Б›'; bo += l; }
        else { const l = (t - 13) / 2; v = decoder.decode(p.subarray(bo, bo + l)); bo += l; }
        if (ho > hs || bo > p.length) throw Bouquet.i18n.error('неполная запись');
        vals.push(v);
      }
      return vals;
    }


    // A cursor stores only the B-tree path, never all rows or visited pages.
    function cursor(root) { return { stack: [{ page: root, step: 0 }], n: 0 }; }
    function copy(c) { return { stack: c.stack.map(f => ({ ...f })), n: c.n }; }
    async function next(c, signal) {
      while (c.stack.length) {
        check(signal);
        const frame = c.stack[c.stack.length - 1];
        const p = await page(frame.page, signal);
        const h = frame.page === 1 ? 100 : 0;
        const type = p[h];
        if (![2, 5, 10, 13].includes(type)) throw Bouquet.i18n.error('неподдерживаемая страница b-дерева: {type}', { type });
        const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        const cells = dv.getUint16(h + 3);
        const interior = type === 2 || type === 5;
        const ptrs = h + (interior ? 12 : 8);
        if (ptrs + cells * 2 > usable) throw Bouquet.i18n.error('повреждённый список ячеек');
        const steps = interior ? cells * 2 + 1 : cells;
        if (frame.step >= steps) { c.stack.pop(); continue; }
        const step = frame.step++;
        const i = interior ? Math.floor(step / 2) : step;
        const cell = i < cells ? dv.getUint16(ptrs + i * 2) : 0;
        if (interior && step % 2 === 0) {
          const child = i === cells ? dv.getUint32(h + 8) : dv.getUint32(cell);
          if (c.stack.length >= 64 || c.stack.some(f => f.page === child)) throw Bouquet.i18n.error('повреждённое b-дерево');
          c.stack.push({ page: child, step: 0 });
          continue;
        }
        if (type === 5) continue;
        const start = cell + (type === 2 ? 4 : 0);
        const [len, a] = varint(p, start);
        let rowid = null, skip = a;
        if (type === 13) {
          const [id, k] = varint(p, start + a);
          const signed = BigInt.asIntN(64, id);
          rowid = signed >= -9007199254740991n && signed <= 9007199254740991n ? Number(signed) : signed.toString();
          skip += k;
        }
        const values = record(await payload(p, start + skip, Number(len), type === 13, signal));
        c.n++;
        return { rowid, values };
      }
      return null;
    }
    const master = [];
    const schemaCursor = cursor(1);
    let item;
    while ((item = await next(schemaCursor, signal))) {
      const r = item.values;
      master.push({ type: r[0], name: r[1], root: Number(r[3]) || 0, sql: r[4] || '' });
      if (master.length % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const tables = master.filter(m => m.type === 'table' && m.root && !/^sqlite_/.test(m.name)).map(m => {
      const spec = columnsOf(m.sql);
      const table = {
        name: m.name, columns: spec.names, schemaSQL: m.sql, note: source.note, noteKey: source.noteKey,
        async read({ cursor: token = null, limit = 100, match, signal, onProgress } = {}) {
          if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw Bouquet.i18n.error('размер порции должен быть от 1 до 10000');
          const c = token ? copy(token) : cursor(m.root);
          const rows = [];
          let scanned = 0;
          while (true) {
            const before = copy(c);
            const r = await next(c, signal);
            if (!r) return { rows, nextCursor: null, hasMore: false, total: c.n, scanned: c.n };
            const values = spec.order ? spec.order.reduce((out, column, i) => { out[column] = r.values[i]; return out; }, []) : r.values;
            if (spec.rowidCol >= 0 && values[spec.rowidCol] == null) values[spec.rowidCol] = r.rowid;
            while (values.length < table.columns.length) values.push(null);
            const cells = values;
            if (!match || match(cells)) {
              if (rows.length === limit) return { rows, nextCursor: before, hasMore: true, scanned: before.n };
              rows.push({ n: c.n, cells });
            }
            if (++scanned % 128 === 0) {
              onProgress?.({ scanned: c.n, found: rows.length, rows: rows.slice() });
              await new Promise(resolve => setTimeout(resolve, 0));
              check(signal);
            }
          }
        }
      };
      return table;
    });
    return { name, tables, close() { closed = true; cache.clear(); } };
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
