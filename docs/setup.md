# Setup

## Bootstrap script

```sh
curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash
```

It installs dotfiles and sets upstream tracking so `git status` and LazyGit show ahead-behind correctly.

### Selecting the host config

The script activates one config (`nix-darwin` on macOS, `home-manager` on Linux), normally resolved from the machine's hostname. On a freshly reset or provisioned box the hostname rarely matches yet, so pick it explicitly:

- macOS: `DARWIN_HOST=Connors-Mac-mini` (or `Connors-MacBook-Air`)
- Linux: `HM_HOST=dev` (or `penguin` / `rpi5`)

Without the variable, the script prompts. The prompt needs a terminal, so run `bash <(curl -fsSL …/install.sh)` or download then run, rather than a bare `curl … | bash` pipe.

The script refuses a host that does not match the machine, and fails with the valid list when the host is unknown or undecidable.

The first activation passes the config explicitly (`--flake …#<attr>`), then sets the hostname (macOS via `networking.hostName`, Linux via `hostnamectl`). After that, bare `drs`/`hms`/`up` resolve the config from the hostname.

Valid host names are hardcoded in `install.sh` (`VALID_DARWIN` / `VALID_HM`). Keep them in sync with `flake.nix` when adding or renaming a config.

## Manual setup

Use this to follow the steps by hand or to fork the repo.

1. Clone using a separate git dir

    ```sh
    DOTFILES_REPO=https://github.com/connorads/dotfiles.git
    DOTFILES_DIR=$HOME/git/dotfiles
    BOOTSTRAP_WORKTREE=$(mktemp -d "$HOME/.dotfiles-bootstrap.XXXXXX")

    git clone --separate-git-dir="$DOTFILES_DIR" "$DOTFILES_REPO" "$BOOTSTRAP_WORKTREE"
    rm -rf "$BOOTSTRAP_WORKTREE"
    ```

   `git clone` needs a checkout target path, and `$HOME` is non-empty. The temporary `BOOTSTRAP_WORKTREE` dir is a disposable target.

2. Point the repo at `$HOME` and ensure tracking refs

    ```sh
    git --git-dir="$DOTFILES_DIR" config core.bare false
    git --git-dir="$DOTFILES_DIR" config core.worktree "$HOME"
    git --git-dir="$DOTFILES_DIR" config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    git --git-dir="$DOTFILES_DIR" fetch origin --prune
    ```

3. Check out dotfiles into `$HOME`. This backs up conflicting files to `<file>.bak`, then overwrites them.

    ```sh
    git --git-dir="$DOTFILES_DIR" checkout 2>&1 | sed -n 's/^[[:space:]]\+//p' | while IFS= read -r file; do
      if [ -f "$file" ]; then
        mv "$file" "$file.bak"
      fi
    done

    git --git-dir="$DOTFILES_DIR" --work-tree="$HOME" checkout -f
    ```

4. Set upstream for the current branch

    ```sh
    CURRENT_BRANCH=$(git --git-dir="$DOTFILES_DIR" symbolic-ref --quiet --short HEAD)
    git --git-dir="$DOTFILES_DIR" --work-tree="$HOME" branch --set-upstream-to="origin/$CURRENT_BRANCH" "$CURRENT_BRANCH"
    ```

5. Set up nix, brew and install software

   macOS (nix-darwin):

    ```sh
    # Install Homebrew
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"

    # Install Nix (vanilla, not Determinate Nix)
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --determinate false
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

    # Build and activate nix-darwin configuration
    nix run nix-darwin/master#darwin-rebuild -- switch --flake ~/.config/nix
    ```

   Linux (home-manager):

    ```sh
    # Install Nix (vanilla, not Determinate Nix)
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --determinate false
    . ~/.nix-profile/etc/profile.d/nix.sh

    # Build and activate home-manager configuration
    nix run home-manager/master -- switch --flake ~/.config/nix
    ```

6. Enable commit hooks and reload the shell

    ```sh
    dotfiles config core.hooksPath .hk-hooks
    mise install
    exec zsh
    ```

## Migrating an older setup

```sh
DOTFILES_DIR=$HOME/git/dotfiles
if [ "$(git --git-dir=$DOTFILES_DIR rev-parse --is-bare-repository 2>/dev/null || true)" = "true" ]; then
  git --git-dir=$DOTFILES_DIR config --unset core.bare || true
fi
git --git-dir=$DOTFILES_DIR config core.worktree $HOME
CURRENT_BRANCH=$(git --git-dir=$DOTFILES_DIR/ symbolic-ref --quiet --short HEAD)
git --git-dir=$DOTFILES_DIR/ config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git --git-dir=$DOTFILES_DIR/ fetch origin --prune
git --git-dir=$DOTFILES_DIR/ --work-tree=$HOME branch --set-upstream-to=origin/$CURRENT_BRANCH $CURRENT_BRANCH
```

## Your own repo from scratch

The same git-dir and work-tree technique, for a new dotfiles repo of your own.

1. Create the git dir and point the work-tree at `$HOME`

    ```sh
    DOTFILES_DIR=$HOME/git/dotfiles
    mkdir -p "$DOTFILES_DIR"
    git init "$DOTFILES_DIR"
    git --git-dir="$DOTFILES_DIR" config core.worktree "$HOME"
    git --git-dir="$DOTFILES_DIR" config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    ```

2. Ignore everything, then un-ignore specific files

    ```sh
    touch "$HOME/.gitignore"
    grep -qxF '/*' "$HOME/.gitignore" || printf '%s\n' '/*' >> "$HOME/.gitignore"
    grep -qxF '!.gitignore' "$HOME/.gitignore" || printf '%s\n' '!.gitignore' >> "$HOME/.gitignore"
    ```

3. Track files by un-ignoring paths in `~/.gitignore`, then adding them

    ```sh
    git --git-dir="$DOTFILES_DIR" --work-tree="$HOME" add .gitignore
    git --git-dir="$DOTFILES_DIR" --work-tree="$HOME" commit -m "chore(dotfiles): initialise from scratch"
    ```

4. Optionally connect a remote and push

    ```sh
    DOTFILES_REPO=git@github.com:your-user/dotfiles.git
    dotfiles remote add origin "$DOTFILES_REPO"
    dotfiles push -u origin HEAD
    ```

   Git supports separate fetch and push URLs for one remote. This pulls over HTTPS and pushes over SSH, so read-only updates do not depend on SSH agent forwarding:

    ```sh
    dotfiles remote set-url origin https://github.com/your-user/dotfiles.git
    dotfiles remote set-url --push origin git@github.com:your-user/dotfiles.git
    ```
