<!--
  SEC-22 — Security review wiring.
  Diffs that touch security-sensitive surfaces get an automatic `/security-review`
  pass from `.github/workflows/claude-security-review.yml` (path-filtered to the
  globs listed below). This template is the human-facing half: tick the box and the
  bot's review will be waiting on the PR. Do not delete the Security section.
-->

## What

<!-- One or two sentences: what does this PR change and why. -->

## How

<!-- Notes for the reviewer: approach, trade-offs, anything non-obvious. -->

## Security review

This PR receives an **automatic `/security-review` pass** when it touches any of
these security-sensitive surfaces (see `.github/workflows/claude-security-review.yml`):

- `lib/supabase-*` / `lib/supabase.ts` — backend client, auth tokens, RLS-gated reads/writes
- `supabase/functions/**` — Edge Functions running with the service-role key
- `lib/cloudinary*` — image upload credentials / signing
- `lib/auth-*` / `app/auth/**` — session, OAuth callback, token handling

- [ ] My diff does **not** touch the surfaces above — no security pass needed.
- [ ] My diff touches one or more of the surfaces above — I have read the automatic
      `/security-review` comment and addressed (or explicitly justified) every finding.

When in doubt, request another pass with `@claude /security-review` in a comment.

## Checklist

- [ ] `npm run lint:ci` is green (tsc + hex + migration-docs + secrets + tests)
- [ ] `npm run build` succeeds
- [ ] DB/SQL changes (if any) are mirrored into `MANUAL-TASKS.md`
- [ ] No credentials are committed
