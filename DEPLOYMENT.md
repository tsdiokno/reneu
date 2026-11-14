# Reneu Deployment Guide (GitHub + Vercel + Supabase + Cloudflare Turnstile)

Straightforward end-to-end deployment pipeline for **Reneu** using **GitHub**, **Vercel**, **Supabase**, and **Cloudflare Turnstile**, with automatic **dummy data offloading**.

```
GitHub (Source & Releases) ──▶ Vercel (Hosting & /api Proxy) ──▶ Supabase (Postgres + Auth)
                                                                       ▲
                                                       Cloudflare Turnstile (Bot Protection)
```

---

## Step 1: Set Up GitHub (Source & Automated CI/CD)

1. **Push Repository to GitHub**:
   - Push your code to a GitHub repository (`main` branch).
   - GitHub Actions automatically runs [`.github/workflows/release.yml`](./.github/workflows/release.yml) on pushes to `main`, `v*` tags, or published GitHub Releases (`npm ci`, `npm run lint`, `npm audit --audit-level=high`, `npm run build` with `VITE_ENABLE_DUMMY_DATA=false`).
2. **Release Tag Versioning**:
   - In **GitHub** $\rightarrow$ **Releases** $\rightarrow$ **Draft a new release**, publish a tag like `v1.3.1`.
   - Production builds resolve this tag dynamically for **Settings > Application Software Updates** (`Dev` renders only in local development).
3. **Optional CLI Deployment Secrets**:
   - If you want GitHub Actions (instead of Vercel's Git integration) to push builds to Vercel, add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` under **GitHub Repo Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**.

---

## Step 2: Set Up Supabase (Database & Auth)

1. **Create Project & Apply Schema**:
   - Sign in at [supabase.com](https://supabase.com) and create a project.
   - Open **SQL Editor** $\rightarrow$ **New Query**, paste [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**.
   - Creates `public.notes` and `public.user_settings` isolated per `auth.uid()` via PostgreSQL Row Level Security (RLS).
2. **Configure Auth Providers & URLs**:
   - **Authentication** $\rightarrow$ **Providers**:
     - **Email**: Enabled by default (toggle *Confirm email* as desired).
     - **Google (Optional)**: Create a Web OAuth Client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), add the Supabase callback URL shown in the Google provider panel, and paste Client ID & Secret.
   - **Authentication** $\rightarrow$ **URL Configuration**:
     - **Site URL**: Your Vercel production URL (e.g., `https://reneu.vercel.app`).
     - **Redirect URLs**: Add `https://*.vercel.app/**` and `http://localhost:3000/**`.
3. **Copy API Credentials**:
   - **Project Settings** $\rightarrow$ **API**: Copy **Project URL** (`VITE_SUPABASE_URL`) and **`anon` / `public` key** (`VITE_SUPABASE_ANON_KEY`).

---

## Step 3: Set Up Cloudflare Turnstile (Bot Protection)

1. **Create Turnstile Widget**:
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) $\rightarrow$ **Turnstile** $\rightarrow$ **Add widget**.
   - Under **Domain Management**, add your Vercel production domain (and custom domain, or `localhost` if testing locally).
   - Select **Managed** (recommended) or **Invisible**, click **Create**, and copy the **Site Key** and **Secret Key**.
2. **Bind Secret Key in Supabase**:
   - Go to Supabase $\rightarrow$ **Authentication** $\rightarrow$ **Attack Protection**.
   - Enable **Captcha protection**, select **Cloudflare Turnstile**, paste the **Secret Key**, and click **Save**.
3. **Bind Site Key in Reneu**:
   - Add the **Site Key** as `VITE_TURNSTILE_SITE_KEY` in Vercel (Step 4).
   - `LoginSplash.tsx` renders the Turnstile widget dynamically when `VITE_TURNSTILE_SITE_KEY` is set and forwards `captchaToken` to Supabase Auth (`signUp` / `signInWithPassword`).

---

## Step 4: Connect GitHub to Vercel & Deploy

1. Open [vercel.com](https://vercel.com) $\rightarrow$ **Add New...** $\rightarrow$ **Project** $\rightarrow$ import your **GitHub** repository.
2. Confirm settings (preconfigured in [`vercel.json`](./vercel.json)):
   - **Framework Preset**: `Vite`
   - **Build Command**: `vite build`
   - **Output Directory**: `dist`
3. Add **Environment Variables** in Vercel Project Settings:

| Variable | Required | Value / Notes |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Yes | Supabase Project URL (Step 2) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase public `anon` key (Step 2) |
| `VITE_TURNSTILE_SITE_KEY` | Yes (if Turnstile enabled) | Cloudflare Turnstile Site Key (Step 3) |
| `VITE_ENABLE_DUMMY_DATA` | Recommended | `false` (offloads demo notes in production) |
| `GEMINI_API_KEY` | Optional | Shared server-side Gemini key (users can also supply their own BYOK key in Settings) |
| `VITE_GITHUB_REPO` | Optional | `owner/repo` (auto-detected on Vercel via Git env vars if omitted) |
| `VITE_GITHUB_RELEASE_TAG` | Optional | Explicit version tag override (e.g. `v1.3.1`) |

4. Click **Deploy**. Subsequent pushes to `main` or published GitHub releases deploy automatically.

*(Alternative CLI deploy: `npx vercel link && npx vercel --prod` after setting the env vars via `vercel env add`.)*

---

## Step 5: Dummy Data Offloading

Reneu includes 3 demo commentary notes (`seed-john1-1-*`, `seed-gen1-3-*`, `seed-rom8-28-*`) for local development. Production deployments offload them automatically across three layers:

1. **Production Build Gating (`VITE_ENABLE_DUMMY_DATA=false`)**:
   - When `VITE_ENABLE_DUMMY_DATA="false"` or in production mode (`!checkIsDevMode()`), `ensureNotesInitialized()` and `AllNotesView` skip `seedSampleCommentaries()`.
2. **Cloud-Sync Filtering & Auto-Purge (`supabaseSync.ts`)**:
   - `pushNoteToCloud()`, `flushPendingCloudSync()`, and `syncAllWithCloud()` ignore any note with an `id` starting with `seed-` so demo data never reaches Supabase.
   - Running `syncAllWithCloud()` while signed in during production automatically purges leftover local `seed-*` notes from IndexedDB.
3. **Manual / Legacy Cleanup**:
   - **Client (IndexedDB)**: Call `offloadDummyData()` from `src/services/bibleStorage.ts` to delete `seed-*` records locally.
   - **Supabase (if legacy seed notes exist)**: Run in Supabase SQL Editor:
     ```sql
     DELETE FROM public.notes WHERE id LIKE 'seed-%';
     ```

---

## Verification & Troubleshooting

- **Turnstile fails or widget doesn't load**:
  - Verify your Vercel production (and preview) domains are listed in Cloudflare Turnstile **Domain Management**.
  - Confirm `VITE_TURNSTILE_SITE_KEY` (Site Key) is set in Vercel and the matching **Secret Key** is saved in Supabase **Attack Protection**.
  - Express CSP in `server.ts` already allows `https://challenges.cloudflare.com` in `script-src`, `frame-src`, and `connect-src`.
- **`captcha verification process failed` on Sign-In / Sign-Up**:
  - Turnstile is enabled in Supabase Auth without `VITE_TURNSTILE_SITE_KEY` baked into the client bundle. Set `VITE_TURNSTILE_SITE_KEY` in Vercel and redeploy.
- **PWA Service Worker updates**:
  - [`vercel.json`](./vercel.json) enforces `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js` so new GitHub releases propagate immediately.
