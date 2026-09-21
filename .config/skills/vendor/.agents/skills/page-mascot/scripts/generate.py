"""Generate a character's two source sheets with the OpenAI images API.

    python generate.py fox --describe "a cute chibi fox with warm orange fur"
    python generate.py mine --reference ~/my-character.png

Writes characters/<name>/directions.png and reactions.png.

The directions sheet is made first. The expressions sheet is then made through the
EDITS endpoint with that sheet passed in as the reference image, so the model is
matching actual pixels rather than remembering a description. Getting the two sheets
to agree is the whole difficulty of this pipeline -- when they disagree the mascot
visibly jumps the moment it is clicked -- and handing over the first sheet is the
strongest lever available for that.
"""
import argparse
import base64
import io
import os
import re
import sys

import numpy as np
from PIL import Image

from key import key_file

# The newest image model on the account at the time of writing. Later ones hold a
# character's markings together far better across the two sheets, which is the thing
# this pipeline lives or dies on.
DEFAULT_MODEL = 'gpt-image-2.5-sunburst'

# Written to ask for appeal rather than to forbid it. An earlier version inherited
# "FLAT ... no gradients, no glossy 3D shading" from prompts tuned against a model that
# ignored the negatives and added richness anyway. Newer models obey them, and return
# exactly the two-tone, beady-eyed, textureless art that phrasing describes.
COLOUR = ('Cute storybook sticker art: clean bold black outlines with some weight variation, '
          'big expressive eyes each with a bright white catchlight, soft pink cheek blush, '
          'and warm saturated colours. Give it several tones per colour -- a lighter muzzle '
          'or belly, a darker shaded edge, coloured inner ears -- and a textured, tufted '
          'silhouette wherever the character has fur or hair, rather than a smooth blob. '
          'Charming and playful, full of small appealing details. Not flat, not plain, not '
          'minimal. No photorealism, no heavy 3D gloss, no airbrushed gradients.')

# Alternative renderings of the same character. Only the drawing style changes -- every
# structural rule below (bust framing, big head, one reused body, margins) is shared, so a
# style swap cannot break the alignment the whole pipeline depends on.
STYLES = {
    'colour': COLOUR,

    'ink': ('Black and white pen-and-ink drawing. Confident varied-weight black linework with '
            'fine cross-hatching and stippling for shading. NO colour anywhere and no flat grey '
            'fills -- every tone comes from the density of the hatching. Big expressive eyes '
            'with a white catchlight left as clean paper. Crisp, high contrast, plenty of open '
            'white. Charming and characterful, like a children\'s book illustration.'),

    'sketch': ('Loose graphite pencil sketch. Visible hand-drawn strokes with a slightly rough, '
               'searching quality, soft smudged shading, a few construction lines left showing. '
               'Warm grey graphite tones only, no flat colour and no hard vector edges. Big '
               'expressive eyes with a bright highlight left as clean paper. Warm and handmade. Keep '
               'the big-head chibi cartoon proportions and the soft cheek blush exactly as they '
               'would be in colour -- the same cute cartoon character, only drawn in pencil. Do '
               'NOT make it realistic or detailed.'),

    'riso': ('Two-colour risograph print. Flat spot inks in warm coral red and deep teal ONLY, '
             'plus the paper showing through. Visible paper grain, coarse halftone dot texture in '
             'the shaded areas, and a slight misregistration offset between the two ink layers. '
             'Bold simple shapes, no black outline -- forms are defined by the colour blocks.'),

    'paper': ('Cut-paper collage. The character built entirely from flat torn and cut paper '
              'shapes in layered matte colours, with visible paper fibre texture and a soft drop '
              'shadow where one piece overlaps another. No drawn outlines at all -- every edge is '
              'a cut or torn paper edge. Warm, tactile and handmade.'),

    'pixel': ('16-bit pixel art. Chunky visible square pixels on a strict grid, a small limited '
              'palette, hard-edged dithering for shading, a crisp one-pixel dark outline, and '
              'absolutely no anti-aliasing or soft edges anywhere. Readable and characterful at '
              'a small size, like a Super Nintendo sprite.'),
}

TAIL = ('No text, no labels, no borders, no drop shadows, no background colour. '
        'Square image, at least 1024x1024, PNG with alpha transparency.')

# The fallback for a generator that cannot return an alpha channel. Asked for
# transparency it cannot deliver, a model paints the grey-and-white checkerboard that
# stands for it, and those squares run under the character's edges where nothing can
# remove them. So the key prompt does not mention transparency at all -- not even as
# "use green if you cannot" -- because one mention anywhere brings the checkerboard
# back. It asks for a solid colour instead, and key.py removes it afterwards.
KEYS = {'green': ((0, 255, 0), 'pure bright green (#00FF00)'),
        'magenta': ((255, 0, 255), 'pure magenta (#FF00FF)')}


def pick_key(describe):
    """Green, unless the character is itself green. A character survives its own key
    colour in practice -- its greens are duller than a pure key -- but there is no
    reason to spend the margin."""
    return 'magenta' if re.search(r'green|lime|emerald|olive', describe or '', re.I) else 'green'


def rules(key):
    if not key:
        return RULES
    return RULES.replace('fully transparent background',
                         f'a solid flat {KEYS[key][1]} background filling the whole cell')


def tail(key):
    if not key:
        return TAIL
    return ('No text, no labels, no borders, no drop shadows. The background is one flat '
            f'uniform {KEYS[key][1]} covering the entire canvas edge to edge, with no '
            'gradient, texture, pattern or checkerboard, and nothing else on it. '
            'Square image, at least 1024x1024.')

RULES = """LAYOUT: 3 columns by 3 rows, evenly spaced, fully transparent background. Each drawing is head plus upper shoulders, centred in its cell, same character and same head size in all nine cells.

FRAMING: a PORTRAIT BUST. Head, neck and shoulders only. NO arms, NO hands, NO legs, NO lower body. The shoulders are the lowest thing in the cell.

PROPORTIONS: a BIG HEAD chibi that still has a real body. The head is large and dominant, and the shoulders are roughly TWO THIRDS the width of the head -- narrower than the head, but clearly there. Do NOT draw a floating head.

THE RULE THAT MATTERS MOST: draw the BODY ONCE and reuse it. The neck, chest and shoulders must be the EXACT SAME SHAPE in the EXACT SAME POSITION in all nine cells, identical pixels if you can. The body always faces the viewer. Do NOT redraw the body in profile when the head turns. Only the head rotates, on top of an unchanging body.

MARGINS -- this is what goes wrong most often, so follow it literally: each character must sit ENTIRELY INSIDE its own cell with a wide empty gap on all four sides. Draw it at roughly 75% of the cell height, centred, leaving clear empty space above the head AND below the shoulders. The shoulders must STOP WELL SHORT of the bottom edge of the cell -- do not let the body run off the bottom or bleed into the cell underneath. Nothing may touch or cross a cell boundary. Shrink the character equally in every cell if that is what it takes."""

EXPRESSIONS = """1. Eyes closed as two upward curved arcs. No symbol.
2. Same closed arc eyes, plus one clearly visible SMALL RED HEART floating in the empty space above the head. The heart must be present.
3. Same closed arc eyes, plus THREE SMALL YELLOW SPARKLE STARS above the head.
4. Eyes wide open and very round, mouth open in a small round O of surprise.
5. Starstruck: both eyes drawn as bright star shapes, big happy smile.
6. Eyes closed arcs, strong pink blush on both cheeks.
7. Eyes closed sleeping curves, plus a small blue "z z z" above the head.
8. Both eyes drawn as spiral swirls, wavy wobbly mouth. Dizzy.
9. Eyes closed arcs, mouth wide open in a big happy grin."""


def directions_prompt(describe, style, key=None):
    return f"""Generate a 3x3 grid sprite sheet of {describe}. {STYLES[style]}

This sheet is NINE HEAD DIRECTIONS, not expressions -- the face keeps the same calm
expression in every cell and only the direction the head is TURNED changes.

{rules(key)}

Turn the whole head clearly, do not just move the eyes: looking left swings the nose or
muzzle left and brings the far ear or cheek into view.
Row 1: up-left, up, up-right. Row 2: left, straight at the viewer, right.
Row 3: down-left, down, down-right.

NO hearts, NO sparkles, NO "zzz", NO spiral eyes -- no floating symbols of any kind.
{tail(key)}"""


def reactions_prompt(describe, style, key=None):
    # The description is repeated here on purpose. Handing over the first sheet as a
    # reference image is not enough on its own -- the edits endpoint treats it as
    # inspiration and quietly redraws the character, dropping details like whiskers or a
    # belly patch. Restating the colours in words as well as pixels holds it together.
    same = f'The character is {describe}. ' if describe else ''
    look = f'Keep the {style} rendering style of the attached sheet exactly. ' if style != 'colour' else ''
    # The reference sheet arrives already keyed, so its background is transparent while
    # this one is being asked for a solid colour. Saying so stops the model copying the
    # empty background it can see over the instruction it was given.
    where = f'Draw it on the same solid {KEYS[key][1]} background described below. ' if key else ''
    return f"""The attached image is a 3x3 head-direction sprite sheet. Produce the MATCHING
EXPRESSIONS sheet for that same character. {same}{look}{where}Copy the character from the attached image
exactly: the same colours, the same markings, the same fur or surface detail, the same line
weight. Every marking visible in the attached sheet must appear here too. Do not restyle,
simplify or redraw it.

NOT head directions. The character faces STRAIGHT AT THE VIEWER in all nine cells, head
perfectly straight. The only thing that changes between cells is the FACE, plus one small
floating symbol in three of them.

CRITICAL: same character, same art style, same palette, same line weight, same proportions,
and EXACTLY THE SAME SIZE AND POSITION IN THE CELL as the attached sheet. The chest and
shoulders must be the same drawing, the same width, and the same height off the bottom of
the cell as in the attached sheet, identical in all nine cells here. If the two sheets do
not line up the character visibly jumps, so match them.

Wide margin on all four sides, nothing touching a cell edge including the floating symbols,
and clear empty space below the shoulders.

The nine expressions, left to right, top to bottom:
{EXPRESSIONS}

{tail(key)}"""


def reference_prompt(describe, style, key=None):
    # A photograph pulls the model toward photorealism unless it is told, in as many words,
    # to throw the rendering away and keep only the identifying features. Without this the
    # result is a competent portrait illustration that looks nothing like the rest of the set.
    return f"""The attached image shows a person or character. Redraw them as a 3x3 grid sprite
sheet of NINE HEAD DIRECTIONS, in a completely different style from the attached image.

DO NOT reproduce the photograph: not its realism, not its lighting, not its proportions, not
its level of detail. Restyle it completely into a BIG HEAD CHIBI CARTOON -- a head roughly one
and a half times the width of the shoulders, very large round friendly eyes far bigger than a
real person's, a simplified nose and mouth, thick clean outlines and soft cheek blush. Think
children's sticker, not portrait.

Keep ONLY the things that identify them: hair shape and colour, facial hair, the shape and
colour of any glasses, skin tone, and the colour of their top{'. They are ' + describe if describe else ''}.
Simplify everything else away. {STYLES[style]}

The face keeps the same calm friendly expression in every cell; only the direction the head is
TURNED changes.

{rules(key)}

Turn the whole head clearly, do not just move the eyes.
Row 1: up-left, up, up-right. Row 2: left, straight at the viewer, right.
Row 3: down-left, down, down-right.

NO hearts, NO sparkles, NO "zzz", NO spiral eyes -- no floating symbols of any kind.
{tail(key)}"""


def draw(api, model, prompt, reference=None, key=None):
    """One image, as raw bytes. Transparency is a property of this call, not of the
    prompt: without background='transparent' no wording produces an alpha channel. The
    key route asks for the opposite in as many words, so that the background it is
    about to remove is actually painted."""
    def request(**extra):
        if reference:
            with open(reference, 'rb') as handle:
                return api.images.edit(image=[handle], prompt=prompt, model=model,
                                       size='1024x1024', **extra)
        return api.images.generate(prompt=prompt, model=model, size='1024x1024', **extra)

    try:
        result = request(background='opaque' if key else 'transparent')
    except Exception as refused:
        # An older model may not take the parameter at all. Without it the transparent
        # route cannot work, but sheet() sees that in the result and switches routes.
        if 'background' not in str(refused):
            raise
        print(f'  {model} will not take a background parameter')
        result = request()
    return base64.b64decode(result.data[0].b64_json)


def transparent(data):
    image = Image.open(io.BytesIO(data))
    return 'A' in image.mode and (np.array(image.convert('RGBA'))[..., 3] < 10).mean() > 0.05


def sheet(api, model, path, describe, prompt_for, reference=None, key=None):
    """Draw one sheet, and return the key colour it ended up needing, if any.

    The transparent route is tried first and is what a current model does. A model that
    cannot return alpha either rejects the parameter or quietly returns an opaque image
    with a checkerboard painted on it; both mean the same thing, and both are answered
    by redrawing on a solid colour and keying it out. That costs one extra image, and
    only on a generator that cannot do the straightforward thing."""
    if not key:
        data = draw(api, model, prompt_for(None), reference)
        if transparent(data):
            with open(path, 'wb') as handle:
                handle.write(data)
            print(f'  {os.path.basename(path)}  {os.path.getsize(path) // 1024} KB')
            return None
        key = pick_key(describe)
        print(f'  {model} returned no alpha channel, redrawing on {key} and keying it out')

    data = draw(api, model, prompt_for(key), reference)
    with open(path, 'wb') as handle:
        handle.write(data)
    try:
        done = key_file(path, in_place=True) or 'came back with alpha already, nothing keyed'
    except ValueError as problem:
        sys.exit(f'{os.path.basename(path)} cannot be used: {problem}.')
    print(f'  {os.path.basename(path)}  {os.path.getsize(path) // 1024} KB  {done}')
    return key


def client():
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit('openai SDK missing. Run: pip install openai')
    if not os.environ.get('OPENAI_API_KEY'):
        sys.exit('OPENAI_API_KEY is not set.')
    return OpenAI()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('name')
    parser.add_argument('--describe', default='',
                        help='what the character looks like, e.g. "a chibi fox with orange fur"')
    parser.add_argument('--reference', help='an image of an existing character to redraw')
    parser.add_argument('--style', default='colour', choices=sorted(STYLES),
                        help='how the character is drawn; the shape and framing never change')
    parser.add_argument('--only', choices=['directions', 'reactions'],
                        help='regenerate just one sheet, leaving the other alone')
    parser.add_argument('--key', choices=sorted(KEYS),
                        help='skip the transparent route and draw on this solid colour, '
                             'keying it out afterwards. Only for a generator that cannot '
                             'return an alpha channel; the fallback is automatic anyway')
    args = parser.parse_args()

    if not args.describe and not args.reference:
        sys.exit('Give --describe, --reference, or both.')

    root = os.environ.get('MASCOT_ROOT', os.getcwd())
    folder = os.path.join(root, 'characters', args.name)
    os.makedirs(folder, exist_ok=True)
    directions = os.path.join(folder, 'directions.png')
    reactions = os.path.join(folder, 'reactions.png')

    api = client()
    # These models return base64 rather than a URL, and can key out the background
    # instead of painting one in. Override with MASCOT_IMAGE_MODEL.
    model = os.environ.get('MASCOT_IMAGE_MODEL', DEFAULT_MODEL)
    key = args.key

    if args.only != 'reactions':
        if args.reference:
            key = sheet(api, model, directions, args.describe,
                        lambda k: reference_prompt(args.describe, args.style, k),
                        os.path.expanduser(args.reference), key)
        else:
            key = sheet(api, model, directions, args.describe,
                        lambda k: directions_prompt(args.describe, args.style, k), None, key)

    if args.only != 'directions':
        if not os.path.exists(directions):
            sys.exit(f'{directions} is missing; generate the directions sheet first.')
        # Whatever route the directions sheet took, the expressions sheet takes too: it is
        # drawn from that sheet, and the two have to end up the same kind of image.
        sheet(api, model, reactions, args.describe,
              lambda k: reactions_prompt(args.describe, args.style, k), directions, key)


if __name__ == '__main__':
    main()
