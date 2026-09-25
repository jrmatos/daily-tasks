#!/usr/bin/env bash
# Build and install / uninstall Daily Tasks on macOS.
#   ./install-macos.sh                          build the .app and install it to /Applications
#   ./install-macos.sh --user                   install to ~/Applications instead (no admin needed)
#   ./install-macos.sh --dmg                    only build a .dmg (src-tauri/target/release/bundle/dmg/)
#   ./install-macos.sh --from-release           download the latest release instead of building (no toolchain)
#   ./install-macos.sh --uninstall [--keep-data]  remove the app and, after a y/N prompt, its data
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="Daily Tasks.app"
REPO=jrmatos/daily-tasks
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
    --from-release) MODE=release ;;
    --uninstall) MODE=uninstall ;;
    --keep-data) KEEP_DATA=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
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
  if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    npm run tauri build -- --bundles "$1"
  else
    # no signing key locally: skip the signed updater artifacts (release.yml makes those)
    npm run tauri build -- --bundles "$1" --config '{"bundle":{"createUpdaterArtifacts":false}}'
  fi
}

# Copy a built/downloaded .app into $DEST.
install_app() {
  local src="$1"
  osascript -e 'quit app "Daily Tasks"' 2>/dev/null || true
  mkdir -p "$DEST"
  rm -rf "$DEST/$APP_NAME"
  cp -R "$src" "$DEST/"
  # Ad-hoc signed (not notarized): make sure Gatekeeper doesn't flag it as quarantined.
  xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true
  echo "Installed to $DEST/$APP_NAME — open it from Launchpad / Spotlight (\"Daily Tasks\")."
}

# Download the latest <name>_<arch>.app.tar.gz from GitHub Releases and install it.
install_release() {
  local arch
  case "$(uname -m)" in
    arm64) arch=aarch64 ;;
    x86_64) arch=x64 ;;
    *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
  esac
  TMP_DL="$(mktemp -d)"
  trap 'rm -rf "$TMP_DL"' EXIT
  echo "Downloading the latest release ($arch) from github.com/$REPO …"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    gh release download --repo "$REPO" --pattern "*_${arch}.app.tar.gz" --dir "$TMP_DL"
  else
    local url
    url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | grep -o "\"browser_download_url\": *\"[^\"]*_${arch}\.app\.tar\.gz\"" | head -n1 | sed 's/.*"\(https[^"]*\)"$/\1/')" || true
    [ -n "$url" ] || { echo "No macOS ($arch) build in the latest release of $REPO (none published yet?)" >&2; exit 1; }
    curl -fL --progress-bar -o "$TMP_DL/app.tar.gz" "$url"
  fi
  local tarball="" f
  for f in "$TMP_DL"/*.tar.gz; do [ -f "$f" ] && tarball="$f"; done
  [ -n "$tarball" ] || { echo "Download failed" >&2; exit 1; }
  mkdir -p "$TMP_DL/x"
  tar -xzf "$tarball" -C "$TMP_DL/x"
  [ -d "$TMP_DL/x/$APP_NAME" ] || { echo "Archive did not contain $APP_NAME" >&2; exit 1; }
  install_app "$TMP_DL/x/$APP_NAME"
}

case "$MODE" in
  install)
    build app
    src="src-tauri/target/release/bundle/macos/$APP_NAME"
    [ -d "$src" ] || { echo "Build did not produce $src" >&2; exit 1; }
    install_app "$src"
    ;;
  release)
    install_release
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
