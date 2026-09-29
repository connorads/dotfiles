import { choice, defineHexConfig, digit, letter, union } from "@hex/commands"

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
