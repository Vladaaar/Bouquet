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
            mobile_name = f"bouquet-{version}-mobile-{locale}.html"
            mobile = (self.output / mobile_name).read_bytes()
            self.assertEqual(hashlib.sha256(mobile).hexdigest(), sums[mobile_name])
            self.assertEqual((site / 'mobile.html').read_bytes(), mobile)
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
            f"bouquet-{version}-ru.zip", f"bouquet-{version}-en.zip",
            f"bouquet-{version}-mobile-ru.html", f"bouquet-{version}-mobile-en.html",
            "SHA256SUMS.txt", "site"
        })
        self.assertFalse((self.output / "site/CHANGELOG.md").exists())

    def test_mobile_is_self_contained_and_inline_scripts_remain_valid(self):
        from html.parser import HTMLParser

        class Document(HTMLParser):
            def __init__(self):
                super().__init__()
                self.external = []
                self.sources = []

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'script':
                    if attrs.get('src'):
                        self.external.append(attrs['src'])
                    if attrs.get('data-bouquet-source'):
                        self.sources.append(attrs['data-bouquet-source'])
                if tag == 'link' and attrs.get('rel') == 'stylesheet':
                    self.external.append(attrs.get('href'))

        version = builder.build(ROOT, self.output)
        for locale in ('ru', 'en'):
            path = self.output / f'bouquet-{version}-mobile-{locale}.html'
            html = path.read_text(encoding='utf-8')
            doc = Document()
            doc.feed(html)
            self.assertEqual(doc.external, [])
            self.assertIn(f'<html data-standalone="true" lang="{locale}">', html)
            self.assertEqual(len(doc.sources), len(set(doc.sources)))
            self.assertEqual(set(doc.sources), {name for name in builder.payload(ROOT) if name.endswith('.js')})
            self.assertLess(doc.sources.index('modules/vendor/sheetjs-0.20.3/xlsx.full.min.js'), doc.sources.index('modules/excel.js'))
            self.assertLess(doc.sources.index('modules/hello.js'), doc.sources.index('core/ui.js'))
            licenses = re.search(r'<script type="application/json" id="bouquet-licenses">(.*?)</script>', html, re.S)
            self.assertEqual(json.loads(licenses[1])['modules/vendor/sheetjs-0.20.3/LICENSE'], (ROOT / 'modules/vendor/sheetjs-0.20.3/LICENSE').read_text())
            subprocess.run(['node', '-e', r'''
              const fs = require('node:fs'), vm = require('node:vm');
              const html = fs.readFileSync(process.argv[1], 'utf8');
              for (const [, attrs, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                if (!attrs.includes('application/json')) new vm.Script(source);
              }
            ''', str(path)], check=True, capture_output=True)

    def test_mobile_escapes_script_terminators(self):
        files = builder.payload(ROOT)
        files['modules/hello.js'] += b'\nconst testTerminator = "</script><p>injected</p>";\n'
        mobile = builder.standalone(files['index.html'].decode(), files)
        self.assertIn(r'"<\/script><p>injected</p>"', mobile)
        self.assertNotIn('"</script><p>injected</p>"', mobile)

    def test_reproducible_and_cleans_stale_pages_files(self):
        version = builder.build(ROOT, self.output)
        first = (self.output / f"bouquet-{version}-en.zip").read_bytes()
        mobile = (self.output / f"bouquet-{version}-mobile-en.html").read_bytes()
        (self.output / "site/obsolete.js").touch()
        (self.output / "release-notes.md").write_text("Obsolete generated notes")
        builder.build(ROOT, self.output, "v" + version)
        self.assertEqual(first, (self.output / f"bouquet-{version}-en.zip").read_bytes())
        self.assertEqual(mobile, (self.output / f"bouquet-{version}-mobile-en.html").read_bytes())
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
