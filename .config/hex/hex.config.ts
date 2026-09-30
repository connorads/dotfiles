import { choice, defineHexConfig, digit, letter, union } from "@hex/commands"
import { runGoto, runNext, runStart } from "./voice/run.ts"
import { systemPorts } from "./voice/system.ts"

export default defineHexConfig({
  // Transformations appear as optional final steps in every dictation mode.
  // transformations: {
  //   "trim-whitespace": {
  //     name: "Trim whitespace",
  //     description: "Remove leading and trailing whitespace",
  //     transform: (text) => text.trim(),
  //   },
  // },
  // Uncomment this block to replace HEX's native voice-dictation protocol.
  // dictation: {
  //   start: ["begin note"],
  //   stop: ["finish note"],
  //   send: ["send note"],
  //   cancel: ["discard note"],
  // },
  commands: {
    // Choice aliases must be single words; keys are the macOS app names.
    "open-app": {
      phrases: ["open {app}", "switch to {app}"],
      captures: {
        app: choice({
          Slack: ["slack"],
          "Brave Browser": ["brave", "browser"],
          kitty: ["kitty", "terminal"],
          Obsidian: ["obsidian"],
          Linear: ["linear"],
          Notion: ["notion"],
          Claude: ["claude"],
          ChatGPT: ["chatgpt"],
          "Visual Studio Code": ["code", "vscode"],
          Zed: ["zed"],
          Cursor: ["cursor"],
          Figma: ["figma"],
          Discord: ["discord"],
          WhatsApp: ["whatsapp"],
          "Telegram Desktop": ["telegram"],
          "Microsoft Teams": ["teams"],
          "zoom.us": ["zoom"],
          Mail: ["mail", "email"],
          Calendar: ["calendar"],
          Messages: ["messages"],
          Music: ["music"],
          Finder: ["finder", "files"],
          "System Settings": ["settings"],
        } as const),
      },
      group: "Apps",
      description: "Open or switch to an app",
      run: ({ hex, captures }) => hex.openApplication(captures.app),
    },
    // Global rather than kitty-scoped: both bring kitty forward on the pane.
    "go-to-pane": {
      phrases: ["go to {target}"],
      group: "Agents",
      description: "Jump to the agent pane matching a spoken description",
      run: async ({ hex, captures }) => {
        if ((await runGoto(systemPorts, captures.target ?? "")) === "jump") await hex.openApplication("kitty")
      },
    },
    "next-agent": {
      phrases: ["next {state}"],
      captures: {
        state: choice({ blocked: ["blocked", "stuck", "waiting"], done: ["done", "finished"] } as const),
      },
      group: "Agents",
      description: "Cycle to the next blocked or done agent pane",
      run: async ({ hex, captures }) => {
        if (await runNext(systemPorts, captures.state)) await hex.openApplication("kitty")
      },
    },
    "start-agent": {
      phrases: ["start agent in {project}", "new agent in {project}"],
      group: "Agents",
      description: "Open a tmux window in the spoken project and start claude",
      run: async ({ hex, captures }) => {
        if ((await runStart(systemPorts, captures.project ?? "")) === "start") await hex.openApplication("kitty")
      },
    },
    // Claude Code's permission prompt and question menu both select on a bare
    // digit, no Enter needed.
    "choose-option": {
      phrases: ["choose {n}"],
      captures: { n: digit({ min: 1, max: 9 }) },
      when: { application: "kitty" },
      group: "Agents",
      description: "Pick a numbered option in an agent menu",
      run: ({ hex, captures }) => hex.press({ key: String(captures.n) }),
    },
    confirm: {
      phrases: ["confirm"],
      when: { application: "kitty" },
      group: "Agents",
      description: "Press Enter",
      run: ({ hex }) => hex.press({ key: "enter" }),
    },
    cancel: {
      phrases: ["cancel"],
      when: { application: "kitty" },
      group: "Agents",
      description: "Press Escape",
      run: ({ hex }) => hex.press({ key: "escape" }),
    },
    "open-example": {
      phrases: ["open example"],
      group: "Websites",
      description: "Open the example site",
      run: ({ hex }) => hex.openUrl("https://example.com"),
    },
    // A trailing {capture} placeholder collects the rest of the spoken
    // phrase: "search amazon for wool socks" -> captures.query === "wool socks".
    "search-amazon": {
      phrases: ["search amazon for {query}"],
      group: "Websites",
      description: "Search Amazon for the spoken words",
      run: ({ hex, captures }) =>
        hex.openUrl(`https://www.amazon.com/s?k=${encodeURIComponent(captures.query ?? "")}`),
    },
    // Explicit descriptors compose multiple captures and infer exact handler types.
    "control-key": {
      phrases: ["control {key}"],
      captures: { key: union(letter(), digit(), choice(["home", "end"] as const)) },
      group: "Keyboard",
      description: "Press Control plus a letter, digit, Home, or End",
      run: ({ hex, captures }) =>
        hex.press({ key: String(captures.key), modifiers: ["control"] }),
    },
  },
})
