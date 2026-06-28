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
an `npm audit --audit-level=high` step in **CI** (`.github/workflows/ci.yml`).
The audit step is **non-blocking** (`continue-on-error: true`) — it surfaces new
high/critical advisories on every PR for review without wedging the deploy when
the only available fix is a breaking major bump of a build-time dependency.

Re-run the triage with `npm audit` (full report) or `npm audit --audit-level=high`
(the CI gate). When a new high/critical appears, prefer `npm audit fix` (no
breaking changes); if the only fix is a major bump, record the decision below.

### Resolved (SEC-8, 2026-06-28)

`npm audit fix` (no breaking changes) cleared **all** high/critical advisories —
1 critical + 4 high → **0**:

| Package | Sev | Advisory | Reached the client? |
| --- | --- | --- | --- |
| `shell-quote` | critical | quote() newline escaping (GHSA — via `react-devtools-core`) | No — dev tooling only |
| `@xmldom/xmldom` | high | XML serialization DoS / injection (via `@expo/plist`, iOS build) | No — build-time only |
| `undici` | high | HTTP header injection / queue poisoning (via `@expo/cli`) | No — dev/build-time only |
| `ws` | high | memory-disclosure / DoS (via `@supabase/realtime-js`, expo, metro, RN) | Patched in shipped `realtime-js` chain |
| `protobufjs` | high | unbounded recursion DoS (via `posthog-js` → `@opentelemetry`) | Patched via `posthog-js` minor bump |

### Accepted / unfixable (no breaking bump)

The remaining advisories are all **moderate or low** and live entirely in
**dev/build-time tooling** that never reaches the production web bundle's
runtime attack surface. Their only `npm audit fix --force` path is a breaking
major bump of `react-native` (→ 0.86) or `expo` (→ 56), which is out of scope
for a security-patch task and is tracked separately as a framework-upgrade item.

| Package | Sev | Source (dev/build only) | Why accepted |
| --- | --- | --- | --- |
| `js-yaml` | moderate | `@expo/xcpretty` (iOS build), `babel-jest` (test coverage) | Fix = react-native@0.86 (breaking); not on the runtime path |
| `postcss` | moderate | `@expo/metro-config` (build-time CSS transform) | Fix = expo@56 (breaking); build-time only |
| `uuid` | moderate | `@expo/ngrok`, `xcode` (tunnel / iOS tooling) | Fix = expo@56 (breaking); vulnerable v3/v5/v6 `buf` path unused |
| `esbuild` | low | `tsx` (test runner) | Dev-server-only, Windows-only; not used in CI/deploy |

These are revisited on each `expo` / `react-native` upgrade; if any is later
shown to reach the deployed client at runtime, it is promoted to a blocking fix.
