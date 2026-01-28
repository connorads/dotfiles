# git helpers
alias gom='gsta -m "auto-stash before gom" && gswm && ggpull'
alias gomu='gom && gstp'
alias gob='git switch -'
alias gobu='gob && gstp'

# https://github.com/chmouel/lazyworktree
alias lwt='lazyworktree'
alias wtl='git worktree list'

# https://github.com/jesseduffield/lazygit
alias lg='lazygit --use-config-dir ~/.config/lazygit'
alias lgdf='lg --git-dir="$HOME/git/dotfiles" --work-tree="$HOME"'
