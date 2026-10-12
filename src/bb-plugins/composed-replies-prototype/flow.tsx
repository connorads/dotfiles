import { useLayoutEffect, useRef, useState, useId } from "react";
import { z } from "zod";
import { Icon, layoutProps } from "./layout-primitives";
export const flowProps = z
  .object({
    nodes: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          label: z.string().min(1).max(160),
          description: z.string().max(500).optional(),
          icon: layoutProps.Icon.shape.name.optional(),
        }),
      )
      .min(1)
      .max(12),
    edges: z
      .array(
        z.object({
          from: z.string().min(1).max(80),
          to: z.string().min(1).max(80),
          label: z.string().max(100).optional(),
        }),
      )
      .max(18),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (ids.size !== graph.nodes.length)
      ctx.addIssue({ code: "custom", message: "Flow node IDs must be unique" });
    const seen = new Set<string>();
    for (const edge of graph.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to))
        ctx.addIssue({
          code: "custom",
          message: "Flow edges must reference existing nodes",
        });
      const key = JSON.stringify([edge.from, edge.to]);
      if (seen.has(key))
        ctx.addIssue({ code: "custom", message: "Flow edges must be unique" });
      seen.add(key);
    }
    const active = new Set<string>(),
      done = new Set<string>();
    function visit(id: string): boolean {
      if (active.has(id)) return false;
      if (done.has(id)) return true;
      active.add(id);
      for (const edge of graph.edges.filter((e) => e.from === id))
        if (!visit(edge.to)) return false;
      active.delete(id);
      done.add(id);
      return true;
    }
    if (graph.nodes.some((n) => !visit(n.id)))
      ctx.addIssue({ code: "custom", message: "Flow must be acyclic" });
  });
type Graph = z.infer<typeof flowProps>;
type Connection = {
  edge: Graph["edges"][number];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  skip: boolean;
};
function layers(graph: Graph) {
  const depths = new Map<string, number>();
  function depth(id: string): number {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const parents = graph.edges.filter((e) => e.to === id);
    const value = parents.length
      ? Math.max(...parents.map((e) => depth(e.from))) + 1
      : 0;
    depths.set(id, value);
    return value;
  }
  graph.nodes.forEach((n) => depth(n.id));
  return Array.from({ length: Math.max(...depths.values()) + 1 }, (_, i) =>
    graph.nodes.filter((n) => depths.get(n.id) === i),
  );
}
export function Flow(input: Graph) {
  const graph = flowProps.parse(input),
    rows = layers(graph);
  const levels = new Map<string, number>();
  for (const [index, row] of rows.entries())
    for (const node of row) levels.set(node.id, index);
  const root = useRef<HTMLDivElement>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const marker = useId().replaceAll(":", "");
  const signature = JSON.stringify(graph);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    function measure() {
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const boxes = new Map(
        Array.from(
          container.querySelectorAll<HTMLElement>("[data-flow-node]"),
        ).map((el) => [el.dataset.flowNode, el.getBoundingClientRect()]),
      );
      setConnections(
        graph.edges.flatMap((edge) => {
          const a = boxes.get(edge.from),
            b = boxes.get(edge.to);
          return a && b
            ? [
                {
                  edge,
                  x1: a.left + a.width / 2 - bounds.left,
                  y1: a.bottom - bounds.top,
                  x2: b.left + b.width / 2 - bounds.left,
                  y2: b.top - bounds.top,
                  skip:
                    (levels.get(edge.to) ?? 0) - (levels.get(edge.from) ?? 0) >
                    1,
                },
              ]
            : [];
        }),
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container
      .querySelectorAll("[data-flow-node]")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // Equivalent renderer props do not restart observation.
  }, [signature]);
  return (
    <div style={{ minWidth: 0, overflowX: "auto" }}>
      <div
        ref={root}
        style={{
          position: "relative",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 56,
          paddingInline: 24,
          minWidth:
            Math.max(
              ...rows.map((row) => row.length * 112 + (row.length - 1) * 12),
            ) + 48,
        }}
      >
        <svg
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0L10 5L0 10" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          {connections.map(({ edge, x1, y1, x2, y2, skip }, index) => {
            const lane = 8 + index * 0.6;
            const middle = (y1 + y2) / 2;
            const label =
              edge.label &&
              (edge.label.length > 18
                ? `${edge.label.slice(0, 17)}…`
                : edge.label);
            return (
              <g key={JSON.stringify([edge.from, edge.to])}>
                <path
                  data-flow-edge={`${edge.from}→${edge.to}`}
                  d={
                    skip
                      ? `M${x1},${y1} V${y1 + 18} H${lane} V${y2 - 18} H${x2} V${y2}`
                      : `M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${y2}`
                  }
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth="1.5"
                  markerEnd={`url(#${marker})`}
                />
                {label && (
                  <text
                    x={skip ? (x2 + lane) / 2 : (x1 + x2) / 2}
                    y={skip ? y2 - 22 : middle - 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--foreground)"
                    stroke="var(--background)"
                    strokeWidth="3"
                    paintOrder="stroke"
                  >
                    <title>{edge.label}</title>
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
              gap: 12,
              position: "relative",
            }}
          >
            {row.map((node) => (
              <div
                key={node.id}
                data-flow-node={node.id}
                style={{
                  minWidth: 0,
                  padding: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--background)",
                  overflowWrap: "anywhere",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 6 }}
                >
                  {node.icon && <Icon name={node.icon} size="small" />}
                  <strong style={{ fontSize: 13, minWidth: 0 }}>
                    {node.label}
                  </strong>
                </div>
                {node.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      marginTop: 6,
                    }}
                  >
                    {node.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {graph.edges.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              cursor: "pointer",
            }}
          >
            Connections ({graph.edges.length})
          </summary>
          <ul
            aria-label="Flow connections"
            style={{
              margin: "12px 0 0",
              paddingLeft: 18,
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {graph.edges.map((edge) => (
              <li key={JSON.stringify([edge.from, edge.to])}>
                {graph.nodes.find((n) => n.id === edge.from)?.label} →{" "}
                {graph.nodes.find((n) => n.id === edge.to)?.label}
                {edge.label ? `: ${edge.label}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
