/* oxlint-disable no-unused-vars -- globals for scenes.js and engine.html once build inlines them into one page */
// Collage style: ransom-note lettering, rubber stamps, marker write-ons,
// paper backgrounds, confetti, paper-tape captions.
// Fonts (film.py fonts <dir> "Permanent Marker" "Caveat:wght@700" "Alfa Slab One"
//   "Special Elite" "Bungee" "Abril Fatface" "Patrick Hand"):
const F = { marker: "PermanentMarker", script: "Caveat", slab: "AlfaSlabOne", type: "SpecialElite", block: "Bungee", display: "AbrilFatface", hand: "PatrickHand" };
const STYLE = { font: F.marker, bubbleFont: F.hand };
// Background image expected: assets/img/bg_paper.* (full-frame paper texture).

// ---------------------------------------------------------------- ransom-note text
const RF = [F.slab, F.block, F.display, F.type, F.marker, F.slab, F.block];
const RP = [["#f7efdc", INK], [INK, "#f7efdc"], [RED, "#fff5e1"], ["#e9b634", INK], ["#2f6f73", "#fff5e1"], ["#ffffff", RED], ["#f2c9b8", INK]];
// Each letter on its own scrap. Letters pop in from t0 with `stagger`, or per
// word at `times` (one start time per word, e.g. from word()). Shrinks to maxW.
function ransom(str, cx, cy, size, t, t0, o = {}) {
  const { seed = 1, stagger = .045, alpha = 1, times = null, rot = 0, maxW = 1780 } = o;
  const items = []; let total = 0, wi = 0;
  ctx.save();
  [...str].forEach((ch, i) => {
    if (ch === " ") { items.push({ sp: true }); total += size * .32; wi++; return; }
    const f = RF[Math.floor(rnd(seed * 31 + i * 1.7) * RF.length)], fs = size * (0.86 + rnd(seed + i * 5.1) * .3);
    ctx.font = `${fs}px ${f}`;
    const w = ctx.measureText(ch).width + fs * .28;
    items.push({ ch, f, fs, w, i, wi }); total += w + size * .04;
  });
  const fit = Math.min(1, maxW / total);
  ctx.translate(cx, cy); ctx.scale(fit, fit); ctx.translate(-cx, -cy);
  let x = cx - total / 2;
  for (const it of items) {
    if (it.sp) { x += size * .32; continue; }
    const st = times ? times[Math.min(it.wi, times.length - 1)] + (it.i % 6) * .025 : t0 + it.i * stagger;
    const p = pop(t, st, .32);
    if (p > 0) {
      const [bg, fg] = RP[Math.floor(rnd(seed * 7 + it.i * 3.3) * RP.length)];
      const r = (rnd(seed + it.i * 9.1) - .5) * .22 + jit(t, it.i + seed, .02), dy = (rnd(seed + it.i * 2.2) - .5) * size * .14;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.translate(x + it.w / 2, cy + dy); ctx.rotate(r + rot); ctx.scale(p, p);
      const hh = it.fs * 1.18, ww = it.w, j = k => (rnd(seed + it.i * 13 + k) - .5) * 6;
      ctx.fillStyle = "rgba(40,25,10,.3)"; ctx.fillRect(-ww / 2 + 6, -hh / 2 + 8, ww, hh);
      ctx.fillStyle = bg; ctx.beginPath();
      ctx.moveTo(-ww / 2 + j(1), -hh / 2 + j(2)); ctx.lineTo(ww / 2 + j(3), -hh / 2 + j(4));
      ctx.lineTo(ww / 2 + j(5), hh / 2 + j(6)); ctx.lineTo(-ww / 2 + j(7), hh / 2 + j(8)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = fg; ctx.font = `${it.fs}px ${it.f}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(it.ch, 0, it.fs * .06);
      ctx.restore();
    }
    x += it.w + size * .04;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- rubber stamp
// Slams in from 2.4x scale over 0.16s. blend "multiply" reads as ink on light
// paper but vanishes on dark backgrounds: use blend "source-over" there.
function stamp(text, x, y, size, t, t0, o = {}) {
  const { color = RED, rot = -.12, seed = 5, font = F.slab, blend = "multiply" } = o;
  if (t < t0) return;
  const p = clamp((t - t0) / .16), sc = lerp(2.4, 1, Ez.out(p));
  ctx.save(); ctx.translate(x + (p < 1 ? jit(t * 3, seed, 8) : 0), y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.globalAlpha = Math.min(1, p * 2);
  ctx.font = `${size}px ${font}`; const w = ctx.measureText(text).width + size * .7, h = size * 1.35;
  ctx.globalCompositeOperation = blend;
  ctx.strokeStyle = color; ctx.lineWidth = size * .09; ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = size * .035; ctx.strokeRect(-w / 2 + size * .12, -h / 2 + size * .12, w - size * .24, h - size * .24);
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 0, size * .05);
  ctx.globalCompositeOperation = "destination-out"; // distress: knock out ink speckles
  for (let i = 0; i < 70; i++) { ctx.beginPath(); ctx.arc((rnd(seed + i) - .5) * w, (rnd(seed + i * 2.7) - .5) * h, rnd(i * 3.1 + seed) * size * .05 + 1, 0, 7); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- marker write-ons
function strokePts(pts, prog, color, width, t, seed) {
  if (prog <= 0) return;
  const n = Math.max(2, Math.floor(pts.length * prog));
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha *= .92;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const [x, y] = pts[i], X = x + jit(t, seed + i * .7, 1.4), Y = y + jit(t, seed + i * .9, 1.4); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
  ctx.stroke(); ctx.restore();
}
// Hand-drawn circle that draws itself from t0 over d seconds (overshoots like a real pen).
function ring(cx, cy, rx, ry, t, t0, o = {}) {
  const { d = .35, color = RED, width = 11, seed = 0 } = o, pts = [], N = 60;
  for (let i = 0; i <= N; i++) {
    const a = -1.9 + i / N * Math.PI * 2.25, wob = 1 + (rnd(seed + i * .31) - .5) * .06;
    pts.push([cx + Math.cos(a) * rx * wob * (1 + i / N * .08), cy + Math.sin(a) * ry * wob]);
  }
  strokePts(pts, inv(t0, t0 + d, t), color, width, t, seed);
}
// Two-stroke X, 0.28s. Coordinates are in the current transform: inside a
// translated group, pass local coordinates.
function cross(cx, cy, s, t, t0, o = {}) {
  const { color = RED, width = 14, seed = 0 } = o;
  const line = (x0, y0, x1, y1) => Array.from({ length: 20 }, (_, i) => [lerp(x0, x1, i / 19), lerp(y0, y1, i / 19) + Math.sin(i * .7 + seed) * 3]);
  strokePts(line(cx - s, cy - s, cx + s, cy + s), inv(t0, t0 + .14, t), color, width, t, seed);
  strokePts(line(cx + s, cy - s, cx - s, cy + s), inv(t0 + .14, t0 + .28, t), color, width, t, seed + 4);
}

// ---------------------------------------------------------------- backgrounds & fx
// Paper, optionally tinted by multiply (night: "#1c2a4a"; romance: "#c9546a" at .75).
function paperBG(t, tint = null, alpha = 1) {
  if (IMG.bg_paper) ctx.drawImage(IMG.bg_paper, 0, 0, W, H); else { ctx.fillStyle = "#efe4cc"; ctx.fillRect(0, 0, W, H); }
  if (tint) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = alpha; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}
// Faint pencil doodles (asterisks, squiggles, circles) scattered by seed.
function doodles(t, seed, color = "rgba(60,40,20,.18)", n = 14) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const x = rnd(seed + i) * W, y = rnd(seed + i * 3.3) * H, k = Math.floor(rnd(seed + i * 7) * 3), s = 18 + rnd(seed + i * 5) * 22;
    ctx.save(); ctx.translate(x + jit(t, i, 1.5), y + jit(t, i + 3, 1.5)); ctx.rotate(rnd(i + seed) * 6); ctx.beginPath();
    if (k === 0) { ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.moveTo(-s * .7, -s * .7); ctx.lineTo(s * .7, s * .7); ctx.moveTo(s * .7, -s * .7); ctx.lineTo(-s * .7, s * .7); }
    else if (k === 1) { for (let a = 0; a <= 20; a++) { const xx = -s * 1.5 + a / 20 * s * 3, yy = Math.sin(a / 20 * Math.PI * 3) * s * .35; if (a) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); } }
    else ctx.arc(0, 0, s * .6, 0, Math.PI * 2);
    ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}
// Rotating sunburst wedges: title cards, reveals, finales.
function rays(cx, cy, t, color, n = 16, alpha = .35, speed = .15) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * speed); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 2400, i / n * Math.PI * 2, (i + .5) / n * Math.PI * 2); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
function confetti(t, t0, seed, n = 90, dur = 4) {
  if (t < t0) return;
  const cols = [RED, "#e9b634", "#2f6f73", "#f7efdc", "#e07a2e", "#6b8e4e"];
  for (let i = 0; i < n; i++) {
    const lt = t - t0 - rnd(seed + i) * .6; if (lt < 0 || lt > dur) continue;
    const x = rnd(seed + i * 2) * W + (rnd(seed + i * 3) - .5) * 300 * lt + Math.sin(lt * 4 + i) * 30, y = -40 + lt * (260 + rnd(i + seed) * 260);
    ctx.save(); ctx.translate(x, y); ctx.rotate(lt * (3 + rnd(i) * 5)); ctx.scale(1, Math.cos(lt * 6 + i));
    ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-9, -6, 18, 12); ctx.restore();
  }
}
function sparkle(x, y, s, t, seed) {
  const k = .6 + .4 * Math.sin(t * 9 + seed * 5);
  ctx.save(); ctx.translate(x, y); ctx.scale(k * s, k * s); ctx.fillStyle = "#fff6c8"; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 8 : 26, a = i / 8 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
function heart(x, y, s, col = RED) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 12); ctx.bezierCurveTo(-30, -8, -18, -34, 0, -18); ctx.bezierCurveTo(18, -34, 30, -8, 0, 12); ctx.fill(); ctx.stroke(); ctx.restore();
}
function rain(t, t0, n = 120) {
  ctx.save(); ctx.strokeStyle = "rgba(70,110,170,.55)"; ctx.lineWidth = 4; ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const y = ((t - t0) * (1200 + rnd(i) * 500) + rnd(i * 2.2) * H * 1.3) % (H * 1.3) - 100, x = rnd(i * 4.4) * (W + 200) - y * .18;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8, y + 42); ctx.stroke();
  }
  ctx.restore();
}
// Binocular / keyhole mask: draw on an offscreen canvas and punch the holes out
// with destination-out. An even-odd fill leaves two overlapping holes dark.
function binoculars(t, amount) {
  if (amount <= 0) return;
  const g = maskC.getContext("2d");
  g.globalCompositeOperation = "source-over"; g.clearRect(0, 0, W, H);
  g.fillStyle = `rgba(10,8,6,${amount})`; g.fillRect(0, 0, W, H); g.globalCompositeOperation = "destination-out";
  const sw = Math.sin(t * .9) * 30, r = lerp(1400, 520, amount);
  g.beginPath(); g.arc(W / 2 - 330 + sw, H / 2, r, 0, 7); g.fill();
  g.beginPath(); g.arc(W / 2 + 330 + sw, H / 2, r, 0, 7); g.fill();
  ctx.drawImage(maskC, 0, 0);
}
// Spinning coin: x scales by |cos(phase)|; cos >= 0 shows faces[0], else faces[1].
function coin(x, y, r, phase, t, faces = ["HEADS", "TAILS"]) {
  const c = Math.cos(phase), face = c >= 0 ? faces[0] : faces[1];
  ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(.06, Math.abs(c)), 1);
  ctx.fillStyle = "rgba(40,25,10,.35)"; ctx.beginPath(); ctx.arc(8, 12, r, 0, 7); ctx.fill();
  const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
  g.addColorStop(0, "#fff0a8"); g.addColorStop(.55, "#e9b634"); g.addColorStop(1, "#a8741a");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = "rgba(120,80,20,.8)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, r * .8, 0, 7); ctx.stroke();
  ctx.fillStyle = "#6b1d14"; ctx.font = `${r * Math.min(.52, 1.9 / face.length)}px ${F.slab}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(face, 0, r * .04); ctx.restore();
}
// Freeze-frame for a record-scratch beat: render the scene at min(t, tf), then call this.
function drainColour(amount = .85, darken = .45) {
  ctx.save(); ctx.globalCompositeOperation = "saturation"; ctx.fillStyle = "hsl(0,0%,50%)"; ctx.globalAlpha = amount; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.fillStyle = `rgba(20,24,40,${darken})`; ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- caption: paper tape
function drawCaption(words, c, t, a) {
  ctx.save(); ctx.font = `42px ${F.type}`;
  const full = words.map(w => w.w).join(" "), w = ctx.measureText(full).width + 70, x = W / 2 - w / 2, y = H - 118;
  ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 20);
  ctx.fillStyle = "rgba(30,20,10,.3)"; ctx.fillRect(x + 6, y + 8, w, 70);
  ctx.fillStyle = "#f4ead2"; wobblePath([[x, y], [x + w, y + 2], [x + w - 8, y + 36], [x + w + 4, y + 70], [x, y + 68], [x + 7, y + 34]], t, 3, 1); ctx.fill();
  ctx.fillStyle = INK; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  let xx = x + 35;
  words.forEach(wd => { const s = wd.w + " "; ctx.globalAlpha = a * (t >= wd.s - .04 ? 1 : .18); ctx.fillText(s, xx, y + 37); xx += ctx.measureText(s).width; });
  ctx.restore();
}
