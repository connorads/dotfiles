import { expect, test } from "bun:test";
import { hunkLines, reviewPayload } from "./pr-comments.ts";
import { DEFAULT_SPECS, type Finding, type Review } from "./types.ts";

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 one
-two
+TWO
+three
 four
@@ -20,2 +21,2 @@ fn
 x
+y
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

test("hunk lines are the new-side context and added lines, per hunk", () => {
  const lines = hunkLines(DIFF);
  expect([...(lines.get("a.ts") ?? [])]).toEqual([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [21, 1],
    [22, 1],
  ]);
  expect(lines.has("gone.ts")).toBe(false);
});

const finding = (over: Partial<Finding>): Finding => ({
  severity: "high",
  title: "T",
  body: "B",
  recommendation: "R",
  file: "a.ts",
  line_start: 2,
  line_end: 3,
  confidence: 0.9,
  reviewers: ["codex"],
  ...over,
});

const review = (findings: Finding[]): Review => ({
  verdict: "needs-attention",
  summary: "No ship.",
  findings,
  next_steps: [],
  target: { kind: "pr", number: 7, head_sha: "abc" },
  reviewers: [DEFAULT_SPECS.codex],
  errors: [],
});

test("a range inside one hunk becomes a multi-line comment", () => {
  const p = reviewPayload(review([finding({})]), "abc", DIFF);
  expect(p.commit_id).toBe("abc");
  expect(p.comments).toEqual([
    {
      path: "a.ts",
      line: 3,
      side: "RIGHT",
      start_line: 2,
      start_side: "RIGHT",
      body: "**[high] T** (confidence 0.9 · codex)\n\nB\n\n**Recommendation.** R",
    },
  ]);
});

test("a range spanning hunks anchors on its last line only", () => {
  const [c] = reviewPayload(review([finding({ line_start: 3, line_end: 21 })]), "abc", DIFF).comments;
  expect(c?.line).toBe(21);
  expect(c?.start_line).toBeUndefined();
});

test("findings outside the diff, in other files or unlocated go in the body", () => {
  const p = reviewPayload(
    review([
      finding({ line_start: 10, line_end: 10 }),
      finding({ file: "other.ts" }),
      finding({ file: null, line_start: null, line_end: null }),
    ]),
    "abc",
    DIFF,
  );
  expect(p.comments).toEqual([]);
  expect(p.body).toContain("### Findings outside the diff");
  expect(p.body).toContain("#### a.ts:10");
  expect(p.body).toContain("#### other.ts:2-3");
  expect(p.body).toContain("#### (no location)");
});

test("the payload carries no event, so GitHub creates it pending", () => {
  expect(Object.keys(reviewPayload(review([]), "abc", DIFF))).toEqual(["commit_id", "body", "comments"]);
});
