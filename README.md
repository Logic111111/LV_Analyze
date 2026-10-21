# Feeder Island

LV (415/240 V, Dyn11) unbalanced load-flow and planning studio for a transformer island — one or
several transformers, 4-wire feeders with a multi-grounded neutral, grid-tied PV, batteries and
EV charging. Everything electrical runs in the browser (or a Web Worker), so a calculation never
waits for a server.

## What it does

- **Load flow.** Backward–forward sweep per transformer subtree: transformer impedance and tap,
  4-wire spans (optional coupled 4×4 line model), earth electrodes, ZIP loads, smart inverters
  (volt-var, volt-watt, export limit) and SOC-scheduled batteries. Results include voltage
  unbalance, convergence diagnostics and "explain this number" traces.
- **Studies.**
  - 24 h profiles and loss breakdowns, charts and the single-line diagram (SVG, DXF).
  - Fault levels and fuse protection checks.
  - Transformer ageing and probabilistic (Monte Carlo) planning.
  - Scenarios compared side by side, and economics from user-entered costs only.
- **Advisors.** Load balance, tap, reconductoring, feeder split (single, and dual through an open
  point) and the fix-it ladder, each with Preview/Apply on a before/after diagram.
- **Hosting capacity.** PV and BESS, per location and simultaneously, three ways (see below).
- **Optimisers** with optimality certificates: exact or load-flow-optimal phase balancing,
  maximum and fair-share hosting, BESS sizing for losses, dual-feeder split and
  reconductoring — see "How the optimisers work".
- **Data and platform.**
  - Map editor, design wizard, smart-meter (AMI) import, field voltage readings, Velander demand.
  - Exports: Excel, CSV, GeoJSON and an **OpenDSS script**.
  - Comprehensive printable report; fleet dashboard.
  - Version history with undo/redo, teams with roles and an approval workflow, session
    revocation.
  - **AI Insights**: Claude runs the app's own engine as tools.
  - Offline **Field survey** on phones (installable PWA).
- Light and dark themes, phone layouts, keyboard access; English with draft Sinhala and Tamil.

## Architecture

- **`packages/engine/`** — the engine: pure, dependency-free ES modules (no npm imports, no DOM)
  that run unchanged in the browser, a Web Worker and Node. `index.js` lists the modules;
  `opt/` holds the optimisation toolkit and optimisers. `client/src/lib/loadflow.js` re-exports
  it all and is the import path for pages.
- **`client/`** — React (Vite) single-page app. Long calculations run in a Web Worker
  (`client/src/lib/engineTasks.js`, started with `useEngineTask()`), with progress and Cancel.
  A service worker makes it installable and usable offline.
- **`server/`** — Express API. It authenticates users, stores designs and their versions, runs
  the teams/approval workflow and the field-survey sync, and runs AI Insights (the Anthropic key
  stays on the server). It loads the same engine package for AI tools and field-survey merging.
- **MySQL** — users, sessions, designs (one JSON column per design), design versions,
  organisations, memberships, reviews and an audit log. `server/sql/schema.sql` is the base
  schema; numbered migrations in `server/sql/migrations/` run automatically at server start
  (tracked in `schema_migrations`, guarded by a database lock so two servers can't race).

## Run with Docker Compose (recommended)

Three containers: `db` (MySQL 8.4), `server` (the API, Node 22) and `client` (nginx serving the
production build and proxying `/api/*` to `server`, so the auth cookie stays same-origin).

```bash
cp .env.example .env
# edit .env: CLIENT_PORT, DB_ROOT_PASSWORD/DB_USER/DB_PASSWORD/DB_NAME, a long random
# JWT_SECRET, FRONTEND_ORIGIN (exactly how you browse to it, port included), and
# ANTHROPIC_API_KEY if you want AI Insights.
docker compose up -d --build
```

The app is at `http://localhost:<CLIENT_PORT>`. `db-data` is a named volume, so the database
survives `docker compose down` (only `docker compose down -v` wipes it). Both images are built
from the repository root, because they include `packages/engine`. After pulling changes:

```bash
docker compose build client && docker compose up -d client
docker compose build server && docker compose up -d server   # runs any new migrations on start
```

For a real deployment, put a TLS-terminating proxy in front of the `client` port, set
`COOKIE_SECURE=true` and an `https://` `FRONTEND_ORIGIN`, and replace every `change-me`. HTTPS is
also what lets browsers register the service worker (offline field mode); over plain HTTP the
app works online only.

## Manual setup (without Docker)

```bash
# 1. MySQL
mysql -u root -p -e "CREATE DATABASE feederisland CHARACTER SET utf8mb4;"
mysql -u root -p -e "CREATE USER 'feederisland'@'%' IDENTIFIED BY 'change-me'; GRANT ALL ON feederisland.* TO 'feederisland'@'%';"
mysql -u feederisland -p feederisland < server/sql/schema.sql   # migrations run when the server starts

# 2. Server (Node 22)
cd server && cp .env.example .env   # edit DB_*, JWT_SECRET, FRONTEND_ORIGIN, ANTHROPIC_*
npm install && npm start            # listens on PORT (default 4000)

# 3. Client
cd client && npm install
npm run dev        # http://localhost:5173, proxies /api to :4000
npm run build      # production build in client/dist/
```

Serve `client/dist/` and proxy `/api/*` on the same origin to the Express process (see
`client/nginx.conf` for the nginx version, including the cache headers the service worker
needs: `sw.js`, the manifest and `index.html` must not be cached; `/assets/` can be immutable).

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `CLIENT_PORT` | Compose | Host port for the web app. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_ROOT_PASSWORD` | server / Compose | MySQL connection (root password only for the Compose `db` container). |
| `JWT_SECRET` | server | Long random secret for session tokens. |
| `FRONTEND_ORIGIN` | server | Exact browser origin (CORS and cookies). |
| `COOKIE_SECURE` | server | `true` behind HTTPS. |
| `ANTHROPIC_API_KEY` | server | Enables AI Insights; never sent to the browser. |
| `ANTHROPIC_MODEL` | server | Claude model for AI Insights (default `claude-sonnet-4-6`). |

## Security notes

- **Sessions** are JWTs in an httpOnly cookie, each tied to a row in `sessions` (a random `jti`).
  A token is accepted only while its session exists, is unexpired and unrevoked: "Log out" and
  "Log out everywhere" revoke server-side. Tokens issued before that release are refused once.
- **Access control**: every route needs a session plus an ownership or organisation-role check
  (`server/src/access.js`). Others' designs answer 404, so ids leak nothing. Approved versions are
  locked, approvers can't approve their own submission, and every workflow step is in the audit
  log.
- **All SQL is parameterised**; request bodies are size-limited (600 kB) and validated; CORS is
  locked to `FRONTEND_ORIGIN`; rate limits apply globally, more tightly on auth and AI.
- **AI Insights** never writes anything: it runs engine tools on the design the browser sends (in
  worker threads with a time limit), at most 8 tool rounds within 120 s, and returns proposals
  that the user previews.
- **Field survey**: the phone keeps unsynced records in local storage, per user, and keeps them
  after sign-out (they are field work). Syncing needs edit rights and is conditional on the
  design version.
- Rate limiting is in memory: with several server instances, move it to a shared store.

## Tests, benchmarks and CI

```bash
cd client
npm test            # Vitest in plain Node: goldens, 1e-9 reference lock, every module and optimiser
npm run lint        # ESLint, including the engine's no-dependency rule
npm run typecheck   # JSDoc types on the engine (tsc, no emit)
npm run bench       # engine timings, 50-pole / 200-connection synthetic island
npm run bench:opt   # optimiser timings against their budgets, with the key figures
cd ../server && npm test   # node:test + supertest on an in-memory repository (no database)
```

- **Golden tests** pin the engine to the "Walkthrough Island" hand-calculation workbook, and the
  **reference lock** holds 29 cases to 1e-9 (`npm run gen:reference` rewrites it — only after a
  deliberate, documented change in results).
- **OpenDSS cross-check** (dev-only):
  `pip install opendssdirect.py && python scripts/validate-opendss.py` exports seven cases (simple,
  coupled, earthed, ZIP, with PV/BESS) and compares every voltage with OpenDSS. Agreement is
  0.2 mV.
- **CI** runs lint, typecheck, tests and the build for the client, and syntax checks plus tests
  for the server.

`PROGRESS.md` tracks every item of the upgrade programme and the optimisation upgrade, with
decisions, timings and verification logs.

## How the optimisers work

The legacy methods (greedy balance, first-come hosting queue, shortlist searches) stay the default
and give exactly the answers they always did. Each optimiser is an extra choice on its page and
reports how good its answer is:

- **Exact optimum** — the whole search space was covered, or the method is a proof.
- **Within x % of bound** — the answer passed full load flows, and a linear model says nothing can
  be more than x % better.
- **Best found (x/N restarts agree)** — a seeded random search (same seed, same answer). Agreement
  between independent restarts is evidence, not proof.

Every answer shown as feasible has passed full load flows (converged) at every checked hour and
year. Costs are used only when you have entered them; otherwise the optimiser falls back to a
cost-free objective and says so.

**Phase balancing, exact (dynamic programming).** Balancing per-phase totals looks like it needs
all 3ⁿ arrangements, but the only thing that matters is the running totals. The DP adds one
connection at a time and remembers, for every reachable pair (total on A, total on B), the fewest
moves that reach it. At the end it knows the smallest possible spread for every move budget at
once — on the Walkthrough Island 22.5, 15, 7, 4, 1.5, 1.5, 0.5 … kVA for 0, 1, 2 … moves, from
about 5 000 states in a few milliseconds.

**Phase balancing on the real goal.** Nameplate balance isn't the goal: violations and losses are,
and they depend on where a customer is and when they draw power. This optimiser scores every
arrangement with full 24 h load flows (several years if asked): fewest voltage violations, then
thermal, then daily loss, then fewest moves. Identical customers are interchangeable, so "house 7
on B, house 8 on A" and the swap are one arrangement. Small move budgets are enumerated
completely (20, 174 and 874 distinct arrangements for 1–3 moves on the fixture). Beyond that,
simulated annealing with a tabu list and seeded restarts takes over. On the fixture one move —
the 7 kVA EV at the far pole from A to B — clears every violation that the greedy needs nine
moves for.

**Maximum simultaneous hosting (successive linear programming).** A first-come queue locks in each
approval and assumes headroom only gets used up. On a 4-wire network that's false: PV on phase A
raises A but lowers B and C through the shared neutral, so a pole hosting on all three phases takes
far more in total. The optimiser works like this:
1. Linearise every voltage, span loading and transformer loading around the current allocation.
   The derivatives are worked out exactly from the sweep, including the neutral, and checked
   against finite differences.
2. Solve a linear programme for the largest total that stays inside the limits, within a trust
   region.
3. Verify the step with full load flows. On a failure, shrink the step and tighten the rows that
   failed.
The LP solver is written into the engine (a bounded-variable simplex with Bland's anti-cycling
rule). The last LP gives the bound. On the fixture the maximum is 149.5 kVA, against the queue's
111.7. The page also shows the **fair share**: the largest equal size every location can add at
once.

**BESS for losses.** More battery isn't less loss. This minimises the daily loss over battery
sizes:
- the gradient comes from finite differences on the 24 h scan;
- each projected step is verified, and the step shrinks until it passes;
- several seeded starts are run.
No battery is always a valid start, so the answer is never worse than none.

**Dual-feeder split.** All cut-point pairs are scored when there are at most 400. Above that, the
legacy shortlist is followed by local improvement (each cut one pole up or down) and a random
sample, and the coverage is reported.

**Reconductoring.** A conductor for every span:
- enumeration when the combinations are few;
- otherwise branch-and-bound from the transformer outward, pruning any branch that can't win even
  with every remaining span at the best conductor;
- annealing if the evaluation budget runs out.

**Transformer reverse flow.** Transformer heating doesn't depend on the direction of flow.
Setup → Standards can apply the transformer limit to export too (off by default, which is the
historical rule). Either way, the app warns when reverse flow exceeds the rating.

## Offline field mode

Open **Field survey** on a phone while online and download a saved design. From then on it works
without a network:
- pick a pole;
- for each connection, record the observed phase (A/B/C), meter ID, a note and a photo reference.

Records sync by themselves when the network returns. The server applies those whose connection
hasn't changed since the downloaded version, as a new design version. Any that changed come back
as conflicts, which the surveyor sends anyway or drops. The app is installable from the browser
menu.

## Extending

- Engine code goes in `packages/engine/` as a pure module, with JSDoc types and why-comments.
  Export it from `index.js`. A long calculation gets a task in `client/src/lib/engineTasks.js`.
- Every way a design enters the app passes through `withDefaults(design)`. A new field gets its
  default there, off by default, so older designs load with identical results.
- New server routes need `requireAuth`, an ownership or role check, parameterised SQL and a
  supertest case. Schema changes are a new numbered file in `server/sql/migrations/`.
