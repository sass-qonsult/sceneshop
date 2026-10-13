#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/Applications/SceneShop.app"
mkdir -p "$TARGET/Contents/MacOS" "$TARGET/Contents/Resources"
cp "$ROOT/launcher.mjs" "$TARGET/Contents/MacOS/sceneshop-desktop"
chmod +x "$TARGET/Contents/MacOS/sceneshop-desktop"
cat > "$TARGET/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>SceneShop</string>
<key>CFBundleIdentifier</key><string>io.sceneshop.desktop</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.19.0</string>
<key>CFBundleExecutable</key><string>sceneshop-desktop</string>
</dict></plist>
PLIST
printf 'SceneShop Desktop installed at %s\n' "$TARGET"
