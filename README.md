# Daily Tasks

A simple, fast desktop task manager for your day, with notes, photos, files and links on every task.
Built with [Tauri 2](https://tauri.app) (Rust + the system webview), so it's a small native app, not Electron.

- Daily task list: move between days, set priorities, filter, carry unfinished tasks over to today
- Click a task to add notes, files, photos, PDFs and links (use drag & drop or paste an image)
- Everything stays local: SQLite database plus an attachments folder on your machine
- Dark theme by default, with a light theme you can switch to

Supported: **Linux (Ubuntu/Debian)** and **macOS** (Apple Silicon and Intel, 10.15+). Windows should work but hasn't been tested yet.

---

## macOS

### 1. Prerequisites (one-time)

```bash
xcode-select --install                                            # Apple command line tools
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh    # Rust
brew install node                                                 # Node.js >= 20 (or use nvm)
```

Open a new terminal after installing Rust so `cargo` is on your `PATH`.

### 2. Clone, build and install

```bash
git clone https://github.com/jrmatos/daily-tasks.git
cd daily-tasks
./install-macos.sh            # builds and installs to /Applications
```

Open **Daily Tasks** from Launchpad or Spotlight. The first build takes a few minutes; later builds are fast.

Options:

| Command | What it does |
|---|---|
| `./install-macos.sh --user` | Installs to `~/Applications` (no admin rights needed) |
| `./install-macos.sh --dmg` | Only builds a `.dmg` into `src-tauri/target/release/bundle/dmg/` |
| `./install-macos.sh --from-release` | Downloads the latest release from GitHub and installs it (no Rust/Node needed) |
| `./install-macos.sh --uninstall` | Removes the app, then asks before deleting your data |
| `./install-macos.sh --uninstall --keep-data` | Removes the app and keeps your data |

The app updates itself from GitHub Releases (see [Updates](#updates)). You can also run `git pull`
and then `./install-macos.sh` again.

> The app is built on your own machine and signed ad-hoc, so Gatekeeper won't block it. If you copy a
> `.dmg` to another Mac, macOS will say it's from an unidentified developer. Right-click the app,
> choose **Open**, then confirm, or run `xattr -dr com.apple.quarantine "/Applications/Daily Tasks.app"`.

---

## Linux (Ubuntu / Debian)

### 1. Prerequisites (one-time)

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev build-essential curl
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh    # Rust
# Node.js >= 20 (e.g. via nvm)
```

### 2. Clone, build and install

```bash
git clone https://github.com/jrmatos/daily-tasks.git
cd daily-tasks
./install.sh --user     # builds an AppImage into ~/.local/bin (no sudo), adds it to the app launcher
# or
./install.sh            # builds a .deb and installs it system-wide (sudo)
```

No toolchain? `./install.sh --from-release` downloads the latest AppImage from GitHub Releases and
installs it the same way as `--user` (only the prerequisites above are skipped; x86_64 only).

Only the AppImage installs (`--user`, `--from-release`) can update themselves. A `.deb` install doesn't
self-update, so rebuild it after `git pull`.

Uninstall with `./install.sh --uninstall`. It asks before deleting your data; add `--keep-data` to keep it.

---

## Updates

The app checks GitHub Releases for a newer version about 5 seconds after launch. If there is one,
an **Update available** pill appears at the bottom of the list. Click it, or use **⋮ → Check for
updates**, to see the release notes and click **Update & restart**. The download is verified against
the public key in `src-tauri/tauri.conf.json` before it's installed. The menu also shows the current version.

Self-update works for the macOS `.app` and the Linux AppImage. It doesn't work for `.deb` installs.

### Cutting a release

```bash
scripts/release.sh 1.2.3                # bumps package.json, Cargo.toml, tauri.conf.json; commits; tags v1.2.3
git push && git push origin v1.2.3      # the tag triggers .github/workflows/release.yml
```

The workflow creates a draft release, builds signed bundles for Linux (AppImage + .deb) and macOS
(Apple Silicon + Intel), uploads them together with `latest.json`, and then publishes the release.
Installed apps pick it up on their next check. Release notes come from the tag message
(`git tag -f -a v1.2.3 -m "…"` before pushing). Without one, the commits since the previous tag are used.

Signing uses the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets.
Keep the private key (`~/.tauri/daily-tasks.key`) safe. If you lose it, installed apps can't verify
future updates and users will have to reinstall manually. Local builds don't need the key: the install
scripts and CI skip the signed updater artifacts when it isn't set.

---

## Development

```bash
npm install
npm run tauri dev       # runs the app with hot reload
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run dev` alone opens the UI in a browser and saves to localStorage (attachments are disabled there).
The frontend ↔ backend command contract is documented in [CONTRACT.md](CONTRACT.md).

## Where your data lives

| OS | Location |
|---|---|
| Linux | `~/.local/share/com.paulo.dailytasks/` |
| macOS | `~/Library/Application Support/com.paulo.dailytasks/` |

It contains `tasks.db` (SQLite) and `attachments/<taskId>/`. Deleting a task also deletes its
attachments. You can also use **⋮ → Open data folder** or **Delete all data…** inside the app.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl+N` / `⌘N` or `/` | Focus the add-task box |
| `Alt+←` / `Alt+→` (`⌥` on Mac) | Previous / next day |
| `T` | Jump to today |
| `Esc`, `Alt+←`, mouse back button | Close a task and go back to the list |
