/* Existing file-reading controls are mounted under their format group. */
Bouquet.register({
  kind: 'plugin', category: 'settings', targetGroup: 'format:sqlite', id: 'sqlite-settings',
  names: { ru: 'Настройки чтения SQLite', en: 'SQLite reading settings' },
  setup(ui) {
    ui.addGroupSettings({ group: 'format:sqlite', label: 'SQLite', description: {
      ru: 'Чтение SQLite-файлов в памяти или порциями. Режим можно изменить с сохранением текущего запроса.',
      en: 'Read SQLite files in memory or progressively. Changing the mode preserves the current query.'
    }, mount(panel) {
      const controls = ui.document.getElementById('readingSettings');
      controls.hidden = false; panel.appendChild(controls);
    } });
  }
});
