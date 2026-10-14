const shellFence = /^```(?:bash|sh|zsh|shell|console)[^\n]*\n([\s\S]*?)^```/gm;

/** Drops a copied `$ ` prompt and trailing blank lines so the paste is only commands. */
function clean(text: string): string {
  return text.split('\n').map(line => line.replace(/^\s*\$ /, '')).join('\n').trimEnd();
}

/** The selection when there is one; otherwise every shell fence in the message. */
export function commandsFrom(selectedText: string | undefined, messageText: string): string {
  if (selectedText?.trim()) return clean(selectedText);
  return clean([...messageText.matchAll(shellFence)].map(match => match[1]).join(''));
}
