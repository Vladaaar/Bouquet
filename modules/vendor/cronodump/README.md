# CronosPro format reference

`modules/cronos.js` is a JavaScript port of the Cronos record, schema, KOD and recovery algorithms from [alephdata/cronodump](https://github.com/alephdata/cronodump), distributed under the MIT license. The upstream copyright and license are retained in [LICENSE](LICENSE).

Reference: https://github.com/alephdata/cronodump/blob/master/docs/cronos-research.md

The plugin uses native `DecompressionStream('deflate-raw')` and adds bounds checks and CRC-32 validation. No Python, CDN or additional runtime library is needed. It supports file versions 01.02, 01.03, 01.04, 01.05 and 01.11; newer formats are rejected explicitly.

Automatic recovery follows upstream `strucrack` (zero-byte frequencies) and `dbcrack` (known compressed-header bytes), requiring a complete permutation and structural validation. If recovery fails, a dialog accepts an existing 256-byte KOD table in hexadecimal, equivalent to upstream `--kod`. A regular CronosPro password cannot be converted to KOD by this implementation: the referenced project does not implement that conversion either. The dialog states this limitation explicitly and never pretends that accepting a regular password unlocks the database.
