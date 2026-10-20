# HRD · Horse Real-Time Data

Internal admin dashboard that mirrors safely accessible EFM data. HRD is a separate application and database. Persistent integration keys require the narrowly scoped EFM key-support changes below; existing EFM business data and account permissions are preserved. No live data is embedded or seeded in this application.

## Local setup

Requires Node 22.12+ and a separate PostgreSQL database. Install dependencies with `pnpm install` (pnpm 11, pinned in `package.json`; `corepack enable` provides it). Copy `backend/.env.example` to `backend/.env` and configure:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | HRD database only; never EFM's database |
| `DB_SSL` | `false` for a local Postgres without SSL; omit for hosted databases (SSL on) |
| `DB_CA_CERT` | PEM CA certificate of a database whose certificate is not signed by a public CA (e.g. the VPS). The server certificate is always verified when SSL is on. `\n` escapes are accepted |
| `DB_SSL_SERVERNAME` | Name on the database certificate when `DATABASE_URL` uses an IP address. VPS: `srv1428008.hstgr.cloud` (its Postgres accepts IPv4 only, so keep the IP in the URL) |
| `TOKEN_ENCRYPTION_KEY` | Base64 32-byte key, generated with `openssl rand -base64 32`; identical in API and scheduler |
| `GOOGLE_CLIENT_ID` | Google web client ID; configure the HRD website as an authorised JavaScript origin |
| `ADMIN_EMAILS` | Comma-separated administrator email allow-list |
| `APP_ORIGIN` | Exact frontend origin, e.g. `http://localhost:8001`, no trailing slash |
| `EFM_ALLOWED_HOSTS` | Comma-separated exact approved HTTPS hostnames, no wildcards or ports |

Run `pnpm db:migrate`, then `pnpm dev`. Development starts the API, frontend and five-minute sync worker together. Open http://localhost:8001. The Vite frontend proxies `/api` to the HRD backend on port 8501. Without Google configuration, the login screen explains that sign-in is awaiting setup; no authentication bypass is available. For local testing only, `pnpm --filter @hrd/backend dev:session you@example.com` (an `ADMIN_EMAILS` address) prints a 12-hour session cookie to set in the browser console; it refuses to run when `NODE_ENV=production`.

## Club onboarding and live activation

1. Obtain written club approval and confirm applicable EFM integration terms. Record the approval reference.
2. Sign in with an allow-listed HRD administrator account. Add the club website, brief, persistent EFM integration key or existing approved employee access token, issuer, and approval reference in HRD's club form. Do not share tokens in chat/email, screenshots, or source code.
3. Saving a new connection or replacing its credential automatically tests `/api/auth/me`, checks account approval, and discovers the route catalog for integration keys. HRD clears the secret field immediately after saving and selects the saved club. If verification fails, the saved connection remains available; use **Test connection** to retry.
4. Run **Sync & reconcile**. Compare HRD's employee/horse counts and food totals with EFM. Open **Sync history** to review imported counts and failures for each dataset, including failures before import starts. Review route access and dataset timestamps. An optional route denied by EFM remains visibly unavailable. Employee and horse access are required for activation.
5. Activate after a successful available-data sync within 15 minutes. Scheduling begins only for active clubs. Every five minutes, the scheduler checks authentication and imports approved datasets.
6. When a credential expires or is revoked, synchronization pauses. Replace the token in HRD, test and reconcile again, then reactivate. No EFM password is stored, no account is created, and permissions are never changed.

## Persistent EFM integration key

EFM-side reference (lives in the EFM repo): `Stable/docs/hrd-integration.md`.

Deploy EFM key support before using an `efm_live_` credential in HRD. The EFM release adds an `EfmIntegrationKey` table, `/api/integrations/token`, integration-token checks in its existing API proxy, and reviewed read-only exports for feed plans, grocery usage and route discovery. Apply the reviewed additive migration `20261014120000_hrd_integration_keys` through EFM's normal release process, generate Prisma Client, and deploy the backend. Review all pending migrations before running a production migration command. Existing login JWTs remain supported; HRD can be deployed first while retaining those credentials.

### One-step link (recommended)

From a machine that has both the HRD backend env and EFM's production env (EFM `backend/` with `.env.production.local` or equivalent), with the HRD API running:

```bash
pnpm --filter @hrd/backend link:efm --efm-dir /path/to/Stable/backend --employee admin@stable.com \
  --club "Club name" --issuer "EFM administrator" --authorisation "Written approval reference" [--activate]
```

It issues the EFM key in a child process using only EFM's environment, pipes the plain key straight into HRD's onboarding API (never printed), then tests, syncs and optionally activates. It prints the key ID for revocation and per-dataset counts. If onboarding fails, the half-created club is disconnected and the key revoked. A temporary 15-minute admin session is created and deleted. Use one run per club.

### Manual key issue

On the **EFM server**, from `Stable/backend`, issue a key bound to an existing approved active employee that already has access to HRD's datasets:

```bash
npm run integration:key -- create admin@stable.com "HRD"
```

The command uses Next.js production env-file precedence, including `.env.production.local`, before importing Prisma, so it targets the running backend's database. It prints the key ID and plain key once. EFM stores only a SHA-256 hash and display prefix. Paste the key into HRD's **EFM integration key or access token** field using `https://efm.eirs.app`, then test, sync, reconcile and activate. Keep the key ID for revocation. An EFM server administrator runs these commands; no public key-creation endpoint is added.

```bash
npm run integration:key -- list
npm run integration:key -- revoke KEY_ID
```

Each connected club must use a distinct credential. HRD enforces this during onboarding and replacement, including backfilling existing encrypted credentials during migration. The key has no scheduled expiration. It stops working when revoked, its employee is deleted/disabled/unapproved/blocked, or the employee loses required permissions. It does not expand account permissions or expose additional datasets. EFM checks the database on every integration request, including requests using already-issued JWTs; database validation failure denies access.

HRD exchanges the encrypted stored key for a 15-minute JWT, caches only that JWT in memory, and renews before expiration. Exchange POSTs use the same approved HTTPS host, DNS pinning, response-size limits and redirect refusal as data reads. EFM restricts integration JWTs to the existing reviewed HRD GET routes. Keys and access tokens are never returned in HRD dashboard data.

Validate EFM with `npm run test:integration-keys`, Prisma schema validation and TypeScript before deployment. To roll back, use HRD's **Replace token** to return to employee JWT credentials. Preserve the additive key table. Previously issued integration JWTs must expire (15 minutes maximum) or be invalidated before removing their read-only enforcement in an EFM rollback.

## What is mirrored

Reviewed read-only routes: `/api/auth/me`, `/api/employees`, `/api/employees/{id}`, `/api/horses`, `/api/horse-care-team`, `/api/health-records`, `/api/medicine-logs`, `/api/feed-inventory`, `/api/feed-inventory/consumption-report`, `/api/groceries-inventory`, `/api/integrations/horse-feed-plans`, `/api/integrations/grocery-usage`, `/api/integrations/manifest`.

Data reads use GET only with fixed routes and query keys. Persistent keys are exchanged by POST to the single fixed `/api/integrations/token` route. URLs must use approved public HTTPS hosts, the connector validates every DNS address and pins the connection to a checked address, and redirects are refused. No generic HTTP proxy exists. Tokens are AES-256-GCM encrypted with the club ID as authenticated context. Existing employee tokens retain their EFM permissions; HRD restricts its own calls rather than claiming EFM enforces read-only scopes.

**Full EFM export:** EFM's `/api/integrations/export` (integration keys only, GET only) lists every EFM table and serves its rows, paginated by ID. HRD mirrors each table into `hrd_efm_rows`, replacing it atomically and keeping previous rows if a table fails. Each run is time-boxed to 150 seconds and refreshes the stalest tables first; tables refresh every 30 minutes, and a manual **Sync & reconcile** refreshes all of them. EFM never exports credential tables (`EfmIntegrationKey`, `PushSubscription`, `Account`, `Session`, `Verification`) or `Employee.password`, and HRD strips credential-named columns again. Browse the tables on the **EFM Data** page.

**Excluded:** horse-feed list/summary reads trigger notification writes; grocery/stock tracker reads create rows; horse-by-ID supports updates only. All unreviewed routes are catalogued but never requested. The integration exports read existing feed menus and grocery tracker rows without those side effects. Horse training level, discipline, workload and location are mirrored. Employee joining dates and dated training-session history are not represented in the current EFM schema; HRD labels them unavailable instead of treating account creation as a joining date. Horse documents are references from health records; HRD doesn't retrieve or republish files.

`shared/route-catalog.json` is a committed static fallback inventory of 132 EFM routes from the supplied source. Regenerate after a deliberate source review with `node scripts/catalog.mjs /absolute/path/to/Stable/backend/src/pages/api`. The tool reads EFM and writes only the HRD catalog. The EFM release also ships the reviewed catalog as `backend/src/lib/integration-route-catalog.json`. On connection tests, permanent keys fetch `/api/integrations/manifest`; HRD validates and stores that club's actual catalog. New versions of EFM must regenerate and review the shipped catalog. New inventory entries are excluded by default; adding them to live access requires reviewing GET side effects and updating the connector.

Feed additions/balances/total usage are **monthly source figures**, never prorated for partial dates. The consumption report uses EFM's source UTC day boundaries, imports 1 January 2000 through the current UTC date, and preserves daily totals separately from all-period per-horse totals. Times are displayed in Asia/Kolkata. Grocery rows without a purchase date remain visible with an unavailable date. Grocery tracker purchases, receipts, weekly used quantities and monthly balance are displayed separately as monthly source figures; partial-month ranges never prorate those figures. EFM quantities and units are preserved without cross-unit conversion.

EFM has no consistent multi-route snapshot API. HRD checks pagination totals and duplicate IDs, and publishes each fully fetched dataset atomically. A failing dataset keeps its preceding data. A partial refresh is marked stale until successful recovery; row timestamps distinguish refreshed data. Large imports that exceed EFM's employee pagination limit or HRD's 50,000-record/page-response limits fail safely instead of silently truncating.

## Validation

`pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:ui`. CI (`.github/workflows/test.yml`) runs all of them except `test:integration`, using a Postgres service instead.

Run `pnpm test:integration` to start and tear down a disposable local PostgreSQL instance (requires installed PostgreSQL binaries; set `HRD_TEST_POSTGRES_BIN` if needed). It never loads `backend/.env`. Database tests otherwise skip unless `HRD_TEST_DATABASE_URL` points at an isolated local database **named `hrd_test`**. They truncate only HRD-prefixed tables in that database. Run `HRD_TEST_DATABASE_URL=postgresql://.../hrd_test pnpm test` to cover real PostgreSQL sessions, credential handling, isolated clubs, atomic replacement, sync failures/recovery, scheduling locks, and retention. EFM traffic is mocked in tests; no real EFM request is made. The database suite exercises the actual API handler, encryption, route discovery, all ten mirrored datasets, activation, scheduling, rotation, revocation, isolation, migration preservation and failure recovery. EFM responses are synthetic only inside tests. Browser checks use API fixtures and do not prove that the deployed EFM release is live.

UI checks can run independently of PostgreSQL and EFM: `pnpm exec playwright install chromium`, then `pnpm test:ui`. The suite starts only Vite on port 8121 and intercepts every HRD API request with two synthetic club fixtures. It covers desktop/mobile layout, navigation focus, dialogs, loading and recovery, filtering, pagination, food date semantics, and activation errors. Screenshots are saved under `test-results/`. Use `HRD_CHROMIUM_EXECUTABLE` when Chromium is already installed at a custom path. These fixtures are test-only and never fill live dashboard gaps.

## Vercel deployment (current)

Live: website `https://hrd-web-five.vercel.app`, API `https://hrd-api.vercel.app` (Vercel team "ak's projects", Hobby). The database stays on the VPS, so existing clubs and encrypted credentials carry over. `TOKEN_ENCRYPTION_KEY` on Vercel must equal the value used when the credentials were saved.

| Project | Root directory | Notes |
| --- | --- | --- |
| `hrd-api` | `backend` | Next.js API, region `bom1`. Env: `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `APP_ORIGIN` (website URL), `EFM_ALLOWED_HOSTS`, `CRON_SECRET` (32+ chars), `DB_CA_CERT` and `DB_SSL_SERVERNAME` (VPS database certificate; without them every database request fails). |
| `hrd-web` | `frontend` | Static Vite build. `frontend/vercel.json` rewrites `/api/*` to `hrd-api`, so cookies stay first-party on the website origin. |

Both projects are connected to `LookAround-B/hrd`: every push to `master` builds and deploys automatically. `vercel.json` in each package runs `cd .. && npx --yes pnpm@11.7.0 install --frozen-lockfile` so the pnpm workspace (`backend`, `frontend`, `shared`) is installed from the repository root, then builds with the same pinned pnpm. Root Directory must stay `backend` / `frontend`, or the build fails with `NEXT_NO_VERSION`.

Scheduled sync: `GET /api/cron/sync` with `Authorization: Bearer $CRON_SECRET` runs `syncAll()` (maintenance + every active club). Hobby cron only allows daily runs, so `vercel.json` has a daily backstop and `.github/workflows/sync.yml` calls the endpoint every 5 minutes using the `HRD_CRON_SECRET` repository secret (same value as `CRON_SECRET`). On Vercel Pro, change the cron in `backend/vercel.json` to `*/5 * * * *` and disable the workflow. Run migrations from an operator machine with `pnpm db:migrate` before deploying schema changes.

Security headers: the website sends a strict Content-Security-Policy (scripts only from this site and Google sign-in), HSTS, `Permissions-Policy`, `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (needed by the Google sign-in pop-up); see `frontend/vercel.json`. The API sends `default-src 'none'` and HSTS (`backend/next.config.mjs`). When adding a third-party script, font or frame, extend the CSP or the browser blocks it. Every API request is validated against the strict schemas in `shared/schemas.ts`; the website runs the same schemas before sending.

Add the website URL as an Authorised JavaScript origin on the Google OAuth client so admin sign-in works.

## Operations and retention

`pnpm sync` runs one scheduling pass. Per-club PostgreSQL advisory locks serialize manual/scheduled sync with activation, token replacement and disconnect. Check **API Routes** for last check/status/latency, **Sync history** on each club for the latest ten runs and their dataset results, and **Activity log** for logins, key changes and club actions. Authentication failures are recorded as failed syncs even before dataset import begins. Failed validation and replacement credentials mark cached records stale until a fresh reconciliation succeeds. Backend logs deliberately omit request bodies, database error details and EFM payloads.

Disconnect deletes the stored credential immediately. Maintenance in the scheduled job purges disconnected-club personal data after 30 days, sync diagnostics after 30 days, audit events after 90 days, and expired sessions/rate-limit counters. Current connected-club records remain until replaced or disconnected. Backups may retain older records according to your separately configured database backup policy; restrict backup access and align that policy with club approval.

Back up HRD's database and encryption key separately. For rollback, restore the previous HRD release; disable the HRD cron if needed. Routine HRD rollback leaves EFM unchanged.

## Integration brief coverage

| Brief requirement | Implemented flow |
| --- | --- |
| Admin-only authentication | Server-verified Google identity, email allow-list, expiring HttpOnly sessions, origin/CSRF checks, attempt limits, login/logout audit. The demo hard-coded OTP is not used. |
| Per-club onboarding | Club details, approval reference, issuer and collection time, declared scopes/rate limits, encrypted unique credential, automatic access test and integration route discovery. |
| Food | Monthly stock/additions/usage, dated consumption totals, grocery purchases and recorded usage, date range and club filters. |
| Employees | Contact, role, department and status table; **View** opens shift, supervisor, approval, source ID and horse assignments within that club. |
| Horses | Profile, care team, health, treatment, recorded feed plans, training profile, owner, stable and document references. |
| Clubs and Entity Map | Counts, credential state, last sync, per-club relationships, independent onboarding and scheduling. |
| API Routes | Club-specific discovered catalog or reviewed fallback, methods, access state, HTTP status, check time and latency. |
| Operation and recovery | Reconcile before activation, five-minute worker, atomic dataset replacement, retained cache on failure, per-club sync history, credential replacement and disconnect. |
| Confidentiality | No EFM credentials in dashboard responses, admin-only personal data, audit events and scheduled retention cleanup. |

EFM does not expose employee joining dates or dated training sessions in the reviewed source; these remain explicitly unavailable. Live acceptance requires the approved club credential, deployed EFM integration-key support when using a permanent key, and a comparison of imported records against EFM before activation. Local automated checks use synthetic EFM responses and do not establish live connectivity or club authorisation.
