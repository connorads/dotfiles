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
  labelWidth: number;
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
  const [gap, setGap] = useState(72);
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
                  labelWidth: Math.max(
                    80,
                    (graph.edges.filter((e) => e.to === edge.to).length > 1
                      ? a.width
                      : b.width) - 12,
                  ),
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
  useLayoutEffect(() => {
    const captions = root.current?.querySelectorAll<HTMLElement>(
      "[data-flow-caption]",
    );
    if (!captions?.length) return;
    const measure = () =>
      setGap(
        Math.max(
          72,
          ...Array.from(
            captions,
            (caption) => Math.ceil(caption.getBoundingClientRect().height) + 40,
          ),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    captions.forEach((caption) => observer.observe(caption));
    return () => observer.disconnect();
  }, [connections]);
  return (
    <div style={{ minWidth: 0, overflowX: "auto" }}>
      <div
        ref={root}
        style={{
          position: "relative",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap,
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
            const joins =
              graph.edges.filter((connection) => connection.to === edge.to)
                .length > 1;
            const splits =
              graph.edges.filter((connection) => connection.from === edge.from)
                .length > 1;
            const rail = joins ? y2 - 14 : splits ? y1 + 14 : (y1 + y2) / 2;
            const arrow =
              connections.findIndex(
                (connection) => connection.edge.to === edge.to,
              ) === index;
            return (
              <path
                key={JSON.stringify([edge.from, edge.to])}
                data-flow-edge={`${edge.from}→${edge.to}`}
                d={
                  skip
                    ? `M${x1},${y1} V${y1 + 14} H${lane} V${y2 - 14} H${x2} V${y2}`
                    : `M${x1},${y1} V${rail} H${x2} V${y2}`
                }
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                markerEnd={arrow ? `url(#${marker})` : undefined}
              />
            );
          })}
        </svg>
        {connections.map(({ edge, x1, y1, x2, y2, skip, labelWidth }) => {
          if (!edge.label) return null;
          const joins =
            graph.edges.filter((connection) => connection.to === edge.to)
              .length > 1;
          return (
            <div
              key={JSON.stringify([edge.from, edge.to])}
              data-flow-caption={`${edge.from}→${edge.to}`}
              aria-hidden="true"
              style={{
                position: "absolute",
                zIndex: 1,
                left: skip ? (x2 + 8) / 2 : joins ? x1 : x2,
                top: skip ? y2 - gap / 2 : (y1 + y2) / 2,
                width: labelWidth,
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  padding: "2px 4px",
                  fontSize: 11,
                  lineHeight: 1.4,
                  overflowWrap: "anywhere",
                  background: "var(--background)",
                  color: "var(--foreground)",
                  borderRadius: 3,
                }}
              >
                {edge.label}
              </span>
            </div>
          );
        })}
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
