/* XLS/XLSX interpreter. SheetJS CE 0.20.3 is loaded locally only when needed. */
(function () {
  const B = Bouquet, U = B.util;
  let loading;
  function reader() {
    if (globalThis.XLSX?.read) return Promise.resolve(globalThis.XLSX);
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('modules/vendor/sheetjs-0.20.3/xlsx.full.min.js', document.baseURI).href;
      const failed = () => {
        script.remove();
        reject(new Error(B.i18n.locale.startsWith('ru')
          ? 'Не удалось загрузить локальную библиотеку SheetJS: ' + script.src
          : 'Could not load the local SheetJS library: ' + script.src));
      };
      script.onload = () => globalThis.XLSX?.read ? resolve(globalThis.XLSX) : failed();
      script.onerror = failed;
      document.head.appendChild(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  B.register({
    kind: 'interpreter', id: 'excel', name: 'Excel (XLS/XLSX)', priority: 40,
    test: ({ ext }) => ['xls', 'xlsx'].includes(String(ext).toLowerCase()),
    async parse({ buffer, name, signal }) {
      U.checkAbort(signal);
      const X = await reader(); U.checkAbort(signal);
      let book = X.read(buffer, { type: 'array', cellHTML: false, cellText: true, dateNF: 'yyyy-mm-dd' });
      U.checkAbort(signal);
      const tables = book.SheetNames.map(sheetName => {
        let ref = book.Sheets[sheetName]?.['!ref'];
        // BIFF8 may report A1 even for a completely empty sheet.
        if (ref === 'A1' && !book.Sheets[sheetName].A1) ref = null;
        const range = ref ? X.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
        const columns = Array.from({ length: range.e.c - range.s.c + 1 }, (_, i) => X.utils.encode_col(range.s.c + i));
        return {
          name: sheetName, columns,
          async read({ cursor = null, limit = 100, match, signal, onProgress } = {}) {
            U.checkAbort(signal);
            if (!book) throw new DOMException(B.i18n.t('Источник закрыт'), 'AbortError');
            if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw B.i18n.error('размер порции должен быть от 1 до 10000');
            const sheet = book.Sheets[sheetName], rows = [];
            const total = range.e.r - range.s.r + 1;
            for (let r = cursor ?? range.s.r; r <= range.e.r; r++) {
              U.checkAbort(signal);
              const cells = columns.map((_, i) => {
                const cell = sheet[X.utils.encode_cell({ r, c: range.s.c + i })];
                return cell?.f && cell.v == null ? '=' + cell.f : cell ? X.utils.format_cell(cell) : '';
              });
              if (!match || match(cells)) {
                if (rows.length === limit) return { rows, hasMore: true, nextCursor: r, total, scanned: r - range.s.r };
                rows.push({ n: r + 1, cells });
              }
              if ((r - range.s.r + 1) % 128 === 0) {
                onProgress?.({ scanned: r - range.s.r + 1, found: rows.length, rows: rows.slice() });
                await new Promise(resolve => setTimeout(resolve, 0));
                U.checkAbort(signal);
              }
            }
            return { rows, hasMore: false, nextCursor: null, total, scanned: total };
          }
        };
      });
      return { name, tables, close() { book = null; } };
    }
  });
})();
