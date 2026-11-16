#!/bin/bash
# The whole suite, one area per Node process, one after another, so each area's pages are freed when it ends.
# One process for everything kept dozens of copies of Arc in memory and ran out (2026-11-15); this VM has 4 GB.
# Prints only failures, crashes and a last line with the totals. Each area's full output is kept in $OUT.
cd "$(dirname "$0")" || exit 1
OUT="${OUT:-${TMPDIR:-/tmp}/arc-tests}"
rm -rf "$OUT" && mkdir -p "$OUT"
mapfile -t AREAS < <(node run.js --list)
passed=0; failed=0; bad=()
for i in "${!AREAS[@]}"; do
  area="${AREAS[$i]}"
  file="$OUT/$(printf %02d "$i").txt"
  EXACT_AREA=1 NODE_OPTIONS=--max-old-space-size=2048 node run.js "--only=$area" > "$file" 2>&1
  p=$(grep -c '^PASS' "$file"); f=$(grep -c '^FAIL' "$file")
  passed=$((passed + p)); failed=$((failed + f))
  if [ "$f" -gt 0 ] || grep -q 'FATAL\|heap out of memory' "$file" || ! grep -q 'checks passed\|check(s) failed' "$file"; then
    bad+=("$area")
    echo "== $area ($file)"
    grep '^FAIL\|FATAL' "$file" | cut -c1-400
    grep -q 'checks passed\|check(s) failed' "$file" || echo "   did not finish"
  fi
done
echo "${#AREAS[@]} areas, $passed passed, $failed failed${bad:+; areas with problems: ${bad[*]}}"
[ "${#bad[@]}" -eq 0 ]
