/* Contrast · Blacksmith-inspired charcoal/lime palette; entirely local CSS. */
(function () {
  Bouquet.register({
    kind: 'plugin', category: 'theme', id: 'theme-contrast', name: 'Contrast',
    css: `
      :root{--r-box:0;--r-pill:4px;
        --contrast-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;}
      body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;}
      .app-header{background:var(--canvas);border-bottom-color:var(--ink);}
      .brand{font-weight:750;letter-spacing:-.04em;}
      .content-panel h1{font-weight:700;letter-spacing:-.035em;}
      .content-panel h2,.appearance-control legend{font-family:var(--contrast-mono);font-weight:600;}
      .plugin-card,.settings-card,.entity-button,.cronos-key-dialog{border-radius:0;}
      .search{border-color:var(--ink);}
      .search input{font-family:var(--contrast-mono);font-size:16px;}
      .file-content .pager{border-color:var(--ink);}
      .pager .pos,.file-state,.sign,.bq-table .bq-num{font-family:var(--contrast-mono);}
      .bq-wrap .bq-table thead th{background:var(--canvas);border-bottom-color:var(--ink);}
      .bq-table-button,.entity-button{border-radius:0;}
      .appearance-control input:checked+span{color:var(--contrast-accent-ink);}
      .open-button,.action-button,.theme-button{border-color:var(--ink);}
      .open-button:hover,.action-button:hover,.theme-button:hover{background:var(--iris);color:var(--contrast-accent-ink);}
      .settings-button[aria-current=page],.extension-tab[aria-current=page]{background:var(--iris);color:var(--contrast-accent-ink);}
      .pager button:disabled{color:var(--muted);opacity:.5;}
      .upload-button{border-style:solid;box-shadow:var(--shadow);}
      .plain a,.bq-table a{text-decoration:underline;text-underline-offset:3px;}
      mark{background:var(--contrast-highlight);color:#202020;border-radius:0;}
      ::selection{background:var(--contrast-highlight);color:#202020;}
    `,
    states: {
      light: `:root{--canvas:#f0fb29;--surface:#fafafa;--ink:#202020;--muted:#555548;--line:#747469;
        --iris:#202020;--go:#256a35;--wait:#785600;--stop:#b42318;
        --contrast-accent-ink:#f0fb29;--contrast-highlight:#f0fb29;
        --shadow:3px 3px 0 #202020;color-scheme:light;}`,
      dark: `:root{--canvas:#171717;--surface:#202020;--ink:#f5f5f5;--muted:#c0c0b4;--line:#737368;
        --iris:#f0fb29;--go:#94d7a0;--wait:#f4cf71;--stop:#ff9a91;
        --contrast-accent-ink:#202020;--contrast-highlight:#f0fb29;
        --shadow:3px 3px 0 #f0fb29;color-scheme:dark;}`
    }
  });
})();
