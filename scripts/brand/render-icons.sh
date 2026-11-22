#!/usr/bin/env bash
# Renders the opaque home-screen PNGs from scripts/brand/app-icon.svg with a headless Chromium.
# Usage: CHROME=/path/to/chrome scripts/brand/render-icons.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
chrome="${CHROME:-chromium}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for size in 180 192 512; do
	cat > "$work/icon.html" <<HTML
<!doctype html><html><body style="margin:0"><img src="file://$root/scripts/brand/app-icon.svg" width="$size" height="$size" style="display:block"></body></html>
HTML
	"$chrome" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
		--window-size="$size,$size" --screenshot="$work/$size.png" "file://$work/icon.html" >/dev/null 2>&1
	# Drop the alpha channel: iOS fills transparency with black.
	convert "$work/$size.png" -background white -alpha remove -alpha off -define png:color-type=2 "$work/$size-rgb.png"
	case "$size" in
		180) cp "$work/$size-rgb.png" "$root/public/apple-touch-icon.png" ;;
		*) cp "$work/$size-rgb.png" "$root/public/icon-$size.png" ;;
	esac
done
