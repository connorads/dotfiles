{ pkgs, lib, ... }:
let
  environment = {
    DISABLE_TELEMETRY = "1";
    DISABLE_ERROR_REPORTING = "1";
    DO_NOT_TRACK = "1";
    T3CODE_TELEMETRY_ENABLED = "false";
    T3CODE_OTEL_SDK_DISABLED = "true";
    ASTRO_TELEMETRY_DISABLED = "1";
    NEXT_TELEMETRY_DISABLED = "1";
    BB_TELEMETRY = "false";
    HYPERFRAMES_NO_TELEMETRY = "1";
    GH_TELEMETRY = "false";
    WRANGLER_SEND_METRICS = "false";
    EXPO_NO_TELEMETRY = "1";
    APIFY_CLI_DISABLE_TELEMETRY = "1";
    HF_HUB_DISABLE_TELEMETRY = "1";
    VERCEL_TELEMETRY_DISABLED = "1";
    FIRECRAWL_NO_TELEMETRY = "1";
    TURBO_TELEMETRY_DISABLED = "1";
  }
  // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
    HOMEBREW_NO_ANALYTICS = "1";
  };
in
{
  xdg.configFile."telemetry/environment.sh".text =
    lib.concatStringsSep "\n" (
      lib.mapAttrsToList (name: value: "export ${name}=${lib.escapeShellArg value}") environment
    )
    + "\n";
  xdg.configFile."telemetry/environment.json".text = builtins.toJSON environment + "\n";
  launchd.agents.telemetry-environment = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    enable = true;
    config = {
      ProgramArguments = [
        "${pkgs.writeShellScript "telemetry-launch-environment" (
          "set -eu\n"
          + lib.concatStringsSep "\n" (
            lib.mapAttrsToList (
              name: value: "/bin/launchctl setenv ${name} ${lib.escapeShellArg value}"
            ) environment
          )
        )}"
      ];
      RunAtLoad = true;
    };
  };
}
