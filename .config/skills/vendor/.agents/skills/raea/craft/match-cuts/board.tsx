// A chain's board (`raea guide match-cuts`): the eye's way through the piece, each shot's frame with its in and out
// hooks on the thirds, the plan checks' results, and a library of places to pick from. The person ticks places, writes
// notes and sends them back (app.result). A project's board.tsx draws its own chain and places:
//
//   import { Board } from "./checks/match-cuts/board";
//   import film from "./film.chain";
//   import { PLACES } from "./places";
//   export default () => <Board chain={film} places={PLACES} />;
//
//   raea show board.tsx --title "The cuts"
import { useMemo, useState, type ReactNode } from "react";
import { app, useItem } from "@raea/app";
import { JOINS, NAMES, centreOf, cuts, planned, type At, type Chain, type Hook, type Join, type Place, type Placed } from "./chain";

const IN = "#e8a33d", OUT = "#2bb3a6", EYE = "#d65a7a";
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

/** The frame's size in the board's units: 100 high, as wide as the piece's aspect. */
const sizeOf = (c: Chain) => { const [w, h] = c.aspect ?? [16, 9]; return { W: (100 * w) / h, H: 100 }; };

/** one hook drawn on the frame: its glyph at its place on the thirds */
function Glyph({ hook, colour, filled, W, H }: { hook: Hook; colour: string; filled?: boolean; W: number; H: number }) {
  const [u, v] = centreOf(hook.at);
  const [x, y] = [u * W, v * H];
  const full = hook.at === "FULL";
  const common = { stroke: colour, strokeWidth: 1.6, fill: filled ? colour : "none", fillOpacity: 0.28, strokeDasharray: filled ? undefined : "3 2" };
  switch (hook.glyph) {
    case "circle": return <circle cx={x} cy={y} r={full ? H * 0.4 : 9} {...common} />;
    case "rect": return full ? <rect x={6} y={6} width={W - 12} height={H - 12} rx={3} {...common} /> : <rect x={x - 14} y={y - 9} width={28} height={18} rx={2} {...common} />;
    case "hline": return <line x1={6} x2={W - 6} y1={y} y2={y} {...common} strokeWidth={2.4} />;
    case "vline": return <line x1={x} x2={x} y1={6} y2={H - 6} {...common} strokeWidth={2.4} />;
    case "diag": return <line x1={x - 18} y1={y - 18} x2={x + 18} y2={y + 18} {...common} strokeWidth={2.4} />;
    case "vanish": return <g {...common} fill="none">{[[0, 0], [W, 0], [0, H], [W, H]].map(([a, b], i) => <line key={i} x1={a} y1={b} x2={x} y2={y} />)}<circle cx={x} cy={y} r={2.2} fill={colour} /></g>;
    case "blob": return full ? <path d={`M8 ${H * 0.55} C ${W * 0.25} ${H * 0.2}, ${W * 0.7} ${H * 0.85}, ${W - 8} ${H * 0.4} L ${W - 8} ${H - 8} L 8 ${H - 8} Z`} {...common} /> : <ellipse cx={x} cy={y} rx={14} ry={9} {...common} />;
    case "streaks": return <g {...common}>{Array.from({ length: full ? 14 : 6 }, (_, i) => { const sx = full ? 10 + ((i * 37) % (W - 20)) : x - 12 + (i % 3) * 12; const sy = full ? 10 + ((i * 23) % (H - 30)) : y - 8 + Math.floor(i / 3) * 10; return <line key={i} x1={sx} y1={sy} x2={sx - 4} y2={sy + 12} />; })}</g>;
    case "dots": return <g fill={colour}>{Array.from({ length: full ? 22 : 9 }, (_, i) => <circle key={i} cx={full ? 8 + ((i * 29) % (W - 16)) : x - 10 + (i % 3) * 10} cy={full ? 8 + ((i * 17) % (H - 16)) : y - 10 + Math.floor(i / 3) * 10} r={1.4} />)}</g>;
  }
}

/** the frame with its thirds, and whatever is drawn on it */
function Thirds({ W, H, children, className = "" }: { W: number; H: number; children?: ReactNode; className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`block w-full rounded-md border border-line text-ink ${className}`} style={{ aspectRatio: `${W} / ${H}` }}>
      <rect width={W} height={H} fill="currentColor" fillOpacity={0.05} />
      {[W / 3, (2 * W) / 3].map((x) => <line key={x} x1={x} x2={x} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.22} strokeDasharray="1.5 2" />)}
      {[H / 3, (2 * H) / 3].map((y) => <line key={y} x1={0} x2={W} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.22} strokeDasharray="1.5 2" />)}
      {children}
    </svg>
  );
}

/** a shot's frame: the in hook (dashed), the out hook (filled), and the eye's way between them */
function Frame({ s, W, H }: { s: Placed; W: number; H: number }) {
  const [ax, ay] = centreOf(s.in.at), [bx, by] = centreOf(s.out.at);
  const moves = Math.abs(ax - bx) > 0.01 || Math.abs(ay - by) > 0.01;
  return (
    <Thirds W={W} H={H}>
      <Glyph hook={s.in} colour={IN} W={W} H={H} />
      <Glyph hook={s.out} colour={OUT} filled W={W} H={H} />
      {moves && <g stroke={EYE} strokeWidth={1.4} fill="none"><line x1={ax * W} y1={ay * H} x2={bx * W} y2={by * H} /><circle cx={bx * W} cy={by * H} r={2.4} fill={EYE} /></g>}
    </Thirds>
  );
}

/** every shot's in and out joined in order: where the eye goes through the whole piece, and how often it rests where */
function EyePath({ c, W, H }: { c: Chain; W: number; H: number }) {
  const pts = c.shots.flatMap((s) => [centreOf(s.in.at), centreOf(s.out.at)]).map(([u, v]) => [u * W, v * H]);
  const rests = new Map<At, number>();
  for (const s of c.shots.slice(1)) rests.set(s.in.at, (rests.get(s.in.at) ?? 0) + 1);
  return (
    <Thirds W={W} H={H}>
      <polyline points={pts.map(([x, y], i) => `${x + ((i % 5) - 2) * 0.6},${y + ((i % 7) - 3) * 0.6}`).join(" ")} fill="none" stroke={EYE} strokeWidth={0.8} strokeOpacity={0.75} />
      {[...rests].map(([at, n]) => {
        const [u, v] = at === "FULL" ? [0.62, 0.1] : centreOf(at);
        return (
          <g key={at}>
            <circle cx={u * W} cy={v * H} r={2.2 + n * 0.55} fill={OUT} fillOpacity={0.5} stroke={OUT} />
            <text x={u * W + 4 + n * 0.55} y={v * H - 3} fontSize={4.2} fill="currentColor">{at === "FULL" ? `fills the frame ×${n}` : `${at} ×${n}`}</text>
          </g>
        );
      })}
    </Thirds>
  );
}

const hookLine = (h: Hook) => `${h.what} (${NAMES[h.at]}${h.move ? `, moving ${h.move}` : ""}${h.colour ? `, ${h.colour}` : ""}${h.light ? `, ${h.light}` : ""})`;

function ShotCard({ s, i, title, W, H }: { s: Placed; i: number; title: string; W: number; H: number }) {
  const join: Join | "open" = i === 0 ? "open" : s.cut ?? "graphic";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{i + 1}. {title}</span>
        <span className="whitespace-nowrap font-mono text-xs text-ink-3">{fmt(s.from)} · {s.seconds.toFixed(2)} s</span>
      </div>
      <div className="text-xs text-ink-3">{join === "open" ? "opens the piece" : `${join} cut`}{s.on ? `, on ${s.on}` : ""}{s.bridge ? ` · ${s.bridge.kind} bridge: ${s.bridge.sound}, ${s.bridge.seconds} s` : ""}{s.montage ? " · montage" : ""}</div>
      <Frame s={s} W={W} H={H} />
      <div className="text-xs leading-snug">
        <span style={{ color: IN }}>in</span> {hookLine(s.in)}<br />
        <span style={{ color: OUT }}>out</span> {hookLine(s.out)}
      </div>
      {(s.carry || s.note) && <div className="text-xs leading-snug text-ink-3">{[s.carry, s.note].filter(Boolean).join(". ")}</div>}
    </div>
  );
}

function PlaceCard({ p, on, toggle, used, W, H }: { p: Place; on: boolean; toggle: () => void; used: boolean; W: number; H: number }) {
  return (
    <label className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${on ? "border-accent" : "border-line"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{p.title}</div>
          <div className="font-mono text-[11px] uppercase tracking-wide text-ink-3">{[p.kind, used && "in the chain"].filter(Boolean).join(" · ")}</div>
        </div>
        <input type="checkbox" checked={on} onChange={toggle} className="mt-1" />
      </div>
      <Thirds W={W} H={H}>{p.hooks.map((k, i) => <Glyph key={i} hook={k} colour={OUT} filled W={W} H={H} />)}</Thirds>
      {p.about && <div className="text-xs leading-snug text-ink-3">{p.about}</div>}
      <div className="text-[11px] leading-snug text-ink-3">Hooks: {p.hooks.map(hookLine).join("; ")}</div>
      {!!p.props?.length && <div className="flex flex-wrap gap-1">{p.props.map((x) => <span key={x} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">{x}</span>)}</div>}
    </label>
  );
}

/** The board: `chain` (a chain.ts chain), `places` (the library to pick from, optional), and an intro in words. */
export function Board({ chain: c, places = [], title, intro }: { chain: Chain; places?: Place[]; title?: string; intro?: string }) {
  const item = useItem();
  const { W, H } = sizeOf(c);
  const titles = useMemo(() => Object.fromEntries(places.map((p) => [p.id, p.title])), [places]);
  const inChain = useMemo(() => new Set(c.shots.map((s) => s.scene)), [c]);
  const checks = useMemo(() => planned(c), [c]);
  const joins = useMemo(() => JOINS.map((j) => [j, cuts(c).filter((k) => k.join === j).length] as const).filter(([, n]) => n), [c]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(places.filter((p) => inChain.has(p.id)).map((p) => p.id)));
  const [show, setShow] = useState<"all" | "picked" | "rest">("all");
  const [notes, setNotes] = useState("");
  const [sent, setSent] = useState(false);
  const list = places.filter((p) => show === "all" || (show === "picked") === picked.has(p.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const send = () => {
    const ids = places.filter((p) => picked.has(p.id));
    const added = ids.filter((p) => !inChain.has(p.id)).map((p) => p.title);
    const dropped = places.filter((p) => inChain.has(p.id) && !picked.has(p.id)).map((p) => p.title);
    const said = [places.length && `Places picked (${ids.length}): ${ids.map((p) => p.title).join(", ")}.`, added.length && `Added to the chain: ${added.join(", ")}.`, dropped.length && `Dropped: ${dropped.join(", ")}.`, notes.trim() && `Notes: ${notes.trim()}`].filter(Boolean).join(" ");
    app.result(said || "No changes.").then(() => setSent(true));
  };
  const failing = checks.filter((r) => r.fails.length);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-6 text-ink">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{title ?? `${c.title ?? "The piece"}: match cuts on the thirds`}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-3">
          {intro ?? "Every cut lands the eye where the last shot left it: each shot takes the eye in at a place on the thirds, on a thing of the same shape, motion or texture as the one it cut from, and its action carries the eye to the place the next cut leaves from."}
          {" "}{c.shots.length} shots, {fmt(c.length)}, cut {joins.map(([j, n]) => `${n} ${j}`).join(", ")}{c.loop ? ", looping" : ""}.
        </p>
        <div className="flex flex-wrap gap-4 text-xs">
          <span><span style={{ color: IN }}>- - -</span> in: where the eye arrives</span>
          <span><span style={{ color: OUT }}>■</span> out: where the next cut leaves</span>
          <span><span style={{ color: EYE }}>●—</span> the eye's way through the shot</span>
          <span className="text-ink-3">dotted lines: the thirds</span>
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">The eye through the whole piece</h2>
          <EyePath c={c} W={W} H={H} />
        </div>
        <div className="flex flex-col gap-2 text-sm leading-relaxed">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">The plan checks: {checks.length - failing.length} of {checks.length} hold</h2>
          <ul className="flex flex-col gap-1 text-xs">
            {checks.map((r) => (
              <li key={r.id}><span className={r.fails.length ? "font-semibold" : "text-ink-3"}>{r.fails.length ? "✗" : "✓"} {r.id}</span> <span className="text-ink-3">{r.text}</span>{r.fails.map((f) => <div key={f} className="pl-4">{f}</div>)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">The chain, shot by shot</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{c.shots.map((s, i) => <ShotCard key={i} s={s} i={i} title={titles[s.scene] ?? s.name ?? s.scene} W={W} H={H} />)}</div>
      </section>

      {places.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">The places: {places.length}, {picked.size} picked</h2>
            <div className="flex gap-1 text-xs">
              {(["all", "picked", "rest"] as const).map((k) => (
                <button key={k} onClick={() => setShow(k)} className={`rounded border px-2 py-1 ${show === k ? "border-accent" : "border-line text-ink-3"}`}>{k === "all" ? "All" : k === "picked" ? "Picked" : "Not picked"}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{list.map((p) => <PlaceCard key={p.id} p={p} on={picked.has(p.id)} toggle={() => toggle(p.id)} used={inChain.has(p.id)} W={W} H={H} />)}</div>
        </section>
      )}

      <footer className="sticky bottom-0 flex flex-col gap-2 rounded-lg border border-line bg-ground p-4">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes on the chain, the thirds or any place" className="w-full rounded border border-line bg-ground p-2 text-sm text-ink" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-3">{places.length ? `${picked.size} places picked. Ticking one that isn't in the chain asks for it to be worked in.` : "Notes go back to the agent planning the cuts."}</span>
          <button disabled={!item || sent || item.answered} onClick={send} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ground disabled:opacity-50">{sent || item?.answered ? "Sent" : "Send picks and notes"}</button>
        </div>
      </footer>
    </main>
  );
}
