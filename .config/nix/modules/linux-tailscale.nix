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
}
