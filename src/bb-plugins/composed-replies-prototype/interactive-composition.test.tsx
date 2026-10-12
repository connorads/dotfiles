// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompositionView } from "./app";
import { parseComposition } from "./validation";
afterEach(cleanup);
const openui =
  'root = Stack([TextInput("Scenario", $name), Checkbox("Include tax", $include), Text($name), Details("Assumptions", [Text("Only local inputs change.")]), ResetButton()])\n$name = "Base"\n$include = false';
const json = JSON.stringify({
  root: "root",
  state: { name: "Base", include: false },
  elements: {
    root: {
      type: "Stack",
      props: {},
      children: ["input", "option", "echo", "details", "reset"],
    },
    input: {
      type: "TextInput",
      props: { label: "Scenario", value: { $bindState: "/name" } },
      children: [],
    },
    option: {
      type: "Checkbox",
      props: { label: "Include tax", value: { $bindState: "/include" } },
      children: [],
    },
    echo: { type: "Text", props: { text: { $state: "/name" } }, children: [] },
    details: {
      type: "Details",
      props: { summary: "Assumptions" },
      children: ["note"],
    },
    note: {
      type: "Text",
      props: { text: "Only local inputs change." },
      children: [],
    },
    reset: { type: "ResetButton", props: {}, children: [] },
  },
});
for (const [format, source] of [
  ["openui", openui],
  ["json-render", json],
] as const)
  it(`${format} changes local inputs and restores declared defaults with reset`, () => {
    render(
      <CompositionView
        composition={parseComposition({
          format,
          source,
          title: "Local controls",
        })}
      />,
    );
    const option = screen.getByRole("checkbox", {
      name: "Include tax",
    }) as HTMLInputElement;
    const input = screen.getByRole("textbox", {
      name: "Scenario",
    }) as HTMLInputElement;
    expect(option.checked).toBe(false);
    expect(input.value).toBe("Base");
    expect(input.placeholder).toBe("");
    expect(screen.getByText("Assumptions").closest("details")?.open).toBe(
      false,
    );
    fireEvent.click(option);
    fireEvent.change(input, { target: { value: "Optimistic" } });
    expect(option.checked).toBe(true);
    expect(screen.getByText("Optimistic")).toBeTruthy();
    fireEvent.click(screen.getByText("Assumptions"));
    expect(screen.getByText("Assumptions").closest("details")?.open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset inputs" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Base",
    );
    expect(screen.getByText("Base")).toBeTruthy();
    expect(screen.getByText("Assumptions").closest("details")?.open).toBe(
      false,
    );
  });
