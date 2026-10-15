#!/usr/bin/env bash
set -euo pipefail
PREFIX="${PREFIX:-$HOME/.local}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/icons/hicolor/512x512/apps"
install -m 0755 "$ROOT/launcher.mjs" "$PREFIX/bin/sceneshop-desktop"
install -m 0644 "$ROOT/sceneshop.desktop" "$PREFIX/share/applications/sceneshop.desktop"
if [[ -f "$ROOT/sceneshop-512.png" ]]; then install -m 0644 "$ROOT/sceneshop-512.png" "$PREFIX/share/icons/hicolor/512x512/apps/sceneshop.png"; fi
printf 'SceneShop Desktop installed under %s\n' "$PREFIX"
