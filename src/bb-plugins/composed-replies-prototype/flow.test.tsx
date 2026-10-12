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
  ).toBe("M150,40 V54 H90 V96");
  expect(
    container
      .querySelector('[data-flow-edge="source→join"]')
      ?.getAttribute("d"),
  ).toBe("M150,40 V54 H10.4 V178 H150 V192");
  expect(
    container
      .querySelector('[data-flow-caption="source→a"]')
      ?.getAttribute("style"),
  ).toContain("left: 90px");
  expect(
    container.querySelectorAll("[data-flow-edge][marker-end]"),
  ).toHaveLength(3);
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

it("shows full captions and one arrowhead at each destination", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const label = "Approve and publish the finished article";
  const { container } = render(
    <Flow {...graph} edges={graph.edges.map((edge) => ({ ...edge, label }))} />,
  );
  expect(
    container.querySelectorAll("[data-flow-edge][marker-end]"),
  ).toHaveLength(3);
  expect(container.querySelectorAll("[data-flow-caption]")).toHaveLength(4);
  for (const caption of Array.from(
    container.querySelectorAll("[data-flow-caption]"),
  ))
    expect(caption.textContent).toBe(label);
  expect(
    container.querySelector("[data-flow-edge]")?.getAttribute("d"),
  ).not.toContain("C");
});
it("reserves space for wrapped captions without shrinking text", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.dataset.flowCaption ? 80 : 40;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 320,
        bottom: height,
        width: 320,
        height,
        toJSON() {},
      };
    },
  );
  const { container } = render(
    <Flow
      {...graph}
      edges={[
        {
          from: "source",
          to: "a",
          label: "A long caption that wraps instead of being cut short",
        },
      ]}
    />,
  );
  const diagram =
    container.querySelector("[data-flow-node]")?.parentElement?.parentElement;
  expect(diagram?.style.gap).toBe("120px");
  const caption = container.querySelector(
    "[data-flow-caption] span",
  ) as HTMLElement;
  expect(caption.style.fontSize).toBe("11px");
  expect(caption.style.overflowWrap).toBe("anywhere");
});
