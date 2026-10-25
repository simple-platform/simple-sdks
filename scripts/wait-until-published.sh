#!/usr/bin/env bash
# Waits until a version of an npm package is public, and gives up if that
# takes too long.
#
# A VERSION THE WORKFLOW UPLOADS IS PARKED, NOT PUBLISHED. It becomes public
# when a maintainer approves it on npmjs.com, which happens outside the
# workflow. So the job that parked it looks at the registry every few seconds
# and goes on the moment the version is there.
#
# THE WAIT IS AS LONG AS THE APPROVAL TAKES, AND NO LONGER. The limit is how
# long the job keeps looking before it gives up, not how long a release takes.
# A job that gave up is run again after the version has been approved: it then
# finds the version published and finishes.
#
# usage: wait-until-published.sh <package> <version> [seconds]
#   seconds  how long to keep looking; half an hour when not given

set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: wait-until-published.sh <package> <version> [seconds]" >&2
  exit 2
fi

package=$1
version=$2
limit=${3:-1800}
every=5

# The registry's page for one version. It answers 200 once the version is
# public, and it is not cached, so the answer is never an old one.
page="https://registry.npmjs.org/${package/\//%2f}/${version}"

waited=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$page" || true)" = "200" ]; do
  if [ "$waited" -ge "$limit" ]; then
    echo "${package} ${version} is still not public after $((limit / 60)) minutes. If it is parked on npm, approve it under Staged Packages on npmjs.com and run this job again: it will find the version published and finish." >&2
    exit 1
  fi
  sleep "$every"
  waited=$((waited + every))
done

echo "${package} ${version} is public."
