import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { entryDir, galleryRoot, runDir, safeJoin } from "./paths.mjs";
import { listRuns, loadRun, readLog, recoverRun, updateEntry } from "./state.mjs";
import { openLocalUrl } from "./open.mjs";
import { writeJson } from "./json.mjs";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

export async function startGalleryServer({
  dataDir,
  runId = null,
  port = 0,
  host = "127.0.0.1",
  autoOpen = false,
  open = openLocalUrl,
  pollMs = 500
}) {
  const clients = new Map();
  const server = http.createServer((request, response) => route({ request, response, dataDir, runId, clients }));
  try {
    await listen(server, port, host);
  } catch (error) {
    if (error.code !== "EADDRINUSE" || port === 0) throw error;
    await listen(server, 0, host);
  }
  const address = server.address();
  const baseUrl = `http://${host}:${address.port}`;
  if (runId) {
    await writeJson(path.join(runDir(dataDir, runId), "gallery.json"), {
      url: `${baseUrl}/?run=${encodeURIComponent(runId)}`,
      pid: process.pid,
      startedAt: new Date().toISOString()
    });
  }
  const signatures = new Map();
  let opened = false;
  let ticking = false;
  const interval = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const [watchedRunId, watchers] of clients) {
        if (!watchers.size) continue;
        const run = await recoverRun(dataDir, watchedRunId).catch(() => loadRun(dataDir, watchedRunId)).catch(() => null);
        const signature = JSON.stringify(run);
        if (signature !== signatures.get(watchedRunId)) {
          signatures.set(watchedRunId, signature);
          for (const watcher of watchers) watcher.write(`event: run\ndata: ${signature}\n\n`);
        }
      }
      if (autoOpen && runId && !opened) {
        const run = await recoverRun(dataDir, runId).catch(() => loadRun(dataDir, runId)).catch(() => null);
        const hasReady = run?.entries.some((entry) => entry.status === "ready");
        const allSettled = run?.entries.every((entry) => ["ready", "failed", "cancelled"].includes(entry.status));
        if (run && (hasReady || allSettled)) {
          opened = true;
          open(`${baseUrl}/?run=${encodeURIComponent(runId)}`);
        }
      }
    } finally {
      ticking = false;
    }
  }, pollMs);
  interval.unref?.();
  const close = async () => {
    clearInterval(interval);
    for (const watchers of clients.values()) {
      for (const watcher of watchers) watcher.end();
    }
    await new Promise((resolve) => server.close(resolve));
  };
  return { server, close, baseUrl, url: runId ? `${baseUrl}/?run=${encodeURIComponent(runId)}` : baseUrl };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function route({ request, response, dataDir, runId, clients }) {
  const url = new URL(request.url, "http://localhost");
  try {
    if (request.method === "GET" && url.pathname === "/api/runs") {
      return json(response, 200, await listRuns(dataDir));
    }
    let match = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      const run = await loadRun(dataDir, decodeURIComponent(match[1]));
      return run ? json(response, 200, run) : json(response, 404, { error: "Run not found" });
    }
    match = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      return streamEvents(response, clients, decodeURIComponent(match[1]));
    }
    match = /^\/api\/runs\/([^/]+)\/entries\/([^/]+)\/favorite$/.exec(url.pathname);
    if (request.method === "POST" && match) {
      const body = await readBody(request);
      const entry = await updateEntry(dataDir, decodeURIComponent(match[1]), decodeURIComponent(match[2]), { favorite: Boolean(body.favorite) });
      return json(response, 200, entry);
    }
    match = /^\/api\/runs\/([^/]+)\/entries\/([^/]+)\/log$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      return text(response, 200, await readLog(dataDir, decodeURIComponent(match[1]), decodeURIComponent(match[2])));
    }
    match = /^\/runs\/([^/]+)\/entries\/([^/]+)\/site\/(.*)$/.exec(url.pathname);
    if (request.method === "GET" && match) {
      const root = path.join(entryDir(dataDir, decodeURIComponent(match[1]), decodeURIComponent(match[2])), "site");
      return file(response, safeJoin(root, decodeURIComponent(match[3] || "index.html")));
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return file(response, path.join(galleryRoot, "index.html"));
    }
    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      return file(response, safeJoin(galleryRoot, url.pathname.slice("/assets/".length)));
    }
    if (request.method === "GET" && url.pathname === "/api/default-run") {
      return json(response, 200, { runId });
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, /^Invalid (run id|entry id)/.test(error.message) ? 400 : 500, { error: error.message });
  }
}

function streamEvents(response, clients, runId) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  response.write("event: connected\ndata: {}\n\n");
  if (!clients.has(runId)) clients.set(runId, new Set());
  clients.get(runId).add(response);
  response.on("close", () => clients.get(runId)?.delete(response));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function file(response, candidate) {
  if (!candidate) return json(response, 403, { error: "Forbidden" });
  const info = await stat(candidate).catch(() => null);
  if (!info?.isFile()) return json(response, 404, { error: "File not found" });
  response.writeHead(200, {
    "Content-Type": TYPES[path.extname(candidate).toLowerCase()] || "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": path.extname(candidate) === ".html" ? "no-cache" : "public, max-age=60"
  });
  createReadStream(candidate).pipe(response);
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function text(response, status, value) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(value);
}
