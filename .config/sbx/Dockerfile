# sbx: image for running UNTRUSTED software in a throwaway, VM-isolated
# container. The inverse of agentbox: nothing of the host is trusted in (no
# dotfile mounts, cap-drop ALL, offline by default - see the sbx notes in
# ~/AGENTS.md). What IS baked is a capable general toolbox so you can actually
# poke at whatever you're testing without the host ever being reachable.
FROM debian:stable-slim

# Baked toolbox (grouped): shell/session, editors, fetch/vcs, build/compile,
# python, text+data wrangling, process/syscall inspection (strace/ltrace need
# `--cap-add SYS_PTRACE` since sbx drops all caps), and network inspection.
# Keep this a single RUN with NO inline `#` comments - they break `\`-continued
# RUN commands.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tmux bash zsh ca-certificates less \
      vim nano \
      curl wget git openssh-client \
      build-essential pkg-config make \
      python3 python3-pip python3-venv \
      jq ripgrep fd-find file unzip zip xz-utils tree \
      procps htop strace ltrace lsof \
      iproute2 dnsutils netcat-openbsd iputils-ping \
 && rm -rf /var/lib/apt/lists/*

# Non-root sandbox user. /work is the writable scratch, backed by a volume.
RUN useradd -m -s /bin/bash sandbox \
 && mkdir -p /work \
 && chown sandbox:sandbox /work

# Minimal tmux config only (mouse + scrollback). No host config is baked -
# a live mount would hand untrusted code your real files.
RUN printf 'set -g mouse on\nset -g history-limit 50000\nset -g default-terminal "tmux-256color"\n' \
      > /home/sandbox/.tmux.conf \
 && chown sandbox:sandbox /home/sandbox/.tmux.conf

USER sandbox
WORKDIR /work

# PID 1 just idles; the tmux session is created lazily on first `sbx shell`
# via `tmux new-session -A`, so it survives detach/reattach.
CMD ["sleep", "infinity"]
