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
- A chip is at most 256 px wide, BB's header slot cap. A longer `ChipValue`
  ends in an ellipsis.
- `ChipDot` is a 6 px status dot (`ok`, `warn` or `danger`) with an optional count.
- Without a pop-up or with several icons, put the `bbp-chip` classes on your own
  element and import the package for its CSS.

When the thread header is 900 px wide or less, every `ChipValue` hides and the
chip shows only its icon and dot. The header is BB's `page-header` container, so
this follows pane width, not the viewport. Give each chip a `title` and
`aria-label` that carry the full value. Text outside `ChipValue` stays visible.

At pane widths up to 600 px, header actions occupy one horizontally scrollable
row below the title. Coarse-pointer chips have separate 44 px targets. Swiping
and keyboard focus reveal actions beyond the visible row.

## Thread header slot

`registerThreadHeaderChip` from `@bb-plugins/chip/header` registers a chip in the
thread header:

```tsx
registerThreadHeaderChip(app, { id: 'usage', title: 'Usage', component: ThreadUsage });
```

BB 0.48 retired `experimental_threadHeaderAction` from the SDK types but still
renders it. Its replacement, a header thread action, draws only a text button.
The helper keeps chips on the retired slot without a cast in each plugin. Move
chips to header thread actions once they can draw a toned badge
([get-bb/bb#7217](https://github.com/get-bb/bb/pull/7217)), or when BB removes
the slot.

## ChipPopover

A chip that opens a pop-up renders it with `ChipPopover`. The reasons are in
[ADR 0003](../docs/adr/0003-shared-chip-popover.md).

```tsx
import { ChipPopover } from '@bb-plugins/chip';

<ChipPopover aria-label="Git status" trigger={() => chipElement(threadId)} anchor={anchor} width={640}
  instant={openedByKey} panelClassName="gg-panel" onKeyDown={keyboard} onClose={close}>
  …
</ChipPopover>
```

- It is a `<dialog>` opened with `showModal()` and marked `aria-modal="true"`.
  BB sets `modalOpen` from `aria-modal` only, not from `showModal()`.
- It sits 8 px under the chip, right edges aligned, and stays on screen. It
  follows `trigger()` on resize; `anchor` is the fallback, and `null` centres it.
  `place` replaces this for a second layout, such as git-glance's zoom.
- When the chip's top is known and there is more room above the chip than below,
  the popover opens 8 px above it instead. `trigger()` always gives the top; give
  `anchor` a `top` so the fallback can open upwards too, as a composer chip near
  the bottom of the screen needs. A `place` result can set `bottom` to pin the
  panel's bottom edge; `top` is then ignored.
- A press on the backdrop calls `onClose` when released, so the tap does not
  reach what lies under the backdrop, such as the chip. Escape calls `onEscape`,
  or `onClose` if there is none. Put sub-screen exits such as "back" or "cancel
  rename" in `onEscape`. The popover stays open until you unmount it, so an
  `onClose` can keep it open while a form has unsaved input.
- Keys other than Escape stop at the popover, so BB's global shortcuts ignore
  them. Your `onKeyDown` still gets every key; plugin shortcuts live there.
- When the focused control unmounts or turns disabled or hidden, such as a
  sub-screen's input or a Save button during a save, focus moves to the dialog,
  so keys still reach the key guard and your `onKeyDown`.
- On close, focus returns to `trigger()`, unless an action moved focus outside.
- `instant` skips the entrance, for a popover opened by a shortcut. Reduced
  motion skips it always.
- The panel uses `--popover`, `--popover-foreground`, `--border`, a 14 px
  radius and `--shadow-color`. It is a flex column, capped at
  `min(720px, 100dvh - 80px)` and 12 px from the window edge on the side it
  opens towards, and scrolls when its content is taller.
- As flex items, the panel's children shrink before the panel scrolls. A child
  with `overflow: hidden` or `auto` can shrink to nothing. Give a child that must
  keep its height `flex: none`. For a fixed header over a scrolling list, give
  the list `min-height: 0; overflow-y: auto` instead.
- Stylesheets are global, so override a panel rule with both classes, for
  example `.bbp-popover-panel.sg-panel { max-height: 70vh; }`. A single class
  loses to whichever plugin's copy of `popover.css` loads last.

After a change here, run `pnpm build:chip` from the workspace root to rebuild
every plugin that depends on it, then reload each one.

Run `pnpm test` and `pnpm typecheck` from this directory.
