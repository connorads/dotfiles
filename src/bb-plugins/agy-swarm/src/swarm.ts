import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardMessage, MemberState, SwarmMember, SwarmPlan, SwarmSnapshot, WorkerLogResult, WorkerStep } from '../contracts.ts';

const accountPrefix = 'acp-antigravity-profile-';
const accountNameRe = /^[a-z][a-z0-9-]{0,31}$/u;
const sessionIdRe = /^[0-9a-f-]{8,64}$/iu;
const mentionRe = /(?:^|[\s(])@([a-z0-9][a-z0-9_-]{0,31})/giu;
const maxJsonBytes = 512 * 1024;
const maxBoardBytes = 2 * 1024 * 1024;
const transcriptTailBytes = 192 * 1024;
const maxLogSteps = 80;
const maxBoardMessages = 400;

export function isAntigravityProvider(providerId: string | null | undefined): boolean {
  if (!providerId) return false;
  if (providerId === 'acp-antigravity') return true;
  if (!providerId.startsWith(accountPrefix)) return false;
  const id = providerId.slice(accountPrefix.length);
  return id !== 'default' && accountNameRe.test(id);
}

export function antigravityAppDataRoot(home: string, providerId: string): string | null {
  if (providerId === 'acp-antigravity') return join(home, '.gemini', 'antigravity-cli');
  if (!providerId.startsWith(accountPrefix)) return null;
  const id = providerId.slice(accountPrefix.length);
  if (id === 'default' || !accountNameRe.test(id)) return null;
  return join(home, '.local', 'share', 'agy-profiles', id, 'home', '.gemini', 'antigravity-cli');
}

function safeSessionPath(appData: string, sessionId: string, ...parts: string[]): string | null {
  if (!sessionIdRe.test(sessionId)) return null;
  return join(appData, 'brain', sessionId, ...parts);
}

async function readTextBounded(path: string, limit: number): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    if (info.size <= limit) return await readFile(path, 'utf8');
    const fh = await open(path, 'r');
    try {
      const start = Math.max(0, info.size - limit);
      const buf = Buffer.allocUnsafe(info.size - start);
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      const text = buf.subarray(0, bytesRead).toString('utf8');
      const nl = text.indexOf('\n');
      return nl >= 0 ? text.slice(nl + 1) : text;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  const raw = await readTextBounded(path, maxJsonBytes);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(mentionRe)) {
    const name = match[1]?.toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function parseBoard(raw: string): BoardMessage[] {
  const out: BoardMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      const seq = typeof obj.seq === 'number' && Number.isFinite(obj.seq) && obj.seq >= 0 ? Math.floor(obj.seq) : out.length + 1;
      const agent = typeof obj.agent === 'string' && obj.agent.trim() ? obj.agent.trim() : 'unknown';
      const text = typeof obj.text === 'string' ? obj.text : '';
      const time = typeof obj.time === 'string' ? obj.time : null;
      const kind = typeof obj.kind === 'string' ? obj.kind : null;
      const channel = typeof obj.channel === 'string' && obj.channel.trim() ? obj.channel.trim() : 'main';
      const isDone = /(?:^|\s)\[done\]/iu.test(text);
      const isStall = /(?:^|\s)\[stall\]/iu.test(text);
      out.push({ seq, agent, text, time, kind, channel, mentions: extractMentions(text), isDone, isStall });
    } catch {
      // Ignore a torn trailing line while agy appends.
    }
  }
  return out;
}

function parsePlan(obj: Record<string, unknown> | null): SwarmPlan | null {
  if (!obj) return null;
  const goal = obj.goal && typeof obj.goal === 'object' && !Array.isArray(obj.goal) ? (obj.goal as Record<string, unknown>) : null;
  const goalTitle = typeof goal?.title === 'string' && goal.title.trim() ? goal.title.trim() : null;
  const goalLine = typeof goal?.line === 'string' && goal.line.trim() ? goal.line.trim() : null;
  const tasks: Record<string, string> = {};
  if (obj.tasks && typeof obj.tasks === 'object' && !Array.isArray(obj.tasks)) {
    for (const [k, v] of Object.entries(obj.tasks as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) tasks[k] = v.trim();
    }
  }
  const threads: SwarmPlan['threads'] = [];
  if (Array.isArray(obj.threads)) {
    for (const item of obj.threads) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const t = item as Record<string, unknown>;
      const id = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : `t-${threads.length + 1}`;
      const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : id;
      const threadGoal = typeof t.goal === 'string' && t.goal.trim() ? t.goal.trim() : null;
      const threadTasks = Array.isArray(t.tasks) ? t.tasks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
      threads.push({ id, title, goal: threadGoal, tasks: threadTasks });
    }
  }
  if (!goalTitle && !goalLine && Object.keys(tasks).length === 0 && threads.length === 0) return null;
  return { goalTitle, goalLine, tasks, threads };
}

interface RawStep {
  stepIndex: number;
  time: string | null;
  source: string;
  type: string;
  status: string;
  model: string | null;
  toolCalls: { name: string; argsPreview: string | null }[];
  text: string | null;
  thinking: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

function summarizeArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const entries = Object.entries(args as Record<string, unknown>).slice(0, 3);
  if (entries.length === 0) return null;
  const text = entries.map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    const short = val && val.length > 64 ? `${val.slice(0, 61)}…` : val;
    return `${k}: ${short ?? ''}`;
  }).join(', ');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function parseTranscriptSteps(raw: string | null): { totalSteps: number; steps: RawStep[] } {
  if (!raw) return { totalSteps: 0, steps: [] };
  const steps: RawStep[] = [];
  let maxIndex = -1;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      const stepIndex = typeof obj.step_index === 'number' && Number.isFinite(obj.step_index) && obj.step_index >= 0
        ? Math.floor(obj.step_index) : steps.length;
      if (stepIndex > maxIndex) maxIndex = stepIndex;
      const rawCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
      const toolCalls = rawCalls
        .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object' && !Array.isArray(c))
        .map(c => ({
          name: typeof c.name === 'string' ? c.name : 'tool',
          argsPreview: summarizeArgs(c.args),
        }));
      const text = clip(obj.response ?? obj.content ?? obj.error ?? obj.message, 600);
      const thinking = clip(obj.thinking, 280);
      steps.push({
        stepIndex,
        time: typeof obj.created_at === 'string' ? obj.created_at : null,
        source: typeof obj.source === 'string' ? obj.source : 'UNKNOWN',
        type: typeof obj.type === 'string' ? obj.type : 'UNKNOWN',
        status: typeof obj.status === 'string' ? obj.status : 'UNKNOWN',
        model: typeof obj.model === 'string' ? obj.model : null,
        toolCalls,
        text,
        thinking,
        inputTokens: typeof obj.input_tokens === 'number' ? Math.max(0, Math.floor(obj.input_tokens)) : null,
        outputTokens: typeof obj.output_tokens === 'number' ? Math.max(0, Math.floor(obj.output_tokens)) : null,
      });
    } catch {
      // Ignore torn trailing line.
    }
  }
  const totalSteps = maxIndex >= 0 ? Math.max(maxIndex + 1, steps.length) : steps.length;
  return { totalSteps, steps };
}

function deriveMemberRuntime(input: {
  name: string;
  killed: boolean;
  wakeMode: string;
  steps: RawStep[];
  messages: BoardMessage[];
}): { state: MemberState; activity: string | null; lastActiveAt: string | null } {
  const { name, killed, wakeMode, steps, messages } = input;
  const lastStep = steps.at(-1) ?? null;
  const lastActiveAt = lastStep?.time ?? null;
  const postedDone = messages.some(m => m.agent === name && m.isDone);
  const lastPost = [...messages].reverse().find(m => m.agent === name) ?? null;

  if (killed) return { state: 'killed', activity: 'Killed', lastActiveAt };

  if (lastStep) {
    const statusUpper = lastStep.status.toUpperCase();
    if (statusUpper === 'ERROR' || statusUpper === 'FAILED' || lastStep.type === 'ERROR') {
      return { state: 'error', activity: lastStep.text ? clip(lastStep.text, 90) : 'Turn failed', lastActiveAt };
    }
    if (statusUpper === 'RUNNING' || statusUpper === 'PENDING' || statusUpper === 'IN_PROGRESS') {
      const runningTool = lastStep.toolCalls.at(-1)?.name;
      return { state: 'working', activity: runningTool ? `Running ${runningTool}` : 'Working…', lastActiveAt };
    }

    // Find the newest planner step to see whether the member parked or is mid-turn.
    let lastPlannerIdx = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i]!.type === 'PLANNER_RESPONSE') {
        lastPlannerIdx = i;
        break;
      }
    }
    if (lastPlannerIdx >= 0) {
      const planner = steps[lastPlannerIdx]!;
      const afterPlanner = steps.slice(lastPlannerIdx + 1);
      const hasSystemWakeAfter = afterPlanner.some(s => s.source === 'SYSTEM' && s.type === 'SYSTEM_MESSAGE');
      if (hasSystemWakeAfter) {
        return { state: 'working', activity: 'Woken by new board post…', lastActiveAt };
      }
      const calledSwarmWait = planner.toolCalls.some(c => c.name === 'swarm_wait');
      const hasNoTools = planner.toolCalls.length === 0;
      const toolResultsAfter = afterPlanner.filter(s => s.source === 'MODEL' && s.type !== 'PLANNER_RESPONSE');
      const waitedAndDone = calledSwarmWait && toolResultsAfter.length >= planner.toolCalls.length;

      if (!hasNoTools && !waitedAndDone) {
        const lastTool = planner.toolCalls.at(-1)?.name ?? 'tool';
        return { state: 'working', activity: `Running ${lastTool}`, lastActiveAt };
      }
      if (postedDone) {
        return { state: 'done', activity: lastPost ? `Done · #${lastPost.seq}` : 'Done', lastActiveAt };
      }
      return {
        state: 'waiting',
        activity: wakeMode === 'any' ? 'Waiting for any post' : 'Waiting for @mentions',
        lastActiveAt,
      };
    }
    if (lastStep.source === 'SYSTEM') {
      return { state: 'working', activity: 'Starting turn…', lastActiveAt };
    }
  }

  if (postedDone) return { state: 'done', activity: lastPost ? `Done · #${lastPost.seq}` : 'Done', lastActiveAt };
  return { state: 'waiting', activity: wakeMode === 'any' ? 'Waiting for any post' : 'Waiting for @mentions', lastActiveAt };
}

interface ParsedMembersFile {
  title: string | null;
  entries: [string, Record<string, unknown>][];
}

function parseMembersFile(obj: Record<string, unknown> | null): ParsedMembersFile | null {
  if (!obj || !obj.members || typeof obj.members !== 'object' || Array.isArray(obj.members)) return null;
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : null;
  const entries: [string, Record<string, unknown>][] = [];
  for (const [name, raw] of Object.entries(obj.members as Record<string, unknown>)) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      entries.push([name, raw as Record<string, unknown>]);
    }
  }
  return { title, entries };
}

export async function loadSwarmSnapshot(home: string, providerId: string, sessionId: string): Promise<SwarmSnapshot> {
  const appData = antigravityAppDataRoot(home, providerId);
  if (!appData) return { kind: 'unsupported', providerId };
  const swarmDir = safeSessionPath(appData, sessionId, '.system_generated', 'swarm');
  if (!swarmDir) return { kind: 'none', providerId, sessionId };

  const [swarmMeta, membersRaw, planRaw, boardRaw] = await Promise.all([
    readJsonFile(join(swarmDir, 'swarm.json')),
    readJsonFile(join(swarmDir, 'members.json')),
    readJsonFile(join(swarmDir, 'plan.json')),
    readTextBounded(join(swarmDir, 'board.jsonl'), maxBoardBytes),
  ]);

  const parsedMembers = parseMembersFile(membersRaw);
  if (!swarmMeta && !parsedMembers && !boardRaw) {
    return { kind: 'none', providerId, sessionId };
  }

  const allMessages = boardRaw ? parseBoard(boardRaw) : [];
  const boardHead = allMessages.reduce((max, m) => Math.max(max, m.seq), 0);
  const channelSet = new Set<string>(['main']);
  for (const m of allMessages) channelSet.add(m.channel);

  const memberList: SwarmMember[] = await Promise.all(
    (parsedMembers?.entries ?? []).map(async ([name, data]) => {
      const conversationId = typeof data.conversation_id === 'string' ? data.conversation_id : '';
      const role = typeof data.role === 'string' && data.role.trim() ? data.role.trim() : (name === 'coordinator' ? 'coordinator' : 'worker');
      const model = typeof data.applied_model === 'string' && data.applied_model
        ? data.applied_model
        : typeof data.model === 'string' && data.model
          ? data.model
          : null;
      const workspaceMode = typeof data.workspace_mode === 'string' && data.workspace_mode ? data.workspace_mode : 'inherit';
      const wakeMode = typeof data.wake_mode === 'string' && data.wake_mode ? data.wake_mode : 'mentions';
      const killed = data.killed === true;
      const lastReadSeq = typeof data.last_read_seq === 'number' && Number.isFinite(data.last_read_seq) ? Math.floor(data.last_read_seq) : 0;

      const transcriptPath = conversationId ? safeSessionPath(appData, conversationId, '.system_generated', 'logs', 'transcript.jsonl') : null;
      const transcriptRaw = transcriptPath ? await readTextBounded(transcriptPath, transcriptTailBytes) : null;
      const { totalSteps, steps } = parseTranscriptSteps(transcriptRaw);
      const runtime = deriveMemberRuntime({ name, killed, wakeMode, steps, messages: allMessages });

      return {
        name,
        conversationId,
        role,
        model,
        workspaceMode,
        wakeMode,
        state: runtime.state,
        activity: runtime.activity,
        stepCount: totalSteps,
        unreadCount: Math.max(0, boardHead - lastReadSeq),
        lastActiveAt: runtime.lastActiveAt,
        killed,
      };
    }),
  );

  // Coordinator first, then workers, then helper roles (monitor/narrator).
  const rank = (m: SwarmMember) => (m.role === 'coordinator' ? 0 : m.role === 'worker' ? 1 : 2);
  memberList.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const taskWorkers = memberList.filter(m => m.role === 'worker');
  const workingWorkers = taskWorkers.filter(m => m.state === 'working').length;
  const doneWorkers = taskWorkers.filter(m => m.state === 'done').length;
  const errorWorkers = taskWorkers.filter(m => m.state === 'error').length;
  const coordinatorWorking = memberList.some(m => m.role === 'coordinator' && m.state === 'working');

  const plan = parsePlan(planRaw);
  const title = parsedMembers?.title ?? plan?.goalTitle ?? null;
  const swarmId = typeof swarmMeta?.swarm_id === 'string' ? swarmMeta.swarm_id : sessionId;
  const createdAt = typeof swarmMeta?.created_at === 'string' ? swarmMeta.created_at : null;

  return {
    kind: 'swarm',
    providerId,
    sessionId,
    swarmId,
    title,
    createdAt,
    boardHead,
    channels: [...channelSet],
    plan,
    members: memberList,
    messages: allMessages.slice(-maxBoardMessages),
    summary: {
      totalWorkers: taskWorkers.length,
      workingWorkers,
      doneWorkers,
      errorWorkers,
      active: workingWorkers > 0 || coordinatorWorking,
    },
  };
}

export async function loadWorkerLog(home: string, providerId: string, sessionId: string, memberName: string): Promise<WorkerLogResult> {
  const appData = antigravityAppDataRoot(home, providerId);
  if (!appData) return { ok: false, reason: 'Not an Antigravity provider.' };
  const swarmDir = safeSessionPath(appData, sessionId, '.system_generated', 'swarm');
  if (!swarmDir) return { ok: false, reason: 'Invalid session ID.' };

  const members = parseMembersFile(await readJsonFile(join(swarmDir, 'members.json')));
  const entry = members?.entries.find(([name]) => name === memberName);
  if (!entry) return { ok: false, reason: `Swarm member "${memberName}" not found.` };

  const conversationId = typeof entry[1].conversation_id === 'string' ? entry[1].conversation_id : '';
  const transcriptPath = conversationId ? safeSessionPath(appData, conversationId, '.system_generated', 'logs', 'transcript.jsonl') : null;
  if (!transcriptPath) return { ok: false, reason: 'Member transcript is unavailable.' };

  const raw = await readTextBounded(transcriptPath, transcriptTailBytes);
  if (!raw) return { ok: true, member: memberName, conversationId, totalSteps: 0, steps: [] };

  const { totalSteps, steps } = parseTranscriptSteps(raw);
  const recent: WorkerStep[] = steps.slice(-maxLogSteps);
  return { ok: true, member: memberName, conversationId, totalSteps, steps: recent };
}

async function statTag(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return `${Math.floor(info.mtimeMs)}:${info.size}`;
  } catch {
    return '-';
  }
}

export async function swarmFingerprint(home: string, providerId: string, sessionId: string): Promise<string | null> {
  const appData = antigravityAppDataRoot(home, providerId);
  if (!appData) return null;
  const swarmDir = safeSessionPath(appData, sessionId, '.system_generated', 'swarm');
  if (!swarmDir) return null;

  const coreTags = await Promise.all([
    statTag(join(swarmDir, 'swarm.json')),
    statTag(join(swarmDir, 'members.json')),
    statTag(join(swarmDir, 'plan.json')),
    statTag(join(swarmDir, 'board.jsonl')),
  ]);
  if (coreTags.every(tag => tag === '-')) return null;

  const members = parseMembersFile(await readJsonFile(join(swarmDir, 'members.json')));
  const memberTags = await Promise.all(
    (members?.entries ?? []).map(async ([name, data]) => {
      const convId = typeof data.conversation_id === 'string' ? data.conversation_id : '';
      const path = convId ? safeSessionPath(appData, convId, '.system_generated', 'logs', 'transcript.jsonl') : null;
      return `${name}=${path ? await statTag(path) : '-'}`;
    }),
  );
  return [...coreTags, ...memberTags].join('|');
}
