    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["media-use", "resolve", "--intent", "a & b"],
      skip: "1",
    });
