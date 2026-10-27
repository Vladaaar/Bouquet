/* Byte sources: local Blob/File, or HTTP Range with a full-download fallback. */
(function () {
  const U = Bouquet.util;
  U.checkAbort = signal => { if (signal?.aborted) throw new DOMException(Bouquet.i18n.t('Операция отменена'), 'AbortError'); };
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
