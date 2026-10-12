import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, idSchema } from "./contracts";
import { parseComposition } from "./validation";
import { prompt } from "./catalogue";
type Storage = {
  threads: Pick<BbPluginApi["sdk"]["threads"], "storageLocation">;
  files: Pick<BbPluginApi["sdk"]["files"], "read" | "write">;
};
async function save(sdk: Storage, threadId: string, value: unknown) {
  const input = parseComposition(value);
  const location = await sdk.threads.storageLocation({ threadId });
  const id = randomUUID();
  const result = await sdk.files.write({
    hostId: location.hostId,
    rootPath: location.storageRootPath,
    path: `${location.storageRootPath}/composed-replies/${id}.json`,
    content: JSON.stringify(input),
    createParents: true,
    expectedSha256: null,
  });
  if (result.outcome !== "written") throw new Error("Storage conflict");
  return { id, directive: `::composed-reply{id="${id}"}` };
}
export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    read: async ({ threadId, id }) => {
      const loc = await bb.sdk.threads.storageLocation({ threadId });
      const file = await bb.sdk.files.read({
        hostId: loc.hostId,
        rootPath: loc.storageRootPath,
        path: `${loc.storageRootPath}/composed-replies/${idSchema.parse(id)}.json`,
      });
      if (file.content.length > 60000)
        throw new Error("Storage limit exceeded");
      return parseComposition(JSON.parse(file.content));
    },
  });
  bb.agents.registerTool({
    name: "composition_reply",
    description:
      "Store a native composed interactive response. Returns a directive to include in your reply. Get exact component contract from bb composed-replies-prototype contract openui or json-render.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["openui", "json-render"] },
        source: { type: "string", maxLength: 50000 },
        title: { type: "string", maxLength: 100 },
      },
      required: ["format", "source", "title"],
      additionalProperties: false,
    },
    execute: async (input, ctx) =>
      JSON.stringify(await save(bb.sdk, ctx.threadId, input)),
  });
  bb.cli.register({
    name: "composed-replies-prototype",
    summary: "Native composed replies and catalogue contracts",
    commands: [
      {
        name: "contract",
        summary: "Print exact language contract",
        usage: "bb composed-replies-prototype contract openui|json-render",
      },
      {
        name: "publish",
        summary: "Store composition JSON from a file",
        usage:
          "bb composed-replies-prototype publish <absolute-input-json-path>",
      },
    ],
    run: async (argv, ctx) => {
      if (
        argv[0] === "contract" &&
        (argv[1] === "openui" || argv[1] === "json-render")
      )
        return { exitCode: 0, stdout: prompt(argv[1]) };
      if (argv[0] === "publish" && argv[1] && ctx.threadId) {
        const loc = await bb.sdk.threads.storageLocation({
          threadId: ctx.threadId,
        });
        const file = await bb.sdk.files.read({
          hostId: loc.hostId,
          rootPath: loc.storageRootPath,
          path: argv[1],
        });
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            await save(bb.sdk, ctx.threadId, JSON.parse(file.content)),
          ),
        };
      }
      return {
        exitCode: 1,
        stderr:
          "Use contract openui|json-render, or publish a thread-storage input file.",
      };
    },
  });
}
