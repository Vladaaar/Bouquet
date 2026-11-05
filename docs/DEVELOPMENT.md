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

Search supports words, `"exact phrases"`, `-exclusions` and `column:value`. Enter applies immediately; clearing the field returns to the first unfiltered page. `/` focuses search; arrow keys change pages outside input fields. SQLite 🔗 buttons follow declared foreign keys in either direction.

## Formats

- SQLite: up to 100 MiB loads into memory by default; larger files use progressive reading. Change the mode in Settings. No SQL execution, editing, views or WAL support; open a consistent standalone database.
- Excel: uses the bundled SheetJS library, loaded on demand. Worksheets become tables; the first row stays data. Formulas use cached values and are not recalculated.
- CronosPro: choose CroStru and CroBank DAT/TAD pairs together; CroIndex is optional. Components are grouped by directory. If automatic KOD recovery fails, the dialog accepts a KOD table, not a regular password.
- CSV, TSV and text: currently parsed fully in memory.

## Plugin groups and appearance

Settings groups languages, themes and file formats (shared `format`, e.g. `sqlite`). Groups with alternatives show exclusive switches: one choice stays on. Single plugins and group-settings plugins are listed under **Other plugins** at the bottom. Group controls stay below their heading, including when there is only one candidate.

The default `theme-default` plugin contains `states.light` and `states.dark` CSS. The separate `theme-settings` plugin adds **Appearance: System / Light / Dark**. System is the default and follows browser/OS changes; the other modes override it. Theme choice and appearance are independent and preserve data and DOM. Existing CSS-only themes still load, but need both states to fully support Appearance.

`ui.selectPlugin(group, id)` / `Bouquet.selectPlugin(group, id)` selects `language`, `theme` or `format:<format>`. Without a manual format choice the existing compatibility/priority/SQLite size rules apply; the switch reflects the current reader. A manual choice persists for the page session. Select `null` for a format group to return to automatic selection. Changing the current reader preserves the query/table and resets pagination. `ui.setPluginOptions(id, patch)` merges `plugin.options`; readers consume their own parameters. Changing an active reader's options reopens it; inactive-reader changes do not.

Group-settings plugins use `kind: 'plugin', category: 'settings', targetGroup: 'theme'` (or a format group). In `setup(ui)`, call `ui.addGroupSettings({group, label, mount})`. The block mounts once and survives language/theme changes. Use `ui.selectPlugin` and `ui.setPluginOptions` to control group members. `targetGroup` documents the target; mounting is explicit. See [theme_settings.js](../modules/theme_settings.js), [sqlite_settings.js](../modules/sqlite_settings.js) and the [full example](DEVELOPMENT_RU.md#группы-и-плагины-настроек).

Events: `plugin:select` carries `{group, id}`, `plugin:configure` carries `{plugin, options}`, `appearance:change` carries `{mode}`. `ui.setTheme(id)` and `ui.setAppearance(mode)` also work directly. All choices are in memory until reload. Selection controls parsing/CSS; it does not undo arbitrary JavaScript or `setup` effects from already loaded trusted plugins.

## Create a plugin

Load [modules/hello.js](../modules/hello.js) through **Settings → Plugins → Add .js plugin**. Open **👋 Hello** in Settings. The example is not enabled by default and can be edited as a starting point.

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

`dist/` contains separate RU and EN ZIPs, RU/EN single-file mobile HTML builds, `SHA256SUMS.txt` and the Pages tree in `site/`. Each ZIP includes all modules, documentation, dependencies with licences and the two demo files. Local databases, hidden files, tests, `design.md` and release notes are excluded.

`bouquet-X.Y.Z-mobile-ru.html` and `bouquet-X.Y.Z-mobile-en.html` embed the CSS, core, all plugins (Hello is enabled), SheetJS and licence texts. They require no neighbouring files, and skip the manifest/demo scan. They also work on desktop browsers. Pages serves them at `/mobile.html` and `/en/mobile.html`; Actions exposes `release-mobile-ru` and `release-mobile-en` artifacts, and each release attaches both HTML files alongside the ZIPs. Validate mobile builds by copying just the HTML to an empty folder, disconnecting the network and opening local data files.

For a release, update `VERSION`, `Bouquet.version` in `core/bouquet.js`, and the dated section in `CHANGELOG.md`. Use stable semantic versions `X.Y.Z`. Commit the changes and push the corresponding `vX.Y.Z` tag. Actions validates the version, tests and builds, publishes both ZIPs in one release, and deploys Pages (RU at the root, EN at `/en/`). Branch pushes only test and build. Release notes remain in the repository.

For initial Pages setup, select **Settings → Pages → Source → GitHub Actions**. If **Settings → Environments → github-pages → Deployment branches and tags** restricts deployments, add a **Tag** rule matching `v*`. If unrestricted, no rule is needed. Release publishing and Pages deployment run independently.
