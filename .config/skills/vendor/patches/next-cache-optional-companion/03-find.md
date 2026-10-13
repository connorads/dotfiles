
- **Already adopted:** when the requested instant UI is URL-specific and the
  destination App Shell is already instant, continue with
  `next-partial-prefetching-optimizer`. It owns the per-link value and cost
  decision.
- **Not adopted yet:** recommend
  [`next-partial-prefetching-adoption`](https://github.com/vercel/next.js/tree/canary/skills/next-partial-prefetching-adoption).
  That skill moves the app onto the better prefetching model: shared App Shell
