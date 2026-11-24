import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the minimal writable Git metadata roots required for linked-worktree
 * operations (`git add`, `git reset`, `git commit`, branch updates) without
 * widening write access to the parent repository checkout directory.
 *
 * Adapted from BB's `provider-codex` worktree root resolver.
 */

type ContainedDirectoryResult =
  | { status: "contained"; path: string }
  | { status: "missing" }
  | { status: "escaped" };

type GitHeadState =
  | { type: "detached" }
  | { type: "ref"; ref: string }
  | { type: "unsafe" };

function readTextFileIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function realpathDirectoryIfPresent(directoryPath: string): string | null {
  try {
    if (!fs.statSync(directoryPath).isDirectory()) {
      return null;
    }
    return fs.realpathSync.native(directoryPath);
  } catch {
    return null;
  }
}

function isPathInsideOrEqual(
  parentPath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative))
  );
}

function regularFilePathInsideDirectoryIfPresent(
  filePath: string,
  trustedParentPath: string,
): string | null {
  try {
    const normalized = path.normalize(filePath);
    if (
      !fs.lstatSync(normalized).isFile() ||
      !isPathInsideOrEqual(trustedParentPath, normalized)
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function resolveGitPath(baseDir: string, rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.normalize(path.resolve(baseDir, rawPath));
}

function parseGitDirPointer(content: string): string | null {
  const firstLine = content.split(/\r?\n/u)[0]?.trim();
  if (!firstLine?.startsWith("gitdir:")) {
    return null;
  }
  const rawGitDir = firstLine.slice("gitdir:".length).trim();
  return rawGitDir.length > 0 ? rawGitDir : null;
}

function parseGitHeadState(content: string | null): GitHeadState {
  const firstLine = content?.split(/\r?\n/u)[0]?.trim();
  if (!firstLine) {
    return { type: "unsafe" };
  }
  if (!firstLine.startsWith("ref:")) {
    return /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/u.test(firstLine)
      ? { type: "detached" }
      : { type: "unsafe" };
  }
  const ref = firstLine.slice("ref:".length).trim();
  return ref.length > 0 ? { type: "ref", ref } : { type: "unsafe" };
}

function resolveCommonGitDir(gitDir: string): string | null {
  const commonDirContent = readTextFileIfPresent(
    path.join(gitDir, "commondir"),
  );
  const commonDir = commonDirContent?.split(/\r?\n/u)[0]?.trim();
  if (!commonDir) {
    return null;
  }
  return path.isAbsolute(commonDir)
    ? path.normalize(commonDir)
    : path.normalize(path.resolve(gitDir, commonDir));
}

function linkedWorktreeGitDirBelongsToWorkspace(args: {
  gitDir: string;
  workspaceGitFile: string;
  workspacePath: string;
}): boolean {
  const rawBacklink = readTextFileIfPresent(path.join(args.gitDir, "gitdir"))
    ?.split(/\r?\n/u)[0]
    ?.trim();
  if (!rawBacklink) {
    return false;
  }
  const resolved = resolveGitPath(args.gitDir, rawBacklink);
  let realBacklink: string;
  try {
    realBacklink = fs.realpathSync.native(resolved);
  } catch {
    return false;
  }
  const linkedGitFile = regularFilePathInsideDirectoryIfPresent(
    realBacklink,
    args.workspacePath,
  );
  return linkedGitFile === args.workspaceGitFile;
}

function realpathContainedDirectory(
  candidatePath: string,
  trustedParentPath: string,
): ContainedDirectoryResult {
  const realCandidatePath = realpathDirectoryIfPresent(candidatePath);
  if (!realCandidatePath) {
    return { status: "missing" };
  }
  if (!isPathInsideOrEqual(trustedParentPath, realCandidatePath)) {
    return { status: "escaped" };
  }
  return { status: "contained", path: realCandidatePath };
}

function isSafeGitHeadRef(ref: string): boolean {
  return (
    ref.startsWith("refs/") &&
    !ref.includes("..") &&
    !ref.includes("\\") &&
    !ref.endsWith("/") &&
    ref
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          !segment.includes("\0"),
      )
  );
}

function addContainedDirectory(
  candidatePath: string,
  trustedParentPath: string,
  writableRoots: string[],
): boolean {
  const result = realpathContainedDirectory(candidatePath, trustedParentPath);
  if (result.status === "escaped") {
    return false;
  }
  if (result.status === "contained") {
    writableRoots.push(result.path);
  }
  return true;
}

export function gitWritableRootsForWorkspace(
  cwd: string | undefined,
): string[] {
  if (!cwd) {
    return [];
  }
  const workspacePath = realpathDirectoryIfPresent(cwd);
  if (!workspacePath) {
    return [];
  }

  const workspaceGitFile = regularFilePathInsideDirectoryIfPresent(
    path.join(workspacePath, ".git"),
    workspacePath,
  );
  if (!workspaceGitFile) {
    // Normal `.git` directory inside workspace is already covered by `cwd`.
    return [];
  }

  const gitFileContent = readTextFileIfPresent(workspaceGitFile);
  if (gitFileContent === null) {
    return [];
  }
  const rawGitDir = parseGitDirPointer(gitFileContent);
  if (!rawGitDir) {
    return [];
  }

  const realGitDir = realpathDirectoryIfPresent(
    resolveGitPath(workspacePath, rawGitDir),
  );
  if (!realGitDir || isPathInsideOrEqual(workspacePath, realGitDir)) {
    return [];
  }

  if (
    !linkedWorktreeGitDirBelongsToWorkspace({
      gitDir: realGitDir,
      workspaceGitFile,
      workspacePath,
    })
  ) {
    return [];
  }

  const rawCommonDir = resolveCommonGitDir(realGitDir);
  if (!rawCommonDir) {
    return [realGitDir];
  }
  const realCommonDir = realpathDirectoryIfPresent(rawCommonDir);
  if (!realCommonDir) {
    return [];
  }

  // Ensure the linked worktree gitdir actually lives under `<commonDir>/worktrees`.
  const worktreesDir = realpathContainedDirectory(
    path.join(realCommonDir, "worktrees"),
    realCommonDir,
  );
  if (
    worktreesDir.status !== "contained" ||
    !isPathInsideOrEqual(worktreesDir.path, realGitDir)
  ) {
    return [];
  }

  const writableRoots: string[] = [realGitDir];

  // Objects directory for staging & committing blobs/trees/commits.
  if (
    !addContainedDirectory(
      path.join(realCommonDir, "objects"),
      realCommonDir,
      writableRoots,
    )
  ) {
    return [];
  }

  // Logs directory (reflogs for HEAD / branch updates).
  const headState = parseGitHeadState(
    readTextFileIfPresent(path.join(realGitDir, "HEAD")),
  );
  if (headState.type === "unsafe") {
    return [];
  }

  if (headState.type === "ref") {
    if (!isSafeGitHeadRef(headState.ref)) {
      return [];
    }
    const refParent = path.dirname(path.join(realCommonDir, headState.ref));
    if (!addContainedDirectory(refParent, realCommonDir, writableRoots)) {
      // If intermediate ref directory doesn't exist yet, fall back to `<commonDir>/refs/heads`.
      if (
        !addContainedDirectory(
          path.join(realCommonDir, "refs", "heads"),
          realCommonDir,
          writableRoots,
        )
      ) {
        return [];
      }
    }
    const refLogParent = path.dirname(
      path.join(realCommonDir, "logs", headState.ref),
    );
    if (!addContainedDirectory(refLogParent, realCommonDir, writableRoots)) {
      if (
        !addContainedDirectory(
          path.join(realCommonDir, "logs", "refs", "heads"),
          realCommonDir,
          writableRoots,
        )
      ) {
        return [];
      }
    }
  } else {
    // Detached HEAD still needs `<commonDir>/logs` if present.
    if (
      !addContainedDirectory(
        path.join(realCommonDir, "logs"),
        realCommonDir,
        writableRoots,
      )
    ) {
      return [];
    }
  }

  // Allow packed-refs updates when refs are packed.
  const refsDir = realpathContainedDirectory(
    path.join(realCommonDir, "refs"),
    realCommonDir,
  );
  if (refsDir.status === "contained") {
    writableRoots.push(refsDir.path);
  }
  const logsDir = realpathContainedDirectory(
    path.join(realCommonDir, "logs"),
    realCommonDir,
  );
  if (logsDir.status === "contained") {
    writableRoots.push(logsDir.path);
  }

  return [...new Set(writableRoots)];
}
