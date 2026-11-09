
/* draws every card once, then moves nothing but CSS: ink is never redrawn on hover */
const hash = s => { let h = 7; for (const c of s) h = Math.imul(h,31)+c.charCodeAt(0)|0; return h; };
const grid = {}; const $ = id => document.getElementById(id);
/* the themes page puts each named chart in a row with its two other subjects: the thing itself, a swapped object, a plain chart */
const MODE = document.querySelector('.page').dataset.mode, KIND = {itself:'the thing itself',swapped:'swapped object',plain:'plain chart'};
const sheet = (c,draw) => { begin(hash(c.id)); LOOSE = .22; OX = 260; OY = 210; draw.call(c); flush(); LOOSE = 0; return out.join(''); };
const NAMES = {plain:'plain',art:'drawn in'};
/* the Minicharts page shows only drawn-in charts: a card whose own mode is plain takes its drawn-in version, and no card gets a switch */
const SOLO = MODE === 'site'; if (SOLO) KIND.plain = 'everyday numbers';
const paint = (c,kind) => {
  /* the drawn-in versions read their numbers from the plain drawing through this.draw, so the card itself stays as it is */
  const swap = SOLO && kind === 'plain' && ALT[c.id]; if (swap) kind = 'drawn'; const note = swap ? swap.note : c.note;
  const el = document.createElement('article'); el.className = 'card'; el.id = c.id; const h = kind ? (c.theme || LIT[c.id] || c.name) : c.name;
  /* a themes card can hold both modes: plain (a simple chart with a drawing beside it) and art (the chart drawn as the thing) */
  const own = kind === 'plain' ? 'plain' : 'art', alt = !SOLO && kind && ALT[c.id], other = own === 'plain' ? 'art' : 'plain', svgOf = (m,body) => `<svg data-m="${m}" viewBox="0 0 ${SHW} ${SHH}" role="img" aria-label="${h}: ${esc(c.of)}">${body}</svg>`;
  el.dataset['n'+own] = note; if (alt) el.dataset['n'+other] = alt.note;
  el.innerHTML = `<header class="cap2"><h3>${h}</h3><p>${c.of}</p>${kind ? `<span class="kind">${KIND[kind === 'drawn' ? 'plain' : kind]}</span>` : ''}</header>${svgOf(own,sheet(c,swap ? swap.draw : c.draw))}${alt ? svgOf(other,sheet(c,alt.draw)) : ''}<div class="foot"><p class="note" aria-live="polite">${note}</p>${alt ? `<div class="mode" role="group" aria-label="mode"><button data-m="plain">plain</button><button data-m="art">drawn in</button></div>` : ''}</div>`;
  el.dataset.own = own; el.dataset.m = own; el.dataset.note = note; return el; };
/* switch one card, or every card, between plain and drawn-in */
const setMode = (el,m) => { if (!el.querySelector(`svg[data-m="${m}"]`)) m = el.dataset.own; el.dataset.m = m; el.dataset.note = el.dataset['n'+m] || el.dataset.note; el.querySelector('.note').textContent = el.dataset.note; el.querySelectorAll('.mode button').forEach(b => b.setAttribute('aria-pressed',b.dataset.m === m)); };
if (MODE === 'themes' || MODE === 'site'){
  /* the site page shows the named charts as these rows, and every other chart once, below */
  const host = $('rows'); let n = 0;
  const DROP = ['raincloud']; /* rows taken off the themes page; their cards stay in the files */
  for (const c of CARDS.filter(c => c.sec === 'named' && !DROP.includes(c.id))){ const more = CARDS.filter(t => t.sec === 't:'+c.id); if (!more.length) continue;
    const s = document.createElement('section'); s.innerHTML = `<div class="parthead"><h2>${c.name}</h2><p>${[LIT[c.id] || c.name,...more.map(t => t.theme)].join(', ').toLowerCase()}</p></div><div class="grid"></div>`; host.append(s);
    const g = s.querySelector('.grid'), it = paint(c,'itself'); if (MODE === 'site') it.id = 'w-'+c.id; g.append(it); for (const t of more){ g.append(paint(t,t.kind)); n++; }
    /* a second row in another look, when one exists */
    const alt = CARDS.filter(t => t.sec === 'cf:'+c.id); if (alt.length){ const s2 = document.createElement('section'); s2.innerHTML = `<div class="parthead"><h2>${c.name}, Colorfigures style</h2><p>the same three, flat tones, heavy outline, blue shadow</p></div><div class="grid"></div>`; host.append(s2); const g2 = s2.querySelector('.grid'); for (const t of alt){ g2.append(paint(t,t.kind)); n++; } } }
  if (MODE === 'site'){ const types = CARDS.filter(c => !c.sec.includes(':')); const all = document.querySelector('section[data-s="all"] .grid'); for (const c of [...types].sort((a,b) => a.name.localeCompare(b.name))) all.append(paint(c)); const nr = $('nrows'); if (nr) nr.textContent = host.children.length; n = types.length; document.querySelectorAll('.n54').forEach(e => e.textContent = n); }
  ($('total') || {}).textContent = n;
  if (!SOLO){ const bar = document.createElement('div'); bar.className = 'mode all'; bar.setAttribute('role','group'); bar.setAttribute('aria-label','every card');
  bar.innerHTML = '<button data-m="plain">plain</button><button data-m="art">drawn in</button>'; document.body.append(bar);
  const all = m => { document.querySelectorAll('.card').forEach(el => setMode(el,m === 'own' ? el.dataset.own : m)); bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed',b.dataset.m === m)); };
  document.addEventListener('click',e => { const b = e.target.closest?.('.mode button'); if (!b) return; if (b.closest('.all')) all(b.dataset.m); else { setMode(b.closest('.card'),b.dataset.m); bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed',[...document.querySelectorAll('.card')].every(el => el.dataset.m === x.dataset.m))); } });
  { const q = new URLSearchParams(location.search).get('m'); if (q === 'plain' || q === 'art') all(q); else document.querySelectorAll('.card').forEach(el => setMode(el,el.dataset.own)); } }
} else {
  for (const c of CARDS.filter(c => !c.sec.includes(':'))) (grid[c.sec] ||= document.querySelector(`section[data-s="${c.sec}"] .grid`)).append(paint(c));
  ($('total') || {}).textContent = CARDS.filter(c => !c.sec.includes(':')).length;
}
/* side illustrations on plain charts sit at a set size: each is scaled about the middle of its base */
const DECO = ['Two terraced houses','The returns shelf','Somebody in class B','A flat white and a croissant','The trainers that','The bike in the window','The radiator is','Everything you carried','The shop phone','The school bus:','The one letter','A plane tree','An umbrella and wellies','A punnet of','The upright at home','Dinner on the table','Two boxes at the door','New in this week','Somewhere on this street','Our basil','A sunny day','The 42, pulling','The jar on the kitchen','The class fruit bowl','Lights out at eight'], DECO_K = .72;
for (const g of document.querySelectorAll('#rows g.p')){ if (!g.classList.contains('deco') && !DECO.some(d => g.dataset.n.startsWith(d))) continue;
  const b = g.getBBox(), cx = b.x+b.width/2, cy = b.y+b.height, w = document.createElementNS('http://www.w3.org/2000/svg','g');
  w.setAttribute('transform',`translate(${cx} ${cy}) scale(${DECO_K}) translate(${-cx} ${-cy})`); while (g.firstChild) w.append(g.firstChild); g.append(w); }
document.querySelector('#defs').innerHTML = pencilDefs();
/* a red pen ring, drawn the first time a part is touched */
const ringOf = g => { if (g.dataset.ringed) return; g.dataset.ringed = 1; const b = g.getBBox(), cx = b.x+b.width/2, cy = b.y+b.height/2, rx = b.width/2+9, ry = b.height/2+8; seedWith(hash(g.dataset.n)); out = []; LOOSE = .35; const a0 = rnd()*6; line(Array.from({length:40},(_,i) => { const t = a0+i/36*2*Math.PI; return [cx+rx*Math.cos(t),cy+ry*Math.sin(t)]; }),{w:1.5,col:RED,over:0}); LOOSE = 0; const h = document.createElementNS('http://www.w3.org/2000/svg','g'); h.setAttribute('class','halo'); h.innerHTML = out.join(''); g.append(h); };
const wake = (p,c) => { c.classList.add('live'); c.querySelectorAll('.p.on').forEach(e => e.classList.remove('on')); p.classList.add('on'); if (p.classList.contains('rg')) ringOf(p); c.querySelector('.note').textContent = p.dataset.n; };
const rest = c => { c.classList.remove('live'); c.querySelectorAll('.p.on').forEach(e => e.classList.remove('on')); c.querySelector('.note').textContent = c.dataset.note; };
/* a part that lifts can slide out from under the pointer, so hold it until the lift has finished. A finger leaving the glass is not leaving the card: a tap stays on until the next tap. */
let held = 0, liveCard = null;
const aim = e => { if (e.timeStamp < held) return; const p = e.target.closest?.('.p'), c = e.target.closest?.('.card'); if (liveCard && liveCard !== c){ rest(liveCard); liveCard = null; } if (p && c){ if (!p.classList.contains('on')){ wake(p,c); liveCard = c; if (p.style.getPropertyValue('--dy')) held = e.timeStamp+260; } } else if (c && e.pointerType === 'mouse'){ rest(c); liveCard = null; } };
document.addEventListener('pointerover',aim);
document.addEventListener('pointermove',aim);
document.addEventListener('pointerdown',aim);
document.addEventListener('pointerout',e => { if (e.pointerType === 'touch') return; const c = e.target.closest?.('.card'); if (c && !c.contains(e.relatedTarget)){ rest(c); liveCard = null; held = 0; } });
document.addEventListener('focusin',e => { const p = e.target.closest?.('.p'), c = e.target.closest?.('.card'); if (p && c) wake(p,c); });
document.addEventListener('focusout',e => { const c = e.target.closest?.('.card'); if (c && !c.contains(e.relatedTarget)) rest(c); });
document.addEventListener('keydown',e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.p')) e.preventDefault(); });
/* only what is on screen keeps moving */
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const svgs = [...document.querySelectorAll('.card svg')];
if (still) svgs.forEach(s => s.pauseAnimations());
else { const io = new IntersectionObserver(es => es.forEach(e => { e.target.classList.toggle('off',!e.isIntersecting); e.isIntersecting ? e.target.unpauseAnimations() : e.target.pauseAnimations(); })); svgs.forEach(s => { s.pauseAnimations(); s.classList.add('off'); io.observe(s); }); }
