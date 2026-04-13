/**
 * Shared overlay frame utility for bordered UI panels.
 *
 * Eliminates duplicated box-drawing across telescope and leader-key overlays.
 */

import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

interface ThemeLike {
  fg: (role: string, text: string) => string;
  bold: (text: string) => string;
}

/** Pad a (possibly ANSI-styled) string to exact visible width. */
export function padToWidth(s: string, len: number): string {
  const vis = visibleWidth(s);
  return s + " ".repeat(Math.max(0, len - vis));
}

/**
 * A bordered overlay frame builder.
 *
 * Usage:
 *   const f = new OverlayFrame(width, theme);
 *   lines.push(f.top());
 *   lines.push(f.row(theme.fg("accent", theme.bold("Title"))));
 *   lines.push(f.separator());
 *   lines.push(f.row(someContent));
 *   lines.push(f.bottom());
 */
export class OverlayFrame {
  readonly width: number;
  readonly innerWidth: number;

  private hLine: string;
  private theme: ThemeLike;

  constructor(terminalWidth: number, theme: ThemeLike, maxWidth = 80) {
    this.width = Math.min(terminalWidth, maxWidth);
    this.innerWidth = this.width - 4;
    this.hLine = "─".repeat(this.width - 2);
    this.theme = theme;
  }

  top(): string {
    return this.theme.fg("border", `╭${this.hLine}╮`);
  }

  separator(): string {
    return this.theme.fg("border", `├${this.hLine}┤`);
  }

  bottom(): string {
    return this.theme.fg("border", `╰${this.hLine}╯`);
  }

  row(content: string): string {
    const th = this.theme;
    return (
      th.fg("border", "│") +
      " " +
      padToWidth(content, this.innerWidth) +
      " " +
      th.fg("border", "│")
    );
  }

  rowTruncated(content: string): string {
    return this.row(truncateToWidth(content, this.innerWidth));
  }
}
