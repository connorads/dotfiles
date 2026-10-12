// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RichText,
  Image,
  Steps,
  Progress,
  contentProps,
} from "./content-primitives";
afterEach(cleanup);
it("renders rich text and safe links without interpreting HTML or unsafe schemes", () => {
  const { container } = render(
    <RichText
      text={
        "**Bold** and *soft* with `code`\n\n- First\n- [Docs](https://example.com)\n\n<script>alert(1)</script> [Bad](javascript:alert)"
      }
    />,
  );
  expect(container.querySelector("strong")?.textContent).toBe("Bold");
  expect(container.querySelector("em")?.textContent).toBe("soft");
  expect(container.querySelector("code")?.textContent).toBe("code");
  expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
    "https://example.com",
  );
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByRole("link", { name: "Bad" })).toBeNull();
  expect(screen.getByRole("list").children).toHaveLength(2);
});
it("requires an HTTPS image and preserves alternative text when loading fails", () => {
  expect(
    contentProps.Image.safeParse({ src: "javascript:alert(1)", alt: "Photo" })
      .success,
  ).toBe(false);
  render(
    <Image
      src="https://example.com/photo.png"
      alt="Mountain lake"
      caption="A quiet lake"
    />,
  );
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    "Mountain lake",
  );
  expect(screen.getByText("Image unavailable")).toBeTruthy();
  expect(screen.getByText("A quiet lake")).toBeTruthy();
});
it("keeps ordered steps and exposes the current step", () => {
  render(
    <Steps
      items={[
        { title: "Gather", status: "done" },
        { title: "Build", description: "Make it", status: "current" },
        { title: "Check", status: "pending" },
      ]}
    />,
  );
  expect(screen.getAllByRole("listitem").map((x) => x.textContent)).toEqual([
    "✓Gather",
    "2BuildMake it",
    "3Check",
  ]);
  expect(screen.getAllByRole("listitem")[1]?.getAttribute("aria-current")).toBe(
    "step",
  );
  expect(screen.getByRole("listitem", { name: "Gather, done" })).toBeTruthy();
  expect(screen.getByRole("listitem", { name: "Check, pending" })).toBeTruthy();
});
it("updates accessible progress and rejects values above its maximum", () => {
  expect(
    contentProps.Progress.safeParse({ label: "Reading", value: 101, max: 100 })
      .success,
  ).toBe(false);
  expect(
    contentProps.Progress.safeParse({
      label: "Reading",
      value: 1e9 + 1,
      max: 1e9 + 1,
    }).success,
  ).toBe(false);
  const view = render(<Progress label="Reading" value={20} max={40} />);
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("20");
  view.rerender(<Progress label="Reading" value={40} max={40} />);
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("40");
});
