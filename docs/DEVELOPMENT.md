[English](DEVELOPMENT.md) · [Русский](DEVELOPMENT_RU.md)

# Bouquet documentation

[Back to README](../README.md)

## Run locally

Open `index.html` directly and choose files with **📂 Open**. This works offline without a server or a build step. Keep the application folders together, including `modules/vendor/`.

To offer demo files automatically through `bouquet.files.json`, start a server in the project folder:

```sh
python3 -m http.server 8000
```

Visit [localhost:8000](http://localhost:8000). With `file://`, browsers block automatic access to neighbouring files; manual selection works normally. HTTP servers without Range support download the complete file before local reads. For progressive local reads, choose the file manually.

The GitHub Pages build uses an empty file manifest: it starts with **📂 Open** and does not automatically download demo databases. ZIP distributions retain the demo manifest for local-server use.

## Browse and search

Choose multiple files or drop folders into the window. Folders are shown one level at a time, rather than as a flat list of relative paths. Parent breadcrumbs return directly to their level; the current breadcrumb is inert.

The **× after the path** and the browser's **Back** button both move up one level: **file picker → selected folder/file set → child folders → database → table**, read from right to left when returning. For example, closing a table shows the database's table list; closing that list shows its containing folder. The top folder or a standalone file returns to the file picker. A database with one table opens it automatically, but Back/× still reveals its table list. A plain text or single-table CSV file returns directly to its folder or the picker. CronosPro components stay grouped as one database. Folder levels require relative paths, supplied by folder drag-and-drop; a normal multiple-file picker cannot reveal parent directories that the browser does not expose.

Settings can be opened at every level, including the picker. Back/× closes Settings and restores the exact previous level, DOM, query, page and scroll position; an ongoing read continues. Switching between Settings and plugin sections does not add file hierarchy levels. The logo also returns from Settings to the preserved viewer. Leaving a table for its parent cancels the current read. A parent breadcrumb can skip several levels at once.

Browser **Forward** can revisit levels while the page remains open; a closed database is read again from the File/Blob retained in memory. Files are not serialized into `history.state`, written to browser storage or added to the URL. Reloading does not restore local selections. At the file picker, × is hidden and browser Back can leave the application normally. Cancelling the system file dialog does not add a level or change the current view. Choosing another file set replaces the hierarchy above the picker.

The status row contains only **Found · Rows scanned · Total rows**. Unknown totals are omitted; `≥` means the search is still incomplete. Scanned rows count the source records examined for the current query, including records that do not match. In-memory filtering scans the entire table; without filtering it counts rows through the current page. For CronosPro, the scan includes bank record slots, including deleted entries and entries from other tables. Loading notices and errors appear separately.

Search supports words, `"exact phrases"`, `-exclusions` and `column:value`. Enter applies immediately; clearing the field returns to the first unfiltered page. `/` focuses search; `[` / `]` change pages, Home/End open the first/last page, and arrows scroll content when no control has focus. SQLite 🔗 buttons follow declared foreign keys in either direction.

See the [keyboard module README](../modules/shortcuts/README.md) for O/W/F, Escape, search, Settings, page navigation, help and focus rules. The corresponding controls show shortcuts in their hover titles. ? opens the final keyboard shortcuts block in Settings; Settings breadcrumbs retain just the section name.

## Pinned table indices

Column headers and row numbers are pinned by default: headers stay at the top during vertical scrolling, row numbers stay at the left during horizontal scrolling, and the corner stays visible along both axes. The pin button in the upper-left corner or P toggles both together. When unpinned, the headers, row numbers and pin scroll with the table; return to the corner to pin them again. The choice lasts for the page session, survives pagination/search/empty results and is independent of full-screen mode. Toggling preserves cells and scroll position; button tooltips and accessible names follow the interface language.

## Full-screen table

Use the expand button in the upper-right corner of the table header. The table fills the browser viewport, edge to edge: the application header, search, status/notices and outer spacing disappear. Row indices, scrolling, expandable cells and pagination remain available. The control stays visible when scrolling the table in either direction. Exit with the same button or **Esc**.

Toggling preserves the current query, page, expanded cells and scroll position without rebuilding the table or rereading data. Pagination and empty results keep the mode active. Leaving the viewer, replacing the table renderer or a read error restores the normal layout. `/` does not focus the hidden search field while full screen is active; exit first to change the query.

This built-in feature lives in `modules/table.js`, alongside the table styles and rendering. It uses a viewport layout rather than the browser Fullscreen API, so browser tabs and controls remain available. A class on `#app` controls the shell; a stage observer clears the mode when the table is removed. No separate plugin or setting is needed. Button tooltips and accessible names follow the interface language.

## File loading

The [File loading module](../modules/file_loading/README.md) owns the global threshold, default 100 MB (1024² bytes per MB). The only control is **Load files up to __ MB entirely into memory**. For dual-mode formats, bytes are cached once at or below it and read progressively above it. Zero always requires progressive reading. A format supporting only one mode ignores any positive threshold: full-only formats still load completely even above it. Changing the setting preserves the current query/table and resets pagination. The byte-loading policy is shared; parsers still implement format-specific progressive access. SQLite uses one parser in both modes.

## Formats

- SQLite: one parser uses preloaded bytes or progressive ranges according to the global File loading threshold (default 100 MB, inclusive). Change the threshold in Settings. No SQL execution, editing, views or WAL support; open a consistent standalone database.
- Excel: uses the bundled SheetJS library, loaded on demand. Worksheets become tables; the first row stays data. Formulas use cached values and are not recalculated.
- CronosPro: choose CroStru and CroBank DAT/TAD pairs together; CroIndex is optional. Components are grouped by directory. If automatic KOD recovery fails, the dialog accepts a KOD table, not a regular password.
- CSV, TSV and text: progressive block reads, Unicode/BOM support, byte cursors, filtering and cancellation. CSV preserves quoted multiline fields; columns expand when wider rows appear. One logical record is limited to 64 MiB.
- CronosPro reads DAT/TAD headers, index entries and record ranges progressively with bounded caches. KOD recovery can require additional scanning. Each component follows the threshold separately.
- Excel requires full loading through SheetJS. Any positive threshold permits it regardless of file size; zero reports that progressive reading is unavailable. HTTP without Range still downloads a full Blob for every format.

## Plugin groups and appearance

Settings groups languages, themes and file formats (shared `format`, e.g. `sqlite`). Groups with alternatives show exclusive switches: one choice stays on. Single regular plugins are listed under **Other plugins**. Group-settings providers render their own descriptions and controls within their groups, without separate plugin cards. The keyboard shortcuts block comes last in Settings. Group controls stay below their heading, including when there is only one candidate.

The default `theme-default` plugin contains `states.light` and `states.dark` CSS. The separate `theme-settings` plugin adds **Appearance: System / Light / Dark**. System is the default and follows browser/OS changes; the other modes override it. Theme choice and appearance are independent and preserve data and DOM. Existing CSS-only themes still load, but need both states to fully support Appearance.

`ui.selectPlugin(group, id)` / `Bouquet.selectPlugin(group, id)` selects `language`, `theme` or `format:<format>`. Without a manual format choice the existing compatibility/priority/SQLite size rules apply; the switch reflects the current reader. A manual choice persists for the page session. Select `null` for a format group to return to automatic selection. Changing the current reader preserves the query/table and resets pagination. `ui.setPluginOptions(id, patch)` merges `plugin.options`; readers consume their own parameters. Changing an active reader's options reopens it; inactive-reader changes do not.

Group-settings plugins use `kind: 'plugin', category: 'settings', targetGroup: 'theme'` (or a format group). In `setup(ui)`, call `ui.addGroupSettings({group, label, description, position, mount})`. The block mounts once and survives language/theme changes. `label` and `description` accept a string or a locale map such as `{ru: 'Описание', en: 'Description'}`; descriptions render as plain text below the group heading. `position: 'last'` creates a group in the final Settings area, as used by the keyboard module. Group-setting providers have no separate cards; see [shortcuts/README.md](../modules/shortcuts/README.md). Use `ui.selectPlugin` and `ui.setPluginOptions` to control group members. `targetGroup` documents the target; mounting is explicit. See [theme_settings.js](../modules/theme_settings.js), [file_loading.js](../modules/file_loading.js) and the [full example](DEVELOPMENT_RU.md#группы-и-плагины-настроек).

Events: `plugin:select` carries `{group, id}`, `plugin:configure` carries `{plugin, options}`, `appearance:change` carries `{mode}`. `ui.setTheme(id)` and `ui.setAppearance(mode)` also work directly. All choices are in memory until reload. Selection controls parsing/CSS; it does not undo arbitrary JavaScript or `setup` effects from already loaded trusted plugins.

## Create a plugin

Load [modules/hello.js](https://github.com/Vladaaar/Bouquet/blob/main/modules/hello.js) through **Settings → Plugins → Add .js plugin**. Open **👋 Hello** in Settings. Download the example from the source repository; it is excluded from every distribution and can be edited as a starting point.

`Bouquet.register` registers the plugin. Its `setup(ui)` runs once, when the UI and actions are ready, including when loaded during a session. `ui.addTab` mounts a persistent panel; `ui.selectTab('explorer')` returns to the preserved viewer. `Bouquet.on('language:change', ...)` updates its text without rebuilding the panel. The example uses `textContent` for user-facing text.

All plugins run with access to the page. See the [detailed API and examples](DEVELOPMENT_RU.md#api-плагинов-версия-12), including interpreters, renderers, language packs and themes.

Asynchronous `table.read` may return `scanned`, the cumulative count of source records examined through its returned cursor, and report the same count through `onProgress`. Do not include a lookahead row that will be processed again on the next page. Older plugins without `scanned` remain supported; the counter uses available progress or the number of delivered rows.

## Build and release

Python 3.10+ and Node.js 22+ are sufficient; no packages need installing:

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/build.py
```

`dist/` contains one `bouquet-X.Y.Z-html.zip` (Actions artifact `release-html`), one self-contained `bouquet-X.Y.Z-html-android.html` (`release-html-android`), `SHA256SUMS.txt` and the Pages tree in `site/`. The ZIP includes production modules, documentation, dependencies with licences and two demo files. Hello, local databases, hidden files, tests, `design.md` and release notes are excluded.

`bouquet-X.Y.Z-html-android.html` embeds CSS, core, production plugins, SheetJS and licence texts. It requires no neighbouring files and skips the manifest/demo scan. It also works on desktop browsers. Pages serves it at `/mobile.html`; old `/en/` and `/en/mobile.html` URLs redirect to the common app. Validate the standalone build by copying just the HTML to an empty folder, disconnecting the network and opening local data files. All builds choose the first supported system/browser language from `navigator.languages`/`navigator.language` (RU or EN), with English fallback; Settings can override it for the page session.

Desktop releases use the free Pake CLI 3.18.0 to package the local frontend: Windows x64 MSI, macOS Intel/Apple Silicon DMG, and Linux x64 DEB/AppImage, once per platform/architecture with automatic language selection. No hosted app is loaded; dependencies are embedded and a desktop-only CSP blocks remote web requests. Local files use the same File/Blob readers. These packages are unsigned/not notarized by a verified publisher, so OS checks can warn or block launch. Standard Actions runners are free for public repositories; private repositories use their Actions allowance. See [desktop build, privacy boundary and platform checks](DESKTOP.md). A manual workflow run builds desktop artifacts without publishing; tag releases wait for every desktop build and include all packages in `SHA256SUMS.txt`. Pages deployment remains independent.

For a release, update `VERSION`, `Bouquet.version` in `core/bouquet.js`, and the dated section in `CHANGELOG.md`. Use stable semantic versions `X.Y.Z`. Commit the changes and push the corresponding `vX.Y.Z` tag. Actions validates the version, tests and builds, publishes ZIPs, mobile HTML files and desktop installers in one release, and deploys one Pages application with automatic language selection. Branch pushes only test and build. Release notes remain in the repository.

For initial Pages setup, select **Settings → Pages → Source → GitHub Actions**. If **Settings → Environments → github-pages → Deployment branches and tags** restricts deployments, add a **Tag** rule matching `v*`. If unrestricted, no rule is needed. Release publishing and Pages deployment run independently.
