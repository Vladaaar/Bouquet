"""Distribution integration tests: complete offline payload, locale and release metadata."""
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build", ROOT / "scripts/build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / "dist"

    def test_complete_offline_archives_and_pages(self):
        version = builder.build(ROOT, self.output)
        sums = {}
        for line in (self.output / "SHA256SUMS.txt").read_text().splitlines():
            digest, name = line.split("  ")
            sums[name] = digest
        for locale in ("ru", "en"):
            name = f"bouquet-{version}-{locale}.zip"
            self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), sums[name])
            with ZipFile(self.output / name) as archive:
                self.assertIsNone(archive.testzip())
                files = {n.split("/", 1)[1]: archive.read(n) for n in archive.namelist()}
            html = files["index.html"].decode()
            self.assertIn(f'<html lang="{locale}">', html)
            self.assertIn(f'<meta name="version" content="{version}">', html)
            for reference in re.findall(r'(?:src|href)="([^"]+)"', html):
                if not reference.startswith(("https:", "#")):
                    self.assertIn(reference, files)
            for module in (ROOT / "modules").rglob("*.js"):
                self.assertIn(module.relative_to(ROOT).as_posix(), files)
            self.assertIn("modules/vendor/sheetjs-0.20.3/LICENSE", files)
            self.assertIn("modules/vendor/cronodump/LICENSE", files)
            self.assertIn("modules/hello.js", files)
            self.assertIn("docs/DEVELOPMENT.md", files)
            self.assertIn("docs/DEVELOPMENT_RU.md", files)
            self.assertNotIn('src="modules/hello.js"', html)
            self.assertNotIn("CHANGELOG.md", files)
            self.assertNotIn("release-notes.md", files)
            self.assertEqual({name for name in files if name.startswith("data/")}, {"data/example.db", "data/example.csv"})
            self.assertFalse(any(name.startswith(("tests/", "scripts/", ".git")) or name.endswith((".DS_Store", "design.md")) for name in files))
            site = self.output / "site" / ("en" if locale == "en" else "")
            for filename, data in files.items():
                self.assertEqual((site / filename).read_bytes(), data)
            # Execute the shipped scripts, using only Node built-ins, to verify the
            # actual initial language and that switching languages remains possible.
            subprocess.run(["node", "-e", """
              const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
              const [folder, locale] = process.argv.slice(1);
              const html = fs.readFileSync(folder + '/index.html', 'utf8');
              let lang = html.match(/<html lang="([^"]+)"/)[1];
              const context = vm.createContext({document: {
                documentElement: {getAttribute: () => lang, setAttribute: (_, value) => {lang = value;}},
                querySelectorAll: () => []
              }});
              context.window = context;
              for (const name of ['bouquet', 'i18n']) vm.runInContext(fs.readFileSync(folder + '/core/' + name + '.js', 'utf8'), context);
              assert.equal(context.Bouquet.i18n.locale, locale);
              assert.equal(context.Bouquet.i18n.t('open'), locale === 'en' ? 'Open' : 'Открыть');
              context.Bouquet.i18n.setLanguage('language-' + (locale === 'en' ? 'ru' : 'en'));
              assert.notEqual(lang, locale);
            """, str(site), locale], check=True, capture_output=True)
        self.assertTrue((self.output / "site/.nojekyll").is_file())
        self.assertEqual({p.name for p in self.output.iterdir()}, {
            f"bouquet-{version}-ru.zip", f"bouquet-{version}-en.zip", "SHA256SUMS.txt", "site"
        })
        self.assertFalse((self.output / "site/CHANGELOG.md").exists())

    def test_reproducible_and_cleans_stale_pages_files(self):
        version = builder.build(ROOT, self.output)
        first = (self.output / f"bouquet-{version}-en.zip").read_bytes()
        (self.output / "site/obsolete.js").touch()
        (self.output / "release-notes.md").write_text("Obsolete generated notes")
        builder.build(ROOT, self.output, "v" + version)
        self.assertEqual(first, (self.output / f"bouquet-{version}-en.zip").read_bytes())
        self.assertFalse((self.output / "site/obsolete.js").exists())
        self.assertFalse((self.output / "release-notes.md").exists())

    def test_wrong_tag_cannot_produce_a_release(self):
        with self.assertRaisesRegex(ValueError, "does not match VERSION"):
            builder.build(ROOT, self.output, "v999.0.0")
        self.assertFalse(self.output.exists())

    def test_version_and_notes_must_agree(self):
        root = Path(self.temporary.name) / "source"
        (root / "core").mkdir(parents=True)
        for name in ("VERSION", "CHANGELOG.md", "core/bouquet.js"):
            shutil.copyfile(ROOT / name, root / name)
        (root / "VERSION").write_text("9.0.0\n")
        with self.assertRaisesRegex(ValueError, "Bouquet.version"):
            builder.metadata(root)
        (root / "core/bouquet.js").write_text("version: '9.0.0'")
        with self.assertRaisesRegex(ValueError, "release notes"):
            builder.metadata(root)
        (root / "VERSION").write_text("../invalid")
        with self.assertRaisesRegex(ValueError, "X.Y.Z"):
            builder.metadata(root)

    def test_local_files_and_symlinks_are_not_packaged(self):
        root = Path(self.temporary.name) / "source"
        root.mkdir()
        for name, data in builder.payload(ROOT).items():
            destination = root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        (root / "data/private.db").write_bytes(b"private")
        (root / "modules/.secret").write_bytes(b"secret")
        self.assertNotIn("data/private.db", builder.payload(root))
        self.assertNotIn("modules/.secret", builder.payload(root))
        (root / "modules/leak.js").symlink_to(root / "data/private.db")
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            builder.payload(root)

    def test_custom_manifest_cannot_expose_local_databases(self):
        root = Path(self.temporary.name) / "source"
        root.mkdir()
        shutil.copyfile(ROOT / "CHANGELOG.md", root / "CHANGELOG.md")
        for name, data in builder.payload(ROOT).items():
            destination = root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        (root / "bouquet.files.json").write_text(json.dumps({"files": ["data/private.db"]}))
        with self.assertRaisesRegex(ValueError, "Release manifest"):
            builder.build(root, self.output)
        self.assertFalse(self.output.exists())
