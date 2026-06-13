#!/usr/bin/env bash
# Dotfiles install script
# Works on: macOS, GitHub Codespaces, Linux as root (creates connor user), Linux as regular user
# Usage: curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash

set -e

DOTFILES_REPO="https://github.com/connorads/dotfiles.git"
DOTFILES_DIR="$HOME/git/dotfiles"
TARGET_USER="connor"

IN_CODESPACES=false
if [ "${CODESPACES:-}" = "true" ]; then
	IN_CODESPACES=true
	echo "Setting up dotfiles for GitHub Codespaces (full Nix + home-manager)..."
fi

IN_NIXOS=false
if [ -f /etc/NIXOS ]; then
	IN_NIXOS=true
	echo "Detected NixOS - Nix already installed, skipping Nix/Docker install..."
fi

# select_host <override> <current-identity> <valid-attr...>
# Echoes the chosen attr; exits non-zero (listing valid attrs) if it can't decide.
# On a fresh machine the hostname rarely matches a config, so the first activation
# must pick the attr explicitly (env override > current hostname > /dev/tty prompt).
# No silent default: guessing wrong would reconfigure the machine into the wrong role.
select_host() {
	local override="$1" current="$2"
	shift 2
	local valid=("$@") h
	if [ -n "$override" ]; then
		for h in "${valid[@]}"; do [ "$h" = "$override" ] && {
			echo "$h"
			return
		}; done
		echo "Unknown host '$override'. Valid: ${valid[*]}" >&2
		return 1
	fi
	for h in "${valid[@]}"; do [ "$h" = "$current" ] && {
		echo "$h"
		return
	}; done
	if [ -r /dev/tty ]; then
		{
			echo "Select host config:"
			local i=1
			for h in "${valid[@]}"; do
				echo "  $i) $h"
				i=$((i + 1))
			done
		} >/dev/tty
		local n
		read -r -p "> " n </dev/tty
		[ "$n" -ge 1 ] 2>/dev/null && [ "$n" -le "${#valid[@]}" ] && {
			echo "${valid[$((n - 1))]}"
			return
		}
		echo "Invalid selection" >&2
		return 1
	fi
	echo "Cannot determine host. Set the override env var to one of: ${valid[*]}" >&2
	return 1
}

# --- Clone or update dotfiles ---
clone_dotfiles() {
	if [ ! -d "$DOTFILES_DIR" ]; then
		echo "Cloning dotfiles..."
		mkdir -p "$(dirname "$DOTFILES_DIR")"
		BOOTSTRAP_WORKTREE="$(mktemp -d "$HOME/.dotfiles-bootstrap.XXXXXX")"
		git clone --separate-git-dir="$DOTFILES_DIR" "$DOTFILES_REPO" "$BOOTSTRAP_WORKTREE"
		rm -rf "$BOOTSTRAP_WORKTREE"

		git --git-dir="$DOTFILES_DIR/" config core.bare false
		git --git-dir="$DOTFILES_DIR/" config core.worktree "$HOME"
		git --git-dir="$DOTFILES_DIR/" config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
		git --git-dir="$DOTFILES_DIR/" fetch origin --prune

		cd "$HOME"
		# Backup any conflicting files
		git --git-dir="$DOTFILES_DIR/" checkout 2>&1 | sed -n 's/^[[:space:]]\+//p' | while IFS= read -r file; do
			if [ -f "$file" ]; then
				echo "Backing up $file to $file.bak"
				mv "$file" "$file.bak"
			fi
		done
		git --git-dir="$DOTFILES_DIR/" checkout -f

		current_branch="$(git --git-dir="$DOTFILES_DIR/" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
		if [ -n "$current_branch" ]; then
			git --git-dir="$DOTFILES_DIR/" --work-tree="$HOME" branch --set-upstream-to="origin/$current_branch" "$current_branch" || true
		fi
	else
		echo "Dotfiles already present, pulling latest..."
		if [ "$(git --git-dir="$DOTFILES_DIR/" rev-parse --is-bare-repository 2>/dev/null || true)" = "true" ]; then
			git --git-dir="$DOTFILES_DIR/" config --unset core.bare || true
		fi
		git --git-dir="$DOTFILES_DIR/" config core.worktree "$HOME"
		git --git-dir="$DOTFILES_DIR/" config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
		git --git-dir="$DOTFILES_DIR/" fetch origin --prune || true

		current_branch="$(git --git-dir="$DOTFILES_DIR/" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
		if [ -n "$current_branch" ]; then
			git --git-dir="$DOTFILES_DIR/" --work-tree="$HOME" branch --set-upstream-to="origin/$current_branch" "$current_branch" >/dev/null 2>&1 || true
		fi

		git --git-dir="$DOTFILES_DIR/" --work-tree="$HOME" pull || true
	fi

	git --git-dir="$DOTFILES_DIR/" config core.hooksPath .hk-hooks
}

# --- Install mise and tmux plugins (shared across platforms) ---
install_tools() {
	export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
	if ! command -v mise &>/dev/null; then
		echo "Installing mise..."
		curl -fsSL https://mise.run | sh
		export PATH="$HOME/.local/bin:$PATH"
	fi
	mise install node bun 2>&1 | grep -vF 'npm may be required'
	eval "$(mise activate bash --shims)"
	mise install

	if [ ! -d "$HOME/.config/tmux/plugins/tpm" ]; then
		echo "Installing TPM (tmux plugin manager)..."
		git clone --depth 1 https://github.com/connorads/tpm "$HOME/.config/tmux/plugins/tpm"
	fi
	echo "Installing tmux plugins via TPM..."
	TMUX_PLUGIN_MANAGER_PATH="$HOME/.config/tmux/plugins/" "$HOME/.config/tmux/plugins/tpm/bin/install_plugins"
}

# --- macOS: install Nix + nix-darwin ---
if [ "$(uname -s)" = "Darwin" ]; then
	echo "Setting up dotfiles for macOS..."

	# Valid nix-darwin configs — keep in sync with flake.nix darwinConfigurations.
	VALID_DARWIN=("Connors-Mac-mini" "Connors-MacBook-Air")

	# (a) Preflight: darwin-shared.nix hardcodes the `connorads` account, so a
	# different login user makes activation fail opaquely. Fail loud now instead.
	if [ "$(id -un)" != "connorads" ]; then
		echo "ERROR: this config expects the macOS account 'connorads', but you are '$(id -un)'." >&2
		echo "Create/login as connorads, or adjust darwin-shared.nix + the host modules." >&2
		exit 1
	fi
	# Prime sudo now (reads /dev/tty, works under curl|bash) so a bad password
	# surfaces here rather than mid-activation.
	sudo -v

	# Install Xcode Command Line Tools (needed for git, clang, etc.)
	if ! xcode-select -p &>/dev/null; then
		echo "Installing Xcode Command Line Tools..."
		xcode-select --install
		echo "Waiting for Xcode CLT installation to complete..."
		until xcode-select -p &>/dev/null; do
			sleep 5
		done
	fi

	clone_dotfiles

	# Install Nix (via DetSys installer, vanilla Nix — not Determinate Nix)
	if ! command -v nix &>/dev/null; then
		echo "Installing Nix..."
		curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm --prefer-upstream-nix
		if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
			. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
		fi
		export PATH="/nix/var/nix/profiles/default/bin:$PATH"
	else
		echo "Nix already installed"
	fi

	# (b) Determinate check: nix-darwin aborts "Determinate detected" if its daemon
	# is present, because this config manages nix.settings.* (incompatible unless
	# nix.enable = false). We install vanilla Nix above (--prefer-upstream-nix), so
	# this should never trip — but fail loud with remediation if it somehow does.
	if [ -e /usr/local/bin/determinate-nixd ]; then
		echo "ERROR: Determinate Nix daemon detected (/usr/local/bin/determinate-nixd)." >&2
		echo "This config manages nix.settings.* and is incompatible with Determinate's daemon." >&2
		echo "Remediation: reinstall vanilla Nix, or set nix.enable = false (out of scope here)." >&2
		exit 1
	fi

	# Install Homebrew (required by nix-darwin homebrew module)
	if ! command -v brew &>/dev/null && [ ! -x /opt/homebrew/bin/brew ]; then
		echo "Installing Homebrew..."
		NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
	fi
	eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true

	# (c) Resolve the config explicitly for the first activation. nix-darwin resolves
	# from `scutil --get LocalHostName`, which on a fresh machine rarely matches — so
	# pass `#<attr>` here. No fallback: select_host failing aborts under `set -e`.
	DARWIN_HOST="$(select_host "${DARWIN_HOST:-}" "$(scutil --get LocalHostName 2>/dev/null)" "${VALID_DARWIN[@]}")"
	echo "Using nix-darwin config: $DARWIN_HOST"

	# (d) Back up nix-darwin-managed /etc files that the Determinate installer created,
	# so the first activation doesn't abort on file conflicts. Only when darwin-rebuild
	# isn't on PATH yet (i.e. first run). Skip files that are already /etc/static
	# symlinks (managed) or already backed up (idempotent). /etc/profile and
	# /etc/bash.bashrc are NOT nix-darwin-managed — left untouched.
	if ! command -v darwin-rebuild &>/dev/null; then
		for f in /etc/nix/nix.conf /etc/zprofile /etc/bashrc /etc/zshrc /etc/zshenv; do
			if [ -e "$f" ] && [ ! -L "$f" ] && [ ! -e "$f.before-nix-darwin" ]; then
				echo "Backing up $f to $f.before-nix-darwin"
				sudo mv "$f" "$f.before-nix-darwin"
			fi
		done
	fi

	# (e) Bootstrap nix-darwin (first run) or rebuild (subsequent runs).
	# Explicit `#$DARWIN_HOST` attr; no `|| true` masking — `set -e` stops on real
	# failure. Hostname convergence is handled declaratively by networking.hostName
	# during activation, so bare `drs`/`up` resolve correctly thereafter.
	# PATH is preserved so activation can find brew.
	#
	# The bootstrap `nix run` enables experimental-features inline because step (d)
	# moves the Determinate installer's /etc/nix/nix.conf (which carries
	# `extra-experimental-features = nix-command flakes`) aside before activation,
	# and under `sudo` $HOME falls back to /var/root so no user nix.conf supplies
	# them either. Without this flag `nix run` aborts: "nix-command is disabled".
	# nix-darwin regenerates /etc/nix/nix.conf with the flags on first activation,
	# so the darwin-rebuild path (subsequent runs) needs no override.
	if command -v darwin-rebuild &>/dev/null; then
		echo "Running darwin-rebuild switch..."
		sudo --preserve-env=PATH darwin-rebuild switch --flake "$HOME/.config/nix#$DARWIN_HOST"
	else
		echo "Bootstrapping nix-darwin..."
		sudo --preserve-env=PATH nix \
			--extra-experimental-features 'nix-command flakes' \
			run nix-darwin/master#darwin-rebuild -- \
			switch --flake "$HOME/.config/nix#$DARWIN_HOST"
	fi

	install_tools

	echo ""
	echo "Done! Restart your shell or run: exec zsh"
	exit 0
fi

# --- Linux as root: create user and re-run ---
if [ "$(id -u)" = "0" ]; then
	echo "Running as root, setting up $TARGET_USER user..."

	if ! id "$TARGET_USER" &>/dev/null; then
		echo "Creating user $TARGET_USER..."
		useradd -m -s /bin/bash "$TARGET_USER"
		echo "$TARGET_USER ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/$TARGET_USER"
		chmod 440 "/etc/sudoers.d/$TARGET_USER"
	fi

	# Copy SSH authorized_keys
	if [ -f /root/.ssh/authorized_keys ]; then
		echo "Copying SSH keys to $TARGET_USER..."
		mkdir -p "/home/$TARGET_USER/.ssh"
		cp /root/.ssh/authorized_keys "/home/$TARGET_USER/.ssh/"
		chown -R "$TARGET_USER:$TARGET_USER" "/home/$TARGET_USER/.ssh"
		chmod 700 "/home/$TARGET_USER/.ssh"
		chmod 600 "/home/$TARGET_USER/.ssh/authorized_keys"
	fi

	echo "Re-running script as $TARGET_USER..."
	exec sudo -u "$TARGET_USER" bash -c "curl -fsSL https://raw.githubusercontent.com/connorads/dotfiles/master/install.sh | bash"
fi

# --- Linux as regular user ---
echo "Setting up dotfiles for Linux..."
clone_dotfiles

# Install Nix if not present (skip on NixOS - already has Nix)
if [ "$IN_NIXOS" = "true" ]; then
	echo "NixOS detected - Nix already available"
elif ! command -v nix &>/dev/null; then
	echo "Installing Nix..."

	if [ "$IN_CODESPACES" = "true" ]; then
		# Codespaces has known ACL weirdness on /tmp that breaks Nix builds.
		if command -v apt-get &>/dev/null; then
			echo "Ensuring /tmp ACLs won't break Nix builds..."
			sudo apt-get update -y
			sudo apt-get install -y acl xz-utils
			sudo setfacl -k /tmp || true
		fi

		# Codespaces: install single-user Nix (no daemon) to avoid systemd.
		# Also disable sandbox to avoid seccomp/container issues.
		tmp_nix_conf="$(mktemp)"
		cat >"$tmp_nix_conf" <<'EOF'
experimental-features = nix-command flakes
sandbox = false
EOF

		curl -L https://nixos.org/nix/install | sh -s -- --no-daemon --yes --nix-extra-conf-file "$tmp_nix_conf"
		rm -f "$tmp_nix_conf"

		mkdir -p "$HOME/.config/nix"
		if ! grep -q "^experimental-features = .*nix-command" "$HOME/.config/nix/nix.conf" 2>/dev/null; then
			printf '%s\n' "experimental-features = nix-command flakes" >>"$HOME/.config/nix/nix.conf"
		fi
		if ! grep -q "^sandbox = false$" "$HOME/.config/nix/nix.conf" 2>/dev/null; then
			printf '%s\n' "sandbox = false" >>"$HOME/.config/nix/nix.conf"
		fi
	else
		curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm --prefer-upstream-nix
	fi

	# Source nix for this session (best-effort across install modes)
	if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
		. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
	elif [ -f /nix/var/nix/profiles/default/etc/profile.d/nix.sh ]; then
		. /nix/var/nix/profiles/default/etc/profile.d/nix.sh
	elif [ -f "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
		. "$HOME/.nix-profile/etc/profile.d/nix.sh"
	fi

	export PATH="/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/per-user/$USER/profile/bin:$HOME/.nix-profile/bin:$PATH"
else
	echo "Nix already installed"
fi

# Install Docker if not present (skip on NixOS - managed by NixOS config)
if [ "$IN_CODESPACES" = "true" ]; then
	echo "Skipping Docker install in Codespaces"
elif [ "$IN_NIXOS" = "true" ]; then
	echo "Skipping Docker install on NixOS - managed by NixOS config"
else
	if ! command -v docker &>/dev/null; then
		echo "Installing Docker..."
		curl -fsSL https://get.docker.com | sudo sh

		if ! groups "$USER" | grep -q docker; then
			sudo usermod -aG docker "$USER"
			echo "Added $USER to docker group (log out and back in to use docker without sudo)"
		fi

		echo "Optional: For rootless Docker (more secure), run: dockerd-rootless-setuptool.sh install"
		echo "See: https://docs.docker.com/engine/security/rootless/"
	else
		echo "Docker already installed: $(docker --version)"

		if command -v systemctl &>/dev/null && ! sudo systemctl is-active --quiet docker; then
			sudo systemctl start docker
		fi

		if ! groups "$USER" | grep -q docker; then
			sudo usermod -aG docker "$USER"
			echo "Added $USER to docker group (log out and back in to use docker without sudo)"
		fi
	fi
fi

# Run home-manager (standalone on NixOS for user env, system config is separate)
if [ "$IN_CODESPACES" = "true" ]; then
	echo "Running home-manager switch..."
	nix run home-manager/master -- switch --flake ~/.config/nix#codespace
else
	# Valid home-manager configs — keep in sync with flake.nix homeConfigurations.
	VALID_HM=("connor@penguin" "connor@dev" "connor@rpi5")

	# Preflight: the Linux configs (and TARGET_USER) assume the `connor` account.
	if [ "$(id -un)" != "connor" ]; then
		echo "ERROR: this config expects the Linux account 'connor', but you are '$(id -un)'." >&2
		echo "Re-run as connor, or adjust flake.nix homeConfigurations + TARGET_USER." >&2
		exit 1
	fi
	# home-manager resolves homeConfigurations."$USER@<host>" from $USER (env), so
	# ensure it's exported for the `nix run` below.
	export USER

	# Resolve the config explicitly for the first activation. home-manager resolves
	# from "$USER@$(hostname)" and, if absent, silently falls back to bare "$USER"
	# (which doesn't exist here) → opaque Nix error. Override with HM_HOST=<host>.
	HOME_HOST="$(select_host "${HM_HOST:+connor@$HM_HOST}" "connor@$(hostname -s)" "${VALID_HM[@]}")"
	echo "Using home-manager config: $HOME_HOST"

	# Converge the hostname (the Linux equivalent of macOS networking.hostName) so
	# bare `hms`/`up` resolve afterwards. home-manager standalone can't set it.
	# Skip on NixOS (the system config owns the hostname) and Codespaces.
	if [ "$IN_NIXOS" = "false" ]; then
		if command -v hostnamectl &>/dev/null; then
			if [ "$(hostname -s)" != "${HOME_HOST#connor@}" ]; then
				echo "Setting hostname to ${HOME_HOST#connor@}..."
				sudo hostnamectl set-hostname "${HOME_HOST#connor@}"
			fi
		else
			echo "WARNING: hostnamectl absent — hostname not converged; bare 'hms'/'up' will need '#$HOME_HOST'."
		fi
	fi

	echo "Running home-manager switch..."
	nix run home-manager/master -- switch --flake "$HOME/.config/nix#$HOME_HOST"
fi

# Install system-level tailscaled (kernel TUN mode, needed for ts serve)
# Skip on NixOS (managed by NixOS config) and Codespaces (no systemd)
if [ "$IN_NIXOS" = "false" ] && [ "$IN_CODESPACES" = "false" ] && command -v systemctl &>/dev/null; then
	TAILSCALED_BIN="$HOME/.nix-profile/bin/tailscaled"
	UNIT_FILE="/etc/systemd/system/tailscaled.service"

	if [ -x "$TAILSCALED_BIN" ] && [ ! -f "$UNIT_FILE" ]; then
		echo "Installing system tailscaled service (kernel TUN mode)..."

		# Stop userspace tailscaled if running
		systemctl --user stop tailscaled 2>/dev/null || true
		systemctl --user disable tailscaled 2>/dev/null || true

		sudo tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=Tailscale node agent
Documentation=https://tailscale.com/kb/
Wants=network-pre.target
After=network-pre.target NetworkManager.service systemd-resolved.service

[Service]
ExecStart=$TAILSCALED_BIN --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock
ExecStopPost=$TAILSCALED_BIN --cleanup
Restart=on-failure
RuntimeDirectory=tailscale
RuntimeDirectoryMode=0755
StateDirectory=tailscale
StateDirectoryMode=0700
CacheDirectory=tailscale
CacheDirectoryMode=0750
Type=notify

[Install]
WantedBy=multi-user.target
EOF

		sudo systemctl daemon-reload
		sudo systemctl enable --now tailscaled

		TAILSCALE_BIN="$HOME/.nix-profile/bin/tailscale"
		if [ -x "$TAILSCALE_BIN" ]; then
			# Wait for tailscaled socket to be ready
			for i in $(seq 1 10); do
				[ -S /run/tailscale/tailscaled.sock ] && break
				sleep 1
			done
			sudo "$TAILSCALE_BIN" set --operator="$USER"
		fi
		echo "tailscaled running with TUN. Run 'ts up' to authenticate."
		echo "  Then lock down SSH: sudo ufw delete allow 22/tcp"
	elif [ -f "$UNIT_FILE" ]; then
		echo "System tailscaled already installed"
	fi
fi

# --- Security hardening (non-NixOS Linux only) ---
# NixOS handles this in configuration.nix; Codespaces are ephemeral
if [ "$IN_NIXOS" = "false" ] && [ "$IN_CODESPACES" = "false" ] && command -v apt-get &>/dev/null; then
	echo "Applying security hardening..."

	# SSH hardening — drop-in config
	SSHD_HARDENING="/etc/ssh/sshd_config.d/90-hardening.conf"
	if [ ! -f "$SSHD_HARDENING" ]; then
		if [ ! -s "$HOME/.ssh/authorized_keys" ]; then
			echo "WARNING: No authorized_keys found — skipping SSH hardening to avoid lockout"
		else
			echo "Hardening SSH config..."
			sudo tee "$SSHD_HARDENING" >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 20
AllowTcpForwarding no
AllowAgentForwarding yes
X11Forwarding no
AllowUsers connor
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
HostKeyAlgorithms ssh-ed25519,ssh-ed25519-cert-v01@openssh.com
EOF
			sudo systemctl reload sshd 2>/dev/null || sudo systemctl reload ssh 2>/dev/null || true
		fi
	else
		echo "SSH hardening already applied"
	fi

	# fail2ban
	if ! command -v fail2ban-client &>/dev/null; then
		echo "Installing fail2ban..."
		sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban
	fi
	if [ ! -f /etc/fail2ban/jail.local ]; then
		echo "Configuring fail2ban..."
		sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 1h
bantime.increment = true
bantime.multipliers = 1 5 30 60 720 1440 2880
bantime.maxtime = 4w
findtime = 10m
EOF
	fi
	sudo systemctl enable --now fail2ban 2>/dev/null || true

	# UFW firewall
	if ! command -v ufw &>/dev/null; then
		echo "Installing UFW..."
		sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y ufw
	fi
	if ! sudo ufw status | grep -q "Status: active"; then
		echo "Configuring UFW firewall..."
		sudo ufw default deny incoming
		sudo ufw default allow outgoing
		sudo ufw allow 22/tcp comment 'SSH (remove after Tailscale setup)'
		sudo ufw allow in on tailscale0 comment 'Tailscale'

		# Auto-detect Tailscale WireGuard UDP port from iptables rules
		TS_UDP_PORT=$(sudo iptables -S ts-input 2>/dev/null | grep -oP 'udp --dport \K[0-9]+' | head -1)
		if [ -n "$TS_UDP_PORT" ]; then
			sudo ufw allow "$TS_UDP_PORT"/udp comment 'Tailscale WireGuard'
		fi

		sudo ufw --force enable
	else
		echo "UFW already active"
	fi

	# Unattended-upgrades
	if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
		echo "Installing unattended-upgrades..."
		sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades
		sudo env DEBIAN_FRONTEND=noninteractive dpkg-reconfigure -plow unattended-upgrades
	fi
	sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true

	# Unattended-upgrades drop-in: enable -updates pocket, auto-reboot, kernel cleanup
	UA_DROPIN="/etc/apt/apt.conf.d/52unattended-upgrades-local"
	if [ ! -f "$UA_DROPIN" ]; then
		echo "Configuring unattended-upgrades drop-in..."
		sudo tee "$UA_DROPIN" >/dev/null <<'EOF'
// Managed by install.sh
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-updates"; };
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::SyslogEnable "true";
EOF
	else
		echo "Unattended-upgrades drop-in already configured"
	fi

	# needrestart: explicit auto-restart mode
	if [ -d /etc/needrestart ]; then
		NR_CONF="/etc/needrestart/conf.d/90-auto.conf"
		if [ ! -f "$NR_CONF" ]; then
			echo "Configuring needrestart auto mode..."
			sudo mkdir -p /etc/needrestart/conf.d
			sudo tee "$NR_CONF" >/dev/null <<'EOF'
# Managed by install.sh — auto-restart services after library updates
$nrconf{restart} = 'a';
EOF
		else
			echo "needrestart auto mode already configured"
		fi
	fi

	# Ubuntu Pro advisory
	if command -v pro &>/dev/null; then
		if ! pro status 2>&1 | grep -q "Attached: True"; then
			echo "NOTE: Ubuntu Pro not attached. For extra security patches run:"
			echo "  sudo pro attach <TOKEN>  (free: https://ubuntu.com/pro)"
		fi
	fi

	# Kernel hardening (sysctl)
	SYSCTL_HARDENING="/etc/sysctl.d/99-hardening.conf"
	if [ ! -f "$SYSCTL_HARDENING" ]; then
		echo "Applying kernel hardening (sysctl)..."
		sudo tee "$SYSCTL_HARDENING" >/dev/null <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 2
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0
EOF
		sudo sysctl --system >/dev/null
	else
		echo "Kernel hardening already applied"
	fi

	# Audit logging (auditd)
	if ! command -v auditctl &>/dev/null; then
		echo "Installing auditd..."
		sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y auditd
	fi
	AUDIT_RULES="/etc/audit/rules.d/hardening.rules"
	if [ ! -f "$AUDIT_RULES" ]; then
		echo "Configuring auditd rules..."
		sudo tee "$AUDIT_RULES" >/dev/null <<'AUDITEOF'
# Identity and authentication
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/sudoers -p wa -k identity
-w /etc/sudoers.d/ -p wa -k identity
-w /etc/pam.d/ -p wa -k identity

# SSH configuration
-w /etc/ssh/ -p wa -k sshconfig
-w /home/connor/.ssh/ -p wa -k sshconfig

# Persistence mechanisms
-w /etc/cron.d/ -p wa -k persistence
-w /etc/crontab -p wa -k persistence
-w /var/spool/cron/ -p wa -k persistence
-w /etc/systemd/system/ -p wa -k persistence

# Network configuration
-w /etc/hosts -p wa -k network

# Audit log tampering
-w /var/log/audit/ -p wa -k audit-log

# Kernel modules (aarch64-compatible syscalls)
-a always,exit -F arch=b64 -S init_module,delete_module,finit_module -k modules
AUDITEOF
	fi

	# Configure auditd log rotation (200MB cap: 20MB x 10 files)
	AUDITD_CONF="/etc/audit/auditd.conf"
	if ! grep -q "^max_log_file = 20$" "$AUDITD_CONF" 2>/dev/null; then
		echo "Configuring auditd log rotation..."
		sudo sed -i 's/^max_log_file = .*/max_log_file = 20/' "$AUDITD_CONF"
		sudo sed -i 's/^num_logs = .*/num_logs = 10/' "$AUDITD_CONF"
		sudo sed -i 's/^max_log_file_action = .*/max_log_file_action = ROTATE/' "$AUDITD_CONF"
		sudo sed -i 's/^space_left_action = .*/space_left_action = SUSPEND/' "$AUDITD_CONF"
	fi

	sudo systemctl enable --now auditd 2>/dev/null || true
	sudo augenrules --load 2>/dev/null || true

	# Docker daemon hardening
	DOCKER_DAEMON="/etc/docker/daemon.json"
	if [ ! -f "$DOCKER_DAEMON" ] && command -v docker &>/dev/null; then
		echo "Configuring Docker daemon hardening..."
		sudo tee "$DOCKER_DAEMON" >/dev/null <<'EOF'
{
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
		sudo systemctl restart docker
	fi

	# Tighten .env file permissions in project dirs
	find "$HOME/git" -maxdepth 3 -name '.env' -o -name '.env.local' -o -name '.env.production' 2>/dev/null | while read -r envfile; do
		if [ "$(stat -c '%a' "$envfile")" != "600" ]; then
			chmod 600 "$envfile"
			echo "Tightened permissions on $envfile"
		fi
	done

	# Apply pending package updates
	echo "Applying pending package updates..."
	sudo apt-get update -y
	sudo env DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
	sudo env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y
fi

# Install tools via mise (skip on NixOS - use Nix packages instead)
if [ "$IN_NIXOS" = "true" ]; then
	echo "Skipping mise install on NixOS - tools managed by NixOS config"
else
	# Ensure common build deps exist so mise/python-build can compile CPython with
	# core stdlib modules enabled (notably zlib, which is required for ensurepip).
	if command -v apt-get &>/dev/null && command -v dpkg &>/dev/null; then
		pkgs=(
			build-essential
			pkg-config
			zlib1g-dev
			libssl-dev
			libbz2-dev
			libreadline-dev
			libsqlite3-dev
			libffi-dev
			liblzma-dev
			libncursesw5-dev
			libgdbm-dev
			libgdbm-compat-dev
			uuid-dev
			tk-dev
			xz-utils
		)

		missing=()
		for pkg in "${pkgs[@]}"; do
			if ! dpkg -s "$pkg" >/dev/null 2>&1; then
				missing+=("$pkg")
			fi
		done

		if [ "${#missing[@]}" -gt 0 ]; then
			echo "Installing system packages required for building Python (apt-get)..."
			sudo apt-get update -y
			sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
		fi
	fi

	if [ "$IN_CODESPACES" = "true" ]; then
		export MISE_ENV=codespaces
		echo "mise: env=codespaces"
	fi

	export PATH="/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/per-user/$USER/profile/bin:$HOME/.nix-profile/bin:/etc/profiles/per-user/$USER/bin:$PATH"
	install_tools
fi

# Install browser binaries for Playwright and agent-browser (if available via mise)
if command -v playwright &>/dev/null; then
	echo "Installing Playwright browsers and system deps..."
	playwright install --with-deps
fi

if command -v agent-browser &>/dev/null; then
	echo "Installing agent-browser browsers..."
	agent-browser install --with-deps
fi

# Set zsh as default shell
ZSH_PATH="$HOME/.nix-profile/bin/zsh"
if [ "$IN_CODESPACES" = "true" ]; then
	echo "Skipping default shell change in Codespaces"
elif [[ -x "$ZSH_PATH" && "$SHELL" != "$ZSH_PATH" ]]; then
	echo "Changing default shell to zsh..."
	sudo chsh -s "$ZSH_PATH" "$USER"
fi

echo ""
echo "Done! Restart your shell or run: exec zsh"
