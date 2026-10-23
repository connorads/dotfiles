    mkdirSync(bin);
    writeFileSync(
      join(bin, "hyperframes"),
      `#!/bin/sh\necho "$@" > "${root}/args"\nwhile [ "$1" != "--dir" ]; do shift; done\n` +
        `echo '[{"text":"a","start":0,"end":1},{"text":"b","start":1,"end":2}]' > "$2/transcript.json"\n` +
        `echo '{"ok":true,"engine":"${cliEngine}"}'\n`,
    );
    chmodSync(join(bin, "hyperframes"), 0o755);
    const input = join(root, "in.wav");
    writeFileSync(input, "");
