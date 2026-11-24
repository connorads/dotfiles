/** The thread fields the decision reads, a subset of the SDK's ThreadResponse. */
export type WorkerThread = {
  id: string;
  title: string | null;
  titleFallback?: string | null;
  visibility: string;
  originPluginId: string | null;
  lifecycleOwnerThreadId: string | null;
};

type Subject =
  | { kind: 'command'; command: string; cwd?: string | null }
  | { kind: 'file_change'; [key: string]: unknown }
  | { kind: 'permission_grant'; toolName?: string | null; [key: string]: unknown }
  | { kind: 'plan'; [key: string]: unknown }
  | { kind: 'tool_use'; title?: string; name?: string; [key: string]: unknown };

/** The interaction fields the decision reads, a subset of the SDK's PendingInteraction. */
export type PendingApproval = {
  id: string;
  payload: { kind: string; subject?: Subject; reason?: string | null };
};

export type Alert = {
  interactionId: string;
  workerThreadId: string;
  ownerThreadId: string;
  pushTitle: string;
  pushBody: string;
  ownerMessage: string;
};

const MAX_SUMMARY = 200;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY - 1)}…` : flat;
}

/** One line saying what the worker wants to do. */
export function summarise(subject: Subject | undefined): string {
  if (!subject) return 'an action';
  switch (subject.kind) {
    case 'command':
      return clip(subject.command);
    case 'file_change':
      return 'a file change';
    case 'permission_grant':
      return subject.toolName ? `permission for ${subject.toolName}` : 'a permission grant';
    case 'plan':
      return 'a plan';
    case 'tool_use':
      return clip(subject.title ?? subject.name ?? 'a tool call');
  }
}

/**
 * Hidden workflow workers have no parent thread, so BB sends their approval
 * prompts to nobody. Return an alert for those prompts only; visible threads
 * already reach the user through BB's own notifications.
 */
export function decide(thread: WorkerThread, interaction: PendingApproval): Alert | null {
  if (interaction.payload.kind !== 'approval') return null;
  if (thread.visibility !== 'hidden') return null;
  if (thread.originPluginId !== 'workflows') return null;
  const owner = thread.lifecycleOwnerThreadId;
  if (!owner) return null;

  const name = thread.title ?? thread.titleFallback ?? thread.id;
  const what = summarise(interaction.payload.subject);
  return {
    interactionId: interaction.id,
    workerThreadId: thread.id,
    ownerThreadId: owner,
    pushTitle: 'Workflow worker needs approval',
    pushBody: `${name}: ${what}`,
    ownerMessage: [
      `[worker-attention] Workflow worker @thread:${thread.id} (${name}) is waiting for approval and will not continue until someone answers.`,
      `It wants: ${what}`,
      'Tell the user, and point them to that thread to approve or deny it. Do not try to approve it yourself.',
    ].join('\n'),
  };
}
