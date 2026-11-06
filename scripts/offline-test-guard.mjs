// Loaded in the test runner and its Node test children, never in product commands.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const home = mkdtempSync(join(tmpdir(), "skill-eval-offline-home-"));
process.env.HOME = home;
delete process.env.PI_CODING_AGENT_DIR;
for (const key of Object.keys(process.env)) {
  if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key)) delete process.env[key];
}
const denied = () => { throw new Error("OFFLINE_TEST_NETWORK_DENIED"); };
globalThis.fetch = denied;
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = tls.connect = denied;
syncBuiltinESMExports();
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
