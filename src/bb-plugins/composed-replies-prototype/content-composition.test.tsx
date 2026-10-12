// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompositionView } from "./app";
import { parseComposition } from "./validation";
afterEach(cleanup);
for (const format of ["openui", "json-render"] as const)
  it(`${format} renders content and updates bound progress`, () => {
    const items = [
      { title: "Collect", status: "done" },
      { title: "Review", status: "current" },
    ];
    const source =
      format === "openui"
        ? `root = Stack([RichText("**Project** [Guide](https://example.com)"), Slider("Complete", $n, 0, 100, 1, "%"), Progress("Reading", $n), Steps(${JSON.stringify(items)}), Image("https://example.com/image.png", "Source illustration", "Example")])\n$n = 20`
        : JSON.stringify({
            root: "root",
            state: { n: 20 },
            elements: {
              root: {
                type: "Stack",
                props: {},
                children: ["text", "slider", "progress", "steps", "image"],
              },
              text: {
                type: "RichText",
                props: { text: "**Project** [Guide](https://example.com)" },
                children: [],
              },
              slider: {
                type: "Slider",
                props: {
                  label: "Complete",
                  value: { $bindState: "/n" },
                  min: 0,
                  max: 100,
                  step: 1,
                  unit: "%",
                },
                children: [],
              },
              progress: {
                type: "Progress",
                props: { label: "Reading", value: { $state: "/n" } },
                children: [],
              },
              steps: { type: "Steps", props: { items }, children: [] },
              image: {
                type: "Image",
                props: {
                  src: "https://example.com/image.png",
                  alt: "Source illustration",
                  caption: "Example",
                },
                children: [],
              },
            },
          });
    render(
      <CompositionView
        composition={parseComposition({ format, source, title: "Content" })}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Guide" }).getAttribute("href"),
    ).toBe("https://example.com");
    expect(
      screen.getByRole("listitem", { name: "Collect, done" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Reading" })
        .getAttribute("value"),
    ).toBe("20");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "60" } });
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("60");
    fireEvent.error(screen.getByRole("img", { name: "Source illustration" }));
    expect(screen.getByText("Image unavailable")).toBeTruthy();
  });
