/* Bouquet · keyboard commands. See shortcuts/README.md. */
(function () {
  const B = Bouquet;
  B.register({
    kind: 'plugin', category: 'settings', targetGroup: 'shortcuts', id: 'shortcuts', names: { ru: 'Горячие клавиши', en: 'Keyboard shortcuts' },
    setup(ui) {
      const doc = ui.document, I = ui.i18n, $ = id => doc.getElementById(id);
      const mac = /mac|iphone|ipad/i.test(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '');
      const settingsKey = mac ? 'Cmd + ,' : 'Ctrl + ,';
      const editing = node => /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName) || node?.isContentEditable;
      const texts = () => I.locale.startsWith('ru') ? {
        rows: [
          ['O', 'Открыть файл'], ['W', 'Закрыть текущий уровень просмотра или настройки (крестик ×)'],
          ['F', 'Включить или выключить полноэкранную таблицу'], ['P', 'Закрепить или открепить шапку и номера строк'], ['Esc', 'Выйти из полноэкранного режима; закрыть активный диалог'],
          ['/', 'Перейти в поиск (сначала выйдите из полноэкранного режима)'], ['?', 'Перейти к горячим клавишам в конце настроек'],
          [settingsKey, 'Открыть настройки'], ['← ↑ → ↓', 'Прокрутить содержимое, если фокус не на другом элементе'],
          ['[ / ]', 'Предыдущая / следующая страница'], ['Home / End', 'Первая / последняя страница']
        ],
        note: 'Обычные клавиши не перехватывают ввод текста; настройки и Esc остаются доступны. При прогрессивном чтении End последовательно читает оставшиеся страницы; поиск, навигация или Home прерывают переход. Навигация стрелками по ячейкам пока не реализована.'
      } : {
        rows: [
          ['O', 'Open files'], ['W', 'Close the current viewer level or Settings (the × button)'],
          ['F', 'Toggle full-screen table'], ['P', 'Pin or unpin column headers and row numbers'], ['Esc', 'Exit full screen; dismiss an active dialog'],
          ['/', 'Focus search (exit full screen first)'], ['?', 'Show keyboard shortcuts at the end of Settings'],
          [settingsKey, 'Open Settings'], ['← ↑ → ↓', 'Scroll content when no other control has focus'],
          ['[ / ]', 'Previous / next page'], ['Home / End', 'First / last page']
        ],
        note: 'Typing keeps ordinary keys; Settings and Escape remain available. With progressive readers, End reads the remaining pages sequentially; search, navigation or Home interrupts it. Arrow navigation between cells is not implemented yet.'
      };
      const style = doc.createElement('style');
      style.textContent = `
.bq-shortcuts table{width:100%;border-collapse:collapse}
.bq-shortcuts th,.bq-shortcuts td{padding:9px 0;text-align:left;border-bottom:1px solid var(--line)}
.bq-shortcuts th{white-space:nowrap;padding-right:20px}.bq-shortcuts kbd{font:inherit;font-weight:600}
.bq-shortcuts p{color:var(--muted);font-size:13px}
`;
      doc.head.appendChild(style);
      const table = doc.createElement('table'), note = doc.createElement('p');
      const panel = ui.addGroupSettings({
        group: 'shortcuts', position: 'last',
        label: { ru: 'Горячие клавиши', en: 'Keyboard shortcuts' },
        description: {
          ru: 'Команды доступны при просмотре файлов. Их сочетания также показаны в подсказках соответствующих кнопок.',
          en: 'Use these commands while browsing files. Shortcuts also appear in the corresponding button tooltips.'
        },
        mount(panel) {
          panel.id = 'bq-shortcuts-help'; panel.className += ' bq-shortcuts'; panel.tabIndex = -1;
          panel.appendChild(table); panel.appendChild(note);
        }
      });
      function showHelp() {
        ui.selectTab('settings');
        (panel.closest('.settings-section') || panel).scrollIntoView({ block: 'start' });
        panel.focus({ preventScroll: true });
      }
      function hint(node, key, keys, ariaKeys) {
        if (!node) return;
        const base = I.t(node.getAttribute('data-i18n-title') || key).replace(/\s*\(Esc\)$/, '');
        const value = base + ' (' + keys + ')';
        if (node.title !== value) node.title = value;
        if (node.getAttribute('aria-keyshortcuts') !== ariaKeys) node.setAttribute('aria-keyshortcuts', ariaKeys);
      }
      function hints() {
        for (const id of ['openFile', 'uploadFile']) hint($(id), 'open', 'O', 'O');
        hint($('backLevel'), 'upLevel', 'W', 'W');
        hint($('settingsButton'), 'settings', settingsKey, mac ? 'Meta+,' : 'Control+,');
        hint($('q'), 'search', '/', '/');
        hint($('prev'), 'previous', '[', '['); hint($('next'), 'next', ']', ']');
        const full = ui.elements.stage.querySelector('.bq-fullscreen-button');
        const active = ui.root.classList.contains('bq-fullscreen');
        hint(full, active ? 'tableExitFullscreen' : 'tableFullscreen', active ? 'F / Esc' : 'F', active ? 'F Escape' : 'F');
        hint(ui.elements.stage.querySelector('.bq-index-pin'), 'tablePinIndices', 'P', 'P');
      }
      function translate() {
        const text = texts(); note.textContent = text.note;
        table.replaceChildren();
        const body = doc.createElement('tbody');
        for (const [keys, description] of text.rows) {
          const row = doc.createElement('tr'), key = doc.createElement('th'), kbd = doc.createElement('kbd'), value = doc.createElement('td');
          key.setAttribute('scope', 'row'); kbd.textContent = keys; key.appendChild(kbd); value.textContent = description;
          row.appendChild(key); row.appendChild(value); body.appendChild(row);
        }
        table.appendChild(body); hints();
      }
      function click(id) {
        const button = $(id);
        if (!button || button.hidden || button.disabled) return false;
        button.click(); return true;
      }
      function handle(e) {
        if (e.defaultPrevented || e.isComposing || doc.querySelector('dialog[open]')) return;
        const focus = doc.activeElement;
        if (e.key === 'Escape') {
          if (ui.actions.fullscreen?.(false)) { e.preventDefault(); return; }
          if (focus === $('q')) { e.preventDefault(); focus.blur(); }
          return;
        }
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === 'Comma' || e.key === ',')) {
          e.preventDefault(); ui.selectTab('settings'); return;
        }
        if (editing(focus) || editing(e.target)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const key = e.key?.toLowerCase(), code = e.code;
        let handled = false;
        if (key === '?' || (code === 'Slash' && e.shiftKey)) {
          if (!e.repeat) showHelp(); handled = true;
        } else if (code === 'KeyO' || key === 'o') {
          if (!e.repeat) ui.actions.chooseFiles(); handled = true;
        } else if (code === 'KeyW' || key === 'w') {
          if (!e.repeat) handled = click('backLevel');
        } else if (code === 'KeyF' || key === 'f') {
          if (!e.repeat) handled = !!ui.actions.fullscreen?.();
        } else if (code === 'KeyP' || key === 'p') {
          const pin = ui.activeTab === 'explorer' && ui.elements.stage.querySelector('.bq-index-pin');
          if (!e.repeat && pin) { pin.click(); handled = true; }
        } else if (ui.activeTab === 'explorer') {
          if (key === '/' || code === 'Slash') {
            const full = ui.root.classList.contains('bq-fullscreen');
            handled = full || !$('searchForm').hidden;
            if (!full && !$('searchForm').hidden) $('q').focus();
          } else if (!$('pager').hidden && (code === 'BracketLeft' || key === '[')) handled = click('prev');
          else if (!$('pager').hidden && (code === 'BracketRight' || key === ']')) handled = click('next');
          else if (key === 'home' || key === 'end') {
            if (!e.repeat) ui.actions[key === 'home' ? 'firstPage' : 'lastPage']?.();
            handled = !!ui.currentView;
          } else if (key?.startsWith('arrow')) {
            const free = !focus || focus === doc.body || focus === doc.documentElement || focus === ui.root || focus === ui.elements.stage || focus.matches?.('.bq-wrap,.plain,.entity-browser');
            if (free) {
              const content = ui.elements.stage.querySelector('.bq-wrap,.plain,.entity-browser');
              const move = { arrowleft: { left: -48 }, arrowright: { left: 48 }, arrowup: { top: -48 }, arrowdown: { top: 48 } }[key];
              if (content && move) { content.scrollBy({ ...move, behavior: 'auto' }); handled = true; }
            }
          }
        }
        if (handled) e.preventDefault();
      }
      doc.addEventListener('keydown', handle);
      B.on('language:change', translate); B.on('view:render', hints); B.on('tab:change', hints);
      new MutationObserver(hints).observe(ui.root, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
      translate();
    }
  });
})();
