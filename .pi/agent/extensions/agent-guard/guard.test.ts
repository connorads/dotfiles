import assert from "node:assert/strict";
import { test } from "node:test";

import { blockReason, matchedSecret, SECRET_PATHS, tokenise } from "./guard.ts";

const HOME = "/Users/test";

function bash(command: string): string | undefined {
  return blockReason("bash", { command }, HOME);
}

test("secret paths: home-anchored forms are blocked", () => {
  for (const cmd of [
    "cat ~/.ssh/id_rsa",
    "xxd ~/.aws/credentials",
    "base64 ~/.config/gh-gate/app.pem",
    "cd ~/.ssh",
    "cat .ssh/id_rsa",
    "cat $HOME/.ssh/id_rsa",
    "cat ${HOME}/.ssh/id_rsa",
    `cat ${HOME}/.kube/config`,
    "head ~/.netrc",
    "cat ~/.docker/config.json",
    "ssh -i ~/.ssh/key.pem host",
    "restic --password-file=~/.aws/credentials snapshots",
    "echo hi && cat ~/.gnupg/secring.gpg",
    "SECRETS_OK=0 cat ~/.ssh/id_rsa",
  ]) {
    assert.ok(bash(cmd), `expected block: ${cmd}`);
  }
});

test("secret paths: reason names the path and the escape hatch", () => {
  const reason = bash("cat ~/.ssh/id_rsa");
  assert.ok(reason?.includes("~/.ssh"));
  assert.ok(reason?.includes("SECRETS_OK=1"));
});

test("secret paths: non-matches pass", () => {
  for (const cmd of [
    "ssh host uptime",
    "cat ~/.ssherfoo",
    "cat ~/.aws-backup/notes",
    "ls ~/.config/ghost",
    'git commit -m "stop reading ~/.ssh in CI"',
    "cat /etc/ssh/sshd_config",
    "cat /tmp/.ssh/fake",
    "ls -la",
    "git status",
    "SECRETS_OK=1 cat ~/.ssh/known_hosts",
  ]) {
    assert.equal(bash(cmd), undefined, `expected pass: ${cmd}`);
  }
});

test("secret paths: bypass is scoped to its segment", () => {
  assert.ok(bash("SECRETS_OK=1 cat ~/.ssh/a && cat ~/.ssh/b"));
});

test("unparseable commands fall back to home-anchored regex", () => {
  assert.ok(bash("cat ~/.ssh/id_rsa 'unclosed"));
  assert.equal(bash("echo 'unclosed oops"), undefined);
  assert.equal(bash("SECRETS_OK=1 cat ~/.ssh/x 'unclosed"), undefined);
});

test("rm -rf is blocked, plain rm passes", () => {
  assert.ok(bash("rm -rf build"));
  assert.ok(bash("rm -fr build"));
  assert.ok(bash("rm -r -f build"));
  assert.equal(bash("rm -f file.txt"), undefined);
  assert.equal(bash("rm -r directory"), undefined);
  // quoted mention in a message is not an rm segment
  assert.equal(bash('git commit -m "removed rm -rf usage"'), undefined);
});

test("git add sweeps are blocked, explicit paths pass", () => {
  assert.ok(bash("git add -A"));
  assert.ok(bash("git add --all"));
  assert.ok(bash("git add ."));
  assert.ok(bash("git add -A && git commit -m x"));
  assert.equal(bash("git add file.txt"), undefined);
  assert.equal(bash("git add src/"), undefined);
});

test("supply-chain bypass flags are blocked for package tools only", () => {
  assert.ok(bash("pnpm install --ignore-scripts=false"));
  assert.ok(bash("npm install --no-ignore-scripts"));
  assert.ok(bash("bun install --minimum-release-age=0"));
  assert.ok(bash("mise upgrade --before 0d"));
  assert.ok(bash("bun pm trust left-pad"));
  assert.ok(bash("deno install --allow-scripts"));
  assert.ok(bash("NPM_CONFIG_IGNORE_SCRIPTS=false npm install"));
  assert.equal(bash('echo "--ignore-scripts=false"'), undefined);
  assert.equal(bash("pnpm install"), undefined);
  assert.equal(bash("mise upgrade --before 4d"), undefined);
});

test("file tools: secret paths blocked, others pass", () => {
  assert.ok(blockReason("read", { path: `${HOME}/.ssh/id_rsa` }, HOME));
  assert.ok(blockReason("grep", { path: ".aws" }, HOME));
  assert.ok(blockReason("ls", { path: "~/.gnupg" }, HOME));
  assert.ok(blockReason("edit", { path: `${HOME}/.zshrc.local` }, HOME));
  assert.ok(blockReason("write", { path: ".config/gh-gate/token" }, HOME));
  assert.equal(blockReason("read", { path: "README.md" }, HOME), undefined);
  assert.equal(blockReason("read", { path: "/etc/hosts" }, HOME), undefined);
  // absent path = cwd default, never a secret
  assert.equal(blockReason("grep", { pattern: "foo" }, HOME), undefined);
});

test("unknown tools pass through", () => {
  assert.equal(blockReason("fetch", { url: "https://x" }, HOME), undefined);
});

test("tokenise handles quoting and separators", () => {
  assert.deepEqual(tokenise('echo "a && b"'), ["echo", "a && b"]);
  assert.deepEqual(tokenise("a && b"), ["a", "&&", "b"]);
  assert.equal(tokenise("echo 'unclosed"), undefined);
});

test("matchedSecret is component-aware", () => {
  assert.equal(matchedSecret("~/.ssh/id_rsa", HOME), ".ssh");
  assert.equal(matchedSecret("~/.ssherfoo", HOME), undefined);
  assert.equal(matchedSecret("/other/home/.ssh", HOME), undefined);
});

test("SECRET_PATHS has the srt denyRead cardinality", () => {
  // Full parity with srt base.json is enforced by the secret-path-parity hk
  // step; this catches accidental local edits.
  assert.equal(SECRET_PATHS.length, 17);
});
