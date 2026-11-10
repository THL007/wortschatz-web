#!/bin/sh
# Build and publish dist/ to the gh-pages branch (GitHub Pages, "deploy from a branch").
set -e
cd "$(dirname "$0")/.."
npm run build
touch dist/.nojekyll
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -r dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Published to gh-pages"
