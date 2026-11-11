/* Byte sources: local Blob/File, or HTTP Range with a full-download fallback. */
(function () {
  const U = Bouquet.util;
  U.checkAbort = signal => { if (signal?.aborted) throw new DOMException(Bouquet.i18n.t('Операция отменена'), 'AbortError'); };
  // Bounded aligned ranges, shared by streaming text and Cronos components.
  U.cachedSource = (source, blockSize = 65536, maxBlocks = 16) => {
    const cache = new Map();
    return { name: source.name, size: source.size, clear() { cache.clear(); },
      async read(offset, length, { signal } = {}) {
        U.checkAbort(signal);
        const end = Math.min(source.size, offset + length), parts = []; let size = 0;
        for (let at = offset; at < end;) {
          const start = Math.floor(at / blockSize) * blockSize;
          let bytes = cache.get(start);
          if (bytes) cache.delete(start);
          else bytes = await source.read(start, Math.min(blockSize, source.size - start), { signal });
          U.checkAbort(signal);
          if (bytes.length !== Math.min(blockSize, source.size - start)) throw Bouquet.i18n.error('Неполный ответ Range');
          cache.set(start, bytes); if (cache.size > maxBlocks) cache.delete(cache.keys().next().value);
          const part = bytes.subarray(at - start, Math.min(bytes.length, end - start));
          parts.push(part); size += part.length; at += part.length;
        }
        if (parts.length === 1) return parts[0];
        const out = new Uint8Array(size); let at = 0;
        for (const part of parts) { out.set(part, at); at += part.length; }
        return out;
      }
    };
  };
  // Byte-boundary cursors avoid splitting UTF-8 characters or UTF-16 code units.
  // A cursor always starts at a logical record boundary, outside CSV quotes.
  U.textSource = async (raw, signal) => {
    const source = U.cachedSource(raw, 65536, 4), head = await source.read(0, 3, { signal });
    const utf16 = head[0] === 255 && head[1] === 254 || head[0] === 254 && head[1] === 255;
    const encoding = utf16 ? head[0] === 255 ? 'utf-16le' : 'utf-16be' : 'utf-8';
    const unit = utf16 ? 2 : 1, start = utf16 ? 2 : head[0] === 239 && head[1] === 187 && head[2] === 191 ? 3 : 0;
    const decoder = new TextDecoder(encoding, { ignoreBOM: true }); let closed = false;
    const check = signal => { U.checkAbort(signal); if (closed) throw new DOMException(Bouquet.i18n.t('Источник закрыт'), 'AbortError'); };
    const code = (bytes, i) => unit === 1 ? bytes[i] : encoding === 'utf-16le' ? bytes[i] | bytes[i + 1] << 8 : bytes[i] << 8 | bytes[i + 1];
    const decode = bytes => decoder.decode(bytes).replace(/\r\n?/g, '\n');
    return { start, encoding,
      close() { closed = true; source.clear(); },
      async sample(signal) { check(signal); return decode(await source.read(start, 65536, { signal })); },
      async *records(offset = start, delimiter = null, signal) {
        check(signal);
        let pieces = [], size = 0, recordStart = offset, quoted = false, afterQuote = false, fieldStart = true, skipLF = false, blocks = 0;
        const add = bytes => {
          if (bytes.length) { pieces.push(bytes); size += bytes.length; }
          if (size > 64 * 1024 * 1024) throw Bouquet.i18n.error('запись превышает лимит 64 МиБ');
        };
        const value = () => {
          if (pieces.length === 1) return decode(pieces[0]);
          const bytes = new Uint8Array(size); let at = 0;
          for (const part of pieces) { bytes.set(part, at); at += part.length; }
          return decode(bytes);
        };
        for (let at = offset; at < source.size;) {
          check(signal);
          const bytes = await source.read(at, 65536, { signal }); let from = 0;
          for (let i = 0; i < bytes.length; i += unit) {
            if (i + unit > bytes.length) break;
            const c = code(bytes, i);
            if (skipLF) { skipLF = false; if (c === 10) { from = i + unit; continue; } }
            if (delimiter != null) {
              if (quoted) { if (c === 34) { quoted = false; afterQuote = true; } continue; }
              if (afterQuote && c === 34) { quoted = true; afterQuote = false; continue; }
              afterQuote = false;
              if (c === 34 && fieldStart) { quoted = true; fieldStart = false; continue; }
              if (c === delimiter.charCodeAt(0)) { fieldStart = true; continue; }
              if (c !== 10 && c !== 13) fieldStart = false;
            }
            if (c === 10 || c === 13) {
              add(bytes.subarray(from, i));
              let next = at + i + unit;
              if (c === 13 && next < source.size) {
                const peek = i + unit < bytes.length ? bytes.subarray(i + unit, i + 2 * unit) : await source.read(next, unit, { signal });
                if (code(peek, 0) === 10) next += unit;
              }
              check(signal); yield { text: value(), start: recordStart, next, eof: false };
              pieces = []; size = 0; from = i + unit; recordStart = next; fieldStart = true; skipLF = c === 13;
            }
          }
          add(bytes.subarray(from)); at += bytes.length;
          if (++blocks % 16 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(signal); }
        }
        check(signal); yield { text: value(), start: recordStart, next: source.size, eof: true };
      }
    };
  };
  U.blobSource = (blob, name = blob.name || Bouquet.i18n.t('файл')) => ({
    name, size: blob.size,
    async read(offset, length, { signal } = {}) {
      U.checkAbort(signal);
      const buffer = await blob.slice(offset, offset + length).arrayBuffer();
      U.checkAbort(signal);
      return new Uint8Array(buffer);
    }
  });
  U.urlSource = async (url, { signal } = {}) => {
    const name = decodeURIComponent(url.split('/').pop());
    const first = await fetch(url, { headers: { Range: 'bytes=0-4095' }, signal, cache: 'no-store' });
    if (!first.ok) throw new Error('HTTP ' + first.status);
    if (first.status !== 206) {
      const source = U.blobSource(await first.blob(), name);
      source.noteKey = 'rangeFallback';
      Object.defineProperty(source, 'note', { get: () => Bouquet.i18n.t(source.noteKey) });
      return source;
    }
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(first.headers.get('Content-Range') || '');
    if (!range) throw Bouquet.i18n.error('Некорректный Content-Range');
    const initial = new Uint8Array(await first.arrayBuffer());
    if (initial.length !== Number(range[1]) + 1) throw Bouquet.i18n.error('Неполный ответ Range');
    const size = Number(range[2]);
    const validator = first.headers.get('ETag') || first.headers.get('Last-Modified');
    return {
      name, size,
      async read(offset, length, { signal } = {}) {
        U.checkAbort(signal);
        const end = Math.min(size, offset + length);
        if (end <= offset) return new Uint8Array();
        if (end <= initial.length) return initial.subarray(offset, end);
        const headers = { Range: `bytes=${offset}-${end - 1}` };
        if (validator) headers['If-Range'] = validator;
        const response = await fetch(url, { headers, signal, cache: 'no-store' });
        if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${offset}-${end - 1}/${size}`) {
          throw Bouquet.i18n.error('Файл на сервере изменился или Range недоступен. Откройте файл заново.');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== end - offset) throw Bouquet.i18n.error('Неполный ответ Range');
        return bytes;
      }
    };
  };
})();
