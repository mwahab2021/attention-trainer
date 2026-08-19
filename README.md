# Attention Trainer

A private, local-first attention-training experiment: 30 sessions over six weeks, adaptive intervals, reading-transfer checks, progress charts, portable exports, and optional Supabase sync. It is a static site and works on GitHub Pages.

## What is included

- Five sessions per week: 20 minutes in Weeks 1–2, 25 minutes in Weeks 3–4, and 30 minutes in Weeks 5–6.
- Breath-focused trials completed with headphones on and eyes closed, following the core MediTrain protocol.
- A 20-second initial interval. Each trial with uninterrupted attention to the breath increases the next interval by 10%; any mind-wandering decreases it by 20%.
- Reading-transfer tests at Baseline, Week 2, Week 4, and Week 6.
- Local-first saves in the browser. Training continues offline; changes queue and sync after sign-in when connectivity returns.
- Private cross-device sync using Supabase magic-link authentication and Row Level Security (RLS).
- JSON backup/import, CSV summaries, responsive progress charts, and no build step.

> This is a self-experiment tool, not medical care or a diagnostic instrument. Export backups periodically. Browser storage can be cleared by the browser or device.

## 1. Run locally

Because browser authentication callbacks work best over HTTP, serve the folder instead of double-clicking `index.html`.

If Python is installed:

```powershell
cd "$HOME\Documents\Focus Project"
python -m http.server 8080
```

Open `http://localhost:8080`. The app works immediately in local-only mode; Supabase setup is optional.

## 2. Create and configure Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor**, create a new query, paste the complete contents of `schema.sql`, and click **Run**. This creates both tables, constraints, indexes, and private RLS policies.
3. Open **Project Settings → API** (or **Settings → API Keys** in newer dashboards). Copy:
   - **Project URL**
   - The browser-safe **anon/public** key (a publishable key is also suitable if that is what your dashboard provides)
4. Open `supabase-config.js` and replace the two placeholders:

```js
window.ATTENTION_TRAINER_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_ANON_OR_PUBLISHABLE_KEY"
};
```

Never put a `service_role` or secret key in this file. GitHub Pages is public, so every deployed file is visible. The anon/publishable key is designed for browser use; RLS is what keeps rows private.

## 3. Configure email magic links

In Supabase Dashboard:

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to your final site address, for example `https://YOUR_GITHUB_USERNAME.github.io/Focus-Project/`.
3. Add redirect URLs for every address you use:
   - `http://localhost:8080/**`
   - `https://YOUR_GITHUB_USERNAME.github.io/Focus-Project/**`
4. Open **Authentication → Providers → Email** and leave Email enabled. Enable magic-link/OTP sign-in and choose whether email confirmation is required.
5. For reliable production delivery, configure custom SMTP under **Project Settings → Authentication → SMTP**. Supabase's default mail service is intended for testing and is rate-limited.

Sign-in links return to the exact page that requested them. The app detects the session, merges cloud rows with local records by ID and most recent `client_updated_at`, then uploads any remaining local changes.

## 4. Test before deploying

1. Open the local site, record a short session (you can use **Finish early**) and a reading test.
2. Export JSON and confirm a backup downloads.
3. Sign in by magic link. The account button should show **Synced** after the merge.
4. Open the site in a private window or second browser, sign into the same email, and confirm the records appear.
5. In the first browser, go offline, save another test/session, then reconnect and select **Sync now**. Confirm it appears in the second browser after syncing there.

## 5. Deploy with GitHub Pages

### Option A: GitHub website

1. Create a GitHub repository, for example `Focus-Project`.
2. Upload all files from this folder to the repository root. `index.html` must remain at the root.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Choose branch `main`, folder `/ (root)`, then **Save**.
6. Wait for the Pages deployment, then open the published URL shown by GitHub.
7. Add that exact URL to Supabase's Site URL and redirect URL list as described above.

### Option B: Git command line

```powershell
cd "$HOME\Documents\Focus Project"
git init
git add .
git commit -m "Add cloud-synced Attention Trainer"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/Focus-Project.git
git push -u origin main
```

Then enable Pages in repository settings as described in Option A.

## Data and sync behavior

The browser always writes first to local storage under `attention-trainer-v1`. If a signed-in Supabase session and network are available, it also upserts records. Failed writes stay in a pending queue and retry on startup, sign-in, reconnect, or **Sync now**.

During a merge, records are matched by UUID. If both copies differ, the copy with the later `client_updated_at` wins. Session numbers and reading checkpoints are unique per account in the database, preventing accidental duplicates. Signing out leaves the local copy on that browser; use **Erase local data** on a shared device after signing out.

The app loads the Supabase JavaScript library from jsDelivr. If that CDN is unavailable, local-only features still work after the page has loaded, but authentication/sync is unavailable until the library can load.

## Files

- `index.html` — application structure and dialogs
- `styles.css` — responsive visual design
- `app.js` — training, storage, charts, exports, authentication, and sync
- `supabase-config.js` — public project configuration placeholders
- `schema.sql` — database tables, constraints, indexes, and RLS policies
