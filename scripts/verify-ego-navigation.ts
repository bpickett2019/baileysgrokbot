// Explicit operator smoke, never part of the offline suite. Uses the already-authorized
// TaskSpace in the supplied connection file; does not create or claim browser spaces.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { BrowserConnection, EgoBrowserProvider } from "../packages/adapters/src/ego-browser.js";

const connectionFile = process.argv[2];
if (!connectionFile)
  throw new Error("Usage: pnpm exec tsx scripts/verify-ego-navigation.ts <connection-file>");
const binding = BrowserConnection.parse(JSON.parse(await readFile(connectionFile, "utf8")));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><title>Ego navigation verification</title>
    <h1>Navigation verification (local fixture)</h1>
    <label>Name <input id="name"></label>
    <button onclick="document.getElementById('result').textContent='Saved draft: '+document.getElementById('name').value">Save draft</button>
    <p id="result"></p>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
const directory = await mkdtemp(path.join(tmpdir(), "rakazo-ego-smoke-"));
try {
  const file = path.join(directory, "connection.json");
  const origin = `http://127.0.0.1:${address.port}`;
  await writeFile(file, JSON.stringify({ ...binding, allowedOrigins: [origin] }), { mode: 0o600 });
  const provider = new EgoBrowserProvider(file);
  const context = {
    operationId: "navigation-smoke",
    traceId: "navigation-smoke",
    userId: binding.userId,
    spaceId: binding.spaceId,
    botId: binding.botIds[0]!,
    runId: "navigation-smoke",
    signal: new AbortController().signal,
  };
  const computer = {
    id: "smoke",
    botId: binding.computerHomeKey,
    kind: "docker" as const,
    providerRef: "smoke",
  };
  const navigation = await provider.navigate(computer, { url: origin }, context);
  assert.equal(navigation.error, undefined, navigation.error);
  const snapshot = await provider.snapshot(computer, {}, context);
  assert.equal(snapshot.error, undefined, snapshot.error);
  const textbox = snapshot.elements.find((element) => element.role === "textbox");
  const button = snapshot.elements.find((element) => element.role === "button");
  assert.ok(textbox && button, "Expected fixture controls");
  const value = "Verified 'quotes' and text; not host code";
  const response = await provider.act(
    computer,
    {
      actions: [
        { kind: "fill", ref: textbox.ref, text: value },
        { kind: "click", ref: button.ref },
      ],
    },
    context,
  );
  assert.equal(response.ok, true, response.error);
  assert.equal(response.completed, 2);
  assert.ok(
    response.tree?.includes(`Saved draft: ${value}`),
    "Expected saved result in Ego snapshot",
  );
  console.log(
    "PASS: real Ego navigation, semantic refs, batched fill/click, and saved-result read-back.",
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(directory, { recursive: true, force: true });
}
