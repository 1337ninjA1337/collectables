# Security Policy

## Supported versions

Collectables is a continuously-deployed web app — there is one live version, the
`main` branch deployed to GitHub Pages. Security fixes land on `main` and ship
with the next deploy; there are no long-lived release branches to backport to.

| Version            | Supported          |
| ------------------ | ------------------ |
| `main` (deployed)  | :white_check_mark: |
| Any older commit / fork | :x:           |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately via either:

- GitHub's [private vulnerability reporting](https://github.com/1337ninjA1337/collectables/security/advisories/new)
  (Security → Advisories → *Report a vulnerability*), or
- Email the maintainer at the address on the GitHub profile, with `SECURITY` in
  the subject.

Please include: a description of the issue, the affected file/endpoint, repro
steps or a proof-of-concept, and the impact you believe it has. We aim to
acknowledge within **72 hours** and to ship a fix or mitigation for confirmed
high-severity issues as quickly as a deploy allows.

Do not run automated scanners against the live Supabase project or the deployed
site in a way that degrades service for other users. Account-takeover,
data-exfiltration, and RLS-bypass findings are the highest priority.

## Security model (where to look)

- **Auth & data access** — Supabase Auth + Row-Level Security. Every table is
  RLS-gated; the client only ever holds the publishable (`anon`) key. See the
  migrations under `supabase/migrations/`.
- **Privileged operations** — Edge Functions under `supabase/functions/`. Each
  one verifies the caller with the shared `assertCaller` gate (SEC-9) before any
  service-role op, and is CORS-restricted to the app origins via the shared
  `cors` helper (SEC-10).
- **Runtime config gate** — the `localStorage` Supabase config override is
  ignored in production builds (SEC-4, `lib/runtime-config-gate.ts`).
- **Telemetry** — no PII/credentials are sent to analytics or logged in prod
  (SEC-13 `lib/analytics-pii.ts`, SEC-20 `lib/safe-log.ts`).
- **Secrets** — never committed; scanned in CI (SEC-14, `lib/secret-scan.ts`),
  injected at build time from GitHub Actions secrets (see `README-DEPLOY.md`).

---

## Incident runbook

When a credential is suspected leaked, or an account-takeover / data-exposure
incident is confirmed, work top-to-bottom. The goal order is **revoke active
access → rotate the leaked secret → redeploy → verify**.

### 0. Triage & contain (minutes)

- Flip the incident kill-switches without a code change by setting the GitHub
  Actions secret and re-running the **Deploy** workflow:
  - `EXPO_PUBLIC_REALTIME_DISABLED=true` — drops all realtime WebSocket traffic.
  - `EXPO_PUBLIC_ANALYTICS_DISABLED=true` — disables PostHog + Clarity (use on a
    privacy/telemetry incident).
- If a server-only secret leaked, treat it as compromised even if you're unsure —
  rotate it (below). Rotation is cheap; a live `service_role` key is not.

### 1. Revoke active Supabase sessions

A rotated key does **not** invalidate already-issued user JWTs. To force re-auth:

1. Supabase dashboard → **Authentication → Users**: sign out a specific user
   ("Sign out user"), or for a global revocation rotate the **JWT secret** under
   **Project Settings → API → JWT Settings** (this invalidates *every* existing
   access token immediately — highest blast radius, use for a confirmed breach).
2. If a single account is compromised, also reset that user's password / unlink
   the affected OAuth identity.

### 2. Rotate Supabase keys

- **`anon` / publishable key** (`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — rotate
  under **Project Settings → API**. Update the GitHub Actions secret, re-deploy.
  (This key is meant to ship in the client; rotate it if it was paired with a
  config-override takeover attempt.)
- **`service_role` key** (`SUPABASE_SERVICE_ROLE_KEY`, Edge Function secret) —
  **never ships to the client.** If exposed, rotate immediately under
  **Project Settings → API**, then update it in **Edge Functions → Secrets**
  (`supabase secrets set SUPABASE_SERVICE_ROLE_KEY=…`). Redeploy the functions.
- **JWT secret** — see step 1; rotating it also forces global session
  invalidation.

### 3. Rotate Cloudinary credentials

The image pipeline uses an unsigned upload preset on the client and a signed
delete path in the `delete-image` Edge Function.

1. Cloudinary console → **Settings → Security → Access Keys**: generate a new
   API key/secret pair and disable the old one.
2. Update the Edge Function secrets `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
   (and `CLOUDINARY_CLOUD_NAME` if changed) via `supabase secrets set …`.
3. If the **upload preset** was abused, rotate or lock it down under
   **Settings → Upload → Upload presets** (restrict allowed formats/folders),
   then update `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` and re-deploy the web app.

### 4. Rotate analytics / monitoring secrets (if implicated)

- `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_CLARITY_PROJECT_ID`
  — rotate in the respective vendor console, update the GitHub secret, re-deploy.
- `POSTHOG_WEBHOOK_SECRET` (the `analytics-mirror` Edge Function shared secret) —
  rotate via `supabase secrets set` and update the PostHog webhook config.

### 5. Redeploy & verify

1. Re-run the **Deploy to GitHub Pages** workflow (push a no-op commit or use the
   workflow's manual trigger) so the new secrets are baked into the bundle.
2. Confirm the **CI** and **Deploy** workflow runs are green.
3. Smoke-test: sign in, load a collection, upload+delete an image (exercises the
   rotated Supabase + Cloudinary paths).
4. Run `npm run lint:secrets` locally / confirm the CI secret-scan + gitleaks
   jobs passed — ensures no rotated secret was accidentally committed.
5. Write a short post-incident note: what leaked, when, blast radius, which keys
   were rotated, and any follow-up hardening.

### Where secrets live (reference)

| Secret | Location | Client-exposed? |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `_PUBLISHABLE_KEY` | GitHub Actions secret (build-time) | Yes (by design) |
| `EXPO_PUBLIC_CLOUDINARY_*`, `_SENTRY_*`, `_POSTHOG_*`, `_CLARITY_*` | GitHub Actions secret (build-time) | Yes (public client keys) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secret | **No — server only** |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Supabase Edge Function secret | **No — server only** |
| `POSTHOG_WEBHOOK_SECRET` | Supabase Edge Function secret | **No — server only** |
| Supabase JWT secret | Supabase project settings | **No — server only** |

See `README-DEPLOY.md` for the full secret inventory and how the deploy pipeline
injects them.

---

## Dependency advisory triage (`npm audit`)

The supply chain is scanned two ways: a `gitleaks` full-history secret scan and
a **dependency advisory baseline** step in **CI**
(`.github/workflows/ci.yml` → `npm run lint:audit-baseline`).

The baseline step is **blocking**, and it is blocking precisely because it is
quiet: it fails only on a high/critical advisory root that is not already
triaged in `lib/audit-baseline.ts` and tabled below. A bare
`npm audit --audit-level=high` cannot be blocking while any advisory is
accepted, and the non-blocking version it replaced is how thirteen high
advisories accumulated unnoticed (see below).

Re-run the triage with `npm audit` (full report) or `npm run lint:audit-baseline`
(the CI gate). When a new high/critical appears, prefer `npm audit fix` (no
breaking changes); if the only fix is a major bump, triage it and record the
decision below **and** in `ACCEPTED_HIGH_ADVISORIES` — the test keeps the two
in step.

That preference is no longer a preference. The gate reads npm's own
`fixAvailable` for every high/critical it sees and **fails on any advisory npm
can clear without a semver-major**, accepted or not — see
"Seven exemptions npm could already fix" below for why. A major-only fix is
still acceptable; it is reported on every run instead of resting on a sentence
somebody wrote once.

### Seven exemptions npm could already fix (2026-09-01)

The baseline answered *"is this advisory new?"* and nothing ever asked
*"is it still unfixable?"*. On 2026-09-01 `npm audit` reported a fix available
**within the installed ranges** for four of the six accepted roots — `nanoid`,
`brace-expansion`, `js-yaml`, `tar`, seven GHSAs between them — and a single
`npm update` on those four cleared every one. `nanoid` ships to the client and
had been on the list for a day short of a month.

Two new `browserslist` advisories (`GHSA-73wf-gq98-2v4g`,
`GHSA-c83g-rgw3-j3cx`) turned the gate red the same day and were fixed by the
same command — which is how the four were found at all. Nothing was looking.

The gate now fails on three things rather than one: an untriaged advisory, an
advisory npm can fix in range, and a baseline entry the audit no longer
reports. The third joined the failing side *because of* the second: fixing an
in-range advisory is exactly what makes its baseline entry stale, so leaving
staleness advisory-only would mean every fix this gate demands leaves the
accepted list describing a tree that no longer exists — and green.

### Resolved 2026-09-01 by an in-range `npm update` (kept for history)

| Package | Advisories | Reached the client? |
| --- | --- | --- |
| `nanoid` | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8 | **Yes** — `@react-navigation/routers` route keys |
| `brace-expansion` | GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 | No — glob/minimatch under the build toolchain |
| `js-yaml` | GHSA-5p4m-2wfm-xmqj | No — `@expo/xcpretty` / `babel-jest` |
| `tar` | GHSA-r292-9mhp-454m | No — npm/expo install-time archive handling |
| `browserslist` | GHSA-73wf-gq98-2v4g, GHSA-c83g-rgw3-j3cx | No — build-time target resolution |

The `js-yaml` row is the one worth reading twice: its accepted reason said the
fix was `react-native@0.86`, a breaking major. That was true of the *direct*
dependency and false of the tree, which had a patched version in range the
whole time. A `why` sentence is a claim about the dependency graph on the day
it was written.

### Re-triaged 2026-08-31 — the "0 high" record had gone stale

The 2026-06-28 pass cleared 1 critical + 4 high with a non-breaking
`npm audit fix` and recorded **0 high/critical**. On 2026-08-31 the same
lockfile audited at **27 advisories (13 high, 13 moderate, 1 low)**, and
`npm audit fix` had nothing non-breaking left to offer.

Two things had been wrong for those two months, and neither was visible:

- The CI step was `npm audit --audit-level=high` with
  `continue-on-error: true`. It has to be non-blocking while accepted
  advisories exist, and a step that is red on every run reports the same red
  for an advisory somebody triaged and one nobody has ever seen.
- The paragraph below this table asserted the remaining advisories "live
  entirely in dev/build-time tooling". `nanoid` is high, and it ships to every
  user.

The step is now `npm run lint:audit-baseline`, which compares the audit
against the list in `lib/audit-baseline.ts` and **fails only on a high or
critical root that is not on it** — so it is silent until something changes,
and blocking when it does. It also reports an accepted entry the audit has
stopped naming, so the list cannot quietly stop describing the tree.

### Resolved by the 2026-06-28 pass (kept for history)

`npm audit fix` (no breaking changes) cleared 1 critical + 4 high:

| Package | Sev | Advisory | Reached the client? |
| --- | --- | --- | --- |
| `shell-quote` | critical | quote() newline escaping (via `react-devtools-core`) | No — dev tooling only |
| `@xmldom/xmldom` | high | XML serialization DoS / injection (via `@expo/plist`, iOS build) | No — build-time only |
| `undici` | high | HTTP header injection / queue poisoning (via `@expo/cli`) | No — dev/build-time only |
| `ws` | high | memory-disclosure / DoS (via `@supabase/realtime-js`, expo, metro, RN) | Patched in shipped `realtime-js` chain |
| `protobufjs` | high | unbounded recursion DoS (via `posthog-js` → `@opentelemetry`) | Patched via `posthog-js` minor bump |

### Accepted high/critical — 2 roots, 4 advisories (2026-09-01)

`npm audit` reports 9 high *entries* for these 4 advisories: the extra entries
are Expo/metro packages that merely depend on one of these two and carry no
advisory of their own, and one advisory is seen down several dependency paths.

Both roots are fixed only by `expo@57`, a major — which is the whole reason
they are still on this list, and npm now restates it on every run rather than
this sentence standing in for it.

The baseline keys on the **GHSA id**. It took three versions and each wrong one
failed differently:

- the **package name** accepted every future CVE in an accepted package —
  `nanoid` already had two advisories and the entry's reasoning covered one;
- npm's per-path **`source` id** made the list churn with the lockfile
  (`brace-expansion`'s three advisories arrive as nine ids), turning a blocking
  gate red for a tree-shape change with no security content;
- the **GHSA** is the advisory's own name: stable across paths and lockfiles,
  and the thing a person reads at `https://github.com/advisories/<id>`.

"Ships to client" is not the same question as "vulnerable": a package can be in
the bundle with its vulnerable entry point unreachable.

| Package | Advisories | Ships to client? | Why accepted |
| --- | --- | --- | --- |
| `image-size` | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | No | JXL/HEIF and ICNS parser DoS in metro's asset pipeline (the `image-size-select-actual` string in the bundle is an icon name, not this package); fix = `expo@57`, breaking |
| `postcss` | GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 | No | Arbitrary file read and source-map path traversal in `@expo/metro-config`'s build-time CSS transform; fix = `expo@57`, breaking |

Severity is read off each **advisory**, not off the package: npm reports a
package at the highest severity among its advisories, so `postcss` shows "high"
while two of its four are moderate. Those two are not gated here — the moderate
and low advisories remain dev/build-time only and are revisited on each `expo`
/ `react-native` upgrade. They are also not covered by the in-range fix rule,
which reads high/critical only: a moderate with a fix available stays invisible
until it is promoted.

Any of these shown to reach the deployed client at runtime **through its
vulnerable path** is promoted to a blocking fix. Adding a package to
`ACCEPTED_HIGH_ADVISORIES` without a row here turns
`__tests__/audit-baseline.test.ts` red.
