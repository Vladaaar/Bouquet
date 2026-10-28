/* CronosPro reader, ported from alephdata/cronodump (MIT; see vendor/cronodump). */
(function () {
  const B = Bouquet, U = B.util, MAX = 64 * 1024 * 1024;
  const DEFAULT = new Uint8Array([8, 99, 129, 56, 163, 107, 130, 166, 24, 13, 172, 213, 254, 190, 21, 246, 165, 54, 118, 226, 45, 65, 181, 18, 75, 216, 60, 86, 52, 70, 79, 164, 208, 1, 139, 96, 15, 112, 87, 62, 6, 103, 2, 122, 248, 140, 128, 232, 195, 253, 10, 58, 167, 115, 176, 77, 153, 162, 241, 251, 90, 199, 194, 23, 150, 113, 186, 42, 169, 154, 243, 135, 234, 142, 9, 158, 185, 71, 212, 151, 228, 179, 188, 88, 83, 95, 46, 33, 209, 26, 238, 44, 100, 149, 242, 184, 198, 51, 141, 43, 31, 247, 37, 173, 255, 127, 57, 168, 191, 106, 145, 121, 237, 32, 123, 161, 187, 69, 105, 205, 220, 231, 49, 170, 240, 101, 215, 160, 50, 147, 177, 36, 214, 91, 159, 39, 66, 133, 7, 68, 63, 180, 17, 104, 94, 73, 41, 19, 148, 230, 27, 225, 125, 200, 47, 250, 120, 29, 227, 222, 80, 78, 137, 182, 48, 72, 12, 16, 5, 67, 206, 211, 97, 81, 131, 218, 119, 111, 146, 157, 116, 124, 4, 136, 134, 85, 202, 244, 193, 98, 14, 40, 183, 11, 192, 245, 207, 53, 197, 76, 22, 224, 152, 0, 155, 217, 174, 3, 175, 236, 201, 219, 109, 59, 38, 117, 61, 189, 178, 74, 93, 108, 114, 64, 126, 171, 89, 82, 84, 156, 210, 233, 239, 221, 55, 30, 143, 203, 138, 144, 252, 132, 229, 249, 20, 25, 223, 110, 35, 196, 102, 235, 204, 34, 28, 92]);
  const decoder = new TextDecoder('windows-1251');
  const text = bytes => decoder.decode(bytes).replace(/\0+$/, '');
  const say = (ru, en) => B.i18n.locale.startsWith('ru') ? ru : en;
  const error = (ru, en) => Object.defineProperty(new Error(), 'message', { get: () => say(ru, en) });
  const corrupt = () => error('Повреждённая или неподдерживаемая запись CronosPro', 'Corrupt or unsupported CronosPro record');
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  class Reader {
    constructor(bytes) { this.bytes = bytes; this.offset = 0; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
    take(n) { if (!Number.isSafeInteger(n) || n < 0 || this.offset + n > this.bytes.length) throw corrupt(); const out = this.bytes.subarray(this.offset, this.offset + n); this.offset += n; return out; }
    u8() { return this.take(1)[0]; }
    u16() { const p = this.offset; this.take(2); return this.view.getUint16(p, true); }
    u32() { const p = this.offset; this.take(4); return this.view.getUint32(p, true); }
    name() { return text(this.take(this.u8())); }
    field() { const start = this.offset; while (this.offset < this.bytes.length && this.bytes[this.offset] !== 30) this.offset++; const out = this.bytes.subarray(start, this.offset); if (this.offset < this.bytes.length) this.offset++; return out; }
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
  function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; }
  function join(parts, size) { const out = new Uint8Array(size); let p = 0; for (const part of parts) { out.set(part, p); p += part.length; } return out; }
  async function inflate(bytes, signal) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = []; let size = 0;
    try {
      for (;;) { U.checkAbort(signal); const { done, value } = await stream.read(); if (done) break; size += value.length; if (size > MAX) throw corrupt(); parts.push(value); }
      return join(parts, size);
    } finally { await stream.cancel().catch(() => {}); }
  }
  class Datafile {
    constructor(dat, tad) {
      this.dat = dat; this.tad = new DataView(tad.buffer, tad.byteOffset, tad.length);
      const h = new Reader(dat); if (text(h.take(8)) !== 'CroFile') throw corrupt(); h.u16();
      this.version = text(h.take(5)); this.encoding = h.u16(); this.block = h.u16();
      if (!['01.02', '01.03', '01.04', '01.05', '01.11'].includes(this.version)) throw error('Не поддерживается версия CronosPro ' + this.version, 'Unsupported CronosPro version ' + this.version);
      this.v4 = this.version === '01.11'; this.wide = ['01.03', '01.05', '01.11'].includes(this.version);
      this.custom = this.v4 || ['01.04', '01.05'].includes(this.version);
      this.header = this.v4 ? 16 : 8; this.step = this.wide ? 16 : 12;
      if (!this.block || tad.length < this.header || (tad.length - this.header) % this.step) throw corrupt();
      this.count = (tad.length - this.header) / this.step;
    }
    slice(offset, length) { if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || length > MAX || offset + length > this.dat.length) throw corrupt(); return this.dat.subarray(offset, offset + length); }
    raw(id) {
      if (!Number.isInteger(id) || id < 1 || id > this.count) throw corrupt();
      const p = this.header + (id - 1) * this.step;
      let offset = this.wide ? this.tad.getBigUint64(p, true) : BigInt(this.tad.getUint32(p, true));
      let length = this.tad.getUint32(p + (this.wide ? 8 : 4), true);
      if (length === 0xffffffff) return null;
      const flags = this.v4 ? Number(offset >> 56n) : length >>> 24;
      if (this.v4) { offset &= 0x00ffffffffffffffn; if (flags === 2 || flags === 3) return null; }
      else length &= 0x00ffffff;
      let data = this.slice(Number(offset), length);
      if (!length || flags) return data;
      const pointer = this.wide ? 8 : 4, header = pointer + 4;
      if (length < header) throw corrupt();
      const rd = new DataView(data.buffer, data.byteOffset, data.length);
      let next = this.wide ? Number(rd.getBigUint64(0, true)) : rd.getUint32(0, true);
      const size = rd.getUint32(pointer, true); if (size > MAX) throw corrupt();
      const out = new Uint8Array(size), first = data.subarray(header, header + size); out.set(first);
      let filled = first.length; const seen = new Set();
      while (filled < size) {
        if (!next || seen.has(next)) throw corrupt(); seen.add(next);
        data = this.slice(next, this.block); const d = new DataView(data.buffer, data.byteOffset, data.length);
        next = this.wide ? Number(d.getBigUint64(0, true)) : d.getUint32(0, true);
        const part = data.subarray(pointer, pointer + size - filled); if (!part.length) throw corrupt(); out.set(part, filled); filled += part.length;
      }
      return out;
    }
    async record(id, key, signal) {
      U.checkAbort(signal); let bytes = this.raw(id); if (!bytes?.length) return bytes;
      if (this.encoding & 1) { const kod = this.custom ? key : DEFAULT; bytes = Uint8Array.from(bytes, (b, i) => (kod[b] - i - id) & 255); }
      if (bytes.length < 11 || bytes.at(-3) !== 0 || bytes.at(-2) !== 0 || bytes.at(-1) !== 2) return bytes;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), parts = []; let p = 0, size = 0;
      while (p < bytes.length - 3) {
        if (p + 8 > bytes.length) throw corrupt();
        const n = view.getUint16(p), flag = view.getUint16(p + 2);
        if (![0x800, 8].includes(flag)) { if (!p) return bytes; throw corrupt(); }
        if (n < 6 || p + n + 2 > bytes.length - 3) throw corrupt();
        const part = await inflate(bytes.subarray(p + 8, p + n + 2), signal);
        if (crc(part) !== view.getUint32(p + 4, true)) throw corrupt();
        size += part.length; if (size > MAX) throw corrupt(); parts.push(part); p += n + 2;
      }
      if (p !== bytes.length - 3) throw corrupt(); U.checkAbort(signal); const decoded = join(parts, size); decoded.cronosCRC = true; return decoded;
    }
  }
  function tableDefinition(bytes) {
    const rd = new Reader(bytes); rd.u16(); const version = rd.u8(); if (version > 1) rd.u8();
    const length = rd.u8(); if (![5, 9].includes(length)) throw corrupt(); rd.u8(); if (length === 9) rd.u32(); rd.u32();
    const id = rd.u32(), name = rd.name(); rd.name(); rd.u32();
    if (id > 255 || !name) throw corrupt();
    const fields = [];
    function block(n) {
      if (n > 10000) throw corrupt();
      for (let i = 0; i < n; i++) {
        const f = new Reader(rd.take(rd.u16())), type = f.u16(); f.u32(); const name = f.name(); f.u32(); f.u8();
        const index = type ? f.u32() : 0; if (!name) throw corrupt(); fields.push({ type, name, index });
      }
    }
    block(rd.u32()); const extra = rd.u32(); if (extra > 10000) throw corrupt(); for (let i = 0; i < extra; i++) rd.take(rd.u16());
    if (rd.offset + 13 <= bytes.length) { rd.u32(); if (rd.u8() !== 2) throw corrupt(); rd.u32(); block(rd.u32()); }
    fields.sort((a, b) => a.index - b.index);
    if (!fields.length || fields[0].type !== 0) throw corrupt(); return { id, name, fields };
  }
  async function schema(stru, key, signal) {
    const raw = await stru.record(1, key, signal); if (!raw || raw[0] !== 3) throw corrupt();
    const rd = new Reader(raw.subarray(1)), tables = [], ids = new Set();
    while (rd.offset < rd.bytes.length) {
      U.checkAbort(signal); const name = rd.name(); if (!/^[\x20-\x7e]+$/.test(name)) throw corrupt();
      const n = rd.u32(); let value;
      if (n >= 0x80000000) value = rd.take(n & 0x7fffffff);
      else { const rec = await stru.record(n, key, signal); if (!rec || rec[0] !== 4) throw corrupt(); value = rec.subarray(1); }
      if (/^Base\d+$/.test(name) && name !== 'Base000') {
        const table = tableDefinition(value); if (ids.has(table.id)) throw corrupt(); ids.add(table.id); tables.push(table);
      }
    }
    if (!tables.length) throw corrupt(); return tables;
  }
  function cells(data, table, id) {
    const rd = new Reader(data.subarray(1));
    return table.fields.map(f => {
      if (!f.type) return id;
      let bytes;
      if (rd.bytes[rd.offset] === 27) { rd.u8(); bytes = rd.take(rd.u32()); } else bytes = rd.field();
      const value = text(bytes);
      if (f.type === 4 && /^-?\d{5,}$/.test(value)) return String(1900 + Number(value.slice(0, -4))).padStart(4, '0') + '-' + value.slice(-4, -2) + '-' + value.slice(-2);
      if (f.type === 5 && /^\d{4}$/.test(value)) return value.slice(0, 2) + ':' + value.slice(2);
      if (f.type === 6 && bytes.length >= 8) { const file = new Reader(bytes); file.u32(); file.u32(); return [text(file.field()), text(file.field()), text(file.field())].filter(Boolean).join(' '); }
      if ([7, 8, 9].includes(f.type)) return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return value.replaceAll('\x1d', '; ');
    });
  }
  async function recover(files, structure, signal) {
    const counts = Array.from({ length: 256 }, () => new Uint32Array(256));
    for (const file of files) {
      if (!(file.encoding & 1) || !file.custom) continue;
      for (let id = 1; id <= Math.min(file.count, structure ? file.count : 10000); id++) {
        U.checkAbort(signal); const data = file.raw(id);
        if (data?.length) {
          if (structure) { for (let i = 0; i < data.length; i++) counts[(i + id) & 255][data[i]]++; }
          else if (data.length > 11) { counts[(id + 3) & 255][data[3]]++; counts[(id + 10) & 255][data[2]]++; }
        }
        if (id % 128 === 0) await tick();
      }
    }
    const key = new Uint8Array(256), seen = new Set();
    for (let value = 0; value < 256; value++) {
      let best = -1; for (let b = 0; b < 256; b++) if (best < 0 || counts[value][b] > counts[value][best]) best = b;
      if (!counts[value][best] || seen.has(best)) return null;
      seen.add(best); key[best] = value;
    }
    return key;
  }
  let requestKey;
  B.register({
    kind: 'interpreter', id: 'cronos', name: 'CronosPro', priority: 60,
    test: ({ name }) => /(?:^|[\\/])cro(?:bank|stru|index)\.(?:dat|tad)$/i.test(name || ''),
    groupFiles(entries) {
      const groups = new Map(), component = /^(.*\/)?cro(?:bank|stru|index)\.(?:dat|tad)$/i;
      for (const entry of entries) {
        const match = component.exec(entry.name.replaceAll('\\', '/')); if (!match) continue;
        const folder = match[1] || '', id = folder.toLowerCase();
        if (!groups.has(id)) groups.set(id, { label: folder.replace(/\/$/, '') || 'CronosPro', entries: [] });
        groups.get(id).entries.push(entry);
      }
      const result = [], emitted = new Set();
      for (const entry of entries) {
        const match = component.exec(entry.name.replaceAll('\\', '/'));
        if (!match) { result.push(entry); continue; }
        const id = (match[1] || '').toLowerCase(), group = groups.get(id);
        const basenames = group.entries.map(e => e.name.split(/[\\/]/).at(-1).toLowerCase());
        // Duplicate names without directory information cannot be paired safely.
        if (new Set(basenames).size !== basenames.length) { result.push(entry); continue; }
        if (emitted.has(id)) continue; emitted.add(id);
        const primary = group.entries.find(e => /crostru\.dat$/i.test(e.name)) || group.entries.find(e => /crobank\.dat$/i.test(e.name)) || entry;
        result.push({ ...primary, label: group.label, members: group.entries });
      }
      return result;
    },
    setup(ui) {
      requestKey = signal => new Promise((resolve, reject) => {
        U.checkAbort(signal);
        const doc = ui.document, dialog = doc.createElement('dialog'), form = doc.createElement('form');
        dialog.className = 'cronos-key-dialog';
        const title = doc.createElement('h2'); title.textContent = say('Защищённая база CronosPro', 'Protected CronosPro database');
        const hint = doc.createElement('p'); hint.textContent = say('Не удалось автоматически восстановить KOD. Введите таблицу KOD: 512 шестнадцатеричных знаков. Обычный пароль CronosPro напрямую не поддерживается.', 'Could not recover KOD automatically. Enter a KOD table: 512 hexadecimal characters. A regular CronosPro password is not supported directly.');
        const input = doc.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.required = true; input.setAttribute('aria-label', 'KOD');
        const note = doc.createElement('p'); note.setAttribute('role', 'status');
        const submit = doc.createElement('button'); submit.type = 'submit'; submit.textContent = say('Открыть', 'Open'); submit.className = 'action-button';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = say('Отмена', 'Cancel'); cancel.className = 'action-button';
        function finish(key) { signal?.removeEventListener('abort', abort); input.value = ''; dialog.close(); dialog.remove(); key ? resolve(key) : reject(new DOMException(B.i18n.t('Операция отменена'), 'AbortError')); }
        const abort = () => finish(null);
        form.onsubmit = event => { event.preventDefault(); const raw = input.value.replace(/\s+/g, ''); const key = /^[\da-f]{512}$/i.test(raw) ? Uint8Array.from(raw.match(/../g), x => parseInt(x, 16)) : null; if (!key || new Set(key).size !== 256) { note.textContent = say('Нужна перестановка всех 256 байтов в hex-формате.', 'Enter a permutation of all 256 bytes in hexadecimal.'); return; } finish(key); };
        cancel.onclick = abort; dialog.oncancel = event => { event.preventDefault(); abort(); };
        for (const node of [title, hint, input, note, submit, cancel]) form.appendChild(node);
        dialog.appendChild(form); ui.root.appendChild(dialog); signal?.addEventListener('abort', abort, { once: true }); dialog.showModal(); input.focus();
      });
    },
    async open({ name, source, files = [], signal }) {
      const folder = name.replaceAll('\\', '/').replace(/[^/]*$/, '').toLowerCase();
      const related = files.filter(file => file.name.replaceAll('\\', '/').replace(/[^/]*$/, '').toLowerCase() === folder);
      const names = related.map(file => file.name.split(/[\\/]/).at(-1).toLowerCase()).filter(n => /^cro(?:bank|stru|index)\.(?:dat|tad)$/.test(n));
      if (new Set(names).size !== names.length) {
        const e = error('Нельзя различить базы с одинаковыми именами файлов без путей. Перетащите папки баз, чтобы сохранить пути.', 'Cannot distinguish databases with duplicate filenames and no paths. Drop the database folders to preserve their paths.');
        e.missingFiles = []; throw e;
      }
      const find = n => related.find(file => file.name.split(/[\\/]/).at(-1).toLowerCase() === n.toLowerCase());
      const required = ['CroStru.dat', 'CroStru.tad', 'CroBank.dat', 'CroBank.tad'];
      const missing = required.filter(n => !find(n));
      if (missing.length) { const e = error('Недостаточно файлов CronosPro: ' + missing.join(', ') + '. Выберите CroStru.dat, CroStru.tad, CroBank.dat и CroBank.tad вместе.', 'Missing CronosPro files: ' + missing.join(', ') + '. Select CroStru.dat, CroStru.tad, CroBank.dat and CroBank.tad together.'); e.missingFiles = missing; throw e; }
      async function pair(stem) {
        const entries = [find('Cro' + stem + '.dat'), find('Cro' + stem + '.tad')]; if (entries.some(e => !e)) return null;
        const [dat, tad] = await Promise.all(entries.map(async entry => { const src = entry.name === name ? source : await entry.open(signal); U.checkAbort(signal); return src.read(0, src.size, { signal }); }));
        return new Datafile(dat, tad);
      }
      let stru = await pair('Stru'), bank = await pair('Bank'), index = await pair('Index'), definitions, key = DEFAULT;
      async function attempt(candidate) {
        const defs = await schema(stru, candidate, signal);
        let verified = false, live = false;
        for (let id = 1; id <= Math.min(bank.count, 128); id++) {
          const record = await bank.record(id, candidate, signal); if (!record?.length) continue; live = true;
          const table = defs.find(t => t.id === record[0]);
          if (table) cells(record, table, id);
          if (record.cronosCRC || (table && !(bank.encoding & 2))) { verified = true; break; }
        }
        if (live && bank.custom && bank.encoding & 1 && !verified) throw corrupt();
        return defs;
      }
      try { definitions = await attempt(key); }
      catch (first) {
        U.checkAbort(signal);
        if (![stru, bank].some(f => f.custom && f.encoding & 1)) throw first;
        for (const [parts, structure] of [[[stru], true], [[bank, index].filter(Boolean), false]]) {
          const candidate = await recover(parts, structure, signal); if (!candidate) continue;
          try { definitions = await attempt(candidate); key = candidate; break; } catch { U.checkAbort(signal); }
        }
        while (!definitions) {
          if (!requestKey) throw error('Нужна таблица KOD защищённой базы CronosPro', 'This protected CronosPro database requires a KOD table');
          const candidate = await requestKey(signal);
          try { definitions = await attempt(candidate); key = candidate; } catch { U.checkAbort(signal); }
        }
      }
      let closed = false; const cache = new Map(); let cacheBytes = 0;
      async function record(id, signal) {
        if (closed) throw new DOMException(B.i18n.t('Источник закрыт'), 'AbortError');
        if (cache.has(id)) return cache.get(id);
        const data = await bank.record(id, key, signal); if (data) { cache.set(id, data); cacheBytes += data.length; while (cacheBytes > 4 * 1024 * 1024 && cache.size) { const first = cache.keys().next().value; cacheBytes -= cache.get(first).length; cache.delete(first); } } return data;
      }
      return { name: folder ? name.replace(/[\\/][^/]*$/, '') : 'CronosPro',
        tables: definitions.map(table => ({ name: table.name, columns: table.fields.map(f => f.name),
          async read({ cursor = 1, limit = 100, match, signal, onProgress } = {}) {
            if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw B.i18n.error('размер порции должен быть от 1 до 10000');
            if (closed) throw new DOMException(B.i18n.t('Источник закрыт'), 'AbortError');
            const rows = []; let found = 0;
            for (let id = cursor ?? 1; id <= bank.count; id++) {
              U.checkAbort(signal); const data = await record(id, signal);
              if (data?.[0] === table.id) { const row = cells(data, table, id); if (!match || match(row)) { if (rows.length === limit) return { rows, hasMore: true, nextCursor: id }; rows.push({ n: id, cells: row }); found++; } }
              if (id % 128 === 0) { onProgress?.({ scanned: id, found, rows: rows.slice() }); await tick(); }
            }
            U.checkAbort(signal); return { rows, hasMore: false, nextCursor: null };
          }
        })),
        close() { closed = true; cache.clear(); stru = bank = index = null; }
      };
    }
  });
})();
