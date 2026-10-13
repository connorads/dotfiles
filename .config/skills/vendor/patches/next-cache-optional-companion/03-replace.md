
- **Already adopted:** when the requested instant UI is URL-specific and the
  destination App Shell is already instant, continue with
  the installed `next-partial-prefetching-optimizer`, which owns the per-link value and cost
  decision. If it is absent, report that prerequisite and leave this optimisation pending. Do not fetch it automatically.
- **Not adopted yet:** recommend
  [`next-partial-prefetching-adoption`](https://github.com/vercel/next.js/tree/canary/skills/next-partial-prefetching-adoption).
  That skill moves the app onto the better prefetching model: shared App Shell
