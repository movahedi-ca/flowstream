// Smoke test: boots server/static.js on an ephemeral port, probes key routes,
// asserts 200 + content-type, then shuts the server down.
// Exits non-zero on any failure. Robust: waits for the port, 15s global timeout.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const TIMEOUT_MS = 15_000;

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL: ${msg}`);
};
const ok = (msg) => console.log(`ok: ${msg}`);

const controller = new AbortController();
const globalTimer = setTimeout(() => {
  controller.abort();
  fail(`global timeout of ${TIMEOUT_MS}ms exceeded`);
  process.exit(1);
}, TIMEOUT_MS);

let child = null;
let port = null;

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [join(REPO_ROOT, "server", "static.js")], {
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onError = (err) => reject(err);
    child.on("error", onError);
    let out = "";
    const onData = (chunk) => {
      out += chunk.toString();
      const m = out.match(/http:\/\/localhost:(\d+)\//);
      if (m) {
        cleanup();
        resolve(Number(m[1]));
      }
    };
    const cleanup = () => {
      child.off("error", onError);
      child.stdout.off("data", onData);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (c) => process.stderr.write(`[server] ${c}`));
    child.on("exit", (code) => {
      if (!port) reject(new Error(`server exited early with code ${code}; output: ${out}`));
    });
  });
}

async function fetchOk(path, expectedContentType) {
  const url = `http://127.0.0.1:${port}${path}`;
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    fail(`GET ${path}: request failed (${err.message})`);
    return;
  }
  if (res.status !== 200) {
    fail(`GET ${path}: expected 200, got ${res.status}`);
    return;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.startsWith(expectedContentType)) {
    fail(`GET ${path}: expected content-type starting with "${expectedContentType}", got "${ct}"`);
    return;
  }
  // Drain the body so sockets don't linger.
  await res.arrayBuffer().catch(() => {});
  ok(`GET ${path} -> 200 ${ct}`);
}

try {
  port = await startServer();
  ok(`server started on port ${port}`);

  // Small grace delay in case the listener isn't accepting yet.
  await delay(250);

  await fetchOk("/", "text/html");
  await fetchOk("/app.js", "text/javascript");
  await fetchOk("/styles.css", "text/css");
  await fetchOk("/data/curriculum.json", "application/json");
} catch (err) {
  fail(`smoke setup failed: ${err.message}`);
} finally {
  clearTimeout(globalTimer);
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await delay(500);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nSmoke test passed.");
