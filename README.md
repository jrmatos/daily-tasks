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
| `./install-macos.sh --uninstall` | Removes the app, then asks before deleting your data |
| `./install-macos.sh --uninstall --keep-data` | Removes the app and keeps your data |

To update, run `git pull` and then `./install-macos.sh` again.

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
./install.sh --user     # installs to ~/.local (no sudo) and adds it to the app launcher
# or
./install.sh            # builds a .deb and installs it system-wide (sudo)
```

Uninstall with `./install.sh --uninstall`. It asks before deleting your data; add `--keep-data` to keep it.

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
