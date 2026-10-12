// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Checkbox,
  TextInput,
  ResetButton,
  Details,
  CompositionResetContext,
  interactiveProps,
} from "./interactive-primitives";
afterEach(cleanup);
function Fields() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("Base");
  return (
    <>
      <Checkbox label="Include tax" value={enabled} setValue={setEnabled} />
      <TextInput label="Scenario" value={text} setValue={setText} />
      <output>
        {enabled ? "Included" : "Excluded"}: {text}
      </output>
      <ResetButton />
    </>
  );
}
function LocalComposition() {
  const [epoch, setEpoch] = useState(0);
  return (
    <CompositionResetContext.Provider value={() => setEpoch((n) => n + 1)}>
      <div key={epoch}>
        <Fields />
      </div>
    </CompositionResetContext.Provider>
  );
}
it("binds boolean and text controls to local state", () => {
  render(<LocalComposition />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Include tax" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Scenario" }), {
    target: { value: "Optimistic" },
  });
  expect(screen.getByText("Included: Optimistic")).toBeTruthy();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
});
it("resets local controls to their declared defaults", () => {
  render(<LocalComposition />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Changed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset inputs" }));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Base");
  expect(screen.getByText("Excluded: Base")).toBeTruthy();
});
it("supports bounded multiline text and placeholders", () => {
  function Notes() {
    const [value, setValue] = useState("");
    return (
      <TextInput
        label="Notes"
        value={value}
        placeholder="Add an assumption"
        multiline
        setValue={setValue}
      />
    );
  }
  render(<Notes />);
  const field = screen.getByRole("textbox", { name: "Notes" });
  expect(field.tagName).toBe("TEXTAREA");
  expect(field.getAttribute("placeholder")).toBe("Add an assumption");
  expect(field.getAttribute("maxlength")).toBe("4000");
  fireEvent.change(field, { target: { value: "First line\nSecond line" } });
  expect((field as HTMLTextAreaElement).value).toBe("First line\nSecond line");
  fireEvent.change(field, { target: { value: "x".repeat(4001) } });
  expect((field as HTMLTextAreaElement).value).toBe("First line\nSecond line");
});
it("uses native disclosure semantics for additional content", () => {
  const { container } = render(
    <Details summary="Assumptions">
      <p>Income stays constant.</p>
    </Details>,
  );
  const details = container.querySelector("details");
  expect(details?.open).toBe(false);
  fireEvent.click(screen.getByText("Assumptions"));
  expect(details?.open).toBe(true);
  expect(screen.getByText("Income stays constant.")).toBeTruthy();
});
it("keeps text and option input schemas bounded and supplies defaults", () => {
  expect(
    interactiveProps.TextInput.parse({ label: "Name", value: "" }),
  ).toMatchObject({ placeholder: "", multiline: false });
  expect(interactiveProps.ResetButton.parse({})).toEqual({
    label: "Reset inputs",
  });
  expect(() =>
    interactiveProps.TextInput.parse({
      label: "Name",
      value: "x".repeat(4001),
    }),
  ).toThrow();
  expect(() =>
    interactiveProps.Checkbox.parse({ label: "Option", value: "true" }),
  ).toThrow();
  expect(() =>
    interactiveProps.Details.parse({
      summary: "More",
      children: Array(25).fill(null),
    }),
  ).toThrow();
});
