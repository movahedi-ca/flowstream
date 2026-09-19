# server/

## The static demo needs no backend

The FlowStream demo lives entirely in `docs/` and works as plain static files —
open `docs/index.html` in a browser, or serve it with the zero-dependency server:

```sh
npm run dev        # serves docs/ at http://localhost:4173/
PORT=8080 npm run dev
```

No `npm install` required. Nothing is fetched from this API by the demo.

## Optional companion API

`server/api.js` is an **optional** Express companion for experimentation
(local curriculum serving, the "Ulysses pact" ledger sketch, roadmap extension
points). It is not required for anything.

1. Install express (one-time):

   ```sh
   npm i express
   ```

   (The repo intentionally has no `dependencies` by default so the demo stays
   zero-dep.)

2. Run it:

   ```sh
   npm run api    # http://localhost:3001/ by default, PORT env supported
   ```

## Endpoints

| Method | Path                  | Description                                               |
| ------ | --------------------- | --------------------------------------------------------- |
| GET    | /api/health           | `{ "ok": true }` liveness check                           |
| GET    | /api/curriculum       | `docs/data/curriculum.json` (404 if the file is missing)  |
| GET    | /api/glossary         | `docs/data/glossary.json` (404 if the file is missing)    |
| GET    | /api/ledger           | In-memory Ulysses-pact ledger entries                     |
| POST   | /api/ledger           | Append a ledger entry (JSON body, echoed back with an id) |
| GET    | /api/extension-points | Roadmap extension points with honest "not implemented" flags |

## Tests & smoke

```sh
npm test     # node:test suite; data tests skip gracefully if docs/data/*.json is missing
npm run smoke  # boots server/static.js on an ephemeral port and probes it
```
