import { experimental_defineProviderBridge } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { createSandboxBridgeController } from "./src/bridge/sandbox-bridge.js";

let stdoutHooked = false;
let originalStdoutWrite: typeof process.stdout.write | null = null;

function writeLineToRuntime(line: string): void {
  const writer = originalStdoutWrite ?? process.stdout.write.bind(process.stdout);
  writer(`${line}\n`);
}

const controller = createSandboxBridgeController({
  innerBridge: experimental_acpProviderBridge,
  writeRuntimeLine: writeLineToRuntime,
});

function installStdoutInterceptor(): void {
  if (stdoutHooked) return;
  stdoutHooked = true;
  const rawWrite = process.stdout.write.bind(process.stdout);
  originalStdoutWrite = rawWrite;
  let pendingBuffer = "";

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.from(chunk).toString(
            typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8",
          );
    pendingBuffer += text;

    let passthrough = "";
    let newlineIndex: number;
    while ((newlineIndex = pendingBuffer.indexOf("\n")) !== -1) {
      const line = pendingBuffer.slice(0, newlineIndex);
      pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
      if (!controller.interceptOutboundLine(line)) {
        passthrough += `${line}\n`;
      }
    }

    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (passthrough.length > 0) {
      return done ? rawWrite(passthrough, done) : rawWrite(passthrough);
    }
    done?.(null);
    return true;
  }) as typeof process.stdout.write;
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  start(context) {
    installStdoutInterceptor();
    controller.start(context);
  },
  handleLine(line) {
    controller.handleLine(line);
  },
  onClose() {
    controller.onClose();
  },
  onSigterm() {
    controller.onSigterm();
  },
  onSigint() {
    controller.onSigint();
  },
});
