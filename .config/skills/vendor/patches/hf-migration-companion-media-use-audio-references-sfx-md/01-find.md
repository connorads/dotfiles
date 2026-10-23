- **The bundled 21-file library is the fallback** (`assets/sfx/` + `manifest.json`): a cue Openverse has no usable match for, and every cue once Openverse is offline or rate limited, is matched against it and the file copied into the project.

There is no `npx hyperframes sfx` command. SFX is never generated — it is retrieved from Openverse (online) or taken from the bundled library (offline). `npx hyperframes media-use resolve --type sfx` follows the same order (`--local-only` skips Openverse).

## Licences
