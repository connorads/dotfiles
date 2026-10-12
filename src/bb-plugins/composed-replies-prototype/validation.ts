import { z } from "zod";
import { createParser } from "@openuidev/react-lang";
import { type Spec } from "@json-render/core";
import { catalog, library } from "./catalogue";
import { inputSchema, type Composition } from "./contracts";

export function parseComposition(value: unknown): Composition {
  const input = inputSchema.parse(value);
  if (input.format === "openui") {
    const result = createParser(library.toJSONSchema()).parse(input.source);
    if (result.meta.errors.length || result.meta.unresolved.length)
      throw new Error("Invalid OpenUI components or unresolved references");
    if (!result.root) throw new Error("Missing OpenUI root");
    if (
      result.meta.incomplete ||
      result.queryStatements.length ||
      result.mutationStatements.length ||
      result.meta.statementCount > 100
    )
      throw new Error("Unsupported or incomplete OpenUI program");
    let nodes = 0;
    function inspect(v: unknown, depth = 0) {
      if (depth > 30) throw new Error("OpenUI depth exceeded");
      if (Array.isArray(v)) {
        if (v.length > 100) throw new Error("Array limit exceeded");
        v.forEach((x) => inspect(x, depth + 1));
      } else if (v && typeof v === "object") {
        if ("typeName" in v && ++nodes > 50)
          throw new Error("Component limit exceeded");
        Object.values(v).forEach((x) => inspect(x, depth + 1));
      }
    }
    inspect(result.root);
  } else parseSpec(input.source);
  return input;
}
export function parseSpec(source: string): Spec {
  const raw: unknown = JSON.parse(source);
  const result = catalog.validate(raw);
  if (!result.success)
    throw new Error(
      "Invalid component specification " + JSON.stringify(result.error),
    );
  const base = z.object({
    root: z.string(),
    elements: z.record(
      z.string(),
      z.object({
        type: z.string(),
        props: z.record(z.string(), z.unknown()),
        children: z.array(z.string()).optional(),
      }),
    ),
    state: z.record(z.string(), z.unknown()).optional(),
  });
  const spec = base.parse(raw);

  if (
    Object.values(spec.elements).some(
      (e) => !catalog.componentNames.includes(e.type),
    )
  )
    throw new Error("Unknown component");
  if (Object.keys(spec.elements).length > 50)
    throw new Error("Component limit exceeded");
  const seen = new Set<string>();
  const active = new Set<string>();
  function visit(id: string, depth: number) {
    if (depth > 15 || active.has(id))
      throw new Error("Component cycle or excessive depth");
    if (seen.has(id)) return;
    const e = spec.elements[id];
    if (!e) throw new Error("Missing child component");
    active.add(id);
    for (const child of e.children ?? []) visit(child, depth + 1);
    active.delete(id);
    seen.add(id);
  }
  visit(spec.root, 0);
  const allowed = new Set(["$bindState", "$state", "$computed"]);
  function walk(v: unknown, depth = 0) {
    if (depth > 30) throw new Error("Expression depth exceeded");
    if (Array.isArray(v)) {
      if (v.length > 100) throw new Error("Array limit exceeded");
      v.forEach((x) => walk(x, depth + 1));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(k))
          throw new Error("Reserved key");
        if (
          (k === "$state" || k === "$bindState") &&
          (typeof x !== "string" ||
            x.length > 200 ||
            !x.startsWith("/") ||
            x
              .split("/")
              .some((s) =>
                ["__proto__", "prototype", "constructor"].includes(s),
              ))
        )
          throw new Error("Invalid state path");
        if (k.startsWith("$") && !allowed.has(k))
          throw new Error("Unsupported expression");
        if (
          k === "$computed" &&
          !["add", "sub", "mul", "div", "min", "max", "ceil", "floor"].includes(
            String(x),
          )
        )
          throw new Error("Unknown computation");
        if (["on", "repeat", "visible", "slots"].includes(k))
          throw new Error("Unsupported feature");
        walk(x, depth + 1);
      }
    }
  }
  walk(raw);
  return spec;
}
