#!/usr/bin/env bash
# music/download.sh — fetch the music beds listed in config/music.md and music/CREDITS.md.
#
#   bash music/download.sh            download the tracks that are missing
#   bash music/download.sh --force    download them all again
#
# The mp3s are gitignored; this script puts them back. The Kevin MacLeod tracks are CC BY 4.0:
# a video that uses one must carry its credit line (music/CREDITS.md) in the description.
# "Intergalactic" comes from the YouTube Audio Library, which has no public download URL: the
# script prints how to get it by hand.
set -euo pipefail

cd "$(dirname "$0")"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

BASE="https://incompetech.com/music/royalty-free/mp3-royaltyfree"
TRACKS=(
  "clean-soul.mp3|Clean%20Soul.mp3"
  "voxel-revolution.mp3|Voxel%20Revolution.mp3"
  "digital-lemonade.mp3|Digital%20Lemonade.mp3"
)

command -v curl >/dev/null || { echo "✗ curl is required" >&2; exit 1; }

fail=0
for entry in "${TRACKS[@]}"; do
  file="${entry%%|*}"
  remote="${entry#*|}"
  if [[ -s "$file" && $FORCE -eq 0 ]]; then
    echo "✓ $file (already here)"
    continue
  fi
  echo "→ $file"
  tmp="$file.part"
  if curl -fL --retry 3 --retry-delay 2 --silent --show-error -o "$tmp" "$BASE/$remote"; then
    bytes=$(wc -c < "$tmp" | tr -d ' ')
    if [[ "$bytes" -lt 100000 ]]; then
      echo "  ✗ $file: only $bytes bytes, not an mp3 — check $BASE/$remote" >&2
      rm -f "$tmp"; fail=1; continue
    fi
    mv "$tmp" "$file"
    echo "  ✓ $file ($(( bytes / 1024 )) KB)"
  else
    rm -f "$tmp"
    echo "  ✗ $file: download failed ($BASE/$remote)" >&2
    fail=1
  fi
done

if [[ -s intergalactic.mp3 ]]; then
  echo "✓ intergalactic.mp3 (already here)"
else
  cat <<'EOF'
• intergalactic.mp3 — "Intergalactic" by Alex Jones / Xander Jones is in the YouTube Audio Library,
  which has no public URL. Download it by hand: YouTube Studio → Audio library → search
  "Intergalactic" → Download, then save it here as music/intergalactic.mp3.
  (Attribution not required; it is the YouTube-safe bed, since Kevin MacLeod tracks get Content ID claims.)
EOF
fi

exit $fail
