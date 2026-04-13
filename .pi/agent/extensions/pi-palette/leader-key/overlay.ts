/**
 * Leader Key Overlay
 *
 * Chord navigation overlay using ctx.ui.custom().
 * Root view shows top-level entries; pressing a group key
 * drills into the group; pressing an action key executes.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { matchesKey, parseKey, Key } from "@mariozechner/pi-tui";
import { OverlayFrame } from "../shared/frame.js";
import { buildEntries } from "./entries.js";
import type { ActionItem, ActionGroup, TopLevelEntry } from "./types.js";

// ── View state ─────────────────────────────────────

type View = { type: "root" } | { type: "group"; group: ActionGroup };

class LeaderKeyOverlay {
  private view: View = { type: "root" };
  private entries: TopLevelEntry[];
  private theme: Theme;
  private done: (result: ActionItem | null) => void;
  private highlightedIndex = 0;

  constructor(
    entries: TopLevelEntry[],
    theme: Theme,
    done: (result: ActionItem | null) => void,
  ) {
    this.entries = entries;
    this.theme = theme;
    this.done = done;
  }

  private get currentItems(): Array<{
    key: string;
    label: string;
    description?: string;
  }> {
    if (this.view.type === "root") {
      return this.entries.map((e) => {
        if (e.type === "group") {
          return {
            key: e.group.key,
            label: e.group.label,
            description: `${e.group.items.length} action${e.group.items.length !== 1 ? "s" : ""}`,
          };
        }
        return { key: e.key, label: e.label, description: e.description };
      });
    }
    return this.view.group.items.map((i) => ({
      key: i.key,
      label: i.label,
      description: i.description,
    }));
  }

  handleInput(data: string): void {
    // Escape / Ctrl+C
    if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
      if (this.view.type === "group") {
        this.view = { type: "root" };
        this.highlightedIndex = 0;
      } else {
        this.done(null);
      }
      return;
    }

    // Backspace
    if (matchesKey(data, "backspace")) {
      if (this.view.type === "group") {
        this.view = { type: "root" };
        this.highlightedIndex = 0;
      } else {
        this.done(null);
      }
      return;
    }

    // Arrow navigation
    if (matchesKey(data, "up")) {
      this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.highlightedIndex = Math.min(
        this.currentItems.length - 1,
        this.highlightedIndex + 1,
      );
      return;
    }

    // Enter to select highlighted
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const items = this.currentItems;
      if (
        this.highlightedIndex >= 0 &&
        this.highlightedIndex < items.length
      ) {
        const item = items[this.highlightedIndex]!;
        if (this.view.type === "root") {
          this.handleRootSelection(item.key);
        } else {
          const action = this.view.group.items.find(
            (a) => a.key === item.key,
          );
          if (action) this.done(action as ActionItem);
        }
      }
      return;
    }

    // Direct key press — use parseKey for Kitty protocol
    const parsed = parseKey(data);
    if (parsed && parsed.length === 1 && parsed >= "a" && parsed <= "z") {
      this.handleKeyPress(parsed.toLowerCase());
    } else if (data.length === 1 && data >= " " && data <= "~") {
      this.handleKeyPress(data.toLowerCase());
    }
  }

  private handleKeyPress(key: string): void {
    if (this.view.type === "root") {
      this.handleRootSelection(key);
    } else {
      const action = this.view.group.items.find((a) => a.key === key);
      if (action) this.done(action as ActionItem);
    }
  }

  private handleRootSelection(key: string): void {
    const entry = this.entries.find((e) => {
      if (e.type === "group") return e.group.key === key;
      return e.key === key;
    });
    if (!entry) return;

    if (entry.type === "group") {
      this.view = { type: "group", group: entry.group };
      this.highlightedIndex = 0;
    } else {
      this.done({
        key: entry.key,
        label: entry.label,
        description: entry.description,
        action: entry.action,
      });
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const f = new OverlayFrame(width, th);
    const lines: string[] = [];

    lines.push(f.top());

    if (this.view.type === "root") {
      lines.push(f.row(th.fg("accent", th.bold("Leader Key"))));
    } else {
      const breadcrumb =
        th.fg("dim", "< ") + th.fg("accent", th.bold(this.view.group.label));
      lines.push(f.row(breadcrumb));
    }

    lines.push(f.separator());

    const items = this.currentItems;
    if (items.length === 0) {
      lines.push(f.row(th.fg("dim", "  (no items)")));
    } else {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const isHighlighted = i === this.highlightedIndex;

        const keyBadge = th.fg("warning", th.bold(`[${item.key}]`));
        const label = isHighlighted
          ? th.fg("accent", th.bold(item.label))
          : th.fg("text", item.label);

        // Chevron for groups in root view
        let suffix = "";
        if (this.view.type === "root") {
          const entry = this.entries.find((e) => {
            if (e.type === "group") return e.group.key === item.key;
            return e.key === item.key;
          });
          if (entry?.type === "group") {
            suffix = " " + th.fg("dim", ">");
          }
        }

        let line = `${isHighlighted ? "> " : "  "}${keyBadge} ${label}${suffix}`;
        if (item.description) {
          line += "  " + th.fg("dim", item.description);
        }

        lines.push(f.rowTruncated(line));
      }
    }

    lines.push(f.separator());

    if (this.view.type === "root") {
      lines.push(f.row(th.fg("dim", "press key to select | esc close")));
    } else {
      lines.push(
        f.row(th.fg("dim", "press key to run | bksp back | esc close")),
      );
    }

    lines.push(f.bottom());
    return lines;
  }

  invalidate(): void {}
}

// ── Public API ─────────────────────────────────────

export async function openLeaderKey(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.hasUI) return;

  const commands = pi.getCommands();
  const currentModel = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}`
    : "";
  const thinkingLevel = pi.getThinkingLevel();

  const entries = buildEntries(commands, currentModel, thinkingLevel, {
    setThinkingLevel: (level) => pi.setThinkingLevel(level as any),
  });

  const selected = await ctx.ui.custom<ActionItem | null>(
    (tui, theme, _kb, done) => {
      const overlay = new LeaderKeyOverlay(entries, theme, done);
      return {
        render: (w: number) => overlay.render(w),
        invalidate: () => overlay.invalidate(),
        handleInput: (data: string) => {
          overlay.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 80,
        minWidth: 50,
        maxHeight: "80%",
      },
    },
  );

  if (selected) {
    try {
      await selected.action(ctx);
    } catch (err) {
      ctx.ui.notify(`Action failed: ${err}`, "error");
    }
  }
}
