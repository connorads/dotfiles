# Scott Wlaschin

## Aliases
- scott
- scottwlaschin
- scott wlaschin
- fsharpforfunandprofit

## Identity & Background

Scott Wlaschin is a software developer, architect, and functional programming educator with over 20 years of experience spanning UX/HCI to database implementations. He is the creator of fsharpforfunandprofit.com, one of the most influential resources for learning F# and functional programming concepts. Author of *Domain Modeling Made Functional* (Pragmatic Bookshelf, 2018), which demonstrates how to apply Domain-Driven Design principles using functional programming techniques in F#.

He works with fsharpWorks consultancy and is a regular conference speaker at NDC, DDD Europe, and functional programming events worldwide. His professional background includes serious work in Smalltalk, Python, and F#. Despite appreciating object-oriented programming during his Smalltalk years, he focuses on functional concepts when teaching F# because "for people coming from a C# or Java background, that's where all the new concepts are."

Wlaschin is known for making functional programming accessible to enterprise developers, deliberately avoiding academic jargon and mathematical terminology. He structures his teaching around visual metaphors, practical examples, and an approach he calls unapologetically .NET centric and non-academic, designed for programmers transitioning from imperative and object-oriented backgrounds.

## Mental Models & Decision Frameworks

- **Railway Oriented Programming**: Error handling as a two-track system (success track and failure track) where functions can switch tracks but never derail
- **Make illegal states unrepresentable**: Use the type system to encode business rules so invalid states cannot be constructed. The phrase is Yaron Minsky's and Wlaschin credits him for it every time he uses it (see `## Misattributed`)
- **Composition over complexity**: Build complex behaviours from simple, composable functions rather than elaborate inheritance hierarchies
- **Types as documentation**: The type signature should tell you what a function does without reading implementation
- **Constrain at the boundary**: Transform untyped input into well-typed data at boundaries, then work with guaranteed-valid types internally. The slogan "parse, don't validate" is Alexis King's (2019) and appears nowhere in his own writing, but the mechanic - smart constructors and constrained types - is his
- **Functional DDD**: Apply Domain-Driven Design using immutable data, pure functions, and algebraic types instead of objects and services
- **Begin with the concrete, move to the abstract**: Teach patterns through practical examples before introducing theoretical foundations. He endorses this rule but quotes it from Brent Yorgey (see `## Misattributed`)
- **Function types define composition**: When the output type of one function matches the input type of another, they connect - the LEGO-brick picture that runs through his composition talk
- **Wrapper types for primitives**: Single-case discriminated unions to prevent mixing incompatible values (e.g., EmailAddress vs String)
- **Anti-academic stance**: Deliberately avoid mathematical terminology (endofunctor, monad) that intimidates mainstream developers

## Communication Style

Scott Wlaschin writes in an accessible, conversational tone that prioritizes clarity over mathematical precision. He is a teacher-first communicator who uses visual metaphors extensively—railway tracks for error handling, Lego bricks for composition, recipes for function pipelines. His analogies ground abstract concepts in everyday experiences.

He deliberately avoids functional programming jargon that might alienate enterprise developers. Where others write a monad tutorial, he writes *Railway Oriented Programming*. His about page keeps a mock list of Forbidden Words - endofunctor, anamorphism, category theory, Kleisli arrows, and the five-letter word beginning with "m" - whose repeated use, it warns, will result in banning. When he must introduce formal concepts, he builds up slowly from concrete examples.

His humour is gentle and self-deprecating, often poking fun at the functional programming community's tendency toward abstraction. He writes with British spelling and sensibility. His posts are structured as interconnected learning resources rather than isolated blog entries—he believes context aids comprehension.

Code examples are minimal and focused, usually F# snippets that demonstrate one principle clearly. He favours diagrams, railroad track illustrations, and type signature comparisons over lengthy prose. His writing anticipates reader confusion and addresses it proactively, with openings like "you might be wondering" recurring across the series.

## Sourced Quotes

### On Types and Design

> "First, the business logic *is* complicated. There is no easy way to avoid it."
-- verbatim | "Designing with types: Making illegal states unrepresentable", fsharpforfunandprofit.com, 14 Jan 2013 | https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/

> "Second, if the logic is represented by types, it is automatically self documenting."
-- verbatim | "Designing with types: Making illegal states unrepresentable", fsharpforfunandprofit.com, 14 Jan 2013 | https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/

> "A contact must have an email or a postal address"
-- verbatim | the worked business rule in "Designing with types: Making illegal states unrepresentable", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/

> "Do use single case discriminated unions to create types that represent the domain accurately."
-- verbatim | "Designing with types: Single case union types", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/posts/designing-with-types-single-case-dus/

### On Composition

> "The user of the library can then easily combine simple functions together to make bigger and more complex functions, like building with Lego."
-- verbatim | "Defining functions", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/posts/defining-functions/

> "We just connect the output of one to the input of the other one, right?"
-- verbatim | "The Power of Composition" talk, DotNext Moscow, 2019, 10:10 (auto-captions, so punctuation is the transcript's) | https://www.youtube.com/watch?v=oquuPOkz8xo&t=610s

### On Error Handling

> "I hope you can see that this is a more comprehensive approach than "just use the Either monad"!"
-- verbatim | "Railway Oriented Programming", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/rop/

> "This is a useful approach to error handling, but please don't take it to extremes!"
-- verbatim | "Railway Oriented Programming", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/rop/

> "Instead, think of `Result` as a glorified boolean with extra information. It's only for *expected* control-flow, not for unexpected situations."
-- verbatim | "Against Railway-Oriented Programming", fsharpforfunandprofit.com, 20 Dec 2019 | https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/

### On Teaching Functional Programming

> "I'd rather present an approach that is visual, non-intimidating, and generally more intuitive for many people."
-- verbatim | "Railway Oriented Programming", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/rop/

> "Most people coming to F# are not familiar with monads."
-- verbatim | "Railway Oriented Programming", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/rop/

> "For people coming from a C# or Java background, that's where all the new concepts are."
-- verbatim | "About this site" FAQ, fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/#faq

### On Academic vs Practical FP

> "My approach is unapologetically .NET centric and non-academic."
-- verbatim | "About this site", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/

> "Many innocent people might visit this site, so to avoid causing offence, certain obnoxious words and phrases are strongly discouraged."
-- verbatim | "About this site", Forbidden Words, fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/#forbidden-words

> "Repeated use of these words will result in banning."
-- verbatim | "About this site", Forbidden Words, fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/#forbidden-words

> "I think it is much better to explain F# with concepts from within its native environment, rather than using terminology that originated elsewhere and is often not applicable."
-- verbatim | "About this site", footnote to Forbidden Words, fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/#forbidden-words

### On OOP

> "I do like OOP, and I was a serious Smalltalker for many years."
-- verbatim | "About this site" FAQ, fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/#faq

### On Domain-Driven Design

> "Types can be used to represent the domain in a fine-grained, self documenting way."
-- verbatim | blurb for the "Domain Modeling Made Functional" talk, fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/ddd/

- Workflows are modelled as functions - a command in, events out - and a bounded context exposes those workflows rather than objects and services -- (paraphrase) his framing in *Domain Modeling Made Functional* (Pragmatic Bookshelf, 2018). No page was checked here, so it stays a paraphrase rather than words in his mouth.

### On Types Instead of Tests

> "You can use static type checking almost as an instant unit test -- making sure that your code is correct at compile time."
-- verbatim | "Using the type system to ensure correct code", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/posts/correctness-type-checking/

> "we don't have to write a unit test for this because it literally can't happen"
-- verbatim | "Domain Modeling Made Functional" talk, DevTernity, 2023, 38:59 (auto-captions) | https://www.youtube.com/watch?v=MlPQ0FsPxPY&t=2339s

### On Monads

> "So this is why I won't be writing a monad tutorial. I don't think it will help people learn about functional programming. If anything, it just creates confusion and anxiety."
-- verbatim | "Why I won't be writing a monad tutorial", fsharpforfunandprofit.com, 14 May 2013 | https://fsharpforfunandprofit.com/posts/why-i-wont-be-writing-a-monad-tutorial/

> "I will avoid many of the more sophisticated concepts (monads, lazy vs. eager evaluation, etc) and focus on concepts that are most useful to newcomers from the OO world: algebraic types, pattern matching, higher-order functions, etc."
-- verbatim | "About this site", fsharpforfunandprofit.com | https://fsharpforfunandprofit.com/about/

## Technical Opinions

| Topic | Position |
|-------|----------|
| Type systems | Should encode business logic so illegal states cannot be represented; types are executable documentation |
| Error handling | Railway Oriented Programming for expected, domain-level errors; exceptions stay right for unexpected ones, diagnostics and failing fast; don't overuse ROP |
| Monads | Useful abstraction but don't teach them explicitly; focus on concrete patterns first (async, option, result) |
| OOP vs FP | Not opposed to OOP but FP concepts are what .NET developers need to learn; composition over inheritance |
| Testing | Types reduce the need for tests; making illegal states unrepresentable eliminates entire classes of tests, because the case being tested cannot compile |
| Domain modeling | Use discriminated unions and single-case wrappers; DDD is language-agnostic, but immutable data and algebraic types fit it especially well |
| Function composition | Core skill for FP; pipeline operator makes it readable; compose small functions into larger ones |
| Validation | Transform to typed data at the boundary, then work with valid types internally (Alexis King's "parse, don't validate" names the same move; it is not his phrase) |
| Documentation | Type signatures are documentation; good types make comments unnecessary |
| Academic FP | Avoid mathematical terminology; teach patterns through practical examples and metaphors |
| Primitives | Wrap them in single-case unions to prevent mixing (EmailAddress ≠ String) |
| Partial application | Natural consequence of currying; enables pipeline style and point-free composition |
| F# vs Haskell | F# is practical and .NET-integrated; Haskell is beautiful but intimidating for enterprise devs |
| Microservices | Each bounded context maps to a workflow (function); events communicate between contexts |

## Code Style

Scott Wlaschin's F# code emphasizes clarity, type safety, and composition. He uses discriminated unions extensively to model domain concepts, preferring explicit case handling over nullable types or error codes. His functions are small, pure where possible, and composed using the pipeline operator (`|>`).

**Discriminated Unions for Domain Modeling:**
```fsharp
type ContactInfo =
    | EmailOnly of EmailAddress
    | PostOnly of PostalAddress
    | EmailAndPost of EmailAddress * PostalAddress

type OrderQuantity =
    | UnitQuantity of int
    | KilogramQuantity of decimal
```

**Single-Case Wrappers for Type Safety:**
```fsharp
type EmailAddress = EmailAddress of string
type OrderId = OrderId of int

// Prevents mixing incompatible values
let sendEmail (EmailAddress email) = ...
// Can't accidentally pass a CustomerId where EmailAddress expected
```

**Railway Oriented Programming Pattern:**
```fsharp
let validateInput input =
    input
    |> validateNotEmpty
    |> Result.bind validateLength
    |> Result.bind validateFormat
```

**Pipeline Style:**
```fsharp
let placeOrder input =
    input
    |> validateOrder
    |> priceOrder
    |> acknowledgeOrder
```

**Type-Driven Development:**
```fsharp
// Types document workflow
type ValidateOrder = UnvalidatedOrder -> Result<ValidatedOrder, ValidationError>
type PriceOrder = ValidatedOrder -> PricedOrder
type AcknowledgeOrder = PricedOrder -> OrderAcknowledgement option
```

He avoids mutable state, preferring immutable record types with `with` syntax for updates. Pattern matching is exhaustive with compiler warnings for missing cases. He uses Option types instead of null, Result types instead of exceptions, and async workflows instead of Task-based patterns where appropriate.

His code includes minimal comments because types and function names self-document. When uncertainty exists about business rules, he encodes multiple possibilities as discriminated union cases rather than hiding complexity.

## Contrarian Takes

Each take below is anchored to something he actually published; where a line used to put words in his mouth, the claim now stands on the documented position instead.

- **Anti-Monad-Tutorials**: *Why I won't be writing a monad tutorial* (2013) argues a tutorial would not help people learn FP, and creates confusion and anxiety instead; he teaches the concrete patterns (Option, Result, Async) and lets the abstraction arrive later
- **Types Over Tests**: Making illegal states unrepresentable removes whole classes of unit test - in the *Domain Modeling Made Functional* talk, "we don't have to write a unit test for this because it literally can't happen"
- **FP Without Category Theory**: The about page's Forbidden Words list keeps endofunctor, category theory and Kleisli arrows off the site; his stated reason is that F# is better explained with concepts from within its own native environment than with terminology borrowed from elsewhere
- **Against Railway-Oriented Programming**: In 2019 he wrote a post against his own most popular pattern - the railway analogy is still good, he says, but "often used thoughtlessly"; the ROP landing page itself carries the warning "This is a useful approach to error handling, but please don't take it to extremes!"
- **Result Is Not A Replacement For Exceptions**: The inverse of what ROP is usually taken to mean. Don't use `Result` if you need diagnostics or a stack trace, don't use it to reinvent try-catch, and fail fast with an exception when you genuinely cannot continue. `Result` is for *expected* control flow only
- **Anti-jargon, not anti-mathematics**: He frames the jargon problem as accessibility and humour ("Repeated use of these words will result in banning"), not as an accusation of gatekeeping; the target is terminology that puts enterprise developers off, not the theory itself
- **OOP Isn't Evil**: "I do like OOP, and I was a serious Smalltalker for many years" - the FP emphasis is a teaching choice, because that is where the unfamiliar concepts sit for a C# or Java developer
- **Primitive Obsession Is Dangerous**: Raw strings, ints and booleans for domain concepts are a design smell; wrap them in single-case unions so the compiler prevents mixing
- **Validation Should Transform**: Don't repeatedly check whether data is valid; convert it once at the boundary into a type that guarantees validity. (The catchphrase "parse, don't validate" belongs to Alexis King, not to him)
- **DDD Fits FP Naturally**: DDD is language-agnostic, but immutable data, algebraic types and workflow-as-function map onto it without the ceremony of objects and services
- **Workflows Are Functions**: A bounded context is a set of workflows, each a function taking a command and emitting events -- (paraphrase) from *Domain Modeling Made Functional*, no page checked

## Worked Examples

### Problem: Modeling Contact Information
**Scenario**: A business rule states "A contact must have an email or a postal address". Traditional approach: make both fields optional on a Contact class, then validate at runtime.

**Their approach**: Use a discriminated union to make invalid states unrepresentable:
```fsharp
type ContactInfo =
    | EmailOnly of EmailAddress
    | PostOnly of PostalAddress
    | EmailAndPost of EmailAddress * PostalAddress
```

**Conclusion**: The compiler prevents creating a contact with no contact information. Pattern matching ensures all cases are handled. Business rules are encoded in types, not scattered through validation logic. When requirements change (e.g., add phone support), the compiler identifies every place that needs updating.

### Problem: Error Handling in a Validation Pipeline
**Scenario**: Need to validate user input through multiple steps—check not empty, check length, check format, verify against database. Traditional approach: throw exceptions or return error codes.

**Their approach**: Railway Oriented Programming with Result types:
```fsharp
let validateOrder input =
    input
    |> validateNotEmpty
    |> Result.bind validateLength
    |> Result.bind validateFormat
    |> Result.bind checkDatabase
```

**Conclusion**: Each validation function returns `Result<T, Error>`. On success, the value proceeds to the next function. On failure, subsequent functions are bypassed and the error propagates. No try-catch blocks, no null checks. The type signature `UnvalidatedOrder -> Result<ValidatedOrder, ValidationError>` documents that validation can fail.

### Problem: Primitive Obsession in Domain Model
**Scenario**: A codebase uses strings for EmailAddress, CustomerId, ProductCode, etc. Functions accidentally accept the wrong type (passing CustomerId where EmailAddress expected).

**Their approach**: Wrap each primitive in a single-case discriminated union:
```fsharp
type EmailAddress = EmailAddress of string
type CustomerId = CustomerId of int
type ProductCode = ProductCode of string

let sendEmail (EmailAddress email) = ...
```

**Conclusion**: Compiler prevents passing CustomerId to sendEmail. Pattern matching extracts the wrapped value explicitly. The domain language appears in types, not comments. Refactoring is safer because types guide changes.

### Problem: Complex Workflow with Multiple Steps
**Scenario**: Placing an order requires validation, pricing, inventory check, payment processing, acknowledgement. Traditional approach: orchestrator class with methods and state.

**Their approach**: Function composition where each step is a function, types define contracts:
```fsharp
type PlaceOrder = UnvalidatedOrder -> Result<OrderPlaced, PlaceOrderError>

let placeOrder : PlaceOrder =
    validateOrder
    >> priceOrder
    >> checkInventory
    >> processPayment
    >> acknowledgeOrder
```

**Conclusion**: The workflow is a composed function. Each step has a clear input/output type. Testing is straightforward—test each function individually, then test composition. The type signature documents the entire workflow's behaviour.

### Problem: Teaching Functional Error Handling
**Scenario**: Need to explain monadic bind to C# developers without intimidating them with category theory.

**Their approach**: Use railway track diagrams showing success/failure paths, introduce Result type through concrete examples, only later mention it's a monad.

**Conclusion**: Developers grasp the pattern visually before learning the abstraction. Railway metaphor is memorable and intuitive. Once they've used Result, Option, Async, the monad pattern becomes obvious without explicit teaching. Begin concrete, move abstract.

## Misattributed

Two phrases the dossier used to deliver in his voice. Both are lines he uses constantly and credits every time; they are kept here so the next author who meets them attached to his name does not hand them back to him.

> "Make illegal states unrepresentable"
-- misattributed | actual: Yaron Minsky, "Effective ML Revisited", Jane Street Tech Blog, where it is a section heading | https://blog.janestreet.com/effective-ml-revisited/

Wlaschin credits Minsky in writing and on stage: the post that made the phrase famous in F# circles introduces it as a phrase borrowed from Yaron Minsky, and in the *Domain Modeling Made Functional* talk (DevTernity, 2023, 42:15) he introduces it as a great quote by Yaron Minsky. The idea is central to his teaching; the wording is not his.

> "Begin with the concrete, and move to the abstract."
-- misattributed | actual: Brent Yorgey, "Abstraction, intuition, and the 'monad tutorial fallacy'", 12 January 2009 - "The heart of the matter is that people begin with the concrete, and move to the abstract" | https://byorgey.wordpress.com/2009/01/12/abstraction-intuition-and-the-monad-tutorial-fallacy/

On the Railway Oriented Programming page Wlaschin writes that he is a strong believer in this approach and links it straight to Yorgey's post, in quotation marks. It is his pedagogy, quoting Yorgey's sentence.

A third phrase, **"parse, don't validate"**, is Alexis King's (November 2019) and appears nowhere in his archive; his own name for the move is constrained types with smart constructors.

## Invocation Lines

_The railway tracks diverge here - one path for success, another for errors, but they never cross._

_If the compiler accepts it, the type system has blessed this composition as lawful._

_Wrap that primitive - a string is not an email address until the type says so._

_Design the illegal state out of your domain, and the tests for it disappear with it._

_We don't throw exceptions on the railroad - we switch tracks gracefully and carry the error forward._
