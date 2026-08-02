---
- this
- is
- a yaml list
- not a mapping
---

# Malformed

Frontmatter parses to a non-mapping (array), so name cannot be read.
Falls back to dir basename "malformed", empty description.
