      );
      writeFileSync(
        join(bin, "hyperframes"),
        `#!${process.execPath}
const assert = require('node:assert/strict');
