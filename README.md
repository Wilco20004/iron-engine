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

## Programs

Programs are JSON files in `server/programs/`. Each person picks one in
settings. `exercises.json` is the shared exercise library (how-to text,
muscles, load type and an optional caution note). Photos live in
`web/public/exercises/<photo>-0.jpg` (start) and `-1.jpg` (finish).

To add a program, copy an existing file, give it a new `id`, and restart.

| Program | For |
|---|---|
| `iron-engine-upper-lower` | 4 days, upper/lower split, muscle gain |
| `foundations-2day` | 2 full-body days, beginner, shoulder-friendly, core rebuild after pregnancy, fat loss |

Log entries are keyed `<week>-<day>-<item>` (week and day are indexes into the
program; item is the exercise index, the cardio index, or `end`), so editing a
program's exercise order changes which logged entries line up with which exercise.

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
| GET, PATCH | `/me` | Current person; change age, PIN or program |
| GET | `/program` | Current person's program and the exercise library |
| GET | `/log` | Current person's log as `{ key: entry }` |
| PUT, DELETE | `/log/:key` | Save or remove one entry |
| POST | `/log/import` | Bulk import `{ entries: { key: entry } }` |

Exercise photos: [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (public domain).
