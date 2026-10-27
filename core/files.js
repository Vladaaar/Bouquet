/* Folder selection needs only file metadata; contents are read after selection. */
(function () {
  const U = Bouquet.util;
  U.fileEntries = files => Array.from(files, file => ({
    name: file.webkitRelativePath || file.name, file
  })).sort((a, b) => a.name.localeCompare(b.name, Bouquet.i18n.locale, { numeric: true }));
  U.dropEntries = async items => {
    const files = [];
    async function visit(entry, prefix = '') {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        files.push({ name: prefix + entry.name, file });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        // Chromium can return directories in batches of only 100 entries.
        for (;;) {
          const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!batch.length) break;
          for (const child of batch) await visit(child, prefix + entry.name + '/');
        }
      }
    }
    for (const item of items) {
      if (item.entry) await visit(item.entry);
      else if (item.file) files.push({ name: item.file.name, file: item.file });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, Bouquet.i18n.locale, { numeric: true }));
  };
})();
