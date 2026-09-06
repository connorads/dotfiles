# Artefact guides

Read this for user flows, heuristic reviews and low-fidelity wireframes.

## User flow

Use one user, one goal and the supplied business rules. Include only branches
supported by those rules. Put `TBD` at a decision whose policy is unknown rather
than inventing a convenient route.

```text
[Entry]
   |
   v
[Action]
   |
   v
{Evidenced decision?}
  | yes                 | no
  v                     v
[Next action]       [Recovery or exit]
```

Cover entry, decisions, errors, recovery and exits. Keep backstage dependencies
as labelled notes unless the decision requires a service blueprint.

## Heuristic review

A heuristic review identifies plausible usability risks in an inspected
interface. It does not establish their frequency, real-world impact or cause.

For every finding include:

```markdown
### [Finding]

- Observed interface evidence:
- Principle and why it applies:
- User task at risk:
- Severity: provisional | supported
- Missing evidence:
- Recommendation or next observation:
```

Use a named principle only when it sharpens the explanation. Do not recite a
framework or manufacture one finding per heuristic. Preference is not a
violation.

Severity combines task impact with available evidence about frequency,
persistence, recoverability and affected population. If those inputs are absent,
mark severity provisional and name what would establish it. Never turn one
support ticket into a prevalence claim.

## Low-fidelity wireframe

Use a wireframe only when rough hierarchy, sequence or state placement is the
decision. Keep visual style out.

```text
+----------------------------------------------+
| [Task heading]                               |
| [Known guidance or TBD policy]               |
|                                              |
| [Primary task control]                       |
| [Current status or error]                    |
|                                              |
| [Primary action]        [Recovery or exit]   |
+----------------------------------------------+
```

Annotate the states required by supplied behaviour. Typical categories such as
empty, loading, success and error are prompts to inspect, not compulsory cells.
Do not invent a retention promise, accepted input, validation rule, route or
piece of copy when product or policy has not decided it.

Note responsive and accessibility risks at the design level. Route detailed
spacing, colour, typography, ARIA, focus and keyboard implementation elsewhere.

## Pattern choice

Choose a pattern from the user's task and information relationship, not a generic
catalogue. If the choice is not settled by evidence or an established design
system, show at most two materially different low-fidelity alternatives and
state the observation that would distinguish them.
