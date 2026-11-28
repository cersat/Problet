#!/usr/bin/env bash
# Веб-установщик Problet для macOS: скачивает браузер и кладёт Problet.app в «Программы».
#   Problet-web-mac.command [stable|beta]    — stable по умолчанию
# Двойным щелчком открывается в «Терминале», там и виден ход загрузки.
set -e

CHANNEL="${1:-stable}"
case "$CHANNEL" in stable | beta) ;; *)
	echo "Поток: stable или beta" >&2
	exit 2
	;; esac
SITE="${PROBLET_SITE:-https://problet.dar-site.uk}/download/$CHANNEL"
case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac

NAME="$(curl -fsSL "$SITE" | grep -o '"name": *"[^"]*mac-'"$ARCH"'\.zip"' | head -n1 | sed 's/.*: *"\(.*\)"/\1/')"
if [ -z "$NAME" ] && [ "$CHANNEL" = beta ]; then
	URL="$(curl -fsSL https://api.github.com/repos/cersat/Problet/releases/tags/latest | grep -o 'https://[^"]*mac-'"$ARCH"'\.zip' | head -n1)"
else
	URL="$SITE/$NAME"
fi
[ -n "$NAME$URL" ] && [ "$URL" != "$SITE/" ] || { echo "Не удалось найти файл Problet ($CHANNEL): сайт не отвечает" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Скачиваю Problet ($CHANNEL, $ARCH)…"
curl -fL --progress-bar -o "$WORK/problet.zip" "$URL"
echo "Устанавливаю…"
ditto -x -k "$WORK/problet.zip" "$WORK/out"
APP="$(find "$WORK/out" -maxdepth 1 -name '*.app' | head -n1)"
[ -n "$APP" ] || { echo "В архиве нет приложения" >&2; exit 1; }
DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
rm -rf "$DEST/Problet.app"
mv "$APP" "$DEST/Problet.app"
xattr -dr com.apple.quarantine "$DEST/Problet.app" 2>/dev/null || true
echo "Готово: $DEST/Problet.app"
open "$DEST/Problet.app"
