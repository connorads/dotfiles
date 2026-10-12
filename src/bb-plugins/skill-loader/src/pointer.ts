// `skl preview <ref>` prints `<name>\n\n<bulk>`. `skl load` injects that as
// `<name> <bulk>` (name as visible keystrokes, bulk as a paste) and
// `skl load --copy` joins several with a blank line. The same shape is the
// agent context here, so a pill and a tmux injection read identically.

export function pointerFromPreview(stdout: string): string {
  const text = stdout.replace(/\s+$/, '');
  const split = text.indexOf('\n\n');
  if (split === -1) return text;
  return `${text.slice(0, split)} ${text.slice(split + 2)}`;
}

export function joinPointers(pointers: readonly string[]): string {
  return pointers.join('\n\n');
}
