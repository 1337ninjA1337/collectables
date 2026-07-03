# Power BI — cost projection and the free-tier tipping points

[`docs/powerbi-connection.md`](./powerbi-connection.md) §6 says "for a
single-author dashboard, a daily manual refresh is usually fine". This
companion makes the *when do we outgrow free* concrete: what stays $0, which
feature is the first paid trigger, and what each tier costs when we hit it.

## Today: $0/month

| What we do now                                      | Tier needed        | Cost |
| --------------------------------------------------- | ------------------ | ---- |
| Author reports in Power BI Desktop                   | Desktop (free)     | $0   |
| Query `analytics_events` via the session pooler      | Desktop (free)     | $0   |
| Manual refresh before reading the dashboard          | Desktop (free)     | $0   |
| Share as a `.pbix`/`.pbit` file (repo starter template) | Desktop (free)  | $0   |

Everything the connection guide describes — including the starter template in
`docs/powerbi/` — runs on the free Desktop tier indefinitely.

## The tipping points

Ordered by how likely we are to hit them; the **first paid trigger is
scheduled refresh or a second viewer**, not data volume.

| Trigger (the moment you want…)                            | Tier forced          | Cost (2026 list)      |
| --------------------------------------------------------- | -------------------- | --------------------- |
| **Scheduled refresh** (dashboard updates itself overnight) | Power BI **Pro**     | **$10/user/month**    |
| **>2 viewers** — publishing to a workspace others open, each **viewer also needs Pro** | Pro for every viewer | $10 × N users/month |
| Larger models (>1 GB per dataset), XMLA endpoint, paginated reports | Premium Per User | $20/user/month  |
| Org-wide distribution without per-viewer licenses          | Premium capacity (F/P SKU) | from ~$260/month (F2) — not our scale |

Rules of thumb:

- **1 author, manual refresh, 0–2 occasional viewers** (they open the `.pbix`
  in their own free Desktop): stay at **$0**.
- **1 author + scheduled refresh, no viewers**: **$10/month** (one Pro seat).
- **1 author + 4 teammates viewing a published workspace**: **$50/month**
  (5 Pro seats — the viewers' seats usually surprise people, budget them in).
- Dataset size will not be our trigger: at the PostHog free-tier ceiling
  (1M events/month, see [`docs/analytics-platform.md`](./analytics-platform.md))
  a year of `analytics_events` is well under the 1 GB Pro dataset cap.

## The $0 escape hatch

If the first trigger we hit is *scheduled refresh* or *a couple of viewers* —
and not a hard Power BI feature — switch to the
[Metabase fallback](./metabase-connection.md) instead of buying Pro: its
scheduled dashboard subscriptions and unlimited viewers are free on the
open-source tier, against the same `analytics_events` table. Budget for Pro
only when someone specifically needs the Power BI feature set (DAX models,
Excel integration, the org already lives in Microsoft 365).

## Related docs

- [`docs/powerbi-connection.md`](./powerbi-connection.md) — the connection
  guide this projects costs for.
- [`docs/metabase-connection.md`](./metabase-connection.md) — the $0
  alternative for the scheduled-refresh / viewers triggers.
- [`docs/analytics-platform.md`](./analytics-platform.md) — the upstream
  PostHog/Supabase free-tier ceilings that bound our data volume.
