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
  bb.agents.contributeInstructions(() => `For visual explanations inside BB chat, prefer composition_reply with native components when the catalogue can express the request. This includes visual explanations, workflows, diagrams, comparisons, metrics, tables, trends and adjustable scenarios. Ordinary requests such as "generate a thing" or "help me visualise my finances" do not imply a standalone HTML page.
Read the composed-replies skill and run bb composed-replies-prototype contract openui for the exact catalogue and syntax. Prefer OpenUI for compact native replies. Publish with composition_reply and include its returned directive in your reply.
Use visual_reply_html or inline-vis HTML for custom applications or interactions that the native catalogue cannot express. Honour explicit requests for a website, HTML file, exported report or a different format.
Use supplied financial data. Ask for missing data rather than inventing the user's finances. Label demonstration data as fictional. Keep visuals focused on the user's question.`);
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
      "Preferred tool for interactive visual explanations inside BB chat: layouts, icons, workflows, diagrams, comparisons, charts, tables and adjustable scenarios. Compose native components rather than a standalone HTML page when the catalogue fits. Read bb composed-replies-prototype contract openui or json-render. Returns a directive to include in your reply.",
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
