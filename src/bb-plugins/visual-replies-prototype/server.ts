import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { htmlInput, rpcContract, visualId } from "./contracts";
import { queueHtml } from "./queue";

type VisualStorageSdk = {
  threads: Pick<BbPluginApi["sdk"]["threads"], "storageLocation">;
  files: Pick<BbPluginApi["sdk"]["files"], "read" | "write">;
};
export async function saveVisual(sdk: VisualStorageSdk, threadId: string, input: unknown) {
  const parsed = htmlInput.parse(input);
  const location = await sdk.threads.storageLocation({ threadId });
  const id = randomUUID();
  const path = `${location.storageRootPath}/visual-replies/${id}.json`;
  const metadata = await sdk.files.write({ hostId: location.hostId, rootPath: location.storageRootPath, path, content: JSON.stringify(parsed), createParents: true, expectedSha256: null });
  if (metadata.outcome !== "written") throw new Error("Visual storage conflict");
  const htmlPath = `${location.storageRootPath}/visual-replies/${id}.html`;
  const artefact = await sdk.files.write({ hostId: location.hostId, rootPath: location.storageRootPath, path: htmlPath, content: parsed.html, createParents: true, expectedSha256: null });
  if (artefact.outcome !== "written") throw new Error("Visual storage conflict");
  return { id, path: htmlPath, directive: `::visual-reply{id="${id}"}` };
}
export async function readVisual(sdk: VisualStorageSdk, threadId: string, id: string) {
  const parsed = visualId.parse(id);
  const location = await sdk.threads.storageLocation({ threadId });
  const file = await sdk.files.read({ hostId: location.hostId, rootPath: location.storageRootPath, path: `${location.storageRootPath}/visual-replies/${parsed}.json` });
  if (file.content.length > 1_000_000) throw new Error("Visual exceeds storage limit");
  return htmlInput.parse(JSON.parse(file.content));
}
export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, { read: ({ threadId, id }) => readVisual(bb.sdk, threadId, id) });
  bb.agents.registerTool({
    name: "visual_reply_html",
    description: "Store self-contained interactive HTML in this thread. Returns a directive to include on its own line in the assistant reply.",
    instructions: "Use compact labelled controls and one useful visual. Use var(--foreground), var(--muted-foreground), var(--primary), var(--border), var(--font-sans), var(--font-mono). Keep the outer surface transparent. Avoid dashboard wrappers, redundant titles/cards and repeated prose. For charts, measure the container with ResizeObserver and use a fixed pixel chart height. Never shrink SVG labels through a fixed-width viewBox. Keep labels at least 11 screen pixels and include axis units. No remote dependencies. Include the returned ::visual-reply directive in your reply; the tool result itself does not render the HTML.",
    parameters: { type: "object", properties: { html: { type: "string", minLength: 1, maxLength: 200_000 }, title: { type: "string", minLength: 1, maxLength: 100 } }, required: ["html", "title"], additionalProperties: false },
    execute: async (input, ctx) => JSON.stringify(await saveVisual(bb.sdk, ctx.threadId, input)),
  });
  bb.cli.register({
    name: "visual-replies-prototype",
    summary: "Store the queue explorer in the invoking thread",
    commands: [{ name: "queue", summary: "Create the queue explorer", usage: "bb visual-replies-prototype queue" }],
    async run(argv, ctx) {
      if (argv.length !== 1 || argv[0] !== "queue" || !ctx.threadId) return { exitCode: 1, stderr: "Run bb visual-replies-prototype queue inside a BB thread." };
      return { exitCode: 0, stdout: JSON.stringify(await saveVisual(bb.sdk, ctx.threadId, { title: "Queue explorer", html: queueHtml() })) };
    },
  });
}
