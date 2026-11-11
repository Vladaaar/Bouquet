/* ============================================================
   Bouquet core 1.2 — реестр плагинов и утилиты
   ============================================================ */
(function () {
  const listeners = {};
  const CORE = {
    version: '1.3.0',
    plugins: [],
    interpreters: [],
    renderers: [],
    features: {},
    selectedPlugins: {},
    activeGroups: {},
    pluginGroup(plugin) {
      if (plugin.category === 'settings') return null;
      if (['language', 'theme'].includes(plugin.category)) return plugin.category;
      return plugin.kind === 'interpreter' ? 'format:' + (plugin.format || plugin.id) : null;
    },
    groupPlugins(group) { return CORE.plugins.filter(plugin => CORE.pluginGroup(plugin) === group).sort((a, b) => (b.priority || 0) - (a.priority || 0)); },
    activePlugin(group) {
      return group === 'language' ? CORE.i18n?.language : group === 'theme' ? CORE.ui?.theme :
        CORE.selectedPlugins[group] || CORE.activeGroups[group] || CORE.groupPlugins(group)[0]?.id;
    },
    pluginEnabled(plugin) {
      const group = CORE.pluginGroup(plugin);
      if (group === 'language' || group === 'theme') return CORE.activePlugin(group) === plugin.id;
      const selected = CORE.selectedPlugins[group];
      return !selected || selected === plugin.id;
    },
    selectPlugin(group, id) {
      if (id != null && !CORE.groupPlugins(group).some(plugin => plugin.id === id)) throw new Error('Plugin does not belong to group: ' + group);
      if (group === 'language') return CORE.i18n.setLanguage(id);
      if (group === 'theme') return CORE.ui.setTheme(id);
      if (id == null) delete CORE.selectedPlugins[group];
      else CORE.selectedPlugins[group] = id;
      CORE.emit('plugin:select', { group, id });
    },
    setPluginOptions(id, options) {
      const plugin = CORE.plugins.find(plugin => plugin.id === id);
      if (!plugin) throw new Error('Unknown plugin: ' + id);
      plugin.options = { ...plugin.options, ...options };
      CORE.emit('plugin:configure', { plugin, options: plugin.options });
    },

    register(mod) {
      if (!mod || !mod.id || !mod.kind) throw (CORE.i18n?.error('Модулю нужны id и kind') || new Error('Модулю нужны id и kind'));
      if (CORE.plugins.some(plugin => plugin.id === mod.id)) throw (CORE.i18n?.error('Плагин уже подключён: {id}', { id: mod.id }) || new Error('Плагин уже подключён: ' + mod.id));
      if (mod.category === 'language') {
        try {
          if (typeof mod.locale !== 'string' || !mod.messages || typeof mod.messages !== 'object' || Array.isArray(mod.messages)) throw new Error();
          new Intl.PluralRules(mod.locale);
        } catch { throw CORE.i18n.error('invalidLanguage'); }
      }
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
      if (after === before) throw CORE.i18n.error('Файл не зарегистрировал ни одного модуля');
    },

    util: {
      ext(name) { const m = /\.([^.\/\\]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; },
      escape(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      },
      /* грубая, но рабочая проверка «это текст?» */
      isText(bytes) {
        if (bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 254 && bytes[1] === 255) return true;
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
      messageTable(key, params, nameKey) {
        return { ...CORE.util.textTable(CORE.i18n.t(key, params), CORE.i18n.t(nameKey)), messageKey: key, messageParams: params, nameKey };
      },
      textTable(text, name) {
        return {
          name: name || CORE.i18n.t('data.text'), plain: true, columns: [CORE.i18n.t('data.line')], columnKeys: ['data.line'],
          rows: text.replace(/\r\n?/g, '\n').split('\n').map(l => [l])
        };
      }
    }
  };
  window.Bouquet = CORE;

  /* --- встроенный интерпретатор: простой текст --- */
  CORE.register({
    kind: 'interpreter', id: 'core-text', name: 'Текст', nameKey: 'plugin.text', priority: -100, fallback: true,
    loadingModes: ['memory', 'progressive'],
    test() { return true; },
    async open({ source, name, bytes, signal }) {
      const U = CORE.util;
      const head = bytes || await source.read(0, Math.min(4096, source.size), { signal });
      if (!U.isText(head)) return { name, tables: [U.messageTable('unknownFile', { name, bytes: source.size }, 'noInterpreterName')] };
      const stream = await U.textSource(source, signal);
      return { name, tables: [{ name, plain: true, columns: [CORE.i18n.t('data.line')], columnKeys: ['data.line'],
        async read({ cursor, limit = 100, match, signal, onProgress } = {}) {
          if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw CORE.i18n.error('размер порции должен быть от 1 до 10000');
          const rows = []; let n = cursor?.n || 1;
          for await (const record of stream.records(cursor?.offset ?? stream.start, null, signal)) {
            const cells = [record.text]; U.checkAbort(signal);
            if (!match || match(cells)) {
              if (rows.length === limit) return { rows, hasMore: true, nextCursor: { offset: record.start, n }, scanned: n - 1 };
              rows.push({ n, cells });
            }
            if (n++ % 128 === 0) {
              onProgress?.({ scanned: n - 1, found: rows.length, rows: rows.slice() });
              await new Promise(resolve => setTimeout(resolve, 0)); U.checkAbort(signal);
            }
          }
          return { rows, hasMore: false, nextCursor: null, total: n - 1, scanned: n - 1 };
        }
      }], close: () => stream.close() };
    },
    parse({ buffer, name }) {
      const bytes = new Uint8Array(buffer);
      if (!CORE.util.isText(bytes)) {
        return {
          name, tables: [CORE.util.messageTable('unknownFile', { name, bytes: bytes.length }, 'noInterpreterName')]
        };
      }
      return { name, tables: [CORE.util.textTable(CORE.util.decode(buffer), name)] };
    }
  });

  /* --- встроенный вид: простой текст + запасной вид для таблиц --- */
  CORE.register({
    kind: 'renderer', id: 'core-plain', name: 'Текст', nameKey: 'plugin.text', priority: -100,
    test() { return true; },
    render(host, view) {
      const pre = document.createElement('pre');
      pre.className = 'plain';
      if (view.table.messageKey) {
        const message = document.createElement('span');
        CORE.i18n.bind(message, view.table.messageKey, view.table.messageParams);
        pre.appendChild(message);
        if (view.table.messageKey === 'unknownFile') {
          const link = document.createElement('a'); link.href = '#pluginsPanel';
          CORE.i18n.bind(link, 'pluginsLink');
          link.onclick = event => {
            event.preventDefault(); CORE.ui.selectTab('settings');
            CORE.ui.elements.plugins.scrollIntoView({ block: 'start' });
            document.getElementById('addPlugin').focus({ preventScroll: true });
          };
          const period = document.createElement('span'); period.textContent = '.';
          pre.appendChild(link); pre.appendChild(period);
        }
        if (view.table.openFiles) {
          const space = document.createElement('span'); space.textContent = '\n';
          const link = document.createElement('a'); link.href = '#open'; CORE.i18n.bind(link, 'open');
          link.onclick = event => { event.preventDefault(); CORE.ui.actions.chooseFiles(); };
          pre.appendChild(space); pre.appendChild(link);
        }
        host.replaceChildren(pre); return;
      }
      pre.innerHTML = view.rows.map(r =>
        '<span class="ln">' + r.n + '</span>' + view.highlight(r.cells.join('\t'))
      ).join('\n') || '<span data-i18n="notFound">' + CORE.util.escape(CORE.i18n.t('notFound')) + '</span>';
      host.replaceChildren(pre);
    }
  });
})();
