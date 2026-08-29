import { describe, expect, test } from "bun:test";
import {
  countLines,
  ellipsise,
  fenceFor,
  fingerprint,
  firstLine,
  longestBacktickRun,
  MIN_FENCE,
} from "./text.ts";

describe("countLines", () => {
  test("a trailing newline terminates the last line rather than starting one", () => {
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });

  test("empty text has no lines", () => {
    expect(countLines("")).toBe(0);
  });

  test("a lone newline is one line", () => {
    expect(countLines("\n")).toBe(1);
  });
});

describe("longestBacktickRun", () => {
  test("counts the longest consecutive run, not the total", () => {
    expect(longestBacktickRun("a `b` c ``d`` e")).toBe(2);
    expect(longestBacktickRun("````")).toBe(4);
    expect(longestBacktickRun("no ticks here")).toBe(0);
  });
});

describe("fenceFor", () => {
  test("never shorter than three", () => {
    expect(fenceFor("plain")).toBe("```");
    expect(fenceFor("one ` tick")).toBe("```");
  });

  test("always longer than the longest run inside the text", () => {
    expect(fenceFor("a ``` b")).toBe("````");
    expect(fenceFor("a ````` b")).toBe("``````");
  });

  // The property the whole render rests on: whatever the excerpt holds, the
  // fence closes the block rather than being closed by it.
  test("property: the fence outlasts any backtick run in the text", () => {
    const samples = [
      "",
      "`",
      "``",
      "```",
      "``````````",
      "text ``` more ````` end",
      "```\nnested\n```",
      "`".repeat(64),
    ];
    for (const sample of samples) {
      const fence = fenceFor(sample);
      expect(fence.length).toBeGreaterThan(longestBacktickRun(sample));
      expect(fence.length).toBeGreaterThanOrEqual(MIN_FENCE);
      expect(fence).toMatch(/^`+$/);
    }
  });

  test("property: randomised backtick soup never produces a closable fence", () => {
    const alphabet = ["`", "a", "\n", " "];
    for (let seed = 0; seed < 200; seed += 1) {
      let text = "";
      let x = seed * 2654435761;
      for (let i = 0; i < 40; i += 1) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        text += alphabet[x % alphabet.length] as string;
      }
      expect(fenceFor(text).length).toBeGreaterThan(longestBacktickRun(text));
    }
  });
});

describe("fingerprint", () => {
  test("records size, shape and both edges", () => {
    const print = fingerprint("hello\nworld\n");
    expect(print.bytes).toBe(12);
    expect(print.lines).toBe(2);
    expect(print.head).toBe("hello\nworld\n");
    expect(print.tail).toBe("hello\nworld\n");
    expect(print.sha256).toHaveLength(64);
  });

  test("counts bytes, not characters", () => {
    expect(fingerprint("é").bytes).toBe(2);
  });

  test("head and tail are capped at 80 characters each", () => {
    const long = "x".repeat(200);
    const print = fingerprint(long);
    expect(print.head).toHaveLength(80);
    expect(print.tail).toHaveLength(80);
  });

  test("the same text always fingerprints the same", () => {
    expect(fingerprint("stable").sha256).toBe(fingerprint("stable").sha256);
    expect(fingerprint("stable").sha256).not.toBe(fingerprint("other").sha256);
  });
});

describe("firstLine", () => {
  test("skips leading blank lines", () => {
    expect(firstLine("\n\n  real content  \nmore")).toBe("real content");
  });

  test("all-blank text has no first line", () => {
    expect(firstLine("\n  \n")).toBe("");
  });
});

describe("ellipsise", () => {
  test("leaves short text alone", () => {
    expect(ellipsise("short", 10)).toBe("short");
  });

  test("marks the cut and respects the width", () => {
    expect(ellipsise("abcdefghij", 5)).toBe("abcd…");
    expect(ellipsise("abcdefghij", 5)).toHaveLength(5);
  });
});
