import { expect, test } from "bun:test";
import { claudeSettings } from "./sandbox.ts";

const settings = claudeSettings({
  home: "/Users/me",
  denyRead: ["~/.ssh", "/etc/secret"],
  denyWrite: ["/repo", "/tmp/wt"],
});

test("secret paths are denied to the Read tools, home-relative or absolute", () => {
  expect(settings.permissions.deny).toEqual([
    "Read(~/.ssh)",
    "Read(~/.ssh/**)",
    "Read(//etc/secret)",
    "Read(//etc/secret/**)",
  ]);
});

test("Bash is sandboxed, fails closed, cannot escape, and cannot write the repo", () => {
  expect(settings.sandbox).toEqual({
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: { denyRead: ["/Users/me/.ssh", "/etc/secret"], denyWrite: ["/repo", "/tmp/wt"] },
    network: { allowedDomains: [] },
  });
});
