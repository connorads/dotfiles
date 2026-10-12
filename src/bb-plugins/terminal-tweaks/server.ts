import type { BbPluginApi } from '@get-bb/plugin-sdk';

// BB requires a server entry; all behaviour lives in the frontend content script.
export default function plugin(_bb: BbPluginApi) {}
