type Destination = { threadId: string | null; projectId: string | null };
const same = (a: Destination, b: Destination) => a.threadId === b.threadId && a.projectId === b.projectId;

export function createNavigationHistory(initial: Destination) {
  let current = initial;
  let pending: Destination | null = null;
  let stack: Destination[] = [];
  return {
    observe(destination: Destination) {
      if (same(current, destination)) return;
      if (pending && same(pending, destination)) stack.pop();
      else stack = [...stack, current].slice(-20);
      current = destination;
      pending = null;
    },
    back() {
      pending = stack.at(-1) ?? null;
      return pending;
    },
  };
}
