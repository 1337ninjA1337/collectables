# Analytics platform — decision record

This document captures *why* Collectables uses the specific stack it does for
product analytics, session replay, and BI reporting. It is the source of
truth for future "should we replace X with Y?" conversations.

## Stack at a glance

| Layer | Tool | Free tier | Role |
| ----- | ---- | --------- | ---- |
| Event analytics | **PostHog** (EU cloud) | 1M events/month | Funnels, retention, cohort, feature flags |
| Session replay (web only) | **Microsoft Clarity** | Unlimited | Heatmaps, session recordings, rage-click detection |
| Long-tail event store | **Supabase** Postgres | Existing project | Owned event archive, mirror of PostHog events |
| BI reporting | **Power BI Desktop** | Free for personal use | DAU, funnel, conversion dashboards |
| Crash reporting | Sentry | 5k errors/month | Stack traces (separate from analytics — see `.tasks/.sentry-setup.md`) |

The whole stack is designed to be **$0/month** at indie scale and to keep
ownership of the raw data inside Supabase so the analytics tool can be swapped
later without re-instrumenting the app.

## Why PostHog

We need a single tool that handles event ingestion, funnels, retention,
cohort analysis, and feature flags. We evaluated:

| Option | Free tier | Self-host? | EU host? | Verdict |
| ------ | --------- | ---------- | -------- | ------- |
| **PostHog** | 1M events/mo | Yes (Docker, but we use cloud) | Yes (`eu.posthog.com`) | **Picked**: highest free quota, EU host, OSS so we can self-host if pricing changes |
| Mixpanel | 100k MTU/mo | No | EU on paid plan only | Quota too low for any growth |
| Amplitude | 50k MTU/mo | No | No | Quota too low; US-only |
| Plausible | Pageviews only | Yes | Yes | No event/funnel primitives — wrong tool |
| Umami | Pageviews + simple events | Yes | n/a | No funnels/retention primitives |
| Self-rolled (Supabase) | Existing | Yes | Yes | No funnel/cohort UI; deferred to Power BI for that role anyway |

PostHog wins on:
- **1M events/mo free tier** — we'd need ~30 daily-active users emitting
  ~30 events/session/day to hit it. Plenty of headroom.
- **EU cloud (`eu.posthog.com`)** — sub-processor based in Frankfurt,
  avoiding Schrems II complications for EU users without us paying for an
  enterprise plan.
- **OSS escape hatch** — if PostHog raises prices, we can self-host on a
  $5/mo VPS without re-instrumenting any client code.
- **Funnel + retention + cohort primitives** built in — replicating that
  in Power BI alone would burn ~3 days of DAX.
- **Feature flags** are a future requirement (premium-rollout, geo-gated
  features); having them in the same tool means one less SDK.

## Why Microsoft Clarity (web-only)

Session replay catches UX issues that funnel analytics can't surface:
fat-fingers, dead clicks, scroll abandonment, layout breakage on uncommon
viewports. The replay-tool space has two real options:

| Option | Free tier | Privacy stance |
| ------ | --------- | -------------- |
| **Microsoft Clarity** | Unlimited sessions, no quotas | Auto-masks `<input>`, has GDPR DPA, no upsell to paid plan |
| Hotjar | 35 daily sessions free | Aggressive upsell, paid for serious use |

Clarity is **free with no quota** because Microsoft uses aggregated insights
to train Bing/Edge UX models — not your individual sessions. The DPA
(https://clarity.microsoft.com/terms) is GDPR-compliant.

Clarity is **web-only** because:
- Mobile session replay would require pulling in another SDK (~150KB) and
  Apple's policy review takes a dim view of full-screen recording.
- The bulk of new-user friction is on web (signup form), where Clarity's
  data is most useful.
- We can revisit React Native session replay later if web data points to
  mobile-specific issues we can't reproduce.

**Privacy implications**: Clarity records the DOM, including text inside
form fields by default. We must:
1. Add `data-clarity-mask="True"` (or `class="ms-clarity-mask"`) to every
   `<input>` rendered by `react-native-web`.
2. Ensure no PII is shown in plain text outside form fields (we already do —
   email is only shown in `app/settings.tsx` as part of the user's own
   profile, which is fine).
3. Honour `navigator.doNotTrack === "1"` by skipping the script injection.

These are enforced in the Analytics #11 task (Clarity wiring).

## Why Power BI Desktop

PostHog's UI is great for quick exploration but has limits:
- Custom dashboards are limited on the free plan (3 boards).
- Cross-filtering between PostHog and our own Supabase data (collections
  table, premium subscription state) requires either a paid PostHog plan
  with their `Data warehouse` feature or a manual export.
- Long-tail event retention on PostHog free tier is 7 days; we want to keep
  events forever for cohort analysis a year later.

**Power BI Desktop is free for individual use** (Microsoft's "Free"
licence), supports direct Postgres connections, and has a thriving DAX
community. The dashboard files (`.pbix` / `.pbit`) live in the repo so they
get versioned alongside code (Analytics #15 ships a starter template).

Power BI is **read-only against Supabase** — never instrument the app to
emit events directly to Power BI; that path goes through PostHog → Supabase
mirror first.

## The PostHog → Supabase mirror

PostHog → Power BI has **no native connector** (PostHog is too small for
Microsoft to ship one). Two options:
1. Pay for PostHog's "Data warehouse" feature ($)
2. Mirror PostHog events into our existing Supabase Postgres on the way in,
   then point Power BI at Supabase.

We pick option 2 because:
- Supabase is already in the stack (auth + collections data live there).
- Mirroring lets Power BI cross-join analytics events with `auth.users`,
  `collections`, `marketplace_listings`, etc. without an export step.
- It survives the future case where we churn off PostHog: the events live
  in our own Postgres.

The mirror is implemented as a Supabase Edge Function that accepts
PostHog's outgoing webhook (Analytics #13 task) and INSERTs into an
`analytics_events(id, occurred_at, user_id, name, properties jsonb)` table
(Analytics #12 task). The function validates a shared secret header so the
endpoint is private even if discovered.

## Privacy and opt-out

A single **Diagnostics & analytics** toggle in `app/settings.tsx`
(Analytics #18 task) controls *both* PostHog and Sentry. The toggle:
- Persists to `collectables-diagnostics-v1` AsyncStorage (already exists
  for Sentry — Crash #15).
- Honours `navigator.doNotTrack === "1"` on web automatically.
- Clears the PostHog distinct-id cookie when flipped off so the in-flight
  session doesn't leak future events.

EU users have a one-tap opt-out per GDPR Art. 7 — required for App Store
review on iOS 14.5+ even though we don't use ATT.

## Cost ceiling

At $0/month free-tier limits we can support:
- ~30 DAU on PostHog (1M events / 30 days / 30 events per session per day)
- Unlimited replays on Clarity
- ~500MB of analytics-event storage on Supabase free tier (~10M rows)
- Unlimited Power BI Desktop usage (single-user)

If we exceed PostHog's quota, the next tier is **$0.00031/event** (~$310
for 2M events). The Supabase mirror means we can downgrade PostHog to a
"event ingestion only" role and run analytics in Power BI directly.

## Implementation tasks

The full task list is in `.tasks/.tasks.md` under
"Analytics — PostHog (free 1M events/mo) + Power BI Desktop for reporting".
Each numbered Analytics #X task is independently shippable.
