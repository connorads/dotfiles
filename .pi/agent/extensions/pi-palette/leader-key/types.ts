/**
 * Leader Key Types
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface ActionItem {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly action: (ctx: ExtensionContext) => void | Promise<void>;
}

export interface ActionGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly ActionItem[];
}

export type TopLevelEntry =
  | { readonly type: "group"; readonly group: ActionGroup }
  | {
      readonly type: "action";
      readonly key: string;
      readonly label: string;
      readonly description?: string;
      readonly action: (ctx: ExtensionContext) => void | Promise<void>;
    };
