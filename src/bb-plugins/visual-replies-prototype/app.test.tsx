// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, waitFor } from "@testing-library/react";
import { frameDocument } from "./frame";

it("reports initial height when offscreen animation frames are suspended", () => {
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise(() => {}) } });
  const bounds = vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({ height: 344 } as DOMRect);
  try {
    const html = frameDocument("<p>Offscreen visual</p>", {}, "", "offscreen");
    const doc = new DOMParser().parseFromString(html, "text/html");
    window.eval(doc.body.lastElementChild!.textContent!);
    expect(post).toHaveBeenCalledWith({ type: "visual-height", nonce: "offscreen", height: 344 }, "*");
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    bounds.mockRestore(); post.mockRestore(); vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  }
});

it("renders without a card, validates iframe messages and disposes listeners", async () => {
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.messageDirectives[0]!, {
    attributes: { id: "eb8b8c67-647e-4fea-a844-73d296fa9635" }, source: "", message: { id: "m", threadId: "t", turnId: "turn", projectId: "p" }, openWorkspaceFile: null,
  }, { rpc: { read: () => ({ html: "<p>Example</p>", title: "Example" }) } });
  try {
    const frame = await slot.findByTitle("Example") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.style.border).toBe("0px");
    expect(frame.srcdoc).toContain("Content-Security-Policy");
    const nonce = /const nonce = "([^"]+)"/.exec(frame.srcdoc)?.[1];
    await act(() => window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "visual-height", nonce, height: 400 } })));
    expect(frame.style.height).toBe("1px");
    await act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "visual-height", nonce, height: 400 } })));
    await waitFor(() => expect(frame.style.height).toBe("400px"));
    expect(frame.style.visibility).toBe("visible");
  } finally {
    slot.lifecycle.unmount();
    const handler = add.mock.calls.find(([name]) => name === "message")?.[1];
    expect(remove).toHaveBeenCalledWith("message", handler);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
it("supplies theme before authored scripts and confines network access", () => {
  const html = frameDocument('<script>window.firstColour=getComputedStyle(document.body).color</script>', { "--foreground": "rgb(1, 2, 3)", "--font-sans": "Inter" }, "@font-face{font-family:Inter;src:url(data:font/woff2;base64,AA)}", "test");
  expect(html.indexOf("--foreground:rgb(1, 2, 3)")).toBeLessThan(html.indexOf("window.firstColour"));
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("font-src data:");
  expect(html).toContain("event.source !== parent");
});
