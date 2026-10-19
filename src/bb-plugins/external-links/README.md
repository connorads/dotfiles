# External Links

Chat web links have a separate arrow button that opens the system browser.
Ordinary link clicks follow BB's existing browser preference. File and relative
app links retain their own actions. Default file links show a side-panel icon
instead of an external-link arrow. Inline-vis preview headers use the same side-panel symbol. Labelled external-browser
actions use an external arrow. Generic editor actions use a code-window symbol;
editor-specific icons retain their appearance. This covers the audited chat,
preview and browser controls, not every third-party plugin surface.

```mermaid
flowchart LR
  Link[Chat web link] --> Text[Click link text]
  Link --> Arrow[Click arrow]
  Text --> Preference[BB browser preference]
  Arrow --> System[System browser]
```

The plugin uses BB content scripts to decorate timeline Markdown anchors.
It observes streamed content and URL changes, and removes its buttons on disable.
The selectors depend on BB's DOM markers and may need updating after BB changes.
On desktop, BB's window-open handler sends the arrow action to the system browser.
On web clients, the action opens a separate browser tab.

Build, test, install and reload through the [workspace guide](../README.md).
