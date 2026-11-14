# Contrast

Тема [`theme_contrast.js`](../theme_contrast.js) по мотивам [Blacksmith](https://www.blacksmith.sh/): угольный `#202020`, жёлто-лаймовый `#f0fb29`, строгие рамки, прямоугольные панели и моноширинные подписи.

Выберите **Настройки → Темы оформления → Contrast**. «Внешний вид» независимо управляет состоянием: **Как в системе / Светлая / Тёмная**. В светлом варианте лаймовый фон обрамляет светлые таблицы; в тёмном — лайм выделяет элементы на угольных поверхностях. Выбранные сегменты и подсветка поиска имеют отдельные контрастные цвета текста. Bouquet остаётся темой по умолчанию.

Модуль регистрируется как `kind: 'plugin', category: 'theme', id: 'theme-contrast'`, с общим `css` и `states.light` / `states.dark`. Он использует системные шрифты и локальный CSS, работает офлайн и включается во все сборки. Переключение заменяет стили без пересоздания данных и таблицы; при возврате к Bouquet стили Contrast удаляются.

## English

A [Blacksmith](https://www.blacksmith.sh/)-inspired theme with charcoal/lime colours, crisp borders, angular panels and system monospace labels. Select **Settings → Themes → Contrast**; Appearance independently selects System, Light or Dark. Bouquet remains the default. The theme uses local CSS and system fonts, works offline and ships in every distribution. Switching themes preserves the current data and replaces all theme styles.
