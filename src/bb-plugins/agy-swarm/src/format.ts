import type { WorkerStep } from '../contracts.ts';

/** Parse ISO-8601 or UTC "YYYY-MM-DD HH:MM:SS" strings into epoch ms. */
export function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function formatRelativeTime(value: string | null | undefined, nowMs = Date.now()): string | null {
  const ms = parseTimestampMs(value);
  if (ms === null) return null;
  const deltaSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (deltaSec < 15) return 'just now';
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Strip status tags, backticks, and redundant leading @coordinator from a single-line preview. */
export function cleanBoardPreview(raw: string): string {
  return raw
    .replace(/^(?:@coordinator\s+)+/iu, '')
    .replace(/(?:^|\s)\[(?:done|stall)\]\s*/giu, m => (m.startsWith(' ') ? ' ' : ''))
    .replace(/`([^`\n]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

export interface PairedToolCall {
  name: string;
  argsPreview: string | null;
  result: {
    stepIndex: number;
    status: string;
    failed: boolean;
    text: string | null;
    time: string | null;
  } | null;
}

export interface GroupedWorkerStep {
  stepIndex: number;
  time: string | null;
  source: string;
  type: string;
  status: string;
  failed: boolean;
  thinking: string | null;
  text: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCalls: PairedToolCall[];
}

function isErrorStatus(status: string, type: string): boolean {
  const upper = status.toUpperCase();
  return upper === 'ERROR' || upper === 'FAILED' || type === 'ERROR';
}

/**
 * Pairs each PLANNER_RESPONSE's tool calls with the immediately following GENERIC
 * model tool-output steps (in chronological order), then returns turns newest-first
 * so debugging starts at the latest turn while preserving call -> result causality.
 */
export function groupWorkerSteps(steps: readonly WorkerStep[], showSystem: boolean): GroupedWorkerStep[] {
  const chronological: GroupedWorkerStep[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i]!;
    if (!showSystem && step.type === 'SYSTEM_MESSAGE') {
      i += 1;
      continue;
    }

    if (step.type === 'PLANNER_RESPONSE' && step.toolCalls.length > 0) {
      const paired: PairedToolCall[] = step.toolCalls.map(call => ({
        name: call.name,
        argsPreview: call.argsPreview,
        result: null,
      }));
      let consumed = 0;
      let cursor = i + 1;
      while (cursor < steps.length && consumed < paired.length) {
        const next = steps[cursor]!;
        if (next.source === 'MODEL' && next.type === 'GENERIC') {
          paired[consumed]!.result = {
            stepIndex: next.stepIndex,
            status: next.status,
            failed: isErrorStatus(next.status, next.type),
            text: next.text,
            time: next.time,
          };
          consumed += 1;
          cursor += 1;
        } else {
          break;
        }
      }
      chronological.push({
        stepIndex: step.stepIndex,
        time: step.time,
        source: step.source,
        type: step.type,
        status: step.status,
        failed: isErrorStatus(step.status, step.type),
        thinking: step.thinking,
        text: step.text,
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens,
        toolCalls: paired,
      });
      i = cursor;
      continue;
    }

    chronological.push({
      stepIndex: step.stepIndex,
      time: step.time,
      source: step.source,
      type: step.type,
      status: step.status,
      failed: isErrorStatus(step.status, step.type),
      thinking: step.thinking,
      text: step.text,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      toolCalls: step.toolCalls.map(call => ({
        name: call.name,
        argsPreview: call.argsPreview,
        result: null,
      })),
    });
    i += 1;
  }
  return chronological.reverse();
}
