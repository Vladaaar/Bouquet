# Release notes / История изменений

## [1.2.1] - 2026-10-31

### Русский

- Добавлены однофайловые HTML-сборки RU/EN для телефонов: стили, все плагины и библиотека Excel встроены внутрь, соседние файлы не нужны.
- Строка статуса показывает только найденное, просмотренное и известный итог; прогресс обновляется и при отсутствии совпадений.
- Добавлен пример плагина Hello; сокращены README, подробные инструкции перенесены в `docs/`.
- Добавлен фавикон 💐, меняющийся на ⏳ во время чтения. Название вкладки — Bouquet, без эмодзи и номера версии.

### English

- Added self-contained RU/EN mobile HTML builds with embedded styles, all plugins and the Excel library; no neighbouring files required.
- The status row shows only found, scanned and known total counts; progress updates even when there are no matches.
- Added the Hello example plugin; shortened both READMEs and moved detailed instructions to `docs/`.
- Added a 💐 favicon that changes to ⏳ while reading. The tab title is Bouquet, without an emoji or version number.

## [1.2.0] - 2026-10-30

### Русский

- Офлайн-просмотр SQLite, CronosPro, Excel, CSV, TSV и текста; поиск и постраничное чтение.
- Группировка компонентов CronosPro в базы и переходы по связям SQLite.
- Русский и английский интерфейсы, расширения и темы через JavaScript-плагины.
- Два полных ZIP-дистрибутива (RU/EN), контрольные суммы SHA-256 и автоматическая публикация на GitHub Pages по тегу версии.
- Ограничение CronosPro: после неудачного автоматического восстановления диалог принимает KOD-таблицу, а не обычный пароль.

### English

- Offline viewing of SQLite, CronosPro, Excel, CSV, TSV and text, with search and pagination.
- CronosPro components grouped into databases; navigation through SQLite relationships.
- Russian and English interfaces, JavaScript plugins and themes.
- Complete RU/EN ZIP distributions, SHA-256 checksums and tag-triggered GitHub Pages deployment.
- CronosPro limitation: if automatic recovery fails, the dialog accepts a KOD table rather than a regular password.
