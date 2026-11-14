# One switcher chooses model, effort and Claude account

Agent Switcher has one popover and one composer chip for the model, its effort
and the Claude account. The [plugin guide](../../claude-profiles/README.md#switcher)
describes its use.

## Context

Choosing what runs the next turn used four surfaces and about ten shortcuts:

| Surface | Shortcuts |
| --- | --- |
| BB's native model picker | ⌘⇧M, Alt+M, Alt+P, Alt+T and their Shift variants |
| Agent Switcher model picker | Alt+F, Alt+Shift+F |
| Agent Switcher account picker | Alt+A |
| Usage overlay | ⌘⇧A |

A favourite held a model and effort only, so a model on a given account took
three steps across surfaces. The connector panel added five controls for a
setting that changes rarely.

## Decision

- One popover opens on ⌘⇧M or the composer chip. Digits choose favourites,
  letters choose accounts and `/` searches every model. Alt+1-9 choose a
  favourite without opening it. The usage overlay stays separate.
- The account is a separate choice from the model, not part of a favourite.
  Account choice follows quota, which changes hourly, and a model-account
  favourite would multiply slots. The account row shows only when the current
  provider has more than one account.
- Each account keeps one letter: the first letter of its name that no earlier
  account holds. Sidebar badges show the same letter.
- A favourite remembers the last effort and service tier used with it. A
  Daybreak variant is its own favourite.
- An account chosen during a turn waits for the next idle moment. The dispatch
  hook answers `wait` while the transcript moves beside it, because hooks run
  under one server-wide lock with a 10 second limit.
- Connectors keep an account preference, set in plugin settings, and the CLI
  thread restriction. The global switch and the explicit restart action go.
- A content script hides BB's native model trigger with one CSS rule.

## Rejected

- **Account inside each favourite.** One key press reaches a model on an
  account, but slots multiply and saved accounts ignore current quota.
- **Positional account keys (Q, W, E).** They carry no meaning and move when an
  account is added.
- **Replacing BB's composer** through `experimental_composer`. It hides the
  native picker without CSS but takes over the editor, mentions, attachments,
  voice and send, on an API that changed between 0.48 and 0.49.

## Consequences

- A BB markup change shows the native trigger again beside the chip. The CSS
  rule hides nothing else.
- BB's `modelPicker.*` shortcuts are unbound through live keyboard overrides.
- New-thread drafts still set Daybreak through BB's native picker, which the
  hide removes; Daybreak applies after the first message.
- Remove the CSS rule when BB offers a slot that hides only the native trigger.
