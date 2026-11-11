# Горячие клавиши / Keyboard shortcuts

Обработчик — [`modules/shortcuts.js`](../shortcuts.js), встроенный модуль Bouquet, подключённый в `index.html`. Он входит в HTML, Android и десктопные сборки. Список команд находится последним блоком настроек. Клавиша `?` открывает настройки и прокручивает к этому блоку; отдельной кнопки и диалога справки нет. Подписи справки и подсказки кнопок следуют языку интерфейса.

| Клавиша | Действие | Action |
| --- | --- | --- |
| **O** | Открыть системный диалог выбора файлов | Open the file picker |
| **W** | Нажать крестик **×** текущего уровня: закрыть настройки или подняться от таблицы к базе/папке/загрузчику | Activate the current **×**: close Settings or return to the parent viewer level |
| **F** | Включить или выключить полноэкранную таблицу | Toggle full-screen table |
| **P** | Закрепить или открепить шапку и номера строк, как угловым пином | Pin or unpin column headers and row numbers, like the corner pin |
| **Esc** | Выйти из полноэкранного режима; снять фокус с поиска. В диалоге — закрыть диалог | Exit full screen; blur search. Inside a dialog, dismiss the dialog |
| **/** | Перевести фокус в видимый поиск | Focus visible search |
| **?** | Открыть настройки и перейти к последнему блоку — горячим клавишам | Open Settings and scroll to the final keyboard shortcuts block |
| **Cmd + ,** (macOS), **Ctrl + ,** (Windows/Linux) | Открыть настройки | Open Settings |
| **← ↑ → ↓** | Прокрутить содержимое по горизонтали/вертикали, если фокус не на другом элементе | Scroll content horizontally/vertically when no other control has focus |
| **[** / **]** | Предыдущая / следующая страница результатов | Previous / next result page |
| **Home** / **End** | Первая / последняя страница результатов | First / last result page |

## Поведение

- Буквенные команды, `/`, `?`, скобки и Home/End не срабатывают в полях ввода, списках выбора и редактируемом тексте. Сочетание настроек и Esc доступны и при вводе.
- Стрелки не переключают страницы. При фокусе на кнопке, ссылке, поле ввода или другом элементе модуль оставляет их этому элементу. Будущая навигация по ячейкам пока не реализована.
- Клавиши O/W/F/P, скобки и сочетание с запятой распознаются также по физической позиции, поэтому работают в русской раскладке. Shift + клавиша `/` открывает справку. Остальные сочетания с Cmd/Ctrl/Alt сохраняют поведение браузера/ОС; Cmd/Ctrl + W не перехватываются.
- W выполняет действие крестика приложения, без вызова `window.close()`. Из блока горячих клавиш W закрывает настройки тем же крестиком, возвращая прежний просмотр. Для закрытия нативного окна сохраняются системные команды.
- F действует только на табличный просмотр и управляет его компоновкой внутри окна. Esc в открытом диалоге сначала закрывает диалог, сохраняя фоновые результаты и полноэкранный режим. Повторный Esc выходит из полноэкранной таблицы.
- В полноэкранном режиме поиск скрыт: сначала выйдите через F/Esc, затем нажмите `/`.
- Для таблиц в памяти End сразу открывает последнюю страницу текущего результата, включая фильтр. Для курсорных обработчиков ещё неизвестные страницы читаются последовательно до конца; видимые результаты и прогресс обновляются. Это может занять время на большом файле. Уже известный последний курсор используется напрямую. Поиск, переход к другому файлу/уровню, смена раздела или Home прерывают дальнейший обход; начатое чтение раздела может завершиться в фоне.
- Команды не перехватываются при композиционном вводе (IME), после `preventDefault()` другого обработчика или внутри чужого открытого диалога. Повторное удержание O/W/F/P, `?`, Home/End не запускает действие многократно; стрелки и скобки допускают повтор.

Подсказки `title` показывают клавиши на кнопках открытия, крестике, настройках, пагинации, полноэкранного режима и пина, а также на поиске. Для этих элементов задаётся `aria-keyshortcuts`; у кнопки выхода из полноэкранного режима подсказка содержит **F / Esc**. Сочетание настроек показывается только при наведении на кнопку и в списке команд; в хлебных крошках остаётся название раздела. Home/End описаны в списке команд: отдельных кнопок первой и последней страницы нет.

## English behavior notes

Ordinary shortcuts leave inputs, selects and editable content alone; Settings and Escape remain available. Letter and bracket commands also recognize physical key positions for Russian layouts. Browser/OS modifier shortcuts are preserved, apart from Cmd/Ctrl + comma. W activates Bouquet's cross rather than closing the browser/native window. A modal dialog consumes its own keys; Escape dismisses it before exiting the table's full-screen mode.

The shortcut list is the final Settings block; ? opens Settings and scrolls to it. There is no dedicated help button or modal. P activates the corner pin to freeze/unfreeze headers and row numbers, and its tooltip includes P. Settings breadcrumbs contain only the section name; Cmd/Ctrl + comma stays in the tooltip and cheat sheet.

Arrows scroll content only when no other control has focus and never change pages. Cell navigation is a future feature. Search must be visible for `/` to focus it. Home/End use the current filtered result. In-memory tables can jump directly; cursor readers may need to traverse the remaining pages to discover the end. Search, navigation, section changes or Home interrupt that traversal. Known final cursors are reused.

## Интеграция / Integration

Модуль регистрируется как `kind: 'plugin', category: 'settings', targetGroup: 'shortcuts', id: 'shortcuts'`. Через `ui.addGroupSettings({group: 'shortcuts', label, description, position: 'last', mount})` он задаёт собственные заголовок и описание RU/EN и монтирует постоянный список команд в конце настроек. Отдельная карточка модуля не показывается. `setup(ui)` устанавливает единственный обработчик `keydown` на документ и обновляет подсказки после перерисовки, смены языка/раздела и изменения `title`.

Обработчик использует действия интерфейса, не хранит отдельную копию данных или пагинации:

- `ui.actions.chooseFiles()` — выбор файлов; крестик и предыдущая/следующая страницы используют существующие кнопки.
- `ui.actions.firstPage()` / `lastPage()` — асинхронные действия контроллера данных, с отменяемым обходом курсоров для End.
- `ui.actions.fullscreen(value)` — действие табличного вида: без аргумента переключает режим, `false` выключает; возвращает, изменился ли режим.
- `ui.selectTab('settings')` — настройки; для `?` дополнительно прокручивается блок клавиш и получает фокус.
- P нажимает существующую `.bq-index-pin` в текущем табличном виде, используя тот же обработчик и состояние, что и мышь.

Другим модулям, обрабатывающим клавиши внутри собственных элементов, достаточно вызвать `preventDefault()` или остановить всплытие события. При удалении подключения `shortcuts.js` кнопки приложения продолжают работать; горячие клавиши и справка этого модуля отключаются.
