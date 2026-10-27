/* Bouquet · модуль search — фильтрация строк и подсветка совпадений.
   Синтаксис: слова через пробел = И, "точная фраза", -исключить, колонка:значение */
(function () {
  const cache = new WeakMap();   /* таблица -> строки в нижнем регистре */

  Bouquet.register({
    kind: 'feature',
    id: 'search',
    name: 'Поиск', nameKey: 'plugin.search',

    /* Compile once; usable with lazy sources without a whole-table cache. */
    compile(table, query) {
      const cols = table.columns.map(c => String(c).toLowerCase());
      const terms = parse(query).map(t => ({ ...t, ci: t.col ? cols.findIndex(c => c.startsWith(t.col)) : -1 }));
      return cells => {
        let hay;
        return terms.every(t => {
          const hit = t.col
            ? t.ci >= 0 && String(cells[t.ci] ?? '').toLowerCase().includes(t.text)
            : (hay ??= cells.join('\u0001').toLowerCase()).includes(t.text);
          return hit !== t.neg;
        });
      };
    },

    /* -> массив индексов подходящих строк */
    filter(table, query) {
      const terms = parse(query);
      const out = [];
      if (!terms.length) { for (let i = 0; i < table.rows.length; i++) out.push(i); return out; }

      const hay = haystack(table);
      const cols = table.columns.map(c => String(c).toLowerCase());

      for (let i = 0; i < table.rows.length; i++) {
        let ok = true;
        for (const t of terms) {
          let hit;
          if (t.col) {
            const ci = cols.findIndex(c => c.startsWith(t.col));
            hit = ci >= 0 && String(table.rows[i][ci] ?? '').toLowerCase().includes(t.text);
          } else {
            hit = hay[i].includes(t.text);
          }
          if (hit === t.neg) { ok = false; break; }
        }
        if (ok) out.push(i);
      }
      return out;
    },

    /* -> безопасный HTML с <mark> */
    highlight(value, query) {
      const s = String(value == null ? '' : value);
      const terms = parse(query).filter(t => !t.neg && t.text).map(t => t.text);
      if (!terms.length) return Bouquet.util.escape(s);

      const low = s.toLowerCase();
      const spans = [];
      for (const t of terms) {
        let from = 0, i;
        while ((i = low.indexOf(t, from)) !== -1) { spans.push([i, i + t.length]); from = i + t.length; }
      }
      if (!spans.length) return Bouquet.util.escape(s);

      spans.sort((a, b) => a[0] - b[0]);
      const merged = [spans[0]];
      for (const sp of spans.slice(1)) {
        const last = merged[merged.length - 1];
        if (sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
        else merged.push(sp);
      }

      let html = '', at = 0;
      for (const [a, b] of merged) {
        html += Bouquet.util.escape(s.slice(at, a)) + '<mark>' + Bouquet.util.escape(s.slice(a, b)) + '</mark>';
        at = b;
      }
      return html + Bouquet.util.escape(s.slice(at));
    }
  });

  function haystack(table) {
    let hay = cache.get(table);
    if (!hay) {
      hay = table.rows.map(r => r.join('\u0001').toLowerCase());
      cache.set(table, hay);
    }
    return hay;
  }

  function parse(query) {
    const terms = [];
    const re = /(-?)(?:([\wа-яё]+):)?(?:"([^"]*)"|(\S+))/gi;
    let m;
    while ((m = re.exec(query || '')) !== null) {
      const text = (m[3] ?? m[4] ?? '').toLowerCase();
      if (!text) continue;
      terms.push({ neg: m[1] === '-', col: (m[2] || '').toLowerCase(), text });
    }
    return terms;
  }
})();
