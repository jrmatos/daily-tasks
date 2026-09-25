#!/usr/bin/env bash
# Cut a release: bump the version everywhere, commit and tag it. Does NOT push.
#   scripts/release.sh 1.2.3
# Then push (printed at the end) and .github/workflows/release.yml builds, signs and
# publishes the GitHub Release that the in-app updater picks up.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
VERSION="${VERSION#v}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: scripts/release.sh X.Y.Z   (semver, e.g. 1.2.3)" >&2
  exit 1
fi
TAG="v$VERSION"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Commit or stash your changes first:" >&2
  git status --short >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG already exists." >&2
  exit 1
fi

CURRENT="$(node -p "require('./package.json').version")"
echo "Bumping $CURRENT -> $VERSION"

# package.json + package-lock.json
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null

# src-tauri/tauri.conf.json
node -e '
  const fs = require("fs");
  const p = "src-tauri/tauri.conf.json";
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.version = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
' "$VERSION"

# src-tauri/Cargo.toml: only the version line of the [package] section
awk -v v="$VERSION" '
  /^\[/ { in_pkg = ($0 == "[package]") }
  in_pkg && !done && /^version[[:space:]]*=/ { print "version = \"" v "\""; done = 1; next }
  { print }
' src-tauri/Cargo.toml > src-tauri/Cargo.toml.tmp && mv src-tauri/Cargo.toml.tmp src-tauri/Cargo.toml

# refresh Cargo.lock for the new crate version (no network needed)
(cd src-tauri && { cargo update -p daily-tasks --offline >/dev/null 2>&1 || cargo metadata --offline --format-version 1 >/dev/null; })

git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -q -m "chore: release $TAG"
git tag -a "$TAG" -m "chore: release $TAG"

echo "Committed and tagged $TAG. To publish the release, run:"
echo
echo "  git push && git push origin $TAG"
echo
echo "Tip: to use custom release notes, re-tag with a message before pushing:"
echo "  git tag -f -a $TAG -m \"Release notes...\""
