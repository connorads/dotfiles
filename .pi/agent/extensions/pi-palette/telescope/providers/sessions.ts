/**
 * Sessions Provider
 *
 * Browse and resume pi agent sessions.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../../shared/clipboard.js";

const SESSION_BASE = join(process.env.HOME ?? "~", ".pi/agent/sessions");

interface SessionInfo {
  path: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  modified: Date;
  messageCount: number;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

const sessionCache = new Map<string, { meta: SessionInfo; mtime: number }>();

function parseSession(filePath: string): SessionInfo | null {
  try {
    const stat = statSync(filePath);
    const cached = sessionCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) return cached.meta;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let cwd = "";
    let name: string | undefined;
    let firstMessage = "";
    let messageCount = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session") cwd = entry.cwd ?? "";
        if (entry.type === "session_info" && entry.name) name = entry.name;
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          if (msg.role === "user" || msg.role === "assistant") messageCount++;
          if (msg.role === "user" && !firstMessage) {
            if (typeof msg.content === "string") {
              firstMessage = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textBlock = msg.content.find(
                (b: { type: string }) => b.type === "text",
              );
              if (textBlock) firstMessage = textBlock.text;
            }
          }
        }
      } catch {}
    }

    const meta: SessionInfo = {
      path: filePath,
      cwd,
      name,
      firstMessage: firstMessage.split("\n")[0]?.trim() ?? "(empty)",
      modified: stat.mtime,
      messageCount,
    };

    sessionCache.set(filePath, { meta, mtime: stat.mtimeMs });
    return meta;
  } catch {
    return null;
  }
}

function findSessions(): SessionInfo[] {
  if (!existsSync(SESSION_BASE)) return [];

  const results: SessionInfo[] = [];
  try {
    for (const dir of readdirSync(SESSION_BASE)) {
      const dirPath = join(SESSION_BASE, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        for (const file of readdirSync(dirPath)) {
          if (!file.endsWith(".jsonl")) continue;
          const meta = parseSession(join(dirPath, file));
          if (meta && meta.messageCount > 0) results.push(meta);
        }
      } catch {}
    }
  } catch {}

  results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return results;
}

export function createSessionsProvider(): TelescopeProvider<SessionInfo> {
  return {
    name: "sessions",
    icon: "💬",
    description: "Pi sessions",

    load() {
      return findSessions();
    },

    searchText(item) {
      const label = item.name ?? item.firstMessage;
      return `${label} ${item.cwd}`;
    },

    displayText(item, theme) {
      const label = item.name ?? item.firstMessage;
      const truncated =
        label.length > 50 ? label.slice(0, 49) + "…" : label;
      const cwdShort = item.cwd.replace(process.env.HOME ?? "~", "~");
      const time = theme.fg("dim", relativeTime(item.modified));
      const msgs = theme.fg("dim", `${item.messageCount}msg`);
      return `${truncated}  ${time} ${msgs}`;
    },

    async onSelect(item, ctx) {
      ctx.ui.setEditorText(`/resume ${item.path}`);
      setTimeout(() => process.stdin.emit("data", "\r"), 0);
    },

    preview(item, maxLines) {
      return [
        `Session: ${item.name ?? "(unnamed)"}`,
        `CWD: ${item.cwd}`,
        `Messages: ${item.messageCount}`,
        `Modified: ${item.modified.toLocaleString()}`,
        "",
        `First message: ${item.firstMessage}`,
      ].slice(0, maxLines);
    },

    frecencyKey(item) {
      return item.path;
    },

    actions: [
      {
        key: "c",
        label: "Copy path",
        description: "Copy session file path",
      },
    ],

    onAction(actionKey, items) {
      if (actionKey === "c") {
        copyToClipboard(items.map((i) => i.path).join("\n"));
      }
    },
  };
}
