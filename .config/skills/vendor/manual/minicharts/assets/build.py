#!/usr/bin/env python3
"""Build a Minicharts page: one standalone HTML file from one chart file.

  python3 build.py mychart.js -o mychart.html --title "Where the rent goes" [--sub "one line under the title"] [--foot "Numbers from ..."]
  python3 build.py --examples all -o all.html          every example, to look at
  python3 build.py --examples pie,bar -o two.html      some examples (ids from references/types.md)

A chart file holds one or more card({...}) calls (see SKILL.md). The page loads, in order: engine.js (pen, wash,
fills, kit), examples.js (all 54 example cards, so their helpers can be reused), your file, then run.js, which
draws every card and makes the parts touchable. Colours in your file go through the same softening as the examples,
so every hex you write lands in the Minicharts palette.
"""
import argparse, colorsys, html as H, json, pathlib, re, sys
A = pathlib.Path(__file__).resolve().parent
read = lambda p: pathlib.Path(p).read_text(encoding='utf8')

SAT, LIFT = .8, .08
PIGMENTS = [(13,.56),(40,.74),(86,.34),(150,.28),(208,.3),(345,.42)]
def soften(m):
    r,g,b = (int(m[0][i:i+2],16)/255 for i in (1,3,5))
    h,l,s = colorsys.rgb_to_hls(r,g,b)
    if l > .3: l += (.8-l)*LIFT
    if .2 < l < .58: l += (.62-l)*.42
    if s > .04:
        d,cap = min(PIGMENTS,key=lambda a: min(abs(a[0]-h*360),360-abs(a[0]-h*360)))
        e = (d-h*360+180)%360-180
        h = ((h*360+e*.6)%360)/360; s = min(cap,s*SAT)
    return '#'+''.join(f'{round(v*255):02x}' for v in colorsys.hls_to_rgb(h,l,s))
soft = lambda js: re.sub(r'#[0-9a-fA-F]{6}\b',soften,js)

ap = argparse.ArgumentParser()
ap.add_argument('chart',nargs='?')
ap.add_argument('-o','--out',required=True)
ap.add_argument('--title',default='')
ap.add_argument('--sub',default='')
ap.add_argument('--foot',default='Numbers are drawn to scale.')
ap.add_argument('--examples',default='')
a = ap.parse_args()
if not a.chart and not a.examples: sys.exit('give a chart file, or --examples')

user = soft(read(a.chart)) if a.chart else ''
if a.examples:
    ids = [] if a.examples == 'all' else a.examples.split(',')
    keep = f"const EXAMPLES = CARDS.splice(0); CARDS.push(...EXAMPLES.filter(c => {'true' if not ids else 'false'} || {json.dumps(ids)}.includes(c.id)));"
else:
    keep = "const EXAMPLES = CARDS.splice(0);"
js = ('const LIT = {}, ALT = {};\n' + read(A/'engine.js') + '\n' + read(A/'examples.js') + '\n' + keep + '\n'
      + user + '\nCARDS.forEach(c => c.sec = "chart");\n' + read(A/'run.js'))
page = read(A/'page.html')
title = a.title or ('Minicharts examples' if not a.chart else pathlib.Path(a.chart).stem)
page = (page.replace('@@TITLE@@',H.escape(title))
            .replace('@@SUB@@',f'<h2>{H.escape(a.sub)}</h2>' if a.sub else '')
            .replace('@@FOOT@@',H.escape(a.foot))
            .replace('@@JS@@',js))
out = pathlib.Path(a.out); out.write_text('<!doctype html>\n'+page,encoding='utf8')
print('wrote',out,len(page)//1024,'KB')
