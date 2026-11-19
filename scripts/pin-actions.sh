#!/usr/bin/env bash
# Pins every "uses: owner/repo@tag" in .github/workflows/*.yml to the full commit the tag points at, and keeps the tag
# as a comment:   uses: actions/checkout@<40 hex> # v6
# Run it with network access, review the diff, commit. Run it again after you change a tag.
#   scripts/pin-actions.sh          rewrite the files
#   scripts/pin-actions.sh --check  only list what is not pinned (exit 1 if anything is)
# A tag that cannot be found stops the script, so it also tells you when a tag in a workflow does not exist.
set -euo pipefail
cd "$(dirname "$0")/.."
check=0; [ "${1:-}" = "--check" ] && check=1

refs=$(grep -hoE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[A-Za-z0-9_.-]+' .github/workflows/*.yml | sed 's/^uses: //' | sort -u || true)
todo=0
for ref in $refs; do
  path=${ref%@*}; tag=${ref#*@}
  case "$tag" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) continue;; esac
  todo=$((todo + 1))
  if [ "$check" = 1 ]; then echo "not pinned: $ref"; continue; fi
  repo=$(echo "$path" | cut -d/ -f1,2)
  out=$(git ls-remote "https://github.com/$repo" "refs/tags/$tag" "refs/tags/$tag^{}")
  sha=$(echo "$out" | awk '/\^\{\}$/ {print $1; exit}')
  [ -n "$sha" ] || sha=$(echo "$out" | awk 'NF {print $1; exit}')
  [ -n "$sha" ] || { echo "error: tag $tag not found in $repo" >&2; exit 1; }
  esc=$(printf '%s' "$ref" | sed 's/[.[\*^$/]/\\&/g')
  sed -i -E "s|uses: $esc( #.*)?\$|uses: $path@$sha # $tag|" .github/workflows/*.yml
  echo "pinned $path@$tag -> $sha"
done
[ "$check" = 1 ] && [ "$todo" -gt 0 ] && exit 1
exit 0
