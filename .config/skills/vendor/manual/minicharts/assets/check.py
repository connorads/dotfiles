#!/usr/bin/env python3
"""Check a built Minicharts page in headless Chrome, and take its screenshot.

  python3 check.py rent.html            writes rent.png beside it and prints what it found

It reads the page as drawn (not its source), so a word like NaN in the code does not count. It reports:
script errors, NaN or undefined in the drawing, how many cards and touchable parts each card has,
notes longer than 150 characters, and writing that runs past the edge of a card's sheet.
Exit code 0 means nothing was found; 1 means something needs fixing.
"""
import json, os, pathlib, re, shutil, subprocess, sys, tempfile
page = pathlib.Path(sys.argv[1]).resolve()
CANDS = [os.environ.get('CHROME',''), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium', 'chromium-browser']
chrome = next((c for c in CANDS if c and (pathlib.Path(c).exists() or shutil.which(c))), None)
if not chrome: sys.exit('Chrome not found: set CHROME to its path')
# a small probe, run after the cards are drawn: it writes what it finds into the page, which --dump-dom returns
probe = '''<script>addEventListener('load',() => setTimeout(() => { const R = {cards:[]};
  for (const c of document.querySelectorAll('.card')){ const svg = c.querySelector('svg'), box = svg.getBoundingClientRect(), k = box.width/520;
    const over = [...svg.querySelectorAll('text')].filter(t => { const b = t.getBoundingClientRect(); return b.width && (b.left < box.left-1 || b.right > box.right+1 || b.top < box.top-1 || b.bottom > box.bottom+1); }).map(t => t.textContent);
    const notes = [c.dataset.note, ...[...c.querySelectorAll('.p')].map(p => p.dataset.n)];
    R.cards.push({id:c.id, parts:c.querySelectorAll('.p').length, long:notes.filter(n => n && n.length > 150), over, bad:/NaN|undefined/.test(svg.innerHTML) });
  } document.documentElement.dataset.probe = JSON.stringify(R); }, 300));</script>'''
tmp = pathlib.Path(tempfile.mkdtemp()); probed = page.with_name('.probe-'+page.name)
probed.write_text(page.read_text(encoding='utf8').replace('</body>', probe+'</body>') if '</body>' in page.read_text(encoding='utf8') else page.read_text(encoding='utf8')+probe, encoding='utf8')
base = [chrome,'--headless=new','--hide-scrollbars',f'--user-data-dir={tmp}','--virtual-time-budget=4000']
dom = subprocess.run(base+['--dump-dom',probed.as_uri()],capture_output=True,text=True).stdout
n = len(re.findall(r'<article class="card"', dom))
shot = page.with_suffix('.png')
tall = 1100 if n <= 1 else min(4000, 200+(n+1)//2*560)   # many cards: the first rows only, at 1x, so the shot stays quick
try: subprocess.run(base+[f'--force-device-scale-factor={2 if n <= 4 else 1}',f'--window-size=1000,{tall}',f'--screenshot={shot}',page.as_uri()],capture_output=True,timeout=90)
except subprocess.TimeoutExpired: shot = None   # Chrome sometimes stalls on long animated pages; the checks below do not need the shot
probed.unlink(missing_ok=True); shutil.rmtree(tmp, ignore_errors=True)
err = re.search(r'data-errors="([^"]*)"', dom); m = re.search(r"data-probe=\"([^\"]*)\"", dom)
R = json.loads(m.group(1).replace('&quot;','"').replace('&amp;','&').replace('&lt;','<').replace('&gt;','>')) if m else {'cards':[]}
bad = False
print('screenshot:', shot or 'timed out (Chrome stalled); run the check again for a picture')
if err: bad = True; print('script errors:', err.group(1))
if not R['cards']: bad = True; print('no cards were drawn')
for c in R['cards']:
    line = f"card {c['id']}: {c['parts']} touchable parts"
    if c['parts'] == 0: bad = True; line += ', none touchable: wrap every data mark in PT(note, fn)'
    if c['bad']: bad = True; line += ', NaN or undefined in the drawing'
    if c['long']: bad = True; line += f", {len(c['long'])} note(s) over 150 characters: " + ' | '.join(x[:60]+'…' for x in c['long'])
    if c['over']: bad = True; line += ', writing past the sheet edge: ' + ', '.join(c['over'][:6])
    print(line)
print('nothing found' if not bad else 'fix the above, then check again')
sys.exit(1 if bad else 0)
