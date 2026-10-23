        "Parakeet is not installed. Install it with: hyperframes models install parakeet";
      writeFileSync(
        join(bin, "npx"),
        `#!/bin/sh\necho '{"ok":false,"error":"${reason}"}'\nexit 1\n`,
      );
      chmodSync(join(bin, "npx"), 0o755);
      const input = join(root, "in.wav");
      writeFileSync(input, "");
