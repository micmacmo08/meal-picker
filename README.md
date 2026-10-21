# Meal Picker (self-hosted rebuild)

The household meal planner from digitaldwarf.dev, rebuilt from the original
platform artifact (`~/workspace/ts-spaces/meal-picker`) as a plain, ownable
TypeScript service. It now includes both the API/data layer and a Vite +
React frontend.

## Architecture

```
Browser ──HTTPS──> Caddy (meals.digitaldwarf.dev)     [production, planned]
                     │ reverse_proxy
                     ▼
               Express app (this repo) ── localhost:3000
                     │ serves the Vite-built React app from public/
                     ▼
               SQLite file (Drizzle ORM, better-sqlite3)
```

- **Stack:** TypeScript, Node + Express REST API, SQLite via Drizzle ORM,
  Zod validation, Vite + React + React Query, Tailwind CSS 4, npm. `tsc`
  compiles `src/` to `dist/`; Vite builds `client/` into `public/` for
  Express to serve in production.
- **Data model** (ported 1:1 from the old app): `meals`, `ingredients`,
  `meal_ingredients` (quantity / nullable measurement / descriptor),
  `tags`, `meal_tags`, `meal_plans`. Ratings live on the meal as nullable
  integer **quarter units** (1–20 = 0.25–5 stars) per person:
  `mikes_rating`, `michelles_rating`.
- **Weighted pick:** a meal's weight is the average of its non-null ratings.
  A completely unrated meal weighs **10 quarter units — exactly a 2.5-star
  rating** — so it is drawn more often than a meal rated 1 star (weight 4),
  while well-rated favourites still dominate. Hidden meals are excluded,
  and when tags are supplied a meal must carry **all** of them.
- **Shopping list:** aggregated from plans that are not marked complete,
  grouped by ingredient + measurement; numeric quantities (including
  fractions like `1 1/2`) are summed, text quantities are appended.
- **Auth (isolated module, `src/auth.ts`):** the final v1 access model is a
  single shared household password (no per-user accounts; the per-person
  Mike/Michelle split lives in the rating columns, not in login). Password
  comes from the `MEAL_PICKER_PASSWORD` env var and login sets an httpOnly
  session cookie.
  - **Open — no password:** viewing meals, meal details, and tags, and
    using the randomizer (`GET`/`POST /api/pick`). The frontend's meal
    library uses these open meal/tag endpoints.
  - **Password required:** every mutating endpoint, plus viewing the
    calendar (`GET /api/plans`) and the shopping list
    (`GET /api/shopping`). The shopping list is derived entirely from plan
    data, so it follows the calendar rule. `GET /api/library` is also gated
    because that aggregate includes plans and shopping.
  - The gated read paths are one small list in `src/app.ts`
    (`LOGIN_REQUIRED_READ_PATHS`), so changing the shopping-list rule later
    is a one-line edit.
  - **If the env var is unset, auth is disabled** (local dev mode) and the
    server logs a loud warning.

### Three-tier frontend access model

The server rules above do not change, but the browser experience has three
tiers:

1. **Open:** meal browsing, meal details, tags, and the randomizer need no
   password.
2. **Guest demo:** when password auth is enabled and the visitor is logged
   out, Calendar and Shopping are still fully usable as a demo. Demo plans
   are stored only under the `meal-picker:guest-plans:v1` key in the
   current browser tab's `sessionStorage`; they are built from the open meal
   endpoints, aggregated locally with the same semantics as the server, and
   the frontend does **not** call `/api/plans` or `/api/shopping` in this
   mode. A persistent banner says “Demo mode — plans aren't saved,” notes
   that they live only in this tab, and offers **Log in**. A successful
   login discards the demo plans and loads the saved household data;
   logging out returns to a fresh, empty demo. Household plan data is never
   written into the guest store.
3. **Authenticated persistence:** after login, Calendar and Shopping use
   the password-gated server endpoints and changes are saved in SQLite.

This demo tier exists so the deployed app is fully demonstrable as a
portfolio piece without exposing or mutating the household's real calendar
or shopping list.

## Frontend

- **Picker:** open to everyone; optional tag filters use AND semantics and
  the result links through to the meal detail.
- **Meal library + detail:** open browsing, tag filters, recipe,
  ingredients (quantity / measurement / descriptor), tag assignment, and a
  household-batch servings note. Hidden meals appear only in **Manage
  hidden** mode, with unhide controls.
- **Ratings:** Mike's and Michelle's ratings are separate. They display
  read-only until the pencil control opens the editor. Each star is split
  into four clickable quarter sections with accurate partial fill; hovering
  previews the value with a live label, −/+ steppers move by 0.25, and a
  rating can be cleared back to “not rated.” Saving requires login.
- **Calendar + shopping:** month/week calendar, plan/complete/remove, and
  the aggregated shopping list have two modes. Logged-out visitors get the
  ephemeral guest demo described above (with the persistent demo banner);
  logged-in users get the saved, password-gated household data.
- **Changes:** meal/tag create-edit-delete, tag assignment, hide/unhide,
  ratings and plan changes prompt for the password when needed; after a
  successful login the pending action is retried. The header shows the
  logged-in state and offers logout.

## Run locally

```sh
npm install
cp .env.example .env        # optional; defaults work without it

# Seed the database (one-time; recreates the target DB). By default this
# uses the committed export at seed/seed-data.json, so it works from any
# fresh clone. (OLD_DB_PATH=/path/to/old/app.db npm run seed instead
# imports directly from an old artifact database, if one is at hand.)
npm run seed

npm run dev:all             # API on :3000 + Vite on http://localhost:5173
# Vite proxies /api to the API server. Separately, if wanted:
#   npm run dev:server        API only (tsx watch, http://localhost:3000)
#   npm run dev               Vite only (expects the API on :3000)

npm run build               # Vite client -> public/, TypeScript server -> dist/
npm start                   # production: Express serves public/ + API on :3000

npm run test:unit           # weighted-pick weight + guest aggregation/storage tests
npm run smoke               # end-to-end smoke test against a running server
```

Configuration is by environment variable (see `.env.example`):
`PORT` (default 3000), `DATABASE_PATH` (default `./data/meal-picker.db`),
`MEAL_PICKER_PASSWORD` (unset = auth disabled).

### Seed rules (deliberate, do not "fix")

- Meals, ingredients, meal_ingredients, tags and meal_tags are copied with
  IDs and timestamps preserved.
- **All ratings are forced to NULL in the seed**, whatever the old values
  were — the household cleared them to re-rate fresh.
- Meal plans are **not** copied: old planning data is stale history.
- Expected counts after seed: 13 meals, 72 ingredients, 129 meal_ingredients,
  9 tags, 33 meal_tags. The seed script verifies counts and fails loudly on
  any mismatch.

## API summary

| Endpoint | Notes |
|---|---|
| `GET /api/health` | `{ ok, auth_enabled }` |
| `GET /api/library` | **Login required.** Old `listLibrary` aggregate: tags, meals, plans, shopping |
| `GET /api/meals?tagIds=1,2&includeHidden=true` | Open. Tag filter = AND; hidden excluded unless asked |
| `GET /api/meals/:id` | |
| `POST /api/meals` / `PUT /api/meals/:id` | Full meal incl. ingredient lines + tagIds |
| `DELETE /api/meals/:id` | Cascades to ingredient lines, tags, plans |
| `POST /api/meals/:id/hidden` | Body `{ hidden: boolean }` |
| `PATCH /api/meals/:id/ratings` | Body `{ mikesRating?, michellesRating? }`, each 1–20 or `null` |
| `PUT /api/meals/:id/tags` | Body `{ tagIds: [...] }`, replaces assignment |
| `GET /api/tags` · `POST /api/tags` · `DELETE /api/tags/:id` | Create normalizes (lowercase, spaces → `-`) and is idempotent |
| `GET/POST /api/pick` | Open. Weighted random pick; POST body `{ tagIds: [...] }` |
| `GET /api/plans?from=YYYY-MM-DD&to=YYYY-MM-DD` | **Login required.** Inclusive date range |
| `POST /api/plans` | Login required. Upsert by date (one meal per date); re-planning clears completion |
| `PATCH /api/plans/:id/complete` | Login required. Body `{ complete: boolean }` |
| `DELETE /api/plans/:id` | Login required |
| `GET /api/shopping` | **Login required.** Aggregated from incomplete plans |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/status` | Shared-password auth module |

## Production shape (documented, not yet deployed)

- systemd unit on the droplet running `node dist/index.js` as an
  unprivileged user, with an `EnvironmentFile` for `MEAL_PICKER_PASSWORD`
  and `DATABASE_PATH=/var/lib/meal-picker/meal-picker.db` (data outside the
  repo, backed up with the droplet).
- Caddy on the droplet:

  ```
  meals.digitaldwarf.dev {
      reverse_proxy localhost:3000
  }
  ```

  (DNS A record for `meals` → droplet; Caddy obtains the certificate.)
- Deploying = `git pull` in the checkout, `npm ci && npm run build`,
  `systemctl restart meal-picker`. Migrations of the data file are just
  copying the SQLite file (stop the service first).

## Layout

```
src/
  index.ts        entry point (env, db open, listen)
  app.ts          Express app + all routes
  auth.ts         isolated shared-password module (removable)
  services.ts     domain logic ported from the old actions (pick, shopping, saveMeal…)
  db/schema.ts    Drizzle schema (ported 1:1)
  db/client.ts    SQLite open + DDL
client/
  index.html      Vite entry page
  vite.config.ts  React + Tailwind build; dev proxy /api -> localhost:3000
  src/
    main.tsx      React + React Query bootstrap
    App.tsx       picker, library, detail, ratings, calendar, shopping, tags
    api.ts        typed REST client + ApiError (401 drives the login prompt)
    guest.ts      tab-local guest plans + client shopping aggregation
    styles.css    Tailwind 4 + dark forge theme matching digitaldwarf.dev
scripts/
  seed.ts         builds the DB from seed/seed-data.json (or an old app.db via OLD_DB_PATH)
  smoke.mjs       end-to-end smoke test against a running server
  rating-weight.test.ts  unit check: unrated meals weigh 10 (2.5 stars)
  guest.test.ts   guest aggregation parity fixture + storage-operation tests
public/           generated by `npm run build:client` (gitignored)
```
