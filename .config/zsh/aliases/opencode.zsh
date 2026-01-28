# https://github.com/sst/opencode
alias oc='opencode'
alias ocy='config="$HOME/.config/opencode/opencode.json"; tmp="$(mktemp)"; jq ".permission.bash = {\"*\": \"allow\"} | .permission.external_directory = \"allow\"" "$config" > "$tmp" && mv "$tmp" "$config"'
alias ocn='git --git-dir=$HOME/git/dotfiles --work-tree=$HOME checkout HEAD -- .config/opencode/opencode.json'
