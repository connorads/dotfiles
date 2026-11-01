export interface NativeContextDetailsOptions {
  document: Document;
  resolveThread: (trigger: HTMLElement) => string | null;
  onInspect: (threadId: string) => void;
}

/** Version-dependent native popover decoration. Unresolved ownership produces no action. */
export function mountNativeContextDetails({ document: doc, resolveThread, onInspect }: NativeContextDetailsOptions): () => void {
  const view = doc.defaultView;
  if (!view) return () => {};
  const NativeElement = view.HTMLElement;
  const owned = new Map<HTMLElement, { button: HTMLButtonElement; trigger: HTMLElement; threadId: string }>();
  let disposed = false;
  function linkedPopup(trigger: HTMLElement): HTMLElement | null {
    const label = trigger.getAttribute('aria-label') ?? '';
    if (!/^Context window \d{1,3}% used$/.test(label) || trigger.getAttribute('aria-expanded') !== 'true') return null;
    const id = trigger.getAttribute('aria-controls');
    const popup = id ? doc.getElementById(id) : null;
    return popup instanceof NativeElement && popup.getAttribute('role') === 'dialog'
      && !popup.hidden && popup.getAttribute('aria-hidden') !== 'true' ? popup : null;
  }
  function refresh() {
    if (disposed) return;
    const candidates = new Map<HTMLElement, HTMLElement[]>();
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>('button[aria-label][aria-controls][aria-expanded="true"]'))) {
      const popup = linkedPopup(element);
      if (popup) candidates.set(popup, [...(candidates.get(popup) ?? []), element]);
    }
    for (const [popup, entry] of owned) {
      const triggers = candidates.get(popup);
      if (triggers?.length !== 1 || triggers[0] !== entry.trigger || resolveThread(entry.trigger) !== entry.threadId || !entry.button.isConnected) {
        entry.button.remove(); owned.delete(popup);
      }
    }
    for (const [popup, triggers] of candidates) {
      if (triggers.length !== 1 || owned.has(popup)) continue;
      const trigger = triggers[0];
      const threadId = resolveThread(trigger);
      if (!threadId) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ci-native-popup-action';
      button.textContent = 'Inspect source costs';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!disposed && linkedPopup(trigger) === popup && resolveThread(trigger) === threadId) onInspect(threadId);
      });
      popup.append(button);
      owned.set(popup, { button, trigger, threadId });
    }
  }
  const observer = new view.MutationObserver(refresh);
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-controls', 'aria-expanded', 'aria-label', 'aria-hidden', 'hidden'] });
  refresh();
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    for (const { button } of owned.values()) button.remove();
    owned.clear();
  };
}
