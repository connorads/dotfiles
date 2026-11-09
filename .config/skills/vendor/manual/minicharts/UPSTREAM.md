# Upstream

- Author: April Zhu
- Website: https://april-zhu.com/minicharts
- Archive: https://april-zhu.com/minicharts/minicharts.tar.gz
- Archive SHA-256: `34265e5757aa054ee2fde6e1eb4c0b5218fd6db0168003421a22c2824ba804ca`
- Licence: MIT. Preserve LICENSE and NOTICE.md.

This catalogue-only skill uses a manual archive snapshot. It has no skills-CLI lock entry.

## Refresh

1. Download the archive into a fresh temporary directory and record its SHA-256.
2. Inspect the archive paths before extracting it into that temporary directory.
3. Compare the extracted skill with this directory, excluding UPSTREAM.md. Review all changed instructions and code.
4. Build example pages with `python3 assets/build.py --examples pie,bar,funnel -o /tmp/minicharts-preview.html`.
5. Run `python3 assets/check.py /tmp/minicharts-preview.html` and inspect the screenshot and interactions.
6. Copy the reviewed files into this directory and update the archive checksum here.
