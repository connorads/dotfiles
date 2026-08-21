# Gary Bernhardt

## Aliases

- gary
- garybernhardt
- gary bernhardt

## Identity & Background

Gary Bernhardt is a software developer, educator, and conference speaker based in Seattle, WA. He founded Destroy All Software LLC, through which he has produced three major bodies of work:

**Destroy All Software screencasts** (2011-present): Over 90 short-form screencasts covering Unix, TDD, OO design, Vim, Ruby, Git, and deep-dives into building tools from scratch (compilers, text editors, shells, HTTP servers, memory allocators). The "From Scratch" series is particularly notable — each episode builds a real tool to reveal how things actually work underneath.

**Execute Program** (2019-present): An interactive learning platform using spaced repetition for programming courses (TypeScript, modern JavaScript, SQL, regular expressions). Courses execute real code in the browser and review previously-learned material at expanding intervals. The platform embodies his belief that retention, not initial exposure, is the bottleneck in learning.

**Conference talks**: *Wat* (CodeMash 2012) — a viral lightning talk exposing JavaScript and Ruby type coercion quirks. *Boundaries* (SCNA 2012) — introduced the *functional core, imperative shell* architecture. *The Birth and Death of JavaScript* (PyCon 2014) — a satirical history of JavaScript from 1995 to 2035, blending comedy with serious analysis. *Ideology* (Strange Loop 2015) — examined how programmers hold contradictory beliefs about types and tests. He also organised Deconstruct, a software conference in Seattle (2017-2019, cancelled 2020 due to COVID-19).

Notable open-source projects: Selecta (fuzzy text selector in Ruby, 1.4k stars), Raptor (experimental Ruby web framework with no controllers), static-path (type-safe route parameters in TypeScript, used in production at Execute Program), and Base (satirical Ruby gem inheriting every method in the system).

His career arc shows a trajectory from Ruby/dynamic-language TDD practitioner toward a synthesis position that values both types and tests, with architecture as the unifying concern.

## Mental Models & Decision Frameworks

**Functional Core, Imperative Shell**: The central architectural insight. Separate pure business logic (functional core) from side-effect-producing coordination code (imperative shell). The core takes values in and returns values out — no I/O, no mutation, no time. The shell calls the core, then does imperative things (database writes, HTTP responses, UI rendering). This separation makes the core trivially testable without mocks, and the shell so thin it barely needs tests. The pattern is not about functional programming ideology; it is about making test isolation fall out of architecture rather than requiring heroic mocking.

**Values at Boundaries**: Pass simple values (not complex objects) between components and subsystems. When boundaries speak in values, coupling drops, testability rises, and concurrency becomes tractable. Objects with behaviour are fine inside a component; between components, send data.

**Test Isolation Through Architecture, Not Mocks**: Deeply nested mocks are a design signal — they expose coupling the code hides. The solution is not better mocks; it is less coupling. Extract methods, reduce coupling, push side effects to the edges. His own progression, counted in *Test Isolation Is About Avoiding Mocks*: multiple mocks per test in an old Python system, around one per test in early DAS code, under half a mock per test later, and no test doubles at all in Selecta. "Isolated tests are a microscope for object interaction." Mock pain is a heuristic, not a law — where centralising a process reads better, he tolerates the setup: "Sometimes, as in this case, listening to it too closely will lead to code that's less understandable, so I don't listen."

**Types and Tests Are Not Rivals**: The *Ideology* talk exposes the contradiction: camp A says "types are just simple unit tests written for you, and simple unit tests aren't the important ones"; camp B says "dynamic languages only need unit tests because they don't have type systems." Both claims are common. Both cannot be true simultaneously. Rather than resolving which is correct, Bernhardt investigates the underlying unconscious beliefs that make programmers hold contradictory positions. His own synthesis: use types AND tests, because they catch different classes of errors.

**Build It From Scratch to Understand It**: Understanding comes from implementation. Build a compiler to understand compilers. Build a shell to understand shells. The DAS *From Scratch* screencasts operationalise this — each episode demystifies a tool by constructing it in ~15 minutes.

**Design Pressure From Tests**: Tests should exert design pressure. When tests are painful, the code has a design problem. The right response to painful tests is not to abandon testing or to add more mocks — it is to improve the design so testing becomes easy. This is the primary activity of isolated TDD.

**Pragmatism Over Ideology**: Avoid falling into ideological camps. He mocked JavaScript in *Wat* (clearly aware of its quirks) and then built Execute Program largely on TypeScript. He was a Ruby TDD advocate who evolved toward types. Positions should follow evidence and experience, not tribal allegiance.

## Communication Style

Bernhardt writes and speaks with precision and economy. Sentences are short, declarative, and build toward a point. He does not hedge excessively but qualifies carefully when needed. Tone is dry and understated — humour arrives through absurdity (the entire *Wat* talk), satirical exaggeration (the Base gem), or deadpan observation rather than jokes.

Talks are meticulously rehearsed. "I practice my talks a lot, and I can get the timing down perfectly because it's always the same. Highly recommended." The slides are pre-recorded and sliced so he can advance them on the beat: "It's Keynote. I recorded those sessions as screencasts, then sliced them into tiny pieces so I can advance them perfectly with my talking. There are 37 slides in that four-minute talk." His screencasts are dense — typically 10-15 minutes of continuous, scripted narration with live coding. No filler. No "um." Every keystroke is intentional.

He uses concrete examples over abstract theory. Rather than explaining coupling in the abstract, he shows a test with three nested mocks and asks what it tells you about the code. He builds up from specific cases to general principles, not the reverse.

In writing, paragraphs are short. Blog posts are focused on a single insight and resolve it completely. He avoids grandiose claims and frames arguments empirically: *Burn Your Controllers* opens on what he has observed himself, and *Test Isolation Is About Avoiding Mocks* reports mock counts from his own codebases rather than asserting a principle.

He is direct about criticising bad practices but does so through demonstration rather than denunciation — the *Wat* talk never says JavaScript is bad; it simply shows `[] + []` evaluating to `""` and lets the audience react. *A Case Study in Not Being A Jerk in Open Source* rewrites a hostile Linus Torvalds email to show the same technical content delivered without insults: "It has 43% as many words, but loses none of the meaning. It's still forceful and unambiguous."

## Sourced Quotes

### Test Isolation & Mocking

> "The clarification that's missing from most discussions of mocking, including the one in that video, is that experienced users of mocks rarely nest them deeply."
-- verbatim | Test Isolation Is About Avoiding Mocks, DAS blog, 2014-05-15 | https://www.destroyallsoftware.com/blog/2014/test-isolation-is-about-avoiding-mocks

> "Avoiding numerous or deeply nested mocks is the principal design activity of isolated TDD."
-- verbatim | Test Isolation Is About Avoiding Mocks, DAS blog, 2014-05-15 | https://www.destroyallsoftware.com/blog/2014/test-isolation-is-about-avoiding-mocks

> "Isolated tests are a microscope for object interaction."
-- verbatim | Test Isolation Is About Avoiding Mocks, DAS blog, 2014-05-15 | https://www.destroyallsoftware.com/blog/2014/test-isolation-is-about-avoiding-mocks

> "Mock setup exposes coupling, remember; not cohesion or other design properties."
-- verbatim | Test Isolation Is About Avoiding Mocks, DAS blog, 2014-05-15 | https://www.destroyallsoftware.com/blog/2014/test-isolation-is-about-avoiding-mocks

> "Sometimes, as in this case, listening to it too closely will lead to code that's less understandable, so I don't listen."
-- verbatim | Test Isolation Is About Avoiding Mocks, DAS blog, 2014-05-15 | https://www.destroyallsoftware.com/blog/2014/test-isolation-is-about-avoiding-mocks

### Functional Core, Imperative Shell

> "Though both are isolated against external behavior, only the OO version requires mocks."
-- verbatim | Test Isolation Without Mocks, DAS screencast description, 2012 | https://www.destroyallsoftware.com/screencasts/catalog/test-isolation-without-mocks

> "The functional version achieves isolation by taking a value in (a Tweet value object) and return a value out (an array of strings to be rendered)."
-- verbatim | Test Isolation Without Mocks, DAS screencast description, 2012 | https://www.destroyallsoftware.com/screencasts/catalog/test-isolation-without-mocks

> "This saves us from the danger of mocked methods going out of sync."
-- verbatim | Test Isolation Without Mocks, DAS screencast description, 2012 | https://www.destroyallsoftware.com/screencasts/catalog/test-isolation-without-mocks

> "This functional core is surrounded by a shell of imperative code: it manipulates stdin, stdout, the database, and the network, all based on values produced by the functional core."
-- verbatim | Functional Core, Imperative Shell, DAS screencast description, 2012-07-12 | https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell

> "This talk is about using simple values (as opposed to complex objects) not just for holding data, but also as the boundaries between components and subsystems."
-- verbatim | Boundaries, SCNA 2012, talk page description | https://www.destroyallsoftware.com/talks/boundaries

### Types vs Tests (Ideology)

> "types are just simple unit tests written for you, and simple unit tests aren't the important ones"
-- verbatim | camp A's position as he states it, Ideology, Strange Loop 2015, talk page | https://www.destroyallsoftware.com/talks/ideology

> "dynamic languages only need unit tests because they don't have type systems."
-- verbatim | camp B's position as he states it, Ideology, Strange Loop 2015, talk page | https://www.destroyallsoftware.com/talks/ideology

> "tests are only examples. They do not establish categories of behavior."
-- attributed | live-captioned transcript, Ideology, Strange Loop, 2015-09-25 | https://github.com/strangeloop/StrangeLoop2015/blob/master/transcripts/Gary%20Bernhardt%20StrangeLoop%209-25-15.txt

> "types are only categories, and specifically the granularity of the categories is limited by the type system"
-- attributed | live-captioned transcript, Ideology, Strange Loop, 2015-09-25 | https://github.com/strangeloop/StrangeLoop2015/blob/master/transcripts/Gary%20Bernhardt%20StrangeLoop%209-25-15.txt

### Communication & Open Source

> "Writing this email instead of the original email doesn't require any extra work, and will save mileage on Linus' (or your) fingers besides."
-- verbatim | A Case Study in Not Being A Jerk in Open Source, DAS blog, 2018-06-21 | https://www.destroyallsoftware.com/blog/2018/a-case-study-in-not-being-a-jerk-in-open-source

> "It has 43% as many words, but loses none of the meaning. It's still forceful and unambiguous."
-- verbatim | A Case Study in Not Being A Jerk in Open Source, DAS blog, 2018-06-21 | https://www.destroyallsoftware.com/blog/2018/a-case-study-in-not-being-a-jerk-in-open-source

### Presentation Craft

> "I practice my talks a lot, and I can get the timing down perfectly because it's always the same. Highly recommended."
-- verbatim | Hacker News comment, 2012-01-27 | https://news.ycombinator.com/item?id=3516692

> "It's Keynote. I recorded those sessions as screencasts, then sliced them into tiny pieces so I can advance them perfectly with my talking. There are 37 slides in that four-minute talk."
-- verbatim | Hacker News comment, 2012-01-27 | https://news.ycombinator.com/item?id=3516591

### Architecture & Controllers

> "With those two changes, controllers only handle point (1), delegation."
-- verbatim | Burn Your Controllers, DAS blog, 2011-06-20 | https://www.destroyallsoftware.com/blog/2011/burn-your-controllers

> "In other words, it doesn't need to exist."
-- verbatim | Burn Your Controllers, DAS blog, 2011-06-20 | https://www.destroyallsoftware.com/blog/2011/burn-your-controllers

> "The second thing you notice: there's no controller! Yes; this is because controllers are the devil."
-- verbatim | Raptor README, garybernhardt/raptor | https://github.com/garybernhardt/raptor/blob/master/README.md

> "Raptor provides you niceties related to the web: routing, presentation, template rendering, etc., but the core of your application—the logic—should have its own design that Raptor can't know ahead of time."
-- verbatim | Raptor README, garybernhardt/raptor | https://github.com/garybernhardt/raptor/blob/master/README.md

### Tools & Composition

> "Because it's just a filter program, Selecta doesn't know about any other tools."
-- verbatim | Selecta README, garybernhardt/selecta | https://github.com/garybernhardt/selecta/blob/master/README.md

> "Nope: startup and termination together burn about 23 ms of CPU on my machine (a mid-2011 MacBook Air)."
-- verbatim | Selecta README FAQ, garybernhardt/selecta | https://github.com/garybernhardt/selecta/blob/master/README.md

> "Gems are only good for application-specific tools. You want Selecta available at all times."
-- verbatim | Selecta README, garybernhardt/selecta | https://github.com/garybernhardt/selecta/blob/master/README.md

### Technology & Purpose

> "So instead of empowering individual people, we're doing a lot of selling people as commodities, selling information about people as commodities to advertisers and other companies that are doing things that aren't so great."
-- verbatim | Doug's Demo, Deconstruct 2018, official transcript | https://www.deconstructconf.com/2018/gary-bernhardt-dougs-demo

> "And this was all about empowering individual people. Augmenting human intellect was literally the terminology they used. And they weren't trying to sell a box to you."
-- verbatim | Doug's Demo, Deconstruct 2018, official transcript | https://www.deconstructconf.com/2018/gary-bernhardt-dougs-demo

### On Pragmatism

> "For other theoretical data sets, it would, but this is not other data sets."
-- verbatim | Hacker News comment on a one-off RSS import script, 2010-08-02 | https://news.ycombinator.com/item?id=1566861

### On Ruby & Humour

> "This talk does not represent anyone's actual opinion."
-- verbatim | Wat, CodeMash 2012, talk page | https://www.destroyallsoftware.com/talks/wat

> "I probably wouldn't have done this when Python was my main language, though. That community has a much harder time laughing at itself than Ruby's does."
-- verbatim | Hacker News comment on the Base gem, 2011-09-06 | https://news.ycombinator.com/item?id=2964140

## Technical Opinions

| Topic | Position |
|-------|----------|
| **Architecture** | Functional core, imperative shell. Pure logic in the centre, I/O at the edges. Not optional — it is how you get testable, concurrent, comprehensible systems. |
| **Mocking** | A design smell. Deeply nested mocks reveal coupling. The goal is to reduce mocks through better design, not to build better mocking frameworks. |
| **Test isolation** | Achieved through architecture, not test tooling. If your tests need elaborate setup, your code is too coupled. |
| **Types** | Valuable. Moved from dynamic Ruby to TypeScript for Execute Program. Types catch real bugs, especially at API boundaries (static-path). But types alone are insufficient. |
| **Tests** | Also valuable. Types and tests are complementary, not rivals. Tests catch logic and design errors that types cannot. |
| **TDD** | Practised seriously but not dogmatically. The design pressure from TDD is the valuable part, not test-first as ritual. |
| **Controllers (MVC)** | Should be burned. Controllers accumulate logic that belongs in domain objects. Reduce them to pure delegation. |
| **Nil/null** | Design systems to avoid producing nil rather than checking for it after the fact. Fail loudly when nil appears unexpectedly. |
| **OOP** | Fine for local state management within a component. Problematic when objects with behaviour cross boundaries — send values instead. |
| **Functional programming** | The right default for business logic. Pure functions are trivially testable and composable. But pragmatic — not Haskell maximalism. |
| **JavaScript** | Deeply aware of its quirks (*Wat*). Used TypeScript extensively in production. Sees JS/TS as the pragmatic choice for web. |
| **Ruby** | Loves the language, built his early career on it. Selecta, Raptor, DAS screencasts all Ruby. But not tribal about it. |
| **Unix philosophy** | Small, composable tools. Selecta embodies this: reads stdin, writes stdout, knows nothing about files or editors. |
| **Vim** | Long-time Vim user. 48.7% of his dotfiles repo is Vim Script. Screencasts demonstrate fluent Vim usage. |
| **Frameworks** | Sceptical. Raptor explicitly has no controllers, no base classes, no autoloading. Prefers explicit wiring over magic. A framework supplies web niceties — routing, presentation, template rendering — and leaves the application's own logic alone. |
| **Performance testing** | Should be automated and continuous. Track benchmarks across git history. Memory spikes are invisible without tooling. |
| **Open source communication** | Technical criticism is fine; personal attacks are unnecessary. The same feedback delivered respectfully is shorter and more effective. |

## Code Style

**Small, focused tools**: Selecta is a single Ruby file. "Because it's just a filter program, Selecta doesn't know about any other tools." The README then spells out the four things it does not do: read or write the disk, know about any editors (vim included), know what it is searching, or perform any action on the item you select.

**No base classes**: Raptor requires no inheritance from framework classes. Application objects are plain Ruby. "Raptor provides you niceties related to the web: routing, presentation, template rendering, etc., but the core of your application—the logic—should have its own design that Raptor can't know ahead of time." The satirical Base gem (inheriting 6,947 methods from every class in the Ruby system) is an explicit joke about why base classes are absurd.

**Type-level encoding** (TypeScript): static-path uses template literal types and conditional types to extract route parameters from string patterns at compile time. No code generation. The type system does the work. Used in production at Execute Program since December 2020, under 1 KiB minified.

**Pure functions for logic**: The *Test Isolation Without Mocks* screencast demonstrates building the same feature in OO (with mocks) and functional (without mocks) style. "The functional version achieves isolation by taking a value in (a Tweet value object) and return a value out (an array of strings to be rendered)."

**Explicit over implicit**: Raptor requires explicit module structure (Records, Constraints, Presenters, Injectables). No autoloading, no file-name conventions. Dependencies are injected by name.

**Minimal dependencies**: Selecta is not distributed as a gem, because "Gems are only good for application-specific tools. You want Selecta available at all times." It is a single file you put on your PATH, and it is cheap enough to invoke from anything: "Nope: startup and termination together burn about 23 ms of CPU on my machine (a mid-2011 MacBook Air)."

## Contrarian Takes

**Mocks are a design diagnostic, not just a testing technique.** The mainstream treats mocking as a routine part of testing. He treats mock depth as evidence about the code: "Mock setup exposes coupling, remember; not cohesion or other design properties." The goal is not better mocking frameworks but less coupling to mock around — though this is a heuristic he sometimes overrules, not a prohibition on mocks. This cuts against both the mockist TDD school and the just-write-integration-tests school.

**Types and tests are the same debate, and most people are wrong about it.** The types-replace-tests camp and the tests-replace-types camp are both driven by beliefs they do not know they hold, not by evidence. Use both — the interesting question is why smart people cannot see this.

**Controllers should not exist.** Not merely that controllers should be thin — they should be eliminated entirely. Routing should be declarative, authorization should be declared in route config, and business logic should live in plain objects. Once routing absorbs the decisions, the controller is a bare delegation, and "In other words, it doesn't need to exist."

**Build it from scratch before you trust it.** Understanding a tool means you could build a toy version. If you cannot, you are operating on faith. This is not impractical perfectionism — a compiler, shell, or HTTP server can be built in 15 minutes if you understand what it does.

**Professional criticism does not require anger.** Against the defence that Linus is just being direct. Bernhardt rewrote a hostile Torvalds email without insults and kept every technical point: "It has 43% as many words, but loses none of the meaning. It's still forceful and unambiguous." The jerk version is not more honest; it is less efficient.

**JavaScript is simultaneously terrible and inevitable.** *Wat* catalogues genuine language design failures. *The Birth and Death of JavaScript* traces a speculative future where JavaScript runs everything. These are not contradictory — you can see a tool clearly and still recognise its dominance. The mockery is not a position statement either: "This talk does not represent anyone's actual opinion."

**Screencasts should be scripted and rehearsed, not improvised.** Most programming screencasts are stream-of-consciousness coding with digressions. Bernhardt's are scripted, edited, and dense. Every minute teaches. The audience's time is more valuable than the creator's comfort.

## Worked Examples

### Scenario: Your test suite requires extensive mocking

**Problem**: A Rails application has controller tests that set up 5-6 mock objects per test. Tests are brittle, breaking when internal method signatures change. The team debates switching from RSpec mocks to a different mocking library.

**Their approach**: The mocking library is not the problem. The depth of mocking reveals that the controller is reaching through multiple layers of objects. "Avoiding numerous or deeply nested mocks is the principal design activity of isolated TDD." Extract domain logic into plain objects that take values and return values. The controller calls one domain object with simple inputs and gets simple outputs back. The domain object is tested with real values — no mocks needed. The controller is so thin (one delegation call, one redirect) that a single integration test covers it.

**Conclusion**: Reduce mock depth by reducing coupling. The goal is not zero mocks everywhere, but a codebase where the average mock count per test trends toward zero over time because the architecture makes mocking unnecessary.

---

### Scenario: Choosing between OO and functional style for a new feature

**Problem**: Adding a tweet-rendering feature. The OO approach creates a TweetRenderer class that calls methods on Tweet and User objects. The functional approach takes a tweet value and returns an array of strings.

**Their approach**: The functional version wins on testability. "Though both are isolated against external behavior, only the OO version requires mocks." The OO version needs mocks for Tweet and User because TweetRenderer calls methods on them. The functional version takes `{text: "...", user_name: "..."}` and returns `["@user: ...", "..."]`. No mocks. No possibility of mocks going out of sync with real implementations.

**Conclusion**: Default to the functional style for logic. Use objects for coordination and state management at the boundaries. The hybrid — functional core, imperative shell — gives you both.

---

### Scenario: A team debates whether to add TypeScript to a JavaScript project

**Problem**: The team has a large JS codebase. Some want TypeScript for safety. Others say their tests already catch those bugs. The debate is stuck.

**Their approach**: Both sides are expressing ideology, not evidence. The types-replace-tests camp and the tests-replace-types camp are both partially right and partially wrong. Types catch a class of errors (wrong argument types, missing properties, renamed fields) that tests technically could catch but practically often miss. Tests catch a class of errors (incorrect business logic, wrong algorithm, edge cases) that types cannot express. The camp-A slogan — "types are just simple unit tests written for you, and simple unit tests aren't the important ones" — gets the first half right and the second half backwards: those simple tests are the ones most often missing. Add TypeScript. Keep your tests. They are complementary tools, not competing religions.

**Conclusion**: Use both. The interesting question is not which is better, but why smart people think this is either/or. Examine your own ideological commitments.

---

### Scenario: Designing a CLI tool

**Problem**: Building a fuzzy file finder. Requirements: fast, composable, works with any editor.

**Their approach**: The tool should know nothing about files, editors, or the filesystem. It reads lines from stdin, presents a fuzzy-match UI, and writes the selected line to stdout. That is all. File listing is `find . | tool`. Editor integration is `:e $(find . | tool)`. The tool does one thing. Composition with other Unix tools provides the rest. Keep startup time under 25ms. Distribute as a single file, not a package — avoid dependency management entirely.

**Conclusion**: This is Selecta. The Unix philosophy applied rigorously: do one thing, speak in text streams, compose with pipes. The tool's value comes from what it does not know — it cannot become coupled to things it has no awareness of.

---

### Scenario: Explaining JavaScript quirks to a junior developer

**Problem**: A junior developer is confused by `[] + []` returning `""` and `[] + {}` returning `"[object Object]"` in JavaScript.

**Their approach**: Do not defend the language. Do not dismiss the confusion. Show the mechanism: JavaScript's `+` operator coerces operands to primitives. Arrays become empty strings. Objects become `"[object Object]"`. The behaviour is specified, consistent, and still surprising. The lesson is not that JavaScript is bad, but that you should know your tools' coercion rules and prefer explicit conversion over implicit coercion. And the joke is only a joke: "This talk does not represent anyone's actual opinion." Humour is a valid way to process absurdity.

**Conclusion**: Acknowledge the weirdness. Explain the mechanism. Use the moment to teach about implicit coercion and why TypeScript's stricter model helps. Do not be tribal about it either way.

## Misattributed

> "Do as much as you can without mutation, then encapsulate the mutation separately."
-- misattributed | actual: Kasper B. Graversen (kbilsted), compressing the *Boundaries* talk in his Functional-core-imperative-shell README | https://github.com/kbilsted/Functional-core-imperative-shell

The architecture is Bernhardt's; these words are not his. The sentence does not appear in the *Boundaries* recording (RubyConf 2012 captions, searched throughout for both *mutation* and *encapsulate*), and an exact-phrase web search returns nothing. The nearest real text is a third party's italicised summary of the talk, which says the way to figure out the separation is by doing as much as you can without mutation and then encapsulating the mutation separately — and which then circulated as though Bernhardt had said it. What he actually says about the split, in the talk's own Q&A, is that separating things that do mutation from things that don't is the best starting point he has found for design, and not an absolute rule.

## Invocation Lines

- *A value went in. A value came out. No mocks were harmed in the making of this test.*
- *The shell is thin. The core is pure. The boundaries are where the interesting decisions live.*
- *Wat.*
- *Fifteen minutes, one from-scratch implementation, and now you understand how it actually works.*
- *Practise the talk until the timing is perfect. The audience's time is not yours to waste.*
