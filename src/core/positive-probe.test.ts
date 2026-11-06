import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describePositiveProbe, executePositiveProbe } from './positive-probe.ts';

test('positive entry rejects unapproved execution before reading configuration or creating artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'positive-entry-'));
  try {
    await assert.rejects(executePositiveProbe({ repoRoot: root, executionAuthorized: false }), /authorization/i);
    assert.equal(existsSync(join(root, 'runs')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('positive description refuses missing freeze and never creates a run root', () => {
  const root = mkdtempSync(join(tmpdir(), 'positive-entry-'));
  try {
    assert.throws(() => describePositiveProbe(root));
    assert.equal(existsSync(join(root, 'runs')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { identifySkill } from './provenance.ts';
import { buildJudgeSchedule } from './judge.ts';
import { simulatePositiveProbe, type PositiveProbeDescriptor, type PositiveSessionAdapter } from './positive-probe.ts';
import { PositiveBudget } from './positive-budget.ts';
import type { PiRunResult } from './pi.ts';

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'positive-fixture-'));
  const sourcePackage = join(repo, 'package');
  mkdirSync(sourcePackage); writeFileSync(join(sourcePackage, 'SKILL.md'), 'Offline fixture only');
  const runRoot = join(repo, '.local', 'simulation');
  const runId = 'offline-positive-fixture';
  const candidatePath = join(runRoot, '.frozen', 'skill', 'SKILL.md');
  const tasks = ['fixture-one', 'fixture-two'].map(id => ({ id, prompt: 'Compute local fixture', assertions: [{ kind: 'mustContain' as const, value: '42' }] }));
  const descriptor: PositiveProbeDescriptor = {
    plan: { runId, runRoot, judgeSeed: runId, suiteFile: 'fixture.json', suiteHash: 'fixture', sourcePackage,
      candidateRuntimePath: candidatePath, model: 'minimax-cn/MiniMax-M3.1-Flash', judgeModel: 'xiaomi-token-plan-cn/mimo-v2.6-flash', home: repo, repeat: 1, judgeRepeat: 2,
      settings: { timeoutMs: 1000, judgeTimeoutMs: 1000 },
      judgePlans: tasks.map(task => ({ taskId: task.id, taskKey: `skill-${task.id}-1`, protocolVersion: 'b-relative-a-v2', rounds: buildJudgeSchedule(runId, `skill-${task.id}-1`, 2) })) },
    manifest: { schemaVersion: 1, policyVersion: 'paired-task-v2', runId, model: 'minimax-cn/MiniMax-M3.1-Flash', judgeModel: 'xiaomi-token-plan-cn/mimo-v2.6-flash', repeat: 1, judgeRepeat: 2, judgeSeed: runId, tasks,
      variants: [{ id: 'baseline', label: 'baseline', skillPaths: [] }, { id: 'skill', label: 'P', skillPaths: [candidatePath] }],
      candidate: { identity: identifySkill(join(sourcePackage, 'SKILL.md')), snapshotDir: '.frozen/skill', originalSkillPath: join(sourcePackage, 'SKILL.md') },
      suiteMeta: { suiteId: 'fixture', suiteVersion: '1', suiteHash: 'fixture', skillVersion: '1', skillPath: join(sourcePackage, 'SKILL.md') } },
    sourcePackage, frozenRoot: sourcePackage, freezeSha256: 'OFFLINE_FIXTURE',
  };
  return { repo, descriptor, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

function fakeAdapter(descriptor: PositiveProbeDescriptor, override?: (id: string, result: PiRunResult) => void): { adapter: PositiveSessionAdapter; calls: string[] } {
  const calls: string[] = [];
  const adapter: PositiveSessionAdapter = async options => {
    calls.push(options.sessionId);
    options.budget.beginSession(options.sessionId, options.role, options.model);
    const requestId = `${options.sessionId}-request`;
    options.budget.reserve(requestId);
    options.onLedger?.();
    options.budget.settle(requestId, { input: 1000, output: 20 });
    options.budget.endSession();
    const variant = options.skillPaths.length > 0;
    const result: PiRunResult = {
      exitCode: 0, timedOut: false, stderr: '', isolation: { verified: true, issues: [] },
      metrics: { totalTokens: 1020, totalCost: 0, toolCalls: variant ? 2 : 0, output: variant ? '{"answer":42}' : 'no contract', readPaths: options.skillPaths, toolNames: variant ? ['read', 'bash'] : [] },
      events: variant ? [{ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'script', args: { command: `/usr/bin/python3 ${join(dirname(descriptor.plan.candidateRuntimePath), 'scripts', 'control.py')} ${options.sessionId.includes('fixture-two') ? 'digest' : 'sum'}` } }, { type: 'tool_execution_end', toolName: 'bash', toolCallId: 'script', isError: false, result: { content: [{ type: 'text', text: '{"answer":42}' }] } }] : [],
    };
    if (options.role === 'judge') {
      const task = descriptor.plan.judgePlans.find(j => options.sessionId.includes(j.taskId))!;
      const round = task.rounds.find(r => options.sessionId.endsWith(r.dirName))!;
      result.metrics.output = JSON.stringify({ verdict: round.swapped ? 'loss' : 'win', scoreA: round.swapped ? 90 : 30, scoreB: round.swapped ? 30 : 90, confidence: 0.9, reason: 'The correct numeric contract is delivered.' });
    }
    override?.(options.sessionId, result);
    return result;
  };
  return { adapter, calls };
}

test('offline positive probe runs exactly four subjects then four anonymous ordered judges and counts both roles', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor);
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'PASS', result.reason ?? '');
    assert.equal(result.actualProviderCalls, 'NOT_RUN');
    assert.equal(result.candidateEffectiveness, 'NOT_EVALUATED');
    assert.equal(result.mainExperiment, 'NOT_RUN');
    assert.deepEqual(calls.slice(0, 4), ['baseline-fixture-one-1', 'baseline-fixture-two-1', 'skill-fixture-one-1', 'skill-fixture-two-1']);
    assert.equal(calls.length, 8);
    assert.equal(result.sessions.filter(s => s.status === 'PASS').length, 8);
    const stored = JSON.parse(readFileSync(join(f.descriptor.plan.runRoot, 'control-status.json'), 'utf8'));
    assert.deepEqual(stored.ledger, result.ledger);
    const lastJudge = result.sessions[7]!;
    assert(existsSync(join(lastJudge.evidenceDir, 'judgment.json')));
    const prompt = readFileSync(join(lastJudge.evidenceDir, 'prompt.md'), 'utf8');
    assert(!prompt.includes(f.descriptor.sourcePackage));
    await assert.rejects(simulatePositiveProbe(f.descriptor, adapter), /already exists/);
    assert.equal(calls.length, 8, 'No resume or replacement calls');
  } finally { f.cleanup(); }
});

test('one failed subject stops all later sessions and preserves raw failure with explicit unrun rows', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (_id, result) => { result.exitCode = 1; result.metrics.output = ''; });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.equal(calls.length, 1);
    assert.equal(result.sessions.filter(s => s.status === 'NOT_RUN').length, 7);
    assert(existsSync(join(result.sessions[0]!.evidenceDir, 'events.json')));
    assert.equal(JSON.parse(readFileSync(join(result.sessions[0]!.evidenceDir, 'result.json'), 'utf8')).assertions, null);
  } finally { f.cleanup(); }
});

test('missing P activation or script success stops before judges', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => { if (id.startsWith('skill-')) result.metrics.readPaths = []; });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.match(result.reason!, /evidence failed/);
    assert.equal(calls.length, 3);
    assert.equal(result.sessions.filter(s => s.role === 'judge' && s.status === 'NOT_RUN').length, 4);
  } finally { f.cleanup(); }
});

test('successful baseline without planted contrast stops after subjects and does not invoke judges', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => { if (id.startsWith('baseline-')) result.metrics.output = '{"answer":42}'; });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(calls.length, 4); assert.match(result.reason!, /No planted/);
    assert.equal(result.status, 'STOPPED');
  } finally { f.cleanup(); }
});

test('invalid or reverse judge output stops immediately while retaining single-round evidence', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => { if (id.startsWith('judge-')) result.metrics.output = 'malformed'; });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(calls.length, 5); assert.equal(result.status, 'STOPPED');
    assert(existsSync(join(result.sessions[4]!.evidenceDir, 'judgment.json')));
    assert.equal(result.sessions[5]!.status, 'NOT_RUN');
  } finally { f.cleanup(); }
});

test('tampered receipt fails the fixed freeze anchor before looking for payloads', () => {
  const root = mkdtempSync(join(tmpdir(), 'positive-receipt-'));
  try {
    const frozen = join(root, '.local', 'retest-data-analysis-1.9.0-20261106', 'frozen');
    mkdirSync(frozen, { recursive: true }); writeFileSync(join(frozen, 'FREEZE.json'), '{}');
    assert.throws(() => describePositiveProbe(root), /receipt identity changed/);
    assert.equal(existsSync(join(root, 'runs')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const fault of ['timeout', 'tool', 'assertion', 'script'] as const) test(`P ${fault} failure retains failure and forbids remaining sessions`, async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => {
      if (!id.startsWith('skill-')) return;
      if (fault === 'timeout') result.timedOut = true;
      if (fault === 'tool') result.events.push({ type: 'tool_execution_end', isError: true });
      if (fault === 'assertion') result.metrics.output = 'wrong';
      if (fault === 'script') result.events = [];
    });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.equal(calls.length, 3);
    assert.equal(result.sessions[2]!.status, 'FAILED');
    assert.equal(result.sessions[3]!.status, 'NOT_RUN');
    assert.equal(result.ledger.state, 'stopped');
  } finally { f.cleanup(); }
});

test('judge disagreement stops after retaining both rounds and leaves second pair unrun', async () => {
  const f = fixture();
  try {
    let judgeCount = 0;
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => {
      if (id.startsWith('judge-') && ++judgeCount === 2) result.metrics.output = JSON.stringify({ verdict: 'tie', scoreA: 50, scoreB: 50, confidence: 0.9, reason: 'No distinction' });
    });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.equal(calls.length, 6);
    assert(existsSync(join(result.sessions[5]!.evidenceDir, 'judgment.json')));
    assert.equal(result.sessions[6]!.status, 'NOT_RUN');
  } finally { f.cleanup(); }
});

for (const fault of ['cat', 'echo', 'wrong-path', 'wrong-mode', 'bad-stdout', 'different-delivery'] as const) test(`script evidence rejects ${fault} even if the final answer passes`, async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => {
      if (!id.startsWith('skill-')) return;
      const start = result.events[0]!.args as { command: string };
      if (fault === 'cat') start.command = `cat ${join(dirname(f.descriptor.plan.candidateRuntimePath), 'scripts', 'control.py')}`;
      if (fault === 'echo') start.command = `echo ${start.command}`;
      if (fault === 'wrong-path') start.command = '/usr/bin/python3 /tmp/control.py sum';
      if (fault === 'wrong-mode') start.command = start.command.replace(/sum$/, 'digest');
      if (fault === 'bad-stdout') result.events[1]!.result = { content: [{ type: 'text', text: 'not a result' }] };
      if (fault === 'different-delivery') result.events[1]!.result = { content: [{ type: 'text', text: '{"answer":42,"unreported":true}' }] };
    });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.equal(calls.length, 3);
    assert.match(result.reason!, /evidence failed/);
  } finally { f.cleanup(); }
});

test('script evidence accepts exact quoted interpreter call with a quoted here-document and matching stdout', async () => {
  const f = fixture();
  try {
    const { adapter } = fakeAdapter(f.descriptor, (id, result) => {
      if (!id.startsWith('skill-')) return;
      const path = join(dirname(f.descriptor.plan.candidateRuntimePath), 'scripts', 'control.py');
      result.events[0]!.args = { command: `/usr/bin/python3 '${path}' ${id.includes('fixture-two') ? 'digest' : 'sum'} <<'FIXTURE'\n{"value":42}\nFIXTURE` };
    });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'PASS', result.reason ?? '');
  } finally { f.cleanup(); }
});

for (const values of [{ scoreA: -999, scoreB: 999, confidence: 9 }, { scoreA: 10, scoreB: 20, confidence: -1 }]) test('out-of-range judge values cannot pass through historical parser clamping', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => {
      if (id.startsWith('judge-')) result.metrics.output = JSON.stringify({ verdict: 'win', ...values, reason: 'Invalid raw range' });
    });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.equal(calls.length, 5);
    assert.match(result.reason!, /Invalid or reverse/);
  } finally { f.cleanup(); }
});

test('unaccounted session adapter cannot yield a PASS with an empty ledger', async () => {
  const f = fixture();
  try {
    const normal = fakeAdapter(f.descriptor).adapter;
    const result = await simulatePositiveProbe(f.descriptor, options => normal({ ...options, budget: new PositiveBudget() }));
    assert.equal(result.status, 'STOPPED'); assert.match(result.reason!, /ledger/);
  } finally { f.cleanup(); }
});

test('judge label opposite to a small score delta stops instead of using the historical ten-point tolerance', async () => {
  const f = fixture();
  try {
    const { adapter, calls } = fakeAdapter(f.descriptor, (id, result) => {
      if (id.startsWith('judge-')) result.metrics.output = JSON.stringify({ verdict: 'win', scoreA: 50, scoreB: 45, confidence: 0.9, reason: 'Contradictory direction' });
    });
    const result = await simulatePositiveProbe(f.descriptor, adapter);
    assert.equal(result.status, 'STOPPED'); assert.equal(calls.length, 5);
    assert.match(result.reason!, /Invalid or reverse/);
  } finally { f.cleanup(); }
});

import { chmodSync, symlinkSync, unlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyPositiveProbeRuntime } from './positive-probe.ts';

function runtimeFixture() {
  const f = fixture();
  const sdk = join(f.repo, 'sdk'); mkdirSync(sdk);
  const entry = join(sdk, 'cli.js'); writeFileSync(entry, '#!/usr/bin/env node\n'); chmodSync(entry, 0o755);
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@fixture/pi', bin: { pi: 'cli.js' } }));
  const bin = join(f.repo, 'bin'); mkdirSync(bin); symlinkSync(entry, join(bin, 'pi'));
  const target = join(sdk, 'target.js'); writeFileSync(target, 'offline target');
  const link = join(sdk, 'target-link'); symlinkSync('target.js', link);
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const files = [{ path: 'cli.js', sha256: sha(entry), executable: true }, { path: 'package.json', sha256: sha(join(sdk, 'package.json')), executable: false }, { path: 'target.js', sha256: sha(target), executable: false }, { path: 'target-link', symlink: 'target.js' }];
  writeFileSync(join(f.descriptor.frozenRoot, 'pi-runtime-files.json'), JSON.stringify(files));
  f.descriptor.runtime = { node: { path: realpathSync(process.execPath), version: process.version, sha256: sha(process.execPath) }, pi: { root: sdk, treeFiles: files.length, entrySha256: sha(entry) } };
  const previousPath = process.env.PATH; process.env.PATH = bin;
  return { ...f, sdk, target, link, cleanup: () => { process.env.PATH = previousPath; f.cleanup(); } };
}

test('offline runtime inventory verifies declared internal symlinks without inventing a missing content hash', () => {
  const f = runtimeFixture();
  try { assert.doesNotThrow(() => verifyPositiveProbeRuntime(f.descriptor)); }
  finally { f.cleanup(); }
});

test('offline runtime inventory rejects a symlink escape and a changed regular file', () => {
  const f = runtimeFixture();
  try {
    writeFileSync(f.target, 'changed');
    assert.throws(() => verifyPositiveProbeRuntime(f.descriptor), /bytes drift/);
    writeFileSync(f.target, 'offline target');
    unlinkSync(f.link); symlinkSync(join(f.repo, 'package', 'SKILL.md'), f.link);
    assert.throws(() => verifyPositiveProbeRuntime(f.descriptor), /escapes runtime/);
  } finally { f.cleanup(); }
});

test('offline runtime inventory rejects a regular file silently replaced by a symlink', () => {
  const f = runtimeFixture();
  try {
    const replacement = join(f.sdk, 'replacement.js'); writeFileSync(replacement, 'offline target');
    unlinkSync(f.target); symlinkSync(replacement, f.target);
    assert.throws(() => verifyPositiveProbeRuntime(f.descriptor), /regular-file type drift/);
  } finally { f.cleanup(); }
});
