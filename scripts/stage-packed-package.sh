#!/usr/bin/env bash
# Parks a packed npm package on the registry, where nobody can install it
# until a maintainer approves it there.
#
# THE WORKFLOW CANNOT PUBLISH BY ITSELF. npm calls this staged publishing: the
# workflow uploads a version, npm holds it out of reach, and it becomes public
# only when a maintainer approves it on npmjs.com with a two-factor code. A
# publish therefore takes a person who is present at npm. A stolen login to
# this repository, or a change slipped into its workflow, is not enough to put
# a version in front of users.
#
# THE NPM THAT COMES WITH NODE IS TOO OLD FOR THIS. The command that parks a
# version arrived in npm 11.16, and the Node the publish jobs run ships an
# older npm. So a newer one is installed here, at one exact version. When the
# Node those jobs use ships an npm that has the command, this install can go.
#
# usage: stage-packed-package.sh <file.tgz>

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: stage-packed-package.sh <file.tgz>" >&2
  exit 2
fi

file=$1
npm_version=11.21.0

manifest=$(tar -xzOf "$file" package/package.json)
name=$(jq -r .name <<< "$manifest")
version=$(jq -r .version <<< "$manifest")

npm install --global "npm@${npm_version}"
if [ "$(npm --version)" != "$npm_version" ]; then
  echo "npm ${npm_version} was installed, and npm --version still answers $(npm --version)." >&2
  exit 1
fi

if ! npm stage publish "$file" --access public; then
  echo "npm did not take ${name} ${version}. If an earlier run of this job already parked that version, approve it on npmjs.com under Staged Packages and run this job again: it will find the version published and finish." >&2
  exit 1
fi

said="${name} ${version} is parked on npm and is not public yet. To publish it, open Staged Packages on npmjs.com and approve it with a two-factor code. This job is waiting for that."
echo "$said"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "$said" >> "$GITHUB_STEP_SUMMARY"
fi
