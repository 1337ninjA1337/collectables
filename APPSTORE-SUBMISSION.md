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

Apple requires every app to declare what data it collects and how. Based
on the current code:

| Data type | Collected? | Linked to user? | Used for tracking? | Source |
| --------- | ---------- | --------------- | ------------------ | ------ |
| Email address | **Yes** | Yes | No | Supabase Auth (`lib/auth-context.tsx`) |
| User ID (Supabase UUID) | **Yes** | Yes | No | Supabase Auth |
| Photos | **Yes** | Yes | No | Cloudinary uploads (`lib/cloudinary.ts`) |
| Username / display name | **Yes** | Yes | No | `UserProfile` |
| Chat messages | **Yes** | Yes | No | Supabase realtime (`lib/supabase-chat.ts`) |
| Crash data / diagnostics | **No** | — | — | None — no Sentry/Crashlytics wired. |
| Advertising ID (IDFA) | **No** | — | — | No ads SDK present. |

Because none of the data is used for tracking, you do **not** need
`NSUserTrackingUsageDescription` and the App Tracking Transparency prompt.

A public privacy policy URL is required. Suggested location: a
`PRIVACY.md` page hosted on GitHub Pages alongside the app. Include:

1. What data is collected (mirror the table above).
2. Where it is stored (Supabase, Cloudinary).
3. How a user can request deletion (`mailto:` or in-app account deletion).
4. Cookies / analytics: none.

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
