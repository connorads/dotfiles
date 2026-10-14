# Chip pop-ups share one ChipPopover

Every header chip that opens a pop-up renders it with `ChipPopover` from
[`@bb-plugins/chip`](../../chip/README.md). It owns placement under the chip,
the modal `<dialog>`, `aria-modal`, close on Escape or a backdrop press, the
key guard, focus return to the chip and the popover surface.

## Context

caffeine, git-glance, machine-health and the vox-recorder library each held a
hand copy of the same shell: a `place(anchor)` function, `showModal()` on
mount, a backdrop hit test and `if (event.key !== 'Escape') event.stopPropagation()`.
The copies drifted, as the chips did before [ADR 0002](0002-shared-header-chip-package.md):

- `aria-modal="true"` was on two of the four. BB derives `modalOpen` only from
  `aria-modal` or `[role="dialog"][data-state="open"]`, so it did not treat the
  other two as modal.
- Focus returned to the chip in three; vox left it on `<body>`.
- Entrance and reduced-motion handling were in three; machine-health had none.
- The surface read `--canvas` and `--ink` with hex fallbacks, `--border-hairline`
  and literal black shadows, where popover tokens exist.

## Decision

- `chip/popover.tsx` and `chip/popover.css` hold `ChipPopover`. Plugins pass
  their own keys through `onKeyDown` and sub-screen exits through `onEscape`.
- The surface uses `--popover`, `--popover-foreground`, `--border`,
  `--shadow-color`, a 14 px radius and a backdrop of 22% `--background`.
- Pop-ups that are not anchored to a chip keep their own shell: the
  claude-profiles model picker and the vox title prompt are centred modals, the
  handsfree card is a non-modal `role="dialog"` element, and cache-hits has no
  pop-up.

## Alternatives considered

- **Add `aria-modal` to the two dialogs that lacked it.** This fixes the bug
  once. The next shell fix would still need four edits.
- **Share only a `place()` helper.** Placement drifted least. Modal semantics,
  focus return and the surface drifted most.

## Consequences

- Plugin stylesheets are global, as ADR 0002 records. A plugin override of a
  `bbp-popover*` rule needs a selector that names both classes, or the copy of
  `popover.css` loaded last wins. After a change to `chip/`, run
  `pnpm build:chip` and reload every dependant.
- Centred fallback placement is 10% from the top for all four; caffeine used 14%.
- machine-health gains the shared entrance animation.
