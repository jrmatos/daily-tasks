#!/usr/bin/env bash
# Build and install / uninstall Daily Tasks on Ubuntu.
#   ./install.sh                         build .deb and install system-wide (sudo; no self-update)
#   ./install.sh --user                  build an AppImage and install into ~/.local (no sudo, self-updates)
#   ./install.sh --from-release          download the latest AppImage from GitHub Releases (no toolchain)
#   ./install.sh --uninstall [--keep-data]  remove the app (deb and/or --user files)
#                                        and, after a y/N prompt, its data folder
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

APP=daily-tasks
REPO=jrmatos/daily-tasks
IDENTIFIER=com.paulo.dailytasks
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$IDENTIFIER"
BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
APPS_DIR="$HOME/.local/share/applications"

MODE=system
KEEP_DATA=0
for arg in "$@"; do
  case "$arg" in
    --user) MODE=user ;;
    --from-release) MODE=release ;;
    --uninstall) MODE=uninstall ;;
    --keep-data) KEEP_DATA=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

refresh_desktop_caches() {
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
}

# Local builds have no signing key, so skip the signed updater artifacts (release.yml makes those).
tauri_build() {
  [ -d node_modules ] || npm install
  if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    npm run tauri build -- "$@"
  else
    npm run tauri build -- "$@" --config '{"bundle":{"createUpdaterArtifacts":false}}'
  fi
}

install_system() {
  tauri_build --bundles deb
  shopt -s nullglob
  local debs=(src-tauri/target/release/bundle/deb/*.deb)
  [ ${#debs[@]} -gt 0 ] || { echo "No .deb produced" >&2; exit 1; }
  sudo apt install -y "./${debs[-1]}"
  echo "Installed. Launch 'Daily Tasks' from the app launcher."
  echo "Note: .deb installs don't self-update. Use --user or --from-release (AppImage) for in-app updates."
}

# Install an AppImage as ~/.local/bin/daily-tasks.AppImage plus a launcher entry.
install_appimage() {
  local src="$1"
  mkdir -p "$BIN_DIR" "$ICON_DIR" "$APPS_DIR"
  install -m 755 "$src" "$BIN_DIR/$APP.AppImage"
  # binary from the pre-AppImage --user install
  if [ -f "$BIN_DIR/$APP" ]; then rm -f "$BIN_DIR/$APP"; echo "Removed old $BIN_DIR/$APP"; fi
  if [ -f "src-tauri/icons/128x128@2x.png" ]; then
    install -m 644 "src-tauri/icons/128x128@2x.png" "$ICON_DIR/$APP.png"
  fi
  # WM_CLASS is the binary name (GTK prgname), so the dock groups the window.
  cat > "$APPS_DIR/$APP.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Daily Tasks
Comment=Simple daily task manager
Exec=$BIN_DIR/$APP.AppImage
Icon=$APP
Terminal=false
Categories=Utility;
StartupWMClass=$APP
DESKTOP
  refresh_desktop_caches
  echo "Installed to $BIN_DIR/$APP.AppImage. Launch 'Daily Tasks' from the app launcher."
  echo "It updates itself from GitHub Releases (⋮ → Check for updates)."
}

install_user() {
  tauri_build --bundles appimage
  shopt -s nullglob
  local imgs=(src-tauri/target/release/bundle/appimage/*.AppImage)
  [ ${#imgs[@]} -gt 0 ] || { echo "No AppImage produced" >&2; exit 1; }
  install_appimage "${imgs[-1]}"
}

install_release() {
  [ "$(uname -m)" = "x86_64" ] || { echo "Release AppImages are x86_64 only; build from source with --user." >&2; exit 1; }
  TMP_DL="$(mktemp -d)"
  trap 'rm -rf "$TMP_DL"' EXIT
  local tmp="$TMP_DL"
  echo "Downloading the latest AppImage from github.com/$REPO …"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    gh release download --repo "$REPO" --pattern '*.AppImage' --dir "$tmp"
  else
    local url
    url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | head -n1 | sed 's/.*"\(https[^"]*\)"$/\1/')" || true
    [ -n "$url" ] || { echo "No AppImage found in the latest release of $REPO (none published yet?)" >&2; exit 1; }
    curl -fL --progress-bar -o "$tmp/$APP.AppImage" "$url"
  fi
  shopt -s nullglob
  local imgs=("$tmp"/*.AppImage)
  [ ${#imgs[@]} -gt 0 ] || { echo "Download failed" >&2; exit 1; }
  install_appimage "${imgs[0]}"
}

uninstall() {
  local removed=0
  if dpkg-query -W -f='${Status}' "$APP" 2>/dev/null | grep -q "install ok installed"; then
    sudo apt remove -y "$APP"
    removed=1
  fi
  local f
  for f in "$BIN_DIR/$APP.AppImage" "$BIN_DIR/$APP" "$ICON_DIR/$APP.png" "$APPS_DIR/$APP.desktop"; do
    if [ -e "$f" ]; then rm -f "$f"; echo "Removed $f"; removed=1; fi
  done
  [ "$removed" = 1 ] && refresh_desktop_caches || echo "App not installed (nothing to remove)."

  if [ "$KEEP_DATA" = 1 ]; then
    echo "Keeping data in $DATA_DIR"
  elif [ -d "$DATA_DIR" ]; then
    local answer=""
    read -r -p "Also delete all tasks and attachments in $DATA_DIR? [y/N] " answer || true
    case "$answer" in
      y|Y|yes|YES) rm -rf -- "$DATA_DIR"; echo "Deleted $DATA_DIR" ;;
      *) echo "Kept $DATA_DIR" ;;
    esac
  fi
}

case "$MODE" in
  system) install_system ;;
  user) install_user ;;
  release) install_release ;;
  uninstall) uninstall ;;
esac
