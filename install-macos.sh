#!/usr/bin/env bash
# Build and install / uninstall Daily Tasks on macOS.
#   ./install-macos.sh                          build the .app and install it to /Applications
#   ./install-macos.sh --user                   install to ~/Applications instead (no admin needed)
#   ./install-macos.sh --dmg                    only build a .dmg (src-tauri/target/release/bundle/dmg/)
#   ./install-macos.sh --uninstall [--keep-data]  remove the app and, after a y/N prompt, its data
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="Daily Tasks.app"
IDENTIFIER=com.paulo.dailytasks
DATA_DIR="$HOME/Library/Application Support/$IDENTIFIER"
CACHE_DIRS=("$HOME/Library/Caches/$IDENTIFIER" "$HOME/Library/WebKit/$IDENTIFIER" "$HOME/Library/WebKit/daily-tasks")

MODE=install
DEST=/Applications
KEEP_DATA=0
for arg in "$@"; do
  case "$arg" in
    --user) DEST="$HOME/Applications" ;;
    --dmg) MODE=dmg ;;
    --uninstall) MODE=uninstall ;;
    --keep-data) KEEP_DATA=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || { echo "This script is for macOS. On Linux use ./install.sh" >&2; exit 1; }

check_prereqs() {
  xcode-select -p >/dev/null 2>&1 || { echo "Missing Xcode Command Line Tools. Run: xcode-select --install" >&2; exit 1; }
  command -v cargo >/dev/null || { echo "Missing Rust. Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2; exit 1; }
  command -v npm >/dev/null || { echo "Missing Node.js (>= 20). Install: brew install node" >&2; exit 1; }
}

build() {
  check_prereqs
  [ -d node_modules ] || npm ci
  npm run tauri build -- --bundles "$1"
}

case "$MODE" in
  install)
    build app
    src="src-tauri/target/release/bundle/macos/$APP_NAME"
    [ -d "$src" ] || { echo "Build did not produce $src" >&2; exit 1; }
    osascript -e 'quit app "Daily Tasks"' 2>/dev/null || true
    mkdir -p "$DEST"
    rm -rf "$DEST/$APP_NAME"
    cp -R "$src" "$DEST/"
    # Locally built, ad-hoc signed: make sure Gatekeeper doesn't flag it as quarantined.
    xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true
    echo "Installed to $DEST/$APP_NAME — open it from Launchpad / Spotlight (\"Daily Tasks\")."
    ;;
  dmg)
    build dmg
    ls -1 src-tauri/target/release/bundle/dmg/*.dmg
    ;;
  uninstall)
    osascript -e 'quit app "Daily Tasks"' 2>/dev/null || true
    for d in "/Applications/$APP_NAME" "$HOME/Applications/$APP_NAME"; do
      [ -d "$d" ] && rm -rf "$d" && echo "Removed $d"
    done
    if [ "$KEEP_DATA" = 0 ] && [ -d "$DATA_DIR" ]; then
      read -r -p "Also delete all tasks and attachments in '$DATA_DIR'? [y/N] " ans
      if [[ "$ans" =~ ^[Yy]$ ]]; then
        rm -rf "$DATA_DIR" "${CACHE_DIRS[@]}"
        echo "Data deleted."
      else
        echo "Data kept."
      fi
    fi
    ;;
esac
