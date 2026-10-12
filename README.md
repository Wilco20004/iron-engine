# Iron + Engine

A self-hosted training app for the household. Each person signs in to their own
profile and gets their own program and log.

- Programs with weekly progression (sets, reps, reps in reserve, recovery weeks)
- Every session runs weights first, then cardio
- Tap an exercise for start and finish photos, how-to steps and a per-set
  kg / reps / fail logger with a rest timer
- Cardio interval timer with beeps, plus minutes, distance, heart rate and effort logging
- "End session early" with a reason and note
- Installs on a phone home screen (web app manifest + service worker)

Runs two ways from the same codebase:

- **Standalone**, via Docker/docker-compose, anywhere Docker runs.
- **As a Home Assistant add-on**, added from this repo as a custom add-on repository.

## Running standalone (Docker)

```bash
docker compose up -d --build
```

Open `http://<host>:8080`. The first visit asks you to add the first person.
Data (one SQLite file) lives in `./data`, which is bind-mounted so it survives
rebuilds. Back up that folder.

For use at the gym, put it behind HTTPS (a reverse proxy such as Caddy,
Nginx Proxy Manager or Traefik on your domain). HTTPS is needed for
"Add to Home Screen" and for keeping the screen awake during the cardio timer.

## Running as a Home Assistant add-on

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add
   `https://github.com/wilco20004/iron-engine`.
2. Install **Iron + Engine** and start it. It appears in the sidebar as
   **Training** (via Ingress).

Reaching it away from home uses your normal Home Assistant remote access.

## Programs and blocks

Programs in `server/programs/*.json` are **templates**. On start-up they're
loaded into the database (a template edited through the connector keeps its
edits and stops following the file).

A **block** is one run through a plan, usually 4 weeks. Each block keeps its own
copy of the plan, so changing the plan never rewrites history. Start the next
block from Settings → Training blocks (or through the connector); the first
weeks of a new block show the previous block's numbers to beat.

Log entries are keyed `<week>-<day>-<exercise slug>` (plus `-cardio` and
`-end`), so reordering exercises is safe and swapping one starts a new history
line for the new name.

`exercises.json` is the shared exercise library (how-to text, muscles, load
type, optional caution). Photos live in `web/public/exercises/<photo>-0.jpg`
(start) and `-1.jpg` (finish). Exercises added through the connector are stored
in the database and have no photos.

| Template | For |
|---|---|
| `iron-engine-upper-lower` | 4 days, upper/lower split, muscle gain |
| `foundations-2day` | 2 full-body days, beginner, shoulder-friendly, core rebuild after pregnancy, fat loss |

## Claude connector (MCP)

The server includes a remote [MCP](https://modelcontextprotocol.io) endpoint so
Claude can read logs and change plans without code changes or redeploys.

1. Open the app → your name → **Claude connector** → **Show connector link**.
   It looks like `https://your-domain/mcp/<secret>`.
2. In Claude: **Settings → Connectors → Add custom connector**, paste the link.

Anyone with the link can read and change everyone's training: keep it private,
and use **Make a new link** if it leaks. Claude reaches the server over the
internet, so it must be served over HTTPS on a public address. Home Assistant
Ingress isn't enough; expose port 8080 through your reverse proxy.

Tools: `list_people`, `get_plan`, `update_plan`, `get_log`, `get_progress`,
`start_new_block`, `list_program_templates`, `get_program_template`,
`save_program_template`, `get_exercise_library`, `upsert_exercise`,
`update_person` (age, coaching notes, next block's template).

The endpoint also accepts the secret as `Authorization: Bearer <secret>` on
`POST /mcp`.

## Development

```bash
npm install
npm run dev:server   # API on :8080
npm run dev:web      # Vite dev server, proxies /api to :8080
```

## API

All under `/api`. Sign-in uses a session cookie; PINs are optional and stored
as scrypt hashes.

| Method | Path | Purpose |
|---|---|---|
| GET | `/profiles` | Names for the sign-in screen |
| POST | `/profiles` | Add a person (the first is open; after that sign-in is required) |
| POST | `/login`, `/logout` | Sign in / out |
| GET, PATCH | `/me` | Current person; change age, PIN or coaching notes |
| GET | `/program` | Current block's plan, exercise library, block list, previous block's log |
| POST | `/blocks` | Start the next block `{ programId? }` |
| GET | `/blocks/:number` | An earlier block's plan and log |
| GET | `/log` | Current block's log as `{ key: entry }` |
| PUT, DELETE | `/log/:key` | Save or remove one entry |
| POST | `/log/import` | Bulk import into the current block `{ entries: { key: entry } }` (old position keys like `0-0-3` are converted) |
| GET, POST | `/connector`, `/connector/regenerate` | Show or replace the connector link |

Exercise photos: [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (public domain).
