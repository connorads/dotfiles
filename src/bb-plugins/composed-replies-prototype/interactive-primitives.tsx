import {
  createContext,
  useContext,
  useId,
  type CSSProperties,
  type ReactNode,
} from "react";
import { z } from "zod";

const label = z.string().min(1).max(160);
const maxTextLength = 4000;
export const interactiveProps = {
  Checkbox: z.object({ label, value: z.boolean() }),
  TextInput: z.object({
    label,
    value: z.string().max(maxTextLength),
    placeholder: z.string().max(160).default(""),
    multiline: z.boolean().default(false),
  }),
  ResetButton: z.object({ label: label.default("Reset inputs") }),
  Details: z.object({ summary: label, children: z.array(z.unknown()).max(24) }),
};
export const CompositionResetContext = createContext<(() => void) | null>(null);

export function Checkbox({
  label,
  value,
  setValue,
}: z.infer<typeof interactiveProps.Checkbox> & {
  setValue: (value: boolean) => void;
}) {
  const id = useId();
  if (value === undefined) return <span role="status">Loading {label}...</span>;
  interactiveProps.Checkbox.parse({ label, value });
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontSize: 13,
        minWidth: 0,
        overflowWrap: "anywhere",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={value}
        onChange={(event) => setValue(event.target.checked)}
        style={{
          accentColor: "var(--primary)",
          width: 16,
          height: 16,
          flexShrink: 0,
          margin: 0,
        }}
      />
      <span>{label}</span>
    </label>
  );
}
export function TextInput(
  input: z.input<typeof interactiveProps.TextInput> & {
    setValue: (value: string) => void;
  },
) {
  const id = useId();
  if (input.value === undefined)
    return <span role="status">Loading {input.label}...</span>;
  const { label, value, placeholder, multiline } =
    interactiveProps.TextInput.parse(input);
  const style: CSSProperties = {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--background)",
    color: "var(--foreground)",
    font: "inherit",
    fontSize: 13,
  };
  const control = {
    id,
    value,
    placeholder,
    maxLength: maxTextLength,
    onChange: (event: { target: { value: string } }) => {
      if (event.target.value.length <= maxTextLength)
        input.setValue(event.target.value);
    },
    style,
  };
  return (
    <label
      htmlFor={id}
      style={{ display: "grid", gap: 6, minWidth: 0, fontSize: 13 }}
    >
      <span>{label}</span>
      {multiline ? (
        <textarea
          {...control}
          rows={3}
          style={{ ...style, resize: "vertical" }}
        />
      ) : (
        <input {...control} type="text" />
      )}
    </label>
  );
}
export function ResetButton(
  input: z.input<typeof interactiveProps.ResetButton>,
) {
  const reset = useContext(CompositionResetContext);
  const { label } = interactiveProps.ResetButton.parse(input);
  if (!reset)
    throw new Error("ResetButton requires a composition reset provider");
  return (
    <button
      type="button"
      onClick={reset}
      style={{
        justifySelf: "start",
        padding: "7px 10px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--background)",
        color: "var(--foreground)",
        font: "inherit",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
export function Details({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  interactiveProps.Details.shape.summary.parse(summary);
  return (
    <details style={{ minWidth: 0, fontSize: 13 }}>
      <summary
        style={{
          cursor: "pointer",
          color: "var(--foreground)",
          overflowWrap: "anywhere",
        }}
      >
        {summary}
      </summary>
      <div style={{ marginTop: 12, minWidth: 0 }}>{children}</div>
    </details>
  );
}
