# Terminal Tweaks

Kitty-like behaviour for BB's built-in terminal.

| Behaviour | BB default | With this plugin |
| --- | --- | --- |
| Option key | Types macOS characters (`∫`, `ƒ`) | Meta: Option+b sends `ESC b` |
| Cursor | Blinks | Steady |
| Kitty keyboard protocol | Off | On for programs that request it, so Shift+Enter is distinct |
| OSC 52 clipboard writes | Ignored | Copied to the system clipboard; reads are refused |
| Selection | Copy by hand | Copied on mouse-up |

BB creates its xterm.js terminals with fixed options and exposes no setting
or SDK hook for them. A content script finds each `.xterm` element, reads the
Terminal instance from a ref in the owning React component's fiber, then
changes options at runtime. xterm.js reads these options on every key or
escape sequence, so runtime changes take effect. Unloading the plugin restores
BB's values.

Option as Meta also turns off macOS Option characters, for example `#` on a UK
keyboard (Option+3). xterm.js cannot apply Meta to only the left Option key.

Option+Left/Right still send `ESC[1;3D`/`ESC[1;3C`. The shell maps those to
word motion; see the `bindkey` lines in `~/.zshrc`.

If a BB update breaks it, check that `.xterm` still sits in a component that
holds the Terminal in a `useRef` within 40 fibers of the host element.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
