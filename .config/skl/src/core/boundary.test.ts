import { expect, test } from "bun:test";
import { Glob } from "bun";

// Mechanical enforcement of the functional-core boundary: nothing under core/
// may import from the imperative shell. If this fails, an I/O dependency has
// leaked into the pure core.
test("core/** imports only core/**", async () => {
  const glob = new Glob("*.ts");
  const offenders: string[] = [];
  for await (const file of glob.scan({ cwd: import.meta.dir })) {
    if (file.endsWith(".test.ts")) continue;
    const text = await Bun.file(`${import.meta.dir}/${file}`).text();
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    for (const spec of imports) {
      const isRelativeCore = spec.startsWith("./");
      const isAllowedBuiltin = spec === "bun";
      if (!isRelativeCore && !isAllowedBuiltin) {
        offenders.push(`${file} → ${spec}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
