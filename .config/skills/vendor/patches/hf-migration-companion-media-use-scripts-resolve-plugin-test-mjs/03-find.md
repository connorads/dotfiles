    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["--yes", "hyperframes@1.2.3", "media-use", "resolve", "--intent", "a & b"],
      skip: "1",
    });
