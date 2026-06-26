# ==============================================================================
# Shared Home-Manager Configuration
# ==============================================================================
# Common settings for all users across macOS and Linux
{
  pkgs,
  lib,
  config,
  ...
}:
{
  xdg.enable = true;

  manual = {
    html.enable = false;
    manpages.enable = false;
    json.enable = false;
  };

  programs.git = {
    enable = true;
    lfs.enable = true;
    signing.format = null;
    settings = {
      user.name = "Connor Adams";
      user.email = "connorads@users.noreply.github.com";
      init.defaultBranch = "main";
      init.templateDir = "${config.xdg.configHome}/git/template";
      pull.rebase = true;
      push.autoSetupRemote = true;
      rebase.autosquash = true;
      rebase.updateRefs = true;
      fetch.prune = true;
      fetch.writeCommitGraph = true;
      # Reject malformed / malicious objects on transfer (supply-chain hardening).
      transfer.fsckObjects = true;
      fetch.fsckObjects = true;
      receive.fsckObjects = true;
      diff.algorithm = "histogram";
      diff.colorMoved = "default";
      merge.conflictStyle = "zdiff3";
      rerere.enabled = true;
      branch.sort = "-committerdate";
      tag.sort = "-version:refname";
      column.ui = "auto";
      core.pager = "delta";
      interactive.diffFilter = "delta --color-only";
      delta.navigate = true;
      delta.dark = true;
      delta.line-numbers = true;
      commit.verbose = true;
      filter.codex-config.clean = "codex-config-clean";
      filter.codex-config.smudge = "cat";
      filter.codex-config.required = true;
      filter.claude-settings.clean = "claude-settings-clean";
      filter.claude-settings.smudge = "cat";
      filter.claude-settings.required = true;
    };
  };

  # Central identity guard: the single source of truth for the commit hook logic.
  # New repos get a tiny stub (below) that delegates here, so improving this
  # script updates behaviour everywhere with no drift.
  xdg.configFile."git/hooks/identity-guard" = {
    executable = true;
    text = ''
      #!/bin/sh
      # Block commits whose author email is not a GitHub noreply address.
      # Installed into new repos via init.templateDir (see programs.git below).
      # Why: agents/tools sometimes run `git config user.email <personal>` in a
      # fresh repo, baking a private address into commit metadata.

      # Escape hatch for repos that legitimately need a non-GitHub identity:
      #   git config guard.allowNonGithubEmail true
      if [ "$(git config --bool guard.allowNonGithubEmail 2>/dev/null)" = "true" ]; then
        exit 0
      fi

      # Effective author identity (honours local/global config AND GIT_AUTHOR_EMAIL).
      ident=$(git var GIT_AUTHOR_IDENT 2>/dev/null)
      email=$(printf '%s\n' "$ident" | sed -n 's/.*<\(.*\)>.*/\1/p')

      case "$email" in
        *@users.noreply.github.com) exit 0 ;;
      esac

      cat >&2 <<MSG
      commit blocked: author email "$email" is not a GitHub noreply address.

      This guard stops a personal email leaking into commit metadata. Your global
      git identity already uses the privacy-preserving noreply address, so do NOT
      override user.email per-repo. Fix one of:
        - drop the local override (use the global identity):
            git config --unset user.email
        - or set the noreply explicitly:
            git config user.email "connorads@users.noreply.github.com"

      If this repo really needs a non-GitHub identity, opt out:
        git config guard.allowNonGithubEmail true
      MSG
      exit 1
    '';
  };

  # Template stub copied into every new repo via init.templateDir. Stays trivial
  # (no drift) and delegates to the central guard above.
  xdg.configFile."git/template/hooks/pre-commit" = {
    executable = true;
    text = ''
      #!/bin/sh
      # Delegates to the central identity guard so the logic lives in one place
      # and updates apply to every repo. Installed via init.templateDir.
      guard="$HOME/.config/git/hooks/identity-guard"
      [ -x "$guard" ] && exec "$guard" "$@"
      exit 0
    '';
  };

  home.packages = [
    pkgs.neovim
    pkgs.fresh-editor
  ];

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
