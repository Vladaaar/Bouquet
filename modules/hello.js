/* Example plugin: load this file from Settings → Plugins. No build required. */
(function () {
  Bouquet.register({
    kind: 'plugin',
    id: 'hello',
    names: { ru: 'Пример: Hello', en: 'Example: Hello' },
    setup(ui) {
      // setup runs once. Keep nodes and update their text without rebuilding the panel.
      const title = document.createElement('h1');
      const message = document.createElement('p');
      const button = document.createElement('button');
      button.className = 'action-button';
      button.onclick = () => ui.selectTab('explorer');
      const translate = () => {
        const ru = ui.i18n.locale.startsWith('ru');
        title.textContent = ru ? 'Привет, Bouquet!' : 'Hello, Bouquet!';
        message.textContent = ru
          ? 'Это пример плагина. Измените этот файл, чтобы создать свой раздел.'
          : 'This is an example plugin. Edit this file to create your own section.';
        button.textContent = ui.i18n.t('back');
      };
      ui.addTab({
        id: 'hello', label: 'Hello', icon: '👋',
        mount(panel) { panel.appendChild(title); panel.appendChild(message); panel.appendChild(button); }
      });
      Bouquet.on('language:change', translate);
      translate();
    }
  });
})();
