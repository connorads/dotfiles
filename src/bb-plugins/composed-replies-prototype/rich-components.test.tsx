// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CompositionView } from "./app";
import { parseComposition } from "./validation";
import { LineChart, StackedBarChart, richProps } from "./rich-components";
class Observer {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Observer);
afterEach(cleanup);
const openui =
  'root = Stack([Slider("Income", $income, 0, 1000, 50, "GBP"), Grid([Stat("Savings", $income - 200, "GBP", $income - 500, "GBP vs prior"), Stat("Income", $income, "GBP", 10, "% vs prior")], 2), LineChart(["Jan", "Feb"], [{name:"Savings", values:[-100, $income - 200]}, {name:"Income", values:[300, $income]}], "GBP", "Month"), StackedBarChart(["Jan", "Feb"], [{name:"Fixed",values:[200,200]}, {name:"Savings",values:[100,$income]}], "GBP")])\n$income = 500';
const state = { $state: "/income" };
const sub = (b: number) => ({ $computed: "sub", args: { a: state, b } });
const json = JSON.stringify({
  root: "root",
  state: { income: 500 },
  elements: {
    root: {
      type: "Stack",
      props: {},
      children: ["control", "grid", "line", "bars"],
    },
    control: {
      type: "Slider",
      props: {
        label: "Income",
        value: { $bindState: "/income" },
        min: 0,
        max: 1000,
        step: 50,
        unit: "GBP",
      },
      children: [],
    },
    grid: {
      type: "Grid",
      props: { columns: 2 },
      children: ["saving", "income"],
    },
    saving: {
      type: "Stat",
      props: {
        label: "Savings",
        value: sub(200),
        unit: "GBP",
        change: sub(500),
        changeUnit: "GBP vs prior",
      },
      children: [],
    },
    income: {
      type: "Stat",
      props: {
        label: "Income",
        value: state,
        unit: "GBP",
        change: 10,
        changeUnit: "% vs prior",
      },
      children: [],
    },
    line: {
      type: "LineChart",
      props: {
        labels: ["Jan", "Feb"],
        series: [
          { name: "Savings", values: [-100, sub(200)] },
          { name: "Income", values: [300, state] },
        ],
        unit: "GBP",
        xUnit: "Month",
      },
      children: [],
    },
    bars: {
      type: "StackedBarChart",
      props: {
        labels: ["Jan", "Feb"],
        series: [
          { name: "Fixed", values: [200, 200] },
          { name: "Savings", values: [100, state] },
        ],
        unit: "GBP",
      },
      children: [],
    },
  },
});
for (const [format, source] of [
  ["openui", openui],
  ["json-render", json],
] as const)
  it(`${format} shares state across summaries, signed lines and stacked series`, () => {
    render(
      <CompositionView
        composition={parseComposition({
          format,
          source,
          title: "Fictional finance",
        })}
      />,
    );
    expect(screen.getByLabelText("Change 0 GBP vs prior")).toBeTruthy();
    expect(screen.getAllByRole("img")[0].getAttribute("aria-label")).toContain(
      "Savings: Jan -100, Feb 300",
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "750" } });
    expect(screen.getByLabelText("Change +250 GBP vs prior")).toBeTruthy();
    expect(screen.getAllByRole("img")[0].getAttribute("aria-label")).toContain(
      "Savings: Jan -100, Feb 550",
    );
    expect(screen.getAllByRole("img")[1].getAttribute("aria-label")).toContain(
      "Savings: Jan 100, Feb 750",
    );
  });
it("places negative line values below positive values with fixed screen labels", () => {
  const { container } = render(
    <LineChart
      labels={["Start", "End"]}
      series={[{ name: "Balance", values: [-10, 10] }]}
      unit="GBP"
      xUnit="Month"
    />,
  );
  const points = container
    .querySelector("polyline")
    ?.getAttribute("points")
    ?.split(" ")
    .map((x) => Number(x.split(",")[1]));
  expect(points?.[0]).toBeGreaterThan(points?.[1] ?? 0);
  expect(container.querySelector("svg")?.style.fontSize).toBe("11px");
  expect(container.querySelector("svg")?.getAttribute("viewBox")).toBeNull();
  expect(screen.getByText("Month")).toBeTruthy();
});
it("renders zero series without invalid coordinates or bar widths", () => {
  const { container } = render(
    <>
      <LineChart
        labels={["A", "B"]}
        series={[{ name: "Zero", values: [0, 0] }]}
        unit="GBP"
        xUnit="Month"
      />
      <StackedBarChart
        labels={["A", "B"]}
        series={[{ name: "Zero", values: [0, 0] }]}
        unit="GBP"
      />
    </>,
  );
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(
    container.querySelector("span[data-series]")?.getAttribute("style"),
  ).toContain("width: 0%");
});
it("rejects negative stacked values and excessive series/points", () => {
  expect(() =>
    richProps.StackedBarChart.parse({
      labels: ["A"],
      series: [{ name: "Bad", values: [-1] }],
      unit: "GBP",
    }),
  ).toThrow();
  expect(() =>
    richProps.LineChart.parse({
      labels: Array(25).fill("A"),
      series: [{ name: "Bad", values: Array(25).fill(1) }],
      unit: "GBP",
      xUnit: "Month",
    }),
  ).toThrow();
  expect(() =>
    richProps.LineChart.parse({
      labels: ["A", "B"],
      series: Array(5).fill({ name: "Bad", values: [1, 2] }),
      unit: "GBP",
      xUnit: "Month",
    }),
  ).toThrow();
});

it("waits for OpenUI state hydration before evaluating nonnegative stacked expressions", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <CompositionView
        composition={parseComposition({
          format: "openui",
          title: "Hydration",
          source:
            'root = Stack([StackedBarChart(["Oct"], [{name:"Living",values:[$spending - 1600]}], "GBP")])\n$spending = 2600',
        })}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Oct 1000",
    );
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

it("rejects genuinely negative stacked values after OpenUI state hydration", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    render(
      <CompositionView
        composition={parseComposition({
          format: "openui",
          title: "Invalid stacked data",
          source:
            'root = Stack([StackedBarChart(["Oct"], [{name:"Living",values:[$spending - 1600]}], "GBP")])\n$spending = 1000',
        })}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(errors).toHaveBeenCalled();
  } finally {
    errors.mockRestore();
    warnings.mockRestore();
  }
});
