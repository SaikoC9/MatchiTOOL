#!/bin/sh
# The bundled "sha256" helper must hash a file's CONTENT (1.4.3 and earlier hashed the path text, which made the AdGuard Home install refuse a good download).
T="$(dirname "$0")/../app/src/main/assets/bin/sha256"
D=$(mktemp -d) || exit 1
trap 'rm -rf "$D"' EXIT
printf 'hello' > "$D/f.bin"
WANT=2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
fail() { echo "FAIL sha256 tool: $1"; exit 1; }
[ "$(sh "$T" "$D/f.bin")" = "$WANT" ] || fail "file argument did not give the hash of the file content"
[ "$(printf hello | sh "$T")" = "$WANT" ] || fail "standard input"
[ "$(sh "$T" hello)" = "$WANT" ] || fail "text argument that is not a file"
echo "ok   sha256 tool hashes file content, stdin and text"
