#!/bin/bash
# nix-clawdbot-sync.sh - Sync nix-clawdbot fork and rebase feature branch
#
# Usage:
#   ./nix-clawdbot-sync.sh              # Sync main + rebase feat/rpi5-complete
#   ./nix-clawdbot-sync.sh --no-push    # Sync and rebase but don't push
#
# This script:
# 1. Clones/updates the fork in ~/git/nix-clawdbot
# 2. Syncs main branch from upstream via gh repo sync
# 3. Rebases feat/rpi5-complete on updated main
# 4. Force pushes the rebased branch

set -euo pipefail

REPO_DIR="$HOME/git/nix-clawdbot"
FEATURE_BRANCH="feat/rpi5-complete"
PUSH=true

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-push) PUSH=false; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Colours
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

# Clone if needed
if [[ ! -d "$REPO_DIR" ]]; then
    info "Cloning connorads/nix-clawdbot..."
    git clone git@github.com:connorads/nix-clawdbot.git "$REPO_DIR"
    cd "$REPO_DIR"
    info "Setting default repo for gh..."
    gh repo set-default connorads/nix-clawdbot
else
    cd "$REPO_DIR"
fi

# Fetch all
info "Fetching all branches..."
git fetch --all

# Sync main from upstream
info "Syncing main from upstream (clawdbot/nix-clawdbot)..."
git checkout main
gh repo sync --branch main

# Rebase feature branch
info "Rebasing $FEATURE_BRANCH on main..."
git checkout "$FEATURE_BRANCH"
git rebase main

# Show result
info "Commits on $FEATURE_BRANCH:"
git --no-pager log --oneline main..HEAD

# Push if requested
if $PUSH; then
    info "Force pushing $FEATURE_BRANCH..."
    git push --force-with-lease
    info "Done! Branch pushed."
else
    warn "Skipped push (--no-push). Run: git push --force-with-lease"
fi
