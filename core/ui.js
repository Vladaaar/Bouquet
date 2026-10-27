/* Persistent navigation and shared UI extension API. */
(function () {
  const B = window.Bouquet, I = B.i18n;
  I.translate();
  const $ = id => document.getElementById(id);
  const tabs = new Map(), mounted = new Set();
  let started = false;
  const themeStyle = document.createElement('style');
  themeStyle.id = 'bouquet-theme';
  document.head.appendChild(themeStyle);
  const UI = B.ui = {
    root: $('app'), document, i18n: I, actions: {}, activeTab: 'explorer', activeLabel: 'Bouquet', theme: null,
    elements: { header: $('header'), navigation: $('settingsTabs'), workspace: $('workspace'),
      explorer: $('explorerPanel'), plugins: $('pluginsPanel'), settings: $('settingsPanel'),
      toolbar: document.querySelector('.bar'), stage: $('stage'), pager: $('pager') },
    addTab({ id, label, labelKey, icon = '◇', panel, mount, button }) {
      if (!id || tabs.has(id)) throw I.error('Вкладке нужен уникальный id');
      label = labelKey ? I.t(labelKey) : label || id;
      let labelNode;
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
        const text = labelNode = document.createElement('span'); text.textContent = label;
        button.appendChild(glyph); button.appendChild(text);
        $('settingsTabs').appendChild(button);
        $('settingsTabs').hidden = false;
      }
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', panel.id);
      button.onclick = () => UI.selectTab(id);
      tabs.set(id, { button, panel, labelKey, labelNode });
      panel.hidden = id !== UI.activeTab;
      if (!panel.hidden) button.setAttribute('aria-current', 'page');
      mount?.(panel, UI);
      return panel;
    },
    selectTab(id) {
      if (id === 'plugins') id = 'settings'; // Legacy plugins now share the settings page.
      if (!tabs.has(id)) throw I.error('Неизвестная вкладка: {id}', { id });
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
      if (!plugin) throw I.error('Тема не подключена: {id}', { id });
      themeStyle.textContent = plugin.css || '';
      UI.theme = id;
      paintPlugins();
      B.emit('theme:change', { id });
    },
    get language() { return I.language; },
    setLanguage(id) { I.setLanguage(id); },
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
  UI.addTab({ id: 'explorer', label: I.t('home'), labelKey: 'home', panel: $('explorerPanel'), button: $('homeButton') });
  UI.addTab({ id: 'settings', label: I.t('settings'), labelKey: 'settings', panel: $('settingsPanel'), button: $('settingsButton') });
  $('closeSettings').onclick = () => UI.selectTab('explorer');
  function mountPlugin(plugin) {
    if (mounted.has(plugin.id)) return;
    mounted.add(plugin.id);
    try { plugin.setup?.(UI); }
    catch (error) { plugin.uiError = error.message; }
  }
  function paintPlugins() {
    for (const id of ['pluginList', 'languageList', 'themeList']) $(id).replaceChildren();
    for (const plugin of B.plugins) {
      const theme = plugin.category === 'theme', language = plugin.category === 'language';
      const card = document.createElement('article'); card.className = 'plugin-card';
      card.dataset.plugin = plugin.id;
      const title = document.createElement('strong'); title.textContent = I.label(plugin);
      const detail = document.createElement('small');
      detail.textContent = plugin.uiError ? I.t('uiError', { error: plugin.uiError }) :
        I.t(theme ? 'kind.theme' : language ? 'kind.language' : 'kind.' + plugin.kind) + ' · ' + plugin.id;
      card.appendChild(title); card.appendChild(detail);
      if (theme || language) {
        const button = document.createElement('button'); button.className = 'theme-button';
        const selected = plugin.id === (theme ? UI.theme : I.language);
        button.textContent = I.t(selected ? language ? 'selectedLanguage' : 'selected' : 'apply');
        button.disabled = selected; button.setAttribute('aria-pressed', String(selected));
        button.onclick = () => theme ? UI.setTheme(plugin.id) : UI.setLanguage(plugin.id);
        card.appendChild(button);
      }
      $(theme ? 'themeList' : language ? 'languageList' : 'pluginList').appendChild(card);
    }
  }
  B.on('language:change', () => {
    for (const [id, { button, panel, labelKey, labelNode }] of tabs) {
      if (!labelKey) continue;
      const label = I.t(labelKey);
      if (labelNode) labelNode.textContent = label;
      button.title = label; button.setAttribute('aria-label', label); panel.setAttribute('aria-label', label);
      if (id === UI.activeTab) UI.activeLabel = label;
    }
    paintPlugins();
  });
  B.on('register', plugin => {
    if (started) {
      mountPlugin(plugin);
      if (!UI.theme && plugin.category === 'theme') UI.setTheme(plugin.id);
      else paintPlugins();
    }
  });
})();
