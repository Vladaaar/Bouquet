# Bouquet desktop packaging

The release workflow uses the free [Pake CLI](https://github.com/tw93/Pake), pinned to 3.18.0 with an npm lockfile. Pake uses Tauri and the system WebView. Its [Output Exception](https://github.com/tw93/Pake/blob/main/LICENSE-EXCEPTION) permits distributing applications made through its standard configuration/packaging process under their own licence. Bouquet's existing licence is unchanged. Pake's licence and exception are included in the local frontend.

| Platform | Architecture | Release files |
| --- | --- | --- |
| Windows | x64 | `.msi` |
| macOS | Intel x64 / Apple Silicon arm64 | `.dmg` for each architecture |
| Linux | x64 | `.deb`, `.AppImage` |

Names include the app version, platform and architecture, e.g. `bouquet-X.Y.Z-desktop-windows-x64.msi`. Each package chooses the first supported system/WebView language (RU or EN), with English fallback. Settings can override the language for the current session. Hello is excluded from all packages.

## Local build

Install Node.js 22+, Python 3.10+, Rust through rustup, and [Tauri's native build prerequisites](https://v2.tauri.app/start/prerequisites/). Run from the repository root on the target OS (the builds use the host architecture):

```sh
npm ci --prefix desktop --no-audit --no-fund
python3 scripts/build_desktop.py --output dist/desktop
```

Installers and their checksum fragments appear under each output's `artifacts/` directory. Pake's JSON result is saved as `pake-result.json`; its logs go to stderr. Native compilation downloads build dependencies. It needs no Pake account or paid packaging service. The nested npm install layout lets Pake reuse the locked Tauri CLI rather than install a second toolchain in its temporary workspace. Rust uses the Cargo.lock shipped by Pake; binaries are not claimed to be bit-for-bit reproducible across toolchain/OS changes.

To inspect only the exact frontend and Pake configuration without Node/Rust dependencies:

```sh
python3 scripts/build_desktop.py --prepare-only --output dist/desktop-preview
```

The script rejects unexpected files or symlinks inside its generated frontend directory. Do not point Pake at the repository or at the general `dist/` directory.

## Release

A matching `vX.Y.Z` tag starts the existing web build/tests and four desktop jobs: Windows, Linux and both Mac architectures. Each desktop job verifies Pake's JSON output, all requested package formats, nonempty artifacts and the reported architecture. The release waits for every desktop job; incomplete builds cannot silently publish a partial set. SHA-256 fragments are verified and combined with the web/mobile checksums into the release's `SHA256SUMS.txt`. Pages deployment remains independent of the desktop jobs.

For a trial build, manually run **Test, build and release** in Actions with **desktop** enabled. This produces downloadable artifacts without a GitHub Release or Pages deployment. Standard GitHub-hosted runners are [free for public repositories](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories); private repositories use their account's Actions allowance/billing.

No paid signing certificates are required to build these packages. They have no verified publisher signature or Apple notarization (macOS uses Pake's ad-hoc signing), so OS security checks may warn or prevent launch. Signing/notarization is not configured. Windows needs WebView2; installation of a missing runtime may require a download. Linux needs the system WebKitGTK runtime; `.deb` installation resolves dependencies, while AppImage still relies on compatible system libraries.

## Local files and network boundary

The native app embeds the generated single-file frontend and its JavaScript/CSS/vendor libraries. It opens local bundled assets, never the hosted Bouquet URL. There is no local HTTP server, automatic demo scan, telemetry or file-upload code in Bouquet. The selected files are read through the existing File/Blob API and processed in the WebView; the desktop build adds no data-upload path. The build input contains no databases, checkout, hidden files or user-selected files.

A desktop-only Content Security Policy disallows remote scripts, resources, frames, form submissions and web network connections. Only local Tauri IPC (`ipc:` / `http://ipc.localhost`) is allowed for communication with the native window. Browser/ZIP/mobile distributions keep their existing policy. User-clicked external links can open the system browser; installing the system WebView or building/updating the application can require network access, separate from viewing local files.

This policy is not an OS firewall or a sandbox for arbitrary plugins. JavaScript plugins remain trusted application code, as in the browser version; install only plugins you trust. Pake also exposes native window/notification/download commands, so a deliberately malicious plugin is outside this guarantee. When changing Pake or native capabilities, review this boundary again. Before calling a native platform verified, launch its package on that OS, open local CSV/SQLite/Excel files with network access disabled, and check search, pagination, folder drops and links. CI packaging and frontend tests alone do not replace these runtime checks.
