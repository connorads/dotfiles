# Process & Systems

This governs ordering and mindset for any fresh build: design features before shells, lock tone early, and constrain every choice into a system.

## Sequence

How to move from nothing to a shipped feature.

**Start with a feature, not the shell.** Design a concrete piece of functionality first, not the nav, header, or page container. An app is the sum of its features; until you've built a few you lack the information to decide how the shell should behave.

**Design the smallest real task.** Pick one user job and design only the elements it needs - the fields and the action - and nothing else. A narrow, real task gives you something tangible to judge decisions against instead of an abstract layout.

**Defer low-level detail.** In early passes, skip typefaces, shadows, icons, and fine polish; settle layout and structure first. Detail matters eventually, but fixating on it early stalls exploration of the bigger ideas.

**Sketch low-fidelity to explore.** Work ideas in a deliberately crude medium - paper, thick marker, rough wireframe - that makes fiddling with detail impossible. Low fidelity forces speed and lets you try many directions without getting precious about any one.

**Start in grayscale.** Hold off on colour; refine the first higher-fidelity passes in shades of grey only. Without colour you're forced to build hierarchy through spacing, contrast, and size, giving a stronger base to enhance later.

**Don't over-invest in mockups.** Treat sketches and wireframes as disposable: explore, decide, discard, then build the real thing. Static mockups have no user value; the point of low fidelity is to reach something usable fast.

**Don't design everything up front.** Avoid designing every feature and edge case before implementation - design less than you think you need. Predicting how every screen behaves in the abstract is extremely hard and breeds frustration.

**Work in short cycles.** Design a simple version of the next feature, build it for real, iterate on the working version, then move to the next feature. Fixing problems in an interface you can actually use beats imagining every edge case in advance.

**Build real early.** Get a working implementation in front of yourself as soon as possible rather than leaning on imagination. Real usage surfaces the unexpected complexity that static design can't reveal.

**Don't imply unbuilt functionality.** Leave out elements for features you aren't ready to build - an attachments panel you can't wire up yet shouldn't appear. Designing in dependencies you can't finish blocks shipping the whole feature; a reduced version beats nothing.

**Ship the smallest useful version.** Assume new features are hard to build, design the minimum shippable version, and add nice-to-haves in a later pass. A minimal version always leaves you something to fall back on and ship.

## Personality

Tone is deliberate and driven by a few concrete levers.

**Give the design a personality.** Decide the emotional tone on purpose - secure and formal versus fun and playful - and let it drive concrete choices. Personality feels vague but resolves to a handful of controllable factors.

**Pick type for tone.** Choose typefaces to match the feel: a serif for elegant or classic, a rounded sans for playful, a neutral sans for plain. Typography is one of the strongest signals of how a design feels.

**Choose colour by feel.** Select a palette by how the colours read for the brand: blue feels safe and familiar, gold expensive, pink fun and light. The choice is mostly instinct, but naming the feeling justifies it.

**Use radius to set tone.** Tune corner rounding to the personality - small reads neutral, large reads playful, none reads formal. Even this tiny detail shifts the overall character noticeably.

```css
--radius-neutral: 4px;
--radius-playful: 16px;
--radius-formal: 0;
```

**Keep corners consistent.** Commit to one corner treatment across the interface; don't mix square and rounded. Mixed corner styles in the same UI almost always look worse than picking one.

**Write in a deliberate voice.** Treat wording as a design lever: impersonal copy reads official, casual copy reads friendly. Words are everywhere in an interface and shape personality as much as colour or type.

**Borrow tone from your audience.** When unsure, look at the other sites your target users frequent and match their seriousness or playfulness. Their existing context is a reliable guide to what will resonate.

**Don't copy competitors.** Avoid borrowing heavily from direct competitors for your direction. Imitation makes you look like a second-rate version of something else.

## Systems & decisions

Replace open-ended choices with predefined scales.

**Limit your options.** Don't design from limitless pools of colours, sizes, and fonts; constrain yourself to small predefined sets. Unlimited choice is paralysing because there's always more than one defensible answer.

**Define systems in advance.** Pick a fixed set of shades and a restrictive type scale ahead of time, then choose only from those. Doing the hard picking once removes the decision fatigue of every new screen.

```css
--text-xs: 12px;
--text-sm: 14px;
--text-base: 16px;
--text-lg: 20px;
--text-xl: 24px;
--text-2xl: 32px;
```

**Decide by elimination.** To pick a value, guess a middle option, compare the steps on either side, discard the obviously worse ones, and converge. When options differ noticeably, most are clearly wrong, making the best easy to find.

**Make scale steps distinct.** Space the values in each scale far enough apart that adjacent options look obviously different. If neighbours are nearly indistinguishable, you're back to agonising over meaningless choices.

**Systematise every variable.** Build constrained scales for font size, weight, line height, colour, margin, padding, width, height, shadow, radius, border width, and opacity. More systems mean faster work and less second-guessing of low-level decisions.

**Adopt a system-first mindset.** You needn't define every system up front, but introduce one the moment you catch yourself labouring over a low-level value, and never make the same minor decision twice. Capturing decisions as reusable systems compounds speed and consistency over time.
