# Deploying LifeSync (free tier)

| Piece | Service (free plan) | What runs there |
| --- | --- | --- |
| Database, Auth, Storage, cron | **Supabase Free** | Postgres + RLS, email/password auth, private buckets, `pg_cron` |
| REST API | **Vercel Hobby** (serverless function) | `backend/` (Express) |
| Web app / PWA | **Vercel Hobby** (static) | `frontend/www` |
| Email delivery (optional but recommended) | **Brevo Free SMTP** (300 emails/day) | Verification & password-reset emails |
| Source code | **GitHub** | Repository `LifeSync` |

Alternative API host: **Render Free** via [`render.yaml`](../render.yaml) (sleeps after ~15 min idle; first request then takes ~30–60 s).

---

## 1. Supabase

1. Create a project at <https://supabase.com/dashboard> (any region close to your users). Save the **database password**.
2. Apply the schema from the repo root:

   ```bash
   npx supabase login            # or: export SUPABASE_ACCESS_TOKEN=sbp_...
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # runs supabase/migrations (do NOT run seed.sql in production)
   ```

3. **Project Settings → API**: copy the **Project URL**, the **anon / publishable key** (public) and the **service_role / secret key** (keep secret; API server only).
4. **Authentication → URL Configuration**
   - *Site URL*: `https://<your-web-app>.vercel.app`
   - *Redirect URLs*: `https://<your-web-app>.vercel.app/**`
5. **Authentication → Providers → Email**: keep *Confirm email* **on**.
6. **Authentication → SMTP Settings** (recommended): enable custom SMTP (e.g. Brevo: host `smtp-relay.brevo.com`, port `587`, your Brevo SMTP login/key, a verified sender address). Without custom SMTP, Supabase only emails your project's team members and only a few per hour.
7. Confirm **Database → Extensions → pg_cron** is enabled (the migration enables it and creates the two schedules).

The same configuration can be applied with the Management API using an access token, e.g.:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"site_url":"https://<web>.vercel.app","uri_allow_list":"https://<web>.vercel.app/**",
       "smtp_host":"smtp-relay.brevo.com","smtp_port":"587","smtp_user":"…","smtp_pass":"…",
       "smtp_admin_email":"you@example.com","smtp_sender_name":"LifeSync","external_email_enabled":true}'
```

## 2. API on Vercel

```bash
cd backend
npx vercel link --yes --project lifesync-api          # creates the project
npx vercel env add SUPABASE_URL production            # paste values when prompted
npx vercel env add SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add CORS_ORIGINS production            # https://<web>.vercel.app,https://localhost,capacitor://localhost
npx vercel env add NODE_ENV production                # production
npx vercel deploy --prod
curl https://lifesync-api-<…>.vercel.app/api/health   # → {"status":"ok",…}
```

`backend/vercel.json` builds TypeScript (`npm run build`) and routes every request to the Express app in `api/index.js`.

## 3. Web app on Vercel

```bash
cd frontend
npx vercel link --yes --project lifesync
npx vercel env add LIFESYNC_SUPABASE_URL production
npx vercel env add LIFESYNC_SUPABASE_ANON_KEY production
npx vercel env add LIFESYNC_API_URL production        # https://lifesync-api-<…>.vercel.app/api
npx vercel env add LIFESYNC_APP_URL production        # https://lifesync-<…>.vercel.app
npx vercel deploy --prod
```

`frontend/vercel.json` runs `npm run build` (which generates the runtime config and icon registry), serves `www/`, rewrites deep links to `index.html` and sets security headers.

After the first deploy, update `CORS_ORIGINS` on the API and the Supabase Site URL / redirect URLs to the final web URL, then redeploy the API.

## 4. Android APK

```bash
cd frontend
# Use the production URLs so the app talks to the deployed backend:
LIFESYNC_SUPABASE_URL=… LIFESYNC_SUPABASE_ANON_KEY=… \
LIFESYNC_API_URL=https://lifesync-api-<…>.vercel.app/api \
LIFESYNC_APP_URL=https://lifesync-<…>.vercel.app \
npm run build:android
cd android && ./gradlew assembleDebug        # JDK 17 or 21 required
# → android/app/build/outputs/apk/debug/app-debug.apk
```

For a Play-Store-ready build create a keystore (never commit it) and run `./gradlew bundleRelease` with signing config.

## 5. Post-deployment checklist

- [ ] Register with a real email → verification email arrives → sign in.
- [ ] Forgot password → reset email → new password works.
- [ ] Create/edit/delete in every module; refresh the page and data persists.
- [ ] Upload a PDF and an image; preview, download, delete.
- [ ] Toggle airplane mode, create a task and a transaction, reconnect → both sync.
- [ ] Sign in as a second account → none of the first account's data or files are visible (`backend/scripts/isolation-check.mjs` automates this against production).
- [ ] Light/dark mode; phone, tablet and desktop layouts.

## Free-tier limitations

| Service | Limit that matters | Mitigation |
| --- | --- | --- |
| Supabase Free | 500 MB database, 1 GB file storage, 5 GB egress / month, 50k monthly active users; **projects pause after 7 days without activity** | Open the app (or ping the API) at least weekly; upgrade if usage grows. |
| Supabase built-in email | Only to team members, a few per hour | Configure free SMTP (Brevo 300/day). |
| Vercel Hobby | Non-commercial use; 100 GB bandwidth; function max duration 60 s; ~4.5 MB request bodies | Uploads go directly to Supabase Storage, not through functions. |
| In-memory rate limiting | Counters are per serverless instance | Supabase Auth has its own rate limits; add a shared store (e.g. Upstash) if needed. |
| Web notifications | Only while the app/PWA is open | Install the Android APK for background reminders (local notifications). |
| Render Free (optional) | Sleeps after 15 min idle, 750 h/month | Use Vercel for the API (default). |
