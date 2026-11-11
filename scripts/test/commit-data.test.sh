#!/usr/bin/env bash
# Tests for scripts/commit-data.sh, run against scratch repositories.
#
#   bash scripts/test/commit-data.test.sh
#
# Each case builds a bare "remote", a "runner" clone standing in for the
# workflow's checkout and an "other" clone standing in for whoever else pushes
# to main, runs the real script in the runner with COMMIT_REMOTE pointing at
# the bare repository, and checks the exit code, the log and what main holds
# afterwards. Nothing outside a temp directory is touched and no network is
# used. sleep is replaced on PATH by a stub that records its arguments, so a
# retry costs no time and a case can assert that none happened.
#
# Prints one line per case and exits non-zero if any case failed; a failing
# case also prints the script's log.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/commit-data.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

mkdir "$TMP/bin"
printf '#!/bin/sh\necho "$@" >> "%s/sleeps"\n' "$TMP" > "$TMP/bin/sleep"
chmod +x "$TMP/bin/sleep"

PUBLISH='pizza/data/history.json pizza/data/buzz.json pizza/data/restaurants.json'
RESEARCH='pizza/data/research.json pizza/data/restaurants.json pizza/data/buzz.json'

# fresh <case>: a bare remote with one commit on main, plus runner/ and other/ clones of it.
fresh() {
  C="$TMP/$1"; LOG="$C/log"; WHY=""
  mkdir -p "$C"; : > "$TMP/sleeps"
  git init -q --bare -b main "$C/remote.git"
  git init -q -b main "$C/seed"
  (
    cd "$C/seed" && mkdir -p pizza/data
    printf '{\n  "updated": "t0",\n  "items": [\n    {"title": "a"},\n    {"title": "b"}\n  ]\n}\n' > pizza/data/buzz.json
    printf '{\n  "weeks": [\n    {"weekKey": "W1"}\n  ]\n}\n' > pizza/data/history.json
    printf '[\n  {"id": "one", "lat": null},\n  {"id": "two", "lat": null},\n  {"id": "three", "lat": null},\n  {"id": "four", "lat": null},\n  {"id": "five", "lat": null},\n  {"id": "six", "lat": null},\n  {"id": "seven", "lat": null}\n]\n' > pizza/data/restaurants.json
    printf '{"updated": "r0"}\n' > pizza/data/research.json
    echo readme > README.md
    git add -A && git commit -q -m base && git push -q "$C/remote.git" main
  )
  git clone -q "$C/remote.git" "$C/runner"
  git clone -q "$C/remote.git" "$C/other"
}

# upstream <message>: commit what changed in other/ and push it, so main moves under the runner.
upstream() { ( cd "$C/other" && git commit -q -am "$1" && git push -q origin main ); }

# edit <clone> <file> <from> <to>: a one-line change to a data file.
edit() { sed -i "s/$3/$4/" "$C/$1/pizza/data/$2"; }

# run <message> <path>...: the real script in the runner checkout. Sets RC and writes $LOG.
run() {
  ( cd "$C/runner" && PATH="$TMP/bin:$PATH" COMMIT_REMOTE="$C/remote.git" \
      GH_TOKEN=unused GITHUB_REPOSITORY=unused/unused bash "$SCRIPT" "$@" ) > "$LOG" 2>&1
  RC=$?
}

main_sha()      { git --git-dir="$C/remote.git" rev-parse main; }
main_subjects() { git --git-dir="$C/remote.git" log --format=%s main | paste -sd'|' -; }
main_file()     { git --git-dir="$C/remote.git" show "main:pizza/data/$1"; }
logged()        { grep -qF -- "$1" "$LOG"; }
no_sleep()      { [ ! -s "$TMP/sleeps" ]; }

# expect <what> <command>...: the case fails, naming <what>, when the command does.
expect() { local what="$1"; shift; "$@" || WHY="${WHY:+$WHY; }$what"; }

FAILED=0
report() {
  if [ -z "$WHY" ]; then
    echo "ok   - $1"
  else
    echo "FAIL - $1: $WHY"; sed 's/^/       | /' "$LOG"; FAILED=1
  fi
}

fresh no-change
before=$(main_sha)
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "says there is nothing to record" logged "No data changes to record."
expect "main unchanged" test "$(main_sha)" = "$before"
expect "no commit made in the checkout" test "$(git -C "$C/runner" rev-list --count HEAD)" = 1
report "no change exits 0 without committing"

fresh clean-push
edit runner buzz.json '"t0"' '"t1"'
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "pushed first time" logged "pushed on attempt 1"
expect "main is the data commit on base" test "$(main_subjects)" = "refresh|base"
expect "no sleep" no_sleep
report "a changed file is committed and pushed"

fresh moved-main
( cd "$C/other" && echo more >> README.md ); upstream "upstream readme"
edit runner buzz.json '"t0"' '"t1"'
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "main keeps the upstream commit under the data commit" test "$(main_subjects)" = "refresh|upstream readme|base"
expect "no sleep" no_sleep
report "main moved: the commit is rebased onto it and pushed"

fresh shallow
rm -rf "$C/runner"; git clone -q --depth 1 "file://$C/remote.git" "$C/runner"
( cd "$C/other" && echo more >> README.md ); upstream "upstream readme"
edit runner buzz.json '"t0"' '"t1"'
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "main keeps the upstream commit under the data commit" test "$(main_subjects)" = "refresh|upstream readme|base"
report "a depth-1 checkout behind main still pushes one commit"

fresh regenerated-conflict
edit other buzz.json '"t0"' '"tOTHER"'; upstream "other refresh"
edit runner buzz.json '"t0"' '"tMINE"'
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "says whose copy was kept" logged "kept this run's copy of pizza/data/buzz.json"
expect "main has this run's buzz.json" test "$(main_file buzz.json | grep -c tMINE)" = 1
expect "the other run's stamp is gone" test "$(main_file buzz.json | grep -c tOTHER)" = 0
expect "both commits are on main" test "$(main_subjects)" = "refresh|other refresh|base"
report "conflict in a regenerated file keeps this run's copy"

fresh real-conflict
edit other restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 1'; upstream "research"
edit runner restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 2'
before=$(main_sha)
run "refresh" $PUBLISH
expect "exit 1" test "$RC" = 1
expect "error names the file" logged "::error::Rebase onto main failed (conflicts: pizza/data/restaurants.json)"
expect "no retry sleep" no_sleep
expect "main unchanged" test "$(main_sha)" = "$before"
expect "checkout is not left mid-rebase" test ! -d "$C/runner/.git/rebase-merge"
report "conflict in restaurants.json fails at once, without retrying"

fresh separate-edits
edit other restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 1'; upstream "research"
edit runner restaurants.json '"id": "six", "lat": null' '"id": "six", "lat": 6'
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "upstream edit survives" test "$(main_file restaurants.json | grep -c '"two", "lat": 1')" = 1
expect "this run's edit survives" test "$(main_file restaurants.json | grep -c '"six", "lat": 6')" = 1
report "edits to different entries of restaurants.json both survive"

fresh same-change
edit other restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 1'; upstream "research"
edit runner restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 1'
before=$(main_sha)
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "main unchanged" test "$(main_sha)" = "$before"
report "a change main already holds adds no commit"

fresh branch-ahead-same-change
edit other restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 1'; upstream "research"
( cd "$C/runner" && git checkout -q -b feature && echo unreviewed > change.txt \
    && git add -A && git commit -q -m "unreviewed feature work" )
edit runner restaurants.json '"id": "two", "lat": null' '"id": "two", "lat": 1'
before=$(main_sha)
run "refresh" $PUBLISH
expect "exit 1" test "$RC" = 1
expect "says why it refused" logged "::error::Refusing to push: 2 commits"
expect "main unchanged" test "$(main_sha)" = "$before"
report "a branch's commit cannot ride in when the data commit is dropped"

fresh branch-ahead
( cd "$C/runner" && git checkout -q -b feature && echo unreviewed > change.txt \
    && git add -A && git commit -q -m "unreviewed feature work" )
edit runner research.json '"r0"' '"r1"'
before=$(main_sha)
run "research pass" $RESEARCH
expect "exit 1" test "$RC" = 1
expect "says why it refused" logged "::error::Refusing to push: 2 commits"
expect "main unchanged" test "$(main_sha)" = "$before"
expect "the branch's commit is not on main" test "$(main_subjects)" = "base"
expect "no retry sleep" no_sleep
report "a checkout ahead of main by an extra commit is refused"

fresh push-retry
mkdir -p "$C/remote.git/hooks"
printf '#!/bin/sh\n[ -e rejected-once ] && exit 0\n: > rejected-once\necho "rejected by the test hook" >&2\nexit 1\n' > "$C/remote.git/hooks/pre-receive"
chmod +x "$C/remote.git/hooks/pre-receive"
edit runner buzz.json '"t0"' '"t1"'
run "refresh" $PUBLISH
expect "exit 0" test "$RC" = 0
expect "first push rejected" logged "push rejected on attempt 1"
expect "second push lands" logged "pushed on attempt 2"
expect "slept once between attempts" test "$(cat "$TMP/sleeps")" = 10
expect "main is the data commit on base" test "$(main_subjects)" = "refresh|base"
report "a rejected push is retried"

fresh bad-path
edit runner buzz.json '"t0"' '"t1"'
before=$(main_sha)
run "refresh" pizza/data/buzz.json pizza/data/nope.json
expect "exit 1" test "$RC" = 1
expect "error names the path" logged "::error::commit-data.sh: git add refused pizza/data/nope.json"
expect "main unchanged" test "$(main_sha)" = "$before"
report "a path git add refuses is named in the error"

exit "$FAILED"
