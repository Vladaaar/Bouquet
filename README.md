# 💐 Bouquet

**Drop in a file. Explore what’s inside.**

A lightweight browser viewer for SQLite, CSV, TSV, and plain text. Works offline, with no installation or build step. Your local files stay in your browser.

- **See data immediately.** Open a file and browse the first 100 rows.
- **Find what matters.** Search words, `"exact phrases"`, `-exclusions`, or `column:value`, with matching text highlighted.
- **Follow the connections.** Click 🔗 beside a SQLite key to see related records in a side drawer. Uses declared foreign keys, in both directions.
- **Browse large databases.** Progressive SQLite reading loads rows as needed instead of loading the whole database into memory.
- **Make it yours.** Add formats, views, sidebar tabs, and themes through JavaScript plugins. Collapse the sidebar for more room; switch sections without losing your search.

**Try it:** download the project, keep its folders together, and open `index.html` in your browser. Drop in your own file, or select [`data/example.db`](data/example.db).

The sample is a tiny flower shop database. Open `purchases` and click 🔗 beside `flower_id` to see the flower. Open `stock` and click 🔗 beside an `id` to see its purchases. The peony has 53 purchases—enough to try paging through the drawer.

To open the sample automatically, run this from the project folder:

```sh
python3 -m http.server 8000
```

Then visit [localhost:8000](http://localhost:8000). A server is optional; picking files manually works offline.

Bouquet is a viewer: no SQL console or editing. Search on large SQLite tables may scan the whole table; CSV, TSV, and text files currently load into memory. The interface is currently in Russian.

[Full documentation & plugin API (Russian)](README_RU.md)

@vladaaar, 2026
