import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const row = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), ref: z.string(), source: z.string(), count: z.number() }),
  z.object({ kind: z.literal('skill'), ref: z.string(), source: z.string(), name: z.string(), description: z.string() }),
]);
// A skl ref is one token (`source/name` or `source/`). Refusing a leading `-`
// keeps a ref from reaching skl's argv as a flag.
const ref = z.string().regex(/^[^\s-]\S*$/, 'not a skl ref');
const refs = z.array(ref).min(1).max(200);
const install = z.object({ ok: z.boolean(), output: z.string() });

/** Server -> host worker on the thread's machine, where skl and the catalogue live. */
export const hostContract = defineRpcContract({
  list: { input: z.object({}), output: z.object({ rows: z.array(row) }) },
  preview: { input: z.object({ ref }), output: z.object({ text: z.string() }) },
  pointers: { input: z.object({ refs }), output: z.object({ text: z.string() }) },
  install: { input: z.object({ refs, cwd: z.string().min(1) }), output: install },
});

/** App -> server. The server resolves host and cwd from the thread; the app never names a path. */
export const rpcContract = defineRpcContract({
  catalogue: {
    input: z.object({ threadId: z.string().nullable() }),
    output: z.object({ hostId: z.string(), canInstall: z.boolean(), rows: z.array(row) }),
  },
  preview: { input: z.object({ hostId: z.string(), ref }), output: z.object({ text: z.string() }) },
  pointers: { input: z.object({ hostId: z.string(), refs }), output: z.object({ text: z.string() }) },
  install: { input: z.object({ threadId: z.string(), refs }), output: install },
});
