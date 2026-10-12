// Memory-pressure vocabulary ported from ~/.config/tmux/scripts/mem-lib.sh.
// State comes from three kernel readings: the pressure level and the fill of
// the compressor's two ceilings (slots and segments). Each ceiling is a hard
// limit the kernel panics at, so fill is the early signal and pressure 4 the
// instant one. Pressure 2 (warn) is this machine's resting level, so it only
// marks the figure with ▲ and never changes the state.

export type State = 'OK' | 'BUSY' | 'CRITICAL';
export type Arm = 'slots' | 'segments';
export type Cause = 'none' | 'pressure' | Arm;
export type Pressure = 1 | 2 | 4;

export interface Lines { busy: number; critical: number }
export const slotLines: Lines = { busy: 60, critical: 80 };
export const segmentLines: Lines = { busy: 70, critical: 85 };
export const causeGlyph = '▲';

/** The counters one sysctl call returns; zero means unknown. */
export interface RawGauge {
  pressure: Pressure;
  pages: number;
  pagesLimit: number;
  segments: number;
  segmentsLimit: number;
  pageSize: number;
  segmentSize: number;
  swapUsedMb: number;
  swapTotalMb: number;
  wiredMb: number;
}

export interface ArmReading {
  arm: Arm;
  pct: number;
  state: State;
  gap: Gap;
  usedGib: number;
  limitGib: number;
}
export interface Gap { points: number; to: 'to amber' | 'to red' | 'over red' }

export interface Gauge {
  state: State;
  cause: Cause;
  pressure: Pressure;
  /** The binding arm's fill, with ▲ under warn or critical pressure. */
  token: string;
  slots: ArmReading;
  segments: ArmReading;
  /** Pages per segment now, and the limits' own ratio; above it, slots fill first. */
  ratio: { now: number; limits: number; fillsFirst: Arm };
  swapUsedMb: number;
  swapTotalMb: number;
  wiredMb: number;
}

/** kern.memorystatus_vm_pressure_level; anything but 2 or 4 reads normal. */
export function pressureFrom(raw: string | undefined): Pressure {
  const value = raw?.trim();
  return value === '4' ? 4 : value === '2' ? 2 : 1;
}

/** Truncated integer percentage; an unknown ceiling never alarms. */
export function pctOf(value: number, limit: number): number {
  return limit > 0 ? Math.trunc((value * 100) / limit) : 0;
}

export function armState(pct: number, lines: Lines): State {
  return pct >= lines.critical ? 'CRITICAL' : pct >= lines.busy ? 'BUSY' : 'OK';
}

/** Points to the next line that changes the colour; exactly on red reads 0 over red. */
export function armGap(pct: number, lines: Lines): Gap {
  if (pct >= lines.critical) return { points: pct - lines.critical, to: 'over red' };
  if (pct >= lines.busy) return { points: lines.critical - pct, to: 'to red' };
  return { points: lines.busy - pct, to: 'to amber' };
}

export function stateOf(pressure: Pressure, slots: number, segments: number): State {
  if (pressure >= 4 || slots >= slotLines.critical || segments >= segmentLines.critical) return 'CRITICAL';
  if (slots >= slotLines.busy || segments >= segmentLines.busy) return 'BUSY';
  return 'OK';
}

/** The arm at or over its line binds; both or neither: the higher fill, ties to slots. */
export function bindingArm(slots: number, slotLine: number, segments: number, segmentLine: number): Arm {
  const slotsOver = slots >= slotLine;
  const segmentsOver = segments >= segmentLine;
  if (slotsOver !== segmentsOver) return slotsOver ? 'slots' : 'segments';
  return segments > slots ? 'segments' : 'slots';
}

function armFor(state: State, slots: number, segments: number): Arm {
  const level = state === 'CRITICAL' ? 'critical' : 'busy';
  return bindingArm(slots, slotLines[level], segments, segmentLines[level]);
}

export function causeOf(pressure: Pressure, slots: number, segments: number): Cause {
  const state = stateOf(pressure, slots, segments);
  if (state === 'OK') return 'none';
  if (state === 'CRITICAL' && pressure >= 4) return 'pressure';
  return armFor(state, slots, segments);
}

export function tokenOf(pressure: Pressure, slots: number, segments: number): string {
  const arm = armFor(stateOf(pressure, slots, segments), slots, segments);
  return `${pressure >= 2 ? causeGlyph : ''}${arm === 'slots' ? slots : segments}%`;
}

/** Pages per segment, one decimal; 0 when nothing is known. */
export function ratioOf(pages: number, segments: number): number {
  return segments > 0 ? Math.round((pages / segments) * 10) / 10 : 0;
}

const gib = (count: number, bytesEach: number) => Math.round((count * bytesEach) / 1073741824 * 10) / 10;

function arm(arm: Arm, lines: Lines, { used, limit, bytesEach }: { used: number; limit: number; bytesEach: number }): ArmReading {
  const pct = pctOf(used, limit);
  return { arm, pct, state: armState(pct, lines), gap: armGap(pct, lines), usedGib: gib(used, bytesEach), limitGib: gib(limit, bytesEach) };
}

/**
 * Whether the compressor ceilings were read at all. mem-lib reads absent
 * sysctls as a flat OK for the tmux pill; a chip that says `OK 0%` for a Linux
 * host or a blocked `sysctl` would be a false all-clear, so the plugin hides it.
 */
export function readable(raw: RawGauge): boolean {
  return raw.pagesLimit > 0 && raw.segmentsLimit > 0;
}

/** One gather feeds state and figures alike, so the gauge never contradicts its own bars. */
export function readGauge(raw: RawGauge): Gauge {
  const slots = arm('slots', slotLines, { used: raw.pages, limit: raw.pagesLimit, bytesEach: raw.pageSize });
  const segments = arm('segments', segmentLines, { used: raw.segments, limit: raw.segmentsLimit, bytesEach: raw.segmentSize });
  const now = ratioOf(raw.pages, raw.segments);
  const limits = ratioOf(raw.pagesLimit, raw.segmentsLimit);
  return {
    state: stateOf(raw.pressure, slots.pct, segments.pct),
    cause: causeOf(raw.pressure, slots.pct, segments.pct),
    pressure: raw.pressure,
    token: tokenOf(raw.pressure, slots.pct, segments.pct),
    slots, segments,
    ratio: { now, limits, fillsFirst: now > limits ? 'slots' : 'segments' },
    swapUsedMb: raw.swapUsedMb, swapTotalMb: raw.swapTotalMb, wiredMb: raw.wiredMb,
  };
}

export const stateGlyph: Record<State, string> = { OK: '⬡', BUSY: '⊟', CRITICAL: '⊠' };
