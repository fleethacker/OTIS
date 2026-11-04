#!/bin/sh
# The canonical added-source policy shared by inspection, commit, and merge.
# Staged candidate/hook deltas take priority; committed gates use the fetched
# base, and landed/local checks use the immediate parent.
set -eu

if [ "$(git rev-parse --is-inside-work-tree 2>/dev/null || true)" != true ]; then
	printf '%s\n' 'source-policy requires a Git working tree with an inspectable source delta' >&2
	exit 1
fi

initial_scaffold=false
if [ -z "${ARK_DISPATCH:-}" ] && ! git rev-parse --verify HEAD >/dev/null 2>&1 &&
	[ "$(git diff --cached --name-status -- .ark-manifest.json)" = "$(printf 'A\t.ark-manifest.json')" ] &&
	[ "$(git diff --cached --name-status -- ark/hooks/pre-commit)" = "$(printf 'A\tark/hooks/pre-commit')" ] &&
	[ "$(git diff --cached --name-status -- ui/build/.gitkeep)" = "$(printf 'A\tui/build/.gitkeep')" ]; then
	initial_scaffold=true
fi
if [ "$initial_scaffold" = true ]; then exit 0; fi

mode=cached
base=
if git rev-parse --verify HEAD >/dev/null 2>&1 && git diff --cached --quiet; then
	mode=committed
	if git rev-parse --verify FETCH_HEAD >/dev/null 2>&1 &&
		[ "$(git rev-parse FETCH_HEAD)" != "$(git rev-parse HEAD)" ] &&
		git merge-base --is-ancestor FETCH_HEAD HEAD; then
		base=FETCH_HEAD
	elif git rev-parse --verify HEAD^ >/dev/null 2>&1; then
		base=HEAD^
	else
		mode=root
	fi
fi
policy_diff() {
	case "$mode" in
	cached) git diff --cached --no-ext-diff --no-textconv --no-renames "$@" ;;
	committed) git diff --no-ext-diff --no-textconv --no-renames "$base" HEAD "$@" ;;
	root) git diff-tree --root --no-ext-diff --no-textconv --no-renames -p HEAD "$@" ;;
	esac
}
# Tolerating no regex matches must not hide a failed Git diff operation.
if ! policy_diff --name-only -- >/dev/null; then
	printf '%s\n' 'source-policy could not inspect its selected Git delta' >&2
	exit 1
fi
added_lines() {
	policy_diff --diff-filter=AM -- "$@" | grep -E '^\+[^+]' || true
}
failed=0
# 1. Hand-rolled fetch() in pages/components — must use Connect-Query.
violation=$(added_lines 'ui/src/pages/*.tsx' 'ui/src/pages/*.ts' 'ui/src/components/*.tsx' 'ui/src/components/*.ts' | grep -E '\bfetch\(' | grep -v '__ark/' || true)
if [ -n "$violation" ]; then
	echo ""
	echo "FRAMEWORK VIOLATION: hand-rolled fetch() in ui/src/pages or ui/src/components."
	echo "Use Connect-Query (useQuery / useMutationWithInvalidate) — never raw fetch for app data."
	echo "Reference: .ark/skills/ark-framework/SKILL.md (API plane)"
	echo "Offending lines:"
	echo "$violation" | head -5
	failed=1
fi

# 2. REST routes in internal/ — application routes must go through Connect-RPC.
violation=$(added_lines 'internal/*.go' 'internal/**/*.go' | grep -E '\b(mux\.(Get|Post|Put|Delete|Patch|HandleFunc)|http\.HandleFunc)\b' | grep -v '__ark/' || true)
if [ -n "$violation" ]; then
	echo ""
	echo "FRAMEWORK VIOLATION: REST routes wired in internal/."
	echo "Application routes go through Connect-RPC handlers generated from proto/."
	echo "Add the RPC to a .proto, regenerate, register the Connect handler — do not add /api/* paths."
	echo "Reference: .ark/skills/ark-framework/SKILL.md (API plane)"
	echo "Offending lines:"
	echo "$violation" | head -5
	failed=1
fi

# Presentation is app-owned; rendered journeys and design review judge its quality.

# 7. Hand-rolled scheduling primitives in service code — must use River.
# Caught in the wild: agents implementing a "daily ingestion sweep" with
# time.NewTicker on a goroutine. Lacks retries, observability, graceful
# shutdown, and SQLite single-writer discipline. Use the background-jobs
# skill (River queue with SQLite) for any periodic, scheduled, or async
# work. Test files are excluded — tests legitimately use tickers for
# timing assertions.
violation=$(added_lines 'internal/*.go' 'internal/**/*.go' |
	grep -vE '_test\.go' |
	grep -E '\b(time\.NewTicker|time\.AfterFunc|robfig/cron|go-co-op/gocron)\b' ||
	true)
if [ -n "$violation" ]; then
	echo ""
	echo "FRAMEWORK VIOLATION: hand-rolled scheduling/ticker primitive in internal/."
	echo "Use the River job queue for any periodic, scheduled, or async work."
	echo "Read .ark/skills/background-jobs/SKILL.md for the wiring."
	echo "Forbidden: time.NewTicker, time.AfterFunc, robfig/cron, gocron."
	echo "Offending lines:"
	echo "$violation" | head -5
	failed=1
fi

# 8. Raw useMutation in pages/components — must go through
# useMutationWithInvalidate from @defense-unicorns/ark-ui. The wrapper
# makes cache invalidation a required positional argument so the
# "edit/delete works server-side, UI requires reload" stale-cache class
# of bug cannot ship. Mocks in test-utils/ legitimately call useMutation
# directly (they intercept the hook); a line carrying the explicit
# `ark:no-mutation-wrapper` pragma opts out with a reason.
violation=$(added_lines 'ui/src/pages/*.tsx' 'ui/src/pages/*.ts' 'ui/src/components/*.tsx' 'ui/src/components/*.ts' |
	grep -E '\buseMutation\b\(' |
	grep -v 'useMutationWithInvalidate' |
	grep -v 'ark:no-mutation-wrapper' ||
	true)
if [ -n "$violation" ]; then
	echo ""
	echo "FRAMEWORK VIOLATION: raw useMutation() in ui/src/pages or ui/src/components."
	echo "Use useMutationWithInvalidate from @defense-unicorns/ark-ui — it makes"
	echo "cache invalidation a required positional argument so the stale-cache"
	echo "class of bug (edit/delete works server-side, UI requires reload)"
	echo "cannot ship."
	echo ""
	echo "  import { useMutationWithInvalidate } from '@defense-unicorns/ark-ui';"
	echo "  const m = useMutationWithInvalidate(rpcMethod, [listKey]);"
	echo ""
	echo "If you genuinely don't need invalidation, pass [] and add an"
	echo "// ark:no-mutation-wrapper: <reason> pragma on the same line."
	echo "Reference: .ark/skills/ark-framework/SKILL.md (Connect-Query)"
	echo "Offending lines:"
	echo "$violation" | head -5
	failed=1
fi

# Shell composition, navigation grouping, and account presentation are app-owned.
# Browser journeys prove their behavior; source-shape regexes cannot do that.

# 12. Explicit json: tag on an ENT schema field — codegen handles the
# proto/JSON shape from the schema's PascalCase field name, and adding
# manual json: tags either no-ops (when redundant) or produces inconsistent
# casing between Go ↔ proto ↔ JSON serialization. Caught in the wild
# during ent-schemas onboarding: agents importing Django/SQLAlchemy
# intuitions added json:"snake_case" tags that diverged from the proto
# field names codegen had already chosen.
violation=$(added_lines 'ent/schema/*.go' |
	grep -E '\bjson:"' ||
	true)
if [ -n "$violation" ]; then
	echo ""
	echo "FRAMEWORK VIOLATION: explicit json: tag on an ENT schema field."
	echo "Never add 'json:\"...\"' tags to ent/schema/*.go field definitions —"
	echo "codegen derives the proto/JSON shape from the field's PascalCase Go name"
	echo "(UpdatedAt → updated_at). Manual json: tags either no-op or diverge"
	echo "from the proto's chosen field name, producing inconsistent serialization."
	echo "Reference: .ark/skills/ent-schemas/SKILL.md (field naming)"
	echo "Offending lines:"
	echo "$violation" | head -5
	failed=1
fi

# 14. Direct page.goto() to a deep route in a journey spec — journey
# tests must drive the REAL UI (land on the root, then click nav links
# and buttons as a user does). page.goto()'ing straight to a deep route
# bypasses the navigation a user would take, so a broken nav link or a
# route registered at the wrong path ships green (the canonical
# /new vs /assessments/new mismatch). Allowed: page.goto(stack.url) and
# root forms. If the URL ITSELF is the feature under test (a shared deep
# link a reviewer opens cold), keep the direct goto and add a
# `// direct-url: <reason>` pragma on the same line — and still assert the
# page rendered the real view, not the catch-all placeholder.
violation=$(added_lines 'ui/tests/journey/*.spec.ts' |
	grep -E '\bpage\.goto\(' |
	grep -v 'direct-url:' |
	grep -E 'goto\([^)]*/[A-Za-z0-9:]' ||
	true)
if [ -n "$violation" ]; then
	echo ""
	echo "FRAMEWORK VIOLATION: journey spec navigates by page.goto() to a deep route."
	echo "Journey tests must drive the real UI — land on the root, then click:"
	echo ""
	echo "  await page.goto(stack.url);                          // root only"
	echo "  await page.getByRole('link', { name: 'Reports' }).click();"
	echo "  await page.getByRole('link', { name: 'Q3 review' }).click();"
	echo ""
	echo "goto()'ing a deep route directly hides broken nav links and"
	echo "mis-registered routes — they pass because the test jumps past them."
	echo "If the URL itself is the feature (a shared deep link opened cold),"
	echo "keep the direct goto, add  // direct-url: <reason>  on the same line,"
	echo "and assert the page shows the real view (not the catch-all placeholder)."
	echo "Reference: .ark/skills/prd-execution/reference/journey-test.md (navigate via the real UI)"
	echo "Offending lines:"
	echo "$violation" | head -5
	failed=1
fi

if [ "$failed" -ne 0 ]; then
	printf '\nSource files in checked delta:\n'
	policy_diff --name-only -- | head -80
	exit 1
fi
