import { clearanceMinutes } from "./core";
export function queueHtml(): string {
  return `<!doctype html><html><head><style>
*{box-sizing:border-box}body{margin:0}form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}label{display:grid;gap:5px;font-size:12px;color:var(--muted-foreground)}input{width:100%;font:inherit;font-size:14px;color:var(--foreground);background:transparent;border:1px solid var(--border);border-radius:5px;padding:6px 8px;min-height:34px}input:focus-visible{outline:2px solid var(--ring);outline-offset:2px}output{display:block;margin:12px 0 8px;font-size:14px;font-variant-numeric:tabular-nums}svg{display:block;width:100%;height:220px}text{fill:var(--muted-foreground);font:12px var(--font-sans)}@media(max-width:440px){form{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}
</style></head><body>
<form aria-label="Queue inputs" onsubmit="return false">
<label>Arrivals / min<input id="arrivals" type="number" min="0" max="10000" step="any" value="12"></label>
<label>Per worker / min<input id="rate" type="number" min="0" max="10000" step="any" value="5"></label>
<label>Workers<input id="workers" type="number" min="0" max="1000" step="1" value="2"></label>
<label>Backlog (jobs)<input id="backlog" type="number" min="0" max="1000000" step="any" value="60"></label>
</form><output aria-live="polite" id="result"></output>
<svg viewBox="0 0 620 220" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">Backlog over time</title><desc id="chart-description"></desc><path d="M48 12V182H604" fill="none" stroke="var(--border)"/><path id="line" fill="none" stroke="var(--primary)" stroke-width="2.5"/><text x="48" y="205">0 min</text><text id="end" x="604" y="205" text-anchor="end"></text><text x="48" y="18">Backlog (jobs)</text><text id="top" x="40" y="36" text-anchor="end"></text><text x="40" y="186" text-anchor="end">0</text></svg>
<script>
const clearanceMinutes = ${clearanceMinutes.toString()};
const controls = ['arrivals','rate','workers','backlog'].map(id => document.getElementById(id));
function draw(){
 if(controls.some(input => !input.validity.valid || input.value === '')){document.getElementById('result').textContent='Enter valid non-negative values.';return}
 const [a,r,w,b]=controls.map(input=>Number(input.value));
 const spare=r*w-a, minutes=clearanceMinutes(a,r,w,b);
 const svg=document.querySelector("svg"), width=Math.max(180,svg.clientWidth), right=width-12;
 svg.setAttribute("viewBox","0 0 "+width+" 220");
 svg.querySelector("path").setAttribute("d","M48 30V182H"+right);
 document.getElementById("end").setAttribute("x",right);
 const horizon=minutes === null ? 30 : Math.max(1, Math.min(120, minutes*1.2));
 const last=Math.max(0,b-spare*horizon), max=Math.max(1,b,last);
 const points=Array.from({length:61},(_,i)=>{const t=horizon*i/60;return [48+(right-48)*i/60,182-152*Math.max(0,b-spare*t)/max]});
 document.getElementById('line').setAttribute('d',points.map(([x,y],i)=>(i?'L':'M')+x+','+y).join(' '));
 const message=b===0 ? (spare<0?'Queue starts empty; grows by '+(-spare).toFixed(1)+' / min.':'Queue stays empty.') : minutes===null ? (spare===0?'Balanced capacity cannot clear this backlog.':'Backlog grows by '+(-spare).toFixed(1)+' / min.') : 'Clears in '+Number(minutes.toFixed(2))+' min.';
 document.getElementById('result').textContent=message;
 document.getElementById('chart-description').textContent=message+' Backlog starts at '+b+' and reaches '+Number(last.toFixed(1))+' after '+Number(horizon.toFixed(1))+' minutes.';
 document.getElementById('end').textContent=Number(horizon.toFixed(1))+' min';document.getElementById('top').textContent=Number(max.toFixed(1));
}controls.forEach(input=>input.addEventListener('input',draw));new ResizeObserver(draw).observe(document.querySelector('svg'));draw();
</script></body></html>`;
}
