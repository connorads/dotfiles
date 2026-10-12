// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CompositionView } from "./app";
import { parseComposition } from "./validation";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const nodes = [
  { id: "start", label: "Collect" },
  { id: "a", label: "Records" },
  { id: "b", label: "Files" },
  { id: "join", label: "Search" },
];
const edges = [
  { from: "start", to: "a", label: "Index" },
  { from: "start", to: "b" },
  { from: "a", to: "join" },
  { from: "b", to: "join" },
];
for (const format of ["openui", "json-render"] as const)
  it(`${format} renders explicit split and join relationships`, () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const source =
      format === "openui"
        ? `root = Stack([IconLabel("search", "Retrieval workflow"), Flow(${JSON.stringify(nodes)}, ${JSON.stringify(edges)})])`
        : JSON.stringify({
            root: "root",
            elements: {
              root: { type: "Stack", props: {}, children: ["label", "flow"] },
              label: {
                type: "IconLabel",
                props: { icon: "search", text: "Retrieval workflow" },
                children: [],
              },
              flow: { type: "Flow", props: { nodes, edges }, children: [] },
            },
          });
    const { container } = render(
      <CompositionView
        composition={parseComposition({ format, source, title: "Flow" })}
      />,
    );
    expect(container.querySelectorAll("[data-flow-edge]")).toHaveLength(4);
    expect(screen.getByText("Retrieval workflow")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Flow connections", hidden: true })
        .textContent,
    ).toContain("Collect → Records: Index");
  });
