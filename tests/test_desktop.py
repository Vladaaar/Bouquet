"""Desktop input/privacy boundary and native artifact contract, without Rust."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('desktop_build', ROOT / 'scripts/build_desktop.py')
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name)

    def test_local_offline_frontend_has_network_policy_and_no_data_files(self):
        class Document(HTMLParser):
            def __init__(self):
                super().__init__()
                self.tags = []

            def handle_starttag(self, tag, attrs):
                self.tags.append((tag, dict(attrs)))

        for locale in ('ru', 'en'):
            output = self.output / locale
            output.mkdir()
            version, config_path = desktop.prepare(ROOT, output, locale)
            config = json.loads(config_path.read_text())
            self.assertEqual(config['appVersion'], version)
            self.assertEqual(config['identifier'], 'io.github.vladaaar.bouquet')
            frontend = Path(config['url'])
            self.assertTrue(frontend.is_absolute())
            self.assertEqual(list(p.name for p in frontend.iterdir()), ['index.html'])
            source = (frontend / 'index.html').read_text()
            doc = Document()
            doc.feed(source)
            html_attrs = next(attrs for tag, attrs in doc.tags if tag == 'html')
            self.assertEqual(html_attrs['lang'], locale)
            self.assertIn('data-standalone', html_attrs)  # skips manifest/demo fetch
            policy = next(attrs['content'] for tag, attrs in doc.tags if tag == 'meta' and attrs.get('http-equiv') == 'Content-Security-Policy')
            rules = dict(part.strip().split(' ', 1) for part in policy.split(';') if part.strip())
            self.assertEqual(rules['default-src'], "'none'")
            self.assertEqual(rules['connect-src'], 'ipc: http://ipc.localhost')
            for key in ('form-action', 'object-src', 'frame-src', 'base-uri'):
                self.assertEqual(rules[key], "'none'")
            self.assertNotIn('https:', policy)
            self.assertFalse(any(tag == 'script' and attrs.get('src') for tag, attrs in doc.tags))
            self.assertFalse(any(tag == 'link' and attrs.get('rel') == 'stylesheet' for tag, attrs in doc.tags))
            self.assertIn('modules/vendor/sheetjs-0.20.3/xlsx.full.min.js', source)
            self.assertIn('bouquet-licenses', source)
            self.assertTrue(Path(config['icon']).is_file())
            desktop.prepare(ROOT, output, locale)  # safe to regenerate

    def test_unknown_files_and_symlinks_in_input_are_rejected(self):
        desktop.prepare(ROOT, self.output, 'ru')
        private = self.output / 'frontend/private.db'
        private.write_bytes(b'private')
        with self.assertRaisesRegex(ValueError, 'generated files'):
            desktop.prepare(ROOT, self.output, 'ru')
        private.unlink()
        index = self.output / 'frontend/index.html'
        index.unlink()
        index.symlink_to(ROOT / 'index.html')
        with self.assertRaisesRegex(ValueError, 'generated files'):
            desktop.prepare(ROOT, self.output, 'ru')

    def test_wrong_tag_does_not_prepare_an_application(self):
        with self.assertRaisesRegex(ValueError, 'does not match VERSION'):
            desktop.prepare(ROOT, self.output, 'ru', 'v999.0.0')
        self.assertFalse((self.output / 'frontend').exists())

    def result(self, system, arch, formats):
        outputs = []
        for fmt in formats:
            path = self.output / ('Pake.' + fmt)
            path.write_bytes(b'test-native-installer')
            outputs.append({'format': fmt, 'path': str(path)})
        return {'ok': True, 'platform': {'macos': 'darwin', 'windows': 'win32', 'linux': 'linux'}[system],
                'arch': arch, 'outputs': outputs, 'warnings': []}

    def test_artifact_names_and_checksums_for_every_platform_locale(self):
        for system, arch in (('windows', 'x64'), ('linux', 'x64'), ('macos', 'x64'), ('macos', 'arm64')):
            for locale in ('ru', 'en'):
                formats = desktop.TARGETS[system][1]
                result = self.result(system, arch, formats)
                desktop.collect(result, self.output, '1.2.3', locale, system, arch)
                artifacts = self.output / 'artifacts'
                manifest = artifacts / f'SHA256SUMS-desktop-{system}-{arch}-{locale}.txt'
                lines = manifest.read_text().splitlines()
                self.assertEqual(len(lines), len(formats))
                for line in lines:
                    digest, name = line.split('  ')
                    self.assertTrue(name.startswith(f'bouquet-1.2.3-desktop-{system}-{arch}-{locale}.'))
                    self.assertEqual(hashlib.sha256((artifacts / name).read_bytes()).hexdigest(), digest)
                    if name.endswith('.AppImage'):
                        self.assertTrue((artifacts / name).stat().st_mode & 0o111)

    def test_partial_linux_build_cannot_be_published_as_success(self):
        result = self.result('linux', 'x64', ['deb'])
        with self.assertRaisesRegex(ValueError, 'must produce'):
            desktop.collect(result, self.output, '1.2.3', 'en', 'linux', 'x64')
        self.assertFalse((self.output / 'artifacts').exists())

    def test_failed_wrong_arch_and_missing_native_artifacts_are_rejected(self):
        result = self.result('windows', 'arm64', ['msi'])
        with self.assertRaisesRegex(ValueError, 'wrong platform/architecture'):
            desktop.collect(result, self.output, '1.2.3', 'ru', 'windows', 'x64')
        result['arch'] = 'x64'
        Path(result['outputs'][0]['path']).unlink()
        with self.assertRaisesRegex(ValueError, 'Missing/empty'):
            desktop.collect(result, self.output, '1.2.3', 'ru', 'windows', 'x64')

    def test_pake_is_pinned_with_nested_locked_dependencies(self):
        package = json.loads((ROOT / 'desktop/package.json').read_text())
        lock = json.loads((ROOT / 'desktop/package-lock.json').read_text())
        self.assertEqual(package['dependencies']['pake-cli'], desktop.PAKE_VERSION)
        self.assertEqual(lock['packages']['node_modules/pake-cli']['version'], desktop.PAKE_VERSION)
        self.assertIn('node_modules/pake-cli/node_modules/@tauri-apps/cli', lock['packages'])
