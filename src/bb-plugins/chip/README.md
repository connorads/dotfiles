# Chip

The thread-header chip every bb-plugins header action shares. The reasons and
the rebuild rule are in [ADR 0002](../docs/adr/0002-shared-header-chip-package.md).

```tsx
import { Chip, ChipDot, ChipValue } from '@bb-plugins/chip';

<Chip icon={<Icon name="GitBranch" />} expanded={isOpen} aria-label={label} onClick={toggle}>
  <ChipValue>main</ChipValue>
  <ChipDot tone="warn">3</ChipDot>
</Chip>
```

- `Chip` is a button. Pass `expanded` only when it opens a dialog.
- `tone` is `warn` or `danger`. It tints the border, and `danger` the text too.
- `ChipValue` is the one figure in foreground colour. Other text stays muted.
- `ChipDot` is a 6 px status dot (`ok`, `warn` or `danger`) with an optional count.
- Without a pop-up or with several icons, put the `bbp-chip` classes on your own
  element and import the package for its CSS.

After a change here, rebuild and reload every plugin that depends on it:
`grep -l '@bb-plugins/chip' */package.json`.

Run `pnpm test` and `pnpm typecheck` from this directory.
