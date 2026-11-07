# Harness

The harness makes two builds comparable. Keep it small: runs built one in 7 to
20 minutes and about 400 lines. Put it in an ignored folder or the session's
storage, not in the product.

## Contents

- [Serve frozen builds](#serve-frozen-builds)
- [Keep test traffic out of production](#keep-test-traffic-out-of-production)
- [When the stack will not run](#when-the-stack-will-not-run)
- [Data](#data)
- [Capture](#capture)
- [Hand it to reviewers](#hand-it-to-reviewers)

## Serve frozen builds

Build each round into its own folder, such as `dist-baseline` and `dist-r1`.
Serve the production build from that folder on its own port, with an empty
store created per boot. Every comparison then runs against stored bytes, not
the moving work tree.

Serve a private copy. Repo commands such as build and check overwrite `dist`,
and one run lost 44 minutes to overwritten builds. Hash the copy before the
first capture and verify the hash after it. A guard that starts later cannot
detect an earlier overwrite.

Confirm that each port serves your app before you trust a screen. Another
project can already hold it. Use a port no parallel run shares.

Stop servers by process group. Detached child processes survive a plain kill.
Give each server a self-exit timer, because a sandbox can refuse `kill` and
leave it running.

## Keep test traffic out of production

Before you serve any build:

1. Search it for production keys and hosts, such as analytics project keys.
2. Block analytics and third-party hosts at the browser context, in every
   capture, timing and review run. A block in one spec does not cover the rest.
3. Refuse to start if the search finds a key.

One run's invalid captures sent 657 requests through a preview proxy with a
production analytics key. If this happens, count across all runs, report it
first and do not query the outside service without approval.

## When the stack will not run

Stop after two failed attempts to start the real stack. Then serve the real
production build against a fake API at the network boundary:

1. Decode every fake response with the repo's contract schemas. This catches
   invented enum values and shapes.
2. Add control endpoints for latency, failure and empty states.
3. Copy the semantics of any action reviewers will exercise. A fake Undo that
   clears instead of restores sent two reviewers after a bug that did not exist.
4. Write down what the fake does not model, and give that list to reviewers.

Report the real-stack runs as skipped. Run them when the blocker clears.

## Data

Seed at the largest realistic size, with every page loaded. A small sample
hides render cost. Keep a normal dataset for screenshots and a large one for
timing.

Use synthetic, consistent content for every capture. Pin locale, timezone and
fonts. Freeze the clock when the app shows relative dates or month rollovers.

Validate the seed. Check that seeded records appear on screen before you
capture, because a rejected seed looks like an empty state.

## Capture

Capture a fixed list: screens by viewports, including at least a small phone,
a phone, a tablet and a laptop. Add loading, empty, error and hung-request
states, plus dark mode where the app has one.

Before each shot:

- Disable animation and hide the caret.
- Wait for `document.fonts.ready`.
- Blur the focused element.
- Block service workers.

Record horizontal overflow and page errors for each shot. Numeric layout
checks, such as overflow and element positions, catch what reviewers miss and
prove a change held.

Use viewport shots, not full-page shots, if the app uses `content-visibility`.
Full-page shots can come out blank.

Do not overwrite earlier results. Write each run to a new path, and write
results in a `finally` block so a failed run keeps its data.

## Hand it to reviewers

Give usability reviewers a ready driver library and the served URL. Without
one, each reviewer writes its own.

A test script can cause the defect it reports. If focus lands on `BODY`, check
that the script did not tab off the document.
