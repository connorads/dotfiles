      );
      writeFileSync(
        join(bin, "npx"),
        `#!${process.execPath}
const assert = require('node:assert/strict');
