A marker-selected profile is never copied over the installed working copy.

{{marker}}

**This install is read-only.** It is a vendored copy under version control, refreshed in place by `skills update`, so a write to `references/style-guide.md` is committed to a dotfiles repo *and* clobbered on the next refresh. Every branding route therefore ends at a profile, never at the working copy: save the tokens to `~/.diagram-design/profiles/<slug>.md` and write a `<project-root>/.diagram-design` marker naming that slug. Options (a)-(d) below are all subject to this - leave `references/style-guide.md` byte-for-byte as shipped.
