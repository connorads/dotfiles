# ==============================================================================
# Shared Home-Manager Configuration
# ==============================================================================
# Common settings for all users across macOS and Linux
{ pkgs, lib, ... }:
{
  manual = {
    html.enable = false;
    manpages.enable = false;
    json.enable = false;
  };

  programs.git = {
    enable = true;
    lfs.enable = true;
    settings = {
      user.name = "Connor Adams";
      user.email = "connorads@users.noreply.github.com";
      init.defaultBranch = "main";
      push.autoSetupRemote = true;
    };
  };

  programs.neovim.enable = true;

  programs.atuin = {
    enable = true;
    enableZshIntegration = true;
    flags = [ "--disable-up-arrow" ];
    settings = {
      dialect = "uk";
      update_check = false;
      filter_mode_shell_up_arrow = "session";
      style = "compact";
      inline_height = 20;
      show_help = false;
      enter_accept = true;
    };
  };

  programs.gh = {
    enable = true;
    settings = {
      git_protocol = "ssh";
      aliases = {
        co = "pr checkout";
      };
    };
  };

  programs.gh-dash.enable = true;

  home.sessionVariables = {
    EDITOR = "micro";
    VISUAL = "micro";
  };

  home.activation.tmuxPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    plugins_dir="$HOME/.config/tmux/plugins"
    mkdir -p "$plugins_dir"

    ensure_tmux_plugin() {
      plugin_name="$1"
      plugin_repo="$2"
      plugin_path="$plugins_dir/$plugin_name"

      if [ -d "$plugin_path/.git" ]; then
        return 0
      fi

      if [ -e "$plugin_path" ]; then
        echo "tmux plugin path exists but is not a git repo: $plugin_path" >&2
        return 0
      fi

      if ! ${pkgs.git}/bin/git clone --depth 1 "https://github.com/$plugin_repo.git" "$plugin_path" >/dev/null 2>&1; then
        echo "warning: failed to clone tmux plugin $plugin_repo" >&2
      fi
    }

    ensure_tmux_plugin "tpm" "connorads/tpm"
    ensure_tmux_plugin "tmux-resurrect" "connorads/tmux-resurrect"
    ensure_tmux_plugin "tmux-continuum" "connorads/tmux-continuum"
    ensure_tmux_plugin "tmux-thumbs" "connorads/tmux-thumbs"
    ensure_tmux_plugin "tmux-nerd-font-window-name" "connorads/tmux-nerd-font-window-name"
    ensure_tmux_plugin "tmux-cpu" "connorads/tmux-cpu"
    ensure_tmux_plugin "tmux-fzf-links" "connorads/tmux-fzf-links"
  '';
}
