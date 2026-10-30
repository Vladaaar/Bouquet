#!/usr/bin/env python3
"""Build offline distributions and Pages using only the Python standard library."""
import argparse
import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SEMVER = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"


def metadata(root, tag=None):
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(SEMVER, version):
        raise ValueError("VERSION must contain a stable version X.Y.Z")
    if tag is not None and tag != "v" + version:
        raise ValueError(f"Tag {tag!r} does not match VERSION ({version})")
    core = (root / "core/bouquet.js").read_text(encoding="utf-8")
    if not re.search(r"\bversion:\s*['\"]" + re.escape(version) + r"['\"]", core):
        raise ValueError("Bouquet.version in core/bouquet.js must match VERSION")
    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
    sections = re.split(r"(?m)^## ", changelog)[1:]
    for section in sections:
        heading, _, notes = section.partition("\n")
        if re.fullmatch(r"\[" + re.escape(version) + r"\] - \d{4}-\d{2}-\d{2}", heading) and notes.strip():
            return version
    raise ValueError(f"CHANGELOG.md needs nonempty release notes for [{version}]")


def payload(root):
    # Deliberate allowlist: never ship arbitrary databases, dotfiles or development files.
    names = ["index.html", "LICENSE", "README.md", "README_RU.md",
             "VERSION", "bouquet.files.json", "sqlite_search.png", "data/example.db", "data/example.csv"]
    for directory in ("core", "styles", "modules", "docs"):
        names.extend(p.relative_to(root).as_posix() for p in (root / directory).rglob("*")
                     if p.is_file() and not any(part.startswith(".") for part in p.relative_to(root).parts))
    result = {}
    for name in sorted(names):
        path = root / name
        if path.resolve() != root.resolve() / name:
            raise ValueError(f"Symlinks are not allowed in distributions: {name}")
        result[name] = path.read_bytes()
    return result


def archive(path, prefix, files):
    # Stable ordering, timestamps and permissions make identical inputs reproducible.
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as output:
        for name, data in sorted(files.items()):
            info = ZipInfo(f"{prefix}/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            output.writestr(info, data)


def build(root, output, tag=None):
    version = metadata(root, tag)
    files = payload(root)
    # The demo manifest must never refer to private local data or missing files.
    if json.loads(files["bouquet.files.json"]) != {"files": ["data/example.db", "data/example.csv"]}:
        raise ValueError("Release manifest must list only data/example.db and data/example.csv")
    output.mkdir(parents=True, exist_ok=True)
    checksums = []
    with tempfile.TemporaryDirectory(prefix="bouquet-build-") as temporary:
        site = Path(temporary) / "site"
        for locale in ("ru", "en"):
            localized = dict(files)
            html = files["index.html"].decode()
            if '<html lang="ru">' not in html:
                raise ValueError('Expected <html lang="ru"> in source index.html')
            html = html.replace('<html lang="ru">', f'<html lang="{locale}">', 1)
            html = html.replace('<title>💐 Bouquet</title>', f'<title>💐 Bouquet {version}</title>')
            html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta name="version" content="{version}">', 1)
            localized["index.html"] = html.encode()
            filename = f"bouquet-{version}-{locale}.zip"
            archive(output / filename, f"bouquet-{version}-{locale}", localized)
            checksums.append(f"{hashlib.sha256((output / filename).read_bytes()).hexdigest()}  {filename}\n")
            target = site if locale == "ru" else site / "en"
            for name, data in localized.items():
                destination = target / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
        (site / ".nojekyll").touch()
        # Replace only our generated Pages tree; old modules must not survive a rebuild.
        if (output / "site").exists():
            shutil.rmtree(output / "site")
        shutil.copytree(site, output / "site")
    (output / "SHA256SUMS.txt").write_text("".join(checksums), encoding="utf-8")
    # Remove the generated notes left by earlier versions of the builder.
    (output / "release-notes.md").unlink(missing_ok=True)
    return version


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require tag vX.Y.Z to match VERSION")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    try:
        version = build(ROOT, args.output.resolve(), args.tag)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Build failed: {error}\n")
    print(f"Built Bouquet {version}: {args.output}")
