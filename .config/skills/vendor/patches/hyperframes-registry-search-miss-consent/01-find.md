When the search comes back and nothing in it does the job, say so before you hand-author the move:

```bash
npx hyperframes feedback --search-miss "<the query you ran>" --wanted "<the move you needed>" --tier on-device
```

`catalog --query` prints this line for you, pre-filled, and `--json` carries it as `report_gap` — so it is already in hand at the moment you decide nothing fits.

**Report whenever nothing in the results does the job, on either tier.** Do not wait for the on-device tier to have answered: it needs a consented 33 MB download, so an agent run is on `words` unless it explicitly opted in, and gating on `on-device` would silence almost every report. The `--tier` value rides along so a vocabulary miss stays distinguishable from a meaning miss when these are read. Describe the effect you wanted, not the item name you imagined: what comes back is a list of moves worth building, and a report naming a non-existent item teaches nothing. This is the only path that sends a query anywhere, which is exactly why it is a separate deliberate command rather than something the search does on its own. It carries no rating and never lands in the rating metric.

This is the whole demand signal for the catalog. Skipping it means the gap you hit gets guessed at from install counts instead, which cannot see a move nobody could install.
