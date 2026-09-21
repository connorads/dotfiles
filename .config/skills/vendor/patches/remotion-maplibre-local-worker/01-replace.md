## Local worker modules

{{marker}}

MapLibre 6 workers import a sibling shared module. Copy both files from the project's locked `maplibre-gl` package into Remotion's `public` directory before bundling or rendering. Keep the package lockfile and use the project's normal protected install process. If either module is absent, stop and check the installed package version.

Create `scripts/copy-maplibre-worker.mjs`:

```js
import {copyFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';

const dist = join(dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')), 'dist');
const destination = join(process.cwd(), 'public', 'maplibre');
mkdirSync(destination, {recursive: true});
for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(dist, name), join(destination, name));
}
```

Add this entry to the existing `package.json` scripts, preserving every existing entry:

```json
"copy:map-worker": "node scripts/copy-maplibre-worker.mjs"
```

Run `pnpm copy:map-worker` before the project's existing preview, bundle or render command, including after each MapLibre dependency change. In CI, run it after the frozen-lockfile install and before the existing build/render step. If the project customises Remotion's `publicDir`, use that directory as the copy destination. Keep this an explicit task rather than an install lifecycle hook.

Use `staticFile('maplibre/maplibre-gl-worker.mjs')` before constructing each map. Both modules are served locally from the same package version as the bundled main library. Do not substitute executable CDN URLs.

[MapLibre worker setup](https://maplibre.org/maplibre-gl-js/docs/#esm) documents the sibling-module requirement.

## Basic map with a local worker
