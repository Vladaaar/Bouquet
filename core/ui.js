/* Persistent navigation and shared UI extension API. */
(function () {
  const B = window.Bouquet;
  const $ = id => document.getElementById(id);
  const tabs = new Map(), mounted = new Set();
  let started = false;
  const themeStyle = document.createElement('style');
  themeStyle.id = 'bouquet-theme';
  document.head.appendChild(themeStyle);
  const UI = B.ui = {
    root: $('app'), document, actions: {}, activeTab: 'explorer', activeLabel: 'Bouquet', theme: null,
    elements: { header: $('header'), navigation: $('settingsTabs'), workspace: $('workspace'),
      explorer: $('explorerPanel'), plugins: $('pluginsPanel'), settings: $('settingsPanel'),
      toolbar: document.querySelector('.bar'), stage: $('stage'), pager: $('pager') },
    addTab({ id, label, icon = '◇', panel, mount, button }) {
      if (!id || tabs.has(id)) throw new Error('Вкладке нужен уникальный id');
      if (!panel) {
        panel = document.createElement('section');
        panel.className = 'panel content-panel';
        $('workspace').appendChild(panel);
      }
      panel.id = panel.id || 'panel-' + id;
      panel.setAttribute('aria-label', label);
      if (!button) {
        button = document.createElement('button');
        button.className = 'extension-tab';
        const glyph = document.createElement('span');
        glyph.textContent = icon; glyph.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span'); text.textContent = label;
        button.appendChild(glyph); button.appendChild(text);
        $('settingsTabs').appendChild(button);
        $('settingsTabs').hidden = false;
      }
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', panel.id);
      button.onclick = () => UI.selectTab(id);
      tabs.set(id, { button, panel });
      panel.hidden = id !== UI.activeTab;
      if (!panel.hidden) button.setAttribute('aria-current', 'page');
      mount?.(panel, UI);
      return panel;
    },
    selectTab(id) {
      if (id === 'plugins') id = 'settings'; // Legacy plugins now share the settings page.
      if (!tabs.has(id)) throw new Error('Неизвестная вкладка: ' + id);
      UI.activeTab = id;
      UI.activeLabel = tabs.get(id).button.title;
      for (const [key, { button, panel }] of tabs) {
        panel.hidden = key !== id;
        if (key === id) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
      B.emit('tab:change', { id });
    },
    setTheme(id) {
      const plugin = B.plugins.find(p => p.id === id && p.category === 'theme');
      if (!plugin) throw new Error('Тема не подключена: ' + id);
      themeStyle.textContent = plugin.css || '';
      UI.theme = id;
      paintPlugins();
      B.emit('theme:change', { id });
    },
    start() {
      if (started) return;
      started = true;
      for (const plugin of B.plugins) mountPlugin(plugin);
      const theme = B.plugins.find(p => p.category === 'theme');
      if (!UI.theme && theme) UI.setTheme(theme.id);
      paintPlugins();
      B.emit('ui:ready', UI);
    }
  };
  UI.addTab({ id: 'explorer', label: 'Bouquet — вернуться к файлу', panel: $('explorerPanel'), button: $('homeButton') });
  UI.addTab({ id: 'settings', label: 'Настройки', panel: $('settingsPanel'), button: $('settingsButton') });
  $('closeSettings').onclick = () => UI.selectTab('explorer');
  function mountPlugin(plugin) {
    if (mounted.has(plugin.id)) return;
    mounted.add(plugin.id);
    try { plugin.setup?.(UI); }
    catch (error) { plugin.uiError = error.message; }
  }
  function paintPlugins() {
    $('pluginList').replaceChildren();
    $('themeSelect').replaceChildren();
    const kinds = { interpreter: 'Интерпретатор', renderer: 'Отображение', feature: 'Возможность', plugin: 'Интерфейс' };
    for (const plugin of B.plugins) {
      const theme = plugin.category === 'theme';
      const card = document.createElement('article'); card.className = 'plugin-card';
      const title = document.createElement('strong'); title.textContent = plugin.name || plugin.id;
      const detail = document.createElement('small');
      detail.textContent = plugin.uiError ? 'Ошибка интерфейса: ' + plugin.uiError :
        (theme ? 'Тема оформления' : kinds[plugin.kind] || plugin.kind) + ' · ' + plugin.id;
      card.appendChild(title); card.appendChild(detail);
      if (theme) {
        const button = document.createElement('button'); button.className = 'theme-button';
        button.textContent = plugin.id === UI.theme ? 'Выбрана' : 'Применить';
        button.disabled = plugin.id === UI.theme;
        button.onclick = () => UI.setTheme(plugin.id); card.appendChild(button);
        const option = document.createElement('option'); option.value = plugin.id; option.textContent = plugin.name || plugin.id;
        $('themeSelect').appendChild(option);
      }
      $('pluginList').appendChild(card);
    }
    $('themeSelect').value = UI.theme || '';
    $('themeSelect').disabled = !$('themeSelect').children.length;
  }
  $('themeSelect').onchange = () => UI.setTheme($('themeSelect').value);
  B.on('register', plugin => {
    if (started) {
      mountPlugin(plugin);
      if (!UI.theme && plugin.category === 'theme') UI.setTheme(plugin.id);
      else paintPlugins();
    }
  });
})();
