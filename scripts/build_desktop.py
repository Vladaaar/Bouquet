#!/usr/bin/env python3
"""Package a local, offline Bouquet frontend using the pinned Pake CLI."""
import argparse
import hashlib
import html
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import build as web

ROOT = Path(__file__).resolve().parents[1]
PAKE_VERSION = '3.18.0'
# IPC stays on the machine. No HTTP(S) server, CDN or remote web app is used.
CSP = ("default-src 'none'; script-src 'self' 'unsafe-inline' blob:; "
       "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src ipc: http://ipc.localhost; object-src 'none'; "
       "base-uri 'none'; form-action 'none'; frame-src 'none'")
TARGETS = {'windows': ('x64', {'msi'}),
           'linux': ('deb,appimage', {'deb', 'appimage'}),
           'macos': ('dmg', {'dmg'})}


def prepare(root, output, tag=None):
    """Only application code enters the native bundle, never the checkout/data tree."""
    version = web.metadata(root, tag)
    files = web.payload(root)
    source = files['index.html'].decode()
    source = web.standalone(source, files)
    source = source.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n'
                            f'<meta http-equiv="Content-Security-Policy" content="{html.escape(CSP, quote=True)}">\n'
                            f'<meta name="version" content="{version}">', 1)
    frontend = output / 'frontend'
    frontend.mkdir(parents=True, exist_ok=True)
    # A fresh input directory prevents stale/private files from entering Pake's copy.
    # Refuse unexpected files instead of deleting a user-selected directory tree.
    if any(p.name not in {'index.html', 'PAKE-LICENSE', 'PAKE-LICENSE-EXCEPTION'} or not p.is_file() or p.is_symlink() for p in frontend.iterdir()):
        raise ValueError('Desktop frontend must contain only generated files and Pake notices')
    (frontend / 'index.html').write_text(source, encoding='utf-8')
    config = {
        'url': str(frontend.resolve()), 'name': 'Bouquet',
        'identifier': 'io.github.vladaaar.bouquet', 'appVersion': version,
        'icon': str((root / 'desktop/icon.svg').resolve()),
        'width': 1280, 'height': 850, 'hideOnClose': False,
        'disabledWebShortcuts': True, 'showSystemTray': False,
    }
    config_path = output / 'pake.json'
    config_path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    return version, config_path


def collect(result, output, version, system, arch):
    """Pake can report partial success on Linux: require every requested format."""
    expected = TARGETS[system][1]
    if not result.get('ok') or result.get('platform') != {'macos': 'darwin', 'windows': 'win32', 'linux': 'linux'}[system] or result.get('arch') != arch:
        raise ValueError(f'Pake failed or returned the wrong platform/architecture: {result}')
    artifacts = result.get('outputs', [])
    formats = [item['format'].lower().lstrip('.') for item in artifacts]
    if len(formats) != len(expected) or set(formats) != expected:
        raise ValueError(f'Pake must produce {sorted(expected)}; got {formats}; warnings: {result.get("warnings")}')
    destination = output / 'artifacts'
    destination.mkdir(parents=True, exist_ok=True)
    sums = []
    for artifact, fmt in zip(artifacts, formats):
        source = Path(artifact['path'])
        if not source.is_file() or source.is_symlink() or source.stat().st_size == 0:
            raise ValueError(f'Missing/empty Pake artifact: {source}')
        extension = 'AppImage' if fmt == 'appimage' else fmt
        name = f'bouquet-{version}-desktop-{system}-{arch}.{extension}'
        target = destination / name
        shutil.copyfile(source, target)
        if fmt == 'appimage':
            target.chmod(0o755)
        sums.append(f'{hashlib.sha256(target.read_bytes()).hexdigest()}  {name}\n')
    (destination / f'SHA256SUMS-desktop-{system}-{arch}.txt').write_text(''.join(sums), encoding='utf-8')


def build(root, output, tag=None, prepare_only=False):
    output.mkdir(parents=True, exist_ok=True)
    version, config = prepare(root, output, tag or None)
    if prepare_only:
        return
    system = {'darwin': 'macos', 'win32': 'windows', 'linux': 'linux'}.get(sys.platform)
    arch = {'x86_64': 'x64', 'AMD64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(platform.machine())
    if system not in TARGETS or arch not in ({'x64', 'arm64'} if system == 'macos' else {'x64'}):
        raise ValueError('Supported: Windows/Linux x64 and macOS x64/arm64')
    package = root / 'desktop/node_modules/pake-cli'
    if json.loads((package / 'package.json').read_text(encoding='utf-8'))['version'] != PAKE_VERSION:
        raise ValueError(f'Run npm ci --prefix desktop (requires Pake {PAKE_VERSION})')
    # Ship Pake's notices alongside the local app, without modifying its source.
    for name in ('LICENSE', 'LICENSE-EXCEPTION'):
        shutil.copyfile(package / name, output / 'frontend' / ('PAKE-' + name))
    env = dict(os.environ, CI='true', NO_UPDATE_NOTIFIER='1')
    command = ['node', str(package / 'dist/cli.js'), '--config', str(config),
               '--targets', TARGETS[system][0], '--json']
    result = subprocess.run(command, cwd=output, env=env, encoding='utf-8', stdout=subprocess.PIPE, check=False)
    (output / 'pake-result.json').write_text(result.stdout, encoding='utf-8')
    if result.returncode:
        raise ValueError(f'Pake exited with {result.returncode}: {result.stdout}')
    collect(json.loads(result.stdout), output, version, system, arch)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tag')
    parser.add_argument('--prepare-only', action='store_true', help='Generate frontend/config without installing or running Pake')
    args = parser.parse_args()
    try:
        build(ROOT, args.output.resolve(), args.tag, args.prepare_only)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Desktop build failed: {error}\n')
