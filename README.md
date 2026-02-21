# dotfiles

Use `git` (and [Sublime Merge](https://www.sublimemerge.com/)) to manage [dotfiles](https://en.wikipedia.org/wiki/Hidden_file_and_hidden_directory#Unix_and_Unix-like_environments) without symlinks. This setup uses a dedicated git dir at `~/git/dotfiles` with work-tree `~` (via the `dotfiles` wrapper). Uses [`nix-darwin`](https://github.com/LnL7/nix-darwin) (macOS) or [`home-manager`](https://github.com/nix-community/home-manager) (Linux) and [`brew`](https://brew.sh/) (macOS) to setup and install software, and [`mise`](https://github.com/connorads/mise/) to manage runtimes.

## Why this setup

- No symlinks: tracked files live directly in `$HOME`.
- Git metadata stays out of the way in `~/git/dotfiles`.
- Bootstrap is safer on existing machines where dotfiles may already exist.
- Day-to-day Git UX stays reliable, including ahead-behind and push state in LazyGit.

Implementation detail: bootstrap uses `git clone --bare`, then switches to `work-tree=$HOME` and restores normal `origin/*` tracking refs.

### Could we skip `clone --bare`?

Yes, but this repo keeps the current approach because it is already wired into scripts/tooling and avoids a larger migration.
The practical fix is to keep this layout and restore normal tracking refs during setup.

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

It installs dotfiles and restores upstream tracking so `git status`/LazyGit show ahead-behind correctly.

### Advanced manual setup (from this repo)

If you want to follow the manual path (or fork this repo), use this.

1. Clone repo

    ```sh
    DOTFILES_REPO=https://github.com/connorads/dotfiles/
    DOTFILES_DIR=$HOME/git/dotfiles
    git clone --bare $DOTFILES_REPO $DOTFILES_DIR
    ```

2. Switch repo to work-tree mode and restore remote-tracking refs

    ```sh
    cd $DOTFILES_DIR
    git config --unset core.bare
    git config core.worktree $HOME

    # Needed after clone --bare so origin/* tracking exists.
    # This enables ahead-behind in git status/LazyGit.
    git config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    git fetch origin --prune
    ```

3. Check out dotfiles into `$HOME` (⚠️ this overwrites conflicting files)

    ```sh
    cd $HOME
    git --git-dir=$DOTFILES_DIR/ checkout -f
    ```

4. Set upstream for the current branch

    ```sh
    CURRENT_BRANCH=$(git --git-dir=$DOTFILES_DIR/ symbolic-ref --quiet --short HEAD)
    git --git-dir=$DOTFILES_DIR/ --work-tree=$HOME branch --set-upstream-to=origin/$CURRENT_BRANCH $CURRENT_BRANCH
    ```

5. Setup nix, brew and install software (⚠️ skip the option to install Determinate Nix)

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

6. Reload your shell and open Sublime Merge

    ```sh
    smerge $DOTFILES_DIR
    ```

### Troubleshooting: no ahead-behind in LazyGit

Run:

```sh
DOTFILES_DIR=$HOME/git/dotfiles
CURRENT_BRANCH=$(git --git-dir=$DOTFILES_DIR/ symbolic-ref --quiet --short HEAD)
git --git-dir=$DOTFILES_DIR/ config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git --git-dir=$DOTFILES_DIR/ fetch origin --prune
git --git-dir=$DOTFILES_DIR/ --work-tree=$HOME branch --set-upstream-to=origin/$CURRENT_BRANCH $CURRENT_BRANCH
```

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

### Setup (from scratch)

Follow these steps to recreate the setup for this repo from scratch.

1. Create repository to store dotfiles

    ```sh
    DOTFILES_DIR=$HOME/git/dotfiles
    git init --bare $DOTFILES_DIR
    ```

2. Change worktree to home directory

    ```sh
    cd $DOTFILES_DIR
    git config --unset core.bare
    git config core.worktree $HOME
    ```

    If you later add an `origin` remote, make sure fetch mapping uses `refs/remotes/origin/*` so ahead-behind works:

    ```sh
    git config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
    ```

3. Ignore all files except `.gitignore` ([Sublime merge doesn't support status.showUntrackedFiles=no](https://github.com/sublimehq/sublime_merge/issues/1544))

    ```sh
    cd $HOME
    echo "/*" >> .gitignore
    echo "!.gitignore" >> .gitignore
    ```

4. Add alias to `.zshrc`

    ```sh
    echo "alias dotfiles='git --git-dir=$HOME/git/dotfiles/'" >> $HOME/.zshrc
    ```

5. You can now start [tracking files](#usage)

## Credit

Inspired by

- [StreakyCobra's comment on Hacker News for idea to avoid symlinks with bare repo](https://news.ycombinator.com/item?id=11071754)
- [zwyx's blog post for Sublime Merge integration](https://zwyx.dev/blog/your-dotfiles-in-a-git-repo)
- [Using a YubiKey (or other security key) for sudo via pam](https://neilzone.co.uk/2022/11/using-a-yubikey-or-other-security-key-for-sudo-via-pam/)
