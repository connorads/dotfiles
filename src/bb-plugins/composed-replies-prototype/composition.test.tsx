// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CompositionView } from "./app";
import { parseComposition, parseSpec } from "./validation";
import { functions } from "./catalogue";
afterEach(cleanup);
const openui =
  'root = Stack([Slider("Quantity", $n, 0, 10, 1, "items"), Metric("Cost", $n * 2, "GBP"), BarChart(["Cost"], [$n * 2], "GBP")])\n$n = 3';
const json = JSON.stringify({
  root: "root",
  state: { n: 3 },
  elements: {
    root: { type: "Stack", props: {}, children: ["slider", "metric", "chart"] },
    slider: {
      type: "Slider",
      children: [],
      props: {
        label: "Quantity",
        value: { $bindState: "/n" },
        min: 0,
        max: 10,
        step: 1,
        unit: "items",
      },
    },
    metric: {
      type: "Metric",
      children: [],
      props: {
        label: "Cost",
        value: { $computed: "mul", args: { a: { $state: "/n" }, b: 2 } },
        unit: "GBP",
      },
    },
    chart: {
      type: "BarChart",
      children: [],
      props: {
        labels: ["Cost"],
        values: [{ $computed: "mul", args: { a: { $state: "/n" }, b: 2 } }],
        unit: "GBP",
      },
    },
  },
});
for (const [format, source] of [
  ["openui", openui],
  ["json-render", json],
] as const)
  it(`${format} links slider, metric and chart through local state`, () => {
    const composition = parseComposition({ format, source, title: "Cost" });
    render(<CompositionView composition={composition} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Cost 6",
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "7" } });
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Cost 14",
    );
    expect(screen.getAllByText("14").length).toBeGreaterThan(0);
  });
it("rejects cycles", () => {
  expect(() =>
    parseSpec(
      JSON.stringify({
        root: "r",
        elements: { r: { type: "Stack", props: {}, children: ["r"] } },
      }),
    ),
  ).toThrow("cycle");
});
it("rejects unregistered computations", () => {
  expect(() => parseSpec(json.replace("mul", "eval"))).toThrow(
    "Unknown computation",
  );
});
it("rejects tool queries and incomplete OpenUI", () => {
  expect(() =>
    parseComposition({
      format: "openui",
      source: 'root = Stack([Text(Query("network", {}))])',
      title: "Bad",
    }),
  ).toThrow();
});
it("rejects oversized data and nonfinite arithmetic", () => {
  expect(() =>
    parseComposition({
      format: "openui",
      source: "a".repeat(50001),
      title: "Bad",
    }),
  ).toThrow();
  expect(() => functions.div({ a: 4, b: 0 })).toThrow("zero");
  expect(() => functions.mul({ a: 1e9, b: 1e9 })).toThrow();
});

it("OpenUI scalar state reads update metrics, tables and charts", () => {
  const source =
    'root = Stack([Slider("Quantity", $n, 0, 10, 1, "items"), Metric("Quantity", $n, "items"), Table(["Quantity"], [[$n]]), BarChart(["Quantity"], [$n], "items")])\n$n = 3';
  render(
    <CompositionView
      composition={parseComposition({
        format: "openui",
        source,
        title: "State",
      })}
    />,
  );
  expect(screen.getByRole("cell").textContent).toBe("3");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "7" } });
  expect(screen.getByRole("cell").textContent).toBe("7");
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "Quantity 7",
  );
});

it("OpenUI @Floor recomputes named derived expressions", () => {
  const source =
    'root = Stack([Slider("Total", $n, 0, 10, 1, "items"), Metric("Half", half, "items"), BarChart(["Half"], [half], "items")])\nhalf = @Floor($n / 2)\n$n = 3';
  render(
    <CompositionView
      composition={parseComposition({
        format: "openui",
        source,
        title: "Floor",
      })}
    />,
  );
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "Half 1",
  );
  fireEvent.change(screen.getByRole("slider"), { target: { value: "7" } });
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "Half 3",
  );
});

it("rejects reserved state paths", () => {
  expect(() => parseSpec(json.replaceAll("/n", "/__proto__/n"))).toThrow(
    "Invalid state path",
  );
});
