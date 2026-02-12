FROM node:20

ARG GIT_DELTA_VERSION=0.18.2
ARG TARGETARCH

# Dev tools + firewall packages
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  curl \
  dnsutils \
  fzf \
  git \
  aggregate \
  iptables \
  ipset \
  iproute2 \
  jq \
  less \
  ripgrep \
  sudo \
  tmux \
  unzip \
  zsh \
  && rm -rf /var/lib/apt/lists/*

# git-delta (multi-arch)
RUN DELTA_ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "aarch64" || echo "x86_64") \
  && curl -fsSL "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/delta-${GIT_DELTA_VERSION}-${DELTA_ARCH}-unknown-linux-gnu.tar.gz" \
  | tar xz -C /tmp \
  && mv "/tmp/delta-${GIT_DELTA_VERSION}-${DELTA_ARCH}-unknown-linux-gnu/delta" /usr/local/bin/ \
  && rm -rf /tmp/delta-*

# gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# OpenCode
RUN curl -fsSL https://opencode.ai/install | bash \
  && mv /root/.opencode/bin/opencode /usr/local/bin/opencode

# Rename node (UID 1000) to agent — matches typical host UID
RUN usermod -l agent -d /home/agent -m -s /bin/zsh node \
  && groupmod -n agent node \
  && usermod -aG sudo agent \
  && echo "agent ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" \
  > /etc/sudoers.d/agent-firewall \
  && chmod 0440 /etc/sudoers.d/agent-firewall

# Firewall + entrypoint scripts
COPY init-firewall.sh /usr/local/bin/
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/entrypoint.sh

# Shell history volume target
RUN mkdir -p /commandhistory && chown agent:agent /commandhistory

# Workspace — safe.directory for bind-mounted repos with different ownership
RUN mkdir -p /workspace && chown agent:agent /workspace \
  && git config --system --add safe.directory /workspace
WORKDIR /workspace

USER agent

# Basic zsh config for agent
RUN echo 'export HISTFILE=/commandhistory/.zsh_history' >> ~/.zshrc \
  && echo 'export HISTSIZE=10000' >> ~/.zshrc \
  && echo 'export SAVEHIST=10000' >> ~/.zshrc \
  && echo 'setopt APPEND_HISTORY SHARE_HISTORY' >> ~/.zshrc

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
