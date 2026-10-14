// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompositionView } from "./app";
import { parseComposition } from "./validation";
import { IconLabel, layoutProps } from "./layout-primitives";
afterEach(cleanup);
const source =
  'root = Stack([Heading("Connector flow", 2), Box([Row([Icon("database", "medium", "Database"), Caption("Source systems")], 2, "center", "center")], "muted", true, "medium", 2, 2, "center"), Icon("arrow-down", "small", "Feeds into"), Row([Chip("Worker", "accent"), Divider()], 1, "center", "start"), NumberInput("Workers", $n, 1, 8, 1, ""), Caption($n)])\n$n = 2';
const json = JSON.stringify({
  root: "root",
  state: { n: 2 },
  elements: {
    root: {
      type: "Stack",
      props: {},
      children: ["heading", "box", "arrow", "row", "control", "caption"],
    },
    heading: {
      type: "Heading",
      props: { text: "Connector flow", level: 2 },
      children: [],
    },
    box: {
      type: "Box",
      props: {
        surface: "muted",
        border: true,
        radius: "medium",
        padding: 2,
        gap: 2,
        align: "center",
      },
      children: ["source"],
    },
    source: {
      type: "Row",
      props: { gap: 2, align: "center", justify: "center" },
      children: ["db", "sourceCaption"],
    },
    db: {
      type: "Icon",
      props: { name: "database", size: "medium", label: "Database" },
      children: [],
    },
    sourceCaption: {
      type: "Caption",
      props: { text: "Source systems" },
      children: [],
    },
    arrow: {
      type: "Icon",
      props: { name: "arrow-down", size: "small", label: "Feeds into" },
      children: [],
    },
    row: {
      type: "Row",
      props: { gap: 1, align: "center", justify: "start" },
      children: ["chip", "divider"],
    },
    chip: {
      type: "Chip",
      props: { text: "Worker", tone: "accent" },
      children: [],
    },
    divider: { type: "Divider", props: {}, children: [] },
    control: {
      type: "NumberInput",
      props: {
        label: "Workers",
        value: { $bindState: "/n" },
        min: 1,
        max: 8,
        step: 1,
        unit: "",
      },
      children: [],
    },
    caption: {
      type: "Caption",
      props: { text: { $state: "/n" } },
      children: [],
    },
  },
});
for (const [format, input] of [
  ["openui", source],
  ["json-render", json],
] as const)
  it(`${format} composes labelled icons, boxes and text hierarchy`, () => {
    render(
      <CompositionView
        composition={parseComposition({ format, source: input, title: "Flow" })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Connector flow", level: 2 }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "Database" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Feeds into" })).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByText("Source systems")).toBeTruthy();
    expect(screen.getByText("Worker")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "4" },
    });
    expect(screen.getByText("4", { selector: "p" })).toBeTruthy();
  });
for (const format of ["openui", "json-render"] as const)
  it(`${format} applies compact defaults and hides decorative icons`, () => {
    const input =
      format === "openui"
        ? 'root = Box([Row([Icon("check"), Heading("Done"), Chip("Ready"), Caption("<b>Literal</b>")])])'
        : JSON.stringify({
            root: "box",
            elements: {
              box: { type: "Box", props: {}, children: ["row"] },
              row: {
                type: "Row",
                props: {},
                children: ["icon", "heading", "chip", "caption"],
              },
              icon: { type: "Icon", props: { name: "check" }, children: [] },
              heading: {
                type: "Heading",
                props: { text: "Done" },
                children: [],
              },
              chip: { type: "Chip", props: { text: "Ready" }, children: [] },
              caption: {
                type: "Caption",
                props: { text: "<b>Literal</b>" },
                children: [],
              },
            },
          });
    const { container } = render(
      <CompositionView
        composition={parseComposition({
          format,
          source: input,
          title: "Defaults",
        })}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Done" }),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(screen.getByText("<b>Literal</b>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("div")).some(
        (x) => x.style.flexWrap === "wrap",
      ),
    ).toBe(true);
  });
for (const format of ["openui", "json-render"] as const)
  it(`${format} rejects unregistered icon names`, () => {
    const input =
      format === "openui"
        ? 'root = Stack([Icon("arbitrary-svg", "small", "Bad")])'
        : JSON.stringify({
            root: "root",
            elements: {
              root: {
                type: "Icon",
                props: { name: "arbitrary-svg" },
                children: [],
              },
            },
          });
    if (format === "openui")
      expect(() =>
        parseComposition({ format, source: input, title: "Invalid icon" }),
      ).toThrow();
    else {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        render(
          <CompositionView
            composition={parseComposition({
              format,
              source: input,
              title: "Invalid icon",
            })}
          />,
        );
        expect(screen.queryByRole("img")).toBeNull();
        expect(errors).toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    }
  });

it("keeps a decorative icon grouped beside wrapping label text", () => {
  const { container } = render(
    <IconLabel
      icon="database"
      text="A source name which wraps onto several lines"
    />,
  );
  const group = container.firstElementChild as HTMLElement;
  expect(group.style.display).toBe("flex");
  expect(group.style.flexWrap).toBe("nowrap");
  expect(group.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(
    screen.getByText("A source name which wraps onto several lines").style
      .overflowWrap,
  ).toBe("anywhere");
  expect(
    layoutProps.IconLabel.safeParse({ icon: "made-up", text: "Source" })
      .success,
  ).toBe(false);
});

for (const [format, input] of [
  [
    "openui",
    'root = Stack([NumberInput("Workers", $n, 10, 20, 1, ""), Caption($n)])\n$n = 12',
  ],
  [
    "json-render",
    JSON.stringify({
      root: "root",
      state: { n: 12 },
      elements: {
        root: { type: "Stack", props: {}, children: ["control", "caption"] },
        control: {
          type: "NumberInput",
          props: {
            label: "Workers",
            value: { $bindState: "/n" },
            min: 10,
            max: 20,
            step: 1,
            unit: "",
          },
          children: [],
        },
        caption: {
          type: "Caption",
          props: { text: { $state: "/n" } },
          children: [],
        },
      },
    }),
  ],
] as const)
  it(`${format} number input lets a draft pass outside its range`, () => {
    render(
      <CompositionView
        composition={parseComposition({ format, source: input, title: "N" })}
      />,
    );
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "1" } });
    expect(field.value).toBe("1");
    expect(screen.getByText("12", { selector: "p" })).toBeTruthy();
    fireEvent.change(field, { target: { value: "15" } });
    expect(screen.getByText("15", { selector: "p" })).toBeTruthy();
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("20");
    expect(screen.getByText("20", { selector: "p" })).toBeTruthy();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(field.value).toBe("20");
  });
