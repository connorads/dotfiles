// Focus as pure state. The server stores FocusState and writes the thread
// list's `hiddenGroups` preference from it.

/** Threads that belong to no project; a focus view moves them into More too. */
export const LOOSE_THREADS = 'threads';
const PROJECT = 'project:';

export type Mask = 'off' | 'hide-rest';

export interface FocusSet {
  id: string;
  name: string;
  projects: string[];
  mask: Mask;
}

export interface ActiveView {
  setId: string;
  /** `hiddenGroups` from before any set was active. */
  restore: string[];
}

export interface FocusState {
  sets: FocusSet[];
  active: ActiveView | null;
  /** The set a double press returns to. */
  lastSetId: string | null;
}

export const initialState: FocusState = {
  sets: [{ id: 'demo', name: 'Demo', projects: [], mask: 'hide-rest' }],
  active: null,
  lastSetId: null,
};

const updateSet = (state: FocusState, setId: string, change: (set: FocusSet) => FocusSet): FocusState => ({
  ...state,
  sets: state.sets.map(set => set.id === setId ? change(set) : set),
});

/** Switching between sets keeps the original restore point. */
export function activate(state: FocusState, setId: string, currentHidden: string[]): FocusState {
  if (!state.sets.some(set => set.id === setId)) return state;
  return { ...state, active: { setId, restore: state.active?.restore ?? currentHidden }, lastSetId: setId };
}

/** Turns the view off and returns the `hiddenGroups` to write back, or null when it was off. */
export function deactivate(state: FocusState): { state: FocusState; restore: string[] | null } {
  return { state: { ...state, active: null }, restore: state.active?.restore ?? null };
}

/** The set a double press turns on: the last one used, then the first. Null means turn off or stay off. */
export function swapTarget(state: FocusState): string | null {
  if (state.active) return null;
  return state.lastSetId ?? state.sets[0]?.id ?? null;
}

export const addSet = (state: FocusState, id: string, name: string): FocusState => ({
  ...state,
  sets: [...state.sets, { id, name, projects: [], mask: 'off' }],
});

export const renameSet = (state: FocusState, setId: string, name: string): FocusState =>
  updateSet(state, setId, set => ({ ...set, name }));

export const setMask = (state: FocusState, setId: string, mask: Mask): FocusState =>
  updateSet(state, setId, set => ({ ...set, mask }));

export const setProject = (state: FocusState, setId: string, projectId: string, included: boolean): FocusState =>
  updateSet(state, setId, set => ({
    ...set,
    projects: included
      ? set.projects.includes(projectId) ? set.projects : [...set.projects, projectId]
      : set.projects.filter(id => id !== projectId),
  }));

/** Remove a set only while it is inactive; deactivate it first. */
export const removeSet = (state: FocusState, setId: string): FocusState => ({
  ...state,
  sets: state.sets.filter(set => set.id !== setId),
  lastSetId: state.lastSetId === setId ? null : state.lastSetId,
});

/**
 * The `hiddenGroups` a running view needs: every project outside the set, plus
 * loose threads. Non-project groups the user had hidden, such as sections, stay
 * hidden. Null while the view is off.
 */
export function hiddenGroups(state: FocusState, projectIds: readonly string[]): string[] | null {
  if (!state.active) return null;
  const { setId, restore } = state.active;
  const shown = state.sets.find(set => set.id === setId)?.projects ?? [];
  const kept = restore.filter(group => !group.startsWith(PROJECT) && group !== LOOSE_THREADS);
  const projects = projectIds.filter(id => !shown.includes(id)).map(id => `${PROJECT}${id}`);
  return [...kept, LOOSE_THREADS, ...projects];
}
