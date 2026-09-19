// Zero-dependency static file server for the FlowStream demo.
// Serves ~/workspace/flowstream/docs/ (the static-first demo needs no backend).
// Usage: npm run dev   (or: PORT=8080 node server/static.js)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS_ROOT = join(REPO_ROOT, "docs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

async function serveFile(res, filePath, method) {
  const ext = extname(filePath).toLowerCase();
  const body = await readFile(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  if (method === "HEAD") res.end();
  else res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Method Not Allowed");
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    // Prevent directory traversal: normalize and strip leading ../
    pathname = normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
    let filePath = join(DOCS_ROOT, pathname);

    // Never escape the docs root.
    if (!filePath.startsWith(DOCS_ROOT)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Forbidden");
    }

    let st = null;
    try {
      st = await stat(filePath);
    } catch {
      st = null;
    }
    if (st?.isDirectory()) filePath = join(filePath, "index.html");

    let exists = false;
    try {
      exists = (await stat(filePath)).isFile();
    } catch {
      exists = false;
    }

    // SPA fallback: unknown paths serve index.html (if it exists).
    if (!exists) {
      const indexPath = join(DOCS_ROOT, "index.html");
      try {
        if ((await stat(indexPath)).isFile()) {
          return serveFile(res, indexPath, req.method);
        }
      } catch {
        // fall through to 404
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }

    await serveFile(res, filePath, req.method);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 4173;
server.listen(port, () => {
  const actual = server.address()?.port ?? port;
  console.log(`FlowStream static server listening at http://localhost:${actual}/`);
  console.log(`Serving: ${DOCS_ROOT}`);
});
