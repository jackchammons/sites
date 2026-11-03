#!/usr/bin/env bash
# Commit the given paths and push to main with a fetch/rebase/retry loop.
#
#   Usage: commit-data.sh "<commit message>" <path>...
#
# Exits 0 without committing when none of the paths changed.
#
# Pushes through an explicit tokened remote rather than whatever credential
# checkout persisted: the Claude Code action mints its own GitHub App token
# and revokes it in its cleanup, which leaves the persisted header pointing at
# a dead token by the time a later step pushes ("Invalid username or token" on
# an otherwise clean pass). GITHUB_TOKEN is job-scoped and outlives that.
# Requires GH_TOKEN and GITHUB_REPOSITORY in the environment; COMMIT_REMOTE
# overrides the remote URL (used by tests).
#
# The rebase matters because two workflows commit to main on their own
# schedules and can overlap; a rejected push should retry against the moved
# head rather than fail a run that did real work.
set -euo pipefail

MSG="$1"; shift
if [ "$#" -eq 0 ]; then
  echo "::error::commit-data.sh: no paths given."
  exit 1
fi

if [ -z "$(git status --porcelain -- "$@")" ]; then
  echo "No data changes to record."
  exit 0
fi

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -- "$@"
git commit -m "$MSG"

REMOTE="${COMMIT_REMOTE:-https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git}"
pushed=no
for attempt in 1 2 3; do
  [ "$attempt" = 1 ] || sleep $(( attempt * 5 ))
  if ! git fetch "$REMOTE" main; then
    echo "fetch failed on attempt $attempt"; continue
  fi
  if ! git rebase FETCH_HEAD; then
    # research.json is replaced wholesale by every research run, so two runs
    # queued back to back (a dispatch pins the ref's SHA at dispatch time, so
    # the second checks out the pre-first-commit tree) always conflict on it.
    # The newer run's file is the right one: it is the file this run
    # validated and applied. Any other conflict is real and aborts the attempt.
    conflicts=$(git diff --name-only --diff-filter=U)
    if [ -n "$conflicts" ] && [ "$conflicts" = "pizza/data/research.json" ]; then
      git checkout --theirs -- pizza/data/research.json
      git add -- pizza/data/research.json
      if GIT_EDITOR=true git rebase --continue; then
        echo "rebase: kept this run's research.json over the previous run's"
      else
        git rebase --abort || true
        echo "rebase onto main failed on attempt $attempt"; continue
      fi
    else
      git rebase --abort || true
      echo "rebase onto main failed on attempt $attempt (conflicts: ${conflicts:-none})"; continue
    fi
  fi
  if git push "$REMOTE" HEAD:main; then
    pushed=yes
    echo "pushed on attempt $attempt"
    break
  fi
  echo "push rejected on attempt $attempt"
done

if [ "$pushed" != yes ]; then
  echo "::error::Could not push the data commit after 3 attempts."
  exit 1
fi
