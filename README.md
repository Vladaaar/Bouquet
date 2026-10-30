[English](README.md) · [Русский](README_RU.md)

# 💐 Bouquet

A lightweight browser viewer for SQLite, CronosPro, Excel (XLS/XLSX), CSV, TSV and text. Open files, browse tables and search their contents. Works offline, with no installation or build step. Your local files stay in your browser.

**[Open Bouquet online](https://vladaaar.github.io/Bouquet/)** · **[Download RU / EN](https://github.com/Vladaaar/Bouquet/releases)**

To use offline, download `bouquet-X.Y.Z-en.zip` or `bouquet-X.Y.Z-ru.zip`, extract it and open `index.html`. Choose one or more files with **📂 Open**, or drop files and folders into the window. When several files or tables are available, choose one from the list.

- Search words, `"exact phrases"`, `-exclusions` and `column:value`.
- Follow declared SQLite relationships with the 🔗 button.
- Read large SQLite databases progressively.
- Switch languages and themes, or load JavaScript plugins in Settings.

Want to create a plugin? Start with [hello.js](modules/hello.js): load it through **Settings → Plugins → Add .js plugin**, then open **👋 Hello** in Settings. It adds a small section, reacts to language changes and returns to the current file without resetting it. The example is included but is not loaded automatically.

[Documentation: local server, formats, plugins and releases](docs/DEVELOPMENT.md) · [Detailed plugin API (Russian)](docs/DEVELOPMENT_RU.md#api-плагинов-версия-12)

Bouquet is a viewer, with no SQL console or editing. Excel, CSV and text currently load into memory. If automatic CronosPro recovery fails, the dialog accepts a KOD table rather than a regular password.

[License](LICENSE) · [Version history](https://github.com/Vladaaar/Bouquet/blob/main/CHANGELOG.md) · [@vladaaar](https://unit.link/vladaaar)
