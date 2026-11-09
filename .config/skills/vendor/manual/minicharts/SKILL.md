---
name: minicharts
description: Draw a chart as a real, hand-drawn object from its own subject, and to scale - household spending as a pie of coins, a newsletter funnel pouring letters into a postbox, a month's budget as water running between barrels - as one interactive HTML page where every slice, bar and dot can be touched. 54 chart types (pie, doughnut, waffle, waterfall, funnel, treemap, sunburst, violin, ridgeline, beeswarm, box plot, word cloud, bar, line, scatter, Sankey, Gantt, flowchart, timeline, org chart, Venn and more). Use when someone wants a hand-drawn, illustrated, warm or playful chart or diagram, a chart "drawn as the thing", a Minichart, or a chart that is a picture rather than a plot, from their own numbers (typed, a CSV or spreadsheet file, or cells pasted from a sheet) or from a subject.
---

# Minicharts

A Minichart is a hand-drawn chart whose data lives in a real object from its own subject. Spending becomes a
pie of coins, a sign-up funnel pours letters into a postbox, a garden's rainfall fills a row of watering cans. The
numbers still rule: every slice angle, bar height and dot count is drawn to scale from the data, and every part can
be touched to read its value.

Pick the type for the question, then pick an object from the subject that can hold that chart's form. The 54
examples are drawn as their chart's namesake (a pie chart as a pie, a waterfall chart as a waterfall). That is the
showcase on the skill's page: use the examples for how to draw, not for what to draw.

Output: one self-contained HTML page with one or more chart cards (a 520 x 420 sheet each, a title bar, and a note
line that changes when a part is touched).

## What is in the folder

- `assets/engine.js`: the pen (a calm felt-tip), the colour wash, solid fills, isometric solids and the chart kit. Do not edit.
- `assets/examples.js`: one finished drawing for each of the 54 types. This is the quality bar and the best manual.
- `assets/run.js`, `assets/page.html`: draw the cards into the page and make parts touchable. Do not edit.
- `assets/build.py`: builds your chart file into a standalone page.
- `assets/check.py`: checks a built page in headless Chrome and takes its screenshot.
- `references/types.md`: every type with its id, what it is for, and its example subject. Read this to pick the type.
- `references/kit.md`: every drawing function, with the house rules for ink and colour.

## The workflow

### 1. Get the numbers and the question

Write the data down first, as a small table: labels, values, units, and the total if there is one.

- If the person gives numbers, use exactly those. Never round them into a nicer story.
- If they give only a subject ("my week", "the café's sales"), make up believable numbers and say so on the
  page (`--foot "Numbers are made up for the drawing."`).
- Never state a real-world fact (a price, a date, a record) as data unless the person gave it or you can name the
  source; put the source in the footer. If you can't, the numbers are illustrative and the footer says so.
- No crypto, trading or finance subjects unless the person asks for them.

**From a file or a sheet.** A CSV, an Excel file, or cells pasted from Google Sheets or Excel (they arrive as rows
split by tabs) are all fine. Nobody should have to retype their numbers.

- Read the data with a short script, never by eye: Python's `csv` module, or `openpyxl` for .xlsx. Pasted cells
  arrive as chat text with no file: save the text exactly as pasted (a heredoc keeps the tabs) and read it with
  `csv.reader(f, delimiter='\t')`. Never retype the values into code by hand.
  Open CSVs with `encoding='utf-8-sig'` (sheets often add a hidden mark at the start).
- The first row is the header. Use its words for the unit and the axis ("Cups sold" means the unit is cups,
  "Amount (£)" means pounds). Show values in the sheet's own currency. Ignore columns the chart does not use and
  name them in the one-line statement.
- Clean each value: trim spaces, strip currency and % signs, and read `(120)` as -120. Check the whole column before
  stripping commas: "1,240" is a thousands comma, but in a sheet where values look like "2,5" or "1.240,50" the
  comma is the decimal mark. Ignore empty columns at the end of rows. If a value column holds text that is not a
  number, ask.
- Before drawing, state in one line which column is the label, which is the value, and how many rows there are,
  then carry on. Stop and ask only when it is not clear which column answers the question.
- Keep the exact values. Group rows only where the chart needs it (daily rows into a calendar, points into
  hexagons, single values into a violin's spread) and say how in the footer.
- More items than the type can hold: merge the smallest into one "Other" part. Rough limits, counting Other: pie
  and doughnut 8, funnel 7, radar 8, waffle 6, bar, lollipop and stacked bar 12, word cloud 40. Other always goes
  last, even when it is bigger than some kept parts, and its note names everything in it. Work out percents after
  merging, so they still add up to 100.
- With more parts than the example you start from, its label placement can break (leaders crossing parts, columns
  lopsided). Split labels into columns by the parts' order round the chart, and look at the screenshot for it.
- Skip empty spacer rows without mentioning them. A row with a label but no value is different: skip it and say so
  in the one-line statement and in the footer.
- Write the rows into the card as one constant at the top of `draw()`. For more than about 60 rows, write only what
  is drawn (the count in each bin, each day's value), not the raw rows.
- Footer: name the source and the period, then what was done to the numbers. The page gets shared, so say "the"
  rather than "your": `--foot "Numbers from the October spending sheet. The seven smallest are merged into Other."`

### 2. Pick the type

Read `references/types.md` and pick by the question, not the subject:

- Parts of a whole: pie, doughnut, waffle, treemap, sunburst, stacked bar.
- Compare amounts: bar, lollipop, bubble, radar, pyramid, word cloud.
- One number against a range: gauge, spectrum.
- Change over time: line, step line, slopegraph, spaghetti, lasagna, candlestick, calendar heatmap, rose.
- How values spread: box, violin, beeswarm, ridgeline, raincloud, hexbin, scatter, Manhattan, volcano.
- Flow and steps: waterfall, funnel, Sankey, flowchart, sequence, swimlane, user journey, kanban, state machine, loop, Gantt, timeline.
- How things connect: org chart, decision tree, mind map, entity relationship, architecture, fishbone, quadrant, Venn, nested, floor plan, exploded view.

If the person names a type, use it. If two fit, pick the one whose question matches theirs and say why in one line.

### 3. Pick the object: something from the person's subject that carries the data

- Default: an object from their topic that can hold the chart's form. Household spending as a pie → coins on a
  table, cut into slices of a coin stack, or a round biscuit tin of coins split by what they are for. A funnel of
  sign-ups → a funnel pouring letters into a postbox. Steps walked as a bar chart → a row of shoe boxes stacked
  to each day's count. A bakery's sales as a pie → then a pie or a cake is the right object, because it is the topic.
- Name the object and say in one line why it fits ("the money is coins, so the slices are coin stacks").
- The chart type must still read at a glance: a pie must still be round and sliced, bars must still stand on one
  baseline, a line must still run left to right.
- Draw the chart as its namesake (a pie chart as a pie) only when the topic is that thing, the person asks for it,
  or nothing in the topic can hold the form.
- Make the object unmistakable. Replace the example's namesake completely: its materials, its details and its
  props. A coin pie needs coin faces with a stamped rim and a number, coin edges you can count, and colours a stack
  of coins really has; not the example's pie with the crust coloured gold. Squint test: if it still reads as the
  example's namesake, it is not done.
- Make the parts tell apart. When the object is one material, give each part its own version of it (copper,
  silver and gold coins; different fruits; different book spines), or its own contents. Never seven slices of the
  same gold.
- Every card is drawn in. Never make a plain chart with a picture beside it.

### 4. Start from the example, then draw

1. Build the example for your type and look at it:
   `python3 assets/build.py --examples <id> -o look.html` (open it, or screenshot it as in step 5).
2. Read its code in `assets/examples.js` (search for `card({id:'<id>'`). Copy that card into your own file,
   e.g. `rent.js`, give it a new `id`, and change the data, the words and the object: keep the example's
   layout, scale and drawing method, and redraw its namesake as the object you picked in step 3.
3. Keep the example's level of detail. The examples are drawn as real objects: real parts and materials (a pie
   has cut faces, a fluted crust wall, crimps and steam vents; a bakery shelf has tiles, a lamp and a counter edge),
   a soft ground shadow, a few small props that make the scene. Match that, or go further. Never ship less.

A card looks like this:

```js
card({id:'rent', name:'Pie chart', of:'where £1,000 of rent goes',
  note:'Each slice is its share of the rent, cut to the true angle. Touch a slice.',
  draw(){
    const D = [['the room',620],['bills',180],['the internet',80],['the cleaner',120]];
    // ... draw with the kit; every data mark goes inside PT(note, fn):
    PT('bills: £180 a month, 18%', () => { /* draw that slice */ }, {lift:[0,-6]});
  }});
```

- `name` is the chart type (it heads the card), `of` is the subject in a few words, `note` is what the card says
  when nothing is touched: one or two short sentences, at most about 150 characters, that say how to read the
  scale ("each loaf drawn is two baked").
- `draw()` writes into a 520 x 420 sheet, origin top left. Keep 14 px clear at every edge.
- Your own helpers go above the card, prefixed with your card's id (`rentSlice`, `rentI`), because the examples'
  helpers (`r0`, `r2…`, `r3…`, `r4…`, `r5…`) are already loaded and you can call them. Never redefine a name
  the engine or the examples use.
- Several cards in one file make one page, two or three across.

### 5. The rules every card keeps

**To scale, and touchable**
- Every value is drawn from its number with one stated scale: an angle (`v/total*360`), a height (`B - v*k`), a
  count of things (one bun per call, a loaf drawn is two baked). Say the scale in words a reader can use: a count
  ("each loaf is two baked"), a labelled value ("£2,400" on the first bar, so the others read against it), or an
  axis. Never pixels.
- Every amount comes from something real in the scene and goes somewhere real. A loss pours into what took it
  (rent into a house, savings into a piggy bank); a gain arrives from what brought it (a sold bike, a returned
  envelope, rain from a cloud). Nothing appears from nowhere.
- Every data mark is wrapped in `PT(note, fn, {lift})`: touching it lifts it, dims the rest and puts its note under
  the card. The note names the label and the value in words: "Saturday: 112 loaves". Decorative parts can be
  touchable too, with a short note, or not touchable at all.
- Totals add up. Shares sum to the whole. Axis labels match the marks.

**Clean ink**
- Use the kit's pen only: `lid`/`rim` for outlines, `ink`/`line` for open strokes, `rule` for thin straight
  lines. The wobble (`LOOSE`) is set for you. Never raise it, never draw an outline twice, no scribbles or hatching.
  Fine parallel lines that belong to the real object (a coin's milled edge, a crate's slats) are fine: keep them
  light, few, and inside the part.
- Outlines 1.1-1.25 wide in the ink colour; inner details lighter and thinner (0.5-0.9, in a darker tone of the
  fill: `mixC(col,TONE,.35)`). Detail is dimmer than outline.
- Fills are flat (`flat`, `wash`, or a solid path) with at most a soft gradient for light. No glows, no noise.
- Lines that should meet, meet: handles touch the cup, a lid sits on its jar, nothing floats.

**Colour**
- Use the colour the real thing has (crust, cherry, enamel, brass, leaves), or the kit's `WASH` colours. Every hex
  is softened into the Minicharts palette at build time, so pick it for meaning and let the build tune it.
- One accent: `RED` marks the one thing to look at (the highest bar, the slice in question). Use it once or twice.

**Layout**
- Turn round charts so the small parts face the front right, where their walls show and their labels have room;
  the big part can sit at the back.
- On a page with one card, `--title` is shown very large: keep it to a few words, and put the rest in `--sub`.
- Part notes say the label, the amount and, for shares, the percent: "rent: £1,150, 50% of October".

**Words**
- Labels sit off the drawing with a leader (`lead(a, b)`: a is the label end, b the thing), or on it where there
  is room. Use `TX` / `TXC`; 13.5 px at least, the hand font is the default. Labels never overlap each other or the marks.
- Plain words. No jargon unless the person uses it. Straight apostrophes (`'`, written `\'` inside a JS string);
  a curly one leaves a gap in small capitals. £, € and other symbols are fine.
- Write numbers yourself, not with `toLocaleString` (it changes with the machine):
  `const money = v => { const [i,d] = String(Math.abs(v)).split('.'); return (v < 0 ? '-' : '')+'£'+i.replace(/\B(?=(\d{3})+$)/g,',')+(d ? '.'+d.padEnd(2,'0') : ''); }`
  (it keeps pence: 412.5 becomes £412.50). Use the sheet's own currency sign.
- Shares shown as percents add up to 100: use one decimal place when whole numbers would not.
- Ids in `<defs>` (gradients, clip paths) start with your card's id, like your helpers.

**No people.** Draw objects, places, plants and animals (animals and plants are allowed to be cute). Where a person
would stand, put what they hold or left behind: a cup, a bag, a bike.

### 6. Build and check

```bash
python3 assets/build.py rent.js -o rent.html --title "Where the rent goes" --sub "one month, £1,000" --foot "Numbers are made up for the drawing."
python3 assets/check.py rent.html
```

`--foot` is the footer's first sentence, and the page adds "Drawn with Minicharts by April Zhu." after it. For the
person's own numbers, say whose they are ("Numbers from the shop's sales for October."); for made-up ones, say so.

`check.py` opens the page in headless Chrome (set `CHROME` if it is not found), writes `rent.png` beside it, and
reports script errors, NaN or undefined in the drawing, cards with no touchable parts, notes over 150 characters,
and writing past the sheet edge. It reads the drawn page, not the source, so it gives no false alarms. "nothing
found" and exit code 0 mean it is clean. A page with one card draws it about 860 px wide, so the screenshot is large.

Then look at `rent.png` full size, as a stranger, at most two rounds of fix-and-look:

- Does it read as the object you picked in one second? Is the chart type still obvious?
- Is anything floating, cut off, overlapping, or too small to read? Labels must also stay clear of the drawing, not
  only of each other: the examples' label placement keeps labels apart but does not know about your objects, so with
  longer names place them by hand.
- Check the numbers against your table: count the buns, measure an angle, compare two bar heights.
- Compare with the example you started from. If yours has less detail, add it.

Hand over the HTML file and say in one line what to touch.

## Credits

The exploded-view conventions are adapted from diagram-design by Cathryn Lavery (MIT). The list of chart types
follows Neon Diagrams. See NOTICE.md.
