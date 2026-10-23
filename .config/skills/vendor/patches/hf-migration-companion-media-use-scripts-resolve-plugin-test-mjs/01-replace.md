
test(
  "plugin resolver uses the managed CLI without a repository checkout",
  { skip: process.platform === "win32" },
  (t) => {
