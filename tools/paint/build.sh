#!/bin/sh
# Пересборка pages/svgedit.js. Нужны git и npm; результат кладётся в ../../pages
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-/tmp/problet-paint}
if [ ! -d "$WORK/.git" ]; then GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/TurboWarp/scratch-paint "$WORK"; fi
cd "$WORK"
[ -d node_modules ] || npm install --ignore-scripts --no-audit --no-fund
mkdir -p src/problet
cp "$HERE/entry.jsx" "$HERE/entry.css" src/problet/
cp "$HERE/webpack.problet.js" .
NODE_OPTIONS=--openssl-legacy-provider OUT="$HERE/../../pages" npx webpack --config webpack.problet.js --bail
cp LICENSE "$HERE/../../pages/svgedit.LICENSE.txt"
