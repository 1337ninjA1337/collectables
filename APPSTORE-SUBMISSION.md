# Apple App Store Submission Guide — Collectables

End-to-end checklist for shipping the Expo build of **Collectables** to the
Apple App Store. Every item that requires manual work outside of code is
flagged with **MANUAL**; everything else is a config change you can make in
the repo.

---

## 1. Prerequisites (one-time, MANUAL)

| Item | Where | Notes |
| ---- | ----- | ----- |
| Apple Developer Program membership | https://developer.apple.com/programs/ | $99/year. Required to publish on the App Store. |
| Apple ID with 2FA | https://appleid.apple.com | Used to sign in to App Store Connect + Xcode. |
| App Store Connect access | https://appstoreconnect.apple.com | Created automatically after enrolling in the Developer Program. |
| Expo account (`expo` CLI logged in) | `npx expo login` | Required for EAS builds. |
| EAS CLI | `npm install -g eas-cli` | Used for cloud builds + App Store submission. |
| macOS for signing (optional) | — | Not strictly required — EAS Build runs on hosted macOS. Only needed if you want to build locally. |

After enrolling, in **App Store Connect**:

1. **Users and Access → Keys → App Store Connect API** → generate a new key
   with **App Manager** role. Save the `.p8` file, the **Key ID**, and the
   **Issuer ID**. These are needed for `eas submit`.
2. **My Apps → +** → **New App** with the bundle ID
   `com.collectables.app` (or change it in `app.json` first if you want a
   different one — it must be globally unique on the App Store).

---

## 2. Bundle identifier and signing

`app.json` currently declares:

```json
"ios": {
  "supportsTablet": true,
  "bundleIdentifier": "com.collectables.app",
  "buildNumber": "1.0.0"
}
```

- **Bundle identifier** must match the one you create in App Store Connect.
- **buildNumber** must be incremented for every new TestFlight/App Store
  upload — Apple rejects duplicate build numbers under the same version.
  EAS handles this automatically when the production profile has
  `"autoIncrement": true` (already set in `eas.json`).
- **version** is the user-visible marketing version (`CFBundleShortVersionString`).
  Bump it for every public release.

Signing certificates and provisioning profiles are managed by EAS — run
`eas credentials` once to let EAS generate them and store them in your Expo
account.

---

## 3. Required app.json additions (CODE)

The current `app.json` is missing several fields the App Store rejects builds
for. Apply this diff before the first submission:

```jsonc
"ios": {
  "supportsTablet": true,
  "bundleIdentifier": "com.collectables.app",
  "buildNumber": "1.0.0",
  "icon": "./assets/icon.png",
  "infoPlist": {
    "NSPhotoLibraryUsageDescription": "Collectables needs access to your photos so you can attach images to collection items.",
    "NSPhotoLibraryAddUsageDescription": "Collectables saves shared images back to your photo library.",
    "NSCameraUsageDescription": "Collectables uses the camera to capture photos of collection items.",
    "ITSAppUsesNonExemptEncryption": false,
    "CFBundleDevelopmentRegion": "en",
    "CFBundleLocalizations": ["en", "ru", "be", "pl", "de", "es"]
  },
  "associatedDomains": [
    "applinks:1337ninja1337.github.io"
  ]
},
```

- `ITSAppUsesNonExemptEncryption: false` → bypasses the export-compliance
  questionnaire on every upload (we only use HTTPS / standard system crypto).
- `associatedDomains` enables Universal Links for the OAuth redirect handler
  in `app/auth/callback.tsx`.
- `infoPlist.NSPhotoLibrary*` and `NSCamera*` mirror the strings already in
  the `expo-image-picker` plugin block — Apple requires both.

---

## 4. Visual assets (MANUAL)

Place the following files under `assets/` and reference them in `app.json`:

| Asset | Size | Format | app.json key |
| ----- | ---- | ------ | ------------ |
| App icon (master) | 1024×1024 | PNG, no alpha, no rounded corners | `expo.icon` and `expo.ios.icon` |
| Splash screen | 1284×2778 (or larger square) | PNG | `expo.splash.image` |
| Adaptive icon (Android, optional) | 1024×1024 | PNG | `expo.android.adaptiveIcon.foregroundImage` |

Apple **rejects** transparent or rounded-corner icons — export a flat
1024×1024 PNG. Use the brand palette already defined in
`lib/design-tokens.ts` (HERO_DARK `#261b14`, AMBER_ACCENT `#d89c5b`).

### Screenshots — required for App Store Connect listing

Apple requires at minimum:

| Device class | Resolution | Quantity |
| ------------ | ---------- | -------- |
| iPhone 6.9″ (15 Pro Max / 16 Pro Max) | 1320×2868 | 3–10 |
| iPhone 6.5″ (11 Pro Max / XS Max) | 1242×2688 or 1284×2778 | 3–10 |
| iPad 13″ (Pro M4) | 2064×2752 | 3–10 (only if `supportsTablet: true` — it is) |

Capture from the iOS simulator after a successful `eas build --profile preview`,
or use the Fastlane Snapshot tool. Recommended frames: home screen, a
collection detail, the marketplace tab, an item detail with photos,
the create-collection form.

---

## 5. App Store Connect listing copy (MANUAL)

In App Store Connect, **App Information** and **Version → 1.0 Prepare for Submission**:

- **Name**: `Collectables` (max 30 chars)
- **Subtitle**: `Catalogue, share, and trade your collections` (max 30 chars)
- **Promotional text**: optional, 170 chars, can be edited without resubmitting.
- **Description**: 4000 chars max. Cover: cataloguing items, sharing
  collections, friends + chat, the marketplace tab, premium private collections.
- **Keywords**: comma-separated, 100 chars total. Suggested:
  `collection,catalogue,collector,trading,marketplace,inventory,hobby,stamps,coins,cards`
- **Support URL**: a public URL (e.g. the GitHub Pages site or a `mailto:` form).
- **Marketing URL**: optional.
- **Primary category**: `Lifestyle`. Secondary: `Utilities`.
- **Age rating**: walk through the questionnaire. With chat enabled the
  rating will be at least **12+** (User-Generated Content).
- **Copyright**: `© 2026 Collectables`.

---

## 6. Privacy declarations (MANUAL — App Store Connect → App Privacy)

Apple requires every app to declare what data it collects and how. The
table below is generated from `lib/privacy-manifest.ts` (run
`npm run privacy:generate` after changing the module and paste the printed
table here — `__tests__/privacy-manifest.test.ts` fails when they drift; the
same module emits the committed `PrivacyInfo.xcprivacy`). Based
on the current code:

| Data type | Collected? | Linked to user? | Used for tracking? | Source |
| --------- | ---------- | --------------- | ------------------ | ------ |
| Email address | **Yes** | Yes | No | Supabase Auth (`lib/auth-context.tsx`) |
| User ID (Supabase UUID) | **Yes** | Yes | No | Supabase Auth |
| Photos | **Yes** | Yes | No | Cloudinary uploads (`lib/cloudinary.ts`) |
| Username / display name | **Yes** | Yes | No | `UserProfile` |
| Chat messages | **Yes** | Yes | No | Supabase realtime (`lib/supabase-chat.ts`) |
| Crash data / diagnostics | **Yes** | Yes | No | Sentry (`@sentry/react-native`, `lib/sentry.ts`); the user's Supabase UUID is attached so we can correlate crashes per account. PII (email, IP, cookies, Authorization header) is stripped before send by `scrubPII` (`lib/sentry.ts`). |
| Product analytics events | **Yes** | Yes | No | PostHog (`posthog-react-native`, `lib/analytics.ts`); a closed set of interaction events (`signup_completed`, `item_added`, …). Events are linked to the Supabase UUID via `identifyUser`. EU host (`eu.posthog.com`) by default. Diagnostics-toggle gated; rate-limited to 200/min/user. |
| Session replay / heatmaps | **Yes** | No | No | Microsoft Clarity (web-only, runtime `<script>` tag, `lib/clarity.ts`); anonymous interaction recordings, not linked to the user ID. Loads only when `navigator.doNotTrack !== "1"` **and** the diagnostics toggle is on. |
| Reporting / BI | **No (in app)** | — | — | Power BI Desktop (`docs/powerbi/`); no SDK ships in the app. It is an operator-side tool that connects directly to the Supabase Postgres `analytics_events` table — no additional data is collected from the device. |
| Advertising ID (IDFA) | **No** | — | — | No ads SDK present. |

Because none of the data is used for tracking, you do **not** need
`NSUserTrackingUsageDescription` and the App Tracking Transparency prompt.
Sentry crash reports and PostHog analytics are diagnostic/product-analytics
only — Apple's "Used for tracking?" column is `No` as long as the data is
not joined with third-party data sets for advertising or shared with data
brokers, which Sentry's, PostHog's, and Microsoft Clarity's terms prohibit
by default.

The user can opt out of crash reporting **and** analytics/session-replay at
any time with the single **Settings → Diagnostics & crash reports** toggle
(persisted under `collectables-diagnostics-v1`). When opted out,
`initSentry()` / `initAnalytics()` short-circuit, neither SDK loads, the
Clarity tag is never injected, and any in-flight session is torn down via
`shutdownSentry()` / `shutdownAnalytics()` / `shutdownClarity()`. On web,
the browser `navigator.doNotTrack === "1"` signal additionally defaults the
toggle off unless the user has made an explicit choice.

A public privacy policy URL is required. Suggested location: a
`PRIVACY.md` page hosted on GitHub Pages alongside the app. Include:

1. What data is collected (mirror the table above).
2. Where it is stored (Supabase, Cloudinary, Sentry, PostHog, Microsoft
   Clarity).
3. How a user can request deletion (`mailto:` or in-app account deletion).
4. Sub-processors: **Sentry** (crash diagnostics), **PostHog** (product
   analytics), and **Microsoft Clarity** (web session replay) — see the
   paragraphs below. **Power BI** is an operator-side reporting tool that
   reads from Supabase and is not a device-side sub-processor.

### Suggested public privacy policy paragraphs (sub-processors)

Drop these paragraphs (or their translated equivalent) into the public
`PRIVACY.md` page so the disclosure matches the App Store Connect
declaration:

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

---

## 7. Build with EAS (CODE + CLI)

```bash
# One-time auth
npx expo login
eas login
eas init   # links repo to the Expo project; reuse existing if already linked.

# Generate / fetch iOS credentials (signing cert + provisioning profile).
eas credentials

# Production build (cloud, runs on hosted macOS).
eas build --platform ios --profile production
```

`eas.json` already has a `production` profile with `autoIncrement: true`,
which bumps `buildNumber` automatically.

The build produces a `.ipa` URL printed at the end of the run; you can also
retrieve it via `eas build:list`.

> **Do not** run `npm run start` / `npm run ios` to validate — per CLAUDE.md
> only `npm run build` (web export) is allowed in this repo. Build verification
> for the iOS bundle happens through EAS.

---

## 8. Submit to App Store Connect (CLI)

```bash
eas submit --platform ios --latest
```

The first run will prompt for:

- The App Store Connect API key `.p8` file path (stored under `~/.expo/` for
  reuse).
- Your team's **App Store Connect Issuer ID** and **Key ID**.
- The Apple App ID (numeric, from App Store Connect → App Information).

EAS uploads the `.ipa` to App Store Connect via the App Store Connect API
and triggers TestFlight processing automatically.

To pre-fill the prompts and run unattended in CI, add this to `eas.json`:

```jsonc
"submit": {
  "production": {
    "ios": {
      "appleId": "your-apple-id@example.com",
      "ascAppId": "0000000000",
      "appleTeamId": "ABCDE12345"
    }
  }
}
```

The numeric **ascAppId** is visible in App Store Connect → App Information
under "Apple ID".

---

## 9. TestFlight (recommended before App Store release)

1. After `eas submit`, wait ~10 min for the build to finish processing in
   App Store Connect (you'll get an email).
2. **TestFlight → Internal Testing**: add yourself as an internal tester and
   install the build on a real device. No review required for internal.
3. **TestFlight → External Testing**: optional, requires a short Apple
   review (~24h) but lets you invite up to 10,000 testers via public link.
4. Submit feedback through TestFlight; iterate with `eas build` + `eas submit`
   until ready.

---

## 10. Submit for App Store review (MANUAL)

In App Store Connect → **Version 1.0 → Build**:

1. Pick the build that came through TestFlight.
2. Fill in the **App Review Information** section:
   - **Sign-in info**: provide a demo account because review needs login. Use
     a throwaway email + password seeded in Supabase. Make sure friends and
     listings exist on that account so reviewers can exercise the marketplace.
   - **Notes**: short paragraph explaining: "Collectables is an inventory and
     trading app. The demo account has sample collections, a friend graph,
     and an active marketplace listing."
   - **Contact information**: your name + email.
3. **Version Release**: pick "Manual release" so you control the launch date,
   or "Automatic" to release as soon as approved.
4. Click **Add for Review** → **Submit for Review**.

Typical review turnaround: 24–48h. Common rejection reasons specific to this
app:

- Missing privacy policy URL → fix in section 6.
- Missing demo credentials → fix in step 2 above.
- Crash on launch when Supabase is unconfigured → the existing
  `isSupabaseConfigured` guard already handles this; verify the demo account
  works on a fresh install.
- User-generated content without report/block flow → confirm `app/chat/[id].tsx`
  exposes a "Report user" path (currently the chat screen relies on the
  general profile actions). If reviewers flag this, add an inline report
  button on chat bubbles.

---

## 11. Pre-submission checklist

Run through this list before each `eas submit`:

- [ ] `npx tsc --noEmit && npm test` clean (this is `npm run lint:ci`).
- [ ] `app.json` `version` bumped if user-visible changes.
- [ ] `app.json` `infoPlist` strings present and translated for all six
      `CFBundleLocalizations`.
- [ ] App icon is 1024×1024, opaque, no alpha channel.
- [ ] At least 3 screenshots per required device class.
- [ ] Privacy policy URL is reachable from a non-logged-in browser.
- [ ] Demo account credentials work on a freshly installed build.
- [ ] `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
      baked into the EAS build (configure via
      `eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value <…>`).
- [ ] Cloudinary upload preset is unsigned and in production mode.
- [ ] Universal Link domain `1337ninja1337.github.io` serves a valid
      `.well-known/apple-app-site-association` file. (Generate via
      `eas credentials` → "iOS" → "Apple App Site Association".)

---

## 12. Ongoing operations

- **Updates**: bump `expo.version` in `app.json`, run `eas build` → `eas submit`.
  EAS auto-increments `buildNumber`.
- **Hotfix without resubmission**: use `eas update` for OTA JS-only fixes
  (no native code change). Apple permits OTA updates as long as core
  functionality and policy compliance are unchanged.
- **Rolling back**: in App Store Connect → Version → "Remove from sale".
- **Crash reporting**: `@sentry/react-native` is in `dependencies`. Once
  `EXPO_PUBLIC_SENTRY_DSN` is provisioned (see section 14) and the Sentry
  init module lands (`Crash #2`+ tasks in `.tasks/.tasks.md`), every
  uncaught exception is reported to your Sentry project automatically.

---

## 13. Quick links

- Expo iOS deploy guide: https://docs.expo.dev/submit/ios/
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- App Store Connect API docs: https://developer.apple.com/documentation/appstoreconnectapi
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/
- TestFlight overview: https://developer.apple.com/testflight/

---

## 14. Required EAS secrets (CI parity)

If you build on EAS instead of locally, mirror the GitHub Actions secrets
listed in `README-DEPLOY.md` so the bundled JS has the same env vars:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_CLOUDINARY_URL --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_APP_URL --value "https://1337ninja1337.github.io/collectables"
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "..."           # optional, enables crash reporting
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_ENV --value "production"     # optional, gates SDK init
eas secret:create --scope project --name EXPO_PUBLIC_ANALYTICS_ENV --value "production"  # optional, overrides EXPO_PUBLIC_SENTRY_ENV for analytics only; `development` disables analytics
eas secret:create --scope project --name EXPO_PUBLIC_POSTHOG_KEY --value "..."           # optional, enables PostHog analytics
eas secret:create --scope project --name EXPO_PUBLIC_POSTHOG_HOST --value "https://eu.posthog.com"  # optional, defaults to EU cloud
eas secret:create --scope project --name EXPO_PUBLIC_CLARITY_PROJECT_ID --value "..."    # optional, web-only session replay (not injected on iOS)
# Native + Hermes sourcemap upload (read by the @sentry/react-native/expo
# config plugin during EAS Build's post-bundle step). Mirrors the GitHub
# Actions sourcemap step in .github/workflows/deploy.yml.
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value "..."                 # required for native sourcemap upload
eas secret:create --scope project --name SENTRY_ORG --value "anton-m3"                   # Sentry org slug
eas secret:create --scope project --name SENTRY_PROJECT --value "collectables"           # Sentry project slug
```

Verify with `eas secret:list`. The values are encrypted at rest by Expo and
injected into builds at compile time.

The `@sentry/react-native/expo` config plugin (registered in `app.json`'s
`expo.plugins`) reads `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`
during the EAS Build post-bundle step and uploads native iOS dSYM + Hermes
JS sourcemaps automatically. The `expo.extra.sentry` block in `app.json`
duplicates the org/project slugs for the `sentry-cli` (used by older
toolchains) so both code paths see the same project.

Without `SENTRY_AUTH_TOKEN` the upload step is skipped silently — the build
still ships, but production stack traces are minified. See
`.tasks/.sentry-setup.md` §3 for token-creation steps and §10 for common
auth-token failure modes.
