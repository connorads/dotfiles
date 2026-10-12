import { useState, type ReactNode } from "react";
import { z } from "zod";
const label = z.string().max(160);
const https = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an HTTPS URL without credentials");
export const contentProps = {
  RichText: z.object({ text: z.string().max(8000) }),
  Image: z.object({
    src: https,
    alt: z.string().min(1).max(300),
    caption: z.string().max(300).optional(),
  }),
  Steps: z.object({
    items: z
      .array(
        z.object({
          title: label,
          description: z.string().max(1000).optional(),
          status: z.enum(["pending", "current", "done"]).optional(),
        }),
      )
      .min(1)
      .max(16),
  }),
  Progress: z
    .object({
      label,
      value: z.number().finite().nonnegative().max(1e9),
      max: z.number().finite().positive().max(1e9).default(100),
    })
    .refine((p) => p.value <= p.max, "Progress must not exceed its maximum"),
};
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokens =
    /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    const start = match.index;
    parts.push(text.slice(offset, start));
    if (match[1] !== undefined)
      parts.push(<strong key={start}>{match[1]}</strong>);
    else if (match[2] !== undefined)
      parts.push(<em key={start}>{match[2]}</em>);
    else if (match[3] !== undefined)
      parts.push(
        <code
          key={start}
          style={{ fontFamily: "var(--font-mono)", fontSize: "0.9em" }}
        >
          {match[3]}
        </code>,
      );
    else if (match[4] !== undefined && match[5] !== undefined) {
      parts.push(
        https.safeParse(match[5]).success ? (
          <a
            key={start}
            href={match[5]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--primary)", textDecoration: "underline" }}
          >
            {match[4]}
          </a>
        ) : (
          match[0]
        ),
      );
    }
    offset = start + match[0].length;
  }
  parts.push(text.slice(offset));
  return parts;
}
export function RichText(p: z.infer<typeof contentProps.RichText>) {
  if (p.text === undefined) return null;
  contentProps.RichText.parse(p);
  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.6,
        overflowWrap: "anywhere",
        minWidth: 0,
      }}
    >
      {p.text.split(/\n\s*\n/).map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^[-*] /.test(line)))
          return (
            <ul key={index} style={{ margin: "0 0 8px", paddingLeft: 22 }}>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        if (lines.every((line) => /^\d+\. /.test(line)))
          return (
            <ol key={index} style={{ margin: "0 0 8px", paddingLeft: 22 }}>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(/^\d+\. /, ""))}</li>
              ))}
            </ol>
          );
        return (
          <p key={index} style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}
export function Image(p: z.infer<typeof contentProps.Image>) {
  const [failedSrc, setFailedSrc] = useState<string>();
  if (p.src === undefined || p.alt === undefined) return null;
  contentProps.Image.parse(p);
  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      {failedSrc === p.src ? (
        <div
          role="img"
          aria-label={p.alt}
          style={{
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--muted-foreground)",
          }}
        >
          Image unavailable
        </div>
      ) : (
        <img
          src={p.src}
          alt={p.alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailedSrc(p.src)}
          style={{
            display: "block",
            width: "100%",
            maxHeight: 360,
            objectFit: "contain",
            borderRadius: 8,
          }}
        />
      )}
      {p.caption && (
        <figcaption
          style={{
            fontSize: 12,
            color: "var(--muted-foreground)",
            marginTop: 6,
          }}
        >
          {p.caption}
        </figcaption>
      )}
    </figure>
  );
}
export function Steps(p: z.infer<typeof contentProps.Steps>) {
  if (p.items === undefined) return null;
  contentProps.Steps.parse(p);
  return (
    <ol
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: 12,
      }}
    >
      {p.items.map((item, i) => (
        <li
          key={i}
          aria-label={[item.title, item.status, item.description]
            .filter(Boolean)
            .join(", ")}
          aria-current={item.status === "current" ? "step" : undefined}
          style={{ display: "flex", gap: 12, minWidth: 0 }}
        >
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              color:
                item.status === "current"
                  ? "var(--primary)"
                  : "var(--muted-foreground)",
            }}
          >
            {item.status === "done" ? "✓" : i + 1}
          </span>
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <strong style={{ fontSize: 14 }}>{item.title}</strong>
            {item.description && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                  marginTop: 3,
                }}
              >
                {item.description}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function Progress(p: z.infer<typeof contentProps.Progress>) {
  if (p.value === undefined) return null;
  const value = contentProps.Progress.parse(p);
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div
        style={{
          fontSize: 12,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {value.label}
        </span>
        <span style={{ color: "var(--muted-foreground)", flexShrink: 0 }}>
          {Math.round((value.value / value.max) * 100)}%
        </span>
      </div>
      <progress
        aria-label={value.label}
        value={value.value}
        max={value.max}
        style={{ width: "100%", height: 8, accentColor: "var(--primary)" }}
      />
    </div>
  );
}
