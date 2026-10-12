// One module store shared by the header chips, the overlay and the commands.
// Status arrives over realtime from the host's file watch; the overlay holds
// the rpc client so commands, which run outside React, can use it too.
import { useSyncExternalStore } from 'react';
import type { BbNavigate, PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { rpcContract, VoxStatusDto } from './contracts.ts';

export type Rpc = PluginRpcClient<typeof rpcContract>;
export type Anchor = { top: number; right: number; bottom: number; left: number } | null;
export type Dialog =
  | { kind: 'library'; anchor: Anchor }
  /** `start`: Esc discards the capture this prompt started. `rename`: Esc only skips the rename. */
  | { kind: 'name'; purpose: 'start' | 'rename'; name: string | null; resolve: (answer: string | null) => void };
export type Notice = { id: number; tone: 'info' | 'success' | 'error'; text: string };

interface State { status: VoxStatusDto | null; dialog: Dialog | null; notices: Notice[] }
let state: State = { status: null, dialog: null, notices: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useVox = () => useSyncExternalStore(subscribe, () => state);

let client: Rpc | null = null;
export function setClient(rpc: Rpc) { client = rpc; }
export function rpc(): Rpc {
  if (!client) throw new Error('Vox is still loading.');
  return client;
}

export const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** A failed read keeps the last status; the next signal or refocus corrects it. */
export async function refresh() {
  try { set({ status: await rpc().call('status', {}) }); } catch { /* host unreachable: keep the last status */ }
}
export function receiveStatus(payload: unknown) { set({ status: payload as VoxStatusDto }); }

let nextNotice = 1;
export function notify(tone: Notice['tone'], text: string, ms = 6_000) {
  const notice = { id: nextNotice++, tone, text };
  set({ notices: [...state.notices.slice(-2), notice] });
  setTimeout(() => dismiss(notice.id), ms);
  return notice.id;
}
export function dismiss(id: number) { set({ notices: state.notices.filter(notice => notice.id !== id) }); }

export const chipSelector = '[data-vox-chip]';
function chipAnchor(): Anchor {
  const box = document.querySelector<HTMLElement>(chipSelector)?.getBoundingClientRect();
  return box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left } : null;
}
/**
 * Every dialog change goes through here. A title prompt that is replaced or
 * closed without an answer resolves as Enter on an empty title, so the
 * capture it started is kept and its flow ends; only an explicit Esc discards.
 */
function setDialog(next: Dialog | null) {
  const previous = state.dialog;
  set({ dialog: next });
  if (previous?.kind === 'name' && previous !== next) previous.resolve('');
}
export function openLibrary() { setDialog({ kind: 'library', anchor: chipAnchor() }); }
export function toggleLibrary() { if (state.dialog?.kind === 'library') closeDialog(); else openLibrary(); }
export function closeDialog() { setDialog(null); }
export const promptOpen = () => state.dialog?.kind === 'name';

/** Raise the title prompt; resolves with the answer, or null for Esc. */
export function askTitle(purpose: 'start' | 'rename', name: string | null): Promise<string | null> {
  return new Promise(resolve => setDialog({ kind: 'name', purpose, name, resolve }));
}
export const currentStatus = () => state.status;

/**
 * BB's file preview opens only from inside a thread view; the app overlay that
 * holds the library sits outside one and is always refused. Each header pill
 * lends its pane's opener, and the newest mounted pane wins.
 */
type OpenFilePreview = BbNavigate['experimental_openFilePreview'];
const previewers: OpenFilePreview[] = [];
export function lendPreviewer(open: OpenFilePreview) {
  previewers.push(open);
  return () => { previewers.splice(previewers.lastIndexOf(open), 1); };
}
export const previewer = (): OpenFilePreview | null => previewers.at(-1) ?? null;
