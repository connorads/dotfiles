import { expect, test } from "bun:test";
import { parseArgs } from "./args.ts";

const run = (argv: string[]) => {
  const r = parseArgs(argv);
  if (!r.ok || r.value.kind !== "run") throw new Error(JSON.stringify(r));
  return r.value.options;
};

test("defaults: auto target, caller's default reviewer, format by TTY", () => {
  expect(run([])).toEqual({
    target: { kind: "auto" },
    reviewers: null,
    rubric: null,
    focus: null,
    model: null,
    effort: null,
    format: null,
  });
});

test("both --flag value and --flag=value", () => {
  const o = run(["--target", "commit:abc", "--focus=auth paths", "--md"]);
  expect(o.target).toEqual({ kind: "commit", sha: "abc" });
  expect(o.focus).toBe("auth paths");
  expect(o.format).toBe("md");
});

test("branch base is optional", () => {
  expect(run(["--target", "branch"]).target).toEqual({ kind: "branch", base: null });
  expect(run(["--target", "branch:origin/dev"]).target).toEqual({ kind: "branch", base: "origin/dev" });
});

test("--help wins", () => {
  expect(parseArgs(["--target", "auto", "-h"])).toEqual({ ok: true, value: { kind: "help" } });
});

test.each([
  [["--bogus"], "unknown argument"],
  [["extra"], "unknown argument"],
  [["--target"], "needs a value"],
  [["--target", "main"], "unknown --target"],
  [["--target", "commit"], "needs a sha"],
  [["--target", "uncommitted:x"], "takes no argument"],
  [["--reviewer", "gemini"], "unknown reviewer"],
  [["--reviewer", "codex,codex"], "twice"],
  [["--json", "--md"], "exclusive"],
  [["--focus", "a", "--focus", "b"], "given twice"],
])("%p is a usage error", (argv, message) => {
  const r = parseArgs(argv);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain(message);
});
