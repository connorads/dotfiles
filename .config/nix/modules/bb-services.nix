{
  config,
  lib,
  pkgs,
  ...
}:
let
  launcher = pkgs.writeShellScript "bb-service" ''
    set -eu
    settings="$HOME/.config/bb/services.local.json"
    test -f "$settings" || exit 0
    role="$1"
    ${pkgs.jq}/bin/jq -e --arg role "$role" '.[$role].enabled == true' "$settings" >/dev/null || exit 0
    . "$HOME/.config/telemetry/environment.sh"
    mise="${pkgs.mise}/bin/mise"
    node_dir=$("$mise" -C "$HOME" where node)
    bb_dir=$("$mise" -C "$HOME" where npm:bb-app)
    export PATH="$node_dir/bin:$bb_dir/node_modules/.bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    if test "$role" = server; then
      exec "$bb_dir/node_modules/.bin/bb-app" --server-bind-host 127.0.0.1
    fi
    BB_DATA_DIR=$(${pkgs.jq}/bin/jq -er '.worker.dataDir | select(type == "string" and startswith("/"))' "$settings")
    export BB_DATA_DIR
    test -f "$BB_DATA_DIR/auth.json" || exit 0
    exec "$bb_dir/node_modules/.bin/bb-app" host-daemon
  '';
  agent = role: {
    enable = true;
    config = {
      ProgramArguments = [
        "${launcher}"
        role
      ];
      RunAtLoad = true;
      KeepAlive.SuccessfulExit = false;
      ThrottleInterval = 10;
      WorkingDirectory = config.home.homeDirectory;
      StandardOutPath = "${config.home.homeDirectory}/Library/Logs/bb-${role}.log";
      StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/bb-${role}-error.log";
    };
  };
in
{
  launchd.agents = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    bb-server = agent "server";
    bb-worker = agent "worker";
  };
}
