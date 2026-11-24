// Counter-translating GPU text shimmer with a 3-state fade-out lifecycle (inactive | active | fading).
// Animates compositor `translate` only, never `background-position` on `background-clip: text`.
import { useEffect, useState } from 'react';

type Phase = 'inactive' | 'active' | 'fading';
const FADE_MS = 220;

export function ShimmerText({ text, active, className }: { text: string; active: boolean; className?: string }) {
  const [phase, setPhase] = useState<Phase>(active ? 'active' : 'inactive');

  useEffect(() => {
    if (active) {
      setPhase('active');
      return;
    }
    if (phase !== 'active') return;
    setPhase('fading');
    const timer = setTimeout(() => setPhase('inactive'), FADE_MS);
    return () => clearTimeout(timer);
  }, [active, phase]);

  return <span
    className={className ? `ex-shimmer ${className}` : 'ex-shimmer'}
    data-active={phase === 'active' ? 'true' : 'false'}
    data-run={phase !== 'inactive' ? 'true' : 'false'}>
    <span className="ex-shimmer-base">{text}</span>
    <span className="ex-shimmer-layer" aria-hidden="true">
      <span className="ex-shimmer-text">{text}</span>
      <span className="ex-shimmer-sweep">
        <span className="ex-shimmer-sweep-text">{text}</span>
      </span>
    </span>
  </span>;
}
