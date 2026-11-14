# Interfaces: an app on @raea/ui, built state by state and checked by walking it

`modes/tool` says what an interface has to do for the person using it; this file is how to build one in raea and
show that it does. The verbs and the two targets are in the raea skill's "Apps: web or native".

## What to do

- Write down the task before the screen: who opens it, what they came to do, and the two or three steps that do it.
  The first screen opens on that task, with its next step in plain view.
- Pick the target from what the app needs, in its own file: `export const app = { target: "web", title, size,
  minSize }`. Web unless it is small, motion-heavy, has no 3D and passes the check on native. Give it a `size` it
  opens at and a `minSize` it never goes under, and lay it out to work across that range (flex, `md:` and up).
- Build every state as real UI the person can reach: empty (an invitation to start, with the action that starts),
  one item, many, a very long name, loading, an error that says what happened and what to do, done. Each one is a
  branch in the component, not a picture.
- Give the parts a check names `data-testid`, and give everything the person acts on a role and a label: a button is a
  `<button>` with words in it; something clickable that isn't one gets `role`, `tabIndex={0}` and `aria-label`.
  Keyboard reaches every action in reading order; Enter and Escape do what they do everywhere.
- Style with Tailwind classes or the brand's `--brand-*` variables (`motion/brand`), one accent for what can be acted
  on, `dark:` for the system's appearance. Real content: real names, real lengths, real numbers.
- Write `steps` that walk the task the way the person would, through every state, and run the check on each target
  the app should run on:
  `raea app check app.tsx --png out/` (and `--target native` too, when native is meant). Read every PNG and
  tree.json: each state looks designed, nothing is cut off, every control has its role and label.
- A note on an app is a move like any other (`adapt` for sizes, `clarify` for words, `harden` for the states that
  break, `optimize` for speed): read the move before changing the file.

## Why

The check only shows what the steps reach. An app checked at its first screen with no steps passes while its empty
list, its error and its long names are undesigned, and those are where people decide it's broken. tree.json is what a
screen reader and an agent driving the app see, so a control missing its role or label there is missing for them too.

## Common mistakes

- A check with no steps: one PNG of the first screen, and every other state unseen.
- An error that stays up after the person has fixed it: clear it as soon as they act.
- An empty state that is a blank area, or the words "No items" with nothing to do next.
- A `<div onClick>` for a button: no role, no label, not reachable by Tab.
- Placeholder content (Lorem ipsum, "Item 1", "John Doe") that hides how real lengths break the layout.
- Grid on the native target, or a prop native doesn't map: the check lists it in unmapped.json. Change it, or keep the
  app on web.
- A layout that only works at the size it opens at; resize to `minSize` in the steps' window or check with `--size`.

## Example: a list app whose steps walk every state

```tsx
import { useState } from "react";

export const app = { target: "web", title: "Shots", size: [420, 560], minSize: [340, 420] };

// the person's path: an empty list, a shot added, a long name, a bad name refused, one removed
export const steps = [
  { type: "Wide of the cubicle, morning light through the blinds onto the desk", into: "name" },
  { press: "add" },
  { type: "Close on the can", into: "name" },
  { press: "add" },
  { press: "add" },
  { press: "remove-0" },
];

export default function Shots() {
  const [shots, setShots] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const n = name.trim();
    if (!n) return setError("Name the shot first, in a few words.");
    setShots([...shots, n]);
    setName("");
    setError("");
  };
  return (
    <div data-testid="page" className="flex min-h-screen flex-col gap-4 bg-zinc-50 p-5 dark:bg-zinc-950">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Shot list</h1>
      <div className="flex flex-row gap-2">
        <input
          data-testid="name"
          aria-label="Shot name"
          value={name}
          onChange={(e) => (setName((e.target as HTMLInputElement).value), setError(""))}
          className="h-9 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button data-testid="add" onClick={add} className="h-9 rounded-md bg-amber-500 px-4 text-sm font-medium text-zinc-950">
          Add shot
        </button>
      </div>
      {error && <p data-testid="error" role="alert" className="text-sm text-red-600">{error}</p>}
      {shots.length === 0 ? (
        <div data-testid="empty" className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No shots yet</span>
          <span className="text-sm text-zinc-500">Name the first one above: what the camera sees, in a few words.</span>
        </div>
      ) : (
        <ul data-testid="list" className="flex flex-col gap-2">
          {shots.map((s, i) => (
            <li key={i} className="flex flex-row items-center gap-3 rounded-lg bg-white p-3 dark:bg-zinc-900">
              <span className="w-6 text-sm text-zinc-500">{i + 1}</span>
              <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-50">{s}</span>
              <button data-testid={`remove-${i}`} aria-label={`Remove shot ${i + 1}`} onClick={() => (setShots(shots.filter((_, j) => j !== i)), setError(""))} className="text-sm text-zinc-500 hover:text-zinc-900">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`raea app check shots.tsx --png out/` writes out/00-mount.png (the empty state) and one PNG per step: the long name
wrapping in the list, the error under the field when Add is pressed with nothing typed, the list after a removal.
