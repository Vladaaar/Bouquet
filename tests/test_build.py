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

    def test_complete_offline_archive_and_pages(self):
        version = builder.build(ROOT, self.output)
        sums = dict(line.split("  ")[::-1] for line in (self.output / "SHA256SUMS.txt").read_text().splitlines())
        name = f"bouquet-{version}-html.zip"
        self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), sums[name])
        with ZipFile(self.output / name) as archive:
            self.assertIsNone(archive.testzip())
            files = {n.split("/", 1)[1]: archive.read(n) for n in archive.namelist()}
        html = files["index.html"].decode()
        self.assertIn(f'<meta name="version" content="{version}">', html)
        self.assertIn('<title>Bouquet</title>', html)
        for reference in re.findall(r'(?:src|href)="([^"]+)"', html):
            if not reference.startswith(("https:", "#", "data:")):
                self.assertIn(reference, files)
        for module in (ROOT / "modules").rglob("*.js"):
            name = module.relative_to(ROOT).as_posix()
            if name == "modules/hello.js":
                self.assertNotIn(name, files)
            else:
                self.assertIn(name, files)
        for name in ('modules/vendor/sheetjs-0.20.3/LICENSE', 'modules/vendor/cronodump/LICENSE', 'docs/DEVELOPMENT.md', 'docs/DEVELOPMENT_RU.md'):
            self.assertIn(name, files)
        self.assertNotIn("CHANGELOG.md", files)
        self.assertNotIn("release-notes.md", files)
        self.assertEqual({name for name in files if name.startswith("data/")}, {"data/example.db", "data/example.csv"})
        self.assertFalse(any(name.startswith(("tests/", "scripts/", ".git")) or name.endswith((".DS_Store", "design.md")) for name in files))
        site = self.output / "site"
        for name, data in files.items():
            if name == 'bouquet.files.json':
                self.assertEqual(json.loads((site / name).read_bytes()), {'files': []})
                self.assertEqual(json.loads(data), {'files': ['data/example.db', 'data/example.csv']})
            else:
                self.assertEqual((site / name).read_bytes(), data)
        self.assertFalse((site / 'modules/hello.js').exists())
        self.assertTrue((site / '.nojekyll').is_file())
        self.assertIn('url=../', (site / 'en/index.html').read_text())
        self.assertIn('url=../mobile.html', (site / 'en/mobile.html').read_text())
        android_name = f"bouquet-{version}-html-android.html"
        android = (self.output / android_name).read_bytes()
        self.assertEqual(hashlib.sha256(android).hexdigest(), sums[android_name])
        self.assertEqual((site / 'mobile.html').read_bytes(), android)
        self.assertEqual({p.name for p in self.output.iterdir()}, {f"bouquet-{version}-html.zip", android_name, "SHA256SUMS.txt", "site"})
        self.assertEqual(set(sums), {f"bouquet-{version}-html.zip", android_name})

    def test_android_is_self_contained_without_hello_and_scripts_remain_valid(self):
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
        path = self.output / f'bouquet-{version}-html-android.html'
        html = path.read_text(encoding='utf-8')
        doc = Document()
        doc.feed(html)
        self.assertEqual(doc.external, [])
        self.assertIn('data-standalone="true"', html)
        self.assertIn('<title>Bouquet</title>', html)
        self.assertNotIn('modules/hello.js', doc.sources)
        self.assertEqual(len(doc.sources), len(set(doc.sources)))
        self.assertEqual(set(doc.sources), {name for name in builder.payload(ROOT) if name.endswith('.js')})
        self.assertLess(doc.sources.index('modules/vendor/sheetjs-0.20.3/xlsx.full.min.js'), doc.sources.index('modules/excel.js'))
        licenses = re.search(r'<script type="application/json" id="bouquet-licenses">(.*?)</script>', html, re.S)
        self.assertEqual(json.loads(licenses[1])['modules/vendor/sheetjs-0.20.3/LICENSE'], (ROOT / 'modules/vendor/sheetjs-0.20.3/LICENSE').read_text())
        subprocess.run(['node', '-e', r'''
          const fs = require('node:fs'), vm = require('node:vm');
          const html = fs.readFileSync(process.argv[1], 'utf8');
          for (const [, attrs, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (!attrs.includes('application/json')) new vm.Script(source);
          }
        ''', str(path)], check=True, capture_output=True)

    def test_android_escapes_script_terminators(self):
        files = builder.payload(ROOT)
        files['modules/search.js'] += b'\nconst testTerminator = "</script><p>injected</p>";\n'
        android = builder.standalone(files['index.html'].decode(), files)
        self.assertIn(r'"<\/script><p>injected</p>"', android)
        self.assertNotIn('"</script><p>injected</p>"', android)

    def test_reproducible_and_cleans_stale_generated_files(self):
        version = builder.build(ROOT, self.output)
        name = f"bouquet-{version}-html.zip"
        android_name = f"bouquet-{version}-html-android.html"
        first = (self.output / name).read_bytes()
        android = (self.output / android_name).read_bytes()
        (self.output / "site/modules/hello.js").write_text('Old Hello')
        (self.output / "site/obsolete.js").touch()
        (self.output / "release-notes.md").write_text("Obsolete generated notes")
        old = [f"bouquet-{version}-{locale}.zip" for locale in ('ru', 'en')] + [f"bouquet-{version}-mobile-{locale}.html" for locale in ('ru', 'en')]
        for name in old:
            (self.output / name).touch()
        builder.build(ROOT, self.output, "v" + version)
        self.assertEqual(first, (self.output / f"bouquet-{version}-html.zip").read_bytes())
        self.assertEqual(android, (self.output / android_name).read_bytes())
        self.assertFalse((self.output / "site/obsolete.js").exists())
        self.assertFalse((self.output / "site/modules/hello.js").exists())
        self.assertFalse((self.output / "release-notes.md").exists())
        self.assertTrue(all(not (self.output / name).exists() for name in old))

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
