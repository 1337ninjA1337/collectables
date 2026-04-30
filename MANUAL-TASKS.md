# Manual Tasks

These are the one-time manual steps you need to take outside the codebase so
that the GitHub Pages deployment (`.github/workflows/deploy.yml`) builds with
real Supabase + Cloudinary credentials instead of falling back to the runtime
"configure Supabase" form.

After every push to `main`, the deploy workflow reads the secrets below from
GitHub and bakes them into the web bundle as `process.env.EXPO_PUBLIC_*`. If a
secret is missing, the deploy still succeeds but the deployed site shows the
"connect Supabase" message and image uploads silently fail.

---

## 1. Get the values from your providers

### Supabase

1. Open https://supabase.com/dashboard and pick the project you want
   GitHub Pages to use.
2. Go to **Project Settings → API**.
3. Copy these two values:
   - **Project URL** → this is `EXPO_PUBLIC_SUPABASE_URL`
     (looks like `https://abcdefghij.supabase.co`).
   - **Project API keys → `anon` / `publishable`** key →
     this is `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     (a long JWT starting with `eyJ...`).

   Do NOT use the `service_role` key. It bypasses Row Level Security and must
   never be shipped to the browser.

### Cloudinary

1. Open https://console.cloudinary.com/ and pick the cloud you want to use.
2. On the dashboard, copy:
   - **Cloud name** (e.g. `dt57phtma`) → this is
     `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`.
3. Go to **Settings → Upload → Upload presets** and either pick an existing
   unsigned preset or create a new one (Mode: **Unsigned**, Folder: optional).
   Copy its name → this is `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET`.
4. (Optional) If you ever need to swap regions or use a custom REST endpoint,
   set `EXPO_PUBLIC_CLOUDINARY_URL` to the full base
   (`https://api.cloudinary.com/v1_1/<cloud-name>`). If you leave it unset,
   the app constructs the same URL from the cloud name above.

---

## 2. Add the secrets to GitHub

For each value, do the following in the repository on GitHub:

1. Open `https://github.com/1337ninja1337/collectables` (or whichever fork you
   deploy from).
2. Click **Settings**.
3. In the left sidebar, click **Secrets and variables → Actions**.
4. Click **New repository secret**.
5. Paste the exact name from the table below into **Name**, and the value you
   copied above into **Secret**. Click **Add secret**.
6. Repeat for every required row.

| Name                                     | Required? | Source                          |
| ---------------------------------------- | --------- | ------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`               | Yes       | Supabase → Settings → API       |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`   | Yes       | Supabase → Settings → API       |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`      | Yes       | Cloudinary dashboard            |
| `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET`   | Yes       | Cloudinary → Upload presets     |
| `EXPO_PUBLIC_CLOUDINARY_URL`             | Optional  | Only if overriding the API base |

The names must match exactly — they are referenced by the same string in
`.github/workflows/deploy.yml` and read at build time as
`process.env.EXPO_PUBLIC_*`. A typo means the variable lands in the bundle as
`undefined` and the runtime falls back to the "configure manually" form.

---

## 3. Configure Supabase Auth redirect URLs

So that magic-link / OAuth logins return to the deployed site instead of
`localhost`:

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to `https://1337ninja1337.github.io/collectables`.
3. Under **Redirect URLs**, add:
   - `https://1337ninja1337.github.io/collectables`
   - `https://1337ninja1337.github.io/collectables/auth/callback`
4. Save.

If you fork the repo to a different GitHub user, replace `1337ninja1337` with
your username everywhere above and also update `EXPO_PUBLIC_APP_URL` in
`.github/workflows/deploy.yml`.

---

## 4. Trigger a deploy

Secrets are read at workflow run time, so existing runs do not pick up new or
changed secrets. To roll the new credentials out:

- Push any commit to `main`, **or**
- Go to **Actions → Deploy to GitHub Pages → Run workflow** and run it
  manually against `main`.

Wait for the green checkmark on the **Deploy to GitHub Pages** workflow, then
hard-refresh `https://1337ninja1337.github.io/collectables`. If you still see
the "connect Supabase" form, open the browser devtools, go to **Application →
Local Storage**, and delete any `collectables-supabase-*` keys — the runtime
form persists overrides there and they win over env vars.

---

## 5. Verify

- Sign-in screen no longer shows "Configure Supabase".
- Adding an item with a photo uploads to your Cloudinary cloud (check the
  Media Library) instead of failing silently.
- Network tab shows requests going to your Supabase project URL, not the
  literal string `undefined/auth/v1/...`.

If any of these are wrong, recheck the secret names for typos and rerun the
deploy workflow.
