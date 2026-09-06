# Null results and quiet periods

Zero observed events can bound a rate. It cannot prove zero risk, causal
repair, or general correctness.

## Before calculating

State all of these:

- **event** - the exact failure counted;
- **unit** - one independent opportunity for that event;
- **denominator or exposure** - how many opportunities, or how much time;
- **comparability** - why those units represent the target conditions;
- **independence** - which shared causes, retries or clusters could correlate
  units;
- **detector** - which paths and failure classes it observes;
- **window** - start, end and any traffic or configuration change inside it.

If the detector misses the original failure class, zero is a blind spot rather
than a null result. If repeated rows describe one retried event, count the event
once. If trials share one host, tenant or rollout wave, do not assume each is an
independent replication.

## Rule of three

For zero events in **n independent, comparable Bernoulli trials**, an
approximate one-sided 95% upper confidence bound on the event probability is:

```text
p < 3 / n
```

Examples:

- 0 failures in 100 valid trials gives an upper bound near 3%.
- 0 failures in 10,000 valid trials gives an upper bound near 0.03%.

This is not the observed rate, which is zero in the sample. It is not a
guarantee about the next trial. It does not establish why the events stopped.
The approximation comes from Hanley and Lippman-Hand, "If Nothing Goes Wrong,
Is Everything All Right? Interpreting Zero Numerators" (1983).

## Event rates over time

When events occur over exposure rather than fixed trials, report exposure in a
meaningful unit such as request-hours or device-days. A Poisson approximation
after zero events gives an analogous 95% upper bound near `3 / exposure` in
that unit, but only when a roughly constant independent event process is a
reasonable model.

## What to report

Use this shape:

> No detected X occurred across n comparable units during window W. Detector D
> covers paths P but not Q. Assuming independent trials, the approximate 95%
> upper bound is 3/n. This bounds recurrence under these conditions; it does
> not by itself establish that change C caused the result or removed the
> defect.

If independence, comparability or coverage is doubtful, omit the arithmetic or
present it explicitly as a sensitivity case rather than a measured assurance.
