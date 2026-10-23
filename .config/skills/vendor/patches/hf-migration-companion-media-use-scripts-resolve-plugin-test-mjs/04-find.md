);

test("helper package override keeps a contributor's local CLI", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hf-resolve-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
