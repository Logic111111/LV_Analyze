# Feeder Island

LV (415/240V) unbalanced load-flow studio for a transformer island (one or several
transformers) — three-phase backward-forward sweep with transformer impedance, reverse power
flow from grid-tied PV, solar and BESS hosting-capacity search, a 24-hour combined profile
(including per-transformer LV bus voltage and a daily energy-loss breakdown), and a network
diagram. BESS connections model a fixed charge/discharge schedule (grid-charge over a
configurable daytime window, discharge over the evening peak) with no state-of-charge tracking.
The UI supports a light and a dark theme, toggled from the top bar.

**Architecture** (kept intentionally simple):

- **`client/`** — React (Vite) single-page app. All the electrical engineering — the load-flow
  solver, solar/BESS hosting-capacity search, 24h scan, energy-loss accounting, and SVG diagram
  builder — runs in the browser as plain JS modules (`client/src/lib/loadflow.js`, `diagram.js`).
  No server round-trip needed to run a calculation.
- **`server/`** — Express (JS) REST API. Its only jobs are: authenticate users, and store/retrieve
  each user's designs in MySQL. It also proxies the optional "AI Insights" feature so the
  Anthropic API key never reaches the browser.
- **MySQL** — two tables (`users`, `designs`). A design's entire network/curves/settings are
  stored as one JSON column — simple schema, no ORM needed.

Auth is a signed JWT in an httpOnly cookie (not readable by JS, sent automatically by the
browser). Passwords are hashed with bcrypt. All DB queries are parameterized (no string-built
SQL). See "Security notes" below for the trade-offs made to keep this simple.

## Run with Docker Compose (recommended)

The repo ships a complete three-container stack — `db` (MySQL, schema applied automatically on
first start from `server/sql/schema.sql`), `server` (the Express API), and `client` (an nginx
container serving the production build, reverse-proxying `/api/*` to `server` on the internal
Docker network so the auth cookie stays same-origin). This is the path to reach for by default;
the manual setup below is only for when you specifically don't want Docker.

```bash
cp .env.example .env
# edit .env: CLIENT_PORT, DB_ROOT_PASSWORD/DB_USER/DB_PASSWORD/DB_NAME, a long random
# JWT_SECRET, FRONTEND_ORIGIN (must match how you'll browse to it, port included), and
# ANTHROPIC_API_KEY if you want the AI Insights feature enabled.
docker compose up -d --build
```

The app is then at `http://localhost:<CLIENT_PORT>`. `db-data` is a named volume, so the
database survives `docker compose down` (only `docker compose down -v` wipes it). After pulling
in code changes, rebuild and recreate just the affected service(s), e.g.:

```bash
docker compose build client && docker compose up -d client
docker compose build server && docker compose up -d server
```

For a real (non-LAN) deployment, put a TLS-terminating reverse proxy or load balancer in front
of the `client` container's published port, set `COOKIE_SECURE=true` and `FRONTEND_ORIGIN` to
your `https://` URL in `.env`, and replace every `change-me` placeholder with a real random
value — see "Security notes" below.

## Manual setup (without Docker)

### 1. Set up MySQL

```bash
mysql -u root -p -e "CREATE DATABASE feederisland CHARACTER SET utf8mb4;"
mysql -u root -p -e "CREATE USER 'feederisland'@'%' IDENTIFIED BY 'change-me'; GRANT ALL ON feederisland.* TO 'feederisland'@'%';"
mysql -u feederisland -p feederisland < server/sql/schema.sql
```

### 2. Configure and run the server

```bash
cd server
cp .env.example .env
# edit .env: DB_* credentials, a long random JWT_SECRET, FRONTEND_ORIGIN, and
# ANTHROPIC_API_KEY if you want the AI Insights feature enabled.
npm install
npm start          # listens on PORT (default 4000)
```

### 3. Run the client

Development (hot reload, proxies `/api` to the server on :4000):

```bash
cd client
npm install
npm run dev         # http://localhost:5173
```

Production build (static files you deploy behind any web server / CDN):

```bash
cd client
npm install
npm run build        # outputs to client/dist/
```

Serve `client/dist/` from your web server (Nginx, Caddy, S3+CloudFront, Netlify, etc.) and
proxy `/api/*` on the same origin to the Express process — this keeps the auth cookie
same-origin (`SameSite=Lax`) without extra CORS/cookie configuration. Example Nginx snippet:

```nginx
server {
  listen 443 ssl;
  server_name feederisland.example.com;
  root /var/www/feederisland/client/dist;
  location / { try_files $uri /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; }
}
```

Put the whole thing behind HTTPS in production and set `COOKIE_SECURE=true` in `server/.env`
so the auth cookie gets the `Secure` flag.

## Security notes (trade-offs made to keep this "simple but secure")

- **JWT-in-cookie sessions, 7-day expiry, no server-side revocation list.** Logout clears the
  browser's cookie but the token itself remains technically valid until it expires (stateless
  JWTs can't be revoked without an extra store). If you need real server-side logout/revocation,
  add a `session_id` column checked against a DB/Redis blacklist — that's the one place this
  design intentionally traded a little rigor for simplicity.
- **Rate limiting** is in-memory (`express-rate-limit` defaults), fine for a single server
  instance; if you scale to multiple instances behind a load balancer, move it to a shared store
  (e.g. Redis) or it under-counts.
- **Anthropic API key lives only in the server's environment** (`ANTHROPIC_API_KEY` in
  `server/.env`, or in the root `.env` when running via Docker Compose), never sent to the
  client — the browser calls your own `/api/ai/insights`, which calls Anthropic server-side.
- **All SQL is parameterized** via `mysql2`'s `?` placeholders — no string concatenation, so no
  SQL injection surface.
- **CORS is locked to `FRONTEND_ORIGIN`** with credentials enabled; there's no wildcard origin.
- Design payload size is capped (both by `express.json({limit})` and an explicit JSON-length
  check) to stop a malicious or buggy client from writing huge rows.

## Tests and CI

The load-flow engine has a golden-value test suite (Vitest, running in plain Node — no browser):

```bash
cd client
npm test        # golden tests + full-precision reference lock
npm run lint    # ESLint (also enforces that the engine stays dependency-free)
npm run typecheck  # JSDoc types on the engine (tsc, no emit)
npm run bench   # engine timings on a synthetic 50-pole / 200-connection island
```

- **Golden tests** (`client/src/lib/__tests__/golden.*.test.js`) pin the engine to the
  "Walkthrough Island" hand-calculation workbook: pole voltages and currents, losses, violations,
  24-hour scans, tap sweeps, feeder split, load balance and PV/BESS hosting capacity.
- **Reference lock** (`reference.test.js`) asserts the engine's raw output for 29 cases to 1e-9,
  so even sub-display-precision drift from a refactor is caught. `npm run gen:reference` rewrites
  it — only after a deliberate, documented change in results, never to make a failing test pass.
- **CI** (`.github/workflows/ci.yml`) runs lint, tests and the client build, plus a
  `node --check` syntax pass over the server, on every push and pull request.

`PROGRESS.md` at the repo root tracks the upgrade programme item by item.

## Extending

- The engine lives in `client/src/lib/engine/` — one pure, dependency-free ES module per concern
  (complex maths, data model, loads, solver, scans, hosting, BESS, and the feeder-split and
  load-balance advisors; see `engine/index.js` for the map), with JSDoc types checked by
  `npm run typecheck`. `client/src/lib/loadflow.js` re-exports all of it and stays the import path
  for pages. `diagram.js` and `report.js` are dependency-free too. All of it runs outside React
  with no mocking (the test suite above does exactly that).
- Every way a design enters the app (server load, JSON import, new design) passes through
  `withDefaults(design)` in `loadflow.js`. A new design field gets its default there, so older
  saved designs keep loading with identical results.
- Each React page under `client/src/pages/` mirrors one tab of the original single-file
  prototype, so behaviour should already be familiar.
