# Release notes / История изменений

## [Unreleased]

### Русский

- Закреплён боковик с номерами строк; пин в левом верхнем углу одновременно закрепляет или открепляет шапку и боковик, сохраняя состояние при пагинации.

- Единые сборки без разделения по языкам: начальный язык выбирается по настройкам системы/браузера (RU/EN, иначе EN). Ручное переключение сохранено.
- HTML-артефакты переименованы в `release-html` (ZIP) и `release-html-android` (автономный HTML); десктопная матрица сокращена до четырёх заданий.
- Плагин-пример Hello исключён из всех дистрибутивов и остаётся доступен в репозитории исходников.

### English

- Row numbers now stay pinned horizontally; the upper-left pin toggles column headers and row numbers together and keeps its state across pagination.

- Unified builds select the initial system/browser language (RU/EN, falling back to EN) and retain manual switching.
- HTML artifacts are now `release-html` (ZIP) and `release-html-android` (standalone HTML); the desktop matrix now has four jobs.
- The Hello example plugin is excluded from all distributions and remains available in the source repository.

## [1.3.0] - 2026-11-10

### Русский

- Добавлены релизные десктопные сборки Pake: Windows x64, macOS Intel/Apple Silicon, Linux x64, RU/EN. Упакован локальный интерфейс с запретом удалённых веб-запросов; все пакеты включены в общие SHA-256.
- Встроенный полноэкранный режим таблицы: кнопка справа в головке скрывает шапку, поиск, статус и отступы, сохраняя индексы и пагинацию. Выход кнопкой или Esc; текущие данные и состояние просмотра сохраняются.

### English

- Added Pake desktop release builds for Windows x64, macOS Intel/Apple Silicon and Linux x64, in RU/EN. The bundled local frontend blocks remote web requests; all packages are covered by the release SHA-256 manifest.
- Built-in full-screen table mode: the upper-right header button hides the application header, search, status and outer spacing while keeping row indices and pagination. Exit with the button or Esc; current data and viewing state are preserved.

## [1.2.2] - 2026-11-05

### Русский

- Pages открывается с загрузчика файлов, без автоматического скачивания демонстрационных баз.
- Крестик после пути и браузерная «Назад» поднимают на один уровень: таблица → база → вложенные папки → загрузчик. Поддержан переход «Вперёд», в том числе после автоматического открытия единственной таблицы.
- Закрытие настроек возвращает к прежнему просмотру с сохранением поиска, порции, DOM и прокрутки; текущее чтение продолжается.
- Плагины сгруппированы по языкам, темам и форматам. Альтернативы выбираются взаимоисключающими тумблерами; одиночные плагины и плагины настроек находятся в нижнем разделе «Прочие плагины».
- Добавлен API плагинов настроек групп, выбора обработчика и изменения его параметров. Настройки чтения SQLite размещены под заголовком SQLite.
- Стандартная тема Bouquet содержит Light/Dark-состояния. Отдельный контрол Appearance предлагает System/Light/Dark, по умолчанию следует системе и реагирует на её изменения без перечитывания данных.
- Документация описывает навигацию, группы, настройки и границу реализации: выбор обработчика не выгружает уже исполненный JavaScript плагина.

### English

- Pages starts at the file picker without automatically downloading demo databases.
- The cross after the path and browser Back move up one level: table → database → nested folders → file picker. Forward navigation also supports automatically opened single-table databases.
- Closing Settings restores the query, page, DOM and scroll position while ongoing reads continue.
- Plugins are grouped by language, theme and file format. Alternatives use exclusive switches; single plugins and group-settings plugins appear under Other plugins at the bottom.
- Added group-settings, reader-selection and plugin-options APIs. SQLite reading controls now appear under SQLite.
- The default Bouquet theme provides Light/Dark states. A separate Appearance control offers System/Light/Dark, follows the system by default and reacts to changes without rereading data.
- Documentation covers navigation, groups, settings and the implementation boundary: selecting a reader does not unload already executed plugin JavaScript.

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
