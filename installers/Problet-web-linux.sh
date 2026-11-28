#!/usr/bin/env bash
# Веб-установщик Problet для Linux. Маленький файл, который скачивает настоящий браузер и становится им:
# сам файл заменяется на Problet.AppImage (с индикатором загрузки), после чего браузер запускается.
#   Problet-web-linux.sh [stable|beta]    — stable по умолчанию
# Файл с настоящим браузером ищется на сайте Problet; beta при недоступности сайта берётся прямо с GitHub.
set -e

CHANNEL="${1:-stable}"
case "$CHANNEL" in stable | beta) ;; *)
	echo "Поток: stable или beta" >&2
	exit 2
	;; esac
SITE="${PROBLET_SITE:-https://problet.dar-site.uk}/download/$CHANNEL"
SELF="$(readlink -f "$0")"
DIR="$(dirname "$SELF")"
TARGET="$DIR/Problet.AppImage"
TMP="$(mktemp "$DIR/.Problet-download.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

if [ "$(uname -m)" != "x86_64" ]; then
	echo "Сборка Problet для Linux пока есть только для x86_64" >&2
	exit 1
fi
command -v curl >/dev/null || { echo "Нужна программа curl" >&2; exit 1; }

# Список файлов потока: {"version": "...", "files": [{"name": "..."}]}
NAME="$(curl -fsSL "$SITE" 2>/dev/null | grep -o '"name": *"[^"]*linux-[a-z0-9_]*\.AppImage"' | head -n1 | sed 's/.*: *"\(.*\)"/\1/')"
if [ -n "$NAME" ]; then
	URL="$SITE/$NAME"
elif [ "$CHANNEL" = beta ]; then
	URL="$(curl -fsSL https://api.github.com/repos/cersat/Problet/releases/tags/latest | grep -o 'https://[^"]*linux-[a-z0-9_]*\.AppImage' | head -n1)"
fi
[ -n "$URL" ] || { echo "Не удалось найти файл Problet ($CHANNEL): сайт не отвечает" >&2; exit 1; }

# Загрузка с индикатором: окно zenity или kdialog, иначе полоса в терминале
percent() { tr '\r' '\n' | grep -o '[0-9][0-9]*\.[0-9]' | cut -d. -f1; }
if command -v zenity >/dev/null && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
	{ curl -fL --progress-bar -o "$TMP" "$URL" 2>&1 | percent; } | zenity --progress --auto-close --no-cancel --title="Problet" --text="Скачиваю Problet…" --percentage=0
elif command -v kdialog >/dev/null && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
	REF="$(kdialog --progressbar "Скачиваю Problet…" 100)"
	curl -fL --progress-bar -o "$TMP" "$URL" 2>&1 | percent | while read -r p; do qdbus $REF Set "" value "$p" >/dev/null 2>&1 || true; done
	qdbus $REF close >/dev/null 2>&1 || true
else
	curl -fL --progress-bar -o "$TMP" "$URL"
fi

[ -s "$TMP" ] || { echo "Загрузка не удалась" >&2; exit 1; }
chmod +x "$TMP"
mv -f "$TMP" "$TARGET"
trap - EXIT
# Если установщик назывался иначе, чем Problet.AppImage, сам он больше не нужен
[ "$SELF" = "$TARGET" ] || rm -f "$SELF"
exec "$TARGET"
