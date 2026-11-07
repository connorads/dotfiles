# Measurement

A surprising timing is a harness bug until shown otherwise. Most large gains
and regressions in these runs were artefacts.

## Contents

- [Sanity checks](#sanity-checks)
- [Method](#method)
- [Comparing two builds](#comparing-two-builds)
- [In-page timer](#in-page-timer)

## Sanity checks

Apply these to every figure before you record it:

| Signal | Likely cause |
|---|---|
| The value is near a round timeout, such as 4057 ms against 4000 | The step timed out |
| The value is below the injected latency, such as 38 ms with 120 ms added | The script clicked or measured the wrong thing |
| Median and p90 are far apart | Two modes. Find the cause before you quote either |
| One selector step is slow | Check for a stalled locator first |
| A wait for "Saved" passes during a failure | It matched "Not saved yet". Use an exact match |
| A driver retry can explain the number | Playwright's polling backoff, not the app |
| A run reports no change after a fix | Check that the build served is the one you built |

Never dismiss a high percentile as an outlier without an explanation. One
retracted "990 to 500 ms" gain came from driver polling, and its p90 had
already shown two modes.

## Method

- Time inside the page. Use `performance.now()` to a DOM predicate and then one
  animation frame. Do not time with driver waits.
- Add PerformanceObservers for `event`, `longtask` and `layout-shift`.
- Set 4x CPU throttle through CDP (`Emulation.setCPUThrottlingRate`).
- Add latency at the server or route, about 120 ms.
- Drop the first sample of each series.
- Use at least 15 runs for cold load and at least 7 for interactions.
- Report median and p90 with the sample count.
- Count requests per action. Server-side counts prove lost or doubled work.

Measure what the user sees: the pressed state, the new row, the opened dialog.

## Comparing two builds

Fresh browser per run. Alternate the builds and swap the order between pairs.
Twelve swapped pairs turned a false 446 against 366 ms into 578 against 570 ms.

Measure both builds in the same session on a quiet machine, with the same
browser flags. Do not compare against numbers from an earlier hour. If the
machine was busy, say so and repeat the run when reviewers have finished.

To claim that a regression existed before your change, reproduce it on the
base commit with repeats. One such claim was a harness race.

Report a cost you added. If live search makes keystrokes slightly slower, the
table shows it.

## In-page timer

Add this with `addInitScript`. Arm it before the action. Read the result after.

```js
(() => {
  let t0 = 0;
  for (const type of ['pointerdown', 'keydown']) {
    addEventListener(type, (e) => { t0 = e.timeStamp; }, true);
  }
  window.__until = (selector, text) => new Promise((resolve) => {
    const ok = () => [...document.querySelectorAll(selector)]
      .some((el) => el.checkVisibility() && (text == null || el.textContent.includes(text)));
    const check = () => {
      if (!ok()) return;
      observer.disconnect();
      requestAnimationFrame(() => resolve(performance.now() - t0));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
  });
})();
```

```js
const pending = page.evaluate(([s, t]) => window.__until(s, t), ['#main h1', 'Inbox']);
await page.waitForTimeout(0);
await link.click();
const ms = await pending;
```

The predicate must be false before the action. A stale match never resolves,
because the check runs only on later mutations.
