import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("older analytics databases retain events and config through upgrade and restart", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "foxmemory-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "analytics.db");
  const fixture = new DatabaseSync(databasePath);
  fixture.exec(`
    CREATE TABLE write_events (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, event_type TEXT NOT NULL,
      memory_id TEXT, user_id TEXT, run_id TEXT, input_chars INTEGER,
      output_text TEXT, llm_model TEXT, latency_ms INTEGER,
      infer_mode INTEGER DEFAULT 1
    );
    INSERT INTO write_events (id, ts, event_type, output_text)
      VALUES ('legacy-event', datetime('now'), 'ADD', 'preserved event');
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO config VALUES ('role_user_name', 'Migration Fixture');
  `);
  fixture.close();

  // Keep Mem0 initialization on loopback; no inference or production backend is used.
  const backend = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: "ok", result: {
      collections: [{ name: "foxmemory" }],
      config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
    } }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    backend.closeAllConnections();
    backend.close(resolve);
  }));

  for (let startup = 0; startup < 2; startup += 1) {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], {
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        PORT: String(port),
        FOXMEMORY_ANALYTICS_DB_PATH: databasePath,
        MEM0_HISTORY_DB_PATH: join(directory, "history.db"),
        OPENAI_BASE_URL: `http://127.0.0.1:${backend.address().port}/v1`,
        QDRANT_HOST: "127.0.0.1",
        QDRANT_PORT: String(backend.address().port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exited = once(child, "exit");
    try {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        if (output.includes(`foxmemory-store listening on :${port}`) || child.exitCode !== null) break;
        await delay(50);
      }
      assert.ok(output.includes(`foxmemory-store listening on :${port}`), output);
      const get = async (path) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2_000) });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        return body.data;
      };
      const stats = await get("/v2/stats/memories");
      assert.equal(stats.summary.byEvent.ADD, 1, "legacy analytics event must remain readable");
      const roles = await get("/v2/config/roles");
      assert.equal(roles.user, "Migration Fixture", "persisted role must be restored");
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        assert.ok(database.prepare("PRAGMA table_info(write_events)").all().some((column) => column.name === "call_id"));
        assert.ok(database.prepare("PRAGMA index_list(write_events)").all().some((index) => index.name === "idx_we_call"));
        assert.equal(database.prepare("SELECT output_text FROM write_events WHERE id = 'legacy-event'").get().output_text, "preserved event");
        assert.equal(database.prepare("PRAGMA quick_check").get().quick_check, "ok");
      } finally {
        database.close();
      }
      assert.doesNotMatch(output, /\[analytics\] DB unavailable/);
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
  }
});
