      HYPERFRAMES_PLUGIN_VERSION: "",
      HYPERFRAMES_SKILL_PKG_VERSION: "0.8.79",
      PATH: `${root}${delimiter}${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "managed-cli");
});
