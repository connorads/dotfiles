/**
 * Telescope Overlay (Imperative Shell)
 *
 * Wires the pure state machine to pi-tui's custom overlay API.
 * Handles: rendering, keyboard input mapping, data loading,
 * frecency recording, provider switching, and preview.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import {
  matchesKey,
  Key,
  visibleWidth,
  truncateToWidth,
} from "@mariozechner/pi-tui";
import type {
  TelescopeProvider,
  ScoredItem,
  TelescopeOptions,
} from "./types.js";
import { filterAndScore } from "./scoring.js";
import { recordAndPersist, loadFrecencyMap } from "./frecency.js";
import { copyToClipboard } from "../shared/clipboard.js";

// ── Types ──────────────────────────────────────────

type Mode = "search" | "provider-picker" | "help" | "action-picker";

interface ModeEntry {
  key: string;
  label: string;
  description: string;
  icon?: string;
}

interface OverlayState {
  query: string;
  cursorPos: number;
  allItems: unknown[];
  filtered: ScoredItem[];
  selectedIndex: number;
  scrollOffset: number;
  previewScrollOffset: number;
  previewLines: string[];
  loading: boolean;
  selectedKeys: Set<string>;
  showPreview: boolean;
  mode: Mode;
  modeEntries: ModeEntry[];
  modeFiltered: ModeEntry[];
  modeSelectedIndex: number;
  modeScrollOffset: number;
  modeQuery: string;
  modeCursorPos: number;
  savedQuery: string;
  savedCursorPos: number;
  flashMessage: string;
  flashTimer: ReturnType<typeof setTimeout> | null;
}

// ── Help entries ───────────────────────────────────

const HELP_ENTRIES: ModeEntry[] = [
  { key: "↑/↓", label: "Navigate", description: "Move through results" },
  { key: "^J/K", label: "Navigate", description: "Vim-style up/down" },
  { key: "Enter", label: "Confirm", description: "Select item(s)" },
  { key: "Esc", label: "Close", description: "Close telescope / exit mode" },
  { key: "Tab", label: "Multi-select", description: "Toggle item selection" },
  { key: "^R", label: "Switch provider", description: "Change data source" },
  { key: "^O", label: "Toggle preview", description: "Show/hide preview panel" },
  { key: "^G", label: "Help", description: "Show this help screen" },
  { key: "^Y", label: "Copy", description: "Copy item to clipboard" },
  { key: "^E", label: "Actions", description: "Provider-specific actions" },
  { key: "^U/D", label: "Page up/down", description: "Jump 10 items" },
  { key: "^P/N", label: "Preview scroll", description: "Scroll preview up/down" },
  { key: "^W", label: "Delete word", description: "Delete word backwards" },
  { key: "", label: "─── Patterns ───", description: "" },
  { key: "'term", label: "Exact", description: "Exact substring match" },
  { key: "^term", label: "Prefix", description: "Prefix match" },
  { key: "term$", label: "Suffix", description: "Suffix match" },
  { key: "!term", label: "Negate", description: "Exclude matches" },
];

// ── Drawing helpers ────────────────────────────────

function hLine(ch: string, len: number): string {
  return ch.repeat(Math.max(0, len));
}

function padRight(s: string, len: number): string {
  const vis = visibleWidth(s);
  return vis >= len ? s : s + " ".repeat(len - vis);
}

// ── Main ───────────────────────────────────────────

export async function openTelescope(
  provider: TelescopeProvider,
  ctx: ExtensionContext,
  options?: TelescopeOptions,
): Promise<void> {
  let tuiRef: { requestRender(): void } | undefined;
  let actionToRun: (() => Promise<void>) | null = null;

  await ctx.ui.custom<null>((tui, theme, _kb, done) => {
    tuiRef = tui;
    let currentProvider: TelescopeProvider = provider;

    const state: OverlayState = {
      query: options?.initialQuery ?? "",
      cursorPos: options?.initialQuery?.length ?? 0,
      allItems: [],
      filtered: [],
      selectedIndex: 0,
      scrollOffset: 0,
      previewScrollOffset: 0,
      previewLines: [],
      loading: true,
      selectedKeys: new Set(),
      showPreview: true,
      mode: "search",
      modeEntries: [],
      modeFiltered: [],
      modeSelectedIndex: 0,
      modeScrollOffset: 0,
      modeQuery: "",
      modeCursorPos: 0,
      savedQuery: "",
      savedCursorPos: 0,
      flashMessage: "",
      flashTimer: null,
    };

    let dynamicTimer: ReturnType<typeof setTimeout> | null = null;
    let frecencyMap: Map<string, number> = new Map();

    // ── Flash message ────────────────────────────

    const flash = (msg: string) => {
      state.flashMessage = msg;
      if (state.flashTimer) clearTimeout(state.flashTimer);
      state.flashTimer = setTimeout(() => {
        state.flashMessage = "";
        tui.requestRender();
      }, 1500);
      tui.requestRender();
    };

    // ── Data loading ─────────────────────────────

    const loadItems = async () => {
      try {
        frecencyMap = loadFrecencyMap(currentProvider.name);
        state.allItems = await currentProvider.load(ctx.cwd);
        state.filtered = filterAndScore(
          state.allItems,
          state.query,
          (item) => currentProvider.searchText(item),
          5000,
          frecencyMap,
          currentProvider.frecencyKey?.bind(currentProvider),
        );
        state.loading = false;
        state.selectedIndex = 0;
        state.scrollOffset = 0;
        updatePreview();
        tui.requestRender();
      } catch {
        state.loading = false;
        tui.requestRender();
      }
    };

    const applyFilter = () => {
      if (currentProvider.supportsDynamicSearch && currentProvider.search) {
        if (dynamicTimer) clearTimeout(dynamicTimer);
        dynamicTimer = setTimeout(async () => {
          if (state.query.length >= 1) {
            state.loading = true;
            tui.requestRender();
            try {
              const results = await currentProvider.search!(state.query, ctx.cwd);
              state.allItems = results;
              state.filtered = results.map((item) => ({
                item,
                score: 0,
                indices: [],
              }));
            } catch {}
            state.loading = false;
          } else {
            state.filtered = [];
          }
          state.selectedIndex = 0;
          state.scrollOffset = 0;
          updatePreview();
          tui.requestRender();
        }, 150);
        return;
      }

      state.filtered = filterAndScore(
        state.allItems,
        state.query,
        (item) => currentProvider.searchText(item),
        5000,
        frecencyMap,
        currentProvider.frecencyKey?.bind(currentProvider),
      );
      state.selectedIndex = 0;
      state.scrollOffset = 0;
      updatePreview();
    };

    const updatePreview = () => {
      state.previewScrollOffset = 0;
      const scored = state.filtered[state.selectedIndex];
      if (!scored || !currentProvider.preview) {
        state.previewLines = [];
        return;
      }
      try {
        const result = currentProvider.preview(scored.item, 100, theme);
        if (result && Array.isArray(result)) {
          state.previewLines = result as string[];
        } else {
          state.previewLines = [];
        }
      } catch {
        state.previewLines = [theme.fg("dim", "(preview error)")];
      }
    };

    // ── Mode helpers ─────────────────────────────

    const enterMode = (mode: Mode, entries: ModeEntry[]) => {
      state.savedQuery = state.query;
      state.savedCursorPos = state.cursorPos;
      state.mode = mode;
      state.modeEntries = entries;
      state.modeFiltered = entries;
      state.modeSelectedIndex = 0;
      state.modeScrollOffset = 0;
      state.modeQuery = "";
      state.modeCursorPos = 0;
    };

    const exitMode = () => {
      state.mode = "search";
      state.query = state.savedQuery;
      state.cursorPos = state.savedCursorPos;
    };

    const filterModeEntries = () => {
      if (!state.modeQuery) {
        state.modeFiltered = state.modeEntries;
      } else {
        const lq = state.modeQuery.toLowerCase();
        state.modeFiltered = state.modeEntries.filter(
          (e) =>
            e.label.toLowerCase().includes(lq) ||
            e.description.toLowerCase().includes(lq) ||
            e.key.toLowerCase().includes(lq),
        );
      }
      state.modeSelectedIndex = 0;
      state.modeScrollOffset = 0;
    };

    const switchProvider = (name: string) => {
      const factory = options?.allProviders?.[name];
      if (!factory) return;
      currentProvider = factory();
      state.query = "";
      state.cursorPos = 0;
      state.allItems = [];
      state.filtered = [];
      state.selectedIndex = 0;
      state.scrollOffset = 0;
      state.selectedKeys.clear();
      state.previewLines = [];
      state.loading = true;
      exitMode();
      if (!currentProvider.supportsDynamicSearch) {
        loadItems();
      } else {
        state.loading = false;
        tui.requestRender();
      }
    };

    // ── Selection helpers ────────────────────────

    const getItemKey = (item: unknown): string => {
      return currentProvider.frecencyKey
        ? currentProvider.frecencyKey(item)
        : currentProvider.searchText(item);
    };

    const getSelectedItems = (): unknown[] => {
      if (state.selectedKeys.size > 0) {
        return state.filtered
          .filter((s) => state.selectedKeys.has(getItemKey(s.item)))
          .map((s) => s.item);
      }
      const scored = state.filtered[state.selectedIndex];
      return scored ? [scored.item] : [];
    };

    const getCurrentItem = (): unknown | undefined => {
      return state.filtered[state.selectedIndex]?.item;
    };

    // ── Input: mode overlay ──────────────────────

    const handleModeInput = (data: string): boolean => {
      if (state.mode === "search") return false;

      if (matchesKey(data, Key.escape)) {
        exitMode();
        tui.requestRender();
        return true;
      }

      if (state.mode === "help") {
        exitMode();
        tui.requestRender();
        return true;
      }

      if (matchesKey(data, Key.enter)) {
        const entry = state.modeFiltered[state.modeSelectedIndex];
        if (entry) {
          if (state.mode === "provider-picker") {
            switchProvider(entry.key);
            tui.requestRender();
          } else if (state.mode === "action-picker") {
            const items = getSelectedItems();
            const p = currentProvider;
            const ak = entry.key;
            actionToRun = async () => {
              if (p.onAction) await p.onAction(ak, items, ctx);
            };
            done(null);
          }
        }
        return true;
      }

      if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("k"))) {
        if (state.modeSelectedIndex > 0) state.modeSelectedIndex--;
        tui.requestRender();
        return true;
      }
      if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("j"))) {
        if (state.modeSelectedIndex < state.modeFiltered.length - 1)
          state.modeSelectedIndex++;
        tui.requestRender();
        return true;
      }

      if (state.mode === "provider-picker" || state.mode === "action-picker") {
        if (matchesKey(data, Key.backspace)) {
          if (state.modeCursorPos > 0) {
            state.modeQuery =
              state.modeQuery.slice(0, state.modeCursorPos - 1) +
              state.modeQuery.slice(state.modeCursorPos);
            state.modeCursorPos--;
            filterModeEntries();
          }
          tui.requestRender();
          return true;
        }

        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          state.modeQuery =
            state.modeQuery.slice(0, state.modeCursorPos) +
            data +
            state.modeQuery.slice(state.modeCursorPos);
          state.modeCursorPos++;
          filterModeEntries();
          tui.requestRender();
          return true;
        }
      }

      return true;
    };

    // ── Input: main search ───────────────────────

    const handleInput = (data: string) => {
      if (handleModeInput(data)) return;

      if (matchesKey(data, Key.escape)) {
        done(null);
        return;
      }

      if (matchesKey(data, Key.enter)) {
        const items = getSelectedItems();
        if (items.length > 0) {
          const p = currentProvider;
          for (const item of items) {
            recordAndPersist(p.name, getItemKey(item));
          }
          actionToRun = async () => {
            if (items.length > 1 && p.onMultiSelect) {
              await p.onMultiSelect(items, ctx);
            } else if (items.length === 1) {
              await p.onSelect(items[0], ctx);
            } else {
              for (const item of items) await p.onSelect(item, ctx);
            }
          };
        }
        done(null);
        return;
      }

      if (matchesKey(data, Key.tab)) {
        const scored = state.filtered[state.selectedIndex];
        if (scored) {
          const key = getItemKey(scored.item);
          if (state.selectedKeys.has(key)) {
            state.selectedKeys.delete(key);
          } else {
            state.selectedKeys.add(key);
          }
          if (state.selectedIndex < state.filtered.length - 1) {
            state.selectedIndex++;
            updatePreview();
          }
        }
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.ctrl("r"))) {
        if (options?.allProviders) {
          const entries: ModeEntry[] = Object.entries(options.allProviders).map(
            ([name, factory]) => {
              const p = factory();
              return {
                key: name,
                label: p.name,
                description: p.description,
                icon: p.icon,
              };
            },
          );
          enterMode("provider-picker", entries);
          tui.requestRender();
        }
        return;
      }

      if (matchesKey(data, Key.ctrl("o"))) {
        state.showPreview = !state.showPreview;
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.ctrl("g"))) {
        enterMode("help", HELP_ENTRIES);
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.ctrl("y"))) {
        const item = getCurrentItem();
        if (item) {
          const text = currentProvider.searchText(item);
          flash(copyToClipboard(text) ? "Copied!" : "Copy failed");
        }
        return;
      }

      if (matchesKey(data, Key.ctrl("e"))) {
        const actions = currentProvider.actions;
        if (actions && actions.length > 0) {
          const entries: ModeEntry[] = actions.map((a) => ({
            key: a.key,
            label: a.label,
            description: a.description ?? "",
          }));
          enterMode("action-picker", entries);
          tui.requestRender();
        } else {
          flash("No actions");
        }
        return;
      }

      // Navigation
      if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("k"))) {
        if (state.selectedIndex > 0) {
          state.selectedIndex--;
          updatePreview();
        }
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("j"))) {
        if (state.selectedIndex < state.filtered.length - 1) {
          state.selectedIndex++;
          updatePreview();
        }
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.ctrl("p"))) {
        state.previewScrollOffset = Math.max(0, state.previewScrollOffset - 5);
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.ctrl("n"))) {
        state.previewScrollOffset += 5;
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.ctrl("u"))) {
        state.selectedIndex = Math.max(0, state.selectedIndex - 10);
        updatePreview();
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.ctrl("d"))) {
        state.selectedIndex = Math.min(
          state.filtered.length - 1,
          state.selectedIndex + 10,
        );
        updatePreview();
        tui.requestRender();
        return;
      }

      // Editing
      if (matchesKey(data, Key.backspace)) {
        if (state.cursorPos > 0) {
          state.query =
            state.query.slice(0, state.cursorPos - 1) +
            state.query.slice(state.cursorPos);
          state.cursorPos--;
          applyFilter();
        }
        tui.requestRender();
        return;
      }

      if (matchesKey(data, Key.ctrl("w"))) {
        const before = state.query.slice(0, state.cursorPos);
        const after = state.query.slice(state.cursorPos);
        const trimmed = before.replace(/\S+\s*$/, "");
        state.query = trimmed + after;
        state.cursorPos = trimmed.length;
        applyFilter();
        tui.requestRender();
        return;
      }

      // Printable character
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        state.query =
          state.query.slice(0, state.cursorPos) +
          data +
          state.query.slice(state.cursorPos);
        state.cursorPos++;
        applyFilter();
        tui.requestRender();
        return;
      }
    };

    // ── Render ───────────────────────────────────

    const render = (width: number): string[] => {
      const termHeight = process.stdout.rows ?? 24;
      const totalHeight = Math.min(Math.max(10, termHeight - 4), 40);
      const innerWidth = width - 2;

      const hasPreview =
        state.showPreview &&
        state.previewLines.length > 0 &&
        innerWidth > 60 &&
        state.mode === "search";
      const listWidth = hasPreview ? Math.floor(innerWidth * 0.45) : innerWidth;
      const previewWidth = hasPreview ? innerWidth - listWidth - 1 : 0;

      const headerHeight = 1;
      const inputHeight = 1;
      const listHeight = totalHeight - headerHeight - inputHeight - 2;

      // Ensure visibility
      if (state.mode === "search") {
        if (state.selectedIndex < state.scrollOffset)
          state.scrollOffset = state.selectedIndex;
        if (state.selectedIndex >= state.scrollOffset + listHeight)
          state.scrollOffset = state.selectedIndex - listHeight + 1;
      } else {
        if (state.modeSelectedIndex < state.modeScrollOffset)
          state.modeScrollOffset = state.modeSelectedIndex;
        if (state.modeSelectedIndex >= state.modeScrollOffset + listHeight)
          state.modeScrollOffset = state.modeSelectedIndex - listHeight + 1;
      }

      const th = theme;
      const lines: string[] = [];
      const bdr = (s: string) => th.fg("border", s);

      // ── Top border ──
      lines.push(bdr(`╭${hLine("─", innerWidth)}╮`));

      // ── Header ──
      let headerContent: string;
      if (state.mode === "provider-picker") {
        headerContent = th.fg("accent", th.bold("Switch Provider"));
      } else if (state.mode === "help") {
        headerContent = th.fg("accent", th.bold("Keybindings"));
      } else if (state.mode === "action-picker") {
        headerContent = `${th.fg("accent", th.bold("Actions"))}  ${th.fg("dim", currentProvider.name)}`;
      } else {
        const title = `${currentProvider.icon} ${currentProvider.name}`;
        const count = state.loading
          ? th.fg("dim", "loading…")
          : th.fg("dim", `${state.filtered.length}/${state.allItems.length}`);
        const multi =
          state.selectedKeys.size > 0
            ? th.fg("success", ` [${state.selectedKeys.size} sel]`)
            : "";
        const flashMsg = state.flashMessage
          ? "  " + th.fg("warning", state.flashMessage)
          : "";
        headerContent = `${th.fg("accent", th.bold(title))}  ${count}${multi}${flashMsg}`;
      }
      lines.push(
        bdr("│") +
          " " +
          padRight(headerContent, innerWidth - 2) +
          " " +
          bdr("│"),
      );

      // ── Separator (header -> list) ──
      if (hasPreview) {
        lines.push(
          bdr(`├${hLine("─", listWidth)}┬${hLine("─", previewWidth)}┤`),
        );
      } else {
        lines.push(bdr(`├${hLine("─", innerWidth)}┤`));
      }

      // ── List + Preview rows ──
      for (let row = 0; row < listHeight; row++) {
        let leftCell = "";

        if (state.mode !== "search") {
          const idx = state.modeScrollOffset + row;
          if (idx < state.modeFiltered.length) {
            const entry = state.modeFiltered[idx]!;
            const isSel = idx === state.modeSelectedIndex;
            const prefix = isSel ? th.fg("accent", "> ") : "  ";
            const icon = entry.icon ? entry.icon + " " : "";
            const keyBadge = entry.key
              ? th.fg("warning", `[${entry.key}]`) + " "
              : "";
            const label = isSel ? th.bold(entry.label) : entry.label;
            const desc = entry.description
              ? "  " + th.fg("dim", entry.description)
              : "";
            leftCell = `${prefix}${icon}${keyBadge}${label}${desc}`;
          }
        } else {
          const itemIdx = state.scrollOffset + row;
          if (itemIdx < state.filtered.length) {
            const scored = state.filtered[itemIdx]!;
            const isCursor = itemIdx === state.selectedIndex;
            const isMultiSel = state.selectedKeys.has(getItemKey(scored.item));

            const searchText = currentProvider.searchText(scored.item);
            const highlighted = highlightMatches(searchText, scored.indices, th);
            const displayText = currentProvider.displayText(
              scored.item,
              th,
              highlighted,
            );

            const cursor = isCursor ? th.fg("accent", ">") : " ";
            const check = isMultiSel ? th.fg("success", "●") : " ";
            const styledText = isCursor ? th.bold(displayText) : displayText;
            leftCell = `${cursor}${check} ${styledText}`;
          }
        }

        leftCell = " " + truncateToWidth(leftCell, listWidth - 2) + " ";
        leftCell = padRight(leftCell, listWidth);

        if (hasPreview) {
          const previewIdx = state.previewScrollOffset + row;
          let rightCell = "";
          if (previewIdx < state.previewLines.length) {
            rightCell = state.previewLines[previewIdx] ?? "";
          }
          rightCell = " " + truncateToWidth(rightCell, previewWidth - 2) + " ";
          rightCell = padRight(rightCell, previewWidth);

          lines.push(
            bdr("│") + leftCell + bdr("│") + rightCell + bdr("│"),
          );
        } else {
          lines.push(
            bdr("│") +
              leftCell +
              padRight("", innerWidth - listWidth) +
              bdr("│"),
          );
        }
      }

      // ── Separator (list -> input) ──
      if (hasPreview) {
        lines.push(
          bdr(`├${hLine("─", listWidth)}┴${hLine("─", previewWidth)}┤`),
        );
      } else {
        lines.push(bdr(`├${hLine("─", innerWidth)}┤`));
      }

      // ── Input row ──
      const query = state.mode !== "search" ? state.modeQuery : state.query;
      const cursorPos =
        state.mode !== "search" ? state.modeCursorPos : state.cursorPos;
      const promptChar = th.fg("accent", "> ");
      const beforeCursor = query.slice(0, cursorPos);
      const cursorChar = query[cursorPos] ?? " ";
      const afterCursor = query.slice(cursorPos + 1);
      const inputText = `${promptChar}${beforeCursor}\x1b[7m${cursorChar}\x1b[27m${afterCursor}`;
      const inputContent =
        " " + truncateToWidth(inputText, innerWidth - 2) + " ";
      lines.push(
        bdr("│") + padRight(inputContent, innerWidth) + bdr("│"),
      );

      // ── Separator (input -> hints) ──
      lines.push(bdr(`├${hLine("─", innerWidth)}┤`));

      // ── Hints row ──
      const hintsContent = buildHints(th, innerWidth - 2, state.mode);
      lines.push(
        bdr("│") +
          " " +
          padRight(hintsContent, innerWidth - 2) +
          " " +
          bdr("│"),
      );

      // ── Bottom border ──
      lines.push(bdr(`╰${hLine("─", innerWidth)}╯`));

      return lines;
    };

    // ── Init ─────────────────────────────────────

    if (!currentProvider.supportsDynamicSearch) {
      loadItems();
    } else {
      state.loading = false;
    }

    return {
      render,
      invalidate: () => {},
      handleInput,
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "top-center" as const,
      offsetY: 3,
      width: "90%",
      minWidth: 80,
      maxHeight: "85%",
    },
  });

  const pendingAction = actionToRun as (() => Promise<void>) | null;
  if (pendingAction) {
    await pendingAction();
    tuiRef?.requestRender();
  }
}

// ── Hint bar ──────────────────────────────────────

function buildHints(th: Theme, totalWidth: number, mode: Mode): string {
  const acc = (s: string) => th.fg("accent", s);
  const dim = (s: string) => th.fg("dim", s);

  const hints =
    mode === "search"
      ? [
          acc("⇥") + dim(" sel"),
          acc("^R") + dim(" switch"),
          acc("^O") + dim(" preview"),
          acc("^E") + dim(" act"),
          acc("^Y") + dim(" copy"),
          acc("^G") + dim(" help"),
        ]
      : [acc("Enter") + dim(" confirm"), acc("Esc") + dim(" back")];

  const content = hints.join(dim("  ·  "));
  return truncateToWidth(content, totalWidth);
}

// ── Highlight helpers ─────────────────────────────

function highlightMatches(
  text: string,
  indices: readonly number[],
  theme: Theme,
): string {
  if (indices.length === 0) return text;

  const indexSet = new Set(indices);
  let result = "";

  for (let i = 0; i < text.length; i++) {
    if (indexSet.has(i)) {
      result += theme.fg("warning", text[i]!);
    } else {
      result += text[i];
    }
  }

  return result;
}
