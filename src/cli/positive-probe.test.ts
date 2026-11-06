import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

for (const [args, message] of [
  [["--execute"], /both --execute and --authorize-real-provider/],
  [["--authorize-real-provider"], /both --execute and --authorize-real-provider/],
  [["--model", "other/model"], /no model\/task\/path overrides/],
  [["--verify-runtime", "--execute", "--authorize-real-provider"], /read-only/],
] as const) test(`positive CLI rejects unsafe invocation ${args.join(" ")} before loading a bundle`, () => {
  const root = mkdtempSync(join(tmpdir(), "positive-cli-offline-"));
  try {
    const cli = fileURLToPath(new URL("./positive-probe.ts", import.meta.url));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", cli, ...args], { cwd: root, encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", HOME: root } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
    assert.deepEqual(readdirSync(root), []);
    assert.equal(existsSync(join(root, "runs")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
