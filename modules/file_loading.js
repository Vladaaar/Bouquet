/* Bouquet · shared byte-loading policy; format parsers remain independent. */
(function () {
  const B = Bouquet, U = B.util, MB = 1024 * 1024;
  const progressive = reader => !!reader.open && (reader.loadingModes?.includes('progressive') || reader.loadingMode === 'progressive');
  const memory = reader => (reader.loadingModes || [reader.loadingMode || 'memory']).includes('memory');
  function mode(source, reader, limitMB) {
    if (!limitMB) {
      if (reader && !progressive(reader)) throw B.i18n.error('fileLoadingProgressiveUnsupported', { name: source.name, limit: 0 });
      return 'progressive';
    }
    if (reader && !memory(reader)) return 'progressive';
    if (reader && !progressive(reader)) return 'memory';
    return source.size <= limitMB * MB ? 'memory' : 'progressive';
  }
  const plugin = B.register({
    kind: 'plugin', category: 'settings', targetGroup: 'file-loading', id: 'file-loading',
    names: { ru: 'Загрузка файлов', en: 'File loading' }, options: { memoryLimitMB: 100 },
    limitBytes() {
      const value = this.options.memoryLimitMB;
      if (!Number.isSafeInteger(value) || value < 0 || value > Math.floor(Number.MAX_SAFE_INTEGER / MB)) throw B.i18n.error('fileLoadingInvalidLimit');
      return value * MB;
    },
    mode(source, reader) { this.limitBytes(); return mode(source, reader, this.options.memoryLimitMB); },
    setMemoryLimitMB(value) {
      if (!Number.isSafeInteger(value) || value < 0 || value > Math.floor(Number.MAX_SAFE_INTEGER / MB)) throw B.i18n.error('fileLoadingInvalidLimit');
      if (value !== this.options.memoryLimitMB) B.setPluginOptions(this.id, { memoryLimitMB: value });
    },
    select(meta) {
      const candidates = B.interpreters.filter(reader => {
        try { return B.pluginEnabled(reader) && reader.test(meta); } catch { return false; }
      }).sort((a, b) => (b.priority || 0) - (a.priority || 0));
      const first = candidates[0];
      if (!first) throw B.i18n.error('noInterpreter');
      if (this.mode(meta.source) === 'memory') return first;
      const reader = candidates.find(reader => (reader === first || first.format && reader.format === first.format) && progressive(reader));
      if (!reader && !this.options.memoryLimitMB) throw B.i18n.error('fileLoadingProgressiveUnsupported', { name: meta.name, limit: 0 });
      return reader || first;
    },
    async open(reader, meta, onFullRead = () => {}) {
      this.limitBytes();
      const memoryLimitMB = this.options.memoryLimitMB;
      const prepared = new WeakMap();
      async function prepare(source, signal) {
        U.checkAbort(signal);
        if (mode(source, reader, memoryLimitMB) === 'progressive') return source;
        if (!prepared.has(source)) prepared.set(source, (async () => {
          onFullRead();
          const bytes = await source.read(0, source.size, { signal }); U.checkAbort(signal);
          const cached = Object.create(source);
          Object.defineProperty(cached, 'read', { value: async (offset, length, { signal } = {}) => {
            U.checkAbort(signal); return bytes.subarray(offset, offset + length);
          } });
          return cached;
        })());
        return prepared.get(source);
      }
      const source = await prepare(meta.source, meta.signal);
      const files = (meta.files || []).map(entry => ({ ...entry, open: async (signal = meta.signal) => prepare(await entry.open(signal), signal) }));
      const request = { ...meta, source, files, loadingMode: mode(meta.source, reader, memoryLimitMB) };
      if (reader.open) return reader.open(request);
      const bytes = await source.read(0, source.size, { signal: meta.signal }); U.checkAbort(meta.signal);
      await new Promise(resolve => setTimeout(resolve, 0)); U.checkAbort(meta.signal);
      const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return reader.parse({ ...request, bytes, buffer });
    },
    setup(ui) {
      const doc = ui.document, I = ui.i18n;
      const input = doc.createElement('input'), before = doc.createElement('span'), after = doc.createElement('span');
      input.id = 'fileLoadingLimit'; input.type = 'number'; input.min = '0'; input.step = '1'; input.required = true;
      input.max = String(Math.floor(Number.MAX_SAFE_INTEGER / MB));
      const update = () => {
        const ru = I.locale.startsWith('ru');
        before.textContent = ru ? 'Загружать файлы до ' : 'Load files up to ';
        after.textContent = ru ? ' МБ в память целиком' : ' MB entirely into memory';
        input.value = String(plugin.options.memoryLimitMB); input.setCustomValidity('');
      };
      ui.addGroupSettings({ group: 'file-loading', label: this.names, description: {
        ru: '0 — всегда прогрессивная загрузка. При ненулевом пороге большие файлы читаются прогрессивно, если формат это поддерживает, иначе — обычная загрузка. Для форматов с единственным способом загрузки ненулевой порог не учитывается. При 0 формат без прогрессивного чтения не открывается.',
        en: '0 always requires progressive loading. With a nonzero threshold, larger files use progressive reading when supported, otherwise normal loading. A nonzero threshold is ignored for formats with only one loading mode. At 0, formats without progressive reading cannot open.'
      }, mount(panel) {
        const label = doc.createElement('label'); label.className = 'file-loading-limit';
        label.appendChild(before); label.appendChild(input); label.appendChild(after); panel.appendChild(label);
      } });
      const style = doc.createElement('style');
      style.textContent = '.file-loading-limit input{width:8ch;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);font:inherit;color:inherit}';
      doc.head.appendChild(style);
      input.onchange = () => {
        try {
          if (!input.value.trim()) throw I.error('fileLoadingInvalidLimit');
          plugin.setMemoryLimitMB(Number(input.value)); input.setCustomValidity('');
        } catch (error) { input.setCustomValidity(I.errorText(error)); input.reportValidity(); }
      };
      B.on('language:change', update);
      B.on('plugin:configure', ({ plugin: changed }) => {
        if (changed.id !== plugin.id) return;
        plugin.limitBytes(); update(); ui.actions.reloadFile?.();
      });
      update();
    }
  });
})();
