// The focus view as pure state. The server stores FocusState and writes the
// thread list's `hiddenGroups` preference from it.

/** Threads that belong to no project; a focus view moves them into More too. */
export const LOOSE_THREADS = 'threads';
const PROJECT = 'project:';

export interface FocusState {
  /** Projects every focus view shows. */
  alwaysShow: string[];
  /** Projects picked for the view, in the order they were added. Kept while the view is off. */
  members: string[];
  /** `hiddenGroups` from before the view started, or null while the view is off. */
  restore: string[] | null;
}

export const initialState: FocusState = { alwaysShow: [], members: [], restore: null };

const add = (ids: string[], id: string) => ids.includes(id) ? ids : [...ids, id];
const remove = (ids: string[], id: string) => ids.filter(other => other !== id);

export const isActive = (state: FocusState) => state.restore !== null;

/**
 * Turns the view on with the picked projects. With none picked, it picks
 * `projectId`, or shows the always-shown projects alone. A running view is kept.
 */
export function start(state: FocusState, currentHidden: string[], projectId: string | null): FocusState {
  if (isActive(state)) return state;
  const members = state.members.length > 0 || !projectId ? state.members : [projectId];
  return { ...state, members, restore: currentHidden };
}

/** Turns the view off and returns the `hiddenGroups` to write back, or null when it was off. */
export function stop(state: FocusState): { state: FocusState; restore: string[] | null } {
  return { state: { ...state, restore: null }, restore: state.restore };
}

/** Ticking a project while the view is off turns it on. */
export function setMember(state: FocusState, currentHidden: string[], projectId: string, included: boolean): FocusState {
  const members = included ? add(state.members, projectId) : remove(state.members, projectId);
  const next = { ...state, members };
  return included && !isActive(state) ? start(next, currentHidden, null) : next;
}

export function setAlwaysShow(state: FocusState, projectId: string, on: boolean): FocusState {
  return { ...state, alwaysShow: on ? add(state.alwaysShow, projectId) : remove(state.alwaysShow, projectId) };
}

export function isVisible(state: FocusState, projectId: string): boolean {
  return state.alwaysShow.includes(projectId) || state.members.includes(projectId);
}

/**
 * The `hiddenGroups` a running view needs: every project not shown, plus loose
 * threads. Non-project groups the user had hidden, such as sections, stay hidden.
 * Null while the view is off.
 */
export function hiddenGroups(state: FocusState, projectIds: readonly string[]): string[] | null {
  if (!state.restore) return null;
  const kept = state.restore.filter(group => !group.startsWith(PROJECT) && group !== LOOSE_THREADS);
  const projects = projectIds.filter(id => !isVisible(state, id)).map(id => `${PROJECT}${id}`);
  return [...kept, LOOSE_THREADS, ...projects];
}
