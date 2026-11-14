/* Contrast · Blacksmith-inspired charcoal/lime palette; entirely local CSS. */
(function () {
  Bouquet.register({
    kind: 'plugin', category: 'theme', id: 'theme-contrast', name: 'Contrast',
    css: `
      :root{--r-box:0;--r-pill:999px;--contrast-highlight:#f0fb29;
        --contrast-hover:color-mix(in srgb,var(--iris) 6%,var(--surface));
        --contrast-pattern:radial-gradient(circle,var(--contrast-dot) .7px,transparent .9px);
        --contrast-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;}
      body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;}
      .app-header{background:var(--contrast-highlight);color:#202020;border-bottom-color:#202020;
        --ink:#202020;--muted:#454535;--iris:#202020;--canvas:#dce623;--surface:#f0fb29;}
      .brand{font-weight:750;letter-spacing:-.04em;}
      .content-panel h1{font-weight:700;letter-spacing:-.035em;}
      .content-panel h2,.appearance-control legend{font-family:var(--contrast-mono);font-weight:600;}
      .file-content,.plugin-card,.settings-card{background-image:var(--contrast-pattern);background-size:12px 12px;}
      .plugin-card,.settings-card,.entity-button,.cronos-key-dialog,.settings-card select,
      .group-settings .file-loading-limit input,.cronos-key-dialog input{border-radius:0;}
      .search{border-color:var(--ink);box-shadow:var(--contrast-search-shadow);}
      .search input{font-family:var(--contrast-mono);font-size:16px;}
      .file-content .pager{border-color:var(--ink);}
      .pager .pos,.file-state,.sign,.bq-table .bq-num{font-family:var(--contrast-mono);}
      .bq-wrap .bq-table thead th{background:var(--canvas);border-bottom-color:var(--ink);}
      .bq-wrap .bq-table-button{border:1px solid transparent;border-radius:50%;}
      .bq-wrap .bq-table-button:hover{border-color:var(--contrast-highlight);background:var(--contrast-hover);color:var(--ink);}
      .bq-wrap .bq-index-pin[aria-pressed=true]{background:var(--contrast-highlight);color:#202020;}
      .bq-wrap .bq-index-pin[aria-pressed=true]:hover{background:#dce623;color:#202020;}
      .appearance-control label:hover input:not(:checked)+span{background:var(--contrast-hover);}
      .appearance-control input:checked+span{background:var(--contrast-highlight);color:#202020;}
      .plugin-switch:checked{background:var(--contrast-highlight);box-shadow:inset 0 0 0 1px #202020;}
      .plugin-switch:checked::before{background:#202020;}
      .bq-links-drawer .bq-links-record{background:var(--contrast-hover);border:1px solid var(--line);border-radius:0;}
      .bq-table .bq-link{border-radius:var(--r-pill);}
      .open-button,.action-button,.theme-button{border-color:var(--ink);}
      :is(.open-button,.action-button,.theme-button,.extension-tab,.bq-links-more):hover:not(:disabled){
        border-color:var(--contrast-highlight);background:var(--contrast-highlight);color:#202020;}
      .settings-button:hover,.file-control:hover{background:var(--contrast-hover);color:var(--ink);}
      .settings-button[aria-current=page],.extension-tab[aria-current=page]{background:var(--contrast-highlight);color:#202020;}
      .app-header :is(.open-button,.settings-button,.file-control):hover:not(:disabled),
      .app-header .settings-button[aria-current=page]{background:#202020;color:var(--contrast-highlight);border-color:var(--contrast-highlight);}
      .entity-button:hover{border-color:var(--contrast-highlight);background:var(--contrast-hover);}
      .pager button:hover:not(:disabled){background:var(--contrast-highlight);color:#202020;}
      .pager button:disabled{color:var(--muted);opacity:.5;}
      .bq-links-drawer .bq-links-more:hover,.bq-table .bq-link:hover{border-color:var(--contrast-highlight);background:var(--contrast-highlight);color:#202020;}
      .bq-links-close:hover{background:var(--contrast-hover);}
      .upload-button{border-style:solid;box-shadow:var(--shadow);}
      .upload-button:hover{border-color:var(--contrast-highlight);background:var(--contrast-hover);}
      .plain a,.bq-table a{text-decoration:underline;text-underline-offset:3px;}
      mark{background:var(--contrast-highlight);color:#202020;border-radius:0;}
      ::selection{background:var(--contrast-highlight);color:#202020;}
    `,
    states: {
      light: `:root{--canvas:#fff;--surface:#fff;--ink:#202020;--muted:#555548;--line:#747469;
        --iris:#202020;--go:#256a35;--wait:#785600;--stop:#b42318;--contrast-dot:#c9c9c4;
        --contrast-search-shadow:3px 3px 0 #202020;
        --shadow:3px 3px 0 #202020;color-scheme:light;}`,
      dark: `:root{--canvas:#171717;--surface:#202020;--ink:#f5f5f5;--muted:#c0c0b4;--line:#737368;
        --iris:#f0fb29;--go:#94d7a0;--wait:#f4cf71;--stop:#ff9a91;--contrast-dot:#48483f;
        --contrast-search-shadow:none;
        --shadow:3px 3px 0 #f0fb29;color-scheme:dark;}`
    }
  });
})();
