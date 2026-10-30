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

## Browse and search

Choose multiple files or drop folders into the window. Multiple files and tables appear as lists. Parent breadcrumbs return to those lists. Settings preserves the file, query, page and scroll position.

The status row contains only **Found · Rows scanned · Total rows**. Unknown totals are omitted; `≥` means the search is still incomplete. Scanned rows count the source records examined for the current query, including records that do not match. In-memory filtering scans the entire table; without filtering it counts rows through the current page. For CronosPro, the scan includes bank record slots, including deleted entries and entries from other tables. Loading notices and errors appear separately.

Search supports words, `"exact phrases"`, `-exclusions` and `column:value`. Enter applies immediately; clearing the field returns to the first unfiltered page. `/` focuses search; arrow keys change pages outside input fields. SQLite 🔗 buttons follow declared foreign keys in either direction.

## Formats

- SQLite: up to 100 MiB loads into memory by default; larger files use progressive reading. Change the mode in Settings. No SQL execution, editing, views or WAL support; open a consistent standalone database.
- Excel: uses the bundled SheetJS library, loaded on demand. Worksheets become tables; the first row stays data. Formulas use cached values and are not recalculated.
- CronosPro: choose CroStru and CroBank DAT/TAD pairs together; CroIndex is optional. Components are grouped by directory. If automatic KOD recovery fails, the dialog accepts a KOD table, not a regular password.
- CSV, TSV and text: currently parsed fully in memory.

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

`dist/` contains separate RU and EN ZIPs, `SHA256SUMS.txt` and the Pages tree in `site/`. Each ZIP includes all modules, documentation, dependencies with licences and the two demo files. Local databases, hidden files, tests, `design.md` and release notes are excluded.

For a release, update `VERSION`, `Bouquet.version` in `core/bouquet.js`, and the dated section in `CHANGELOG.md`. Use stable semantic versions `X.Y.Z`. Commit the changes and push the corresponding `vX.Y.Z` tag. Actions validates the version, tests and builds, publishes both ZIPs in one release, and deploys Pages (RU at the root, EN at `/en/`). Branch pushes only test and build. Release notes remain in the repository.

For initial Pages setup, select **Settings → Pages → Source → GitHub Actions**. If **Settings → Environments → github-pages → Deployment branches and tags** restricts deployments, add a **Tag** rule matching `v*`. If unrestricted, no rule is needed. Release publishing and Pages deployment run independently.
