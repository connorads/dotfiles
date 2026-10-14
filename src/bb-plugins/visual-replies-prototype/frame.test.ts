// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { fontStyles } from "./frame";

it("inlines the first source of theme font faces once and skips the rest", async () => {
  const style = document.createElement("style");
  style.textContent = `
    @font-face{font-family:"Inter Variable";src:url(/inter.woff2) format("woff2"),url(/inter.woff) format("woff")}
    @font-face{font-family:KaTeX_Main;src:url(/katex.woff2) format("woff2"),url(/katex.ttf) format("truetype")}
    @font-face{font-family:Mono;src:url(/missing.woff2) format("woff2")}`;
  document.head.append(style);
  // jsdom exposes font-face rules without the global constructor.
  vi.stubGlobal("CSSFontFaceRule", document.styleSheets[0]!.cssRules[0]!.constructor);
  const fetch = vi.fn(async (url: URL) => url.pathname === "/missing.woff2" ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1, 2])));
  vi.stubGlobal("fetch", fetch);
  try {
    const theme = { "--font-sans": '"Inter Variable", system-ui, sans-serif', "--font-mono": "Mono, monospace" };
    const css = await fontStyles(theme);
    expect(await fontStyles(theme)).toBe(css);
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(["/inter.woff2", "/missing.woff2"]);
    expect(css).toContain('url("data:application/octet-stream;base64,AQI=") format("woff2")');
    expect(css).not.toMatch(/KaTeX|inter\.woff\b|missing/);
  } finally {
    style.remove(); vi.unstubAllGlobals();
  }
});
