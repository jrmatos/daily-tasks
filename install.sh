#!/usr/bin/env bash
# Build and install / uninstall Daily Tasks on Ubuntu.
#   ./install.sh                         build .deb and install system-wide (sudo)
#   ./install.sh --user                  build binary and install into ~/.local (no sudo)
#   ./install.sh --uninstall [--keep-data]  remove the app (deb and/or --user files)
#                                        and, after a y/N prompt, its data folder
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

APP=daily-tasks
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
    --uninstall) MODE=uninstall ;;
    --keep-data) KEEP_DATA=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

refresh_desktop_caches() {
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
}

install_system() {
  [ -d node_modules ] || npm install
  npm run tauri build -- --bundles deb
  shopt -s nullglob
  local debs=(src-tauri/target/release/bundle/deb/*.deb)
  [ ${#debs[@]} -gt 0 ] || { echo "No .deb produced" >&2; exit 1; }
  sudo apt install -y "./${debs[-1]}"
  echo "Installed. Launch 'Daily Tasks' from the app launcher."
}

install_user() {
  [ -d node_modules ] || npm install
  npm run tauri build -- --no-bundle
  mkdir -p "$BIN_DIR" "$ICON_DIR" "$APPS_DIR"
  install -m 755 "src-tauri/target/release/$APP" "$BIN_DIR/$APP"
  install -m 644 "src-tauri/icons/128x128@2x.png" "$ICON_DIR/$APP.png"
  # WM_CLASS is the binary name (GTK prgname), so the dock groups the window.
  cat > "$APPS_DIR/$APP.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Daily Tasks
Comment=Simple daily task manager
Exec=$BIN_DIR/$APP
Icon=$APP
Terminal=false
Categories=Utility;
StartupWMClass=$APP
DESKTOP
  refresh_desktop_caches
  echo "Installed to $BIN_DIR/$APP. Launch 'Daily Tasks' from the app launcher."
}

uninstall() {
  local removed=0
  if dpkg-query -W -f='${Status}' "$APP" 2>/dev/null | grep -q "install ok installed"; then
    sudo apt remove -y "$APP"
    removed=1
  fi
  local f
  for f in "$BIN_DIR/$APP" "$ICON_DIR/$APP.png" "$APPS_DIR/$APP.desktop"; do
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
  uninstall) uninstall ;;
esac
