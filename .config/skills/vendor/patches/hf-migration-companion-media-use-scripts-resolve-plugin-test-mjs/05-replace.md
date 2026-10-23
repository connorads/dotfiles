    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(scripts, file));
  }
  writeFileSync(join(root, "packages/cli/dist/cli.js"), 'throw new Error("unmanaged checkout must not run");');
  writeFileSync(join(root, "hyperframes"), `#!${process.execPath}\nconsole.log("managed-cli");`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [join(scripts, "resolve.mjs")], {
    encoding: "utf8",
