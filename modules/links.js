/* Bouquet · declared SQLite relationships, independently paginated in a drawer. */
(function () {
  const B = Bouquet, I = B.i18n, cache = new WeakMap();
  const lower = value => String(value).toLowerCase();
  // Tokenize instead of matching SQL inside string literals, comments or identifiers.
  function tokens(sql) {
    const result = [];
    const re = /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|"(?:""|[^"])*"|'(?:''|[^'])*'|`(?:``|[^`])*`|\[[^\]]*\]|[(),]|[^\s(),"'`\[]+/g;
    for (const [raw] of sql.matchAll(re)) {
      if (/^\s|^--|^\/\*/.test(raw)) continue;
      const quoted = /^['"`\[]/.test(raw);
      result.push({ value: quoted ? raw.slice(1, -1).replace(/""/g, '"').replace(/''/g, "'").replace(/``/g, '`') : raw,
        keyword: quoted ? '' : raw.toUpperCase() });
    }
    return result;
  }
  function group(ts, start) {
    let depth = 1, end = start + 1;
    for (; end < ts.length; end++) {
      if (ts[end].keyword === '(') depth++;
      if (ts[end].keyword === ')' && --depth === 0) break;
    }
    return { body: ts.slice(start + 1, end), end };
  }
  function parts(ts) {
    const out = [[]]; let depth = 0;
    for (const t of ts) {
      if (t.keyword === ',' && depth === 0) { out.push([]); continue; }
      out.at(-1).push(t);
      if (t.keyword === '(') depth++;
      if (t.keyword === ')') depth--;
    }
    return out;
  }
  function topLevel(ts) {
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].keyword === '(') { i = group(ts, i).end; continue; }
      out.push(ts[i]);
    }
    return out;
  }
  function schema(sql = '') {
    const ts = tokens(sql), open = ts.findIndex(t => t.keyword === '(');
    const result = { primary: [], foreign: [], columns: new Map() };
    if (open < 0) return result;
    for (let part of parts(group(ts, open).body)) {
      if (part[0]?.keyword === 'CONSTRAINT') part = part.slice(2);
      const names = start => parts(group(part, start).body).map(p => p[0]?.value);
      if (part[0]?.keyword === 'PRIMARY' && part[1]?.keyword === 'KEY') {
        result.primary = names(2); continue;
      }
      const foreign = part[0]?.keyword === 'FOREIGN' && part[1]?.keyword === 'KEY';
      if (['UNIQUE', 'CHECK'].includes(part[0]?.keyword)) continue;
      let source, tail;
      if (foreign) { source = names(2); tail = topLevel(part.slice(group(part, 2).end + 1)); }
      else {
        if (!part[0]) continue;
        source = [part[0].value]; tail = topLevel(part.slice(1));
        if (tail.some((t, i) => t.keyword === 'PRIMARY' && tail[i + 1]?.keyword === 'KEY')) result.primary = source;
        const collate = tail.findIndex(t => t.keyword === 'COLLATE');
        const constraints = new Set(['CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'REFERENCES', 'GENERATED', 'AS']);
        const end = tail.findIndex(t => constraints.has(t.keyword));
        const type = tail.slice(0, end < 0 ? tail.length : end).map(t => t.value).join(' ').toUpperCase();
        const affinity = /INT/.test(type) ? 'numeric' : /CHAR|CLOB|TEXT/.test(type) ? 'text' : !type || /BLOB/.test(type) ? 'none' : 'numeric';
        result.columns.set(lower(source[0]), { affinity,
          collation: collate < 0 ? 'BINARY' : (tail[collate + 1]?.value || '').toUpperCase() });
      }
      // Locate REFERENCES at top level, retaining the target column list.
      for (let i = foreign ? group(part, 2).end + 1 : 1; i < part.length; i++) {
        if (part[i].keyword === '(') { i = group(part, i).end; continue; }
        if (part[i].keyword !== 'REFERENCES' || !part[i + 1]) continue;
        result.foreign.push({ source, table: part[i + 1].value,
          target: part[i + 2]?.keyword === '(' ? names(i + 2) : null });
        break;
      }
    }
    return result;
  }
  function relations(dataset) {
    if (cache.has(dataset)) return cache.get(dataset);
    const schemas = new Map(dataset.tables.map(table => [table, schema(table.schemaSQL)]));
    const result = [];
    for (const source of dataset.tables) {
      for (const fk of schemas.get(source).foreign) {
        const target = dataset.tables.find(table => lower(table.name) === lower(fk.table));
        if (!target) continue;
        const targetNames = fk.target || schemas.get(target).primary;
        const from = fk.source.map(name => source.columns.findIndex(c => lower(c) === lower(name)));
        const to = targetNames.map(name => target.columns.findIndex(c => lower(c) === lower(name)));
        if (!from.length || from.length !== to.length || [...from, ...to].some(i => i < 0)) continue;
        const comparison = to.map(i => schemas.get(target).columns.get(lower(target.columns[i])) || {});
        if (comparison.some(spec => spec.collation && !['BINARY', 'NOCASE', 'RTRIM'].includes(spec.collation))) continue;
        result.push({ source, target, from, to, comparison });
      }
    }
    cache.set(dataset, result); return result;
  }
  function equal(a, b, spec) {
    if (a == null || b == null) return false;
    // The readers expose BLOBs as summaries, not comparable binary values.
    if (/^‹blob \d+ Б›$/.test(String(a)) || /^‹blob \d+ Б›$/.test(String(b))) return false;
    if (spec.affinity === 'numeric') {
      const number = value => {
        const s = String(value).trim();
        if (/^[+-]?\d+$/.test(s)) return BigInt(s);
        return s && Number.isFinite(Number(s)) ? Number(s) : null;
      };
      const x = number(a), y = number(b);
      if (x != null && y != null) return x == y; // Numeric affinity; BigInt retains large integer keys.
    }
    if (spec.affinity === 'none' && typeof a !== typeof b) return false;
    let x = String(a), y = String(b);
    if (spec.collation === 'NOCASE') {
      const fold = s => s.replace(/[A-Z]/g, c => c.toLowerCase()); x = fold(x); y = fold(y);
    } else if (spec.collation === 'RTRIM') { x = x.replace(/ +$/, ''); y = y.replace(/ +$/, ''); }
    else if (spec.collation && spec.collation !== 'BINARY') return false;
    return x === y;
  }
  function neighbors(dataset, table, cells, column) {
    const result = [];
    for (const link of relations(dataset)) {
      for (const reverse of [false, true]) {
        const local = reverse ? link.target : link.source;
        const from = reverse ? link.to : link.from, to = reverse ? link.from : link.to;
        if (local !== table || !from.includes(column) || from.some(i => cells[i] == null)) continue;
        result.push({ table: reverse ? link.source : link.target, columns: to,
          values: from.map(i => cells[i]), comparison: link.comparison, reverse });
      }
    }
    return result;
  }
  async function read(link, { cursor = null, limit = 50, signal, onProgress } = {}) {
    B.util.checkAbort(signal);
    const match = cells => link.columns.every((column, i) => equal(link.values[i], cells[column], link.comparison[i]));
    if (link.table.read) return link.table.read({ cursor, limit, match, signal, onProgress });
    const rows = [], all = link.table.rows || [];
    for (let i = cursor || 0; i < all.length; i++) {
      B.util.checkAbort(signal);
      if (match(all[i])) {
        if (rows.length === limit) return { rows, hasMore: true, nextCursor: i };
        rows.push({ n: i + 1, cells: all[i] });
      }
      if (i % 512 === 511) {
        onProgress?.({ scanned: i + 1 });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    B.util.checkAbort(signal);
    return { rows, hasMore: false, nextCursor: null };
  }

  B.register({ kind: 'plugin', id: 'links', name: 'Связи таблиц', nameKey: 'plugin.links', schema, relations, neighbors, read,
    setup(ui) {
      const doc = ui.document;
      const style = doc.createElement('style');
      style.textContent = `
.bq-link{display:inline-grid;place-items:center;vertical-align:middle;margin-right:7px;padding:1px 5px;
  border:1px solid var(--line);border-radius:8px;color:var(--iris);font-size:16px;line-height:1.3}
.bq-link:hover{background:var(--canvas)}
.bq-links-drawer{position:fixed;inset:0 0 0 auto;margin:0;width:min(560px,100%);max-width:100%;height:100dvh;max-height:100dvh;
  padding:24px;border:0;border-left:1px solid var(--line);background:var(--surface);color:var(--ink);overflow:auto;box-shadow:var(--shadow)}
.bq-links-drawer::backdrop{background:rgba(0,0,0,.25)}
.bq-links-header{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}
.bq-links-header h2{margin:0;font-size:20px;overflow-wrap:anywhere}
.bq-links-close{font-size:24px;line-height:1;width:36px;height:36px;flex:none}
.bq-links-group{border-top:1px solid var(--line);padding:18px 0;margin-top:18px}
.bq-links-group h3{margin:0 0 8px;overflow-wrap:anywhere}
.bq-links-group p{color:var(--muted);overflow-wrap:anywhere}
.bq-links-record{margin:12px 0;padding:14px;background:var(--canvas);border-radius:14px}
.bq-links-record dt{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.bq-links-record dd{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
.bq-links-more{border:1px solid var(--line);padding:8px 14px;border-radius:999px}
`;
      doc.head.appendChild(style);
      const drawer = doc.createElement('dialog'); drawer.className = 'bq-links-drawer';
      drawer.setAttribute('aria-labelledby', 'bq-links-title');
      ui.root.appendChild(drawer);
      let controller, trigger;
      const close = () => {
        controller?.abort();
        if (drawer.open) drawer.close();
        if (trigger?.isConnected && ui.activeTab === 'explorer') trigger.focus();
        trigger = null;
      };
      // Keep application search/pagination shortcuts outside the modal drawer.
      drawer.addEventListener('keydown', event => event.stopPropagation());
      drawer.addEventListener('cancel', event => { event.preventDefault(); close(); });
      drawer.addEventListener('click', event => {
        if (event.target !== drawer) return;
        const rect = drawer.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      });
      const element = (tag, text, className) => {
        const el = doc.createElement(tag); if (text != null) el.textContent = text;
        if (className) el.className = className; return el;
      };
      function show(links, table, column, button) {
        close(); trigger = button;
        const request = controller = new AbortController();
        drawer.replaceChildren();
        const header = element('header', null, 'bq-links-header');
        const title = element('h2', table.name + ' · ' + table.columns[column]); title.id = 'bq-links-title';
        const dismiss = element('button', '×', 'bq-links-close'); dismiss.setAttribute('aria-label', I.t('links.close')); dismiss.setAttribute('data-i18n-aria-label', 'links.close');
        dismiss.onclick = close; header.append(title, dismiss); drawer.appendChild(header);
        for (const link of links) {
          const section = element('section', null, 'bq-links-group');
          section.appendChild(element('h3', link.table.name));
          const relation = element('p'); I.bind(relation, link.reverse ? 'links.reverse' : 'links.forward', {
            fields: link.columns.map((c, i) => link.table.columns[c] + ' = ' + link.values[i]).join(', ') });
          section.appendChild(relation);
          const status = element('p'); I.bind(status, 'links.searching'); status.setAttribute('role', 'status');
          const records = element('div');
          const more = element('button', null, 'bq-links-more'); I.bind(more, 'links.next'); more.hidden = true;
          section.append(status, records, more); drawer.appendChild(section);
          let cursor = null, page = 0;
          async function load() {
            more.disabled = true; I.bind(status, 'links.searching');
            section.setAttribute('aria-busy', 'true');
            try {
              const result = await read(link, { cursor, signal: request.signal, onProgress({ scanned }) {
                if (!request.signal.aborted) I.bind(status, 'links.progress', { count: scanned });
              } });
              B.util.checkAbort(request.signal);
              records.replaceChildren();
              for (const row of result.rows) {
                const record = element('dl', null, 'bq-links-record');
                link.table.columns.forEach((name, i) => record.append(element('dt', name), element('dd', row.cells[i] == null ? 'NULL' : String(row.cells[i]))));
                records.appendChild(record);
              }
              I.bind(status, result.rows.length ? 'links.page' : 'links.empty', { page: ++page, count: result.rows.length });
              cursor = result.nextCursor; more.hidden = !result.hasMore;
            } catch (error) {
              if (!request.signal.aborted) { I.bind(status, 'links.failed', { error: () => I.errorText(error) }); more.hidden = true; }
            } finally { if (!request.signal.aborted) { more.disabled = false; section.removeAttribute('aria-busy'); } }
          }
          more.onclick = load; load();
        }
        drawer.showModal(); dismiss.focus();
      }
      function decorate({ host, view }) {
        close();
        const rows = new Map(view.rows.map(row => [String(row.n), row.cells]));
        for (const cell of host.querySelectorAll('td[data-bq-row][data-bq-column]')) {
          cell.querySelector('.bq-link')?.remove();
          const cells = rows.get(cell.dataset.bqRow), column = Number(cell.dataset.bqColumn);
          if (!cells) continue;
          const links = neighbors(view.dataset, view.table, cells, column);
          if (!links.length) continue;
          const button = element('button', '🔗', 'bq-link');
          button.type = 'button';
          button.i18nParams = { names: [...new Set(links.map(link => link.table.name))].join(', ') };
          button.title = I.t('links.title', button.i18nParams);
          button.setAttribute('data-i18n-title', 'links.title');
          button.setAttribute('data-i18n-aria-label', 'links.title');
          button.setAttribute('aria-label', button.title);
          button.setAttribute('aria-haspopup', 'dialog');
          button.onclick = event => { event.stopPropagation(); show(links, view.table, column, button); };
          cell.prepend(button);
        }
      }
      B.on('view:render', decorate);
      B.on('view:reset', close);
      B.on('tab:change', close);
      if (ui.currentView) decorate(ui.currentView);
    }
  });
})();
