#!/bin/sh
# Soft-protect main/master in repos where server-side branch protection is
# unavailable or intentionally advisory.
#
# Owner opt-out (repo-scoped, machine-local):
#     git config --local hooks.allowMainPush true
#
# One-off automation escape hatch:
#     HK_ALLOW_MAIN_PUSH=1 git push
#
# This hook is advisory only. Local hooks run per clone and can be bypassed with
# --no-verify. Use server-side branch protection when it is available.

# Git pre-push stdin format:
#   <local_ref> <local_sha> <remote_ref> <remote_sha>
#
# Read directly in the main shell, not through a pipe, so `blocked` survives.
blocked=""
while read -r _local_ref _local_sha remote_ref _remote_sha; do
	case "$remote_ref" in
	refs/heads/main | refs/heads/master)
		blocked="$blocked ${remote_ref#refs/heads/}"
		;;
	esac
done

allow_main_push=$(git config --bool --get hooks.allowMainPush 2>/dev/null)

if [ -n "$blocked" ] && [ "$allow_main_push" != "true" ] && [ -z "${HK_ALLOW_MAIN_PUSH:-}" ]; then
	branch=$(printf '%s\n' "$blocked" | tr -s ' ' | sed 's/^ //;s/ /, /g')
	cat >&2 <<EOF

Direct push to a protected branch ($branch) is blocked.

Open a pull request instead:
    git switch -c <your-branch>
    git push -u origin <your-branch>
    gh pr create

Owner opt-out for this clone:
    git config --local hooks.allowMainPush true

EOF
	exit 1
fi

exit 0
