#!/bin/sh
# Integration tests for bin/skill-sync.
#
# Every test builds throwaway Git repositories in a temporary directory; no real
# catalog or consumer project is touched.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SS="$ROOT/bin/skill-sync"
TMPROOT=$(mktemp -d "${TMPDIR:-/tmp}/skill-sync-tests.XXXXXX")
trap 'chmod -R u+w "$TMPROOT" 2>/dev/null || true; rm -rf "$TMPROOT"' EXIT

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf '    ok   %s\n' "$1"; }
no() {
	FAIL=$((FAIL + 1))
	printf '    FAIL %s\n' "$1"
	[ $# -lt 2 ] || printf '         %s\n' "$2"
}
assert_eq() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$3], got [$2]"; fi; }
assert_file() { if [ -f "$2" ]; then ok "$1"; else no "$1" "missing file: $2"; fi; }
assert_absent() { if [ ! -e "$2" ]; then ok "$1"; else no "$1" "unexpectedly present: $2"; fi; }
assert_has() { case $2 in *"$3"*) ok "$1" ;; *) no "$1" "output lacks [$3]" ;; esac; }
assert_lacks() { case $2 in *"$3"*) no "$1" "output unexpectedly has [$3]" ;; *) ok "$1" ;; esac; }

run() {
	set +e
	OUT=$("$@" 2>&1)
	RC=$?
	set -e
}

g() { git -c user.name='Test Fixture' -c user.email='fixture@example.invalid' -c init.defaultBranch=main "$@"; }

make_catalog() {
	mkdir -p "$1/skills/alpha/references" "$1/skills/alpha/scripts" "$1/skills/beta"
	printf 'alpha\n' >"$1/skills/alpha/SKILL.md"
	printf 'guide\n' >"$1/skills/alpha/references/guide.md"
	printf '#!/bin/sh\necho hi\n' >"$1/skills/alpha/scripts/run.sh"
	chmod +x "$1/skills/alpha/scripts/run.sh"
	printf 'tags: [demo]\n' >"$1/skills/alpha/skill.yaml"
	printf 'BIN\001\002\n' >"$1/skills/alpha/asset.bin"
	printf 'beta\n' >"$1/skills/beta/SKILL.md"
	g init -q "$1"
	g -C "$1" add skills
	g -C "$1" commit -qm 'catalog: initial'
}

make_project() {
	mkdir -p "$1"
	g init -q "$1"
	printf 'project\n' >"$1/README.md"
	g -C "$1" add README.md
	g -C "$1" commit -qm 'project: initial'
}

# conf PROJECT CATALOG REV [SKILL...]
conf() {
	_p=$1 _c=$2 _r=$3
	shift 3
	{
		printf 'target = .claude/skills\n\n'
		printf 'source = %s\n' "$_c"
		printf 'rev = %s\n' "$_r"
		printf 'dir = skills\n'
		for _s in "$@"; do printf 'skill = %s\n' "$_s"; done
	} >"$_p/skill-sync.conf"
}

commit_all() { g -C "$1" add .claude skill-sync.conf 2>/dev/null || true; g -C "$1" commit -qm "$2" >/dev/null; }

case_() { printf '\n  %s\n' "$1"; }
new() { d="$TMPROOT/$1"; mkdir -p "$d"; printf '%s\n' "$d"; }

# ---------------------------------------------------------------------------
case_ "copies a complete package and stays portable in a fresh clone"
D=$(new c1); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_file "SKILL.md copied" "$P/.claude/skills/alpha/SKILL.md"
assert_file "reference doc copied" "$P/.claude/skills/alpha/references/guide.md"
assert_file "script copied" "$P/.claude/skills/alpha/scripts/run.sh"
assert_file "metadata copied" "$P/.claude/skills/alpha/skill.yaml"
assert_file "binary asset copied" "$P/.claude/skills/alpha/asset.bin"
if [ -x "$P/.claude/skills/alpha/scripts/run.sh" ]; then ok "executable bit preserved"; else no "executable bit preserved"; fi
assert_absent "source .git never copied" "$P/.claude/skills/alpha/.git"
assert_absent "unselected skill not copied" "$P/.claude/skills/beta"
assert_file "receipt written" "$P/.claude/skills/skill-sync.receipt"
SHA=$(g -C "$C" rev-parse HEAD)
assert_has "receipt records the exact commit" "$(cat "$P/.claude/skills/skill-sync.receipt")" "rev = $SHA"
assert_has "receipt records repository identity" "$(cat "$P/.claude/skills/skill-sync.receipt")" "source = local:$C"
commit_all "$P" 'sync skills'
g clone -q "$P" "$D/clone"
assert_file "fresh clone has real payload" "$D/clone/.claude/skills/alpha/SKILL.md"
run find "$D/clone/.claude/skills" -type l
assert_eq "fresh clone has no symlinks" "$OUT" ""
assert_eq "fresh clone content matches" "$(cat "$D/clone/.claude/skills/alpha/references/guide.md")" "guide"

# ---------------------------------------------------------------------------
case_ "preview reports changes without touching anything"
D=$(new c2); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
BEFORE=$(g -C "$C" status --porcelain; g -C "$C" rev-parse HEAD)
PBEFORE=$(g -C "$P" status --porcelain)
run "$SS" preview -C "$P"
assert_eq "preview succeeds" "$RC" 0
assert_has "preview lists an addition" "$OUT" "A .claude/skills/alpha/SKILL.md"
assert_absent "preview created no target" "$P/.claude"
assert_eq "preview left the project unchanged" "$(g -C "$P" status --porcelain)" "$PBEFORE"
assert_eq "preview left the source untouched" "$(g -C "$C" status --porcelain; g -C "$C" rev-parse HEAD)" "$BEFORE"

# ---------------------------------------------------------------------------
case_ "re-applying the same revision changes nothing"
D=$(new c3); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
run "$SS" apply -C "$P"
assert_eq "second apply succeeds" "$RC" 0
assert_has "second apply is a no-op" "$OUT" "Already up to date."
assert_eq "second apply leaves no Git diff" "$(g -C "$P" status --porcelain)" ""

# ---------------------------------------------------------------------------
case_ "removes obsolete files inside a skill and preserves everything else"
D=$(new c4); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
mkdir -p "$P/.claude/skills/.system" "$P/.claude/skills/project-owned"
printf 'loader\n' >"$P/.claude/skills/.system/state.json"
printf 'mine\n' >"$P/.claude/skills/project-owned/SKILL.md"
printf 'code:\n  lint: ruff\n' >"$P/.claude/skills/skill-sync.config.yaml"
commit_all "$P" 'sync skills'
g -C "$C" rm -q "skills/alpha/references/guide.md"
printf 'alpha v2\n' >"$C/skills/alpha/SKILL.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: drop guide, edit SKILL.md'
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_absent "obsolete file removed" "$P/.claude/skills/alpha/references/guide.md"
assert_eq "changed file updated" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "alpha v2"
assert_file "loader-owned .system preserved" "$P/.claude/skills/.system/state.json"
assert_file "project-owned skill preserved" "$P/.claude/skills/project-owned/SKILL.md"
assert_eq "project settings preserved" "$(cat "$P/.claude/skills/skill-sync.config.yaml")" "code:
  lint: ruff"

# ---------------------------------------------------------------------------
case_ "removes a skill that is no longer selected"
D=$(new c5); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha beta
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
assert_file "beta present before deselection" "$P/.claude/skills/beta/SKILL.md"
conf "$P" "$C" main alpha
run "$SS" preview -C "$P"
assert_has "preview announces the removal" "$OUT" "R .claude/skills/beta"
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_absent "deselected skill removed" "$P/.claude/skills/beta"
assert_file "selected skill kept" "$P/.claude/skills/alpha/SKILL.md"

# ---------------------------------------------------------------------------
case_ "refuses to overwrite uncommitted changes to managed files"
D=$(new c6); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
printf 'hand edited\n' >"$P/.claude/skills/alpha/SKILL.md"
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_has "refusal names the local change" "$OUT" "differs from the revision"
assert_eq "hand edit left intact" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "hand edited"
printf 'beta v2\n' >"$C/skills/beta/SKILL.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: unrelated edit'
run "$SS" apply -C "$P"
assert_eq "apply still refuses once the catalog moves on" "$RC" 1
assert_has "refusal names the uncommitted change" "$OUT" "uncommitted changes"
assert_eq "hand edit still intact" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "hand edited"
printf 'unrelated\n' >"$P/NOTES.md"
g -C "$P" checkout -q -- .claude
run "$SS" apply -C "$P"
assert_eq "unrelated dirty file does not block apply" "$RC" 0
assert_file "unrelated file preserved" "$P/NOTES.md"

# ---------------------------------------------------------------------------
case_ "refuses an unmanaged directory but adopts identical content"
D=$(new c7); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
mkdir -p "$P/.claude/skills/alpha"
printf 'someone else wrote this\n' >"$P/.claude/skills/alpha/SKILL.md"
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_has "refusal explains the collision" "$OUT" "not recorded in"
assert_eq "unmanaged content untouched" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "someone else wrote this"
rm -rf "$P/.claude/skills/alpha"
mkdir -p "$P/.claude/skills/alpha/references" "$P/.claude/skills/alpha/scripts"
cp -R "$C/skills/alpha/." "$P/.claude/skills/alpha/"
run "$SS" apply -C "$P"
assert_eq "identical content is adopted" "$RC" 0
assert_file "receipt now claims it" "$P/.claude/skills/skill-sync.receipt"

# ---------------------------------------------------------------------------
case_ "hands a committed unmanaged directory over once it is deleted"
D=$(new c7b); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
mkdir -p "$P/.claude/skills/alpha"
printf 'an older hand-written version\n' >"$P/.claude/skills/alpha/SKILL.md"
g -C "$P" add .claude
g -C "$P" commit -qm 'project: hand-written skill'
conf "$P" "$C" main alpha
run "$SS" apply -C "$P"
assert_eq "committed unmanaged content is still refused" "$RC" 1
assert_has "refusal points at the receipt" "$OUT" "not recorded in"
g -C "$P" rm -r -q .claude/skills/alpha
run "$SS" apply -C "$P"
assert_eq "apply succeeds after the directory is removed" "$RC" 0
assert_eq "payload now comes from the catalog" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "alpha"
assert_file "receipt now claims the skill" "$P/.claude/skills/skill-sync.receipt"
commit_all "$P" 'adopt alpha'
run "$SS" check -C "$P"
assert_eq "project is in sync afterwards" "$RC" 0

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
case_ "copies the recorded revision, never the working tree"
D=$(new c8); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
SHA=$(g -C "$C" rev-parse HEAD)
printf 'uncommitted edit\n' >"$C/skills/alpha/SKILL.md"
printf 'draft\n' >"$C/skills/alpha/DRAFT.md"
mkdir -p "$C/skills/unselected-wip"
printf 'wip\n' >"$C/skills/unselected-wip/SKILL.md"
conf "$P" "$C" "$SHA" alpha
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_eq "committed bytes copied, not the dirty worktree" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "alpha"
assert_absent "untracked file inside the skill not copied" "$P/.claude/skills/alpha/DRAFT.md"
assert_absent "unrelated untracked authoring work not copied" "$P/.claude/skills/unselected-wip"
assert_has "receipt records the resolved commit" "$(cat "$P/.claude/skills/skill-sync.receipt")" "rev = $SHA"
assert_eq "source working tree still dirty and untouched" "$(cat "$C/skills/alpha/SKILL.md")" "uncommitted edit"

# ---------------------------------------------------------------------------
case_ "detects a same-size edit committed in the same second"
D=$(new c8b); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
STAMP='2020-01-01T00:00:00+00:00'
GIT_AUTHOR_DATE=$STAMP GIT_COMMITTER_DATE=$STAMP g -C "$C" commit -q --amend --no-edit
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
printf 'ALPHA\n' >"$C/skills/alpha/SKILL.md"
g -C "$C" add skills
GIT_AUTHOR_DATE=$STAMP GIT_COMMITTER_DATE=$STAMP g -C "$C" commit -qm 'catalog: same-size edit, same timestamp'
run "$SS" preview -C "$P"
assert_has "preview sees the edit" "$OUT" "M .claude/skills/alpha/SKILL.md"
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_eq "same-size edit applied" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "ALPHA"

# ---------------------------------------------------------------------------
case_ "rejects symlinked package content"
D=$(new c9); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
ln -s SKILL.md "$C/skills/alpha/ALIAS.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: add a symlink'
conf "$P" "$C" main alpha
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_has "refusal names symlinks" "$OUT" "symlinks"
assert_absent "nothing was written" "$P/.claude"

# ---------------------------------------------------------------------------
case_ "handles paths containing spaces"
D=$(new "c10/a dir with spaces"); C="$D/cat alog"; P="$D/my project"
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_file "payload copied" "$P/.claude/skills/alpha/references/guide.md"
run "$SS" apply -C "$P"
assert_has "second apply is a no-op" "$OUT" "Already up to date."

# ---------------------------------------------------------------------------
case_ "check reports pending changes with a distinct exit code"
D=$(new c11); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
run "$SS" check -C "$P"
assert_eq "check exits 3 when changes are pending" "$RC" 3
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
run "$SS" check -C "$P"
assert_eq "check exits 0 when in sync" "$RC" 0

# ---------------------------------------------------------------------------
case_ "a failed sync does not record success"
D=$(new c12); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
BEFORE=$(cat "$P/.claude/skills/skill-sync.receipt")
conf "$P" "$C" 0000000000000000000000000000000000000000 alpha
run "$SS" apply -C "$P"
assert_eq "unknown revision fails" "$RC" 1
assert_has "failure explains the missing revision" "$OUT" "not present locally"
assert_eq "receipt unchanged after failure" "$(cat "$P/.claude/skills/skill-sync.receipt")" "$BEFORE"
if [ "$(id -u)" != 0 ]; then
	conf "$P" "$C" main alpha beta
	chmod 500 "$P/.claude/skills"
	run "$SS" apply -C "$P"
	chmod 700 "$P/.claude/skills"
	assert_eq "unwritable target fails" "$RC" 1
	assert_eq "receipt still describes the last good sync" "$(cat "$P/.claude/skills/skill-sync.receipt")" "$BEFORE"
else
	printf '    skip unwritable-target case (running as root)\n'
fi

# ---------------------------------------------------------------------------
case_ "retired and unknown commands fail clearly"
D=$(new c13); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
for cmd in sync status validate doctor prune promote align-agents agent-config; do
	run "$SS" "$cmd" -C "$P"
	[ "$RC" = 1 ] || no "retired \"$cmd\" exits 1" "got $RC"
	case $OUT in *"was retired"*) ;; *) no "retired \"$cmd\" explains itself" "$OUT" ;; esac
done
ok "every retired command fails with a migration pointer"
run "$SS" frobnicate
assert_eq "unknown command exits 2" "$RC" 2
assert_has "unknown command prints usage" "$OUT" "Usage:"
run "$SS" apply -C "$P" -f "$P/nope.conf"
assert_eq "missing config exits 1" "$RC" 1
assert_has "missing config is named" "$OUT" "not found"

# ---------------------------------------------------------------------------
case_ "rejects unsafe names and malformed config"
D=$(new c14); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
for bad in '.system' '../escape' 'a/b'; do
	{ printf 'target = .claude/skills\n'; printf 'source = %s\nrev = main\nskill = %s\n' "$C" "$bad"; } >"$P/skill-sync.conf"
	run "$SS" preview -C "$P"
	[ "$RC" = 1 ] || no "rejects skill name \"$bad\"" "got $RC"
done
ok "rejects skill names that escape a single path segment"
{ printf 'target = /etc\nsource = %s\nrev = main\nskill = alpha\n' "$C"; } >"$P/skill-sync.conf"
run "$SS" preview -C "$P"
assert_eq "rejects an absolute target" "$RC" 1
{ printf 'target = .claude/skills\nsource = %s\nrev = main\nskill = alpha\nskill = alpha\n' "$C"; } >"$P/skill-sync.conf"
run "$SS" preview -C "$P"
assert_has "rejects a duplicated skill" "$OUT" "more than once"
{ printf 'target = .claude/skills\nsource = %s\nskill = alpha\n' "$C"; } >"$P/skill-sync.conf"
run "$SS" preview -C "$P"
assert_has "requires an explicit rev" "$OUT" 'no "rev" line'

# ---------------------------------------------------------------------------
case_ "fans one selection out to several targets from several sources"
D=$(new c15); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
mkdir -p "$P/skills/local-only"
printf 'local\n' >"$P/skills/local-only/SKILL.md"
g -C "$P" add skills
g -C "$P" commit -qm 'project: add a local skill'
{
	printf 'target = .claude/skills\ntarget = .agents/skills\n\n'
	printf 'source = %s\nrev = main\nskill = alpha\n\n' "$C"
	printf 'source = .\nrev = HEAD\nskill = local-only\n'
} >"$P/skill-sync.conf"
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
assert_file "catalog skill in first target" "$P/.claude/skills/alpha/SKILL.md"
assert_file "catalog skill in second target" "$P/.agents/skills/alpha/SKILL.md"
assert_file "project skill in first target" "$P/.claude/skills/local-only/SKILL.md"
assert_file "project skill in second target" "$P/.agents/skills/local-only/SKILL.md"
assert_has "receipt records both sources" "$(cat "$P/.agents/skills/skill-sync.receipt")" "skill = local-only"

# ---------------------------------------------------------------------------
case_ "refuses a destination that leaves the project through a symlink"
D=$(new c16); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
mkdir -p "$D/outside"
mv "$P/.claude" "$D/outside/claude"
ln -s "$D/outside/claude" "$P/.claude"
printf 'the only copy\n' >"$D/outside/claude/skills/alpha/precious.txt"
printf 'alpha v2\n' >"$C/skills/alpha/SKILL.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: v2'
run "$SS" preview -C "$P"
assert_eq "preview refuses" "$RC" 1
assert_has "refusal names the symlink" "$OUT" "resolves through a symlink"
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_file "external file untouched" "$D/outside/claude/skills/alpha/precious.txt"
assert_eq "external payload untouched" "$(cat "$D/outside/claude/skills/alpha/SKILL.md")" "alpha"
rm "$P/.claude"
mkdir -p "$P/.claude/skills"
ln -s "$D/outside/claude/skills/alpha" "$P/.claude/skills/alpha"
run "$SS" apply -C "$P"
assert_eq "a symlinked skill directory is refused too" "$RC" 1
assert_eq "external payload still untouched" "$(cat "$D/outside/claude/skills/alpha/SKILL.md")" "alpha"

# ---------------------------------------------------------------------------
case_ "protects ignored files that Git cannot restore"
D=$(new c17); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
printf '*.scratch\n' >"$P/.git/info/exclude"
printf 'the only copy of my draft\n' >"$P/.claude/skills/alpha/local.scratch"
assert_eq "Git reports nothing for the ignored file" "$(g -C "$P" status --porcelain)" ""
printf 'alpha v2\n' >"$C/skills/alpha/SKILL.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: v2'
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_has "refusal names the unowned file" "$OUT" "records skill-sync writing it"
assert_eq "ignored draft survives" "$(cat "$P/.claude/skills/alpha/local.scratch")" "the only copy of my draft"
mv "$P/.claude/skills/alpha/local.scratch" "$P/local.scratch"
run "$SS" apply -C "$P"
assert_eq "apply succeeds once the file is moved out" "$RC" 0
assert_eq "catalog edit applied" "$(cat "$P/.claude/skills/alpha/SKILL.md")" "alpha v2"

# ---------------------------------------------------------------------------
case_ "protects a wholly ignored target from silent overwrites"
D=$(new c18); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
{ printf 'target = .agents/skills\n\n'; printf 'source = %s\nrev = main\ndir = skills\nskill = alpha\n' "$C"; } >"$P/skill-sync.conf"
printf '/.agents/skills/\n' >"$P/.gitignore"
g -C "$P" add .gitignore
g -C "$P" commit -qm 'project: ignore the mirror'
"$SS" apply -C "$P" >/dev/null
assert_eq "Git reports nothing for the ignored mirror" "$(g -C "$P" status --porcelain -- .agents)" ""
printf 'my local edit, never committed anywhere\n' >"$P/.agents/skills/alpha/SKILL.md"
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_has "refusal names the drift" "$OUT" "differs from the revision"
assert_eq "local edit survives" "$(cat "$P/.agents/skills/alpha/SKILL.md")" "my local edit, never committed anywhere"
rm "$P/.agents/skills/alpha/SKILL.md"
run "$SS" apply -C "$P"
assert_eq "deleting the file restores it" "$RC" 0
assert_eq "restored from the recorded revision" "$(cat "$P/.agents/skills/alpha/SKILL.md")" "alpha"
printf 'alpha v2\n' >"$C/skills/alpha/SKILL.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: v2'
run "$SS" apply -C "$P"
assert_eq "a genuine catalog update still applies to the mirror" "$RC" 0
assert_eq "mirror updated" "$(cat "$P/.agents/skills/alpha/SKILL.md")" "alpha v2"

# ---------------------------------------------------------------------------
case_ "refuses to remove a deselected skill holding unowned files"
D=$(new c19); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha beta
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
printf '*.scratch\n' >"$P/.git/info/exclude"
printf 'draft\n' >"$P/.claude/skills/beta/notes.scratch"
conf "$P" "$C" main alpha
run "$SS" apply -C "$P"
assert_eq "apply refuses" "$RC" 1
assert_has "refusal names the deselected skill" "$OUT" "deselected skill"
assert_file "unowned file survives" "$P/.claude/skills/beta/notes.scratch"
rm "$P/.claude/skills/beta/notes.scratch"
run "$SS" apply -C "$P"
assert_eq "removal proceeds once it is gone" "$RC" 0
assert_absent "deselected skill removed" "$P/.claude/skills/beta"

# ---------------------------------------------------------------------------
case_ "reports a failing rsync instead of an empty plan"
D=$(new c20); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
printf 'locally changed\n' >"$P/.claude/skills/alpha/SKILL.md"
printf '#!/bin/sh\necho "rsync: fatal error" >&2\nexit 23\n' >"$D/fake-rsync"
chmod +x "$D/fake-rsync"
run env SKILL_SYNC_RSYNC="$D/fake-rsync" "$SS" check -C "$P"
assert_eq "check fails" "$RC" 1
assert_lacks "check does not claim to be up to date" "$OUT" "Already up to date"
assert_has "check reports the rsync exit status" "$OUT" "exit 23"
run env SKILL_SYNC_RSYNC="$D/fake-rsync" "$SS" apply -C "$P"
assert_eq "apply fails" "$RC" 1
assert_lacks "apply does not claim to be up to date" "$OUT" "Already up to date"

# ---------------------------------------------------------------------------
case_ "plans executable-bit changes, which Git tracks"
D=$(new c21); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
chmod -x "$P/.claude/skills/alpha/scripts/run.sh"
assert_has "Git sees the mode change" "$(g -C "$P" status --porcelain)" "scripts/run.sh"
run "$SS" check -C "$P"
assert_eq "check reports pending changes" "$RC" 3
assert_has "the mode change is in the plan" "$OUT" "M .claude/skills/alpha/scripts/run.sh"
run "$SS" apply -C "$P"
assert_eq "apply refuses to overwrite the local mode change" "$RC" 1
if [ -x "$P/.claude/skills/alpha/scripts/run.sh" ]; then no "local mode change preserved"; else ok "local mode change preserved"; fi
printf 'alpha v2\n' >"$C/skills/alpha/SKILL.md"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: unrelated edit'
run "$SS" apply -C "$P"
assert_eq "an unrelated catalog update does not sneak the mode back" "$RC" 1
if [ -x "$P/.claude/skills/alpha/scripts/run.sh" ]; then no "local mode change still preserved"; else ok "local mode change still preserved"; fi
g -C "$P" checkout -q -- .claude
g -C "$C" update-index --chmod=-x skills/alpha/scripts/run.sh
g -C "$C" commit -qm 'catalog: drop the executable bit'
run "$SS" apply -C "$P"
assert_eq "a catalog mode change applies" "$RC" 0
if [ -x "$P/.claude/skills/alpha/scripts/run.sh" ]; then no "executable bit cleared from the catalog"; else ok "executable bit cleared from the catalog"; fi

# ---------------------------------------------------------------------------
case_ "verifies a committed payload offline"
D=$(new c22); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
assert_file "manifest written" "$P/.claude/skills/skill-sync.manifest"
run "$SS" verify -C "$P"
assert_eq "verify passes on a clean payload" "$RC" 0
assert_has "verify says what it checked" "$OUT" "Verified 1 target"
assert_has "manifest records the executable bit" "$(cat "$P/.claude/skills/skill-sync.manifest")" " 755 alpha/scripts/run.sh"
assert_has "manifest records a plain file" "$(cat "$P/.claude/skills/skill-sync.manifest")" " 644 alpha/SKILL.md"

mv "$C" "$C.gone"
run env SKILL_SYNC_RSYNC="$D/no-such-rsync" "$SS" verify -C "$P"
assert_eq "verify needs no catalog and no rsync" "$RC" 0
mv "$C.gone" "$C"

printf 'tampered\n' >"$P/.claude/skills/alpha/SKILL.md"
run "$SS" verify -C "$P"
assert_eq "a modified file fails" "$RC" 1
assert_has "the modified file is named" "$OUT" "alpha/SKILL.md: content does not match"
g -C "$P" checkout -q -- .claude

printf 'extra\n' >"$P/.claude/skills/alpha/EXTRA.md"
run "$SS" verify -C "$P"
assert_eq "an added file fails" "$RC" 1
assert_has "the extra file is named" "$OUT" "alpha/EXTRA.md: present but not recorded"
rm "$P/.claude/skills/alpha/EXTRA.md"

rm "$P/.claude/skills/alpha/references/guide.md"
run "$SS" verify -C "$P"
assert_eq "a removed file fails" "$RC" 1
assert_has "the missing file is named" "$OUT" "alpha/references/guide.md: missing"
g -C "$P" checkout -q -- .claude

chmod -x "$P/.claude/skills/alpha/scripts/run.sh"
run "$SS" verify -C "$P"
assert_eq "a changed executable bit fails" "$RC" 1
assert_has "the mode change is named" "$OUT" "manifest records 755"
chmod +x "$P/.claude/skills/alpha/scripts/run.sh"

rm "$P/.claude/skills/alpha/SKILL.md"
ln -s references/guide.md "$P/.claude/skills/alpha/SKILL.md"
run "$SS" verify -C "$P"
assert_eq "a symlinked managed file fails" "$RC" 1
assert_has "the symlink is named" "$OUT" "alpha/SKILL.md: is a symlink"
rm "$P/.claude/skills/alpha/SKILL.md"
g -C "$P" checkout -q -- .claude

run "$SS" verify -C "$P"
assert_eq "verify passes again once restored" "$RC" 0

mv "$P/.claude/skills/skill-sync.manifest" "$D/manifest.bak"
run "$SS" verify -C "$P"
assert_eq "a missing manifest fails" "$RC" 1
assert_has "the missing manifest is named" "$OUT" "skill-sync.manifest: missing"
mv "$D/manifest.bak" "$P/.claude/skills/skill-sync.manifest"

printf 'skill = ghost\n' >>"$P/.claude/skills/skill-sync.receipt"
run "$SS" verify -C "$P"
assert_eq "a receipt that disagrees with the manifest fails" "$RC" 1
assert_has "the disagreement is named" "$OUT" "disagree about which skills"

# ---------------------------------------------------------------------------
case_ "keeps the manifest in step with the payload"
D=$(new c23); C=$D/catalog; P=$D/project
make_catalog "$C"; make_project "$P"
conf "$P" "$C" main alpha
"$SS" apply -C "$P" >/dev/null
commit_all "$P" 'sync skills'
printf '#!/bin/sh\necho bye\n' >"$C/skills/alpha/scripts/run.sh"
chmod -x "$C/skills/alpha/scripts/run.sh"
g -C "$C" add skills
g -C "$C" commit -qm 'catalog: rewrite the script and drop its executable bit'
run "$SS" apply -C "$P"
assert_eq "apply succeeds" "$RC" 0
run "$SS" verify -C "$P"
assert_eq "verify passes on the new payload" "$RC" 0
assert_has "manifest follows the mode change" "$(cat "$P/.claude/skills/skill-sync.manifest")" " 644 alpha/scripts/run.sh"
commit_all "$P" 'sync skills'
run "$SS" check -C "$P"
assert_eq "check is clean after committing" "$RC" 0

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
