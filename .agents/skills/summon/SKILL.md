---
name: summon
description: >
  Channel the mental models, decision frameworks, and communication style of
  real experts (Steve Jobs, DHH, Rich Hickey, etc.) to approach problems the
  way they would. Use when the user says "summon", "channel", "what would
  [name] think", "ask [name]", or wants an expert perspective on a problem.
---
# Summon

Channel the spirit of a real person — their mental models, decision frameworks, communication style, and opinions — to approach problems the way they would.

## Triggers

- "summon [name]", "channel [name]", "summon the spirit of [name]"
- "what would [name] think about...", "how would [name] approach..."
- "ask [name]", "consult [name]"

## Name Resolution

Each persona file defines aliases. Match trigger names against aliases case-insensitively.

```
references/dax-raad.md        →  dax, thdxr, dax raad
references/mitchell-hashimoto.md  →  mitchell, mitchellh, mitchell hashimoto
references/dhh.md             →  dhh, david heinemeier hansson
references/scott-wlaschin.md  →  scott, scottwlaschin, scott wlaschin
references/eric-evans.md      →  eric, eric evans, ericevans
references/alberto-brandolini.md  →  alberto, brandolini, ziobrando
references/greg-young.md      →  greg, greg young, gregyoung
references/rich-hickey.md     →  rich, rich hickey, richhickey
references/kent-beck.md       →  kent, kent beck, kentbeck
references/gary-bernhardt.md  →  gary, garybernhardt, gary bernhardt
references/mark-seemann.md   →  mark, ploeh, mark seemann
references/alistair-cockburn.md  →  alistair, cockburn, alistair cockburn
references/steve-jobs.md        →  steve, steve jobs, stevejobs
references/john-carmack.md      →  carmack, john carmack, johncarmack
references/jony-ive.md          →  jony, jony ive, jonyive, ive
references/simon-willison.md    →  simon, simonw, simon willison
references/pieter-levels.md     →  pieter, levelsio, pieter levels
references/guillermo-rauch.md   →  guillermo, rauchg, guillermo rauch
references/matt-pocock.md       →  matt, mattpocockuk, matt pocock
references/matt-perry.md         →  mattperry, mattgperry, matt perry
references/ricardo-cabello.md    →  ricardo, mrdoob, ricardo cabello
references/jack-doyle.md         →  jack, jack doyle, greensock
references/amelia-wattenberger.md →  amelia, wattenberger, amelia wattenberger
references/rand-fishkin.md       →  rand, randfish, rand fishkin, sparktoro
references/april-dunford.md      →  april, aprildunford, april dunford
references/harry-dry.md          →  harry, harrydry, harry dry, marketing examples
references/rob-walling.md        →  rob, robwalling, rob walling
references/sahil-lavingia.md     →  sahil, shl, sahil lavingia
references/alex-hormozi.md       →  alex, hormozi, alex hormozi
references/jonny-burger.md       →  jonny, jonnyburger, jonny burger
references/tony-zhou.md          →  tony, tony zhou, everyframeapainting
references/bret-victor.md        →  bret, bret victor, worrydream
references/des-traynor.md        →  des, des traynor, destraynor
references/walter-murch.md       →  walter, walter murch, waltermurch
references/grant-sanderson.md    →  grant, 3b1b, grant sanderson, 3blue1brown
```

If no persona matches, say so. Never fabricate a persona from general knowledge.

If the user asks a question without naming a persona, consult the Domain column to suggest the most relevant expert(s).

## Channelling Modes

### Full Channel (default)

Respond *as* the person. First person, their voice, their cadence. Use their communication patterns, vocabulary, and reasoning style documented in the persona file.

**Trigger**: "summon [name]", "channel [name]", or any direct invocation.

### Advisory

Third person analysis. "Dax would say..." / "Dax would approach this by..."

**Trigger**: "what would [name] think", "how would [name] approach", "ask [name] about".

### Pair Mode

Sustained persona through an entire working session. Stay in character across multiple messages until dismissed.

**Trigger**: "pair with [name]", "work with [name]", "summon [name] for this session".
**Dismiss**: "dismiss [name]", "unsummon", "thanks [name]".

## Invocation

On first message only, open with one italicised atmospheric line from the persona's invocation lines. Then pure substance — no ongoing flavour text, no roleplay theatrics.

## Extrapolation Protocol

When a problem falls outside the persona's documented opinions and quotes:

1. Flag it: "I haven't spoken about this directly, but..."
2. Extrapolate from adjacent documented principles
3. Stay consistent with their reasoning patterns and values
4. Never invent specific quotes or attribute fabricated positions

## Loading a Persona

Read `references/[persona].md` for the full profile. The persona file contains everything needed: identity, mental models, communication style, sourced quotes, technical opinions, code style, and worked examples.

## Adding New Personas

Copy `references/_template.md` and fill in each section. The template has guidance comments explaining what to capture and why. Prioritise sourced quotes and real positions over characterisation.

## Available Personas

| Persona | Domain | Aliases | File |
|---------|--------|---------|------|
| Alberto Brandolini | EventStorming, domain modelling facilitation | alberto, brandolini, ziobrando | `references/alberto-brandolini.md` |
| Alex Hormozi | Offer design, business scaling, lead gen | alex, hormozi, alex hormozi | `references/alex-hormozi.md` |
| Alistair Cockburn | Agile methodology, hexagonal architecture | alistair, cockburn, alistair cockburn | `references/alistair-cockburn.md` |
| Amelia Wattenberger | Data visualisation, D3.js, interactive essays | amelia, wattenberger, amelia wattenberger | `references/amelia-wattenberger.md` |
| April Dunford | Product positioning, go-to-market strategy | april, april dunford, aprildunford | `references/april-dunford.md` |
| Dax Raad | SST, IaC, developer experience, open source | dax, thdxr, dax raad | `references/dax-raad.md` |
| David Heinemeier Hansson | Rails, monoliths, HTML-over-the-wire | dhh, david heinemeier hansson | `references/dhh.md` |
| Eric Evans | Domain-Driven Design, bounded contexts | eric, eric evans, ericevans | `references/eric-evans.md` |
| Gary Bernhardt | TDD, functional core / imperative shell | gary, garybernhardt, gary bernhardt | `references/gary-bernhardt.md` |
| Greg Young | CQRS, event sourcing, temporal modelling | greg, greg young, gregyoung | `references/greg-young.md` |
| Guillermo Rauch | Next.js, Vercel, frontend deployment, AI cloud | guillermo, rauchg, guillermo rauch | `references/guillermo-rauch.md` |
| Harry Dry | Marketing copywriting, show-don't-tell | harry, harry dry, harrydry, marketing examples | `references/harry-dry.md` |
| Jack Doyle | GSAP, web animation, JS performance | jack, jack doyle, greensock | `references/jack-doyle.md` |
| John Carmack | Graphics engines, optimisation, VR/latency | carmack, john carmack, johncarmack | `references/john-carmack.md` |
| Jony Ive | Industrial design, Apple design philosophy | jony, jony ive, jonyive, ive | `references/jony-ive.md` |
| Kent Beck | XP, TDD, refactoring, simple design | kent, kent beck, kentbeck | `references/kent-beck.md` |
| Mark Seemann | DI, functional programming, clean architecture | mark, ploeh, mark seemann | `references/mark-seemann.md` |
| Matt Perry | Motion library, spring physics, layout animation | mattperry, mattgperry, matt perry | `references/matt-perry.md` |
| Matt Pocock | TypeScript, type inference, advanced patterns | matt, mattpocockuk, matt pocock | `references/matt-pocock.md` |
| Mitchell Hashimoto | Terraform, infrastructure automation, Ghostty | mitchell, mitchellh, mitchell hashimoto | `references/mitchell-hashimoto.md` |
| Pieter Levels | Solo bootstrapping, radical simplicity, shipping | pieter, levelsio, pieter levels | `references/pieter-levels.md` |
| Rand Fishkin | SEO, audience research, zero-click content | rand, rand fishkin, randfish, sparktoro | `references/rand-fishkin.md` |
| Ricardo Cabello | Three.js, WebGL, 3D graphics on the web | ricardo, mrdoob, ricardo cabello | `references/ricardo-cabello.md` |
| Rich Hickey | Clojure, simplicity, values vs places | rich, rich hickey, richhickey | `references/rich-hickey.md` |
| Rob Walling | SaaS bootstrapping, TinySeed, stair-step approach | rob, robwalling, rob walling | `references/rob-walling.md` |
| Sahil Lavingia | Gumroad, creator economy, bootstrapping | sahil, shl, sahil lavingia | `references/sahil-lavingia.md` |
| Scott Wlaschin | F#, FP, railway-oriented programming | scott, scottwlaschin, scott wlaschin | `references/scott-wlaschin.md` |
| Simon Willison | Django, Datasette, SQLite, AI tooling | simon, simonw, simon willison | `references/simon-willison.md` |
| Steve Jobs | Product vision, focus, technology × liberal arts | steve, steve jobs, stevejobs | `references/steve-jobs.md` |
| Bret Victor | Interactive media, progressive revelation, dev tool demos | bret, bret victor, worrydream | `references/bret-victor.md` |
| Des Traynor | Product storytelling, JTBD, demo narrative | des, des traynor, destraynor | `references/des-traynor.md` |
| Grant Sanderson | Math animation, visual explanation, pacing | grant, 3b1b, grant sanderson, 3blue1brown | `references/grant-sanderson.md` |
| Jonny Burger | Remotion, programmatic video, React video | jonny, jonnyburger, jonny burger | `references/jonny-burger.md` |
| Tony Zhou | Film editing, visual storytelling, pacing | tony, tony zhou, everyframeapainting | `references/tony-zhou.md` |
| Walter Murch | Film editing theory, cutting rhythm, Rule of Six | walter, walter murch, waltermurch | `references/walter-murch.md` |
