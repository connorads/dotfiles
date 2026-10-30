{
  pkgs,
  deployedServer ? false,
}:
pkgs.writeShellScript "bb-service" ''
  set -eu
  settings="$HOME/.config/bb/services.local.json"
  test -f "$settings" || exit 0
  role="$1"
  ${pkgs.jq}/bin/jq -e --arg role "$role" '.[$role].enabled == true' "$settings" >/dev/null || exit 0
  . "$HOME/.config/telemetry/environment.sh"
  mise="${pkgs.mise}/bin/mise"
  tools="$HOME"
  ${pkgs.lib.optionalString deployedServer ''
    if test "$role" = server; then
      tools="$HOME/.config/bb/deployment/current"
      test -f "$tools/mise.toml" || {
        echo "bb-service: deployed pins missing; run bb-deploy prepare and bb-deploy adopt" >&2
        exit 1
      }
    fi
  ''}
  node_dir=$("$mise" -C "$tools" where node)
  bb_dir=$("$mise" -C "$tools" where npm:bb-app)
  export PATH="$node_dir/bin:$bb_dir/node_modules/.bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.nix-profile/bin:/etc/profiles/per-user/$USER/bin:/run/current-system/sw/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  if test "$role" = server; then
    ${pkgs.lib.optionalString deployedServer ''
      deployment_service=$("$mise" config get --file "$tools/mise.toml" env.BB_DEPLOY_SERVICE 2>/dev/null) || deployment_service=system
      if test "$deployment_service" = user; then
        package=$("$mise" config get --file "$tools/mise.toml" env.BB_DEPLOY_PACKAGE)
        test -f "$package/dist/bb-app.js"
        exec "$node_dir/bin/node" "$package/dist/bb-app.js" --server-bind-host 127.0.0.1 --no-in-app-updates
      fi
      test "$deployment_service" = system
    ''}
    exec "$bb_dir/node_modules/.bin/bb-app" --server-bind-host 127.0.0.1 --no-in-app-updates
  fi
  BB_DATA_DIR=$(${pkgs.jq}/bin/jq -er '.worker.dataDir | select(type == "string" and startswith("/"))' "$settings")
  export BB_DATA_DIR
  test -f "$BB_DATA_DIR/auth.json" || exit 0
  exec "$bb_dir/node_modules/.bin/bb-app" host-daemon
''
