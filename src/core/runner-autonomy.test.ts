import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvaluation, recomputeSummary } from "./runner.ts";
import { ControlledBudget } from "./controlled-budget.ts";
import type { EvaluationExecution } from "./execution.ts";
import { emptyMetrics } from "./pi.ts";

for (const failure of ["subject", "judge", "host", "finalize"] as const) test(`planned independent samples continue after ${failure} failure only when Host remains sound`, async () => {
  const root = mkdtempSync(join(tmpdir(), "eval-native-autonomy-"));
  const skill = join(root, "SKILL.md");
  writeFileSync(skill, "---\nname: fixture\ndescription: offline fixture\n---\nFixture");
  const ledger = new ControlledBudget();
  let subjects = 0, judges = 0;
  const execution: EvaluationExecution = {
    mode: "simulated", snapshot: () => ledger.snapshot(),
    isStopped: () => ledger.snapshot().state === "stopped",
    finalize() {
      if (failure === "finalize") { ledger.stop("LEDGER_PERSISTENCE_FAILED"); throw new Error("LEDGER_PERSISTENCE_FAILED"); }
    },
    async run(role) {
      const index = role === "subject" ? ++subjects : ++judges;
      const failed = index === 1 && (failure === role || failure === "host" && role === "subject");
      if (failure === "host" && failed) ledger.stop("EVIDENCE_PERSISTENCE_FAILED");
      const output = role === "judge"
        ? failed ? "invalid judge JSON" : '{"verdict":"tie","scoreA":80,"scoreB":80,"confidence":1,"reason":"Equivalent"}'
        : failed ? "" : "OK";
      return {
        exitCode: role === "subject" && failed ? 1 : 0,
        events: [], metrics: { ...emptyMetrics(), output },
        stderr: failed && role === "subject" ? "SDK_FINAL_FAILURE" : "",
        timedOut: false, isolation: { verified: failure !== "host" || !failed, issues: [] },
      };
    },
  };
  try {
    const summary = await runEvaluation({ runRoot: join(root, "run"), runId: "offline-independent-samples", model: "fixture/subject", judgeModel: "fixture/judge", repeat: 1, judgeRepeat: 2,
      variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Candidate", skillPaths: [skill] }],
      tasks: ["t1", "t2"].map(id => ({ id, prompt: "Offline task", assertions: [{ kind: "mustNotContain" as const, value: "FORBIDDEN" }] })), execution });
    const state = JSON.parse(readFileSync(join(root, "run/execution-status.json"), "utf8"));
    assert.equal(summary.status, failure === "host" ? "failed" : "partial");
    assert.equal(summary.execution?.stopped, failure === "host" || failure === "finalize");
    assert.equal(subjects, failure === "host" ? 1 : 4);
    if (failure === "subject") {
      assert.equal(summary.results.length, 4);
      assert.equal(summary.results[0]!.assertions, null, "failed output cannot pass negative assertions");
      assert.equal(judges, 2, "only the intact pair can be judged");
    } else if (failure === "judge") {
      assert.equal(judges, 4, "a malformed judgment must not suppress remaining frozen rounds");
      assert.equal(state.sessions.filter((s: { status: string }) => s.status === "NOT_RUN").length, 0);
      assert.equal(summary.pairwise[0]!.judgeRuns.length, 2);
      assert.equal(summary.pairwise[0]!.judgeRuns[0]!.verdict, "not_judged");
      assert.equal(summary.pairwise[1]!.verdict, "tie");
    } else if (failure === "host") {
      assert.equal(judges, 0);
      assert.equal(state.sessions.filter((s: { status: string }) => s.status === "NOT_RUN").length, 7);
    } else {
      assert.equal(judges, 4);
      assert(state.sessions.every((s: { status: string }) => s.status === "SUCCESS"));
      assert.equal(state.reason, "LEDGER_PERSISTENCE_FAILED", "successful samples cannot hide failed evidence finalization");
    }
    writeFileSync(join(root, "run/summary.json"), JSON.stringify(summary));
    assert(summary.tasks);
    const replay = await recomputeSummary(join(root, "run"), { tasks: summary.tasks, variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Candidate", skillPaths: [skill] }], repeat: 1 });
    assert.equal(replay.execution?.stopped, failure === "host" || failure === "finalize");
    assert.ok(!replay.integrity?.issues.some(issue => issue.includes("受控执行状态未验证")), "ordinary failure continuation must remain verifiable during offline replay");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
