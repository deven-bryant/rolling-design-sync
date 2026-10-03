#!/usr/bin/env bash
# Print the body of the `## [<version>]` section of CHANGELOG.md (the release
# notes for that version). Fails if the section is missing or empty.
#
#   changelog-section.sh <version> [changelog]
set -euo pipefail

version="${1:?usage: $0 <version> [changelog]}"
changelog="${2:-CHANGELOG.md}"

body=$(awk -v heading="## [$version]" '
  index($0, "## [") == 1 { if (found) exit; if (index($0, heading) == 1) { found = 1; next } }
  found { print }
' "$changelog")

# Drop leading blank lines ($(...) already drops trailing ones).
body=$(printf '%s\n' "$body" | sed -e '/./,$!d')
if [ -z "$body" ]; then
  echo "no CHANGELOG section for $version in $changelog" >&2
  exit 1
fi
printf '%s\n' "$body"
