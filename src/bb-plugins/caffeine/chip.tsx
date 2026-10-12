import { Chip, ChipValue } from '@bb-plugins/chip';
import { chipFace } from './src/format.ts';
import { toggle, useCaffeine, useNow } from './store.ts';

/** Self-hiding, like the tmux pill: off renders nothing. ⌥K opens the popover either way. */
export function CaffeineChip() {
  const { view, open } = useCaffeine();
  // 15 s matches the tmux status-interval, so both surfaces tick together.
  const now = useNow(15_000, view !== null && view.kind !== 'off' && view.kind !== 'unsupported');
  const face = view && chipFace(view, now);
  if (!face) return null;
  return <Chip data-caffeine-chip expanded={open !== null} aria-label={face.title} title={`${face.title} (⌥K)`}
    className="cf-root"
    onClick={event => toggle(event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget)}
    icon={<span className="cf-glyph" data-tone={face.tone}>{face.glyph}</span>}>
    <ChipValue>{face.token}</ChipValue>
  </Chip>;
}
