import { z } from "zod";
import { useEffect, useRef, useState, type ReactNode } from "react";

const number = z.number().finite().min(-1e9).max(1e9);
const label = z.string().max(160);
const values = z.array(number).min(1).max(24);
const series = z
  .array(z.object({ name: label, values }))
  .min(1)
  .max(4);
export const richProps = {
  Grid: z.object({
    children: z.array(z.unknown()).max(24),
    columns: z.union([z.literal(2), z.literal(3)]),
  }),
  Stat: z.object({
    label,
    value: number,
    unit: label,
    change: number,
    changeUnit: label,
  }),
  LineChart: z.object({
    labels: z.array(label).min(2).max(24),
    series,
    unit: label,
    xUnit: label,
  }),
  StackedBarChart: z.object({
    labels: z.array(label).min(1).max(24),
    series: z
      .array(
        z.object({
          name: label,
          values: z.array(number.nonnegative()).min(1).max(24),
        }),
      )
      .min(1)
      .max(4),
    unit: label,
  }),
};
const palette = [
  "var(--primary)",
  "var(--chart-2, #a78bfa)",
  "var(--chart-3, #22b8a8)",
  "var(--chart-4, #e4a342)",
];
const format = (n: number) =>
  Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 2,
    notation: Math.abs(n) >= 100000 ? "compact" : "standard",
  }).format(n);
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (next: number) => {
      if (next > 0) setWidth(next);
    };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
export function Grid({
  children,
  columns,
}: {
  children: ReactNode;
  columns: 2 | 3;
}) {
  const { ref, width } = useWidth();
  if (columns !== 2 && columns !== 3)
    throw new Error("Grid columns must be 2 or 3");
  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(columns, Math.max(1, Math.floor(width / 210)))},minmax(0,1fr))`,
        gap: 16,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
export function Stat(p: z.infer<typeof richProps.Stat>) {
  if (p.value === undefined || p.change === undefined)
    return <span role="status">Loading {p.label}...</span>;
  richProps.Stat.parse(p);
  const change = `${p.change > 0 ? "+" : ""}${format(p.change)}`;
  return (
    <div
      style={{ display: "grid", gap: 5, minWidth: 0, overflowWrap: "anywhere" }}
    >
      <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        {p.label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <strong
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-.03em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {format(p.value)}
        </strong>
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {p.unit}
        </span>
      </div>
      <span
        aria-label={`Change ${change} ${p.changeUnit}`}
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: "var(--muted-foreground)",
        }}
      >
        {p.change > 0 ? "↗" : p.change < 0 ? "↘" : "→"} {change}{" "}
        {p.changeUnit}
      </span>
    </div>
  );
}
function Legend({
  series,
  unit,
}: {
  series: Array<{ name: string }>;
  unit: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px 16px",
        flexWrap: "wrap",
        fontSize: 12,
        color: "var(--muted-foreground)",
        marginBottom: 8,
      }}
    >
      {series.map((s, i) => (
        <span
          key={i}
          style={{ display: "inline-flex", gap: 5, alignItems: "center" }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: palette[i],
            }}
          />
          {s.name}
        </span>
      ))}
      <span>{unit}</span>
    </div>
  );
}
function summary(
  labels: string[],
  series: Array<{ name: string; values: number[] }>,
  unit: string,
) {
  return `${unit}. ${series.map((s) => `${s.name}: ${labels.map((l, i) => `${l} ${s.values[i]}`).join(", ")}`).join("; ")}`;
}
function verifySeries(labels: string[], series: Array<{ values: number[] }>) {
  if (series.some((s) => s.values.length !== labels.length))
    throw new Error("Chart labels and series values must match");
}
export function LineChart(p: z.infer<typeof richProps.LineChart>) {
  const { ref, width } = useWidth();
  if (p.series.some((s) => s.values.some((v) => v === undefined)))
    return (
      <div ref={ref} role="status">
        Loading chart...
      </div>
    );
  richProps.LineChart.parse(p);
  verifySeries(p.labels, p.series);
  const left = 62,
    right = 14,
    top = 15,
    bottom = 44,
    height = 220;
  const plotWidth = Math.max(1, width - left - right);
  const all = p.series.flatMap((s) => s.values);
  let min = Math.min(0, ...all),
    max = Math.max(0, ...all);
  if (min === max) {
    min = -1;
    max = 1;
  }
  const roughStep = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const factor = [1, 2, 5, 10].find((n) => n * magnitude >= roughStep) ?? 10;
  const step = factor * magnitude;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const y = (v: number) =>
    top + ((max - v) / (max - min)) * (height - top - bottom);
  const x = (i: number) => left + (i / (p.labels.length - 1)) * plotWidth;
  const ticks = Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => min + i * step,
  );
  const stride = Math.max(
    1,
    Math.ceil(p.labels.length / Math.max(2, Math.floor(plotWidth / 72))),
  );
  return (
    <div ref={ref} style={{ minWidth: 0, width: "100%" }}>
      <Legend series={p.series} unit={p.unit} />
      <svg
        role="img"
        aria-label={summary(p.labels, p.series, p.unit)}
        width={width}
        height={height}
        style={{
          display: "block",
          maxWidth: "100%",
          overflow: "visible",
          fontFamily: "inherit",
          fontSize: 11,
        }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={width - right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
            />
            <text
              x={left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fill="var(--muted-foreground)"
            >
              {format(t)}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={width - right}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--muted-foreground)"
          strokeDasharray="3 3"
        />
        {p.series.map((s, i) => (
          <polyline
            key={i}
            data-series={s.name}
            points={s.values.map((v, j) => `${x(j)},${y(v)}`).join(" ")}
            fill="none"
            stroke={palette[i]}
            strokeWidth={2.3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {p.labels.map((l, i) =>
          i % stride === 0 || i === p.labels.length - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={height - bottom + 20}
              textAnchor={
                i === 0 ? "start" : i === p.labels.length - 1 ? "end" : "middle"
              }
              fill="var(--muted-foreground)"
            >
              {l.length > 12 ? l.slice(0, 11) + "…" : l}
            </text>
          ) : null,
        )}
        <text x={left} y={height - 4} fill="var(--muted-foreground)">
          {p.xUnit.length > Math.floor(plotWidth / 7)
            ? p.xUnit.slice(0, Math.max(1, Math.floor(plotWidth / 7) - 1)) + "…"
            : p.xUnit}
        </text>
      </svg>
    </div>
  );
}
export function StackedBarChart(p: z.infer<typeof richProps.StackedBarChart>) {
  if (p.series.some((s) => s.values.some((v) => v === undefined)))
    return <span role="status">Loading chart...</span>;
  richProps.StackedBarChart.parse(p);
  verifySeries(p.labels, p.series);
  const totals = p.labels.map((_, i) =>
    p.series.reduce((total, s) => total + s.values[i], 0),
  );
  const max = Math.max(1, ...totals);
  return (
    <div
      role="img"
      aria-label={summary(p.labels, p.series, p.unit)}
      style={{ minWidth: 0, fontSize: 12, overflowWrap: "anywhere" }}
    >
      <Legend series={p.series} unit={p.unit} />
      <div style={{ display: "grid", gap: 12 }}>
        {p.labels.map((label, i) => (
          <div key={i} style={{ display: "grid", gap: 4 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>{label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(totals[i])} {p.unit}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                height: 20,
                borderRadius: 4,
                overflow: "hidden",
                background: "var(--muted)",
              }}
            >
              {p.series.map((s, j) => (
                <span
                  key={j}
                  data-series={s.name}
                  title={`${s.name}: ${format(s.values[i])} ${p.unit}`}
                  style={{
                    width: `${(s.values[i] / max) * 100}%`,
                    background: palette[j],
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
