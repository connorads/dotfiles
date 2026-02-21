# dotfiles

Use `git` to manage [dotfiles](https://en.wikipedia.org/wiki/Hidden_file_and_hidden_directory#Unix_and_Unix-like_environments) without symlinks. This setup uses a dedicated git dir at `~/git/dotfiles` with work-tree `~` (via the `dotfiles` wrapper). Uses [`nix-darwin`](https://github.com/LnL7/nix-darwin) (macOS) or [`home-manager`](https://github.com/nix-community/home-manager) (Linux) and [`brew`](https://brew.sh/) (macOS) to set up and install software, and [`mise`](https://github.com/connorads/mise/) to manage runtimes.

## Why this setup

- No symlinks: tracked files live directly in `$HOME`.
- Git metadata stays out of the way in `~/git/dotfiles`.
- Bootstrap is safer on existing machines where dotfiles may already exist.
- Day-to-day Git UX stays reliable, including ahead-behind and push state in LazyGit.

Under the hood, git metadata is stored at `~/git/dotfiles`, and `core.worktree` points at `$HOME`.

## Usage

If you've already got your dotfiles setup you can use the following commands to manage your dotfiles.

### Updating dotfiles

#### Track file

First un-ignore the file/path in `~/.gitignore`, then add it:

```sh
dotfiles add .somefile
```

#### Untrack file

```sh
dotfiles rm --cached .somefile
```

### Code quality hooks (hk)

Dotfiles use [`hk`](https://hk.jdx.dev/) for fast staged-file checks on commit.

```sh
dotfiles config core.hooksPath .hk-hooks
mise install
dhk check
```

`dotfiles commit` then runs `.hk-hooks/pre-commit`, which calls `hk run pre-commit`.

### Managing system

#### macOS (nix-darwin)

Build and activate nix-darwin config. This will make changes to the system and update packages as per [`flake.nix`](.config/nix/flake.nix)

```sh
darwin-rebuild switch --flake ~/.config/nix
# alias: drs
```

Update nix packages. This will update your non-homebrew packages and update [`flake.lock`](.config/nix/flake.lock)

```sh
nix flake update --flake ~/.config/nix
# alias: nfu
# You need to run build and activate after i.e. drs
```

Update brew packages

```sh
brew upgrade
```

Update mise packages

```sh
mise upgrade
```

#### Linux (home-manager)

Build and activate home-manager config. This will update packages as per [`flake.nix`](.config/nix/flake.nix)

```sh
home-manager switch --flake ~/.config/nix
# alias: hms
```

Update nix packages. This will update your packages and update [`flake.lock`](.config/nix/flake.lock)

```sh
nix flake update --flake ~/.config/nix
# alias: nfu
# You need to run home-manager switch after i.e. hms
```

Update mise packages

```sh
mise upgrade
```

## Setup

### Quick start (recommended)

If you are setting up this exact repo on Linux/Codespaces, use the bootstrap script:

```sh
curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash
```

It installs dotfiles and sets upstream tracking so `git status`/LazyGit show ahead-behind correctly.

### Manual setup (from this repo)

If you want to follow the manual path (or fork this repo), use this.

1. Clone using a separate git dir

    ```sh
    DOTFILES_REPO=https://github.com/connorads/dotfiles.git
    DOTFILES_DIR=$HOME/git/dotfiles
    BOOTSTRAP_WORKTREE=$(mktemp -d "$HOME/.dotfiles-bootstrap.XXXXXX")

    git clone --separate-git-dir="$DOTFILES_DIR" "$DOTFILES_REPO" "$BOOTSTRAP_WORKTREE"
    rm -rf "$BOOTSTRAP_WORKTREE"
    ```

    Why the temporary `BOOTSTRAP_WORKTREE` dir? `git clone` needs a checkout target path, and `$HOME` is non-empty. The temp dir keeps bootstrap safe and disposable.

2. Point the repo at `$HOME` and ensure tracking refs

    ```sh
    git --git-dir="$DOTFILES_DIR" config core.bare false
    git --git-dir="$DOTFILES_DIR" config core.worktree "$HOME"
    git --git-dir="$DOTFILES_DIR" config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    git --git-dir="$DOTFILES_DIR" fetch origin --prune
    ```

3. Check out dotfiles into `$HOME` (⚠️ this overwrites conflicting files)

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

5. Set up nix, brew and install software (⚠️ skip the option to install Determinate Nix)

    **macOS (nix-darwin):**

    ```sh
    # Install Homebrew
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"

    # Install Nix
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

    # Build and activate nix-darwin configuration
    nix run nix-darwin/master#darwin-rebuild -- switch --flake ~/.config/nix
    ```

    **Linux (home-manager):**

    ```sh
    # Install Nix
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
    . ~/.nix-profile/etc/profile.d/nix.sh

    # Build and activate home-manager configuration
    nix run home-manager/master -- switch --flake ~/.config/nix
    ```

6. Reload your shell

    ```sh
    exec zsh
    ```

### Migration helper (if needed)

If an existing machine has an older setup, run:

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

### Create from scratch (optional)

This section is for anyone who wants to build their own dotfiles repo using the same git-dir + work-tree technique (not specifically this repo).

<details>
<summary>Show from-scratch setup</summary>

1. Create the git dir and point work-tree at `$HOME`

    ```sh
    DOTFILES_DIR=$HOME/git/dotfiles
    mkdir -p "$DOTFILES_DIR"
    git init "$DOTFILES_DIR"
    git --git-dir="$DOTFILES_DIR" config core.worktree "$HOME"
    git --git-dir="$DOTFILES_DIR" config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    ```

2. Add a safe default ignore policy (ignore everything, then un-ignore specific files)

    ```sh
    touch "$HOME/.gitignore"
    grep -qxF '/*' "$HOME/.gitignore" || printf '%s\n' '/*' >> "$HOME/.gitignore"
    grep -qxF '!.gitignore' "$HOME/.gitignore" || printf '%s\n' '!.gitignore' >> "$HOME/.gitignore"
    ```

3. Start tracking files by un-ignoring paths in `~/.gitignore`, then adding them

    ```sh
    git --git-dir="$DOTFILES_DIR" --work-tree="$HOME" add .gitignore
    git --git-dir="$DOTFILES_DIR" --work-tree="$HOME" commit -m "chore(dotfiles): initialise from scratch"
    ```

4. Optional: connect a remote and push

    ```sh
    DOTFILES_REPO=git@github.com:your-user/dotfiles.git
    dotfiles remote add origin "$DOTFILES_REPO"
    dotfiles push -u origin HEAD
    ```

</details>

### Setup YubiKey for `sudo`

macOS let's you use Touch ID for `sudo` but dem keyboards be expensive. Maybe you gots a YubiKey, this is how you set it up so you can touch your YubiKey instead of typing your password. The `sudo`/`pam` config is taken care of in [`flake.nix`](.config/nix/flake.nix).

```sh
mkdir ~/.config/Yubico
pamu2fcfg > ~/.config/Yubico/u2f_keys
```

Add a second key if you like

```sh
pamu2fcfg -n >> ~/.config/Yubico/u2f_keys
```

## Credit

Inspired by

- [StreakyCobra's comment on Hacker News for idea to avoid symlinks with bare repo](https://news.ycombinator.com/item?id=11071754)
- [zwyx's blog post for Sublime Merge integration](https://zwyx.dev/blog/your-dotfiles-in-a-git-repo) (historical reference; I now use LazyGit day-to-day)
- [Using a YubiKey (or other security key) for sudo via pam](https://neilzone.co.uk/2022/11/using-a-yubikey-or-other-security-key-for-sudo-via-pam/)
