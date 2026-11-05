/* A group-settings plugin: appearance is independent of the selected theme. */
(function () {
  Bouquet.register({
    kind: 'plugin', category: 'settings', targetGroup: 'theme', id: 'theme-settings',
    names: { ru: 'Настройки оформления', en: 'Appearance settings' },
    setup(ui) {
      ui.addGroupSettings({ group: 'theme', mount(panel) {
        const fieldset = document.createElement('fieldset'); fieldset.className = 'appearance-control';
        const legend = document.createElement('legend'); ui.i18n.bind(legend, 'appearance'); fieldset.appendChild(legend);
        const choices = [];
        for (const mode of ['system', 'light', 'dark']) {
          const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
          input.type = 'radio'; input.name = 'bouquet-appearance'; input.value = mode;
          input.onchange = () => ui.setAppearance(mode);
          ui.i18n.bind(text, 'theme.' + mode);
          label.appendChild(input); label.appendChild(text); fieldset.appendChild(label); choices.push(input);
        }
        const update = () => choices.forEach(input => { input.checked = input.value === ui.appearance; });
        Bouquet.on('appearance:change', update); update(); panel.appendChild(fieldset);
      } });
    }
  });
})();
