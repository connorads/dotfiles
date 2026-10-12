// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Flow, flowProps } from "./flow";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const graph = {
  nodes: [
    { id: "source", label: "Source" },
    { id: "a", label: "Database", icon: "database" as const },
    { id: "b", label: "Files" },
    { id: "join", label: "Search" },
  ],
  edges: [
    { from: "source", to: "a", label: "Records" },
    { from: "source", to: "b" },
    { from: "a", to: "join" },
    { from: "b", to: "join" },
  ],
};
it("accepts splits and joins but rejects missing references, duplicate identities and cycles", () => {
  expect(flowProps.safeParse(graph).success).toBe(true);
  expect(
    flowProps.safeParse({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] })
      .success,
  ).toBe(false);
  expect(
    flowProps.safeParse({
      ...graph,
      edges: [{ from: "source", to: "missing" }],
    }).success,
  ).toBe(false);
  expect(
    flowProps.safeParse({
      ...graph,
      edges: [...graph.edges, { from: "join", to: "source" }],
    }).success,
  ).toBe(false);
  expect(
    flowProps.safeParse({ ...graph, edges: [...graph.edges, graph.edges[0]] })
      .success,
  ).toBe(false);
});
it("renders all branch relationships as accessible text and distinct directional paths", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { container } = render(<Flow {...graph} />);
  expect(
    screen.getByRole("list", { name: "Flow connections", hidden: true })
      .textContent,
  ).toContain("Source → Database: Records");
  expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(4);
  expect(container.querySelectorAll("[data-flow-edge]")).toHaveLength(4);
  expect(screen.getByText("Files")).toBeTruthy();
});
it("connects measured node boundaries and routes skipped levels outside node columns", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const bounds: Record<string, number[]> = {
    source: [100, 0, 100, 40],
    a: [40, 96, 100, 40],
    b: [180, 96, 100, 40],
    join: [100, 192, 100, 40],
  };
  const measure = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const [x, y, width, height] = bounds[this.dataset.flowNode ?? ""] ?? [
        0, 0, 320, 232,
      ];
      return {
        x,
        y,
        width,
        height,
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        toJSON() {},
      };
    });
  const { container } = render(
    <Flow
      {...graph}
      edges={[...graph.edges, { from: "source", to: "join" }]}
    />,
  );
  expect(
    container.querySelector('[data-flow-edge="source→a"]')?.getAttribute("d"),
  ).toBe("M150,40 C150,68 90,68 90,96");
  expect(
    container
      .querySelector('[data-flow-edge="source→join"]')
      ?.getAttribute("d"),
  ).toBe("M150,40 V58 H10.4 V174 H150 V192");
  measure.mockRestore();
});
it("keeps dense layers readable inside a local scrolling surface", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { container } = render(
    <Flow
      nodes={Array.from({ length: 12 }, (_, i) => ({
        id: `${i}`,
        label: `Node ${i}`,
      }))}
      edges={[]}
    />,
  );
  const outer = container.firstElementChild as HTMLElement;
  expect(outer.style.overflowX).toBe("auto");
  expect((outer.firstElementChild as HTMLElement).style.minWidth).toBe(
    "1524px",
  );
  expect(container.querySelectorAll("[data-flow-node]")).toHaveLength(12);
});
