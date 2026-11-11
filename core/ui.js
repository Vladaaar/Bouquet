/* Persistent navigation and shared UI extension API. */
(function () {
  const B = window.Bouquet, I = B.i18n;
  I.translate();
  const $ = id => document.getElementById(id);
  const tabs = new Map(), mounted = new Set();
  const groups = new Map([
    ['language', { section: $('languagesPanel'), list: $('languageList'), settings: $('languageSettings') }],
    ['theme', { section: $('themesPanel'), list: $('themeList'), settings: $('themeSettings') }]
  ]);
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
      tabs.set(id, { button, panel, label, labelKey, labelNode });
      panel.hidden = id !== UI.activeTab;
      if (!panel.hidden) button.setAttribute('aria-current', 'page');
      mount?.(panel, UI);
      return panel;
    },
    selectTab(id) {
      if (id === 'plugins') id = 'settings'; // Legacy plugins now share the settings page.
      if (!tabs.has(id)) throw I.error('Неизвестная вкладка: {id}', { id });
      UI.activeTab = id;
      UI.activeLabel = tabs.get(id).label;
      for (const [key, { button, panel }] of tabs) {
        panel.hidden = key !== id;
        if (key === id) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
      B.emit('tab:change', { id });
    },
    appearance: 'system',
    setTheme(id) {
      const plugin = B.plugins.find(p => p.id === id && p.category === 'theme');
      if (!plugin) throw I.error('Тема не подключена: {id}', { id });
      UI.theme = id;
      applyTheme();
      paintPlugins();
      B.emit('theme:change', { id });
    },
    get language() { return I.language; },
    setAppearance(mode) {
      if (!['system', 'light', 'dark'].includes(mode)) throw new Error('Unknown appearance: ' + mode);
      UI.appearance = mode; applyTheme(); B.emit('appearance:change', { mode });
    },
    selectPlugin(group, id) { B.selectPlugin(group, id); },
    setPluginOptions(id, options) { B.setPluginOptions(id, options); },
    addGroupSettings({ group, label, description, position, mount }) {
      const target = ensureGroup(group, label, position);
      if (description != null) {
        target.description = description;
        if (!target.descriptionNode) {
          target.descriptionNode = document.createElement('p');
          target.descriptionNode.className = 'group-description';
          target.section.insertBefore(target.descriptionNode, target.settings);
        }
        target.descriptionNode.textContent = groupText(description);
      }
      const panel = document.createElement('div'); panel.className = 'group-settings';
      target.settings.appendChild(panel);
      mount(panel, UI); paintPlugins();
      return panel;
    },
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
  const darkMedia = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  function applyTheme() {
    const plugin = B.plugins.find(plugin => plugin.id === UI.theme);
    const state = UI.appearance === 'system' ? darkMedia?.matches ? 'dark' : 'light' : UI.appearance;
    themeStyle.textContent = (plugin?.css || '') + (plugin?.states?.[state] || '');
  }
  darkMedia?.addEventListener('change', () => { if (UI.appearance === 'system') applyTheme(); });
  const groupText = value => typeof value === 'string' ? value : value?.[I.locale] || value?.[I.locale.split('-')[0]] || value?.en || value?.ru || '';
  function ensureGroup(group, label, position) {
    if (!groups.has(group)) {
      const section = document.createElement('section'); section.className = 'settings-section'; section.dataset.group = group;
      const title = document.createElement('h2'); title.textContent = groupText(label) || group.replace(/^format:/, '');
      const settings = document.createElement('div'), list = document.createElement('div'); list.className = 'plugin-list';
      section.appendChild(title); section.appendChild(settings); section.appendChild(list);
      $(position === 'last' ? 'settingsExtras' : 'formatGroups').appendChild(section);
      groups.set(group, { section, list, settings, title });
    }
    if (label != null) {
      groups.get(group).label = label;
      if (groups.get(group).title) groups.get(group).title.textContent = groupText(label);
    }
    return groups.get(group);
  }
  UI.addTab({ id: 'explorer', label: I.t('home'), labelKey: 'home', panel: $('explorerPanel'), button: $('homeButton') });
  UI.addTab({ id: 'settings', label: I.t('settings'), labelKey: 'settings', panel: $('settingsPanel'), button: $('settingsButton') });
  function mountPlugin(plugin) {
    if (mounted.has(plugin.id)) return;
    mounted.add(plugin.id);
    try { plugin.setup?.(UI); }
    catch (error) { plugin.uiError = error.message; }
  }
  function paintPlugins() {
    $('pluginList').replaceChildren();
    for (const plugin of B.plugins) {
      const group = B.pluginGroup(plugin);
      if (group && B.groupPlugins(group).length > 1) ensureGroup(group);
    }
    for (const [group, target] of groups) {
      if (target.title && target.label != null) target.title.textContent = groupText(target.label);
      if (target.descriptionNode) target.descriptionNode.textContent = groupText(target.description);
      target.list.replaceChildren();
      target.section.hidden = B.groupPlugins(group).length < 2 && !target.settings.children.length;
    }
    for (const plugin of B.plugins) {
      // Settings providers describe their group alongside their controls.
      if (plugin.category === 'settings' && !plugin.uiError) continue;
      const theme = plugin.category === 'theme', language = plugin.category === 'language';
      const group = B.pluginGroup(plugin), selectable = group && B.groupPlugins(group).length > 1;
      const card = document.createElement('article'); card.className = 'plugin-card';
      card.dataset.plugin = plugin.id;
      const title = document.createElement('strong'); title.textContent = I.label(plugin);
      const detail = document.createElement('small');
      detail.textContent = plugin.uiError ? I.t('uiError', { error: plugin.uiError }) :
        I.t(plugin.category === 'settings' ? 'kind.settings' : theme ? 'kind.theme' : language ? 'kind.language' : 'kind.' + plugin.kind) + ' · ' + plugin.id;
      card.appendChild(title); card.appendChild(detail);
      if (selectable) {
        const button = document.createElement('input'); button.type = 'checkbox'; button.className = 'plugin-switch';
        const selected = plugin.id === B.activePlugin(group);
        button.checked = selected;
        button.setAttribute('role', 'switch'); button.setAttribute('aria-label', I.label(plugin)); button.setAttribute('aria-checked', String(selected));
        button.onclick = () => {
          button.checked = true;
          if (!selected || group.startsWith('format:') && B.selectedPlugins[group] !== plugin.id) UI.selectPlugin(group, plugin.id);
        };
        card.appendChild(button);
      }
      (selectable ? groups.get(group).list : $('pluginList')).appendChild(card);
    }
  }
  B.on('language:change', () => {
    for (const [id, { button, panel, labelKey, labelNode }] of tabs) {
      if (!labelKey) continue;
      const label = I.t(labelKey);
      tabs.get(id).label = label;
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
  B.on('plugin:select', paintPlugins);
  B.on('plugin:active', paintPlugins);
})();
