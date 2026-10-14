import type { Reply } from './contracts.ts';

export type Decision = 'allow_once' | 'allow_for_session' | 'deny';
type Permissions = { network?: { enabled?: boolean | null } | null; fileSystem?: { read: string[]; write: string[] } | null };
type Grant = { network: { enabled: boolean | null } | null; fileSystem: { read: string[]; write: string[] } | null };
type Subject = { kind: string; command?: string; sessionGrant?: Grant | null; permissions?: Permissions };
export type PendingApproval = {
  id: string;
  status: string;
  payload: { kind: 'approval'; availableDecisions: Decision[]; subject: Subject };
};
export type Resolution =
  | { decision: 'allow_once'; grantedPermissions: Grant | null }
  | { decision: 'allow_for_session'; grantedPermissions: Grant | null }
  | { decision: 'deny' };

export interface ApprovalPorts {
  list(threadId: string): Promise<readonly unknown[]>;
  resolve(threadId: string, interactionId: string, resolution: Resolution): Promise<void>;
}

const labels: Record<Decision, string> = { allow_once: 'Allowed once', allow_for_session: 'Allowed for session', deny: 'Denied' };

function pendingApproval(value: unknown): value is PendingApproval {
  const item = value as Partial<PendingApproval> | null;
  return item?.status === 'pending' && item.payload?.kind === 'approval';
}

// Mirrors the grants BB's approval card sends for the same button.
function grantedPermissions(subject: Subject, decision: Decision): Grant | null {
  if (subject.kind === 'permission_grant' && subject.permissions) {
    const { network, fileSystem } = subject.permissions;
    return {
      network: network?.enabled === true ? { enabled: true } : null,
      fileSystem: fileSystem ? { read: fileSystem.read, write: fileSystem.write } : null,
    };
  }
  if (decision === 'allow_for_session' && (subject.kind === 'command' || subject.kind === 'file_change')) {
    return subject.sessionGrant ?? null;
  }
  return null;
}

function describe(subject: Subject): string {
  if (subject.kind === 'command' && subject.command) return subject.command.length > 80 ? `${subject.command.slice(0, 79)}…` : subject.command;
  return subject.kind.replace('_', ' ');
}

export function makeApprovals(ports: ApprovalPorts) {
  return {
    async decide(threadId: string, decision: Decision): Promise<Reply> {
      const pending = (await ports.list(threadId)).filter(pendingApproval);
      if (pending.length === 0) return { ok: false, outcome: 'empty', message: 'No approval is waiting in this thread.' };
      if (pending.length > 1) return { ok: false, outcome: 'error', message: `${pending.length} approvals are waiting. Use the buttons.` };
      const [approval] = pending;
      const { subject, availableDecisions } = approval.payload;
      if (subject.kind === 'plan') return { ok: false, outcome: 'error', message: 'Use the buttons to approve or keep a plan.' };
      if (!availableDecisions.includes(decision)) return { ok: false, outcome: 'error', message: `${labels[decision]} is not available for this approval.` };
      const resolution: Resolution = decision === 'deny' ? { decision }
        : decision === 'allow_once' ? { decision, grantedPermissions: grantedPermissions(subject, decision) }
        : { decision, grantedPermissions: grantedPermissions(subject, decision) };
      await ports.resolve(threadId, approval.id, resolution);
      return { ok: true, outcome: 'completed', message: `${labels[decision]}: ${describe(subject)}` };
    },
  };
}
