# ==============================================================================
# Linux Tailscale Userspace Configuration
# ==============================================================================
# Runs tailscaled in userspace mode for non-root environments (Crostini, etc.)
{ pkgs, ... }:
{
  systemd.user.services.tailscaled = {
    Unit = {
      Description = "Tailscale (userspace)";
      Wants = [ "network-online.target" ];
      After = [ "network-online.target" ];
    };

    Service = {
      ExecStart = "${pkgs.tailscale}/bin/tailscaled --tun=userspace-networking --state=%S/tailscale/tailscaled.state --socket=%t/tailscale/tailscaled.sock";
      Restart = "on-failure";
      RestartSec = 5;
      RuntimeDirectory = "tailscale";
      StateDirectory = "tailscale";
    };

    Install = {
      WantedBy = [ "default.target" ];
    };
  };

  systemd.user.services.tailscale-dns = {
    Unit = {
      Description = "Tailscale MagicDNS resolver setup";
      After = [ "tailscaled.service" ];
      Requires = [ "tailscaled.service" ];
    };

    Service = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${pkgs.writeShellScript "tailscale-dns-setup" ''
        set -eu

        SOCK="${"$"}{XDG_RUNTIME_DIR}/tailscale/tailscaled.sock"
        if [ ! -S "$SOCK" ]; then
          echo "tailscaled socket not found at $SOCK"
          exit 0
        fi

        ready=0
        for i in $(${pkgs.coreutils}/bin/seq 1 30); do
          if ${pkgs.tailscale}/bin/tailscale --socket "$SOCK" status --json >/dev/null 2>&1; then
            ready=1
            break
          fi
          sleep 1
        done

        if [ "$ready" -ne 1 ]; then
          echo "tailscaled not ready, skipping DNS setup"
          exit 0
        fi

        DOMAIN="$(${pkgs.tailscale}/bin/tailscale --socket "$SOCK" status --json | ${pkgs.jq}/bin/jq -r '.CurrentTailnet.MagicDNSSuffix // empty')"
        if [ -z "$DOMAIN" ]; then
          echo "MagicDNS suffix unavailable, skipping"
          exit 0
        fi

        if ! sudo -n true >/dev/null 2>&1; then
          echo "passwordless sudo required to update /etc/hosts"
          exit 0
        fi

        status_json="$(${pkgs.coreutils}/bin/mktemp)"
        hosts_base="$(${pkgs.coreutils}/bin/mktemp)"
        hosts_entries="$(${pkgs.coreutils}/bin/mktemp)"
        hosts_new="$(${pkgs.coreutils}/bin/mktemp)"
        trap '${pkgs.coreutils}/bin/rm -f "$status_json" "$hosts_base" "$hosts_entries" "$hosts_new"' EXIT

        ${pkgs.tailscale}/bin/tailscale --socket "$SOCK" status --json > "$status_json"

        ${pkgs.jq}/bin/jq -r '
          [
            .Self,
            (.Peer // {} | to_entries[] | .value)
          ]
          | map(select((.DNSName // "") != "" and ((.TailscaleIPs // []) | length) > 0))
          | map((.DNSName | sub("\\.$"; "")) as $fqdn
                | ($fqdn | split(".")[0]) as $short
                | "\(.TailscaleIPs[0]) \($fqdn) \($short)")
          | unique
          | .[]
        ' "$status_json" > "$hosts_entries"

        if [ ! -s "$hosts_entries" ]; then
          echo "No Tailscale host entries discovered, skipping"
          exit 0
        fi

        ${pkgs.gawk}/bin/awk '
          BEGIN { skip = 0 }
          /^# tailscale-managed-start$/ { skip = 1; next }
          /^# tailscale-managed-end$/ { skip = 0; next }
          !skip { print }
        ' /etc/hosts > "$hosts_base"

        {
          ${pkgs.coreutils}/bin/cat "$hosts_base"
          printf '\n# tailscale-managed-start\n'
          ${pkgs.coreutils}/bin/cat "$hosts_entries"
          printf '# tailscale-managed-end\n'
        } > "$hosts_new"

        sudo ${pkgs.coreutils}/bin/install -m 0644 "$hosts_new" /etc/hosts
        echo "Updated /etc/hosts for Tailscale hosts ($DOMAIN)"
      ''}";
    };

    Install = {
      WantedBy = [ "default.target" ];
    };
  };
}
