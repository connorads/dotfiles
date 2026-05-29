# git helpers
alias gom='gsta -m "auto-stash before gom" && gswm && ggpull'
alias gomu='gom && gstp'
alias gob='git switch -'
alias gobu='gob && gstp'

# no-verify commit
alias gcnv='git commit --verbose --no-verify'
alias gcnvm='git commit --no-verify --message'

# https://github.com/chmouel/lazyworktree
alias lwt='lazyworktree'
alias wtl='git worktree list'
alias wtu='wtui'
alias wti='wt-status --all'
alias wtm='wt-finish --mode local'

# https://github.com/jesseduffield/lazygit
alias lg='lazygit --use-config-dir ~/.config/lazygit'
# Renormalise codex config first so the clean filter strips [projects.*]
# from the index — otherwise lazygit shows a perpetual diff (it bypasses
# the dotfiles wrapper's `add --renormalize` shim).
lgdf() {
  command git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" \
    add --renormalize .codex/config.toml 2>/dev/null
  lazygit --use-config-dir ~/.config/lazygit \
    --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" "$@"
}

# https://github.com/Wilfred/difftastic
alias gdd='GIT_EXTERNAL_DIFF=difft git diff'
alias gdds='GIT_EXTERNAL_DIFF=difft git diff --staged'
