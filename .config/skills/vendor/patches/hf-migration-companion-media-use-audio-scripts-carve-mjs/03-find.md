    fail(
      `cannot load @hyperframes/core from ${fromDir}\n` +
        `  is it installed there?  npm i -D @hyperframes/core\n` +
        `  or point at one:   --core <dir containing node_modules/@hyperframes/core>\n` +
        `  (${error.code ?? "error"}: ${error.message.split("\n")[0]})`,
