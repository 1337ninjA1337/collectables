# Collectables — Privacy Policy

_Effective date: 2026-07-04_

Collectables ("the app") is a collection-management app with social and
marketplace features. This page explains what data the app collects, where
it is stored, how long it is kept, and how you can opt out or request
deletion. It is the public disclosure that matches the App Store Connect
"App Privacy" declaration.

## What we collect

- **Email address and account identifier** — created when you sign in
  (email one-time code or Google/Apple sign-in). Used only to operate your
  account.
- **Your content** — collections, items, photos, marketplace listings,
  chat messages, and your username/display name.
- **Crash data / diagnostics** — uncaught errors with stack traces and
  device/OS context, if diagnostics are enabled.
- **Product analytics events** — a fixed, closed set of interaction events
  (for example: an item was added, a language was switched), if
  diagnostics are enabled.
- **Anonymous web session replays** — web version only, not linked to your
  account, if diagnostics are enabled.

We do **not** collect advertising identifiers, and no data is used for
cross-app tracking, sold, or shared with data brokers.

## Where your data is stored (sub-processors)

> **Accounts and app data.** Collectables uses Supabase (Supabase, Inc. —
> https://supabase.com) to store your account (email address, user
> identifier) and the content you create: collections, items, listings,
> friend connections, and chat messages. Access is protected by
> row-level-security policies so other users only see what you make
> visible. For Supabase's privacy practices and DPA, see
> https://supabase.com/privacy and https://supabase.com/legal/dpa.

> **Photos.** Item and collection photos you attach are uploaded to
> Cloudinary (Cloudinary Ltd. — https://cloudinary.com), an image hosting
> and delivery sub-processor. Photos are stored under non-guessable URLs
> and are only surfaced where you attach them. For Cloudinary's privacy
> practices, see https://cloudinary.com/privacy.

> **Crash reporting and diagnostics.** Collectables uses Sentry
> (Functional Software, Inc., d/b/a Sentry — https://sentry.io) as a
> data sub-processor to collect uncaught exceptions, stack traces, and
> the device/OS context required to debug them. The crash payload
> includes your Supabase user identifier so we can correlate reports
> per account, but personally identifying fields (email address, IP
> address, cookies, and `Authorization` headers) are stripped client-side
> before transmission. Diagnostic data is retained by Sentry for up to
> 90 days under their default retention policy and is never sold,
> shared with data brokers, or used for advertising. You can disable
> crash reporting at any time from **Settings → Diagnostics & crash
> reports**; when disabled, no events leave the device. For Sentry's
> own privacy practices and DPA, see https://sentry.io/privacy/ and
> https://sentry.io/legal/dpa/.

> **Product analytics.** Collectables uses PostHog (PostHog, Inc. —
> https://posthog.com) as a data sub-processor to understand which
> features are used. We send a fixed, closed set of interaction events
> (for example: an item was added, a listing was created, a language was
> switched) associated with your Supabase user identifier so usage can be
> understood per account. We do **not** send free-text content, photos,
> chat messages, email addresses, or advertising identifiers, and the
> data is never sold or used for cross-app advertising. Events are sent to
> PostHog's EU region (`eu.posthog.com`) by default and are rate-limited
> client-side. You can disable analytics at any time with the same
> **Settings → Diagnostics & crash reports** toggle; when disabled, no
> events leave the device. For PostHog's privacy practices and DPA, see
> https://posthog.com/privacy and https://posthog.com/dpa.

> **Web session replay.** On the web version only, Collectables uses
> Microsoft Clarity (Microsoft Corporation — https://clarity.microsoft.com)
> to record anonymous interaction sessions and heatmaps that help us find
> usability problems. Clarity recordings are **not** linked to your
> account identifier, and Clarity masks input fields by default. The
> Clarity script is never loaded if your browser sends a
> `Do Not Track` (`navigator.doNotTrack`) signal or if you have disabled
> diagnostics in **Settings → Diagnostics & crash reports**. Clarity is
> not used on the iOS or Android app. For Microsoft's privacy practices,
> see https://privacy.microsoft.com/privacystatement.

> **Reporting.** Aggregated product-analytics data is reviewed internally
> using Microsoft Power BI Desktop. Power BI is an operator-side tool that
> connects directly to our Supabase database; no Power BI software is
> included in the app and no additional data is collected from your device
> for reporting.

## Analytics privacy and opt-out

A single **Diagnostics & analytics** toggle in the app's Settings screen
controls crash reporting, product analytics, and web session replay
together:

- Opting out takes one tap and applies immediately: the analytics and
  crash-reporting SDKs are shut down, the Clarity tag is never injected,
  and the analytics identifier cookie is cleared so the in-flight session
  cannot leak future events.
- On the web, a browser **Do Not Track** (`navigator.doNotTrack === "1"`)
  signal is honoured automatically: diagnostics default to off unless you
  make an explicit choice.
- EU users therefore have a one-tap opt-out consistent with GDPR Art. 7.

**No personal content in the event stream.** Telemetry is
taxonomy-first and deny-by-default: every analytics event's property keys
are declared up-front in code, and free-text or personally identifying
shapes (item names, chat messages, email addresses) can never be attached
to an event under any key. Only identifiers, enumerations, and booleans
leave the device. Crash breadcrumbs are limited to navigation routes and a
constant context label — no request bodies and no form values.

## Data retention

Sub-processor retention windows:

| Surface | Store | Retention window |
| --- | --- | --- |
| Crash reports | Sentry | 90 days |
| Product events | PostHog (EU cloud) | 7 days (hot); longer history lives only in our own database, below |
| Session replays | Microsoft Clarity (web only) | 30 days |

> **Server-side data retention.** Data we store in our own Supabase database
> is pruned automatically on a daily schedule so it is not kept longer than
> needed. Specifically: server-side product-analytics events are retained for
> up to **13 months** and then deleted; analytics events that are not linked to
> a signed-in account (anonymous) are deleted after **30 days**; and when you
> delete a collection, item, profile, or friend connection, the record is
> first hidden ("soft-deleted") so the change syncs to your other devices and
> is then permanently removed after a **90-day** grace period. These windows
> are enforced by a scheduled database job (`pg_cron`) and apply in addition to
> the sub-processor retention policies described above.

## Deleting your data

You can delete individual collections, items, listings, and friend
connections in the app at any time; deletions propagate to our database as
described in the retention section above. To request deletion of your
entire account and all associated data, contact us at
**1337.antoxa@gmail.com** from the email address linked to your account.

## Changes to this policy

We will update this page when the app's data practices change; the
effective date above reflects the latest revision. The policy is tracked
in the app's public repository, so every change is reviewable.
