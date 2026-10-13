#!/usr/bin/env bash
# Stage each package directory on npm unless its version is already published.
#
#   npm-publish.sh [--dry-run] <dir>...
#
# `npm stage publish` (npm >= 11.15) uploads the version to the package's
# staging queue; it goes live only after a maintainer approves it with 2FA
# (npmjs.com → the package → Staged Packages, or `npm stage approve`).
# Directories are staged in the order given (dependencies first). A
# prerelease version (X.Y.Z-tag) goes to the `next` dist-tag instead of
# `latest`. --dry-run checks the registry the same way but runs
# `npm publish --dry-run`, so it needs no npm credentials.
set -euo pipefail

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=true
  shift
fi
if [ "$#" -eq 0 ]; then
  echo "usage: $0 [--dry-run] <dir>..." >&2
  exit 2
fi

# Prints "yes" if name@version is on the registry, "no" if not; fails on any
# other registry error so a network problem never turns into a publish.
published() {
  local spec="$1" out err status=0
  err=$(mktemp)
  out=$(npm view "$spec" version 2>"$err") || status=$?
  if [ "$status" -eq 0 ]; then
    rm -f "$err"
    if [ -n "$out" ]; then echo yes; else echo no; fi
    return 0
  fi
  if grep -q 'E404' "$err"; then
    rm -f "$err"
    echo no
    return 0
  fi
  cat "$err" >&2
  rm -f "$err"
  return 1
}

for dir in "$@"; do
  manifest=$(cd "$dir" && pwd)/package.json
  name=$(node -p 'require(process.argv[1]).name' "$manifest")
  version=$(node -p 'require(process.argv[1]).version' "$manifest")
  if [ "$(published "$name@$version")" = yes ]; then
    echo "skip: $name@$version is already published"
    continue
  fi
  args=()
  case "$version" in
    *-*) args+=(--tag next) ;;
  esac
  if [ "$dry_run" = true ]; then
    echo "dry run: would stage $name@$version from $dir"
    (cd "$dir" && npm publish --dry-run --provenance=false "${args[@]}")
  else
    echo "stage: $name@$version from $dir"
    (cd "$dir" && npm stage publish "${args[@]}")
  fi
done
