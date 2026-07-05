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

  # Per-project env / nix devshells, opt-in via a repo's .envrc. nix-direnv caches
  # `use flake` shells so GC won't evict them. Nothing runs until `direnv allow`
  # approves a given .envrc, so entering an untrusted repo is inert by default.
  programs.direnv = {
    enable = true;
    enableZshIntegration = true;
    nix-direnv.enable = true;
  };

  home.sessionVariables = {
    EDITOR = "micro";
    VISUAL = "micro";
  };

  home.activation.tmuxPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    plugins_dir="$HOME/.config/tmux/plugins"
    mkdir -p "$plugins_dir"

    # Plugins are pinned to exact commits (the tmux analogue of flake.lock).
    # Activation converges the checkout to the pinned sha; offline it warns and
    # keeps the existing checkout. Bump a plugin by updating its sha here.
    pin_tmux_plugin() {
      plugin_name="$1"
      plugin_repo="$2"
      plugin_rev="$3"
      plugin_path="$plugins_dir/$plugin_name"

      if [ -e "$plugin_path" ] && [ ! -d "$plugin_path/.git" ]; then
        echo "tmux plugin path exists but is not a git repo: $plugin_path" >&2
        return 0
      fi

      if [ ! -d "$plugin_path/.git" ]; then
        if ! ${pkgs.git}/bin/git init -q "$plugin_path" >/dev/null 2>&1 \
          || ! ${pkgs.git}/bin/git -C "$plugin_path" remote add origin "https://github.com/$plugin_repo.git"; then
          echo "warning: failed to init tmux plugin $plugin_repo" >&2
          return 0
        fi
      fi

      if [ "$(${pkgs.git}/bin/git -C "$plugin_path" rev-parse HEAD 2>/dev/null)" = "$plugin_rev" ]; then
        return 0
      fi

      if ! ${pkgs.git}/bin/git -C "$plugin_path" fetch -q --depth 1 origin "$plugin_rev" >/dev/null 2>&1 \
        || ! ${pkgs.git}/bin/git -C "$plugin_path" checkout -q --detach "$plugin_rev" >/dev/null 2>&1; then
        echo "warning: failed to pin tmux plugin $plugin_repo to $plugin_rev" >&2
      fi
    }

    pin_tmux_plugin "tpm" "connorads/tpm" "e261deb1b47614eed3400089ce7197dc68acc4eb"
    pin_tmux_plugin "tmux-resurrect" "connorads/tmux-resurrect" "cff343cf9e81983d3da0c8562b01616f12e8d548"
    pin_tmux_plugin "tmux-continuum" "connorads/tmux-continuum" "0698e8f4b17d6454c71bf5212895ec055c578da0"
    pin_tmux_plugin "tmux-thumbs" "connorads/tmux-thumbs" "ae91d5f7c0d989933e86409833c46a1eca521b6a"
    pin_tmux_plugin "tmux-nerd-font-window-name" "connorads/tmux-nerd-font-window-name" "0af812a228e1b9f538b8d220c6c59d82d7228973"
    pin_tmux_plugin "tmux-cpu" "connorads/tmux-cpu" "bcb110d754ab2417de824c464730c412a3eb2769"
    pin_tmux_plugin "tmux-fzf-links" "connorads/tmux-fzf-links" "820fc0cb39168486e3884b81592d69b57191a272"
  '';
}
