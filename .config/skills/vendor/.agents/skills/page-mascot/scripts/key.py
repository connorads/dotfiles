"""Key a solid background out of a sheet that came back without alpha.

    python3 key.py characters/fox/directions.png [--in-place]

Image tools that cannot emit an alpha channel paint a grey-and-white checkerboard
where the transparency should be, and that cannot be removed -- its squares run under
the character's edges. The way around it is to ask for a solid chroma key instead,
with no mention of transparency anywhere in the prompt, and remove that colour here.

Keying is a fallback for tools without a transparent-background option, not an
improvement on one. Where the option exists, use it.
"""
import argparse
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# How close to the key colour a pixel must be to vanish, and how far to be left alone,
# as CIE Lab distance. The gap between them is the soft edge: wide enough to catch the
# antialiased fringe, narrow enough to leave a character's own colours untouched.
TOL_LOW = 6.0
TOL_HIGH = 26.0

# A key colour has to be one the character does not contain, which in practice means a
# saturated one: the spread between its strongest and weakest channel. White, grey and
# black backgrounds fall under this and are not keyable -- a cream muzzle or a black
# outline reaching the silhouette's edge would be removed along with the background.
SATURATED = 100

# Below this the corners disagree, so there is no single background colour to remove --
# which is what a checkerboard, a gradient or a drawn scene looks like from here.
UNIFORM = 0.9


def _corr(a, b):
    a, b = a.ravel(), b.ravel()
    va, vb = a.std(), b.std()
    if va < 1e-6 or vb < 1e-6:
        return 0.0
    return float(np.dot(a - a.mean(), b - b.mean()) / (len(a) * va * vb))


def _period_score(hp, p):
    h, w = hp.shape
    if h <= p or w <= p:
        return 0.0
    diag = _corr(hp[:h - p, :w - p], hp[p:, p:])
    xax = _corr(hp[:, :w - p], hp[:, p:])
    yax = _corr(hp[:h - p, :], hp[p:, :])
    return diag - (xax + yax) / 2


def _region_score(patch):
    g = patch.mean(axis=2).astype(np.float64)
    h, w = g.shape
    if min(h, w) < 32 or g.std() < 1.5:
        return 0.0, 0
    hp = g - ndimage.uniform_filter(g, size=(max(3, min(h, w) // 8) | 1))
    best, best_p = 0.0, 0
    for p in range(6, min(65, min(h, w) - 1)):
        score = _period_score(hp, p)
        if score > best:
            best, best_p = score, p
    if best_p == 0:
        return 0.0, 0
    hh, hw = h // 2, w // 2
    quads = [hp[:hh, :hw], hp[:hh, hw:], hp[hh:, :hw], hp[hh:, hw:]]
    conf = float(np.clip(sorted(_period_score(q, best_p) for q in quads)[1] / 1.6, 0.0, 1.0))
    hist, _ = np.histogram(g, bins=32)
    if np.sort(hist)[-2:].sum() / (hist.sum() + 1e-9) < 0.4:
        conf *= 0.5
    return conf, best_p


def checkerboard(rgba):
    """(confidence 0..1, square size in px) that the sheet has a painted-on transparency
    checkerboard. Image models draw one whenever they are asked for transparency but the
    request did not actually enable an alpha channel: unable to emit alpha, the model
    draws the pattern that stands for it. Samples the four corners and the four gaps
    between cells, where the background is guaranteed to show, and looks for a two-tone
    square wave that repeats at the same period along both axes."""
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3]
    m = min(h, w) // 8
    th, tw = h // 3, w // 3
    regions = [
        rgb[0:m, 0:m], rgb[0:m, w - m:w], rgb[h - m:h, 0:m], rgb[h - m:h, w - m:w],
        rgb[th - m // 2:th + m // 2, :], rgb[2 * th - m // 2:2 * th + m // 2, :],
        rgb[:, tw - m // 2:tw + m // 2], rgb[:, 2 * tw - m // 2:2 * tw + m // 2],
    ]
    scores = sorted((_region_score(r) for r in regions if r.size), key=lambda s: s[0], reverse=True)
    top = [s for s in scores[:2] if s[0] > 0]
    if len(top) < 2:
        return 0.0, 0
    return float(np.mean([s[0] for s in top])), int(np.median([s[1] for s in top]))


def _linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _f(t):
    d = 6.0 / 29.0
    return np.where(t > d ** 3, np.cbrt(t), t / (3 * d * d) + 4.0 / 29.0)


def lab(rgb):
    r, g, b = _linear(rgb[..., 0]), _linear(rgb[..., 1]), _linear(rgb[..., 2])
    x = _f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
    y = _f(0.2126729 * r + 0.7151522 * g + 0.0721750 * b)
    z = _f((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883)
    return np.stack([116 * y - 16, 500 * (x - y), 200 * (y - z)], axis=-1)


def keyable(colour):
    return float(colour.max() - colour.min()) >= SATURATED


def background(rgba):
    """(colour, how much of the four corners actually is that colour)."""
    h, w = rgba.shape[:2]
    p = min(40, h // 4, w // 4)
    corners = np.concatenate([rgba[:p, :p, :3].reshape(-1, 3), rgba[:p, w - p:, :3].reshape(-1, 3),
                              rgba[h - p:, :p, :3].reshape(-1, 3), rgba[h - p:, w - p:, :3].reshape(-1, 3)])
    colour = np.median(corners, axis=0).astype(np.float64)
    agree = (np.sqrt(((lab(corners.astype(np.float64)) - lab(colour[None])) ** 2).sum(-1)) < TOL_HIGH).mean()
    return colour, float(agree)


def key_out(rgba, colour):
    """Replace everything matching `colour` with transparency. Returns (rgba, stats)."""
    rgb = rgba[..., :3].astype(np.float64)
    distance = np.sqrt(((lab(rgb) - lab(np.asarray(colour, dtype=np.float64)[None, None])) ** 2).sum(-1))
    alpha = np.clip((distance - TOL_LOW) / (TOL_HIGH - TOL_LOW), 0.0, 1.0)

    # A half-transparent edge pixel is part character, part key colour. Un-premultiply
    # it against the key so the fringe does not keep a green or magenta cast.
    safe = np.clip(alpha, 0.04, 1.0)[..., None]
    despilled = np.clip((rgb - (1 - safe) * np.asarray(colour, dtype=np.float64)) / safe, 0, 255)
    edge = (alpha < 1.0)[..., None]
    out_rgb = np.where(edge, despilled, rgb)

    # A character can legitimately contain the key colour -- a green frog against a
    # green key. What separates background from character is not the colour but whether
    # it reaches the edge of the image, so only keep the regions that touch the border.
    candidate = alpha < 0.999
    labels, _ = ndimage.label(candidate, structure=np.ones((3, 3), dtype=int))
    touching = set(np.unique(labels[0])) | set(np.unique(labels[-1]))
    touching |= set(np.unique(labels[:, 0])) | set(np.unique(labels[:, -1]))
    touching.discard(0)
    enclosed = candidate & ~np.isin(labels, list(touching)) if touching else candidate

    alpha = np.where(enclosed, 1.0, alpha)
    out_rgb = np.where(enclosed[..., None], rgb, out_rgb)

    out = np.empty(rgba.shape[:2] + (4,), dtype=np.uint8)
    out[..., :3] = np.clip(out_rgb, 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    stats = dict(hex='#%02X%02X%02X' % tuple(np.clip(colour, 0, 255).astype(int)),
                 keyed=float((alpha < 0.02).mean()),
                 protected=float(enclosed.sum() / max(int(candidate.sum()), 1)))
    return out, stats


def key_file(path, in_place=False):
    """Key one sheet on disk. Returns a line describing what happened, or None when
    the sheet already has alpha and nothing needed doing."""
    image = Image.open(path)
    rgba = np.array(image.convert('RGBA'))
    if (rgba[..., 3] < 10).mean() > 0.05:
        return None

    painted, square = checkerboard(rgba)
    if painted >= 0.5:
        raise ValueError(f'it is on a painted transparency checkerboard ({square}px squares), '
                         f'which cannot be keyed out -- its squares run under the character\'s '
                         f'edges. Redraw it, either with the tool\'s transparent-background '
                         f'option on, or on a solid key colour with no mention of transparency '
                         f'anywhere in the prompt')

    colour, agree = background(rgba)
    if not keyable(colour):
        raise ValueError(f'the background is {"#%02X%02X%02X" % tuple(colour.astype(int))}, which is '
                         f'too close to neutral to key: the character\'s own pale or dark areas '
                         f'would go with it. Redraw on a saturated key colour')
    if agree < UNIFORM:
        raise ValueError(f'the background is not one solid colour ({agree * 100:.0f}% of the '
                         f'corners match), so there is nothing to key out')

    out, stats = key_out(rgba, colour)
    if stats['keyed'] < 0.2:
        raise ValueError(f'keying {stats["hex"]} would remove only {stats["keyed"] * 100:.0f}% '
                         f'of the sheet, so that colour is not the background')

    destination = path if in_place else path.rsplit('.', 1)[0] + '-keyed.png'
    Image.fromarray(out, 'RGBA').save(destination)
    return (f'keyed out {stats["hex"]}: {stats["keyed"] * 100:.0f}% of the sheet is now '
            f'transparent, {stats["protected"] * 100:.0f}% kept as enclosed detail')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('paths', nargs='+')
    parser.add_argument('--in-place', action='store_true', help='overwrite instead of writing -keyed.png')
    args = parser.parse_args()
    for path in args.paths:
        try:
            line = key_file(path, args.in_place)
        except ValueError as problem:
            sys.exit(f'{path}: {problem}')
        print(f'  {path.split("/")[-1]}  {line or "already has an alpha channel, left alone"}')


if __name__ == '__main__':
    main()
