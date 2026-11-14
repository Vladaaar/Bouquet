# Contrast

Тема [`theme_contrast.js`](../theme_contrast.js) по мотивам [Blacksmith](https://www.blacksmith.sh/): белая основа, угольный текст `#202020` и жёлто-лаймовые акценты `#f0fb29`, строгие рамки, прямоугольные панели и моноширинные подписи.

Выберите **Настройки → Темы оформления → Contrast**. «Внешний вид» независимо управляет состоянием: **Как в системе / Светлая / Тёмная**. В светлом варианте основной фон и таблицы белые; шапка жёлтая в обоих режимах, с угольным текстом и контрастными кнопками. В тёмном режиме лайм выделяет активные элементы на угольных поверхностях, строка поиска не отбрасывает тень. Выбранные сегменты и подсветка поиска имеют отдельные контрастные цвета текста. Bouquet остаётся темой по умолчанию.

Основное окно под поиском и таблицей и карточки настроек имеют деликатный точечный узор. Карточки связанных записей в боковой панели выделены фоном цвета ховера строк и рамкой. Такой же фон используется при наведении на невыбранный сегмент внешнего вида. Кнопки полностью скруглены либо прямоугольные, обводка при наведении жёлтая; включённые тумблеры имеют чёрную обводку. Активный пин таблицы — чёрная иконка на жёлтом фоне в обоих режимах.

Модуль регистрируется как `kind: 'plugin', category: 'theme', id: 'theme-contrast'`, с общим `css` и `states.light` / `states.dark`. Он использует системные шрифты и локальный CSS, работает офлайн и включается во все сборки. Переключение заменяет стили без пересоздания данных и таблицы; при возврате к Bouquet стили Contrast удаляются.

## English

A [Blacksmith](https://www.blacksmith.sh/)-inspired theme with a white base, charcoal text and lime accents, crisp borders, angular panels and system monospace labels. The header is yellow in both modes; the viewer background and settings cards have a subtle dot grid. Related-record cards use the table-row hover colour. Buttons are pill-shaped or square, with yellow hover borders; active switches have a black outline. The active pin stays black on yellow, and dark search has no shadow. Select **Settings → Themes → Contrast**; Appearance independently selects System, Light or Dark. Bouquet remains the default. The theme uses local CSS and system fonts, works offline and ships in every distribution. Switching themes preserves the current data and replaces all theme styles.
