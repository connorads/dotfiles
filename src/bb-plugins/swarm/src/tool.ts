import type { AddRequest } from './service.ts';

/** Arguments of the one `swarm` tool offered to threads that are not workers. */
export interface SwarmCall {
  action: 'add' | 'post' | 'read' | 'close';
  name?: string | undefined;
  brief?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  text?: string | undefined;
  since?: number | undefined;
}

export type Routed =
  | { action: 'add'; request: AddRequest }
  | { action: 'post'; text: string }
  | { action: 'read'; since: number | null }
  | { action: 'close'; summary: string }
  | { action: 'invalid'; text: string };

/** One tool carries four actions, so each action's required fields are checked here. */
export function route(call: SwarmCall): Routed {
  switch (call.action) {
    case 'add':
      if (!call.name || !call.brief) return { action: 'invalid', text: 'The add action needs `name` and `brief`.' };
      return { action: 'add', request: { name: call.name, brief: call.brief, provider: call.provider ?? null, model: call.model ?? null } };
    case 'post':
      if (!call.text) return { action: 'invalid', text: 'The post action needs `text`.' };
      return { action: 'post', text: call.text };
    case 'read':
      return { action: 'read', since: call.since ?? null };
    case 'close':
      return { action: 'close', summary: call.text ?? '' };
  }
}
