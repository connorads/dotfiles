// Pure interpretation of git's remote-operation output. git runs with LC_ALL=C, so
// these English messages are stable: see transport.c, builtin/pull.c, progress.c.

export type OpKind = 'fetch' | 'pull' | 'push';
export type FailureReason =
  | 'auth' | 'cancelled' | 'conflict' | 'diverged' | 'dirty' | 'locked'
  | 'network' | 'no-remote' | 'rejected' | 'timeout' | 'unknown';
export interface Failure { reason: FailureReason; message: string }
export interface Progress { phase: string; percent: number | null }

/** Last progress line in a stderr chunk; git rewrites lines in place with `\r`. */
export function parseProgress(chunk: string): Progress | null {
  let latest: Progress | null = null;
  for (const raw of chunk.split(/[\r\n]/)) {
    const line = raw.replace(/^remote: /, '').trim();
    const match = /^([A-Za-z][\w ]*?):\s+(\d+)%/.exec(line);
    if (match) latest = { phase: match[1]!, percent: Number(match[2]) };
    else if (/^[A-Za-z][\w ]*?:\s+\d+(, done\.)?$/.test(line)) latest = { phase: line.split(':')[0]!, percent: null };
  }
  return latest;
}

const rules: [RegExp, FailureReason][] = [
  [/\[rejected\]|failed to push some refs|Updates were rejected/, 'rejected'],
  [/Not possible to fast-forward|Need to specify how to reconcile|have diverged/, 'diverged'],
  [/CONFLICT \(/, 'conflict'],
  [/local changes to the following files would be overwritten|untracked working tree files would be overwritten|Please commit your changes or stash them/, 'dirty'],
  [/index\.lock|Another git process seems to be running|cannot lock ref/, 'locked'],
  [/Authentication failed|could not read Username|could not read Password|terminal prompts disabled|Permission denied \(publickey|Host key verification failed|returned error: 403|Repository not found/, 'auth'],
  [/Could not resolve host|unable to access|Connection (timed out|refused|reset)|Could not read from remote repository|Network is unreachable|early EOF/, 'network'],
  [/No configured push destination|does not appear to be a git repository|No remote repository specified|There is no tracking information/, 'no-remote'],
];

/** The most specific reason git gave, with its last meaningful lines as the message. */
export function classifyFailure(output: string): Failure {
  const reason = rules.find(([pattern]) => pattern.test(output))?.[1] ?? 'unknown';
  const lines = output.split(/[\r\n]/).map(line => line.trim())
    .filter(line => line && !parseProgress(line) && !/^(To |From |Done$|hint: )/.test(line));
  const meaningful = lines.filter(line => /^(fatal|error|!|CONFLICT)/.test(line) || line.startsWith('\t'));
  return { reason, message: (meaningful.length ? meaningful : lines).slice(-3).join('\n') || 'git exited with an error.' };
}

export interface PushedRef { flag: string; from: string; to: string; summary: string }
/** `git push --porcelain` stdout: `<flag>\t<from>:<to>\t<summary>` per ref (git-push(1) OUTPUT). */
export function parsePushPorcelain(stdout: string): PushedRef[] {
  return stdout.split('\n').flatMap(line => {
    const match = /^([ +\-*!=])\t([^:]*):([^\t]*)\t(.*)$/.exec(line);
    return match ? [{ flag: match[1]!, from: match[2]!, to: match[3]!, summary: match[4]! }] : [];
  });
}

export const shortRef = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, '');
