# Depth & Elevation

Techniques for making flat pixels read as physical layers: where light comes from, how far an element floats above the page, and how to fake depth even without shadows.

## The Light Model

Every depth cue assumes one consistent light source. Get the model right and raised vs. inset reads instantly.

- **Light from above.** Model all shading on a single overhead light: surfaces tilted up catch light and lighten, surfaces tilted down fall into shadow. A fixed light direction is what makes relief legible to the eye.
- **Pick the profile first.** Decide whether the element is raised or recessed before touching highlights or shadows, then shade its edges to suit that shape. Shadows only read as depth when they describe one coherent physical profile.
- **Reveal the top edge.** On a raised element, draw a thin lighter highlight along the top edge and leave the bottom edge plain. Viewers look slightly down at a screen, so only the upward-facing top edge would catch light.

```css
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4); /* top highlight */
```

- **Hand-pick the highlight colour.** Choose a deliberate lighter shade for top highlights instead of stacking a translucent white overlay. Layered white desaturates the colour beneath it and looks washed out.
- **Cast a shadow below.** Give a raised element a small dark drop shadow nudged downward so it sits below the element only. A lifted object blocks light from the floor beneath it, and that occlusion sells the rise.

```css
box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
```

- **Keep contact shadows sharp.** For low lift, use a tiny blur radius (a couple of pixels), not a broad soft cloud. Objects close to a surface throw crisp, tight shadows.
- **Inset the bottom lip.** For a recessed element, lighten the bottom edge with a bottom border or an inset shadow offset upward. In a well, only the upward-facing bottom lip catches light from above.

```css
box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.4);
```

- **Inset a top shadow.** Add a small dark inset shadow offset downward at the top of a recessed element. The surrounding surface blocks light from the top of the well; apply this to text inputs and checkboxes too.

```css
box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
```

- **Don't over-skeuomorph.** Borrow just enough real-world light to suggest depth, then stop; chasing photorealism makes interfaces busy and unclear for no usability gain.

## Distance & Elevation

Shadow size is a position on the z-axis. Treat elevation as a system, not a per-element decoration.

- **Shadow size equals distance.** Small tight shadows for slightly raised elements; larger, blurrier shadows for elements meant to feel close to the viewer. Spread maps to z-position.
- **Closer pulls focus.** Reserve the largest elevation for what you most want noticed and keep ambient UI low. The nearer something feels, the more attention it commands.
- **Match elevation to role.** Scale shadow strength by job: subtle for buttons, medium for dropdowns, large for modal dialogs. Elevation should reflect how far above the rest an element genuinely sits.
- **Define an elevation scale.** Build a fixed set of reusable shadows (around five) rather than inventing one per element. A constrained palette, like a spacing or type scale, keeps depth consistent and fast to apply.

```css
--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.1);
--shadow-2: 0 2px 4px rgba(0, 0, 0, 0.1);
--shadow-3: 0 4px 8px rgba(0, 0, 0, 0.12);
--shadow-4: 0 8px 16px rgba(0, 0, 0, 0.14);
--shadow-5: 0 16px 32px rgba(0, 0, 0, 0.16);
```

- **Build the scale from the ends.** Set the smallest and largest shadow first, then interpolate the middle steps roughly linearly. Anchoring the extremes gives an even, predictable ramp.
- **Use shadows as interaction feedback.** Raise an element's shadow on grab or click so it pops forward, signalling it is active or draggable. Dynamic elevation tells users the element responds.
- **Press down on click.** On button press, shrink or drop the shadow so the element feels pushed into the page. Reduced elevation mimics a physical depression and confirms the click.
- **Think z-position, not shadow.** Decide where an element should sit on the z-axis, then pick the shadow that matches. Reasoning about depth instead of appearance makes the choice fast and consistent.

## Two-Layer Shadows

A single shadow can't do two jobs. Split it: one broad cast shadow, one tight contact shadow.

- **Layer two shadows.** Compose elevation from two stacked shadows, each with a distinct job. Separating the cast shadow from the contact shadow gives far more control than one shadow can.
- **Large soft cast shadow.** Make the first shadow bigger and softer, with a notable vertical offset and wide blur. It simulates the broad shadow a direct light throws behind an object.
- **Tight dark contact shadow.** Make the second shadow tighter and darker, with little offset and small blur, hugging the element's edges. It simulates the deep shadow where even ambient light can't reach beneath the object.
- **Fade the contact shadow with height.** Weaken the tight contact shadow as elevation rises: distinct at the lowest level, near-invisible at the highest. As an object lifts off a surface, its ambient-occlusion shadow disappears.

```css
/* single element */
box-shadow:
  0 10px 20px rgba(0, 0, 0, 0.12), /* soft cast */
  0 2px 4px rgba(0, 0, 0, 0.18);   /* tight contact */

/* elevation ramp: contact shadow fades as height grows */
--elev-1:
  0 1px 2px rgba(0, 0, 0, 0.1),
  0 1px 1px rgba(0, 0, 0, 0.2);
--elev-3:
  0 8px 16px rgba(0, 0, 0, 0.12),
  0 2px 3px rgba(0, 0, 0, 0.12);
--elev-5:
  0 24px 40px rgba(0, 0, 0, 0.14),
  0 4px 6px rgba(0, 0, 0, 0.04);
```

## Depth Without Shadows

Flat designs still layer; they just trade light simulation for other cues.

- **Flat can still have depth.** Convey layering without shadows or gradients by leaning on colour, offset, and overlap. Effective flat design communicates depth, it just avoids literal lighting.
- **Depth through colour.** Make an element lighter than its background to feel raised, darker to feel inset. Within shades of one colour, lighter reads as nearer and darker as further.
- **Solid offset shadows.** Lift cards or buttons with a short, vertically offset shadow at zero blur. A hard-edged offset adds depth while keeping the flat aesthetic.

```css
box-shadow: 0 4px 0 rgba(0, 0, 0, 0.15);
```

- **Overlap to layer.** Offset elements so they cross the boundary between two backgrounds instead of nesting fully inside one. Overlap reads as distinct stacked layers, one of the strongest depth cues there is.
- **Bridge two sections.** Make an element taller than its parent so it spans both adjoining regions, or let small controls straddle their container edge. Crossing a boundary on both sides reinforces separate layers, even for tiny components.
- **Invisible border on images.** Give overlapping images a border in the background colour to hold a gap between them. A background-coloured border stops adjacent images clashing while preserving the layered look.

```css
border: 4px solid var(--page-bg);
```
