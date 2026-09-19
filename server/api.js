// OPTIONAL companion API. The static demo in docs/ never calls this.
// Requires express: run `npm i express` then `npm run api`.
// The repo is intentionally dependency-free by default; this file guards
// the import with a friendly error so nothing breaks without express.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = join(REPO_ROOT, "docs", "data");

let express;
try {
  ({ default: express } = await import("express"));
} catch {
  console.error(
    "Optional API needs express: run `npm i express` then `npm run api`."
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "256kb" }));

async function readJson(name, res) {
  try {
    const raw = await readFile(join(DATA_DIR, name), "utf8");
    res.json(JSON.parse(raw));
  } catch (err) {
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: `${name} not found` });
    } else {
      res.status(500).json({ error: `failed to read ${name}` });
    }
  }
}

// -- Health ---------------------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// -- Curriculum & glossary (served from the static data files) --------------
app.get("/api/curriculum", (_req, res) => readJson("curriculum.json", res));
app.get("/api/glossary", (_req, res) => readJson("glossary.json", res));

// -- Ulysses-pact ledger (in-memory echo; demo concept only) ---------------
const ledger = [];
app.get("/api/ledger", (_req, res) => res.json(ledger));
app.post("/api/ledger", (req, res) => {
  const entry = { id: ledger.length + 1, at: new Date().toISOString(), ...req.body };
  ledger.push(entry);
  res.status(201).json(entry);
});

// -- Roadmap extension points (honest "not implemented" flags) -------------
app.get("/api/extension-points", (_req, res) =>
  res.json({
    extensionPoints: [
      {
        id: "crypto-fiat-wallet",
        name: "Crypto/fiat wallet",
        description:
          "Let learners stake or pay with crypto/fiat as part of commitment pacts.",
        implemented: false,
        status: "roadmap",
      },
      {
        id: "wearable-biofeedback",
        name: "Wearable biofeedback",
        description:
          "Use heart-rate / focus signals from wearables to adapt pacing and breaks.",
        implemented: false,
        status: "roadmap",
      },
    ],
  })
);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`FlowStream optional API listening at http://localhost:${port}/`);
  console.log("(Optional companion — the static demo in docs/ never calls it.)");
});
