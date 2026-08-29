import { describe, expect, test } from "bun:test";
import { deliverable, describeProblem, MAX_DRAFT_BYTES, readyToSend } from "./draft.ts";
import { DRAFT_PREAMBLE } from "./render.ts";

describe("deliverable", () => {
  test("strips the editing preamble - it addresses the reader, not the agent", () => {
    const markdown = `${DRAFT_PREAMBLE}\n\n## 1 · codex\n\nbody`;
    expect(deliverable(markdown)).toBe("## 1 · codex\n\nbody");
  });

  test("leaves a draft that never had one alone", () => {
    expect(deliverable("just the body")).toBe("just the body");
  });
});

describe("readyToSend", () => {
  test("returns the body without the preamble", () => {
    const ready = readyToSend(`${DRAFT_PREAMBLE}\n\nreal content`);
    expect(ready.ok && ready.value).toBe("real content");
  });

  // Deleting every section is how you change your mind in the editor, so it
  // has to be a clean cancel rather than a blank prompt at an agent.
  test("a draft that is only the preamble is empty", () => {
    const ready = readyToSend(`${DRAFT_PREAMBLE}\n\n   \n`);
    expect(ready.ok).toBe(false);
    if (!ready.ok) expect(ready.error.kind).toBe("empty");
  });

  test("whitespace-only is empty", () => {
    const ready = readyToSend("  \n\t\n");
    expect(ready.ok).toBe(false);
  });

  test("refuses a draft over the cap, and points somewhere useful", () => {
    const ready = readyToSend("x".repeat(MAX_DRAFT_BYTES + 1));
    expect(ready.ok).toBe(false);
    if (!ready.ok) {
      expect(ready.error.kind).toBe("tooLarge");
      expect(describeProblem(ready.error)).toContain("annotate render > review.md");
    }
  });

  test("a draft exactly at the cap still sends", () => {
    expect(readyToSend("x".repeat(MAX_DRAFT_BYTES)).ok).toBe(true);
  });
});
