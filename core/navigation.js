/* Browser history follows the hierarchy; File/Blob objects stay in memory. */
(function () {
  Bouquet.createNavigation = onNavigate => {
    const browser = globalThis.history;
    const session = 'bouquet-' + Date.now() + '-' + Math.random();
    const records = new Map();
    let path = [], pending = null, next = 0;
    const available = browser?.pushState && browser?.replaceState && browser?.go;
    function write(routes, replace = false) {
      const id = ++next;
      records.set(id, routes);
      browser[replace ? 'replaceState' : 'pushState']({ bouquetNavigation: { session, id } }, '');
    }
    function sync(routes) {
      if (!available) { path = routes; return; }
      if (pending) { pending = routes; return; }
      if (!path.length) { path = routes.slice(0, 1); write(path, true); }
      let common = 0;
      while (common < path.length && common < routes.length && path[common].key === routes[common].key) common++;
      if (common < path.length) {
        pending = routes;
        browser.go(common - path.length);
        return;
      }
      if (common === routes.length) {
        path = routes;
        const state = browser.state?.bouquetNavigation;
        if (state?.session === session) records.set(state.id, path);
        return;
      }
      for (let i = common; i < routes.length; i++) {
        path = routes.slice(0, i + 1); write(path);
      }
    }
    function go(key) {
      const current = pending || path;
      const index = current.findIndex(route => route.key === key);
      if (index < 0 || index === current.length - 1) return;
      if (pending) { pending = current.slice(0, index + 1); return; }
      if (available) browser.go(index - path.length + 1);
      else { path = current.slice(0, index + 1); onNavigate(path.at(-1)); }
    }
    if (available) addEventListener('popstate', event => {
      const state = event.state?.bouquetNavigation;
      if (state?.session !== session || !records.has(state.id)) return;
      path = records.get(state.id);
      if (pending) { const routes = pending; pending = null; sync(routes); }
      else onNavigate(path.at(-1));
    });
    return { sync, go };
  };
})();
