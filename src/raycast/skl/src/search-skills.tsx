import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  closeMainWindow,
  getPreferenceValues,
  showHUD,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { useState } from "react";

const run = promisify(execFile);

interface Preferences {
  sklPath: string;
}

interface Skill {
  /** `source/name`, the first whitespace token of a `skl list` line. */
  ref: string;
  source: string;
  name: string;
  description: string;
}

/**
 * Raycast launches extensions with a minimal launchd PATH. `skl` is a Bun script
 * reached via the ~/.local/bin/skl shim, and that shim resolves `bun` off PATH —
 * the mise `bun` shim lives in ~/.local/share/mise/shims. Prepend both (plus the
 * usual nix/homebrew dirs) so the child resolves skl and bun however Raycast was
 * started; skl itself is still invoked by absolute path.
 */
function childEnv(): NodeJS.ProcessEnv {
  const home = homedir();
  const user = userInfo().username;
  const extra = [
    `${home}/.local/share/mise/shims`,
    `${home}/.local/bin`,
    `${home}/.nix-profile/bin`,
    `/etc/profiles/per-user/${user}/bin`,
    `/run/current-system/sw/bin`,
    `/opt/homebrew/bin`,
    `/usr/local/bin`,
  ];
  const current = process.env.PATH ?? "";
  return { ...process.env, PATH: `${extra.join(":")}:${current}` };
}

function sklBinary(): string {
  const { sklPath } = getPreferenceValues<Preferences>();
  const raw = sklPath?.trim();
  if (!raw) return join(homedir(), ".local/bin/skl");
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
}

/** Parse `skl list` output: `<source>/<name>  <description>` per line. */
function parseSkills(stdout: string): Skill[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const ref = line.split(/\s+/)[0] ?? "";
      const description = line.slice(ref.length).trim();
      const slash = ref.indexOf("/");
      const source = slash >= 0 ? ref.slice(0, slash) : "";
      const name = slash >= 0 ? ref.slice(slash + 1) : ref;
      return { ref, source, name, description };
    })
    .filter((skill) => skill.ref.length > 0);
}

/** Keep config (source) precedence by grouping consecutive same-source skills. */
function groupBySource(skills: Skill[]): { source: string; skills: Skill[] }[] {
  const groups: { source: string; skills: Skill[] }[] = [];
  for (const skill of skills) {
    const last = groups.at(-1);
    if (last && last.source === skill.source) last.skills.push(skill);
    else groups.push({ source: skill.source, skills: [skill] });
  }
  return groups;
}

// `skl preview <ref>` spawns Bun; memoise so re-selecting a skill is instant and
// the copy/paste actions reuse whatever the detail pane already fetched.
const previewCache = new Map<string, string>();

async function fetchPreview(
  ref: string,
  bin: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const cached = previewCache.get(ref);
  if (cached !== undefined) return cached;
  const { stdout } = await run(bin, ["preview", ref], {
    env,
    cwd: homedir(),
    timeout: 10_000,
  });
  previewCache.set(ref, stdout);
  return stdout;
}

/**
 * `skl preview` prints `<name>\n\n<bulk>`. `bulk` is the pointer body: the
 * `(skl: …)` line, description, file tree, and the "Read SKILL.md at …"
 * instruction.
 */
function splitPointer(preview: string): { name: string; bulk: string } {
  const idx = preview.indexOf("\n\n");
  if (idx < 0) return { name: preview.trim(), bulk: "" };
  return {
    name: preview.slice(0, idx).trim(),
    bulk: preview.slice(idx + 2).trimEnd(),
  };
}

/**
 * The text skl would put on the clipboard: `<name> <bulk>` — the same payload it
 * injects into a pane (literal name, space, then the bracketed-paste body).
 */
function pointerText(preview: string): string {
  const { name, bulk } = splitPointer(preview);
  return bulk ? `${name} ${bulk}` : name;
}

/** Detail markdown: heading + the pointer body in a code block (preserves the tree). */
function pointerMarkdown(preview: string): string {
  const { name, bulk } = splitPointer(preview);
  return `### ${name}\n\n\`\`\`\n${bulk}\n\`\`\``;
}

function SkillActions({
  skill,
  bin,
  env,
  onToggleDetail,
}: {
  skill: Skill;
  bin: string;
  env: NodeJS.ProcessEnv;
  onToggleDetail: () => void;
}) {
  async function pointer(): Promise<string> {
    return pointerText(await fetchPreview(skill.ref, bin, env));
  }

  return (
    <ActionPanel>
      <Action
        title="Copy Skill Pointer"
        icon={Icon.Clipboard}
        onAction={async () => {
          try {
            await Clipboard.copy(await pointer());
            await showHUD(`Copied ${skill.ref} pointer`);
          } catch (error) {
            await showFailureToast(error, { title: "Couldn't copy pointer" });
          }
        }}
      />
      <Action
        title="Paste Skill Pointer"
        icon={Icon.Text}
        shortcut={{ modifiers: ["cmd"], key: "return" }}
        onAction={async () => {
          try {
            const text = await pointer();
            await closeMainWindow();
            await Clipboard.paste(text);
          } catch (error) {
            await showFailureToast(error, { title: "Couldn't paste pointer" });
          }
        }}
      />
      <Action.CopyToClipboard
        title="Copy Reference"
        content={skill.ref}
        shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
      />
      <Action
        title="Toggle Preview"
        icon={Icon.Sidebar}
        shortcut={{ modifiers: ["cmd"], key: "d" }}
        onAction={onToggleDetail}
      />
    </ActionPanel>
  );
}

export default function Command() {
  const bin = sklBinary();
  const env = childEnv();
  const [showingDetail, setShowingDetail] = useState(true);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  const {
    isLoading,
    data: skills,
    error,
  } = usePromise(async () => {
    const { stdout } = await run(bin, ["list"], {
      env,
      cwd: homedir(),
      timeout: 15_000,
    });
    return parseSkills(stdout);
  });

  const { isLoading: previewLoading, data: preview } = usePromise(
    async (ref: string | null) => (ref ? fetchPreview(ref, bin, env) : ""),
    [selectedRef],
    { execute: showingDetail && Boolean(selectedRef) },
  );

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't list skills"
          description={`${bin} list failed: ${error.message}`}
        />
      </List>
    );
  }

  const groups = groupBySource(skills ?? []);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showingDetail}
      searchBarPlaceholder="Filter skills…"
      onSelectionChange={(id) => setSelectedRef(id)}
    >
      {groups.map((group) => (
        <List.Section
          key={group.source}
          title={group.source}
          subtitle={`${group.skills.length}`}
        >
          {group.skills.map((skill) => (
            <List.Item
              key={skill.ref}
              id={skill.ref}
              icon={Icon.Stars}
              title={skill.name}
              subtitle={showingDetail ? undefined : skill.description}
              keywords={[
                skill.source,
                ...skill.description.toLowerCase().split(/\s+/),
              ].filter(Boolean)}
              detail={
                <List.Item.Detail
                  isLoading={previewLoading && selectedRef === skill.ref}
                  markdown={
                    selectedRef === skill.ref && preview
                      ? pointerMarkdown(preview)
                      : ""
                  }
                />
              }
              actions={
                <SkillActions
                  skill={skill}
                  bin={bin}
                  env={env}
                  onToggleDetail={() => setShowingDetail((value) => !value)}
                />
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
