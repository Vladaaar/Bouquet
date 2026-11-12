# Загрузка файлов / File loading

[`file_loading.js`](../file_loading.js) выбирает способ загрузки для всех форматов. В настройках одно поле: **«Файлы до __ МБ загружаются в память целиком»**. Начальное значение — **100**; граница включительная, 1 МБ здесь равен 1024² байт. **0 — всегда прогрессивная загрузка**, даже для пустого файла; формат без прогрессивного чтения при 0 не открывается. Выбор действует до перезагрузки страницы.

При ненулевом пороге и поддержке обоих режимов модуль один раз читает все байты небольшого файла и предоставляет обработчику диапазоны из памяти. Выше порога передаёт исходный источник для чтения необходимых диапазонов. Если формат поддерживает только один способ загрузки, **ненулевой порог не учитывается**: полный обработчик загружает файл целиком независимо от размера, прогрессивный всегда читает диапазоны. Порог проверяется отдельно и для связанных файлов, например компонентов CronosPro. Это порог размера исходного файла, а не ограничение всей памяти приложения: декодированные строки, книга Excel и другие структуры тоже занимают память.

Изменение значения переоткрывает текущий источник, сохраняя запрос и выбранную таблицу и возвращая пагинацию к первой странице. Недопустимые значения не применяются. Отдельного переключателя режима SQLite нет.

## Что умеют текущие обработчики

| Формат | При ненулевом пороге | При 0 |
| --- | --- | --- |
| SQLite | До порога — байты в памяти; выше — необходимые страницы базы | Прогрессивное чтение страниц |
| CSV / TSV | До порога — байты в памяти; выше — последовательные блоки с сохранением состояния кавычек и переносов | Прогрессивный разбор записей |
| Текст | До порога — байты в памяти; выше — последовательные блоки | Прогрессивное чтение строк |
| CronosPro | Для каждого DAT/TAD отдельно: до порога — байты в памяти; выше — диапазоны индекса и записей | Прогрессивное чтение компонентов |
| XLS / XLSX | Полная загрузка независимо от порога; SheetJS разбирает книгу | Сообщение об отсутствии прогрессивного обработчика |

Все двухрежимные форматы используют один парсер с одинаковым интерфейсом источника. Выдача строк порциями сама по себе не означает прогрессивного чтения байтов. Excel остаётся полным: [входной API SheetJS](https://docs.sheetjs.com/docs/solutions/input/) требует целую книгу; отдельный потоковый парсер XLS/XLSX не был бы компактной доработкой. Для открытия Excel оставьте любое ненулевое значение.

Для CSV/TSV и текста общая утилита `Bouquet.util.textSource` читает блоки по 64 КиБ и хранит ограниченный кэш. Поддерживаются UTF-8, UTF-8 с BOM и UTF-16 LE/BE с BOM, CR/LF/CRLF, многострочные CSV-поля и экранированные кавычки. Курсоры содержат смещение в байтах и номер строки/записи; фильтрация, пагинация и отмена не требуют хранения всех строк. Одна логическая запись ограничена 64 МиБ. Разделитель CSV определяется по первым пяти физическим строкам в образце до 64 КиБ; для TSV/TAB используется табуляция. Если последующие CSV-записи шире заголовка, столбцы добавляются по мере чтения. Пустые записи внутри данных сохраняются, пустой хвост отбрасывается; для этого иногда требуется чтение вперёд. Точное число строк, поиск и переход в конец могут потребовать полного обхода файла, но не полной материализации.

CronosPro читает заголовки DAT, записи TAD и соответствующие диапазоны DAT с ограниченным кэшем, сохраняя декомпрессию, CRC, расширенные записи и восстановление KOD. Открытие читает структуру базы; восстановление KOD может потребовать дополнительного обхода записей.

Загрузка байтов по HTTP зависит от поддержки Range сервером: без неё источник скачивает полный Blob; прогрессивный парсер затем читает диапазоны этого Blob. Локальные файлы читаются через File/Blob и никуда не отправляются.

## Границы модулей

Общими являются источник байтов `read(offset, length, {signal})`, выбор режима, порог и предварительное чтение в память. `core/sources.js` также предоставляет ограниченный блочный кэш `cachedSource` и сканер текстовых записей `textSource`. Парсер формата определяет, какие байты нужны и как получить записи: страницы и b-дерево SQLite, кавычки CSV, структура книги Excel или индекс Cronos. Общий загрузчик не превращает произвольный полный парсер в потоковый.

В сборках один SQLite-обработчик: `modules/sqlite.js`. Он поддерживает оба источника байтов и один контракт таблиц. Старый полный декодер оставлен только как независимый тестовый эталон в `tests/fixtures/sqlite_full_load_legacy.js`; в дистрибутивы он не входит.

## API

Модуль регистрируется с `id: 'file-loading'`, `category: 'settings'`, `targetGroup: 'file-loading'` и собственными названиями/описаниями группы. Доступен как `Bouquet.features['file-loading']`.

- `options.memoryLimitMB` — единственная настройка, неотрицательное целое число, по умолчанию 100.
- `setMemoryLimitMB(value)` — проверяет значение и вызывает `Bouquet.setPluginOptions`; настройки и текущий файл обновляются через `plugin:configure` / `ui.actions.reloadFile()`.
- `mode(source, reader?)` — `memory` / `progressive` по размеру и возможностям обработчика; без `reader` учитывает только размер/порог.
- `select(meta)` — совместимый интерпретатор с учётом выбора формата, приоритета и возможностей; при 0 отсутствие прогрессивного обработчика даёт переводимую ошибку.
- `open(interpreter, meta, onFullRead)` — подготовка источника и связанных файлов, вызов `open` или адаптация прежнего `parse({buffer})`.

Двухрежимный интерпретатор объявляет `loadingModes: ['memory', 'progressive']` и реализует `open({source, files, signal, loadingMode})`. Обработчик только с прогрессивным чтением объявляет `loadingModes: ['progressive']`; только с полным — `loadingModes: ['memory']` (это значение по умолчанию). Прежнее `loadingMode: 'progressive'` также поддерживается. Объявление прогрессивности обещает чтение больших файлов без полной материализации, а не только асинхронную пагинацию готовых строк. Выбор конкретного обработчика формата сохраняется.

Обработчик получает исходный диапазонный источник или такой же интерфейс над предварительно прочитанными байтами; его логика разбора не должна зависеть от места хранения. При `memory` возможен любой прежний полный `parse({buffer})`. Прогрессивное чтение реализуется в форматном обработчике; склеивание всех блоков в один буфер не делает парсер прогрессивным.

## English

File loading has one setting: **Files up to __ MB are loaded entirely into memory**, default 100, inclusive, using 1024² bytes per MB. **Zero always requires progressive reading**, including empty files; full-only formats cannot open at zero. With a positive value, dual-mode formats cache small inputs once and read large ones through ranges. Formats supporting only one mode ignore a positive threshold and use that mode regardless of size. Excel therefore still opens in full even above a positive threshold.

SQLite, CSV/TSV, text and CronosPro now support both modes with one parser per format. Text/CSV use bounded 64 KiB blocks, byte-offset cursors, UTF-8 and BOM-marked UTF-16, quoted multiline CSV fields, cancellation and filtering. Individual logical records are limited to 64 MiB. CSV delimiter detection samples up to 64 KiB; wider later records expand the columns. Trailing blank CSV records are discarded with bounded lookahead storage. Cronos reads DAT/TAD headers, index entries and record ranges, retaining compression, CRC and KOD support. Searching or navigating to the end may still scan the entire input.

Excel's bundled SheetJS reader requires the complete workbook; paginated row output is not progressive byte loading. A separate streaming XLS/XLSX parser would be a substantial implementation. HTTP servers without Range support still require a full Blob download. The threshold applies separately to companion files and is not a process-memory limit. The setting lasts for the page session; changing it reopens the current source, preserves the query/table and resets pagination. See the API above for capabilities and shared source helpers.
