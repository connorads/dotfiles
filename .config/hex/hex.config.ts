import { choice, defineHexConfig, digit, letter, union } from "@hex/commands"
import { runGoto, runNext, runStart } from "./voice/run.ts"
import { systemPorts } from "./voice/system.ts"
import { matchBb, requestBb, runBb } from "./voice/bb.ts"
import { runSpeech } from "./voice/speech.ts"

const bbPorts = { ...systemPorts, request: requestBb }

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
    "bb-focus": {
      phrases: ["focus chat", "focus message", "focus composer"],
      when: { application: "bb" },
      group: "BB",
      description: "Focus the selected BB chat input for dictation",
      run: async () => { await runBb(bbPorts, { action: "focus" }) },
    },
    "bb-go-to": {
      phrases: ["go to {target}", "take me to {target}", "can i go to {target}"],
      when: { application: "bb" },
      group: "BB",
      description: "Find a BB thread by title or description",
      run: async ({ hex, captures }) => {
        const reply = await matchBb(bbPorts, "thread", captures.target ?? "")
        if (reply.ok && reply.press) await hex.press(reply.press)
      },
    },
    "bb-next": {
      phrases: ["next thread", "next conversation"],
      when: { application: "bb" },
      group: "BB",
      description: "Go to the next BB thread",
      run: async ({ hex }) => {
        const reply = await runBb(bbPorts, { action: "next" })
        if (reply.ok && reply.press) await hex.press(reply.press)
      },
    },
    "bb-previous": {
      phrases: ["previous thread", "previous conversation"],
      when: { application: "bb" },
      group: "BB",
      description: "Go to the previous BB thread",
      run: async ({ hex }) => {
        const reply = await runBb(bbPorts, { action: "previous" })
        if (reply.ok && reply.press) await hex.press(reply.press)
      },
    },
    "bb-unread": {
      phrases: ["next unread"],
      when: { application: "bb" },
      group: "BB",
      description: "Open the oldest unread stopped BB thread",
      run: async () => { await runBb(bbPorts, { action: "unread" }) },
    },
    "bb-show-git": {
      phrases: ["show git"],
      when: { application: "bb" },
      group: "BB",
      description: "Open Git status for the selected BB thread",
      run: async () => { await runBb(bbPorts, { action: "show", view: "git" }) },
    },
    "bb-show-usage": {
      phrases: ["show usage"],
      when: { application: "bb" },
      group: "BB",
      description: "Open agent usage for all providers and accounts",
      run: async () => { await runBb(bbPorts, { action: "show", view: "usage" }) },
    },
    "bb-close-popup": {
      phrases: ["close popup", "close pop up", "close voice monitor"],
      when: { application: "bb" },
      group: "BB",
      description: "Dismiss the top BB popup",
      run: async ({ hex }) => {
        const reply = await runBb(bbPorts, { action: "dismiss" })
        if (reply.ok && reply.press) await hex.press(reply.press)
      },
    },
    "bb-show-threads": {
      phrases: ["show threads"],
      when: { application: "bb" },
      group: "BB",
      description: "Show numbered BB thread choices",
      run: async () => { await matchBb(bbPorts, "thread", "") },
    },
    "bb-waiting": {
      phrases: ["who needs me", "next waiting"],
      when: { application: "bb" },
      group: "BB",
      description: "Show BB threads waiting for a reply",
      run: async () => { await runBb(bbPorts, { action: "attention" }) },
    },
    "bb-finished": {
      phrases: ["next finished"],
      when: { application: "bb" },
      group: "BB",
      description: "Show unread completed BB threads",
      run: async () => { await runBb(bbPorts, { action: "finished" }) },
    },
    "bb-new": {
      phrases: ["new thread", "create new thread", "start new thread", "create a new thread", "start a new thread"],
      when: { application: "bb" },
      group: "BB",
      description: "Open a draft in the current BB project",
      run: async () => { await runBb(bbPorts, { action: "new" }) },
    },
    "bb-new-in": {
      phrases: ["new thread in {project}", "create new thread in {project}", "start new thread in {project}", "create a new thread in {project}", "start a new thread in {project}"],
      when: { application: "bb" },
      group: "BB",
      description: "Open a draft in a named BB project",
      run: async ({ captures }) => { await matchBb(bbPorts, "project", captures.project ?? "") },
    },
    "bb-projects": {
      phrases: ["show projects", "list projects"],
      when: { application: "bb" },
      group: "BB",
      description: "Choose a project for a new draft",
      run: async () => { await matchBb(bbPorts, "project", "") },
    },
    "bb-project": {
      phrases: ["select project {project}", "switch project to {project}"],
      when: { application: "bb" },
      group: "BB",
      description: "Open a new draft in the named project",
      run: async ({ captures }) => { await matchBb(bbPorts, "project", captures.project ?? "") },
    },
    "bb-model": {
      phrases: ["use {model}"],
      when: { application: "bb" },
      group: "BB",
      description: "Select a model, numbered favourite or account for the next BB message",
      run: async ({ captures }) => { await runSpeech(bbPorts, `use ${captures.model ?? ""}`) },
    },
    "bb-model-change": {
      phrases: ["change model to {model}", "switch model to {model}"],
      when: { application: "bb" },
      group: "BB",
      description: "Select a model for the next BB message",
      run: async ({ captures }) => { await matchBb(bbPorts, "model", captures.model ?? "") },
    },
    "bb-models": {
      phrases: ["show models", "list models", "change model", "switch model"],
      when: { application: "bb" },
      group: "BB",
      description: "Show numbered models across available agents",
      run: async () => { await matchBb(bbPorts, "model", "") },
    },
    "bb-accounts": {
      phrases: ["show accounts", "list accounts", "change account", "switch account"],
      when: { application: "bb" },
      group: "BB",
      description: "Show numbered Claude accounts",
      run: async () => { await matchBb(bbPorts, "account", "") },
    },
    "bb-account": {
      phrases: ["change account to {account}", "switch account to {account}"],
      when: { application: "bb" },
      group: "BB",
      description: "Select a Claude account",
      run: async ({ captures }) => { await matchBb(bbPorts, "account", captures.account ?? "") },
    },
    "bb-favourites": {
      phrases: ["show favourites", "list favourites", "show favorites", "list favorites"],
      when: { application: "bb" },
      group: "BB",
      description: "Show saved models and effort",
      run: async () => { await matchBb(bbPorts, "favourite", "") },
    },
    "bb-choose": {
      phrases: ["choose {n}"],
      captures: { n: digit({ min: 1, max: 9 }) },
      when: { application: "bb" },
      group: "BB",
      description: "Choose a numbered BB voice match",
      run: async ({ captures }) => { await runBb(bbPorts, { action: "choose", number: captures.n }) },
    },
    "bb-submit-answer": {
      phrases: ["submit answer", "submit answers", "next question"],
      when: { application: "bb" },
      group: "BB",
      description: "Submit the current question answer or advance to its next page",
      run: async () => { await runBb(bbPorts, { action: "submit-answer" }) },
    },
    "bb-send": {
      phrases: ["send message", "send task"],
      when: { application: "bb" },
      group: "BB",
      description: "Send the selected chat draft",
      run: async () => { await runBb(bbPorts, { action: "send" }) },
    },
    "bb-stop": {
      phrases: ["stop agent", "stop this agent"],
      when: { application: "bb" },
      group: "BB",
      description: "Stop work in the selected thread",
      run: async () => { await runBb(bbPorts, { action: "stop" }) },
    },
    "bb-monitor": {
      phrases: ["voice monitor", "voice history", "show voice"],
      when: { application: "bb" },
      group: "BB",
      description: "Show Hex recognition and BB command results",
      run: async () => { await runBb(bbPorts, { action: "monitor" }) },
    },
    "bb-state": {
      phrases: ["where am i"],
      when: { application: "bb" },
      group: "BB",
      description: "Read the current thread, project, provider, model and account",
      run: async () => { await runBb(bbPorts, { action: "state" }) },
    },
    "bb-heard": {
      phrases: ["what did you hear"],
      when: { application: "bb" },
      group: "BB",
      description: "Read the preceding command recognition result",
      run: async () => { await runBb(bbPorts, { action: "heard" }) },
    },
    "bb-back": {
      phrases: ["go back"],
      when: { application: "bb" },
      group: "BB",
      description: "Return to the previous BB thread or draft",
      run: async () => { await runBb(bbPorts, { action: "back" }) },
    },
    "bb-read": {
      phrases: ["read the last answer", "read last answer"],
      when: { application: "bb" },
      group: "BB",
      description: "Read the selected thread's last reply aloud",
      run: async () => { await runBb(bbPorts, { action: "read" }) },
    },
    "bb-stop-reading": {
      phrases: ["stop reading"],
      when: { application: "bb" },
      group: "BB",
      description: "Stop the current voice readout",
      run: async () => { await runBb(bbPorts, { action: "stop-reading" }) },
    },
    "bb-read-confirmations": {
      phrases: ["read confirmations"],
      when: { application: "bb" },
      group: "BB",
      description: "Enable spoken command confirmations",
      run: async () => { await runBb(bbPorts, { action: "feedback", enabled: true }) },
    },
    "bb-mute-confirmations": {
      phrases: ["mute confirmations"],
      when: { application: "bb" },
      group: "BB",
      description: "Disable spoken command confirmations",
      run: async () => { await runBb(bbPorts, { action: "feedback", enabled: false }) },
    },
    "bb-pause": {
      phrases: ["pause commands"],
      when: { application: "bb" },
      group: "BB",
      description: "Pause BB voice actions in this window",
      run: async () => { await runBb(bbPorts, { action: "listen", enabled: false }) },
    },
    "bb-resume": {
      phrases: ["resume commands"],
      when: { application: "bb" },
      group: "BB",
      description: "Resume BB voice actions in this window",
      run: async () => { await runBb(bbPorts, { action: "listen", enabled: true }) },
    },
    "bb-help": {
      phrases: ["voice help", "what can i say", "what can i say here"],
      when: { application: "bb" },
      group: "BB",
      description: "Show BB voice commands",
      run: async () => { await runBb(bbPorts, { action: "help" }) },
    },
    "bb-archive": {
      phrases: ["archive this thread", "archive thread"],
      when: { application: "bb" },
      group: "BB",
      description: "Archive the selected BB thread",
      run: async () => { await runBb(bbPorts, { action: "archive" }) },
    },
    "bb-allow-once": {
      phrases: ["allow once"],
      when: { application: "bb" },
      group: "BB",
      description: "Allow the selected BB thread's pending approval once",
      run: async () => { await runBb(bbPorts, { action: "approve", decision: "allow_once" }) },
    },
    "bb-allow-for-session": {
      phrases: ["allow for session"],
      when: { application: "bb" },
      group: "BB",
      description: "Allow the selected BB thread's pending approval for the session",
      run: async () => { await runBb(bbPorts, { action: "approve", decision: "allow_for_session" }) },
    },
    "bb-deny-approval": {
      phrases: ["deny approval"],
      when: { application: "bb" },
      group: "BB",
      description: "Deny the selected BB thread's pending approval",
      run: async () => { await runBb(bbPorts, { action: "approve", decision: "deny" }) },
    },
    "bb-confirm-archive": {
      phrases: ["confirm archive"],
      when: { application: "bb" },
      group: "BB",
      description: "Confirm the pending BB archive",
      run: async () => { await runBb(bbPorts, { action: "confirm-archive" }) },
    },
    "bb-cancel-archive": {
      phrases: ["cancel archive"],
      when: { application: "bb" },
      group: "BB",
      description: "Cancel the pending BB archive",
      run: async () => { await runBb(bbPorts, { action: "cancel-archive" }) },
    },
    "bb-restore": {
      phrases: ["unarchive last thread", "restore last thread"],
      when: { application: "bb" },
      group: "BB",
      description: "Restore the last BB voice archive",
      run: async () => { await runBb(bbPorts, { action: "restore" }) },
    },
    // Choice aliases must be single words; keys are the macOS app names.
    "open-app": {
      phrases: ["open {app}", "switch to {app}"],
      captures: {
        app: choice({
          Slack: ["slack"],
          bb: ["bb"],
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
