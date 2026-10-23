    }
    writeFileSync(
      join(dir, "hyperframes"),
      `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),skip:process.env.HYPERFRAMES_SKIP_SKILLS}));process.exit(7);`,
      { mode: 0o755 },
