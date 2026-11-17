// Proves a real BB workflow worker can call a read-only connector tool through this plugin.
// Unit tests cannot cover the wiring: owner lookup, inherited profile, turn routing.
// Run inside a BB thread that has a profile picked:
//   pnpm selftest <connector> <read-only tool> ['<arguments JSON>']
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [connector, tool, rawArgs = '{}'] = process.argv.slice(2);
if (!connector || !tool) {
  console.error('Usage: pnpm selftest <connector> <read-only tool> [\'<arguments JSON>\']');
  process.exit(2);
}

const bb = async (...argv: string[]) => JSON.parse((await promisify(execFile)('bb', argv, { maxBuffer: 4 * 1024 * 1024 })).stdout);

const source = `export const meta = {
  name: 'claude-connectors-selftest',
  description: 'One workflow worker calls one read-only Claude connector tool',
  phases: [{ title: 'Call' }],
};
phase('Call');
return await agent(\`This is an access test. Do exactly these two steps and nothing else. Do not retry.
1. Call claude_connectors_list with {"connector": \${JSON.stringify(args.connector)}}. Note the "access" value shown for the tool \${JSON.stringify(args.tool)}.
2. Call claude_connectors_call with connector \${JSON.stringify(args.connector)}, tool \${JSON.stringify(args.tool)} and arguments \${JSON.stringify(args.arguments)}.
Report the access value from step 1, whether step 2 returned an error, and the exact error text if it did.\`, {
  label: 'worker', phase: 'Call',
  schema: {
    type: 'object', additionalProperties: false, required: ['listedAccess', 'callFailed', 'error'],
    properties: { listedAccess: { type: 'string' }, callFailed: { type: 'boolean' }, error: { type: ['string', 'null'] } },
  },
});`;

const started = await bb('workflows', 'run', '--script', source, '--json',
  '--args', JSON.stringify({ connector, tool, arguments: JSON.parse(rawArgs) }));
const runId: string = started.runId;
console.log(`Started ${runId}`);

const deadline = Date.now() + 10 * 60_000;
let status: { status: string; result?: unknown; error?: unknown };
do {
  await new Promise(resolve => setTimeout(resolve, 5_000));
  status = await bb('workflows', 'status', runId, '--json');
} while (['queued', 'running'].includes(status.status) && Date.now() < deadline);

const result = status.result as { listedAccess?: string; callFailed?: boolean; error?: string | null } | undefined;
const passed = status.status === 'succeeded' && result?.listedAccess === 'allow' && result.callFailed === false;
console.log(JSON.stringify({ runId, status: status.status, result, error: status.error }, null, 2));
console.log(passed ? 'PASS: the worker listed the tool as allowed and the call went through.' : 'FAIL');
process.exit(passed ? 0 : 1);
