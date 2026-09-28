# compinit.zsh: custom function fpath plus compinit, loaded as a local antidote
# bundle. Its place in ~/.zsh_plugins.txt is the point: after the kind:fpath
# bundles (zsh-completions) so their completions register, and before the OMZ
# plugins that call compdef and fzf-tab, which wraps the widgets compinit sets
# up.

# Custom functions (lazy-loaded via autoload). -g: antidote sources bundles from
# inside a function, where a bare typeset would make fpath local.
typeset -gU fpath
fpath=(
  ~/.config/zsh/functions
  ~/.config/zsh/functions/*(/N)
  $fpath
)
autoload -Uz ~/.config/zsh/functions/*(.N:t) ~/.config/zsh/functions/*/*(.N:t)

# Regenerate the dump - full compinit, including the slow security audit - at
# most once a day; otherwise trust the cache (-C). The staleness test must glob
# in array context: filename generation does not run inside [[ … ]].
autoload -Uz compinit
_zcompdump="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/zcompdump"
[[ -d ${_zcompdump:h} ]] || mkdir -p "${_zcompdump:h}"
_zcompdump_fresh=("$_zcompdump"(Nmh-24))
if ((${#_zcompdump_fresh})); then
  compinit -C -d "$_zcompdump"
else
  compinit -d "$_zcompdump"
fi
unset _zcompdump _zcompdump_fresh
