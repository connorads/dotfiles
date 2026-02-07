# ==============================================================================
# Shared Home-Manager Configuration
# ==============================================================================
# Common settings for all users across macOS and Linux
{ pkgs, ... }:
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
}
