/* Existing file-reading controls are mounted under their format group. */
Bouquet.register({
  kind: 'plugin', category: 'settings', targetGroup: 'format:sqlite', id: 'sqlite-settings',
  names: { ru: 'Настройки чтения SQLite', en: 'SQLite reading settings' },
  setup(ui) {
    ui.addGroupSettings({ group: 'format:sqlite', label: 'SQLite', mount(panel) {
      const controls = ui.document.getElementById('readingSettings');
      controls.hidden = false; panel.appendChild(controls);
    } });
  }
});
