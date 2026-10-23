
test(
  "plugin resolver uses the release CLI without a repository checkout",
  { skip: process.platform === "win32" },
  (t) => {
