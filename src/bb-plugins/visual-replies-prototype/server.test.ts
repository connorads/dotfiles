import { describe, it, expect } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readVisual, saveVisual } from "./server";

describe("HTML storage boundary", () => {
  it("stores on the thread host and returns a directive", async () => {
    const files = new Map<string, string>();
    const writes: Parameters<BbPluginApi["sdk"]["files"]["write"]>[0][] = [];
    const sdk = {
      threads: { storageLocation: async () => ({ hostId: "remote-thread-host", storageRootPath: "/thread-storage/t1" }) },
      files: {
        write: async (args: Parameters<BbPluginApi["sdk"]["files"]["write"]>[0]) => {
          writes.push(args); files.set(args.path, args.content);
          return { outcome: "written" as const, sha256: "test", sizeBytes: args.content.length };
        },
        read: async (args: Parameters<BbPluginApi["sdk"]["files"]["read"]>[0]) => {
          const content = files.get(args.path);
          if (content === undefined) throw new Error("Missing file");
          return { path: args.path, content, contentEncoding: "utf8" as const, sha256: "test", sizeBytes: content.length };
        },
      },
    };
    const stored = await saveVisual(sdk, "t1", { html: "<p>Hello</p>", title: "Example" });
    expect(stored.directive).toBe(`::visual-reply{id="${stored.id}"}`);
    expect(stored.path).toBe(`/thread-storage/t1/visual-replies/${stored.id}.html`);
    expect(files.get(stored.path)).toBe("<p>Hello</p>");
    expect(await readVisual(sdk, "t1", stored.id)).toEqual({ html: "<p>Hello</p>", title: "Example" });
    expect(writes).toHaveLength(2);
    for (const write of writes) expect(write).toMatchObject({ hostId: "remote-thread-host", rootPath: "/thread-storage/t1", expectedSha256: null });
    await expect(saveVisual(sdk, "t1", { html: "", title: "Example" })).rejects.toThrow();
    await expect(readVisual(sdk, "t1", "../../workspace")).rejects.toThrow();
    expect(writes).toHaveLength(2);
  });
  it("reports a storage conflict instead of returning a broken directive", async () => {
    const sdk = {
      threads: { storageLocation: async () => ({ hostId: "h", storageRootPath: "/thread/t1" }) },
      files: {
        write: async () => ({ outcome: "conflict" as const, currentSha256: "existing" }),
        read: async () => { throw new Error("Unexpected read"); },
      },
    };
    await expect(saveVisual(sdk, "t1", { html: "<p>Example</p>", title: "Example" })).rejects.toThrow("Visual storage conflict");
  });
});
