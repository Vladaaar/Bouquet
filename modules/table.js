/* Bouquet · модуль table — показ данных таблицей */
(function () {
  const css = `
.bq-meta{flex:none;color:var(--muted);font-size:13px;padding:0 6px 8px;display:flex;gap:10px;flex-wrap:wrap}
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
    name: 'Таблица',
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

      const meta = document.createElement('div');
      meta.className = 'bq-meta';
      meta.textContent = [
        view.total == null ? 'число строк пока неизвестно' : plural(view.total, 'строка', 'строки', 'строк'),
        t.columns.length + ' кол.',
        view.query.trim() ? 'найдено ' + (view.foundExact ? '' : 'не менее ') + view.found : null,
        t.note
      ].filter(Boolean).join(' · ');

      const wrap = document.createElement('div');
      wrap.className = 'bq-wrap';

      if (!view.rows.length) {
        wrap.innerHTML = '<div class="bq-empty">Ничего не нашлось. Попробуйте короче или очистите поиск.</div>';
        host.replaceChildren(meta, wrap);
        return;
      }

      const head = '<tr><th class="bq-num">#</th>' +
        t.columns.map(c => '<th>' + Bouquet.util.escape(c) + '</th>').join('') + '</tr>';

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
      host.replaceChildren(meta, wrap);
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

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    const word = (a > 10 && a < 20) ? many : b === 1 ? one : (b > 1 && b < 5) ? few : many;
    return n.toLocaleString('ru-RU') + ' ' + word;
  }
})();
