import { z } from "zod";
import {
  createLibrary,
  defineComponent,
  reactive,
  useStateField,
  useRenderNode,
} from "@openuidev/react-lang";
import { defineCatalog, type ComputedFunction } from "@json-render/core";
import { schema, defineRegistry, useBoundProp } from "@json-render/react";
import { type ReactNode, useId } from "react";

import {
  richProps,
  Grid,
  Stat,
  LineChart,
  StackedBarChart,
} from "./rich-components";

const boundedNumber = z.number().finite().min(-1e9).max(1e9);
const label = z.string().max(160);
const scalar = z.union([boundedNumber, z.string().max(1000)]);
const props = {
  ...richProps,
  Stack: z.object({ children: z.array(z.unknown()).max(50) }),
  Text: z.object({ text: z.string().max(4000) }),
  NumberInput: z.object({
    label,
    value: boundedNumber,
    min: boundedNumber,
    max: boundedNumber,
    step: boundedNumber.positive(),
    unit: label,
  }),
  Slider: z.object({
    label,
    value: boundedNumber,
    min: boundedNumber,
    max: boundedNumber,
    step: boundedNumber.positive(),
    unit: label,
  }),
  Select: z.object({
    label,
    value: label,
    options: z.array(label).min(1).max(30),
  }),
  Metric: z.object({ label, value: scalar, unit: label }),
  Table: z.object({
    columns: z.array(label).min(1).max(8),
    rows: z.array(z.array(scalar).max(8)).max(30),
  }),
  BarChart: z.object({
    labels: z.array(label).min(1).max(12),
    values: z.array(boundedNumber.nonnegative()).min(1).max(12),
    unit: label,
  }),
};
function NumericControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  type,
  setValue,
}: z.infer<typeof props.Slider> & {
  type: "number" | "range";
  setValue: (v: number) => void;
}) {
  const id = useId();
  if (value === undefined) return <span role="status">Loading {label}...</span>;
  props.Slider.parse({ label, value, min, max, step, unit });
  if (min > max || value < min || value > max)
    throw new Error("Control range invalid");
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 6, fontSize: 13 }}>
      <span>
        {label}{" "}
        <output>
          {value} {unit}
        </output>
      </span>
      <input
        id={id}
        type={type}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setValue(Math.min(max, Math.max(min, n)));
        }}
        style={{
          width: "100%",
          minWidth: 0,
          accentColor: "var(--primary)",
          font: "inherit",
          background: "var(--background)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          padding: type === "number" ? 6 : 0,
        }}
      />
    </label>
  );
}
function SelectControl({
  label,
  value,
  options,
  setValue,
}: z.infer<typeof props.Select> & { setValue: (v: string) => void }) {
  const id = useId();
  if (value === undefined) return <span role="status">Loading {label}...</span>;
  props.Select.parse({ label, value, options });
  if (!options.includes(value)) throw new Error("Unknown selected option");
  return (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{
          display: "block",
          width: "100%",
          font: "inherit",
          background: "var(--background)",
          color: "var(--foreground)",
          padding: 6,
          border: "1px solid var(--border)",
        }}
      >
        {options.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
function Metric(p: z.infer<typeof props.Metric>) {
  if (p.value === undefined)
    return <span role="status">Loading {p.label}...</span>;
  props.Metric.parse(p);
  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        {p.label}
      </span>
      <div style={{ fontSize: 22, fontWeight: 600 }}>
        {typeof p.value === "number"
          ? Math.round(p.value * 100) / 100
          : p.value}{" "}
        <span style={{ fontSize: 12, fontWeight: 400 }}>{p.unit}</span>
      </div>
    </div>
  );
}
function Table(p: z.infer<typeof props.Table>) {
  if (p.rows.some((r) => r.some((x) => x === undefined)))
    return <span role="status">Loading table...</span>;
  props.Table.parse(p);
  if (p.rows.some((r) => r.length !== p.columns.length))
    throw new Error("Table row width invalid");
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}
      >
        <thead>
          <tr>
            {p.columns.map((x) => (
              <th
                key={x}
                style={{
                  textAlign: "left",
                  padding: 6,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((row, i) => (
            <tr key={i}>
              {row.map((x, j) => (
                <td
                  key={j}
                  style={{
                    padding: 6,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function BarChart(p: z.infer<typeof props.BarChart>) {
  if (p.values.some((x) => x === undefined))
    return <span role="status">Loading chart...</span>;
  props.BarChart.parse(p);
  if (p.labels.length !== p.values.length)
    throw new Error("Chart labels and values must match");
  const max = Math.max(1, ...p.values);
  return (
    <div
      role="img"
      aria-label={`${p.unit}: ${p.labels.map((l, i) => `${l} ${p.values[i]}`).join(", ")}`}
      style={{
        display: "grid",
        gap: 8,
        fontSize: 12,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ color: "var(--muted-foreground)" }}>{p.unit}</div>
      {p.labels.map((x, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(60px, 28%) minmax(0,1fr) 60px",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span>{x}</span>
          <div
            style={{ height: 16, background: "var(--muted)", borderRadius: 3 }}
          >
            <div
              style={{
                width: `${(Math.abs(p.values[i] ?? 0) / max) * 100}%`,
                height: "100%",
                background: "var(--primary)",
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ textAlign: "right" }}>
            {Math.round((p.values[i] ?? 0) * 100) / 100}
          </span>
        </div>
      ))}
    </div>
  );
}
const stack = (children: ReactNode) => (
  <div style={{ display: "grid", gap: 16, minWidth: 0 }}>{children}</div>
);
const StackOpen = defineComponent({
  name: "Stack",
  description: "Vertical responsive layout of child components",
  props: props.Stack,
  component: ({ props: p }) => {
    const render = useRenderNode();
    return stack(p.children.map((x, i) => <div key={i}>{render(x)}</div>));
  },
});
const TextOpen = defineComponent({
  name: "Text",
  description: "Short plain text",
  props: props.Text,
  component: ({ props: p }) => (
    <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>
      {props.Text.parse(p).text}
    </p>
  ),
});
const NumberOpen = defineComponent({
  name: "NumberInput",
  description: "Bounded number input, bind value to a $variable",
  props: props.NumberInput.extend({ value: reactive(boundedNumber.clone()) }),
  component: ({ props: p }) => {
    const field = useStateField(p.label, p.value);
    return (
      <NumericControl
        {...p}
        value={field.value}
        setValue={field.setValue}
        type="number"
      />
    );
  },
});
const SliderOpen = defineComponent({
  name: "Slider",
  description: "Bounded numeric slider, bind value to a $variable",
  props: props.Slider.extend({ value: reactive(boundedNumber.clone()) }),
  component: ({ props: p }) => {
    const field = useStateField(p.label, p.value);
    return (
      <NumericControl
        {...p}
        value={field.value}
        setValue={field.setValue}
        type="range"
      />
    );
  },
});
const SelectOpen = defineComponent({
  name: "Select",
  description: "Select one option, bind value to a $variable",
  props: props.Select.extend({ value: reactive(label.clone()) }),
  component: ({ props: p }) => {
    const field = useStateField(p.label, p.value);
    return (
      <SelectControl {...p} value={field.value} setValue={field.setValue} />
    );
  },
});
export const library = createLibrary({
  components: [
    defineComponent({
      name: "Grid",
      description: "Responsive compact layout with two or three columns",
      props: richProps.Grid,
      component: ({ props: p }) => {
        const render = useRenderNode();
        return (
          <Grid columns={p.columns}>
            {p.children.map((x, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                {render(x)}
              </div>
            ))}
          </Grid>
        );
      },
    }),
    defineComponent({
      name: "Stat",
      description: "Numeric summary with signed change and explicit units",
      props: richProps.Stat,
      component: ({ props: p }) => <Stat {...p} />,
    }),
    defineComponent({
      name: "LineChart",
      description:
        "Signed multi-series line chart with category labels and axis units",
      props: richProps.LineChart,
      component: ({ props: p }) => <LineChart {...p} />,
    }),
    defineComponent({
      name: "StackedBarChart",
      description:
        "Nonnegative multi-series stacked category bars with legend and units",
      props: richProps.StackedBarChart,
      component: ({ props: p }) => <StackedBarChart {...p} />,
    }),
    StackOpen,
    TextOpen,
    NumberOpen,
    SliderOpen,
    SelectOpen,
    defineComponent({
      name: "Metric",
      description: "Computed value with units",
      props: props.Metric,
      component: ({ props: p }) => <Metric {...p} />,
    }),
    defineComponent({
      name: "Table",
      description: "Small table of scalar cells",
      props: props.Table,
      component: ({ props: p }) => <Table {...p} />,
    }),
    defineComponent({
      name: "BarChart",
      description:
        "Categorical bar chart with corresponding labels and numeric values",
      props: props.BarChart,
      component: ({ props: p }) => <BarChart {...p} />,
    }),
  ],
  root: "Stack",
});
export const catalog = defineCatalog(schema, {
  components: {
    Grid: {
      props: z.object({ columns: richProps.Grid.shape.columns }),
      slots: ["default"],
      description: "Responsive two or three column compact layout",
    },
    Stat: {
      props: richProps.Stat,
      description: "Numeric summary with signed change and explicit units",
    },
    LineChart: {
      props: richProps.LineChart,
      description: "Signed multi-series line chart with axis units",
    },
    StackedBarChart: {
      props: richProps.StackedBarChart,
      description: "Nonnegative multi-series stacked category bars",
    },
    Stack: {
      props: z.object({}),
      slots: ["default"],
      description: "Vertical responsive layout",
    },
    Text: { props: props.Text, description: "Short plain text" },
    NumberInput: {
      props: props.NumberInput,
      description: "Bounded numeric input. Use $bindState for value",
    },
    Slider: {
      props: props.Slider,
      description: "Bounded slider. Use $bindState for value",
    },
    Select: { props: props.Select, description: "Bound selection" },
    Metric: { props: props.Metric, description: "Computed value with units" },
    Table: { props: props.Table, description: "Scalar table" },
    BarChart: {
      props: props.BarChart,
      description: "Categorical bars with labels and values",
    },
  },
  actions: {},
});
const NumericJson = ({
  props: p,
  bindings,
  type,
}: {
  props: z.infer<typeof props.Slider>;
  bindings?: Record<string, string>;
  type: "range" | "number";
}) => {
  const [value, set] = useBoundProp(p.value, bindings?.value);
  return (
    <NumericControl
      {...p}
      value={value ?? p.value}
      setValue={set}
      type={type}
    />
  );
};
export const { registry } = defineRegistry(catalog, {
  components: {
    Grid: ({ props: p, children }) => (
      <Grid columns={p.columns}>{children}</Grid>
    ),
    Stat: ({ props: p }) => <Stat {...p} />,
    LineChart: ({ props: p }) => <LineChart {...p} />,
    StackedBarChart: ({ props: p }) => <StackedBarChart {...p} />,
    Stack: ({ children }) => stack(children),
    Text: ({ props: p }) => (
      <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>
        {props.Text.parse(p).text}
      </p>
    ),
    NumberInput: (p) => <NumericJson {...p} type="number" />,
    Slider: (p) => <NumericJson {...p} type="range" />,
    Select: ({ props: p, bindings }) => {
      const [value, set] = useBoundProp(p.value, bindings?.value);
      return <SelectControl {...p} value={value ?? p.value} setValue={set} />;
    },
    Metric: ({ props: p }) => <Metric {...p} />,
    Table: ({ props: p }) => <Table {...p} />,
    BarChart: ({ props: p }) => <BarChart {...p} />,
  },
});
const num = (x: unknown) => {
  if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 1e9)
    throw new Error("Invalid arithmetic operand");
  return x;
};
const bounded = (x: number) => num(x);
export const functions: Record<string, ComputedFunction> = {
  add: ({ a, b }) => bounded(num(a) + num(b)),
  sub: ({ a, b }) => bounded(num(a) - num(b)),
  mul: ({ a, b }) => bounded(num(a) * num(b)),
  div: ({ a, b }) => {
    if (num(b) === 0) throw new Error("Division by zero");
    return bounded(num(a) / num(b));
  },
  min: ({ a, b }) => Math.min(num(a), num(b)),
  max: ({ a, b }) => Math.max(num(a), num(b)),
  ceil: ({ a }) => Math.ceil(num(a)),
  floor: ({ a }) => Math.floor(num(a)),
};
export function prompt(format: "openui" | "json-render") {
  const rules =
    "Only registered components. No tools, actions, remote resources, visibility, repeats or arbitrary code. Maximum 50 components. Controls must use bound state. Derived values must recompute when controls change.";
  if (format === "openui")
    return library.prompt({
      additionalRules: [
        rules,
        'Declare root first using forward references. Initialise $variables with literal defaults only. Never declare derived $variables. Put derived expressions directly in Metric/BarChart/Table props or in ordinary named expressions. Use + - * /, @Floor(...) and @Ceil(...). Example: root = Stack([Slider("Quantity", $n, 0, 10, 1, "items"), Metric("Cost", $n * 2, "GBP")]) then $n = 3 on its own line. Return OpenUI Lang only.',
      ],
    });
  const schemas = Object.fromEntries(
    Object.entries(props).map(([name, shape]) => [
      name,
      z.toJSONSchema(
        name === "Stack"
          ? z.object({})
          : name === "Grid"
            ? z.object({ columns: richProps.Grid.shape.columns })
            : shape,
      ),
    ]),
  );
  return `Return exactly one complete JSON object, no Markdown. Shape {"root":"root","elements":{"root":{"type":"Stack","props":{},"children":["child"]}},"state":{"n":3}}. Every element needs children, use [] for leaves. ${rules}
Component prop schemas: ${JSON.stringify(schemas)}
Use {"$bindState":"/name"} for two-way control values and {"$state":"/name"} to read state anywhere in props, including arrays. Dynamic expressions replace scalar prop values. Use {"$computed":"mul","args":{"a":{"$state":"/n"},"b":2}} for multiplication. Registered arithmetic add/sub/mul/div/min/max use args {a,b}; ceil/floor use {a}. Nest expressions as needed. No $template. No JSONL patches in this complete-document experiment.`;
}
