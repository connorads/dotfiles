export interface Project {
  id: string;
  name: string;
  sources: readonly { hostId: string; path: string }[];
}
type Prepared = { ok: true; path: string; reused: boolean } | { ok: false; message: string };
interface Ports {
  prepare(repository: string, destination: string): Promise<Prepared>;
  listProjects(): Promise<readonly Project[]>;
  createProject(path: string, name: string): Promise<Project>;
}
type Opened = { ok: true; projectId: string; path: string }
  | { ok: false; stage: 'clone' | 'register'; message: string; path?: string };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function createOpener(ports: Ports, hostId: string) {
  const pending = new Map<string, Promise<Opened>>();
  async function perform(repository: string, destination: string): Promise<Opened> {
    let prepared: Prepared;
    try { prepared = await ports.prepare(repository, destination); }
    catch (cause) { return { ok: false, stage: 'clone', message: message(cause) }; }
    if (!prepared.ok) return { ...prepared, stage: 'clone' };
    const { path } = prepared;
    try {
      const projects = await ports.listProjects();
      const existing = projects.find(project => project.sources.some(source => source.hostId === hostId && source.path === path));
      const project = existing ?? await ports.createProject(path, repository.split('/')[1] ?? repository);
      return { ok: true, projectId: project.id, path };
    } catch (cause) {
      return { ok: false, stage: 'register', path, message: `Checkout kept at ${path}. ${message(cause)}` };
    }
  }
  return (repository: string, destination: string): Promise<Opened> => {
    const key = destination;
    const existing = pending.get(key);
    const job = (existing ? existing.then(() => perform(repository, destination)) : perform(repository, destination))
      .finally(() => { if (pending.get(key) === job) pending.delete(key); });
    pending.set(key, job);
    return job;
  };
}
