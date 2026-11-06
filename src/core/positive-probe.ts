/** The pinned positive calibration only. This entry cannot start the main experiment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { evaluateAssertions, type AssertionReport } from './assertions.ts';
import { detectActivation } from './activation.ts';
import { buildJudgePrompt, buildJudgeSchedule, parseJudgeResponse, reconcileJudgeRun, JUDGE_PROTOCOL_VERSION, type JudgeOptions, type JudgeResult } from './judge.ts';
import { freezeSkill, assertSkillIdentity, type SkillIdentity } from './provenance.ts';
import { saveRunManifest, type RunManifest } from './run-manifest.ts';
import { hashSuite, type SuiteFile } from './suite.ts';
import { preflightModels } from './model-preflight.ts';
import { PositiveBudget, POSITIVE_BUDGET_POLICY } from './positive-budget.ts';
import { extractText, type PiEvent, type PiRunResult } from './pi.ts';
import { resolvePiRuntime } from './isolation.ts';

const FREEZE_SHA256 = '0dc6b4a4dcafb51b862a8143ab5eb103c309712ad5adfc0ec05b4e621b10cea7';
const BUNDLE = '.local/retest-data-analysis-1.9.0-20261106/frozen';
const RUN_ID = 'da190-20261106-frozen-v1-positive';
const SUBJECT_MODEL = 'minimax-cn/MiniMax-M3.1-Flash';
const JUDGE_MODEL = 'xiaomi-token-plan-cn/mimo-v2.6-flash';
const POSITIVE_IDENTITY = 'sha256:6cfa4c90b816ce377fefbb20077cf64967f2855f621b5169d83a9c0c1f1ab8a5';
const TASK_IDS = ['da-positive-json', 'da-positive-digest'];
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

interface Plan {
  runId: string; runRoot: string; judgeSeed: string; suiteFile: string; suiteHash: string;
  sourcePackage: string; candidateRuntimePath: string; model: string; judgeModel: string; home: string;
  repeat: number; judgeRepeat: number; contextPrefix?: string;
  settings: { timeoutMs: number; judgeTimeoutMs: number };
  judgePlans: Array<{ taskId: string; taskKey: string; protocolVersion: string; rounds: ReturnType<typeof buildJudgeSchedule> }>;
}
export interface PositiveProbeDescriptor {
  plan: Plan; manifest: RunManifest; sourcePackage: string; frozenRoot: string;
  freezeSha256: string; runtime?: { node: { path: string; version: string; sha256: string }; pi: { root: string; treeFiles: number; entrySha256: string } };
}
export interface PositiveSessionOptions {
  workspaceRoot: string; sessionId: string; prompt: string; model: string; skillPaths: string[];
  home: string; role: 'subject' | 'judge'; budget: PositiveBudget; timeoutMs: number; onLedger?: () => void;
  catalogHashes?: Record<string, string | null>;
}
export type PositiveSessionAdapter = (options: PositiveSessionOptions) => Promise<PiRunResult>;
export interface PositiveProbeOutcome {
  status: 'RUNNING' | 'PASS' | 'STOPPED'; evidenceLevel: 'real-provider' | 'simulated';
  actualProviderCalls: 'EXECUTION_ATTEMPTED' | 'NOT_RUN'; reason: string | null;
  sessions: Array<{ id: string; role: 'subject' | 'judge'; status: 'NOT_RUN' | 'RUNNING' | 'PASS' | 'FAILED'; evidenceDir: string }>;
  ledger: ReturnType<PositiveBudget['snapshot']>; candidateEffectiveness: 'NOT_EVALUATED'; mainExperiment: 'NOT_RUN';
}

/** No auth reads, directories, SDK sessions, or network requests. */
export function describePositiveProbe(repoRoot = process.cwd()): PositiveProbeDescriptor {
  const root = realpathSync(resolve(repoRoot));
  const frozenRoot = join(root, BUNDLE);
  assert.equal(hash(join(frozenRoot, 'FREEZE.json')), FREEZE_SHA256, 'Frozen receipt identity changed');
  const freeze = json(join(frozenRoot, 'FREEZE.json'));
  assert.equal(freeze.files.length, 67, 'Unexpected frozen payload count');
  const seen = new Set<string>();
  for (const file of freeze.files) {
    const path = resolve(frozenRoot, file.path);
    assert(path.startsWith(frozenRoot + sep) && !seen.has(path), 'Unsafe/duplicate frozen path');
    seen.add(path);
    assert.equal(realpathSync(path), path, 'Frozen paths cannot use symlinks');
    assert(lstatSync(path).isFile(), 'Frozen payload is not a regular file');
    assert.equal(hash(path), file.sha256, 'Frozen payload changed');
  }
  const plans = json(join(frozenRoot, 'run-plans.json')) as Array<Plan & { role: string }>;
  const plan = plans.find(p => p.role === 'positive');
  assert(plan, 'Missing positive plan');
  assert.equal(plan.runId, RUN_ID); assert.equal(plan.judgeSeed, RUN_ID);
  assert.equal(plan.runRoot, join(root, 'runs', RUN_ID), 'Frozen run location must match repository');
  assert.equal(plan.sourcePackage, join(frozenRoot, 'packages', 'positive'));
  assert.equal(plan.candidateRuntimePath, join(plan.runRoot, '.frozen', 'skill', 'SKILL.md'));
  assert.equal(plan.model, SUBJECT_MODEL); assert.equal(plan.judgeModel, JUDGE_MODEL);
  assert.equal(plan.repeat, 1); assert.equal(plan.judgeRepeat, 2);
  assert.equal(plan.suiteFile, 'suite-positive.json'); assert.equal(plan.suiteHash, 'sha256:ca5b80a7bd839627');
  const suite = json(join(frozenRoot, plan.suiteFile)) as SuiteFile;
  assert.equal(hashSuite(suite), plan.suiteHash);
  assert.deepEqual(suite.tasks.map(t => t.id), TASK_IDS);
  assert.equal(suite.tasks.length, 2);
  for (const task of suite.tasks) {
    assert(task.assertions?.length && task.kind === 'scored' && task.shouldActivate === true);
    const judgePlan: Plan['judgePlans'][number] | undefined = plan.judgePlans.find(j => j.taskId === task.id);
    assert(judgePlan); assert.equal(judgePlan.protocolVersion, JUDGE_PROTOCOL_VERSION);
    assert.deepEqual(judgePlan.rounds, buildJudgeSchedule(plan.judgeSeed, `skill-${task.id}-1`, 2));
  }
  const identity = json(join(frozenRoot, 'package-identities.json')).positive as SkillIdentity;
  assert.equal(identity.hash, POSITIVE_IDENTITY);
  assertSkillIdentity(join(plan.sourcePackage, 'SKILL.md'), identity);
  const manifest: RunManifest = {
    schemaVersion: 1, policyVersion: 'paired-task-v2', runId: plan.runId,
    model: plan.model, judgeModel: plan.judgeModel, repeat: 1, judgeRepeat: 2, judgeSeed: plan.judgeSeed,
    contextPrefix: suite.contextPrefix, tasks: suite.tasks,
    variants: [{ id: 'baseline', label: 'Baseline（不装 skill）', skillPaths: [] }, { id: 'skill', label: 'Synthetic calibration', skillPaths: [plan.candidateRuntimePath] }],
    settings: { gainThresholdPp: 10, timeoutMs: 480000, judgeTimeoutMs: 300000, keywordSignal: false, nodeVersion: freeze.environment.node.version },
    candidate: { identity, snapshotDir: '.frozen/skill', originalSkillPath: join(plan.sourcePackage, 'SKILL.md') },
    suiteMeta: { suiteId: suite.id, suiteVersion: suite.version ?? '', suiteHash: plan.suiteHash, skillVersion: suite.skill?.version ?? '', skillPath: join(plan.sourcePackage, 'SKILL.md') },
  };
  return { plan, manifest, sourcePackage: plan.sourcePackage, frozenRoot, freezeSha256: FREEZE_SHA256, runtime: freeze.environment };
}

export function positiveProbePublicDescription(descriptor: PositiveProbeDescriptor) {
  return { entrypoint: 'controlled-positive-v1', frozenReceiptSha256: descriptor.freezeSha256,
    runId: descriptor.plan.runId, model: descriptor.plan.model, judgeModel: descriptor.plan.judgeModel,
    tasks: 2, subjectSessions: 4, judgeSessions: 4, policy: POSITIVE_BUDGET_POLICY,
    executionAuthorized: false, providerCalls: 'NOT_RUN', runRootMustBeFresh: !existsSync(descriptor.plan.runRoot),
    executionDifferences: ['Native Pi SDK with original tools instead of print CLI', 'Network-denied model/tool worker; parent authenticates and brokers requests', 'Subject max output 4096; judge max output 1024', 'Automatic retry, compaction and cache warming disabled', 'Every HTTP request reserves worst-case USD equivalent before dispatch', 'Script evidence accepts only /usr/bin/python3 with exact frozen script/mode and plain file input or quoted here-document; shell composition is unverified', 'All sessions set xcrun_db=<workspace>/.xcrun_db to keep system Python cache inside the sandbox'],
    accountAuth: 'UNKNOWN', accountModelPermission: 'UNKNOWN', quota: 'UNKNOWN', actualBilling: 'UNKNOWN',
    budgetScope: 'Conservative USD equivalent at pinned public rates; not an account-wide invoice cap',
    mainExperiment: 'NOT_RUN', candidateEffectiveness: 'NOT_EVALUATED' };
}

export function verifyPositiveProbeRuntime(descriptor: PositiveProbeDescriptor): void {
  const runtime = descriptor.runtime;
  assert(runtime, 'Frozen runtime evidence missing');
  assert.equal(process.version, runtime.node.version, 'Node version drift');
  assert.equal(realpathSync(process.execPath), realpathSync(runtime.node.path), 'Node location drift');
  assert.equal(hash(runtime.node.path), runtime.node.sha256, 'Node bytes drift');
  const files = json(join(descriptor.frozenRoot, 'pi-runtime-files.json')) as Array<{ path: string; sha256?: string; executable?: boolean; symlink?: string }>;
  assert.equal(files.length, runtime.pi.treeFiles, 'SDK inventory incomplete');
  const root = realpathSync(runtime.pi.root);
  assert.equal(realpathSync(resolvePiRuntime().readOnlyRoots[0]!), root, 'Actual Pi runtime location drift');
  const seen = new Set<string>();
  for (const file of files) {
    const path = resolve(root, file.path);
    assert(path.startsWith(root + sep) && !seen.has(path), 'Unsafe/duplicate SDK path'); seen.add(path);
    assert(realpathSync(path).startsWith(root + sep), 'SDK symlink escapes runtime');
    if (file.symlink !== undefined) {
      assert(lstatSync(path).isSymbolicLink(), 'SDK symlink type drift');
      assert.equal(readlinkSync(path), file.symlink, 'SDK symlink target drift');
      continue;
    }
    assert(lstatSync(path).isFile(), 'SDK regular-file type drift');
    assert.equal(hash(path), file.sha256, 'SDK bytes drift');
    assert.equal(Boolean(statSync(path).mode & 0o111), file.executable, 'SDK executable-bit drift');
  }
}

/** Real entry has no injection seam or parameter overrides. Only future explicit approval may call it. */
export async function executePositiveProbe(options: { repoRoot?: string; executionAuthorized: boolean }): Promise<PositiveProbeOutcome> {
  if (options.executionAuthorized !== true) throw new Error('Explicit real Provider authorization is required');
  const descriptor = describePositiveProbe(options.repoRoot);
  assert(!existsSync(descriptor.plan.runRoot), 'Run directory already exists; no overwrite or resume');
  const catalogHashes = captureCatalogHashes(descriptor.plan.home);
  await verifyPositiveProbeReadiness(descriptor);
  assert.deepEqual(captureCatalogHashes(descriptor.plan.home), catalogHashes, 'Model catalog changed during readiness');
  const { runControlledSession } = await import('./positive-session.ts');
  return executeDescriptor(descriptor, runControlledSession, 'real-provider', catalogHashes);
}

function captureCatalogHashes(home: string): Record<string, string | null> {
  return Object.freeze(Object.fromEntries(['models.json', 'models-store.json'].map(name => {
    const path = join(home, '.pi', 'agent', name);
    return [name, existsSync(path) ? hash(path) : null];
  })));
}

/** Complete local readiness only: no credentials, network or run artifacts. */
export async function verifyPositiveProbeReadiness(descriptor: PositiveProbeDescriptor) {
  verifyPositiveProbeRuntime(descriptor);
  const checked = await preflightModels({ models: [SUBJECT_MODEL], judgeModel: JUDGE_MODEL, home: descriptor.plan.home });
  assert(checked.valid, 'Exact model identity preflight failed');
  assert.equal(checked.runtime?.entrySha256, descriptor.runtime!.pi.entrySha256, 'Actual Pi entry bytes drift');
  const identities = [{ api: 'anthropic-messages', baseUrl: 'https://api.minimaxi.com/anthropic', contextWindow: 1000000 }, { api: 'openai-completions', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', contextWindow: 1048576 }];
  checked.models.forEach((entry, index) => {
    const expected = identities[index]!;
    assert(entry.model && !entry.model.baseUrlRedacted, 'Model endpoint cannot be verified');
    assert.equal(entry.model.api, expected.api); assert.equal(entry.model.baseUrl, expected.baseUrl);
    assert.equal(entry.model.contextWindow, expected.contextWindow);
  });
  return { status: 'LOCAL_RUNTIME_AND_MODELS_CONFIRMED' as const, sdkFilesVerified: descriptor.runtime!.pi.treeFiles, providerCalls: 'NOT_RUN' as const, executionAuthorized: false as const, modelPreflight: checked };
}

/** Offline seam: caller-supplied adapter is mandatory; never imports the real transport. */
export async function simulatePositiveProbe(descriptor: PositiveProbeDescriptor, adapter: PositiveSessionAdapter): Promise<PositiveProbeOutcome> {
  assert(typeof adapter === 'function', 'Simulation requires an explicit offline adapter');
  assert(descriptor.plan.runRoot.includes(`${sep}.local${sep}`), 'Simulation artifacts belong in .local');
  return executeDescriptor(descriptor, adapter, 'simulated');
}

function successfulControlScript(events: PiEvent[], scriptPath: string, mode: 'sum' | 'digest', task: RunManifest['tasks'][number], finalOutput: string): boolean {
  const escaped = scriptPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const invocation = new RegExp(`^\\s*/usr/bin/python3\\s+(?:${escaped}|"${escaped}"|'${escaped}')\\s+${mode}(?=\\s|$)`);
  const commands = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool_execution_start' && event.toolName === 'bash') {
      const args = event.args as { command?: string } | undefined;
      if (typeof args?.command !== 'string') continue;
      const matched = invocation.exec(args.command);
      if (!matched) continue;
      const tail = args.command.slice(matched[0].length).trim();
      // Deliberately narrow evidence grammar: a single interpreter invocation with
      // a plain file input or a quoted here-document. Shell composition is unverified.
      const here = /^<<\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(tail);
      const validHere = here && tail.endsWith(`\n${here[2]}`) && tail.slice(here[0].length).split(/\r?\n/).filter(line => line === here[2]).length === 1;
      const validFile = /^<\s*(?:[^\s;'"`$|&<>]+|'[^'\n]+'|"[^"`$\n]+")$/.test(tail);
      if (tail === '' || validHere || validFile) commands.add(String(event.toolCallId));
    }
    if (event.type === 'tool_execution_end' && commands.has(String(event.toolCallId)) && event.isError === false) {
      const result = event.result as { content?: unknown; output?: string; structuredContent?: { output?: string } } | undefined;
      const output = extractText(result?.content) || result?.structuredContent?.output || result?.output || '';
      if (!evaluateAssertions(output, task.assertions ?? []).allPassed) continue;
      try { assert.deepEqual(JSON.parse(output), JSON.parse(finalOutput)); return true; } catch { /* delivery differs */ }
    }
  }
  return false;
}

function validRawJudge(text: string): boolean {
  try {
    const value = JSON.parse(text.trim());
    return value !== null && typeof value === 'object' && ['win', 'tie', 'loss'].includes(value.verdict) &&
      ['scoreA', 'scoreB'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 100) &&
      typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 &&
      typeof value.reason === 'string' && value.reason.trim().length > 0 &&
      (value.verdict === 'tie' || value.verdict === 'win' && value.scoreB > value.scoreA || value.verdict === 'loss' && value.scoreB < value.scoreA);
  } catch { return false; }
}

async function executeDescriptor(descriptor: PositiveProbeDescriptor, adapter: PositiveSessionAdapter, evidenceLevel: 'real-provider' | 'simulated', catalogHashes?: Record<string, string | null>): Promise<PositiveProbeOutcome> {
  const { plan, manifest } = descriptor;
  assert(!existsSync(plan.runRoot), 'Run directory already exists; no overwrite or resume');
  const root = plan.runRoot;
  mkdirSync(dirname(root), { recursive: true, mode: 0o700 });
  mkdirSync(root, { mode: 0o700 }); // Atomic claim: another process cannot win after the freshness check.
  const candidate = freezeSkill(join(descriptor.sourcePackage, 'SKILL.md'), join(root, '.frozen', 'skill'));
  assert.equal(candidate.identity.hash, manifest.candidate.identity.hash);
  saveRunManifest(root, manifest);
  const budget = new PositiveBudget();
  const outcome: PositiveProbeOutcome = { status: 'RUNNING', evidenceLevel,
    actualProviderCalls: evidenceLevel === 'simulated' ? 'NOT_RUN' : 'EXECUTION_ATTEMPTED', reason: null,
    sessions: [], ledger: budget.snapshot(), candidateEffectiveness: 'NOT_EVALUATED', mainExperiment: 'NOT_RUN' };
  const subjects = new Map<string, { run: PiRunResult; assertions: AssertionReport | null }>();
  for (const variant of manifest.variants) for (const task of manifest.tasks) outcome.sessions.push({ id: `${variant.id}-${task.id}-1`, role: 'subject', status: 'NOT_RUN', evidenceDir: join(root, 'cases', variant.id, task.id, '1') });
  for (const task of manifest.tasks) for (const round of plan.judgePlans.find(j => j.taskId === task.id)!.rounds) outcome.sessions.push({ id: `judge-skill-${task.id}-1-${round.dirName}`, role: 'judge', status: 'NOT_RUN', evidenceDir: join(root, 'judges', `skill-${task.id}-1`, round.dirName) });
  const persist = () => {
    outcome.ledger = budget.snapshot();
    const tmp = join(root, '.control-status.tmp');
    writeFileSync(tmp, JSON.stringify(outcome, null, 2), { mode: 0o600 });
    const file = openSync(tmp, 'r');
    try { fsyncSync(file); } finally { closeSync(file); }
    renameSync(tmp, join(root, 'control-status.json'));
    const directory = openSync(root, 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  };
  if (catalogHashes) writeFileSync(join(root, 'model-catalog-lock.json'), JSON.stringify({ schemaVersion: 1, files: catalogHashes, lockedAt: new Date().toISOString(), scope: 'Same source catalog bytes for every controlled subject and judge session' }, null, 2), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(root, 'controlled-execution.json'), JSON.stringify({ ...positiveProbePublicDescription(descriptor), evidenceLevel, catalogLockFile: catalogHashes ? 'model-catalog-lock.json' : null, executionAuthorized: evidenceLevel === 'real-provider', createdAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
  persist();
  const invoke = async (id: string, prompt: string, skillPaths: string[], role: 'subject' | 'judge') => {
    const record = outcome.sessions.find(s => s.id === id)!;
    record.status = 'RUNNING'; mkdirSync(record.evidenceDir, { recursive: true, mode: 0o700 }); persist();
    const workspace = join(record.evidenceDir, 'workspace'); mkdirSync(workspace, { mode: 0o700 });
    let run: PiRunResult;
    try {
      run = await adapter({ workspaceRoot: workspace, sessionId: id, prompt, skillPaths,
        model: role === 'subject' ? plan.model : plan.judgeModel, role, home: plan.home, budget,
        timeoutMs: role === 'subject' ? plan.settings.timeoutMs : plan.settings.judgeTimeoutMs, onLedger: persist, catalogHashes });
    } catch (error) {
      record.status = 'FAILED';
      writeFileSync(join(record.evidenceDir, 'result.json'), JSON.stringify({ status: 'failed', assertions: null, activation: null, evidenceLevel, error: 'ADAPTER_ABORTED' }, null, 2), { flag: 'wx', mode: 0o600 });
      persist(); throw error;
    }
    // Prompt is intentionally outside the subject workspace; judge materials stay controller-only.
    writeFileSync(join(record.evidenceDir, 'prompt.md'), prompt, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(record.evidenceDir, 'output.md'), run.metrics.output, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(record.evidenceDir, 'events.json'), JSON.stringify(run.events, null, 2), { flag: 'wx', mode: 0o600 });
    writeFileSync(join(record.evidenceDir, 'session.json'), JSON.stringify(run, null, 2), { flag: 'wx', mode: 0o600 });
    const error = run.exitCode !== 0 || run.timedOut || !run.isolation.verified || !run.metrics.output.trim() || run.events.some(e => e.type === 'tool_execution_end' && e.isError === true);
    record.status = error ? 'FAILED' : 'PASS'; persist();
    if (error) {
      writeFileSync(join(record.evidenceDir, 'result.json'), JSON.stringify({ status: 'failed', assertions: null, activation: null, evidenceLevel }, null, 2), { flag: 'wx', mode: 0o600 });
      throw new Error(`Session failed: ${id}`);
    }
    return run;
  };
  try {
    for (const variant of manifest.variants) for (const task of manifest.tasks) {
      const id = `${variant.id}-${task.id}-1`;
      const prompt = [manifest.contextPrefix, task.prompt].filter(Boolean).join('\n\n');
      const run = await invoke(id, prompt, variant.skillPaths, 'subject');
      const activation = detectActivation({ skillPaths: variant.skillPaths, readPaths: run.metrics.readPaths, output: run.metrics.output, keywordSignal: false });
      const assertions = run.metrics.output.trim() ? evaluateAssertions(run.metrics.output, task.assertions ?? []) : null;
      subjects.set(`${variant.id}/${task.id}`, { run, assertions });
      const evidenceDir = outcome.sessions.find(s => s.id === id)!.evidenceDir;
      writeFileSync(join(evidenceDir, 'result.json'), JSON.stringify({ activation, assertions, evidenceLevel }, null, 2), { flag: 'wx', mode: 0o600 });
      if (variant.id === 'skill' && (!activation.activated || !successfulControlScript(run.events, join(dirname(candidate.skillPath), 'scripts', 'control.py'), manifest.tasks.indexOf(task) === 0 ? 'sum' : 'digest', task, run.metrics.output) || !assertions?.allPassed)) {
        outcome.sessions.find(s => s.id === id)!.status = 'FAILED';
        throw new Error(`Positive control evidence failed: ${task.id}`);
      }
    }
    const contrast = manifest.tasks.filter(task => !subjects.get(`baseline/${task.id}`)!.assertions?.allPassed);
    if (!contrast.length) throw new Error('No planted baseline contrast detected');
    for (const task of manifest.tasks) {
      const baseline = subjects.get(`baseline/${task.id}`)!.run;
      const variant = subjects.get(`skill/${task.id}`)!.run;
      const taskPlan = plan.judgePlans.find(j => j.taskId === task.id)!;
      const judgments: JudgeResult[] = [];
      for (const round of taskPlan.rounds) {
        const id = `judge-skill-${task.id}-1-${round.dirName}`;
        const record = outcome.sessions.find(s => s.id === id)!;
        const options: JudgeOptions = { judgeDir: record.evidenceDir, runId: id, task: task.prompt, expectedPoints: task.expectedPoints, rubric: task.rubric,
          outputA: round.swapped ? variant.metrics.output : baseline.metrics.output,
          outputB: round.swapped ? baseline.metrics.output : variant.metrics.output,
          sourceIdentifiers: [root, descriptor.sourcePackage, candidate.skillPath, 'Synthetic calibration', 'synthetic-calibration', 'data-analysis', plan.runId, ...variant.metrics.readPaths],
          swapped: round.swapped, roundIndex: round.roundIndex, model: plan.judgeModel };
        const run = await invoke(id, buildJudgePrompt(options), [], 'judge');
        const parsed = parseJudgeResponse(run.metrics.output, options);
        const judged = { ...reconcileJudgeRun(parsed, round.swapped), swapped: round.swapped, roundIndex: round.roundIndex, protocolVersion: JUDGE_PROTOCOL_VERSION, semanticsStatus: 'explicit' as const };
        judgments.push(judged);
        writeFileSync(join(record.evidenceDir, 'judgment.json'), JSON.stringify(judged, null, 2), { flag: 'wx', mode: 0o600 });
        record.status = 'FAILED';
        if (!validRawJudge(run.metrics.output) || judged.error || judged.verdict === 'not_judged' || judged.verdict === 'loss' || judged.labelConflict || judged.scoreA === null || judged.scoreB === null || judged.confidence === null || !judged.reason.trim()) throw new Error(`Invalid or reverse judge result: ${id}`);
        if (contrast.some(t => t.id === task.id) && judged.verdict !== 'win') throw new Error(`Judge did not detect planted contrast: ${id}`);
        if (judgments.length === 2 && judgments[0]!.verdict !== judged.verdict) throw new Error(`Forward/reverse judge disagreement: ${task.id}`);
        record.status = 'PASS';
      }
    }
    const finalLedger = budget.snapshot();
    assert.equal(finalLedger.state, 'open', 'Budget stopped');
    assert.equal(finalLedger.reservedNanoUsd, 0, 'Pending HTTP reservation');
    assert.equal(finalLedger.sessions.length, 8, 'Incomplete session ledger');
    assert.equal(finalLedger.sessions.filter(s => s.role === 'subject').length, 4);
    assert.equal(finalLedger.sessions.filter(s => s.role === 'judge').length, 4);
    assert(finalLedger.sessions.every(s => s.state === 'completed'), 'Unfinished ledger session');
    assert.deepEqual(finalLedger.sessions.map(s => s.id), outcome.sessions.map(s => s.id), 'Session ledger order mismatch');
    assert(finalLedger.chargedNanoUsd <= POSITIVE_BUDGET_POLICY.maxNanoUsd);
    outcome.status = 'PASS';
  } catch (error) {
    outcome.status = 'STOPPED';
    outcome.reason = error instanceof Error ? error.message : 'Controlled probe stopped';
    try { budget.stop(outcome.reason); } catch { /* stop already recorded */ }
    for (const session of outcome.sessions) if (session.status === 'RUNNING') session.status = 'FAILED';
  } finally { persist(); }
  return outcome;
}
