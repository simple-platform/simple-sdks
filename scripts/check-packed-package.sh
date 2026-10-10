#!/usr/bin/env bash
# Refuses a packed npm package that does not hold the files its own
# package.json points at.
#
# A PACKAGE IS PACKED FROM WHATEVER IS ON DISK. Packing does not build. A
# package whose built files are missing packs without complaint into a file
# that holds its package.json and little else, and that file would be
# published. A version that has been published cannot be replaced.
#
# So the packed file is asked what it promises and whether it holds it: every
# file its package.json names as a way in has to be inside. Those are `main`,
# `module`, `types`, each program under `bin`, and every file `exports` leads
# to. What is checked is the file about to be uploaded, not the folder it was
# packed from.
#
# A target under `exports` with a `*` in it names a pattern, not a file, and
# is not checked.
#
# usage: check-packed-package.sh <file.tgz>

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: check-packed-package.sh <file.tgz>" >&2
  exit 2
fi

file=$1

manifest=$(tar -xzOf "$file" package/package.json)
held=$(tar -tzf "$file")
name=$(jq -r '"\(.name)@\(.version)"' <<< "$manifest")

promised=$(jq -r '
  [ .main, .module, .types, .typings,
    (.bin | if type == "object" then .[] else . end),
    (.exports | .. | strings) ]
  | map(select(type == "string" and (contains("*") | not)))
  | map(ltrimstr("./"))
  | unique
  | .[]' <<< "$manifest")

count=0
missing=()
while IFS= read -r path; do
  if [ -z "$path" ]; then
    continue
  fi
  count=$((count + 1))
  if ! grep -q -x -F "package/${path}" <<< "$held"; then
    missing+=("$path")
  fi
done <<< "$promised"

if [ "${#missing[@]}" -gt 0 ]; then
  {
    echo "${file} is ${name}, and it lacks ${#missing[@]} of the ${count} files its package.json points at:"
    printf '  %s\n' "${missing[@]}"
    echo "It was packed without its built files. Nothing has been published."
  } >&2
  exit 1
fi

echo "${name}: all ${count} files its package.json points at are in the packed file."
