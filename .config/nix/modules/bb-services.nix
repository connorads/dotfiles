{
  config,
  lib,
  pkgs,
  ...
}:
let
  launcher = import ./bb-service-launcher.nix { inherit pkgs; };
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
