  const result = spawn("npx", ["hyperframes", "--help"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
