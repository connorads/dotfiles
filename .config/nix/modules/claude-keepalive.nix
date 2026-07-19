# Mini-only Claude subscription keepalive.
#
# The Claude Pro/Max 5-hour usage window is a *rolling* window that starts on
# the first message and always ends 5h later - it can't be held open. A daily
# ping at a fixed anchor makes the window *start* at a predictable time, so its
# resets land at convenient hours instead of drifting to whenever Claude first
# gets used. It adds no quota; it only aligns when the window begins.
#
# launchd has no native jitter (unlike systemd's RandomizedDelaySec), so the
# script sleeps a random 0-59 min off the anchor; the exact minute and the
# prompt text vary per run. `claude` is mise-managed, and LaunchAgents get a
# sparse PATH, so the mise shim is called by absolute path. Auth comes from the
# file at ~/.claude/.credentials.json (not the Keychain), so it runs headless
# with no unlock prompt.
{ pkgs, ... }:
let
  keepalive = pkgs.writeShellApplication {
    name = "claude-keepalive";
    text = ''
      log="$HOME/.cache/claude-keepalive.log"
      sleep $(( RANDOM % 3600 ))                       # jitter 0-59 min off the anchor
      prompts=(
        "hello, please don't reply"
        "hi - no response needed"
        "ping, ignore this one"
        "just a nudge, don't answer"
      )
      msg="''${prompts[RANDOM % ''${#prompts[@]}]}"
      printf '%s ping: %s\n' "$(date -Iseconds)" "$msg" >> "$log"
      "$HOME/.local/share/mise/shims/claude" -p --model haiku "$msg" >> "$log" 2>&1 \
        || printf '%s FAILED\n' "$(date -Iseconds)" >> "$log"
    '';
  };
in
{
  launchd.user.agents.claude-keepalive.serviceConfig = {
    ProgramArguments = [ "${keepalive}/bin/claude-keepalive" ];
    StartCalendarInterval = [
      {
        Hour = 7;
        Minute = 0;
      }
    ]; # anchor; script adds <=59 min
    RunAtLoad = false; # don't fire on every drs rebuild
    StandardErrorPath = "/Users/connorads/.cache/claude-keepalive.log";
  };
}
