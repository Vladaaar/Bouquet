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
`;

  Bouquet.register({
    kind: 'renderer',
    id: 'table',
    name: 'Таблица', nameKey: 'plugin.table',
    priority: 10,
    test(table) { return !table.plain && Array.isArray(table.columns); },

    render(host, view) {
      if (!document.getElementById('bq-table-css')) {
        const s = document.createElement('style');
        s.id = 'bq-table-css'; s.textContent = css;
        document.head.appendChild(s);
      }
      const t = view.table;
      const digits = numericColumns(t, view.rows);

      const wrap = document.createElement('div');
      wrap.className = 'bq-wrap';

      if (!view.rows.length) {
        wrap.innerHTML = '<div class="bq-empty" data-i18n="tableEmpty">' + Bouquet.util.escape(Bouquet.i18n.t('tableEmpty')) + '</div>';
        host.replaceChildren(wrap);
        return;
      }

      const head = '<tr><th class="bq-num">#</th>' +
        t.columns.map((c, i) => {
          const key = t.columnKeys?.[i];
          const attrs = key ? ' data-i18n="' + Bouquet.util.escape(key) + '" data-i18n-params="' + Bouquet.util.escape(JSON.stringify({ index: i + 1 })) + '"' : '';
          return '<th' + attrs + '>' + Bouquet.util.escape(key ? Bouquet.i18n.t(key, { index: i + 1 }) : c) + '</th>';
        }).join('') + '</tr>';

      const body = view.rows.map(r =>
        '<tr><td class="bq-num">' + r.n + '</td>' +
        t.columns.map((_, i) => {
          const raw = r.cells[i] == null ? '' : String(r.cells[i]);
          const cls = digits[i] ? ' class="bq-digits"' : '';
          const long = raw.length > 46 ? ' data-long="1" title="' + Bouquet.util.escape(raw) + '"' : '';
          return '<td data-bq-row="' + (r.n) + '" data-bq-column="' + i + '"' + cls + long + '>' + view.highlight(raw) + '</td>';
        }).join('') + '</tr>'
      ).join('');

      wrap.innerHTML = '<table class="bq-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
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
