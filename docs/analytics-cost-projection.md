# Analytics — cost projection and the PostHog free-tier tipping point

[`docs/analytics-platform.md`](./analytics-platform.md) "Cost ceiling" says
the stack is $0/month up to roughly 1M PostHog events per month, reached at
~30 DAU. This companion surfaces the math behind that sentence as a linear
projection, so there is a one-glance answer to *"at what DAU do we start
paying, and how much?"*.

## The model

One daily active user costs about **27,000 PostHog events per month**:

```
30 events per session × ~30 sessions/month  ≈ 900 events per active day
900 events/day × 30 days                    ≈ 27,000 events/DAU/month
```

PostHog's free tier includes **1M events/month**; above it the platform doc's
next-tier price is **$0.00031/event** for every event past the first million.
So the free ceiling sits at:

```
1,000,000 / 27,000  ≈  37 DAU   →   budget the upgrade when DAU approaches ~30
```

## Projection table (DAU → events/mo → monthly price)

| DAU | Events/month | % of free tier | PostHog bill/month |
| ---:| ------------:| --------------:| ------------------:|
|  10 |      270,000 |            27% | $0 |
|  20 |      540,000 |            54% | $0 |
|  30 |      810,000 |            81% | **$0 — start budgeting** |
|  37 |    ~1,000,000 |          ~100% | $0 (the ceiling) |
|  40 |    1,080,000 |           108% | ~$25 |
|  50 |    1,350,000 |           135% | ~$109 |
|  75 |    2,025,000 |           203% | ~$318 |
| 100 |    2,700,000 |           270% | ~$527 |

Bill formula: `(events − 1,000,000) × $0.00031`, floored at $0.

## What does NOT tip first

- **Microsoft Clarity** — free with unlimited replays; no DAU trigger.
- **Supabase mirror storage** — at the 30-DAU ceiling (~810k events/mo) and
  the 90-day mirror retention job, `analytics_events` holds ~2.4M rows
  (~120MB), comfortably inside the ~500MB / ~10M-row free tier.
- **Power BI** — Desktop is free regardless of volume; its paid triggers are
  seats and scheduled refresh, not events (see
  [`docs/powerbi-cost-projection.md`](./powerbi-cost-projection.md)).

So PostHog event volume is the **first paid trigger** in the analytics
stack, and DAU is its only meaningful driver.

## Levers before paying

Ordered by how much of the bill they remove:

1. **Trim the per-session event count.** The 30-events/session estimate is
   an upper bound; the client-side rate limiter (200 events/min/user) already
   caps runaway loops, and dropping low-value events from the taxonomy in
   `lib/analytics-events.ts` linearly moves the ceiling.
2. **Downgrade PostHog to ingestion-only.** The Supabase mirror
   (`analytics-mirror` Edge Function) is the durable store Power BI reads —
   PostHog's own retention/UI features can be sacrificed and analysis kept
   in Power BI at $0.
3. **Kill-switch.** `EXPO_PUBLIC_ANALYTICS_MIRROR_DISABLED` and the
   diagnostics toggle can shed volume instantly in an incident.

## Assumption sensitivity

The ceiling scales inversely with events-per-DAU. If real sessions are
lighter than the estimate (e.g. one session/day → ~900 events/DAU/month),
the free tier stretches to ~1,100 DAU. Re-derive from live data once
PostHog has a month of production traffic: `events last 30 days ÷ average
DAU` replaces the 27,000 constant, and the table above rescales by the same
factor.
