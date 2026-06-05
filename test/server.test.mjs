import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { createRun, updateEntry } from "../src/state.mjs";
import { runEntries } from "../src/runner.mjs";
import { startGalleryServer } from "../src/server.mjs";
import { sampleSkills, temporaryDirectory } from "./helpers.mjs";

test("gallery serves entries, persists favorites, lists history, and auto-opens once", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "A live gallery", host: "codex", skills: sampleSkills.slice(0, 2) });
  const opened = [];
  const gallery = await startGalleryServer({
    dataDir: temporary.dir,
    runId: run.id,
    autoOpen: true,
    open: (url) => opened.push(url),
    pollMs: 10
  });
  t.after(gallery.close);
  await runEntries({ dataDir: temporary.dir, runId: run.id, executor: "mock", concurrency: 2, mockDelays: [25, 80] });
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(opened.length, 1);
  const galleryPage = await fetch(`${gallery.baseUrl}/`);
  const galleryHtml = await galleryPage.text();
  assert.equal(galleryHtml.match(/sandbox="allow-scripts allow-forms allow-modals"/g)?.length, 2);
  assert.doesNotMatch(galleryHtml, /allow-same-origin/);
  const galleryScript = await (await fetch(`${gallery.baseUrl}/assets/app.js`)).text();
  assert.match(galleryScript, /sandbox="allow-scripts allow-forms allow-modals"/);
  assert.doesNotMatch(galleryScript, /allow-same-origin/);
  const page = await fetch(`${gallery.baseUrl}/runs/${run.id}/entries/${run.entries[0].id}/site/index.html`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("access-control-allow-origin"), "null");
  assert.match(await page.text(), /Standalone mock entry/);
  const assetPath = path.join(temporary.dir, "runs", run.id, "entries", run.entries[0].id, "site", "local.css");
  await writeFile(assetPath, "body{color:red}", "utf8");
  const asset = await fetch(`${gallery.baseUrl}/runs/${run.id}/entries/${run.entries[0].id}/site/local.css`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "body{color:red}");
  const traversal = await fetch(`${gallery.baseUrl}/runs/${run.id}/entries/${run.entries[0].id}/site/%2e%2e/status.json`);
  assert.ok([400, 403, 404].includes(traversal.status));

  const favorite = await fetch(`${gallery.baseUrl}/api/runs/${run.id}/entries/${run.entries[0].id}/favorite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite: true })
  });
  assert.equal(favorite.status, 200);
  assert.equal((await favorite.json()).favorite, true);
  const history = await (await fetch(`${gallery.baseUrl}/api/runs`)).json();
  assert.equal(history[0].entries[0].favorite, true);
});

test("gallery sends an SSE run update", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "SSE", host: "codex", skills: sampleSkills.slice(0, 1) });
  const gallery = await startGalleryServer({ dataDir: temporary.dir, runId: run.id, pollMs: 10 });
  t.after(gallery.close);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${gallery.baseUrl}/api/runs/${run.id}/events`, { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  const runPromise = runEntries({ dataDir: temporary.dir, runId: run.id, executor: "mock", mockDelays: [10] });
  let text = "";
  while (!/"status":"(running|ready)"/.test(text)) {
    const chunk = await reader.read();
    text += new TextDecoder().decode(chunk.value);
  }
  await runPromise;
  assert.match(text, /"status":"(running|ready)"/);
});

test("auto-open waits through early failures and opens when all entries have failed", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Failures", host: "codex", skills: sampleSkills.slice(0, 2) });
  const opened = [];
  const gallery = await startGalleryServer({ dataDir: temporary.dir, runId: run.id, autoOpen: true, open: (url) => opened.push(url), pollMs: 10 });
  t.after(gallery.close);
  await updateEntry(temporary.dir, run.id, run.entries[0].id, { status: "failed", stage: "Failed", error: "first" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(opened.length, 0);
  await updateEntry(temporary.dir, run.id, run.entries[1].id, { status: "failed", stage: "Failed", error: "second" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(opened.length, 1);
});

test("gallery reconciles a native contestant when its output file appears", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const run = await createRun({ dataDir: temporary.dir, brief: "Native watch", host: "codex", skills: sampleSkills.slice(0, 1) });
  await updateEntry(temporary.dir, run.id, run.entries[0].id, { status: "running", stage: "Native agent" });
  const gallery = await startGalleryServer({ dataDir: temporary.dir, runId: run.id, pollMs: 10 });
  t.after(gallery.close);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = await fetch(`${gallery.baseUrl}/api/runs/${run.id}/events`, { signal: controller.signal });
  const reader = events.body.getReader();
  await reader.read();
  const site = path.join(temporary.dir, "runs", run.id, "entries", run.entries[0].id, "site");
  await writeFile(path.join(site, "index.html"), "<!doctype html><html><body>Native ready</body></html>");
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await (await fetch(`${gallery.baseUrl}/api/runs/${run.id}`)).json();
    if (current.entries[0].status === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Gallery did not reconcile the native output.");
});

test("gallery automatically chooses another local port after a conflict", async (t) => {
  const temporary = await temporaryDirectory();
  t.after(temporary.cleanup);
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const requestedPort = occupied.address().port;
  const gallery = await startGalleryServer({ dataDir: temporary.dir, port: requestedPort });
  t.after(gallery.close);
  assert.notEqual(gallery.server.address().port, requestedPort);
});
