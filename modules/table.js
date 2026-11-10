/* Bouquet · модуль table — показ данных таблицей */
(function () {
  const css = `
.bq-wrap{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-box);overflow:auto;
  flex:1;min-height:0;max-width:100%;scrollbar-gutter:stable}
.bq-table{border-collapse:separate;border-spacing:0;width:100%;font-size:14px}
.bq-table th,.bq-table td{padding:9px 14px;text-align:left;vertical-align:top;
  border-bottom:1px solid var(--line);max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bq-table thead th{position:sticky;top:0;z-index:2;background:var(--surface);font-weight:600;
  box-shadow:inset 0 -1px 0 var(--line);border-bottom:0}
.bq-table tbody tr:last-child td{border-bottom:0}
.bq-table tbody tr:hover td{background:color-mix(in srgb,var(--iris) 6%,transparent)}
.bq-num{color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;width:1%;
  font-size:12.5px;padding-right:6px!important;user-select:none}
.bq-table td.bq-digits{font-variant-numeric:tabular-nums;text-align:right}
.bq-table td.open{white-space:pre-wrap;word-break:break-word;max-width:60ch;cursor:zoom-out}
.bq-table td[data-long]{cursor:zoom-in}
.bq-empty{padding:34px;text-align:center;color:var(--muted)}
.bq-table thead .bq-controls{right:0;z-index:3;width:44px;padding:3px;background:var(--surface)}
.bq-fullscreen-button{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;color:var(--muted)}
.bq-fullscreen-button:hover{background:var(--canvas);color:var(--ink)}
.bq-fullscreen-button svg{width:20px;height:20px}
.bq-fullscreen .app-header,.bq-fullscreen .bar,.bq-fullscreen .data-status,.bq-fullscreen .read-notice{display:none}
.bq-fullscreen .file-content{padding:0}
.bq-fullscreen .stage{width:100%;padding:0}
.bq-fullscreen .bq-wrap{border:0;border-radius:0}
`;

  // Viewport mode belongs to the table renderer; no browser Fullscreen API needed.
  let fullscreen = false, host, button;
  function setFullscreen(value) {
    fullscreen = value;
    document.getElementById('app').classList.toggle('bq-fullscreen', value);
    if (!button) return;
    const key = value ? 'tableExitFullscreen' : 'tableFullscreen';
    button.dataset.i18nTitle = button.dataset.i18nAriaLabel = key;
    button.title = Bouquet.i18n.t(key);
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(value));
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="' +
      (value ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6') + '"/></svg>';
  }

  Bouquet.register({
    kind: 'renderer',
    id: 'table',
    name: 'Таблица', nameKey: 'plugin.table',
    priority: 10,
    test(table) { return !table.plain && Array.isArray(table.columns); },

    setup() {
      document.addEventListener('keydown', e => {
        if (fullscreen && e.key === 'Escape') {
          e.preventDefault(); setFullscreen(false); button?.focus({ preventScroll: true });
        }
        // Do not let the application focus its hidden search field.
        if (fullscreen && e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) {
          e.preventDefault(); e.stopPropagation();
        }
      });
      Bouquet.on('tab:change', ({ id }) => { if (id !== 'explorer') setFullscreen(false); });
      // Pagination replaces the wrapper; navigation/errors remove it entirely.
      new MutationObserver(() => {
        if (fullscreen && !host?.querySelector('.bq-wrap')) setFullscreen(false);
      }).observe(document.getElementById('stage'), { childList: true });
    },

    render(target, view) {
      host = target;
      if (!document.getElementById('bq-table-css')) {
        const s = document.createElement('style');
        s.id = 'bq-table-css'; s.textContent = css;
        document.head.appendChild(s);
      }
      const t = view.table;
      const digits = numericColumns(t, view.rows);

      const wrap = document.createElement('div');
      wrap.className = 'bq-wrap';

      const head = '<tr><th class="bq-num">#</th>' +
        t.columns.map((c, i) => {
          const key = t.columnKeys?.[i];
          const attrs = key ? ' data-i18n="' + Bouquet.util.escape(key) + '" data-i18n-params="' + Bouquet.util.escape(JSON.stringify({ index: i + 1 })) + '"' : '';
          return '<th' + attrs + '>' + Bouquet.util.escape(key ? Bouquet.i18n.t(key, { index: i + 1 }) : c) + '</th>';
        }).join('') + '<th class="bq-controls"></th></tr>';

      const body = view.rows.map(r =>
        '<tr><td class="bq-num">' + r.n + '</td>' +
        t.columns.map((_, i) => {
          const raw = r.cells[i] == null ? '' : String(r.cells[i]);
          const cls = digits[i] ? ' class="bq-digits"' : '';
          const long = raw.length > 46 ? ' data-long="1" title="' + Bouquet.util.escape(raw) + '"' : '';
          return '<td data-bq-row="' + (r.n) + '" data-bq-column="' + i + '"' + cls + long + '>' + view.highlight(raw) + '</td>';
        }).join('') + '<td aria-hidden="true"></td></tr>'
      ).join('');

      wrap.innerHTML = '<table class="bq-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
      button = document.createElement('button');
      button.type = 'button'; button.className = 'bq-fullscreen-button';
      button.onclick = () => setFullscreen(!fullscreen);
      wrap.querySelector('.bq-controls').appendChild(button);
      setFullscreen(fullscreen);
      if (!view.rows.length) {
        const empty = document.createElement('div');
        empty.className = 'bq-empty'; Bouquet.i18n.bind(empty, 'tableEmpty');
        wrap.appendChild(empty);
      }
      wrap.querySelector('tbody').addEventListener('click', e => {
        const td = e.target.closest('td[data-long]');
        if (td) td.classList.toggle('open');
      });
      host.replaceChildren(wrap);
    }
  });

  function numericColumns(t, rows) {
    const sample = rows.slice(0, 50).map(r => r.cells);
    return t.columns.map((_, i) => {
      let seen = 0;
      for (const r of sample) {
        const v = r[i];
        if (v === '' || v == null) continue;
        if (typeof v === 'number' || /^-?\d[\d\s.,]*$/.test(String(v))) seen++;
        else return false;
      }
      return seen > 0;
    });
  }

})();
