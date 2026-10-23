    fail(
      `cannot load @hyperframes/core from ${fromDir}\n` +
        `  install with quarantine and scripts protection intact: pnpm add -D --save-exact @hyperframes/core@0.8.46\n` +
        `  or point at one:   --core <dir containing node_modules/@hyperframes/core>\n` +
        `  (${error.code ?? "error"}: ${error.message.split("\n")[0]})`,
