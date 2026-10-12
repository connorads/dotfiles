// Where skl runs. The tmux picker asks tmux for the origin pane and its cwd;
// here the composer's thread names an environment, which names a host and a
// checkout path. A composer with no thread yet (new-thread) falls back to the
// primary host and cannot install, because it has no project directory.

export type Target = { readonly hostId: string; readonly cwd: string | null };

export type TargetPorts = {
  threadEnvironmentId(threadId: string): Promise<string | null>;
  environment(environmentId: string): Promise<{ hostId: string; path: string | null }>;
  primaryHostId(): Promise<string | null>;
};

export async function resolveTarget(threadId: string | null, ports: TargetPorts): Promise<Target> {
  if (threadId) {
    const environmentId = await ports.threadEnvironmentId(threadId);
    if (environmentId) {
      const { hostId, path } = await ports.environment(environmentId);
      return { hostId, cwd: path };
    }
  }
  const hostId = await ports.primaryHostId();
  if (!hostId) throw new Error('No machine to run skl on: this server has no primary host.');
  return { hostId, cwd: null };
}
