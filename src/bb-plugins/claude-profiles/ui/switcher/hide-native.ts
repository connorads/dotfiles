// No SDK slot hides only BB's model picker; replacing the whole composer is the alternative. The selector
// follows BB 0.49's bundled composer markup, so a markup change shows the native picker again rather than
// hiding anything else.
export const NATIVE_PICKER = '[data-promptbox-standard-actions] > button[aria-label^="Provider, model and reasoning"]';
const OWNER = 'hide-native-picker';

export function hideNativePicker(doc: Document): () => void {
  const existing = doc.head.querySelector<HTMLStyleElement>(`style[data-agent-switcher="${OWNER}"]`);
  if (existing) return () => {};
  const style = doc.createElement('style');
  style.dataset.agentSwitcher = OWNER;
  style.textContent = `${NATIVE_PICKER} { display: none !important; }`;
  doc.head.append(style);
  return () => { style.remove(); };
}
