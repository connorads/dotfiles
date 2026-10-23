);

test("resolver ignores repository and plugin bootstrap paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hf-resolve-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
