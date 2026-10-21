/* ============================================================
   Bouquet core 1.2 — реестр плагинов и утилиты
   ============================================================ */
(function () {
  const listeners = {};
  const CORE = {
    version: '1.2.0',
    plugins: [],
    interpreters: [],
    renderers: [],
    features: {},

    register(mod) {
      if (!mod || !mod.id || !mod.kind) throw new Error('Модулю нужны id и kind');
      if (CORE.plugins.some(plugin => plugin.id === mod.id)) throw new Error('Плагин уже подключён: ' + mod.id);
      CORE.plugins.push(mod);
      if (mod.kind === 'interpreter') CORE.interpreters.push(mod);
      else if (mod.kind === 'renderer') CORE.renderers.push(mod);
      else CORE.features[mod.id] = mod;
      CORE.emit('register', mod);
      return mod;
    },

    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach(fn => fn(data)); },

    /* выполнить код модуля, полученный из файла */
    exec(code, label) {
      const before = CORE.interpreters.length + CORE.renderers.length + Object.keys(CORE.features).length;
      new Function('Bouquet', code + '\n//# sourceURL=' + (label || 'module.js'))(CORE);
      const after = CORE.interpreters.length + CORE.renderers.length + Object.keys(CORE.features).length;
      if (after === before) throw new Error('Файл не зарегистрировал ни одного модуля');
    },

    util: {
      ext(name) { const m = /\.([^.\/\\]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; },
      escape(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      },
      /* грубая, но рабочая проверка «это текст?» */
      isText(bytes) {
        const n = Math.min(bytes.length, 1024);
        let bad = 0;
        for (let i = 0; i < n; i++) {
          const b = bytes[i];
          if (b === 0) return false;
          if (b < 9 || (b > 13 && b < 32)) bad++;
        }
        return bad / Math.max(n, 1) < 0.05;
      },
      decode(buffer) {
        const b = new Uint8Array(buffer);
        if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
        if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
        const start = (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) ? 3 : 0;
        return new TextDecoder('utf-8').decode(b.subarray(start));
      },
      /* привести результат интерпретатора к общему виду */
      normalize(res, fallbackName) {
        if (!res) return { name: fallbackName, tables: [] };
        if (res.tables) return { ...res, name: res.name || fallbackName, tables: res.tables };
        if (res.rows) return { name: fallbackName, tables: [res] };
        return { name: fallbackName, tables: [] };
      },
      /* текст -> таблица из одной колонки (ядро так показывает простой текст) */
      textTable(text, name) {
        return {
          name: name || 'текст', plain: true, columns: ['строка'],
          rows: text.replace(/\r\n?/g, '\n').split('\n').map(l => [l])
        };
      }
    }
  };
  window.Bouquet = CORE;

  /* --- встроенный интерпретатор: простой текст --- */
  CORE.register({
    kind: 'interpreter', id: 'core-text', name: 'Текст', priority: -100, fallback: true,
    test() { return true; },
    parse({ buffer, name }) {
      const bytes = new Uint8Array(buffer);
      if (!CORE.util.isText(bytes)) {
        return {
          name, tables: [CORE.util.textTable(
            'Формат не распознан: ' + name + ' (' + bytes.length + ' байт).\n' +
            'Подключите подходящий плагин-интерпретатор на вкладке «Плагины».', 'нет интерпретатора')]
        };
      }
      return { name, tables: [CORE.util.textTable(CORE.util.decode(buffer), name)] };
    }
  });

  /* --- встроенный вид: простой текст + запасной вид для таблиц --- */
  CORE.register({
    kind: 'renderer', id: 'core-plain', name: 'Текст', priority: -100,
    test() { return true; },
    render(host, view) {
      const pre = document.createElement('pre');
      pre.className = 'plain';
      pre.innerHTML = view.rows.map(r =>
        '<span class="ln">' + r.n + '</span>' + view.highlight(r.cells.join('\t'))
      ).join('\n') || '<span class="ln"> </span>Ничего не найдено';
      host.replaceChildren(pre);
    }
  });
})();
