# Deploying to GitHub Pages

The web build for this app is deployed automatically by
`.github/workflows/deploy.yml`. Every push to `main` builds the Expo web bundle
with `npx expo export --platform web`, copies `index.html` to `404.html`
(so client-side routes survive a refresh), and publishes the result to the
`main` branch via `peaceiris/actions-gh-pages`.

The workflow needs runtime credentials at build time. Without them the
deployed site renders disabled login buttons because
`process.env.EXPO_PUBLIC_*` is empty in the bundled JS — supply the secrets
listed below before deploying.

## Adding the required secrets

In the GitHub UI for this repository:

1. Go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** for each of the values below, copying the
   value from your local `.env` file. Names and values must match exactly.

| Secret name                                  | Source (`.env` key)                        | Notes |
| -------------------------------------------- | ------------------------------------------ | ----- |
| `EXPO_PUBLIC_SUPABASE_URL`                   | `EXPO_PUBLIC_SUPABASE_URL`                 | Required for auth + cloud sync |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`       | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`     | Required for auth + cloud sync |
| `EXPO_PUBLIC_CLOUDINARY_URL`                 | `EXPO_PUBLIC_CLOUDINARY_URL`               | Optional. Full REST base, e.g. `https://api.cloudinary.com/v1_1/<cloud-name>`. If omitted, the cloud name below is used. |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`          | `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`        | Optional. Falls back to the bundled default. |
| `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET`       | `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET`     | Optional. Falls back to the bundled default. |

The deploy workflow also pins `EXPO_PUBLIC_APP_URL` to the public site URL so
deep links resolve correctly even when shared from a sub-route.

## Manual rerun

If you change a secret, trigger a new deploy by either pushing a no-op commit
to `main` or by going to **Actions → Deploy to GitHub Pages → Run workflow**.

