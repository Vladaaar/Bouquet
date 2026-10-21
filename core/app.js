/* Bouquet UI: accepts both in-memory tables and asynchronous row sources. */
(function () {
  const B = window.Bouquet, U = B.util;
  const $ = id => document.getElementById(id);
  const chip = $('chip'), slotFile = $('slotFile'), slotInterp = $('slotInterp');
  const form = $('searchForm'), q = $('q'), clear = $('clear');
  const tableSelect = $('tableSelect'), stage = $('stage'), pager = $('pager'), pos = $('pos'), status = $('status');
  const S = {
    fileName: null, source: null, bytes: null, interp: null, dataset: null,
    active: 0, query: '', page: 0, pageSize: 100, opening: false, reading: false,
    cursors: [null], total: undefined
  };
  const progressive = $('progressive');
  const MEMORY_LIMIT = 100 * 1024 * 1024;
  let opening, reading, debounce;
  const search = () => B.features.search;
  function resetPages() { S.page = 0; S.cursors = [null]; S.total = undefined; S.matches = undefined; }
  const choose = (list, value) => list.filter(m => {
    try { return m.test(value); } catch { return false; }
  }).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];

  async function openSource(load, name, { preserve = false, mode } = {}) {
    const tableName = preserve ? S.dataset?.tables[S.active]?.name : null;
    opening?.abort(); reading?.abort(); clearTimeout(debounce);
    const request = opening = new AbortController();
    B.ui.currentView = null; B.emit('view:reset');
    S.dataset?.close?.();
    Object.assign(S, { fileName: name, source: null, dataset: null, interp: null, bytes: null,
      opening: true, reading: false, query: preserve ? S.query : '', active: 0, error: '', loadingMode: mode || null });
    resetPages(); if (!preserve) q.value = ''; clear.hidden = !q.value;
    stage.replaceChildren(); tableSelect.replaceChildren(); tableSelect.hidden = true; $('tableSep').hidden = true; pager.hidden = true;
    $('emptyState').hidden = true; $('fileContent').hidden = false;
    status.textContent = 'Открытие файла…'; paintChip();
    try {
      const source = await load(request.signal);
      U.checkAbort(request.signal);
      S.source = source;
      const bytes = await source.read(0, 4096, { signal: request.signal });
      U.checkAbort(request.signal);
      S.bytes = bytes;
      const meta = { source, name, ext: U.ext(name), bytes, signal: request.signal };
      const preferredMode = mode || (source.size > MEMORY_LIMIT ? 'progressive' : 'memory');
      let interpreter = choose(B.interpreters, meta);
      if (interpreter?.format && interpreter.loadingMode) {
        interpreter = choose(B.interpreters.filter(m => m.format === interpreter.format && m.loadingMode === preferredMode), meta) || interpreter;
      }
      S.interp = interpreter; S.loadingMode = interpreter.loadingMode;
      paintChip();
      let result;
      if (interpreter.open) result = await interpreter.open(meta);
      else {
        status.textContent = 'Чтение файла целиком…';
        const full = await source.read(0, source.size, { signal: request.signal });
        U.checkAbort(request.signal);
        await new Promise(resolve => setTimeout(resolve, 0));
        U.checkAbort(request.signal);
        result = await interpreter.parse({ ...meta, bytes: full,
          buffer: full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength) });
      }
      if (request.signal.aborted) { result?.close?.(); return; }
      S.dataset = U.normalize(result, name);
      if (!S.dataset.tables.length) S.dataset.tables = [U.textTable('В файле нет таблиц для показа', 'пусто')];
      if (tableName) S.active = Math.max(0, S.dataset.tables.findIndex(t => t.name === tableName));
      status.textContent = source.note || '';
    } catch (err) {
      if (request.signal.aborted) return;
      S.dataset = { name, tables: [U.textTable('Файл не разобран: ' + err.message, 'ошибка')] };
      S.error = 'Не удалось открыть файл: ' + err.message;
      status.textContent = S.error;
    } finally {
      if (opening === request) {
        S.opening = false;
        paint();
      }
    }
  }
  function openFile(file) {
    if (U.ext(file.name) === 'js') return loadModuleFile(file);
    B.ui.selectTab('explorer');
    return openSource(() => U.blobSource(file), file.name);
  }
  async function loadModuleFile(file) {
    try {
      const before = B.plugins.length;
      B.exec(await file.text(), file.name);
      const added = B.plugins.slice(before);
      const source = S.source;
      if (source && added.some(plugin => plugin.kind === 'interpreter')) {
        await openSource(() => source, S.fileName, { preserve: true, mode: S.interp?.loadingMode });
      } else if (S.dataset && added.some(plugin => plugin.kind === 'renderer' || plugin.id === 'search')) {
        paint();
      }
      $('pluginStatus').textContent = 'Подключён ' + file.name;
    } catch (err) {
      $('pluginStatus').textContent = 'Плагин не подключён: ' + err.message;
      B.ui.selectTab('plugins');
    }
  }

  function renderView(view) {
    choose(B.renderers, view.table).render(stage, view);
    B.ui.currentView = { host: stage, view };
    B.emit('view:render', B.ui.currentView);
  }

  async function currentView(signal) {
    const table = S.dataset?.tables[S.active];
    if (!table) return null;
    const feature = search(), query = S.query;
    let rows, total, found, foundExact, hasMore, pages;
    if (table.read) {
      let match, shown = 0;
      if (feature && query.trim()) {
        match = feature.compile ? feature.compile(table, query)
          : cells => feature.filter({ ...table, rows: [cells] }, query).length > 0;
      }
      const result = await table.read({ cursor: S.cursors[S.page], limit: S.pageSize, match, signal,
        onProgress({ scanned, found, rows: partial }) {
          if (signal.aborted) return;
          status.textContent = `Просмотрено ${scanned.toLocaleString('ru-RU')} строк; в порции найдено ${found}`;
          if (partial?.length && partial.length !== shown) {
            shown = partial.length;
            const view = { dataset: S.dataset, table, query, rows: partial, total: S.total,
              found: S.page * S.pageSize + found, foundExact: false,
              page: S.page, pageSize: S.pageSize,
              highlight: feature && query.trim() ? value => feature.highlight(value, query) : U.escape };
            renderView(view);
          }
        }
      });
      U.checkAbort(signal);
      rows = result.rows;
      hasMore = result.hasMore;
      if (hasMore) S.cursors[S.page + 1] = result.nextCursor;
      if (result.total != null) S.total = result.total;
      total = S.total;
      if (!hasMore) S.matches = S.page * S.pageSize + rows.length;
      found = S.matches ?? S.page * S.pageSize + rows.length;
      foundExact = S.matches != null;
      pages = S.matches == null ? undefined : Math.max(1, Math.ceil(S.matches / S.pageSize));
    } else {
      const all = table.rows;
      const indices = feature && query.trim() ? feature.filter(table, query) : null;
      found = indices ? indices.length : all.length;
      total = all.length; foundExact = true;
      pages = Math.max(1, Math.ceil(found / S.pageSize));
      S.page = Math.min(S.page, pages - 1);
      const from = S.page * S.pageSize;
      rows = indices ? indices.slice(from, from + S.pageSize).map(i => ({ n: i + 1, cells: all[i] }))
        : all.slice(from, from + S.pageSize).map((cells, i) => ({ n: from + i + 1, cells }));
      hasMore = S.page + 1 < pages;
    }
    return { dataset: S.dataset, table, query, rows, total, found, foundExact, hasMore,
      page: S.page, pages, pageSize: S.pageSize,
      highlight: feature && query.trim() ? value => feature.highlight(value, query) : U.escape };
  }

  async function paint() {
    B.emit('view:reset');
    reading?.abort(); clearTimeout(debounce);
    S.reading = false; paintChip(); paintTables();
    $('emptyState').hidden = !!S.fileName;
    $('fileContent').hidden = !S.fileName;
    if (S.opening) return;
    if (!S.dataset) { pager.hidden = true; return; }
    // Keep the current table in place until the new result is ready.
    const request = reading = new AbortController();
    S.reading = true; paintChip();
    stage.setAttribute('aria-busy', 'true');
    $('prev').disabled = $('next').disabled = true;
    status.textContent = S.query.trim() ? 'Поиск…' : 'Чтение строк…';
    try {
      const view = await currentView(request.signal);
      U.checkAbort(request.signal);
      renderView(view);
      pager.hidden = !view.hasMore && view.page === 0;
      pos.textContent = (view.page + 1) + (view.pages == null ? ' / …' : ' / ' + view.pages);
      $('prev').disabled = view.page === 0;
      $('next').disabled = !view.hasMore;
      status.textContent = S.error || S.source?.note || '';
    } catch (err) {
      if (request.signal.aborted) return;
      status.textContent = 'Ошибка чтения: ' + err.message;
      stage.replaceChildren();
      pager.hidden = S.page === 0;
      $('prev').disabled = S.page === 0;
    } finally {
      if (reading === request) {
        S.reading = false; paintChip(); stage.removeAttribute('aria-busy');
      }
    }
  }
  function paintTables() {
    const list = S.dataset?.tables || [];
    tableSelect.replaceChildren();
    tableSelect.hidden = $('tableSep').hidden = list.length < 2;
    for (const [i, table] of list.entries()) {
      const option = document.createElement('option');
      option.value = String(i); option.textContent = table.name || ('таблица ' + (i + 1));
      tableSelect.appendChild(option);
    }
    tableSelect.value = String(S.active);
    tableSelect.title = list[S.active]?.name || 'Таблица базы данных';
  }
  tableSelect.onchange = () => {
    const active = Number(tableSelect.value);
    if (!Number.isInteger(active) || !S.dataset?.tables[active]) return;
    S.active = active; resetPages(); paint();
  };
  progressive.onchange = () => {
    if (progressive.disabled || !S.source) return;
    const source = S.source;
    openSource(() => source, S.fileName, { preserve: true, mode: progressive.checked ? 'progressive' : 'memory' });
  };
  function paintChip() {
    slotFile.textContent = S.fileName || 'файл не выбран';
    slotFile.classList.toggle('empty', !S.fileName);
    slotInterp.textContent = S.interp?.name || 'интерпретатор';
    slotInterp.classList.toggle('empty', !S.interp);
    progressive.checked = S.loadingMode === 'progressive';
    const alternatives = B.interpreters.filter(m => m.format === S.interp?.format && m.loadingMode);
    progressive.disabled = S.opening || !alternatives.some(m => m.loadingMode === 'memory') || !alternatives.some(m => m.loadingMode === 'progressive');
    $('loadingHint').textContent = !S.interp?.loadingMode ? 'Выберите SQLite-файл' :
      'По умолчанию: до 100 МиБ — целиком в память, больше — прогрессивно. Смена режима переоткрывает файл.';
    const busy = S.opening || S.reading;
    const ready = S.interp && (!S.interp.fallback || U.isText(S.bytes || new Uint8Array()));
    chip.dataset.state = busy ? 'loading' : !S.fileName || S.error ? 'stop' : ready ? 'go' : 'wait';
    chip.title = busy ? 'Чтение данных' : ready ? 'Файл и интерпретатор готовы' : 'Выберите файл или интерпретатор';
  }
  slotFile.onclick = () => $('pickFile').click();
  slotInterp.onclick = () => $('pickModule').click();
  $('pickFile').onchange = e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('pickModule').onchange = e => { if (e.target.files[0]) loadModuleFile(e.target.files[0]); e.target.value = ''; };
  form.onsubmit = e => {
    e.preventDefault(); S.query = q.value; resetPages();
    if (!S.fileName) return $('pickFile').click();
    paint();
  };
  q.oninput = () => {
    clear.hidden = !q.value;
    S.query = q.value; resetPages();
    if (!S.dataset) return;
    reading?.abort(); clearTimeout(debounce);
    $('prev').disabled = $('next').disabled = true;
    debounce = setTimeout(paint, 120);
  };
  clear.onclick = () => { q.value = ''; clear.hidden = true; S.query = ''; resetPages(); paint(); q.focus(); };
  $('prev').onclick = () => { if (S.page > 0) { S.page--; paint(); scrollTo({ top: 0, behavior: 'smooth' }); } };
  $('next').onclick = () => { if (!$('next').disabled) { S.page++; paint(); scrollTo({ top: 0, behavior: 'smooth' }); } };
  addEventListener('keydown', e => {
    if (B.ui.activeTab !== 'explorer') return;
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === 'Escape' && document.activeElement === q) { q.blur(); }
    else if (e.key === '/' && !editing && search()) { e.preventDefault(); q.focus(); }
    else if (!pager.hidden && !editing) {
      if (e.key === 'ArrowRight' && !$('next').disabled) $('next').click();
      if (e.key === 'ArrowLeft' && !$('prev').disabled) $('prev').click();
    }
  });
  let dragDepth = 0;
  addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth) document.body.classList.add('dragging'); });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });
  B.on('register', () => { form.hidden = !search(); paintChip(); });
  async function scanFolder() {
    try {
      const response = await fetch('bouquet.files.json', { cache: 'no-store' });
      if (!response.ok || S.fileName) return;
      const list = (await response.json()).files || [];
      for (const path of list) {
        if (S.fileName) return;
        // Open through the same cancellation boundary as manually chosen files.
        await openSource(signal => U.urlSource(path, { signal }), decodeURIComponent(path.split('/').pop()));
        if (S.source) return;
        if (S.fileName !== decodeURIComponent(path.split('/').pop())) return;
        S.fileName = null; S.dataset = null; stage.replaceChildren(); paint();
      }
    } catch { /* file://: manual file selection remains available */ }
  }
  $('uploadFile').onclick = () => $('pickFile').click();
  $('addPlugin').onclick = () => $('pickModule').click();
  B.ui.actions = { openFile, refresh: paint };
  form.hidden = !search(); paint(); B.ui.start(); scanFolder();
})();
