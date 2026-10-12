import { z } from "zod";
import { type ReactNode } from "react";
const spacing = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
const text = z.union([
  z.string().max(4000),
  z.number().finite().min(-1e9).max(1e9),
]);
const children = z.array(z.unknown()).max(50);
const iconPaths = {
  "arrow-down": "M12 4v16m-6-6 6 6 6-6",
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  x: "m6 6 12 12M6 18 18 6",
  info: "M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  lightbulb: "M9 18h6m-6 3h6M9 18v-3a6 6 0 1 1 6 0v3",
  database:
    "M20 6c0 2-16 2-16 0s16-2 16 0v12c0 3-16 3-16 0V6m0 6c0 3 16 3 16 0",
  layers: "m12 3 10 6-10 6L2 9l10-6M2 13l10 6 10-6M2 17l10 6 10-6",
  file: "M14 2H4v20h16V8l-6-6v6h6M8 13h8M8 17h8",
  search: "M21 21l-6-6m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  clock: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  user: "M8 6a4 4 0 1 0 8 0 4 4 0 0 0-8 0M4 22v-3a8 8 0 0 1 16 0v3",
  cloud: "M6 18a5 5 0 1 1 1-10 6 6 0 0 1 12 2 4 4 0 0 1-1 8H6",
  mail: "M3 4h18v16H3V4m0 1 9 8 9-8",
  settings:
    "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
} as const;
const iconName = z.enum(
  Object.keys(iconPaths) as [
    keyof typeof iconPaths,
    ...(keyof typeof iconPaths)[],
  ],
);
export const layoutProps = {
  IconLabel: z.object({ icon: iconName, text: z.string().max(4000) }),
  Box: z.object({
    children,
    surface: z.enum(["plain", "muted"]).default("plain"),
    border: z.boolean().default(false),
    radius: z.enum(["none", "small", "medium"]).default("medium"),
    padding: spacing.default(2),
    gap: spacing.default(2),
    align: z.enum(["start", "center", "stretch"]).default("stretch"),
  }),
  Row: z.object({
    children,
    gap: spacing.default(2),
    align: z.enum(["start", "center", "end"]).default("center"),
    justify: z.enum(["start", "center", "between"]).default("start"),
  }),
  Icon: z.object({
    name: iconName,
    size: z.enum(["small", "medium"]).default("medium"),
    label: z.string().max(160).default(""),
  }),
  Heading: z.object({
    text,
    level: z.union([z.literal(2), z.literal(3)]).default(3),
  }),
  Caption: z.object({ text }),
  Divider: z.object({}),
  Chip: z.object({
    text: z.string().max(160),
    tone: z.enum(["neutral", "accent"]).default("neutral"),
  }),
};
export function Box({
  children,
  ...input
}: Omit<z.input<typeof layoutProps.Box>, "children"> & {
  children: ReactNode;
}) {
  const p = layoutProps.Box.parse({ ...input, children: [] });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        overflowWrap: "anywhere",
        gap: p.gap * 4,
        padding: p.padding * 4,
        alignItems: p.align === "start" ? "flex-start" : p.align,
        border: p.border ? "1px solid var(--border)" : undefined,
        borderRadius: { none: 0, small: 4, medium: 8 }[p.radius],
        background: p.surface === "muted" ? "var(--muted)" : undefined,
      }}
    >
      {children}
    </div>
  );
}
export function Row({
  children,
  ...input
}: Omit<z.input<typeof layoutProps.Row>, "children"> & {
  children: ReactNode;
}) {
  const p = layoutProps.Row.parse({ ...input, children: [] });
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        minWidth: 0,
        maxWidth: "100%",
        gap: p.gap * 4,
        alignItems: p.align === "center" ? "center" : `flex-${p.align}`,
        justifyContent:
          p.justify === "between"
            ? "space-between"
            : p.justify === "center"
              ? "center"
              : "flex-start",
      }}
    >
      {children}
    </div>
  );
}
export function Icon(input: z.input<typeof layoutProps.Icon>) {
  const p = layoutProps.Icon.parse(input);
  const size = p.size === "small" ? 16 : 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={p.label ? "img" : undefined}
      aria-label={p.label || undefined}
      aria-hidden={p.label ? undefined : true}
      style={{ flexShrink: 0, color: "inherit" }}
    >
      <path d={iconPaths[p.name]} />
    </svg>
  );
}
export function Heading(input: z.input<typeof layoutProps.Heading>) {
  if (input.text === undefined)
    return <span role="status">Loading heading...</span>;
  const p = layoutProps.Heading.parse(input);
  const Tag = p.level === 2 ? "h2" : "h3";
  return (
    <Tag
      style={{
        margin: 0,
        fontSize: p.level === 2 ? 18 : 15,
        fontWeight: 600,
        lineHeight: 1.35,
        overflowWrap: "anywhere",
      }}
    >
      {p.text}
    </Tag>
  );
}
export function Caption(input: z.input<typeof layoutProps.Caption>) {
  if (input.text === undefined)
    return <span role="status">Loading caption...</span>;
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--muted-foreground)",
        overflowWrap: "anywhere",
      }}
    >
      {layoutProps.Caption.parse(input).text}
    </p>
  );
}
export function Divider() {
  return (
    <hr
      style={{
        width: "100%",
        minWidth: 0,
        margin: 0,
        border: 0,
        borderTop: "1px solid var(--border)",
      }}
    />
  );
}
export function Chip(input: z.input<typeof layoutProps.Chip>) {
  if (input.text === undefined)
    return <span role="status">Loading chip...</span>;
  const p = layoutProps.Chip.parse(input);
  return (
    <span
      style={{
        display: "inline-block",
        maxWidth: "100%",
        boxSizing: "border-box",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 12,
        lineHeight: 1.5,
        overflowWrap: "anywhere",
        background: p.tone === "accent" ? "var(--accent)" : "var(--muted)",
        color:
          p.tone === "accent"
            ? "var(--accent-foreground)"
            : "var(--foreground)",
      }}
    >
      {p.text}
    </span>
  );
}

export function IconLabel(input: z.input<typeof layoutProps.IconLabel>) {
  if (input.text === undefined || input.icon === undefined) return null;
  const p = layoutProps.IconLabel.parse(input);
  return (
    <span
      style={{
        display: "flex",
        flexWrap: "nowrap",
        alignItems: "flex-start",
        gap: 8,
        minWidth: 0,
        maxWidth: "100%",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <span style={{ flexShrink: 0, paddingTop: 2 }}>
        <Icon name={p.icon} size="small" />
      </span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.text}</span>
    </span>
  );
}
