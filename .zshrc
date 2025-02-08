# https://github.com/zsh-users/antigen
antigen use oh-my-zsh
antigen theme spaceship-prompt/spaceship-prompt
antigen bundle brew
antigen bundle git
antigen bundle aws
antigen bundle command-not-found
antigen bundle zsh-users/zsh-autosuggestions
antigen bundle zsh-users/zsh-completions
antigen bundle zsh-users/zsh-syntax-highlighting
antigen apply

# https://github.com/connorads/mise/
eval "$(mise activate zsh)"

# https://github.com/connorads/dotfiles/
alias dotfiles='git --git-dir=$HOME/git/dotfiles'
