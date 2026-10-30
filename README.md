# 💐 Bouquet

**Drop in a file or folder. Explore what’s inside.**

![SQLite search](sqlite_search.png)

A lightweight browser viewer for SQLite, CronosPro, Excel (XLS/XLSX), CSV, TSV, and plain text. Works offline, with no installation or build step. Your local files stay in your browser.

- **Choose what to explore.** Open a file or folder. Pick a file or table from the list when there are several, then browse the first 100 rows.
- **Find what matters.** Search words, `"exact phrases"`, `-exclusions`, or `column:value`, with matching text highlighted.
- **Follow the connections.** Click 🔗 beside a SQLite key to see related records in a side drawer. Uses declared foreign keys, in both directions.
- **Browse large databases.** Progressive SQLite reading loads rows as needed instead of loading the whole database into memory.
- **Make it yours.** Add formats, views, sections, themes, and language packs through JavaScript plugins. Open settings with the gear in the header; return to your file with the Bouquet logo without losing your search.

**Try it:** download a `bouquet-X.Y.Z-en.zip` or `bouquet-X.Y.Z-ru.zip` from [Releases](https://github.com/Vladaaar/Bouquet/releases), extract it, and open `index.html` in your browser. Each archive includes all modules and starts in its named language; you can switch languages in Settings. Use “📂 Open” to choose one or more files, drop files into the window, or select [`data/example.db`](data/example.db).

The sample is a tiny flower shop database. Choose `purchases` from the table list and click 🔗 beside `flower_id` to see the flower. Open `stock` and click 🔗 beside an `id` to see its purchases. The peony has 53 purchases—enough to try paging through the drawer.

To open the sample automatically, run this from the project folder:

```sh
python3 -m http.server 8000
```

Then visit [localhost:8000](http://localhost:8000). A server is optional; picking files manually works offline.

Bouquet is a viewer: no SQL console or editing. Search on large SQLite tables may scan the whole table; Excel, CSV, TSV, and text files currently load into memory. The interface includes Russian and English. Choose a language card in Settings; add more languages through plugins.

[Full documentation & plugin API (Russian)](README_RU.md)

Releases use stable `vX.Y.Z` tags matching [VERSION](VERSION), `Bouquet.version` in `core/bouquet.js`, and a dated entry in [CHANGELOG.md](https://github.com/Vladaaar/Bouquet/blob/main/CHANGELOG.md). To prepare a release, update those three files, commit them, then push the matching tag. GitHub Actions runs the tests, publishes two separate ZIP assets (RU and EN) and SHA-256 checksums in one GitHub Release, and deploys Pages (Russian at the root, English at `/en/`). Release notes remain in the repository only: they are excluded from archives, Pages and the release description. Branch pushes and pull requests only test and build. Actions also exposes separate `release-ru`, `release-en` and `release-checksums` artifacts.

For Pages, set **Settings → Pages → Source → GitHub Actions** once. Under **Settings → Environments → github-pages → Deployment branches and tags**, no changes are needed if deployments are unrestricted. If selected branches and tags are required, add a **Tag** rule matching `v*`; a branch rule for `main` does not allow version tags. If the environment does not exist yet, the first deployment creates it without restrictions. Commit and push all changes before tagging that commit. An ordinary branch push runs only `build`, with `release` and `pages` marked `skipped`; this is expected. This uses GitHub's [custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Release publishing and Pages deployment are separate jobs: a Pages configuration error does not block the ZIP release.

Build locally with Python 3.10+ (no packages required):

```sh
python3 scripts/build.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

Output is in ignored `dist/`: two ZIPs, `SHA256SUMS.txt`, and the Pages tree in `site/`. Only the bundled `data/example.db` and `data/example.csv` are shipped; local databases, tests, release notes and `design.md` are excluded. The release manifest is checked to prevent publishing local database paths. The source itself still opens directly without a build step.

@vladaaar, 2026

Excel support is provided by [`modules/excel.js`](modules/excel.js). It loads a local copy of SheetJS on first use, including offline on `file://`. Keep `modules/vendor/sheetjs-0.20.3/` with the project. Worksheets become tables with Excel column letters; the first row remains data. Formulas use cached results and are not recalculated. [Third-party license and source](modules/vendor/sheetjs-0.20.3/README.md).

CronosPro support is in [`modules/cronos.js`](modules/cronos.js). Select `CroStru.dat/.tad` and `CroBank.dat/.tad` together. Components are grouped by directory: one database opens immediately; multiple databases appear as separate list items. Automatic KOD recovery is supported; if it fails, the dialog accepts a KOD table, **not a regular CronosPro password**. See [format support and limitations](README_RU.md#cronospro).
