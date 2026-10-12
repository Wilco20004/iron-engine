# Iron + Engine

Self-hosted household training app: Express + SQLite server (`server/`), a
plain-JS Vite web app (`web/`), and a remote MCP connector in the same server.
Ships as a Docker image and a Home Assistant add-on (`config.yaml`).

## Layout

- `server/src/plan.ts`: zod `PlanSchema` (the shape of every plan), `slug()`, log-key helpers
- `server/src/store.ts`: templates, blocks, log entries, exercise library, progress, connector token
- `server/src/db.ts`: schema and the version-1 → blocks migration (table rename)
- `server/src/routes.ts`: the app's REST API (`/api`)
- `server/src/mcp.ts`: MCP tools at `/mcp/<token>` (stateless streamable HTTP)
- `server/programs/*.json`: program templates; `exercises.json`: shared library
- `web/src/main.js`: the whole UI (ported from a single-page prototype; keep its style)
- `web/public/exercises/`: photos, `<photo>-0.jpg` start and `-1.jpg` finish

## Rules that are easy to break

- Log keys are `<week>-<day>-<slug(exercise name)>`, `-cardio`, `-end`. `slug()` exists in
  both `server/src/plan.ts` and `web/src/main.js` and must stay identical.
- A block stores its own copy of the plan. Never edit an ended block's plan.
- Template files are re-seeded on start-up only while not customized through the connector.
- Barbell weights are logged as the total on the bar (bar included); dumbbells per dumbbell.
- `mcp.ts` registers tools through a loosely typed wrapper on purpose: the SDK's generic
  `registerTool` makes `tsc` take minutes.
- Personal and health details belong in each person's coaching notes (database), not in this repo.

## Checks

```bash
npm install
npm run build          # web (vite) + server (tsc)
IRON_DATA_DIR=/tmp/ie PORT=8090 node server/dist/index.js
```

There's no test suite yet; exercise changes in a browser at phone width (about 400px)
and, for connector changes, with an MCP client against `/mcp/<token>`.
