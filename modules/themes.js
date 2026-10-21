/* Themes use the same registration and loading path as every other plugin. */
(function () {
  const light = `--canvas:#ede7d8;--surface:#fff;--ink:#191b1f;--muted:#6e747e;--line:#e2e4e8;
    --iris:#7d63c8;--go:#2f9e68;--wait:#d79a15;--stop:#d24b43;
    --shadow:0 1px 2px rgba(20,22,28,.06),0 8px 28px rgba(20,22,28,.07);color-scheme:light;`;
  const dark = `--canvas:#131519;--surface:#1c1f25;--ink:#eceef2;--muted:#9298a3;--line:#2b2f37;
    --iris:#a58ef0;--go:#49bb81;--wait:#e0ae3c;--stop:#e8695f;
    --shadow:0 1px 2px rgba(0,0,0,.35),0 10px 30px rgba(0,0,0,.35);color-scheme:dark;`;
  for (const [id, name, css] of [
    ['theme-system', 'Системная', `:root{${light}}@media(prefers-color-scheme:dark){:root{${dark}}}`],
    ['theme-light', 'Светлая', `:root{${light}}`],
    ['theme-dark', 'Тёмная', `:root{${dark}}`]
  ]) Bouquet.register({ kind: 'plugin', category: 'theme', id, name, css });
})();
