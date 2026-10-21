import { useCallback, useEffect, useRef, useState } from 'react';
import { experimental_Icon as Icon, useComposer, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { toast } from 'sonner';
import type { rpcContract } from '../../contracts.ts';
import { effortSchema, type Favourite } from '../../src/models/contract.ts';
import { capture, matches } from '../../src/models/favourites.ts';
import { EFFORT_LABEL } from './controls.tsx';
import { useController } from './picker.tsx';
import { open, subscribeSelection } from './store.ts';

/** Star toggle for the composer's current model beside the picker chevron, drawn as one control. */
export function Trigger() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const controller = useController(composer);
  const [list, setList] = useState<Favourite[] | null>(null);
  const [daybreak, setDaybreak] = useState<boolean | undefined>();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const working = useRef(false);
  const providerId = composer.selection?.providerId;
  const model = composer.selection?.model;
  const environmentKey = JSON.stringify(composer.selection?.environment);
  const reload = useCallback(() => {
    rpc.call('favourites.list', {}).then(setList, () => setList(null));
  }, [rpc]);
  useEffect(reload, [reload]);
  useRealtime('favourites-changed', reload);
  useEffect(() => {
    if (!providerId) return;
    let alive = true;
    Promise.all([controller.models(providerId), controller.daybreak()]).then(
      ([models, programme]) => { if (alive) { setNames(new Map(models.map(m => [m.model, m.displayName]))); setDaybreak(programme); } },
      () => { if (alive) setNames(new Map()); });
    return () => { alive = false; };
  }, [controller, providerId, environmentKey, model, composer.isRunning]);
  useEffect(() => subscribeSelection(key => {
    if (key === composer.key) void controller.daybreak().then(setDaybreak, () => setDaybreak(undefined));
  }), [composer.key, controller]);
  const name = model ? `${names.get(model) ?? model}${daybreak ? ' · Daybreak' : ''}` : null;
  const unknownProgramme = providerId === 'codex' && composer.scope.kind !== 'thread';
  const saved = unknownProgramme ? null : list?.find(f => matches(f, composer.selection, daybreak)) ?? null;
  const full = !saved && (list?.length ?? 0) >= 9;
  const effort = effortSchema.safeParse(composer.selection?.reasoningLevel);
  const title = !name ? 'Choose a model to favourite it'
    : unknownProgramme ? 'Save this favourite after starting a thread so its Daybreak setting can be read.'
    : saved ? `Remove ${name} from favourites`
    : full ? `Nine favourites saved. Remove one to add ${name}.`
    : `Add ${name}${effort.success ? ` · ${EFFORT_LABEL[effort.data]}` : ''} to favourites`;
  async function toggle() {
    if (working.current || !providerId || !model || full || !list || unknownProgramme) return;
    working.current = true;
    try {
      const programme = await controller.daybreak();
      const current = list.find(f => matches(f, composer.selection, programme));
      setDaybreak(programme);
      setList(current ? await rpc.call('favourites.remove', { id: current.id })
        : await rpc.call('favourites.add', { name: '', ...capture(composer.selection, programme), ...(effort.success ? { reasoningLevel: effort.data } : {}) }));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not update favourites.'); }
    finally { working.current = false; }
  }
  return <span className="mf-trigger">
    <button type="button" className="mf-trigger-star" data-saved={Boolean(saved) || undefined}
      aria-label={name ? `Favourite ${name}` : 'Favourite current model'} aria-pressed={Boolean(saved)} title={title}
      disabled={!name} aria-disabled={full || unknownProgramme || undefined} onClick={() => { void toggle(); }}>
      <Icon name="Star" className="mf-trigger-icon" />
    </button>
    <button type="button" className="mf-trigger-open" aria-label="Switch model" title="Switch model (⌥F)" onClick={() => open(composer)}>
      <Icon name="ChevronDown" className="mf-trigger-chevron" />
    </button>
  </span>;
}
