import type { Command, Reply } from './contracts.ts';

export function serialisePedalRequests(send: (command: Command) => Promise<Reply>) {
  let pending = Promise.resolve();
  return (command: Command) => {
    const reply = pending.then(() => send(command));
    pending = reply.then(() => {}, () => {});
    return reply;
  };
}
