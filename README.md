# HRD · Horse Real-Time Data

Internal admin dashboard that mirrors safely accessible EFM data. HRD is a separate application and database. **Do not change EFM code, configuration, permissions, schema, or deployment.** No live data is embedded or seeded in this application.

## Local setup

Requires Node 22.12+ and a separate PostgreSQL database. Install dependencies with `npm ci`. Copy `backend/.env.example` to `backend/.env` and configure:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | HRD database only; never EFM's database |
| `TOKEN_ENCRYPTION_KEY` | Base64 32-byte key, generated with `openssl rand -base64 32`; identical in API and scheduler |
| `GOOGLE_CLIENT_ID` | Google web client ID; configure the HRD website as an authorised JavaScript origin |
| `ADMIN_EMAILS` | Comma-separated administrator email allow-list |
| `APP_ORIGIN` | Exact frontend origin, e.g. `http://localhost:8001`, no trailing slash |
| `EFM_ALLOWED_HOSTS` | Comma-separated exact approved HTTPS hostnames, no wildcards or ports |

Run `npm run db:migrate`, then `npm run dev`. Open http://localhost:8001. The Vite frontend proxies `/api` to the HRD backend on port 8501. Without Google configuration, the login screen explains that sign-in is awaiting setup; no authentication bypass is available.

## Club onboarding and live activation

1. Obtain written club approval and confirm applicable EFM integration terms. Record the approval reference.
2. Sign in with an allow-listed HRD administrator account. Add the club website, brief, existing approved employee access token, issuer, and approval reference in HRD's club form. Do not share tokens in chat/email, screenshots, or source code.
3. Test the connection; HRD checks `/api/auth/me` and account approval using the existing EFM service.
4. Run **Sync & reconcile**. Compare HRD's employee/horse counts and food totals with EFM. Review route access and dataset timestamps. An optional route denied by EFM remains visibly unavailable. Employee and horse access are required for activation.
5. Activate after a successful available-data sync within 15 minutes. Scheduling begins only for active clubs. Every five minutes, the scheduler checks authentication and imports approved datasets.
6. When a credential expires or is revoked, synchronization pauses. Replace the token in HRD, test and reconcile again, then reactivate. No EFM password is stored, no account is created, and permissions are never changed.

## What is mirrored

Reviewed read-only routes: `/api/auth/me`, `/api/employees`, `/api/employees/{id}`, `/api/horses`, `/api/horse-care-team`, `/api/health-records`, `/api/medicine-logs`, `/api/feed-inventory`, `/api/feed-inventory/consumption-report`, `/api/groceries-inventory`.

The integration uses GET only with fixed routes and query keys. URLs must use approved public HTTPS hosts, the connector validates every DNS address and pins the connection to a checked address, and redirects are refused. No generic HTTP proxy exists. Tokens are AES-256-GCM encrypted with the club ID as authenticated context. Existing employee tokens retain their EFM permissions; HRD restricts its own calls rather than claiming EFM enforces read-only scopes.

**Excluded:** horse-feed list/summary reads trigger notification writes; grocery/stock tracker reads create rows; horse-by-ID supports updates only. All unreviewed routes are catalogued but never requested. Joining dates, feed menus, training history, and additional unexposed fields remain unavailable. Horse documents are references from health records; HRD doesn't retrieve or republish files.

`shared/route-catalog.json` is a committed static inventory of 128 EFM routes from the supplied source. Regenerate after a deliberate source review with `node scripts/catalog.mjs /absolute/path/to/Stable/backend/src/pages/api`. The tool reads EFM and writes only the HRD catalog. New inventory entries are excluded by default; adding them to live access requires reviewing GET side effects and updating the connector.

Feed additions/balances/total usage are **monthly source figures**, never prorated for partial dates. The consumption report uses EFM's source UTC day boundaries, imports 1 January 2000 through the current UTC date, and preserves daily totals separately from all-period per-horse totals. Times are displayed in Asia/Kolkata. Grocery rows without a purchase date remain visible with an unavailable date; grocery consumption is unavailable. EFM quantities and units are preserved without cross-unit conversion.

EFM has no consistent multi-route snapshot API. HRD checks pagination totals and duplicate IDs, and publishes each fully fetched dataset atomically. A failing dataset keeps its preceding data. A partial refresh is marked stale until successful recovery; row timestamps distinguish refreshed data. Large imports that exceed EFM's employee pagination limit or HRD's 50,000-record/page-response limits fail safely instead of silently truncating.

## Validation

`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

Database tests are skipped unless `HRD_TEST_DATABASE_URL` points at an isolated database **named `hrd_test`**. They truncate only HRD-prefixed tables in that database. Run `HRD_TEST_DATABASE_URL=postgresql://.../hrd_test npm test` to cover real PostgreSQL sessions, credential handling, isolated clubs, atomic replacement, sync failures/recovery, scheduling locks, and retention. EFM traffic is mocked in tests; no real EFM request is made. Browser tests use a separately configured test database and server-side session fixtures, never a production auth bypass. See `tests/e2e/README.md`.

UI checks can run independently of PostgreSQL and EFM: `npx playwright install chromium`, then `npm run test:ui`. The suite starts only Vite on port 8121 and intercepts every HRD API request with two synthetic club fixtures. It covers desktop/mobile layout, navigation focus, dialogs, loading and recovery, filtering, pagination, food date semantics, and activation errors. Screenshots are saved under `test-results/`. Use `HRD_CHROMIUM_EXECUTABLE` when Chromium is already installed at a custom path. These fixtures are test-only and never fill live dashboard gaps.

## Render deployment

The [Render Blueprint](https://render.com/docs/blueprint-spec) in `render.yaml` declares only HRD's static frontend, Next.js backend, private PostgreSQL database, and [five-minute cron job](https://render.com/docs/cronjobs). Services use Render's default paid compute/database plans; review costs in your account before provisioning.

1. Push **this HRD directory** to its own private Git repository and connect a Render Blueprint. No EFM repository/deployment is needed.
2. Set `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS` and `APP_ORIGIN` on the API service when prompted. The shared HRD settings group generates a 32-byte `TOKEN_ENCRYPTION_KEY` for API and cron and holds `EFM_ALLOWED_HOSTS`. Back up the encryption key securely; changing it makes existing credentials unreadable. Configure Google JavaScript origins for the final HRD frontend URL.
3. Confirm the assigned API URL. If Render adds a suffix to `hrd-pilot-api.onrender.com`, update only HRD's `/api/*` frontend rewrite destination in the Blueprint to that URL. Keep the API rule before the SPA fallback. Render [rewrites](https://render.com/docs/redirects-rewrites) preserve the browser's frontend origin so HRD uses same-origin cookies and requests.
4. Verify the frontend's `/api/health` responds with JSON, a Google login sets an HttpOnly/Secure session cookie, refresh stays signed in, logout revokes it, and an unapproved account is denied. Google tokens are [verified server-side](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), including audience, signature and verified allow-listed email.
5. API pre-deploy applies idempotent HRD migrations. Allow the API migration to finish before the cron job's first run; rerun a failed initial cron afterwards.
6. Complete club reconciliation before activation. Confirm cron runs every five minutes, route diagnostics update, and stale data is flagged after 15 minutes. Configure Render failure notifications for the cron job and API.

No external service was provisioned by local setup. Live deployment requires a private Git repository, Render access, Google client settings and an approved EFM token. Keep all secrets in Render's settings and the HRD onboarding form, never in Git.

## Operations and retention

`npm run sync` runs one scheduling pass. Per-club PostgreSQL advisory locks serialize manual/scheduled sync with activation, token replacement and disconnect. Check **API Routes** for last check/status/latency and **Activity log** for logins, key changes and club actions. Backend logs deliberately omit request bodies, database error details and EFM payloads.

Disconnect deletes the stored credential immediately. Maintenance in the scheduled job purges disconnected-club personal data after 30 days, sync diagnostics after 30 days, audit events after 90 days, and expired sessions/rate-limit counters. Current connected-club records remain until replaced or disconnected. Backups may retain older records according to your separately configured Render backup policy; restrict backup access and align that policy with club approval.

Back up HRD's database and encryption key separately. For rollback, restore the previous HRD release; disable the HRD cron if needed. EFM remains untouched throughout.
