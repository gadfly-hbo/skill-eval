import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("launcher forwards SIGTERM to its child and waits for graceful exit", { timeout: 10_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-launcher-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "src/cli"), { recursive: true });
  const bin = join(root, "bin/skill-eval.mjs");
  copyFileSync(new URL("../../bin/skill-eval.mjs", import.meta.url), bin);
  writeFileSync(join(root, "src/cli/main.ts"), `
    const watchdog = setTimeout(() => process.exit(99), 5000);
    process.on("SIGTERM", () => {
      clearTimeout(watchdog);
      process.stdout.write("terminal evidence flushed\\n");
      process.exitCode = 143;
    });
    process.stdout.write("ready\\n");
  `);
  const child = spawn(process.execPath, [bin, "eval"], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let output = "";
  child.stdout.on("data", chunk => {
    const wasReady = output.includes("ready\n");
    output += String(chunk);
    if (!wasReady && output.includes("ready\n")) child.kill("SIGTERM");
  });
  assert.deepEqual(await once(child, "close"), [143, null]);
  assert.match(output, /terminal evidence flushed/);
});
