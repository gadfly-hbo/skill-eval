#!/usr/bin/env node
/** Separate entry: never selected by ordinary eval/archive. */
import { describePositiveProbe, executePositiveProbe, positiveProbePublicDescription, verifyPositiveProbeReadiness } from '../core/positive-probe.ts';

const args = process.argv.slice(2);
try {
  if (args.some(arg => !['--execute', '--authorize-real-provider', '--verify-runtime'].includes(arg))) throw new Error('Unknown option; no model/task/path overrides are accepted');
  const execute = args.includes('--execute');
  const authorized = args.includes('--authorize-real-provider');
  if (args.includes('--verify-runtime') && (execute || authorized)) throw new Error('--verify-runtime is read-only and cannot be combined with execution flags');
  if (execute !== authorized) throw new Error('Execution requires both --execute and --authorize-real-provider');
  if (execute) {
    const result = await executePositiveProbe({ executionAuthorized: true });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } else if (args.includes('--verify-runtime')) process.stdout.write(JSON.stringify(await verifyPositiveProbeReadiness(describePositiveProbe()), null, 2) + '\n');
  else process.stdout.write(JSON.stringify(positiveProbePublicDescription(describePositiveProbe()), null, 2) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Controlled positive entry blocked') + '\n');
  process.exitCode = 1;
}
