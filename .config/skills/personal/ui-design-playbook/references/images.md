# Working with Images

Photography, screenshots, icons, and user-supplied media each have their own failure modes. Source quality first, size deliberately, and tame anything you don't control.

## Text Over Images

**Source real photography.** Use professionally shot or high-quality stock photos, and never ship a placeholder you plan to swap for a phone snap later. Weak photography undermines an otherwise polished design, and good results lean on lighting, composition, and colour skills you can't fake at the last minute.

**Fix the image, not the text.** When a headline over a photo stays unreadable no matter what colour you try, tame the image instead of recolouring the text. Photos contain both very light and very dark regions, so no single text colour can stay legible across the whole frame.

**Reduce image dynamics for legibility.** Flatten the gap between the lightest and darkest areas of a background photo so text-to-image contrast stays even everywhere. Light text disappears in light patches and dark text disappears in dark ones; levelling the image keeps contrast uniform under the type.

**Overlay to lift contrast.** Lay a semi-transparent colour layer over the photo: dark overlay for light text, light overlay for dark text. The overlay compresses the image's tonal range so one text colour reads consistently across the whole frame.

```css
.hero { position: relative; }
.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.hero h1 { position: relative; color: #fff; }
```

**Lower image contrast for control.** Instead of (or alongside) an overlay, drop the photo's own contrast and nudge brightness back up to compensate. An overlay tints everything uniformly; reducing the image's contrast targets only the tonal extremes while preserving the intended overall lightness.

```css
img.hero { filter: contrast(0.7) brightness(1.05); }
```

**Colourise to unify tone.** Recolour a busy photo with a single hue: lower its contrast, desaturate it, then apply a solid fill in multiply blend mode. A single-colour image gives text a predictable backdrop and can tie the photo to your brand palette.

```css
.photo { filter: contrast(0.85) saturate(0); }
.photo .tint { mix-blend-mode: multiply; background: #1e3a8a; }
```

**Use a glow-like text shadow.** To keep more of a photo's natural contrast, give the text a shadow with a large blur radius and zero offset so it reads as a soft glow rather than a drop shadow. The blurred, offset-free shadow only boosts contrast directly behind the glyphs, letting you tame the image less aggressively.

```css
h1 {
  color: #fff;
  text-shadow: 0 0 25px rgba(0, 0, 0, 0.7);
}
```

## Sizing

**Respect intended image size.** Design every image at the size it was made for; assume no asset is safe to rescale freely. Raster images go fuzzy when enlarged, and even vectors break down when used far from their intended scale.

**Don't enlarge small icons.** Never blow a 16-24px icon up to 3-4x for a feature graphic; sit the icon at its native size inside a coloured background shape instead. Vectors stay sharp but small-icon artwork looks chunky and detail-starved when magnified, whereas a containing shape fills the space without distorting it.

```css
.icon-badge {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background: #e0e7ff;
}
.icon-badge svg { width: 24px; height: 24px; }
```

**Don't shrink full screenshots.** Avoid cramming a full-size app screenshot into a small slot by scaling it down hard. Shrinking turns 16px app text into unreadable 4px text and forces viewers to squint at detail they can't parse.

**Capture screenshots small.** Take screenshots at a smaller viewport (e.g. a tablet layout) and give them generous space so little downscaling is needed. A natively smaller capture keeps text and UI legible without cramming detail.

**Crop to a partial screenshot.** When space is tight, show only a meaningful slice of the interface rather than the whole screen scaled down. A partial crop fits a small area at native resolution and stays crisp.

**Abstract the UI when space is tiny.** For a whole-app preview in very little space, draw a simplified mockup with detail stripped and small text replaced by plain lines. It conveys the overall layout without tempting anyone to decode unreadable detail.

**Don't shrink large icons either.** Don't squeeze an icon or logo drawn large down to a tiny target; redraw a simplified version at the intended small size. Downscaled detailed art turns choppy and fuzzy, so hand-controlled simplification beats letting the renderer mangle it.

**Draw favicons at target size.** Create a dedicated, stripped-down favicon at 16px rather than letting the browser auto-shrink a detailed logo. A 128px logo crushed into a 16px square turns to mush; redrawing lets you choose which details survive.

## User-Supplied Images

**Constrain user image shape.** Place uploads in fixed-size containers, centred and cropped with `cover`, instead of rendering them at their intrinsic aspect ratios. Arbitrary user ratios wreck layout consistency, especially across grids of many images.

```css
.avatar {
  width: 80px;
  height: 80px;
  background-position: center;
  background-size: cover;
}
```

**Prevent background bleed.** Guard images against blending into a same-coloured UI background with a subtle inner shadow rather than a border. A hard border clashes with image colours, while a faint inset shadow defines the edge almost invisibly.

```css
.user-img { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1); }
```

**Semi-transparent inner border option.** If the inset shadow's look isn't wanted, define the edge with a translucent inner border instead. It separates image from background without committing to a solid colour that fights the photo.

```css
.user-img { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15); }
```
