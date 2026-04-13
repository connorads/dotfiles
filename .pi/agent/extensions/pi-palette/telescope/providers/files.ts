/**
 * Files Provider
 *
 * Lists workspace files using fd (fast) with fallback to find.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../../shared/clipboard.js";

function hasBinary(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const useFd = hasBinary("fd");

function listFiles(cwd: string): string[] {
  try {
    const cmd = useFd
      ? "fd --type f --hidden --follow --exclude .git --exclude node_modules --exclude .venv --exclude dist --exclude build --max-results 10000"
      : "find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/build/*' | head -10000";

    const output = execSync(cmd, {
      encoding: "utf-8",
      cwd,
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
    return output
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        if (l.startsWith(prefix)) return l.slice(prefix.length);
        if (l.startsWith("./")) return l.slice(2);
        return l;
      })
      .sort();
  } catch {
    return [];
  }
}

export function createFilesProvider(cwd: string): TelescopeProvider<string> {
  return {
    name: "files",
    icon: "📄",
    description: "Workspace files",

    load() {
      return listFiles(cwd);
    },

    searchText(item) {
      return item;
    },

    displayText(item, _theme, highlighted) {
      return highlighted ?? item;
    },

    async onSelect(item, ctx) {
      ctx.ui.pasteToEditor(resolve(cwd, item));
    },

    async onMultiSelect(items, ctx) {
      ctx.ui.pasteToEditor(items.map((i) => resolve(cwd, i)).join(" "));
    },

    frecencyKey(item) {
      return item;
    },

    actions: [
      { key: "c", label: "Copy path", description: "Copy file path to clipboard" },
      { key: "i", label: "Insert content", description: "Paste file content into editor" },
    ],

    async onAction(actionKey, items, ctx) {
      if (actionKey === "c") {
        copyToClipboard(items.map((i) => resolve(cwd, i)).join("\n"));
      } else if (actionKey === "i") {
        const { readFileSync } = await import("node:fs");
        for (const item of items) {
          try {
            const content = readFileSync(resolve(cwd, item), "utf-8");
            ctx.ui.pasteToEditor(content);
          } catch {}
        }
      }
    },
  };
}
