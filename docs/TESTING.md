# LifeSync Testing

| Suite | Command | What it proves |
| --- | --- | --- |
| **Database** (21 tests) | `cd backend && npm run test:db` | The real migrations run on PGlite (in-process PostgreSQL) with stand-ins for Supabase's `auth`/`storage` schemas. Covers new-user bootstrap; **RLS isolation** (no cross-account reads, updates, deletes, spoofed inserts or re-assignment); FK ownership checks; anonymous access denied; storage object policies; per-user data export; scheduler-only functions locked down; recurring-task spawning (exactly once); budget alerts at 80 %/100 % (once each); idempotent reminder generation and preference opt-outs; recurring-event occurrence maths; idempotent recurring transactions; tombstones and server-authoritative `updated_at`; CHECK constraints; full data removal on account deletion. |
| **Seed** (1 test) | `cd backend && npx vitest run tests/db/seed.test.ts` | `supabase/seed.sql` applies cleanly, is idempotent and populates every module. |
| **API** (31 tests) | `cd backend && npx vitest run tests/api.test.ts` | Health check, security headers, CORS allow-list, JSON 404s; 401 for missing/invalid tokens; pagination, search sanitisation, filters, sort whitelist; field-level 422 validation; server-controlled fields stripped; idempotent create replay; optimistic concurrency (`lte updated_at`), 409 with server copy, `force`; 404 for foreign/missing rows; DB errors mapped without leaking internals; document path ownership, traversal, MIME/size limits, object existence, 60 s signed URLs; money precision; CSV formula-injection protection; finance summary maths; account-deletion confirmation; profile validation. |
| **Frontend unit** (17 tests) | `cd frontend && npm test` | Date round-trips; habit streaks (daily, custom days, weekly targets), best streak, completion rate; recurring-event expansion (until dates, far-future jumps, month-end); sync payload stripping; Markdown sanitisation (scripts, `javascript:` links, event handlers) and checklists; plain-text excerpts; CSV export; file-name sanitisation. |
| **End-to-end** (21 tests = 7 scenarios × phone, tablet, desktop) | `cd frontend && npx playwright test` | The production build runs in Chromium against an in-memory implementation of the API contract with an injected Supabase session. Covers login/register validation; every module renders with **zero console errors**; creating a task syncs a clean payload; completing tasks and habit check-ins; **offline mode** (banner, record saved locally with a *Local* badge, nothing sent until reconnect, then synced and badge cleared); **conflict resolution** (409 → *Review* badge → *Settings → Sync* → keep this device's version → server updated); dark theme. Set `SCREENSHOT_DIR=../docs/screenshots` to regenerate the README screenshots. |
| **Production check** | `cd backend && SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… API_URL=… node scripts/isolation-check.mjs` | Against the **deployed** system: creates two temporary accounts, exercises every module, storage upload/signed download/no public URL, then proves account B cannot list, read, update, delete or download account A's data through the API, Supabase REST or Storage, and that anonymous clients see nothing. Cleans up through the real account-deletion endpoint. |

## Latest results (2026-11-10, local)

```
backend   Test Files 3 passed (3)    Tests 53 passed (53)
frontend  Test Files 1 passed (1)    Tests 17 passed (17)
e2e       21 passed (phone, tablet, desktop)
build     ng build (production) OK: initial bundle 1.34 MB raw / ~306 kB transferred
android   ./gradlew assembleDebug: BUILD SUCCESSFUL (app-debug.apk, 9.2 MB; JDK 21, SDK 36)
```

Bugs found and fixed by these suites during development included: checklist items losing their state in rendered Markdown, the brand colour being overridden by Ionic's defaults, inconsistent "overdue" counts between the stats and the grouped list, the account theme overriding a device-specific theme on every launch, and toasts rendering underneath the mobile navigation.

## Production results (2026-11-10, https://lifesync-roan-nine.vercel.app)

```
isolation-check.mjs   61 passed, 0 failed
  every module CRUD, idempotent replay, 409 conflicts, 422 validation, budget alerts,
  recurring transactions, reminders, finance summary, CSV, sync pull, private upload,
  60 s signed URL, no public URL; user B blocked from listing/reading/updating/deleting/
  downloading user A's data via API, Supabase REST and Storage; anon sees nothing;
  document + file deletion; data export; password-checked account deletion; full cleanup
live e2e (Playwright)  14 passed (desktop + phone)
  real sign-in → dashboard; task, event, note (autosave), habit + check-in, transaction,
  goal all verified in the production DB; document upload → preview → delete; offline
  task → Local badge → reconnect → synced; profile update; password reset via recovery
  link; sign-out clears IndexedDB and protects routes
sign-up (Supabase Auth) user created, confirmation required
```

Live suite: `LIVE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx playwright test -c playwright.live.config.ts` (creates and deletes a temporary user).

## Not covered automatically

- Real email delivery (verification / password-reset emails). Supabase's built-in mailer only delivers to the project team's addresses; configure SMTP (see [DEPLOYMENT.md](DEPLOYMENT.md)) for all users.
- OS-level notification delivery on Android: verify on a device with *Settings → Notifications → Send test*.
- iOS builds (requires macOS/Xcode).
