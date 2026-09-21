---
name: page-mascot
description: Put a cursor-tracking mascot on a page -- a chibi character that turns its head toward the pointer and reacts when clicked. Picks one of the fifty-two drawn characters and wires up the React component, or draws a new one (with your own image tool, the OpenAI images API, or from a photo of the user), builds its two sprite sheets into aligned atlases and verifies they do not jump. Use when the user asks for a mascot, a character that watches the cursor, a portfolio head, wants one of the existing characters on their page, or wants a new character drawn.
---

# Mascot

Turns "put a fox on my page" or "draw me a chibi otter" into a working `<Mascot />`.

Each character is two 3×3 sprite sheets: nine head directions, and nine expressions. The
component swaps between them by moving `background-position`, so there is no per-frame
JavaScript and no animation library. A character is its two files -- there is no registry
and nothing has to know its name.

## Which route

- **The user names a character, or would take one that exists** -- *Use one that is
  drawn*. No Python, no API key, works in any React project. This is the common case.
- **The user wants something new, or their own likeness** -- *Draw a new one*, then
  finish with *Put it on the page*.

Both routes end in *Put it on the page*. Do not stop at files and a snippet.

## Use one that is drawn

1. **Pick.** `reference/characters.md` lists the fifty-two. If the user did not name one,
   pick the one that fits the site, and say which you picked and why.

2. **Fetch the two sheets** into wherever this project serves static files -- `public/`
   for Next, Vite, CRA and Astro, `static/` for SvelteKit -- or next to the component to
   import them:

   <!-- LOCAL PATCH (connorads dotfiles): character sheets are fetched from the upstream repo on raw.githubusercontent.com rather than the author's separate site, so the assets come from the same host the skill itself is vendored from and survive that domain lapsing. -->

   ```bash
   mkdir -p public/mascots
   curl -fsSL -o public/mascots/fox-directions.webp https://raw.githubusercontent.com/nilbuild/page-mascot/main/public/mascots/fox-directions.webp
   curl -fsSL -o public/mascots/fox-reactions.webp  https://raw.githubusercontent.com/nilbuild/page-mascot/main/public/mascots/fox-reactions.webp
   ```

3. **Put it on the page** (below).

## Put it on the page

**Install the component.** Use whichever package manager the lockfile points at:
`npm i page-mascot`, `pnpm add page-mascot`, `yarn add page-mascot`, or
`bun add page-mascot`. If this is not a package-managed React project, copy `mascot.tsx`
from beside this SKILL.md into the project instead -- it is one file, needs only React,
and uses inline styles.

**Render it:**

```tsx
import { Mascot } from 'page-mascot'

<Mascot
  directions="/mascots/fox-directions.webp"
  reactions="/mascots/fox-reactions.webp"
/>
```

`directions` and `reactions` are the served paths of the two sheets, or imported images.
Both required. The other props are `size` (default 140), `label` (what a screen reader
calls it) and `className`.

**Put it where the user asked.** If they did not say, the top of the page -- the header or
hero, above or beside the title, which is where a head that watches the cursor reads best.
Edit the actual component; then tell the user what you changed and where.

## Draw a new one

### First, work out how you will draw

Two sheets have to be drawn per character, and agents differ in whether they can do that
themselves. Check in this order:

1. **You have a built-in image generation tool** (Codex does). Use it directly -- follow
   *Drawing it yourself* below. Find out first whether it can return a transparent
   background, because that decides which prompt you send: with the option, ask for
   transparency and set it; without one, draw on a solid key colour and remove it
   afterwards. Both are written out under *Transparency*.
2. **`OPENAI_API_KEY` is set.** Use the API path, which needs no image tool at all --
   follow *Drawing through the API*. This is the route for Claude Code, which has no image
   tool. `generate.py` asks for transparency through the API's `background` parameter and
   falls back to the key route on its own if no alpha comes back.
3. **Neither.** Say plainly that drawing needs either an agent that can generate images or
   an `OPENAI_API_KEY`, and offer two alternatives: one of the fifty-two drawn characters
   (*Use one that is drawn*), or the manual route in `reference/prompts.md`, where the user
   pastes the prompts into a chat UI themselves. Do not try to drive a web UI in a browser
   to work around it: it depends on the page's markup, needs a logged-in session, and gets
   rate-limited part way through a set.

<!-- LOCAL PATCH (connorads dotfiles): the build scripts run under `uv`, which resolves their dependencies per-run from requirements.txt; upstream's bare `pip install` targets whatever python3 is on PATH and creates no environment of its own. -->

Either way, the build runs under `uv`, which fetches the scripts' dependencies itself:

```bash
uv --version
```

If that fails, stop and say so rather than working around it. There is no `pip install`
step and no virtualenv to create.

`<skill-dir>` everywhere below is the folder holding this SKILL.md -- the skill is
usually installed outside the project, so use its full path. Run every command from the
project root: the scripts read source sheets from `characters/<name>/` and write the built
atlases to `public/mascots/` under the current directory. Pass `--dest static/mascots` (or
wherever this project serves static files) when `public/` is not it.

### Drawing through the API

One command generates, screens, builds, verifies and retries:

```bash
uv run --with-requirements <skill-dir>/scripts/requirements.txt \
  <skill-dir>/scripts/mascot.py fox --describe "a chibi fox with warm orange fur, a cream muzzle and dark ear tips"
```

Add `--style riso` for a different look, or `--reference ~/photo.jpg` to redraw someone.
`--only reactions` redraws just the expressions sheet and keeps the directions sheet.
If the model returns no alpha channel, it redraws that sheet on a solid key colour and
removes it, which costs one extra image; `--key green` forces that route from the start.
`requirements.txt` already lists `openai`, so the command above covers it. The image
model is pinned in `generate.py`; set `MASCOT_IMAGE_MODEL` to use a different one.

### Drawing it yourself

**1. Draw the directions sheet.** Use your image generation tool with the DIRECTIONS
prompt from `reference/prompts.md`, substituting the character description. If your tool
cannot return a transparent background, send the key variant of that prompt instead and
turn the option off -- see *Transparency* below, and send the same variant for both
sheets. Save it to `characters/<name>/directions.png`.

**2. Draw the expressions sheet.** Use the EXPRESSIONS prompt, and pass the directions
sheet you just made as a reference image. Save it to `characters/<name>/reactions.png`.

**3. Build and verify.**

```bash
uv run --with-requirements <skill-dir>/scripts/requirements.txt \
  <skill-dir>/scripts/mascot.py <name> --skip-generate
```

**4. Act on what it says.** It either finishes and tells you the character is ready,
or it names which of the two sheets is at fault. Redraw that one sheet and run step 3
again. Give up after two attempts and change the description instead -- past that the art
is the problem, not the build.

Run the commands yourself. Do not print them for the user to copy.

### Check the head turns point the right way

The scripts measure everything except which direction the character is actually looking.
Before you hand a character over, crop the `left` cell (middle row, first column) and the
`right` cell (middle row, third column) of the directions sheet and look at them: the left
one must face the viewer's left.

A sheet occasionally comes back mirrored, and it scores perfectly on every check while
looking away from the cursor on the page. Do not regenerate it -- the art is right and only
the cell order is wrong. `reference/design-rules.md` has the three-line column swap that
fixes it.

### Transparency is the thing that most often goes wrong

The sheets **must** end up as PNGs with a real alpha channel, and **the prompt cannot get
you one**. Transparency is a setting on the image call -- `background: "transparent"` on
the OpenAI API, the equivalent option on a built-in tool -- not something a model does
because it was asked in words. Measured over fifteen sheets on `gpt-image-2.5`: with the
option set, every sheet came back with real alpha whether or not the prompt mentioned
transparency at all; without it, every sheet came back opaque with a **painted
grey-and-white checkerboard** behind the character. That includes a prompt demanding "PNG
WITH A REAL ALPHA CHANNEL... not white" in capitals. Unable to emit alpha, the model draws
the pattern that stands for it.

So there are two prompts, and which one you send depends on the tool, not on the
character:

- **The tool can return a transparent background.** Set that option, and use the prompts
  in `reference/prompts.md` as they are.
- **It cannot.** Then asking for transparency is the one thing you must not do, because
  that is what summons the checkerboard -- and a checkerboard is unrecoverable, its
  squares run under the character's edges. Send the **key variant** of the prompt instead
  (`reference/prompts.md`, *Drawing without transparency*): it asks for a flat pure green
  background and mentions transparency nowhere. Then remove that green:

  ```bash
  python3 <skill-dir>/scripts/key.py characters/<name>/directions.png --in-place
  ```

  `mascot.py` does this for you when it finds a sheet on a solid key colour, so normally
  you can just run the build and let it happen.

Hedging does not work. A prompt that asks for transparency and adds "use green if you
cannot" gets the checkerboard, same as before. The two prompts are alternatives, never
combined.

`screen.py` names which case you are in:

| what it prints | what happened | what to do |
| --- | --- | --- |
| `alpha: ok` | real alpha channel | nothing |
| `alpha: MISSING (solid #02F902 background -- key.py can remove it)` | drawn on the key colour | key it out, or let `mascot.py` do it |
| `alpha: MISSING (painted checkerboard, 32px squares -- redraw)` | asked for transparency a tool could not give | redraw with the right prompt for your tool |
| `alpha: MISSING (opaque background)` | flattened onto white or a scene | redraw; nothing can be keyed out of this |

The last two cannot be repaired. A white background cannot be keyed because the
character's own cream and white areas would go with it, which is also why the key colour
is a saturated green and never white, grey or black.

### Writing the description

This decides whether the result is good, so spend a sentence on it rather than passing
the user's word through raw. "fox" gives a worse fox than "a cute chibi fox with warm
orange fur, a cream muzzle and dark ear tips". Name the colours and two or three
distinguishing features, in one sentence.

Avoid, because each breaks the alignment the effect depends on:

- **Long loose hair over the shoulders.** Tie it back or put it under a hat. It gets drawn
  differently in each sheet and the mascot lurches when clicked. Most common failure by far.
- **Anything wider than the head** -- big wings, wide headdresses. They get clipped at the
  cell edges.
- **Held props.** Staffs, mugs, instruments. The framing is head and shoulders only.

Good: `a chibi robot with a mint-green boxy head and a single wide visor screen`,
`a chibi grandmother with silver hair in a neat bun and round gold spectacles`.

### Drawing in another style

Six looks are available: `colour` (the default), `ink`, `sketch`, `riso`, `paper` and `pixel`.
They change only how the character is drawn -- the framing, proportions, reused body and
margins are shared, so a style cannot break the alignment.

`reference/prompts.md` has the paragraph for each. Swap it into both prompts for that
character, and name the style again in the EXPRESSIONS prompt so the second sheet does not
drift back to the default. Through the API path it is a flag:

```bash
uv run --with-requirements <skill-dir>/scripts/requirements.txt \
  <skill-dir>/scripts/mascot.py fox --style riso --describe "a chibi fox with orange fur"
```

Keep one style per character across both its sheets. The caveats for `ink`, `sketch` and
`pixel` are at the bottom of `reference/prompts.md` -- read them before using those three.

### From a user's own image

Same loop, but for step 1 pass their image to your image tool with the REFERENCE prompt
from `reference/prompts.md`. It redraws their character as a directions sheet in the
style the pipeline needs. Step 2 onward is unchanged.

### Afterwards

Built atlases land in `public/mascots/<name>-{directions,reactions}.webp` (or `--dest`).
The source sheets stay in `characters/<name>/` so a character can be rebuilt without
redrawing it; say so, and leave it to the user whether to keep or delete them.

Then *Put it on the page*.

### Making several

One at a time, reporting as you go.

## Going deeper

`reference/design-rules.md` explains why each art rule exists, what each failure looks
like, and how the two sheets are matched. Read it when a character fails in a way the
script's messages do not cover.
