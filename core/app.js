/* Bouquet UI: accepts both in-memory tables and asynchronous row sources. */
(function () {
  const B = window.Bouquet, U = B.util, I = B.i18n;
  const $ = id => document.getElementById(id);
  const fileState = $('fileState');
  const form = $('searchForm'), q = $('q'), clear = $('clear');
  const stage = $('stage'), pager = $('pager'), pos = $('pos'), status = $('status'), summary = $('dataSummary');
  const S = {
    fileName: null, source: null, bytes: null, interp: null, dataset: null,
    active: 0, query: '', page: 0, pageSize: 100, opening: false, reading: false,
    cursors: [null], total: undefined, collection: null, location: 'data'
  };
  const progressive = $('progressive');
  const MEMORY_LIMIT = 100 * 1024 * 1024;
  let opening, reading, debounce, selectionVersion = 0;
  const search = () => B.features.search;
  const setStatus = (key, params) => {
    I.bind(status, key, params);
    status.hidden = !key || ['reading', 'searching', 'progress'].includes(key);
  };
  function sourceStatus() {
    if (S.error) setStatus('openFailed', { error: () => I.errorText(S.error) });
    else if (S.source?.noteKey) setStatus(S.source.noteKey);
    else { setStatus(null); status.textContent = S.source?.note || ''; status.hidden = !status.textContent; }
  }
  function resetPages() { S.page = 0; S.cursors = [null]; S.total = undefined; S.matches = undefined; S.summaryView = null; }
  const choose = (list, value) => list.filter(m => {
    try { return m.test(value); } catch { return false; }
  }).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];

  async function openSource(load, name, { preserve = false, mode, label = preserve ? S.fileLabel : name } = {}) {
    const tableName = preserve ? S.dataset?.tables[S.active]?.name : null;
    opening?.abort(); reading?.abort(); clearTimeout(debounce);
    const request = opening = new AbortController();
    B.ui.currentView = null; B.emit('view:reset');
    S.dataset?.close?.();
    Object.assign(S, { fileName: name, fileLabel: label, source: null, dataset: null, interp: null, bytes: null,
      opening: true, reading: false, query: preserve ? S.query : '', active: 0, error: '', loadingMode: mode || null, readError: null, location: 'data' });
    resetPages(); if (!preserve) q.value = ''; clear.hidden = !q.value;
    stage.replaceChildren(); I.bind(summary, null); pager.hidden = true;
    $('emptyState').hidden = true; $('fileContent').hidden = false;
    setStatus('opening'); paintFileState(); paintNavigation();
    try {
      const source = await load(request.signal);
      U.checkAbort(request.signal);
      S.source = source;
      const bytes = await source.read(0, 4096, { signal: request.signal });
      U.checkAbort(request.signal);
      S.bytes = bytes;
      const files = (S.collection?.entries || []).map(entry => ({ name: entry.name, open: entry.load || (() => U.blobSource(entry.file)) }));
      if (!files.some(file => file.name === name)) files.push({ name, open: () => source });
      const meta = { source, name, files, ext: U.ext(name), bytes, signal: request.signal };
      const preferredMode = mode || (source.size > MEMORY_LIMIT ? 'progressive' : 'memory');
      let interpreter = choose(B.interpreters, meta);
      if (interpreter?.format && interpreter.loadingMode) {
        interpreter = choose(B.interpreters.filter(m => m.format === interpreter.format && m.loadingMode === preferredMode), meta) || interpreter;
      }
      S.interp = interpreter; S.loadingMode = interpreter.loadingMode;
      paintFileState();
      let result;
      if (interpreter.open) result = await interpreter.open(meta);
      else {
        setStatus('fullReading');
        const full = await source.read(0, source.size, { signal: request.signal });
        U.checkAbort(request.signal);
        await new Promise(resolve => setTimeout(resolve, 0));
        U.checkAbort(request.signal);
        result = await interpreter.parse({ ...meta, bytes: full,
          buffer: full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength) });
      }
      if (request.signal.aborted) { result?.close?.(); return; }
      S.dataset = U.normalize(result, name);
      if (!S.dataset.tables.length) S.dataset.tables = [U.messageTable('noTables', {}, 'empty')];
      S.active = tableName ? S.dataset.tables.findIndex(t => t.name === tableName) : S.dataset.tables.length === 1 ? 0 : -1;
      S.location = S.active < 0 ? 'tables' : 'data';
      sourceStatus();
    } catch (err) {
      if (request.signal.aborted) return;
      S.dataset = { name, tables: [{ ...U.messageTable('parseFailed', { error: () => I.errorText(err) }, 'error'), openFiles: !!err.missingFiles }] };
      S.error = err;
      sourceStatus();
    } finally {
      if (opening === request) {
        S.opening = false;
        paint();
      }
    }
  }
  function openFile(file) {
    selectionVersion++;
    if (U.ext(file.name) === 'js') return loadModuleFile(file);
    S.collection = null;
    B.ui.selectTab('explorer');
    return openSource(() => U.blobSource(file), file.name);
  }
  function cancelContent() {
    opening?.abort(); reading?.abort(); opening = reading = null; clearTimeout(debounce);
    S.opening = S.reading = false;
    B.ui.currentView = null; B.emit('view:reset');
    stage.removeAttribute('aria-busy'); pager.hidden = true;
  }
  function showCollection(name, entries, error = '', autoOpen = true, nameKey = null) {
    cancelContent(); S.dataset?.close?.();
    const items = U.groupFileEntries(entries);
    Object.assign(S, { collection: { name, entries, items, nameKey }, fileName: null, source: null,
      dataset: null, interp: null, bytes: null, active: -1, query: '', error, loadingMode: null, readError: null, location: 'files' });
    q.value = ''; clear.hidden = true; resetPages();
    B.ui.selectTab('explorer');
    if (autoOpen && items.length === 1 && !error) return openEntry(items[0]);
    paint();
  }
  function openEntry(entry) {
    selectionVersion++;
    return openSource(entry.load || (() => U.blobSource(entry.file)), entry.name, { label: entry.label || entry.name });
  }
  function openFiles(files, { folder = false } = {}) {
    if (!files.length && !folder) return;
    selectionVersion++;
    if (!folder && files.length === 1) return openFile(files[0]);
    const entries = U.fileEntries(files);
    const folderName = files[0]?.webkitRelativePath?.split('/')[0];
    const nameKey = folder ? folderName ? null : 'folder' : 'selectedFiles';
    return showCollection(folderName || I.t(nameKey), entries, '', true, nameKey);
  }
  function selectTable(active) {
    if (!S.dataset?.tables[active]) return;
    S.active = active; S.location = 'data'; resetPages(); paint();
  }
  function navigateTo(level) {
    selectionVersion++; cancelContent();
    if (level === 'tables' && S.dataset) {
      S.location = 'tables'; S.active = -1; paint();
    } else if (level === 'files' && S.collection) {
      showCollection(S.collection.name, S.collection.entries, '', false, S.collection.nameKey);
    }
  }
  function paintHeader() {
    const explorer = B.ui.activeTab === 'explorer';
    const hasContent = !!(S.fileName || S.collection);
    $('openFile').hidden = !explorer || !hasContent;
    $('settingsButton').hidden = !explorer;
    $('closeSettings').hidden = explorer;
    const crumbs = [];
    if (!explorer) {
      crumbs.push({ label: B.ui.activeLabel });
    } else {
      if (S.collection && (S.location === 'files' || S.fileLabel !== S.collection.name)) crumbs.push({ label: S.collection.nameKey ? I.t(S.collection.nameKey) : S.collection.name, level: S.location !== 'files' ? 'files' : null });
      if (S.fileName) {
        const prefix = S.collection?.name + '/';
        const label = S.fileLabel || S.fileName;
        const name = label.startsWith(prefix) ? label.slice(prefix.length) : label;
        crumbs.push({ label: name, level: S.location === 'data' && S.dataset?.tables.length > 1 ? 'tables' : null });
      }
      if (S.location === 'data' && S.dataset?.tables.length > 1) {
        crumbs.push({ label: I.label(S.dataset.tables[S.active]) });
      }
    }
    $('breadcrumbs').hidden = !crumbs.length;
    $('breadcrumbs').classList.toggle('section-path', !explorer);
    $('breadcrumbList').replaceChildren();
    crumbs.forEach(({ label, level }, index) => {
      const item = document.createElement('li');
      const current = index === crumbs.length - 1;
      const node = document.createElement(!current && level ? 'button' : 'span');
      node.textContent = label; node.title = label;
      if (current) node.setAttribute('aria-current', 'page');
      if (!current && level) {
        node.dataset.level = level;
        node.onclick = () => navigateTo(level);
      }
      item.appendChild(node); $('breadcrumbList').appendChild(item);
    });
  }
  function paintNavigation() {
    paintHeader();
    const table = S.dataset?.tables[S.active];
    form.hidden = !search() || S.location !== 'data' || !table;
  }
  function paintList() {
    B.ui.currentView = null; S.summaryView = null; stage.replaceChildren(); I.bind(summary, null); pager.hidden = true;
    const files = S.location === 'files';
    const entries = files ? S.collection.items : S.dataset.tables;
    const list = document.createElement('div'); list.className = 'entity-browser';
    const title = document.createElement('h1'); I.bind(title, files ? 'files' : 'tables');
    list.appendChild(title);
    if (!entries.length) {
      const note = document.createElement('p'); I.bind(note, S.error ? 'folderFailed' : 'emptyFolder', { error: () => I.errorText(S.error) }); list.appendChild(note);
    }
    const items = document.createElement('ul'); items.className = 'entity-list';
    entries.forEach((entry, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button'); button.className = 'entity-button';
      if (entry.nameKey) I.bind(button, entry.nameKey);
      else if (entry.name) button.textContent = entry.label || entry.name;
      else I.bind(button, 'table', { index: i + 1 });
      button.onclick = () => files ? openEntry(entry) : selectTable(i);
      item.appendChild(button); items.appendChild(item);
    });
    list.appendChild(items); stage.appendChild(list);
    setStatus(null);
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
      I.bind($('pluginStatus'), 'pluginLoaded', { name: file.name });
    } catch (err) {
      I.bind($('pluginStatus'), 'pluginFailed', { error: () => I.errorText(err) });
      B.ui.selectTab('settings');
    }
  }

  function paintSummary(view) {
    S.summaryView = view;
    summary.textContent = [
      I.t(view.foundExact ? 'summaryFound' : 'summaryFoundMinimum', { count: view.found }),
      I.t('summaryScanned', { count: view.scanned }),
      view.total == null ? null : I.t('summaryTotal', { count: view.total })
    ].filter(Boolean).join(' · ');
    summary.title = summary.textContent;
    fileState.setAttribute('aria-label', summary.textContent);
  }
  function renderView(view) {
    paintSummary(view);
    choose(B.renderers, view.table).render(stage, view);
    B.ui.currentView = { host: stage, view };
    B.emit('view:render', B.ui.currentView);
  }

  async function currentView(signal) {
    const table = S.dataset?.tables[S.active];
    if (!table) return null;
    const feature = search(), query = S.query;
    let rows, total, found, foundExact, hasMore, pages, scanned = 0;
    if (table.read) {
      let match, shown = 0;
      if (feature && query.trim()) {
        match = feature.compile ? feature.compile(table, query)
          : cells => feature.filter({ ...table, rows: [cells] }, query).length > 0;
      }
      const result = await table.read({ cursor: S.cursors[S.page], limit: S.pageSize, match, signal,
        onProgress({ scanned: count, found, rows: partial }) {
          if (signal.aborted) return;
          scanned = count ?? scanned;
          const view = { dataset: S.dataset, table, query, rows: partial || [], total: S.total, scanned,
            found: S.page * S.pageSize + found, foundExact: false,
            page: S.page, pageSize: S.pageSize,
            highlight: feature && query.trim() ? value => feature.highlight(value, query) : U.escape };
          paintSummary(view);
          if (partial?.length && partial.length !== shown) {
            shown = partial.length;
            renderView(view);
          }
        }
      });
      U.checkAbort(signal);
      rows = result.rows;
      scanned = result.scanned ?? Math.max(scanned, S.page * S.pageSize + rows.length);
      hasMore = result.hasMore;
      if (hasMore) S.cursors[S.page + 1] = result.nextCursor;
      if (result.total != null) S.total = result.total;
      total = S.total;
      if (!hasMore) S.matches = S.page * S.pageSize + rows.length;
      found = S.matches ?? S.page * S.pageSize + rows.length;
      foundExact = S.matches != null;
      if (!match && total != null) { found = total; foundExact = true; }
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
      scanned = indices ? all.length : from + rows.length;
    }
    return { dataset: S.dataset, table, query, rows, total, found, foundExact, hasMore, scanned,
      page: S.page, pages, pageSize: S.pageSize,
      highlight: feature && query.trim() ? value => feature.highlight(value, query) : U.escape };
  }

  async function paint() {
    B.emit('view:reset');
    reading?.abort(); clearTimeout(debounce);
    S.reading = false; paintFileState(); paintNavigation();
    const hasContent = !!(S.fileName || S.collection);
    $('emptyState').hidden = hasContent;
    $('fileContent').hidden = !hasContent;
    if (S.opening) return;
    if (S.location !== 'data') { paintList(); return; }
    if (!S.dataset) { pager.hidden = true; return; }
    // Keep the current table in place until the new result is ready.
    const request = reading = new AbortController();
    S.reading = true; S.readError = null; paintFileState();
    paintSummary({ found: S.page * S.pageSize, foundExact: false, scanned: 0, total: S.total });
    stage.setAttribute('aria-busy', 'true');
    $('prev').disabled = $('next').disabled = true;
    setStatus(S.query.trim() ? 'searching' : 'reading');
    try {
      const view = await currentView(request.signal);
      U.checkAbort(request.signal);
      renderView(view);
      pager.hidden = !view.hasMore && view.page === 0;
      pos.textContent = (view.page + 1) + (view.pages == null ? ' / …' : ' / ' + view.pages);
      $('prev').disabled = view.page === 0;
      $('next').disabled = !view.hasMore;
      sourceStatus();
    } catch (err) {
      if (request.signal.aborted) return;
      S.readError = err; setStatus('readFailed', { error: () => I.errorText(err) });
      stage.replaceChildren();
      pager.hidden = S.page === 0;
      $('prev').disabled = S.page === 0;
    } finally {
      if (reading === request) {
        S.reading = false; paintFileState(); stage.removeAttribute('aria-busy');
      }
    }
  }
  progressive.onchange = () => {
    if (progressive.disabled || !S.source) return;
    const source = S.source;
    openSource(() => source, S.fileName, { preserve: true, mode: progressive.checked ? 'progressive' : 'memory' });
  };
  function paintFileState() {
    fileState.hidden = S.location !== 'data';
    I.bind($('interpreterInfo'), S.interp ? 'interpreter' : 'noInterpreter', { name: () => I.label(S.interp) });
    progressive.checked = S.loadingMode === 'progressive';
    const alternatives = B.interpreters.filter(m => m.format === S.interp?.format && m.loadingMode);
    progressive.disabled = S.opening || !alternatives.some(m => m.loadingMode === 'memory') || !alternatives.some(m => m.loadingMode === 'progressive');
    I.bind($('loadingHint'), !S.interp?.loadingMode ? 'chooseSQLite' : 'modeHint');
    const busy = S.opening || S.reading;
    const ready = S.interp && (!S.interp.fallback || U.isText(S.bytes || new Uint8Array()));
    fileState.dataset.state = busy ? 'loading' : S.error || S.readError || (!S.fileName && !S.collection) ? 'stop' : S.location === 'files' ? 'go' : ready ? 'go' : 'wait';
  }
  $('openFile').onclick = () => $('pickFile').click();
  $('pickFile').onchange = e => { openFiles(Array.from(e.target.files)); e.target.value = ''; };
  $('pickModule').onchange = e => { if (e.target.files[0]) loadModuleFile(e.target.files[0]); e.target.value = ''; };
  form.onsubmit = e => {
    e.preventDefault(); S.query = q.value; resetPages();
    if (S.location !== 'data' || !S.dataset) return;
    paint();
  };
  q.oninput = () => {
    clear.hidden = !q.value;
    S.query = q.value; resetPages();
    if (S.location !== 'data' || !S.dataset) return;
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
    else if (e.key === '/' && !editing && !form.hidden) { e.preventDefault(); q.focus(); }
    else if (!pager.hidden && !editing) {
      if (e.key === 'ArrowRight' && !$('next').disabled) $('next').click();
      if (e.key === 'ArrowLeft' && !$('prev').disabled) $('prev').click();
    }
  });
  let dragDepth = 0;
  addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth) document.body.classList.add('dragging'); });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    // Capture entries during the event: the browser clears DataTransfer afterwards.
    const items = Array.from(e.dataTransfer.items || []).filter(item => item.kind === 'file')
      .map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.() }));
    if (!items.length) return openFiles(Array.from(e.dataTransfer.files));
    const version = ++selectionVersion;
    try {
      const entries = await U.dropEntries(items);
      if (version !== selectionVersion) return;
      if (items.length === 1 && !items[0].entry?.isDirectory && entries.length === 1) return openFile(entries[0].file);
      const folder = items.length === 1 && items[0].entry?.isDirectory;
      showCollection(folder ? items[0].entry.name : I.t('selectedFiles'), entries, '', true, folder ? null : 'selectedFiles');
    } catch (error) {
      if (version === selectionVersion) showCollection(I.t('folder'), [], error, false, 'folder');
    }
  });
  B.on('register', plugin => {
    paintNavigation(); paintFileState();
    if (plugin.kind === 'interpreter' && plugin.groupFiles && S.collection && S.location === 'files') {
      showCollection(S.collection.name, S.collection.entries, S.error, true, S.collection.nameKey);
    }
  });
  B.on('tab:change', paintHeader);
  B.on('language:change', () => {
    paintHeader(); paintFileState();
    if (S.summaryView) paintSummary(S.summaryView);
  });
  async function scanFolder() {
    const version = selectionVersion;
    try {
      const response = await fetch('bouquet.files.json', { cache: 'no-store' });
      if (!response.ok || version !== selectionVersion) return;
      const paths = (await response.json()).files || [], entries = [];
      for (const path of paths) {
        if (version !== selectionVersion) return;
        try {
          const source = await U.urlSource(path);
          entries.push({ name: decodeURIComponent(path), load: () => source });
        } catch { /* Unavailable manifest entries do not appear in the list. */ }
      }
      if (version !== selectionVersion || !entries.length) return;
      const directory = entries[0].name.includes('/') ? entries[0].name.split('/').slice(0, -1).join('/') : '';
      const common = directory && entries.every(entry => entry.name.startsWith(directory + '/'));
      showCollection(common ? directory : I.t('projectFiles'), entries, '', true, common ? null : 'projectFiles');
    } catch { /* file://: manual file and folder selection remains available */ }
  }
  $('uploadFile').onclick = () => $('pickFile').click();
  $('addPlugin').onclick = () => $('pickModule').click();
  B.ui.actions = { openFile, openFiles, chooseFiles: () => $('pickFile').click(), refresh: paint };
  form.hidden = !search(); paint(); B.ui.start(); scanFolder();
})();
