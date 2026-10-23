    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(scripts, file));
  }
  writeFileSync(join(root, "packages/cli/dist/cli.js"), 'console.log("local-cli");');
  const result = spawnSync(process.execPath, [join(scripts, "resolve.mjs")], {
    encoding: "utf8",
