# Token Schema

`tokens.raw.json` is script output. Keep it as evidence. `tokens.json` is the
curated handoff used by page builders or future agents.

## Folder contract

```text
brand-capture/
  sources.md
  tokens.raw.json
  tokens.json
  brand-brief.md
  verification.md
  raw/
    assets/
      candidates/
  assets/
    logos/
    icons/
    images/
    screenshots/
```

## `tokens.json`

Use this shape unless the consuming project already has a token schema.

```json
{
  "brand": {
    "name": "Example",
    "official_url": "https://example.com",
    "captured_at": "YYYY-MM-DD",
    "confidence": "confirmed",
    "notes": []
  },
  "sources": [
    {
      "label": "Homepage CSS",
      "url": "https://example.com/app.css",
      "kind": "css",
      "confidence": "confirmed"
    }
  ],
  "colours": {
    "primary": [
      {
        "name": "brand-primary",
        "value": "#000000",
        "role": "Primary action and active states",
        "source": "Homepage CSS",
        "confidence": "confirmed"
      }
    ],
    "secondary": [],
    "accent": [],
    "neutral": [],
    "semantic": [],
    "gradients": []
  },
  "typography": {
    "families": [
      {
        "name": "Inter",
        "role": "UI/body",
        "fallback": "system-ui, sans-serif",
        "source": "Homepage CSS",
        "licence": "web-served; verify before bundling",
        "confidence": "likely"
      }
    ],
    "scale": [],
    "weights": [],
    "line_heights": [],
    "licence_notes": []
  },
  "shape": {
    "radii": [],
    "borders": [],
    "shadows": []
  },
  "spacing": {
    "scale": [],
    "density": "unknown",
    "notes": []
  },
  "assets": {
    "logos": [],
    "icons": [],
    "images": [],
    "screenshots": []
  },
  "style_notes": {
    "layout": [],
    "components": [],
    "imagery": [],
    "motion": [],
    "voice": []
  },
  "constraints": {
    "do_not_copy": [],
    "requires_permission": [],
    "unknowns": []
  }
}
```

## `brand-brief.md`

Keep it short and usable:

- Identity: official name, URL, captured date, confidence.
- Use: primary palette, secondary palette, type direction, layout rhythm,
  imagery, component feel.
- Avoid: exact page copies, restricted flows, marks without permission, stale
  assets, low-confidence guesses.
- Assets: local paths and source URLs.
- Unknowns: anything that needs user confirmation or licensed files.

## Token judgement

Do not promote every raw value. Repeated CSS variables, guideline values, and
site-wide declarations beat incidental one-off values. When in doubt, keep a
value in `tokens.raw.json` and mention the uncertainty in `brand-brief.md`.

Prefer named CSS variables over raw frequency counts when they clearly encode
the design system. Convert CSS RGB triplets such as `--color-brand: 54 108 237`
to hex for curated tokens, and record gradients separately from flat colours.
