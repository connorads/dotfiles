import {
  Action,
  ActionPanel,
  Icon,
  List,
  LocalStorage,
  Toast,
  getPreferenceValues,
  showHUD,
  showToast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const LAST_HOST_KEY = "shotpath:lastHost";

interface ClipboardImage {
  directory: string;
  path: string;
}

interface Preferences {
  shotpathPath: string;
}

/**
 * Raycast launches extensions with a minimal GUI/launchd PATH that excludes
 * ~/.local/bin (shotpath) and the nix-managed pngpaste/ssh/scp/pbcopy that
 * shotpath shells out to. Prepend the likely tool dirs so the child resolves
 * everything; shotpath itself is still invoked by absolute path.
 */
function childEnv(): NodeJS.ProcessEnv {
  const home = homedir();
  const user = userInfo().username;
  const extra = [
    `${home}/.nix-profile/bin`,
    `/etc/profiles/per-user/${user}/bin`,
    `/run/current-system/sw/bin`,
    `/opt/homebrew/bin`,
    `/usr/local/bin`,
    `${home}/.local/bin`,
  ];
  const current = process.env.PATH ?? "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${extra.join(":")}:${current}`,
  };
  // Raycast's launchd environment usually carries SSH_AUTH_SOCK (published by
  // `launchctl setenv` in .zprofile -> Bitwarden agent), so ssh/scp authenticate.
  // Fall back to the known socket if it's absent (e.g. a fresh boot before any
  // login shell ran).
  if (!env.SSH_AUTH_SOCK) {
    const sock = `${home}/.bitwarden-ssh-agent.sock`;
    if (existsSync(sock)) env.SSH_AUTH_SOCK = sock;
  }
  return env;
}

function shotpathBinary(): string {
  const { shotpathPath } = getPreferenceValues<Preferences>();
  const raw = shotpathPath?.trim();
  if (!raw) return join(homedir(), ".local/bin/shotpath");
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
}

async function captureClipboardImage(
  env: NodeJS.ProcessEnv,
): Promise<ClipboardImage | null> {
  const directory = await mkdtemp(join(tmpdir(), "raycast-shotpath-"));
  const path = join(directory, `shotpath-${randomUUID()}.png`);

  try {
    await run("pngpaste", [path], {
      env,
      cwd: homedir(),
      timeout: 5_000,
    });
    if ((await stat(path)).size === 0) throw new Error("empty clipboard image");
    return { directory, path };
  } catch {
    await rm(directory, { recursive: true, force: true });
    return null;
  }
}

/**
 * Use pngpaste for the probe too: it is what shotpath uses and it accepts
 * pasteboards that only advertise a file URL but still contain an image.
 */
async function clipboardHasImage(env: NodeJS.ProcessEnv): Promise<boolean> {
  const image = await captureClipboardImage(env);
  if (!image) return false;
  await rm(image.directory, { recursive: true, force: true });
  return true;
}

async function listHosts(
  bin: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const { stdout } = await run(bin, ["--list-hosts"], {
    env,
    cwd: homedir(),
    timeout: 10_000,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Float the last-used host to the top; keep ssh-config order for the rest. */
function orderHosts(hosts: string[], last: string | undefined): string[] {
  if (!last || !hosts.includes(last)) return hosts;
  return [last, ...hosts.filter((h) => h !== last)];
}

/** Last meaningful stderr line, ignoring shotpath's "Copied … to clipboard" notice. */
function failureMessage(error: unknown): string {
  const e = error as { stderr?: string; message?: string };
  const stderr = (e.stderr ?? "").trim();
  if (stderr) {
    const lines = stderr
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^Copied .* to clipboard$/.test(l));
    if (lines.length > 0) return lines[lines.length - 1];
  }
  return (e.message ?? "shotpath failed").split("\n")[0];
}

async function uploadTo(host: string, bin: string, env: NodeJS.ProcessEnv) {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Uploading to ${host}…`,
  });

  const image = await captureClipboardImage(env);
  if (!image) {
    toast.style = Toast.Style.Failure;
    toast.title = "No screenshot on clipboard";
    toast.message = "Copy a screenshot first (⌘⌃⇧4), then try again.";
    return;
  }

  try {
    const { stdout } = await run(bin, ["--host", host, image.path], {
      env,
      cwd: homedir(),
      timeout: 60_000,
    });
    const path = stdout.trim();
    await LocalStorage.setItem(LAST_HOST_KEY, host);
    // HUD survives the window closing, so the user can paste straight away.
    await showHUD(`Copied ${path}`);
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = `shotpath ${host} failed`;
    toast.message = failureMessage(error);
  } finally {
    await rm(image.directory, { recursive: true, force: true });
  }
}

export default function Command() {
  const bin = shotpathBinary();
  const env = childEnv();

  const { isLoading, data, error } = usePromise(async () => {
    const [hasImage, hosts, last] = await Promise.all([
      clipboardHasImage(env),
      listHosts(bin, env),
      LocalStorage.getItem<string>(LAST_HOST_KEY),
    ]);
    return { hasImage, hosts: orderHosts(hosts, last) };
  });

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't list SSH hosts"
          description={`${shotpathBinary()} --list-hosts failed: ${failureMessage(error)}`}
        />
      </List>
    );
  }

  if (!isLoading && data && !data.hasImage) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Image}
          title="No screenshot on clipboard"
          description="Copy a screenshot first (⌘⌃⇧4), then reopen this command."
        />
      </List>
    );
  }

  if (!isLoading && data && data.hosts.length === 0) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Globe}
          title="No SSH hosts found"
          description="Add Host entries to ~/.ssh/config."
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter hosts…">
      {(data?.hosts ?? []).map((host) => (
        <List.Item
          key={host}
          title={host}
          icon={Icon.Globe}
          actions={
            <ActionPanel>
              <Action
                title="Upload Screenshot & Copy Remote Path"
                icon={Icon.Upload}
                onAction={() => uploadTo(host, bin, env)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
